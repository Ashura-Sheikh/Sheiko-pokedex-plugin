// Saved state and the reward decision. Pure: takes data in, returns new data out.
// The Pokédex never writes to task notes; everything lives in the plugin's own data.json.
//
// 0.2.0 (Sheikh, 2026-10-12): a catch comes every 4-7 counted closes (hidden target).
// Rarity uses the average score of the closes since the last catch, plus a daily
// boost for how many closes were counted today. At most 3 catches a day.

import {
	ContextTypes,
	Draw,
	draw,
	drawTarget,
	hashString,
	isDateOnlyValue,
	parseDate,
	score,
	seededRandom,
	withinSla,
} from './rarity';
import {
	DUPLICATE_BONUS_XP,
	Mon,
	STONE_CHANCE,
	Stones,
	addXp,
	newMon,
	noStones,
	speciesByDex,
	stoneForTypes,
	xpForClose,
} from './progression';
import { STONE_KINDS, StoneKind } from './species';

export interface Settings {
	/** Catches per day. Closes after the limit is reached earn nothing and never pay out later. */
	dailyCap: number;
	showRewardWindow: boolean;
	/** "context: type, type" per line. Parsed by parseContextTypes. */
	contextTypes: string;
}

export const DEFAULT_CONTEXT_TYPES = [
	'agent-infrastructure: electric, psychic, steel, normal',
	'vault-operations: normal, ground, rock',
	'legal: psychic, fighting, ice',
	'business: normal, flying, fire',
	'technical-delivery: electric, fire, steel, poison',
	'operations-delivery: fighting, ground, rock',
	'ai-agent-report: psychic, ghost, electric',
	'TOS: water, grass, bug',
].join('\n');

export const DEFAULT_SETTINGS: Settings = {
	dailyCap: 3,
	showRewardWindow: true,
	contextTypes: DEFAULT_CONTEXT_TYPES,
};

/** No reward and no progress for these, matching the SLA view's exclusion. */
export const EXCLUDED_CLOSE_REASONS = ['superseded', 'parked'];

export type Outcome = 'counted' | 'caught' | 'excluded' | 'capped';

export interface LedgerEntry {
	at: string;
	outcome: Outcome;
	dex?: number;
}

export interface CaughtEntry {
	count: number;
	firstAt: string;
	lastAt: string;
}

/** Progress toward the next catch. Kept overnight. */
export interface Progress {
	closes: number;
	/** Hidden: never shown in the UI. */
	target: number;
	scoreSum: number;
	contexts: string[];
}

export interface PokedexData {
	version: 3;
	installedAt: string;
	settings: Settings;
	/** One entry per task path that has ever been through a decision. Never counted twice. */
	ledger: Record<string, LedgerEntry>;
	caught: Record<string, CaughtEntry>;
	/** Total catches ever; also seeds each new hidden target. */
	catches: number;
	progress: Progress;
	/** Counted closes and catches on `date` (local). Resets at midnight; progress does not. */
	daily: { date: string; closes: number; catches: number };
	/** Level and XP per caught species (Phase 3). Each keeps its own, so swapping partners loses nothing. */
	mons: Record<string, Mon>;
	/** Dex number of the partner that earns XP, or null until one is chosen. */
	partner: number | null;
	stones: Stones;
}

export function newProgress(installedAt: string, catches: number): Progress {
	return { closes: 0, target: drawTarget(`${installedAt}|${catches}`), scoreSum: 0, contexts: [] };
}

export function freshData(now: Date): PokedexData {
	const installedAt = now.toISOString();
	return {
		version: 3,
		installedAt,
		settings: { ...DEFAULT_SETTINGS },
		ledger: {},
		caught: {},
		catches: 0,
		progress: newProgress(installedAt, 0),
		daily: { date: localDate(now), closes: 0, catches: 0 },
		mons: {},
		partner: null,
		stones: noStones(),
	};
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Fills in anything missing and migrates 0.1.0 (version 1) and 0.2.0 (version 2) data. */
export function normalizeData(raw: unknown, now: Date): PokedexData {
	const base = freshData(now);
	if (!isRecord(raw)) return base;
	const installedAt = typeof raw.installedAt === 'string' ? raw.installedAt : base.installedAt;
	const savedSettings = isRecord(raw.settings) ? (raw.settings as Partial<Settings>) : {};
	const settings: Settings = { ...DEFAULT_SETTINGS, ...savedSettings };
	const caught = isRecord(raw.caught) ? ({ ...raw.caught } as Record<string, CaughtEntry>) : {};
	const ledger = isRecord(raw.ledger) ? ({ ...raw.ledger } as Record<string, LedgerEntry>) : {};
	const caughtTotal = Object.values(caught).reduce((n, c) => n + (typeof c?.count === 'number' ? c.count : 0), 0);
	const catches = typeof raw.catches === 'number' ? raw.catches : caughtTotal;

	const d = isRecord(raw.daily) ? raw.daily : {};
	const today = localDate(now);
	let daily = base.daily;
	if (d.date === today) {
		if ((raw.version === 2 || raw.version === 3) && typeof d.closes === 'number' && typeof d.catches === 'number') {
			daily = { date: today, closes: d.closes, catches: d.catches };
		} else if (typeof d.count === 'number') {
			// 0.1.0 counted one close = one catch.
			daily = { date: today, closes: d.count, catches: d.count };
		}
	}

	if (raw.version === 1 || raw.version === undefined) {
		// 0.1.0 → 0.2.0: the limit is now catches per day, default 3 (Sheikh, 2026-10-12).
		if (savedSettings.dailyCap === 10) settings.dailyCap = DEFAULT_SETTINGS.dailyCap;
	}

	const p = isRecord(raw.progress) ? raw.progress : null;
	const progress: Progress =
		p && typeof p.closes === 'number' && typeof p.target === 'number' && typeof p.scoreSum === 'number'
			? {
					closes: p.closes,
					target: p.target,
					scoreSum: p.scoreSum,
					contexts: Array.isArray(p.contexts) ? p.contexts.filter((c): c is string => typeof c === 'string') : [],
				}
			: newProgress(installedAt, catches);

	// Phase 3: every caught species gets a level; saved levels are kept.
	const savedMons = isRecord(raw.mons) ? raw.mons : {};
	const mons: Record<string, Mon> = {};
	for (const key of Object.keys(caught)) {
		const m = savedMons[key];
		mons[key] =
			isRecord(m) && typeof m.level === 'number' && typeof m.xp === 'number'
				? {
						level: m.level,
						xp: m.xp,
						...(typeof m.declinedAt === 'number' ? { declinedAt: m.declinedAt } : {}),
					}
				: newMon();
	}
	const partner = typeof raw.partner === 'number' && caught[String(raw.partner)] ? raw.partner : null;
	const stones = noStones();
	if (isRecord(raw.stones)) {
		for (const k of STONE_KINDS) {
			const v = raw.stones[k];
			if (typeof v === 'number' && v > 0) stones[k] = Math.floor(v);
		}
	}

	return { version: 3, installedAt, settings, ledger, caught, catches, progress, daily, mons, partner, stones };
}

export function localDate(d: Date): string {
	const p = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export interface CloseInput {
	path: string;
	priority: string | null;
	contexts: string[];
	closeReason: string | null;
	dateCreated: unknown;
	completedDate: unknown;
	/** Sheiko's timeWorkingMinutes when present. Otherwise task size is dateCreated → close. */
	workingMinutes?: number | null;
}

/** XP the partner gained from this close, or null when no partner is chosen. */
export interface XpGain {
	dex: number;
	gained: number;
	fromLevel: number;
	toLevel: number;
}

export type Decision =
	| { kind: 'already' }
	| { kind: 'excluded'; reason: string }
	| { kind: 'capped'; cap: number }
	| { kind: 'counted'; closes: number; xp: XpGain | null }
	| { kind: 'caught'; draw: Draw; duplicate: boolean; count: number; xp: XpGain | null; stone: StoneKind | null };

/** Task size in minutes: Sheiko's working minutes if given, else created → close. Null if unknown. */
export function sizeMinutes(input: CloseInput, now: Date): number | null {
	if (typeof input.workingMinutes === 'number' && Number.isFinite(input.workingMinutes)) return input.workingMinutes;
	const c = parseDate(input.dateCreated);
	const closedRaw = closeMoment(input.completedDate, now);
	const d = parseDate(closedRaw);
	if (!c || !d) return null;
	const m = (d.getTime() - c.getTime()) / 60000;
	return m >= 0 ? m : null;
}

/** Adds XP to the partner in `data` (mutates the given copy). Returns null without a partner. */
function givePartnerXp(next: PokedexData, amount: number): XpGain | null {
	if (next.partner === null) return null;
	const key = String(next.partner);
	const mon = next.mons[key] ?? newMon();
	const r = addXp(mon, amount);
	next.mons = { ...next.mons, [key]: r.mon };
	return { dex: next.partner, gained: Math.floor(amount), fromLevel: r.fromLevel, toLevel: r.toLevel };
}

/**
 * When the close was made. TaskNotes writes a date-only completedDate; if it's today's
 * date, the moment we saw the close is the honest time (as Sheiko does). Otherwise the value as written.
 */
export function closeMoment(completedDate: unknown, now: Date): unknown {
	if (completedDate === undefined || completedDate === null || completedDate === '') return now.toISOString();
	if (typeof completedDate === 'string' && isDateOnlyValue(completedDate) && completedDate.trim() === localDate(now)) {
		return now.toISOString();
	}
	return completedDate;
}

export function decide(
	input: CloseInput,
	data: PokedexData,
	map: ContextTypes,
	now: Date,
): { data: PokedexData; decision: Decision } {
	if (data.ledger[input.path]) return { data, decision: { kind: 'already' } };

	const at = now.toISOString();
	const today = localDate(now);
	const next: PokedexData = {
		...data,
		ledger: { ...data.ledger },
		caught: { ...data.caught },
		progress: { ...data.progress, contexts: [...data.progress.contexts] },
		daily: data.daily.date === today ? { ...data.daily } : { date: today, closes: 0, catches: 0 },
		mons: { ...data.mons },
		stones: { ...data.stones },
	};

	const reason = input.closeReason?.trim().toLowerCase() ?? '';
	if (EXCLUDED_CLOSE_REASONS.includes(reason)) {
		next.ledger[input.path] = { at, outcome: 'excluded' };
		return { data: next, decision: { kind: 'excluded', reason } };
	}

	const cap = Math.max(0, Math.floor(data.settings.dailyCap));
	if (next.daily.catches >= cap) {
		next.ledger[input.path] = { at, outcome: 'capped' };
		return { data: next, decision: { kind: 'capped', cap } };
	}

	// Count the close toward the batch.
	const sla = withinSla(input.priority, input.dateCreated, closeMoment(input.completedDate, now));
	next.progress.closes += 1;
	next.progress.scoreSum += score(input.priority, sla);
	for (const c of input.contexts) if (!next.progress.contexts.includes(c)) next.progress.contexts.push(c);
	next.daily.closes += 1;
	const closeXp = xpForClose(sizeMinutes(input, now));

	if (next.progress.closes < next.progress.target) {
		next.ledger[input.path] = { at, outcome: 'counted' };
		const xp = givePartnerXp(next, closeXp);
		return { data: next, decision: { kind: 'counted', closes: next.progress.closes, xp } };
	}

	// Target reached: catch.
	const d = draw(
		{
			seed: `${data.installedAt}|catch|${data.catches}|${input.path}`,
			scoreSum: next.progress.scoreSum,
			closes: next.progress.closes,
			closesToday: next.daily.closes,
			contexts: next.progress.contexts,
		},
		map,
	);
	const key = String(d.species.dex);
	const prev = next.caught[key];
	const entry: CaughtEntry = prev
		? { ...prev, count: prev.count + 1, lastAt: at }
		: { count: 1, firstAt: at, lastAt: at };
	next.caught[key] = entry;
	if (!next.mons[key]) next.mons[key] = newMon();
	next.catches = data.catches + 1;
	next.daily.catches += 1;
	next.progress = newProgress(data.installedAt, next.catches);
	next.ledger[input.path] = { at, outcome: 'caught', dex: d.species.dex };

	// XP: the catching close counts like any other; a duplicate adds a bonus.
	const xp = givePartnerXp(next, closeXp + (prev ? DUPLICATE_BONUS_XP : 0));

	// 1 in 25 catches also finds a stone matching the caught Pokémon's type.
	const rand = seededRandom(hashString(`${data.installedAt}|stone|${data.catches}`));
	let stone: StoneKind | null = null;
	if (rand() < STONE_CHANCE) {
		stone = stoneForTypes(d.species.types, rand);
		next.stones[stone] += 1;
	}

	return {
		data: next,
		decision: { kind: 'caught', draw: d, duplicate: !!prev, count: entry.count, xp, stone },
	};
}

/** Keeps a task's ledger entry attached to it across renames and archive moves. */
export function renamePath(data: PokedexData, oldPath: string, newPath: string): PokedexData {
	const entry = data.ledger[oldPath];
	if (!entry || data.ledger[newPath]) return data;
	const ledger = { ...data.ledger };
	delete ledger[oldPath];
	ledger[newPath] = entry;
	return { ...data, ledger };
}

// ---------- Phase 3 actions (from the UI) ----------

export function setPartner(data: PokedexData, dex: number): PokedexData {
	const key = String(dex);
	if (!data.caught[key]) return data;
	return { ...data, partner: dex, mons: { ...data.mons, [key]: data.mons[key] ?? newMon() } };
}

/** Cancelled evolution: asked again once the Pokémon is a level higher. */
export function declineEvolution(data: PokedexData, dex: number): PokedexData {
	const key = String(dex);
	const mon = data.mons[key];
	if (!mon) return data;
	return { ...data, mons: { ...data.mons, [key]: { ...mon, declinedAt: mon.level } } };
}

/**
 * Evolves `fromDex` into `toDex`. Both stay marked as caught (Sheikh, 2026-10-12).
 * The evolved form takes the higher of the two levels; the partner follows the evolution.
 * With `stone`, one stone of that kind is used; refused if none is held.
 */
export function evolve(
	data: PokedexData,
	fromDex: number,
	toDex: number,
	now: Date,
	stone?: StoneKind,
): PokedexData | null {
	const fromKey = String(fromDex);
	const toKey = String(toDex);
	const from = data.mons[fromKey];
	const target = speciesByDex(toDex);
	if (!from || !data.caught[fromKey] || target?.evolvesFrom !== fromDex) return null;
	if (stone && data.stones[stone] <= 0) return null;
	const at = now.toISOString();
	const prevTo = data.caught[toKey];
	const existing = data.mons[toKey];
	const carried: Mon = { level: from.level, xp: from.xp };
	const toMon = existing && existing.level > from.level ? { ...existing } : carried;
	delete toMon.declinedAt;
	const fromMon: Mon = { level: from.level, xp: from.xp };
	return {
		...data,
		caught: {
			...data.caught,
			[toKey]: prevTo ? { ...prevTo, count: prevTo.count + 1, lastAt: at } : { count: 1, firstAt: at, lastAt: at },
		},
		mons: { ...data.mons, [fromKey]: fromMon, [toKey]: toMon },
		partner: data.partner === fromDex ? toDex : data.partner,
		stones: stone ? { ...data.stones, [stone]: data.stones[stone] - 1 } : data.stones,
	};
}
