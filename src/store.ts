// Saved state and the reward decision. Pure: takes data in, returns new data out.
// The Pokedex never writes to task notes; everything lives in the plugin's own data.json.
//
// 0.2.0 (Sheikh, 2026-10-12): a catch comes every 4-7 counted closes (hidden target).
// Rarity uses the average score of the closes since the last catch, plus a daily
// boost for how many closes were counted today. At most 3 catches a day.
//
// 1.2.0 (Sheikh, 2026-10-15, issue #26): the daily limit stops catches, not partner growth.
// A close over the limit still gives the partner its normal XP, but no catch progress
// and no daily boost, and it never counts toward a catch later.
//
// 2.0.0 (Sheikh, 2026-10-25, #42): Gen 2, unlocked as you play; catches draw only from unlocked
// Gens; the Sun Stone; Trade Items dropped on partner level-ups and every 2–4 counted closes.

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
	MAX_LEVEL,
	Mon,
	START_LEVEL,
	STONE_CHANCE,
	Stones,
	TradeItems,
	addXp,
	newMon,
	noStones,
	noTradeItems,
	speciesByDex,
	stoneForTypes,
	xpForClose,
} from './progression';
import {
	CLOSE_ITEM_CHANCE,
	ITEM_TARGET_MAX,
	ITEM_TARGET_MIN,
	LEVEL_UP_ITEM_CHANCE,
	RELEASED_GEN,
	UnlockBase,
	baseNow,
	inferEvolutions,
	speciesUpTo,
	tradeItemForPartner,
	unlockProgress,
} from './gens';
import { STONE_KINDS, StoneKind, TRADE_ITEM_KINDS, TradeItemKind } from './species';
import { AnimMode, parseAnimMode } from './partner-anim';

export interface Settings {
	/** Catches per day. Closes after the limit is reached earn nothing and never pay out later. */
	dailyCap: number;
	showRewardWindow: boolean;
	/**
	 * Unlimited test commands (give XP, stones, add a Pokémon). Development builds only (`npm run dev`):
	 * release builds don't contain the commands or this setting. Off by default.
	 */
	testTools: boolean;
	/** "context: type, type" per line. Parsed by parseContextTypes. */
	contextTypes: string;
	/** Bulk closes (Sheikh, 2026-10-12): closes beyond this many within the window get half credit. */
	bulkThreshold: number;
	bulkWindowMinutes: number;
	/** Evolution scene without flicker (also automatic when the system asks for reduced motion). */
	calmEvolution: boolean;
	/** Partner animation on the hero card (1.5.0, #31): Full / Calm / Off. Reduced motion gives Calm. */
	partnerAnimation: AnimMode;
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

/** The default before 1.4.0. Saved data from then with exactly this limit is asked to move (#39). */
export const OLD_DEFAULT_DAILY_CAP = 3;

export const DEFAULT_SETTINGS: Settings = {
	/** 5 since 1.4.0 (Sheikh, 2026-10-25, #39); was 3. */
	dailyCap: 5,
	showRewardWindow: true,
	testTools: false,
	contextTypes: DEFAULT_CONTEXT_TYPES,
	bulkThreshold: 50,
	bulkWindowMinutes: 6,
	calmEvolution: false,
	/** Calm on new installs and for existing users (Sheikh, 2026-10-25). */
	partnerAnimation: 'calm',
};

/** Credit a bulk close gets toward the next catch and the daily boost (option C, Sheikh 2026-10-12). */
export const BULK_CREDIT = 0.5;

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
	/** 'starter' when it came from the Starter pack, not from a close. Absent for real catches. */
	source?: 'starter';
}

/**
 * Starter pack (Sheikh, 2026-10-13, 0.9.0): once per install, never refilled.
 * `true` / a number above 0 means still available.
 */
export interface StarterPack {
	/** One of each stone, claimed once. */
	stones: boolean;
	/** One uncaught Pokémon of the user's choice, legendaries included. */
	pokemon: boolean;
	/** Uses of STARTER_XP left for the partner. */
	xpLeft: number;
}

export const STARTER_XP = 500;
export const STARTER_XP_USES = 3;

export function fullStarterPack(): StarterPack {
	return { stones: true, pokemon: true, xpLeft: STARTER_XP_USES };
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
	/** When recent closes were seen (ISO), kept only as long as the bulk window. */
	recentCloses: string[];
	/** What's left of the one-time Starter pack. */
	starter: StarterPack;
	/** The 1.4.0 "Move to 5 or Keep 3" question (#39). */
	capUpgrade: CapUpgrade;
	// ----- 2.0.0 (#42) -----
	/** Gens 1..unlockedGen can be caught, evolved into and found. */
	unlockedGen: number;
	/** The highest Gen whose unlock notice has been shown; a notice shows when unlockedGen is higher. */
	announcedGen: number;
	/** Counts at the last unlock (the unlock rule counts from here). */
	unlockBase: UnlockBase;
	/** Evolutions done (counted since 2.0.0; earlier ones worked out from the ledger on update). */
	evolutions: number;
	tradeItems: TradeItems;
	/** Counted closes toward the next 30% Trade Item roll, and the hidden 2–4 target. */
	itemProgress: { closes: number; target: number };
}

/** The hidden 2–4 close target for the next Trade Item roll. */
export function drawItemTarget(seed: string): number {
	const r = seededRandom(hashString(`item-target|${seed}`))();
	return ITEM_TARGET_MIN + Math.floor(r * (ITEM_TARGET_MAX - ITEM_TARGET_MIN + 1));
}

/**
 * 1.4.0 (#39): saved data from before 1.4.0 with a limit of exactly 3 is asked once.
 * 'new': not yet told (a notice shows on the next start); 'asked': told, the Settings box waits
 * for an answer; 'done': answered, or never needed.
 */
export type CapUpgrade = 'new' | 'asked' | 'done';
const CAP_UPGRADE_STATES: readonly CapUpgrade[] = ['new', 'asked', 'done'];

/** Answers the 1.4.0 question: sets the limit and stops asking. Returns new data. */
export function chooseDailyCap(data: PokedexData, cap: number): PokedexData {
	return { ...data, settings: { ...data.settings, dailyCap: Math.max(0, Math.floor(cap)) }, capUpgrade: 'done' };
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
		recentCloses: [],
		starter: fullStarterPack(),
		capUpgrade: 'done',
		unlockedGen: 1,
		announcedGen: 1,
		unlockBase: { catches: 0, levels: {}, evolutions: 0 },
		evolutions: 0,
		tradeItems: noTradeItems(),
		itemProgress: { closes: 0, target: drawItemTarget(`${installedAt}|0`) },
	};
}

/**
 * Reads the saved Starter pack. Missing (data from 0.8.0 or earlier) = a full pack, so upgraders get
 * it once. A saved pack is kept as saved, so reloads and setting changes never refill it.
 */
function normalizeStarter(raw: unknown): StarterPack {
	if (!isRecord(raw)) return fullStarterPack();
	const xp = typeof raw.xpLeft === 'number' && Number.isFinite(raw.xpLeft) ? Math.floor(raw.xpLeft) : 0;
	return {
		stones: raw.stones === true,
		pokemon: raw.pokemon === true,
		xpLeft: Math.min(STARTER_XP_USES, Math.max(0, xp)),
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
	// 1.5.0 (#31): missing (data from 1.4.0 or earlier) or unknown → Calm.
	settings.partnerAnimation = parseAnimMode(savedSettings.partnerAnimation);
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
		// Since 1.4.0 that default is 5, and these users aren't asked below (their saved value is 10).
		if (savedSettings.dailyCap === 10) settings.dailyCap = DEFAULT_SETTINGS.dailyCap;
	}

	// 1.4.0 (#39): data saved before 1.4.0 has no capUpgrade. A saved limit of exactly 3 (or none,
	// which meant 3 then) stays 3 and is asked once; any other saved limit is kept and not asked.
	let capUpgrade: CapUpgrade;
	if (raw.capUpgrade === undefined) {
		const saved = savedSettings.dailyCap;
		if (saved === undefined || saved === OLD_DEFAULT_DAILY_CAP) {
			settings.dailyCap = OLD_DEFAULT_DAILY_CAP;
			capUpgrade = 'new';
		} else {
			capUpgrade = 'done';
		}
	} else {
		capUpgrade = CAP_UPGRADE_STATES.includes(raw.capUpgrade as CapUpgrade) ? (raw.capUpgrade as CapUpgrade) : 'done';
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

	const recentCloses = Array.isArray(raw.recentCloses) ? raw.recentCloses.filter((t): t is string => typeof t === 'string') : [];

	const starter = normalizeStarter(raw.starter);

	// 2.0.0 (#42). Data from 1.x has none of this: it starts on Gen 1 with the unlock rule counted
	// from install (base 0), and evolutions worked out from the ledger. applyUnlock then unlocks
	// Gen 2 straight away for users who already meet the rule (Sheikh's decision).
	const pre2 = typeof raw.unlockedGen !== 'number';
	const unlockedGen = pre2 ? 1 : Math.max(1, Math.min(RELEASED_GEN, Math.floor(raw.unlockedGen as number)));
	const announcedGen =
		typeof raw.announcedGen === 'number' ? Math.max(1, Math.min(unlockedGen, Math.floor(raw.announcedGen))) : 1;
	const evolutions =
		!pre2 && typeof raw.evolutions === 'number' && raw.evolutions >= 0 ? Math.floor(raw.evolutions) : inferEvolutions(caught, ledger);
	const unlockBase = normalizeUnlockBase(pre2 ? undefined : raw.unlockBase);
	const tradeItems = noTradeItems();
	if (isRecord(raw.tradeItems)) {
		for (const k of TRADE_ITEM_KINDS) {
			const v = raw.tradeItems[k];
			if (typeof v === 'number' && v > 0) tradeItems[k] = Math.floor(v);
		}
	}
	const ip = isRecord(raw.itemProgress) ? raw.itemProgress : null;
	const itemProgress =
		ip && typeof ip.closes === 'number' && typeof ip.target === 'number'
			? { closes: ip.closes, target: ip.target }
			: { closes: 0, target: drawItemTarget(`${installedAt}|0`) };

	return applyUnlock({
		version: 3,
		installedAt,
		settings,
		ledger,
		caught,
		catches,
		progress,
		daily,
		mons,
		partner,
		stones,
		recentCloses,
		starter,
		capUpgrade,
		unlockedGen,
		announcedGen,
		unlockBase,
		evolutions,
		tradeItems,
		itemProgress,
	});
}

function normalizeUnlockBase(raw: unknown): UnlockBase {
	if (!isRecord(raw)) return { catches: 0, levels: {}, evolutions: 0 };
	const levels: Record<string, number> = {};
	if (isRecord(raw.levels)) for (const [k, v] of Object.entries(raw.levels)) if (typeof v === 'number') levels[k] = v;
	return {
		catches: typeof raw.catches === 'number' ? raw.catches : 0,
		levels,
		evolutions: typeof raw.evolutions === 'number' ? raw.evolutions : 0,
	};
}

/**
 * Unlocks the next Gen when the rule is met (3 catches and a Pokémon up 2+ levels, or any
 * evolution, since the last unlock), and takes a new base so the counts restart. One Gen at a
 * time. Returns the same object when nothing changes.
 */
export function applyUnlock(data: PokedexData): PokedexData {
	let next = data;
	for (;;) {
		const p = unlockProgress(next);
		if (!p.met || p.next === null) return next;
		next = { ...next, unlockedGen: p.next, unlockBase: baseNow(next) };
	}
}

/** True when a Gen has unlocked since the last notice. The caller shows it, then calls markAnnounced. */
export function unlockToAnnounce(data: PokedexData): number | null {
	return data.unlockedGen > data.announcedGen ? data.unlockedGen : null;
}

export function markAnnounced(data: PokedexData): PokedexData {
	return data.announcedGen === data.unlockedGen ? data : { ...data, announcedGen: data.unlockedGen };
}

/** Close counts can be halves since bulk closes get half credit: 3, 3.5. */
export function formatCount(n: number): string {
	return Number.isInteger(n) ? String(n) : n.toFixed(1);
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

/** `items`: Trade Items found by this close (2.0.0); only present when something dropped. */
export type Decision =
	| { kind: 'already' }
	| { kind: 'excluded'; reason: string }
	| { kind: 'capped'; cap: number; xp: XpGain | null; items?: TradeItemKind[] }
	| { kind: 'counted'; closes: number; xp: XpGain | null; bulk: boolean; items?: TradeItemKind[] }
	| {
			kind: 'caught';
			draw: Draw;
			duplicate: boolean;
			count: number;
			xp: XpGain | null;
			stone: StoneKind | null;
			bulk: boolean;
			items?: TradeItemKind[];
	  };

/**
 * Trade Item drops for one close (2.0.0, #44; Sheikh 2026-10-25). Mutates `next`.
 * - 20% for each level the partner gained from this close.
 * - `credit` > 0 (counted and catching closes only; Q2 (a): closes over the daily limit don't
 *   count): adds to the hidden 2–4 counter; when it fills, 30%, then a new target.
 * The item is the partner's type's (TYPE_TRADE_ITEM), and only if its Gen is unlocked.
 * No partner, or no item unlocked yet: nothing drops, and the counter doesn't move.
 */
function rollTradeItems(next: PokedexData, xp: XpGain | null, credit: number, seed: string): TradeItemKind[] {
	const partner = next.partner !== null ? speciesByDex(next.partner) : undefined;
	const item = partner ? tradeItemForPartner(partner.types, next.unlockedGen) : null;
	if (!item) return [];
	const rand = seededRandom(hashString(`${seed}|item`));
	const found: TradeItemKind[] = [];
	if (xp) for (let l = xp.fromLevel; l < xp.toLevel; l++) if (rand() < LEVEL_UP_ITEM_CHANCE) found.push(item);
	if (credit > 0) {
		const ip = { ...next.itemProgress, closes: next.itemProgress.closes + credit };
		if (ip.closes >= ip.target) {
			if (rand() < CLOSE_ITEM_CHANCE) found.push(item);
			ip.closes = 0;
			ip.target = drawItemTarget(seed);
		}
		next.itemProgress = ip;
	}
	if (found.length) {
		next.tradeItems = { ...next.tradeItems };
		for (const k of found) next.tradeItems[k] += 1;
	}
	return found;
}

function withItems<T extends object>(d: T, items: TradeItemKind[]): T & { items?: TradeItemKind[] } {
	return items.length ? { ...d, items } : d;
}

/**
 * Records this close's time and says whether it's a bulk close: more than `threshold`
 * closes (this one included) within the last `windowMinutes`. Every close the plugin
 * sees counts toward this, including excluded and capped ones, since it measures how
 * fast tasks are being closed. Mutates `next.recentCloses`.
 */
export function noteClose(next: PokedexData, now: Date): boolean {
	const windowMs = Math.max(0, next.settings.bulkWindowMinutes) * 60_000;
	const cutoff = now.getTime() - windowMs;
	const recent = next.recentCloses.filter((t) => {
		const ms = Date.parse(t);
		return Number.isFinite(ms) && ms > cutoff && ms <= now.getTime();
	});
	recent.push(now.toISOString());
	next.recentCloses = recent;
	return recent.length > Math.max(0, Math.floor(next.settings.bulkThreshold));
}

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
		recentCloses: [...data.recentCloses],
		tradeItems: { ...data.tradeItems },
		itemProgress: { ...data.itemProgress },
	};
	const bulk = noteClose(next, now);
	const itemSeed = `${data.installedAt}|${input.path}`;

	const reason = input.closeReason?.trim().toLowerCase() ?? '';
	if (EXCLUDED_CLOSE_REASONS.includes(reason)) {
		next.ledger[input.path] = { at, outcome: 'excluded' };
		return { data: next, decision: { kind: 'excluded', reason } };
	}

	const cap = Math.max(0, Math.floor(data.settings.dailyCap));
	if (next.daily.catches >= cap) {
		// Over the limit (1.2.0, #26): the partner still gets the normal close XP. Progress,
		// today's closes (the daily boost) and the batch are untouched. Bulk doesn't change XP.
		next.ledger[input.path] = { at, outcome: 'capped' };
		const xp = givePartnerXp(next, xpForClose(sizeMinutes(input, now)));
		const items = rollTradeItems(next, xp, 0, itemSeed);
		return { data: next, decision: withItems({ kind: 'capped' as const, cap, xp }, items) };
	}

	// Count the close toward the batch. A bulk close counts as half a close toward the
	// hidden target and the daily boost; it also weighs half in the batch average. XP is not affected.
	const credit = bulk ? BULK_CREDIT : 1;
	const sla = withinSla(input.priority, input.dateCreated, closeMoment(input.completedDate, now));
	next.progress.closes += credit;
	next.progress.scoreSum += score(input.priority, sla) * credit;
	for (const c of input.contexts) if (!next.progress.contexts.includes(c)) next.progress.contexts.push(c);
	next.daily.closes += credit;
	const closeXp = xpForClose(sizeMinutes(input, now));

	if (next.progress.closes < next.progress.target) {
		next.ledger[input.path] = { at, outcome: 'counted' };
		const xp = givePartnerXp(next, closeXp);
		const items = rollTradeItems(next, xp, credit, itemSeed);
		return { data: next, decision: withItems({ kind: 'counted' as const, closes: next.progress.closes, xp, bulk }, items) };
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
		speciesUpTo(data.unlockedGen), // 2.0.0: only unlocked Gens can be caught
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
		stone = stoneForTypes(d.species.types, rand, data.unlockedGen);
		next.stones[stone] += 1;
	}

	const items = rollTradeItems(next, xp, credit, itemSeed);
	return {
		data: next,
		decision: withItems({ kind: 'caught' as const, draw: d, duplicate: !!prev, count: entry.count, xp, stone, bulk }, items),
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

// ---------- Test tools: development builds only (src/dev-tools.ts), when settings.testTools is on ----------

/** Gives the partner XP directly, as if earned from closes. Null without a partner. */
export function testGivePartnerXp(data: PokedexData, amount: number): { data: PokedexData; xp: XpGain | null } {
	const next: PokedexData = { ...data, mons: { ...data.mons } };
	const xp = givePartnerXp(next, amount);
	return xp ? { data: next, xp } : { data, xp: null };
}

/** One of each stone and Trade Item, including locked ones (development builds only). */
export function testGiveEachStone(data: PokedexData): PokedexData {
	const stones = { ...data.stones };
	for (const k of STONE_KINDS) stones[k] += 1;
	const tradeItems = { ...data.tradeItems };
	for (const k of TRADE_ITEM_KINDS) tradeItems[k] += 1;
	return { ...data, stones, tradeItems };
}

/** Adds a Pokémon to the Pokedex without a close (no ledger, progress or daily change). */
export function testAddPokemon(data: PokedexData, dex: number, now: Date): PokedexData {
	if (!speciesByDex(dex)) return data;
	const key = String(dex);
	const at = now.toISOString();
	const prev = data.caught[key];
	return {
		...data,
		caught: { ...data.caught, [key]: prev ? { ...prev, count: prev.count + 1, lastAt: at } : { count: 1, firstAt: at, lastAt: at } },
		mons: { ...data.mons, [key]: data.mons[key] ?? newMon() },
	};
}

// ---------- Starter pack (Sheikh, 2026-10-13, 0.9.0): one-time per install ----------

/** Why a Starter pack gift was refused. A refusal never uses anything up. */
export type StarterRefusal = 'used' | 'no-partner' | 'max-level' | 'already-caught' | 'unknown';

export type StarterResult = { ok: true; data: PokedexData; xp?: XpGain } | { ok: false; reason: StarterRefusal };

/** What's left, for settings: "stones · 1 Pokémon · XP 2 of 3", or "nothing, all used". */
export function starterSummary(p: StarterPack): string {
	const parts: string[] = [];
	if (p.stones) parts.push('stones');
	if (p.pokemon) parts.push('1 Pokémon');
	if (p.xpLeft > 0) parts.push(`XP ${p.xpLeft} of ${STARTER_XP_USES}`);
	return parts.length ? parts.join(' · ') : 'nothing, all used';
}

/**
 * The XP gift's confirmation (0.9.1). 0.9.0 said "Uses 1 of your 3 remaining (out of 3)", repeating
 * itself when none were used. Now: "Uses 1 of the 3 you have left…", or "This is your last one…".
 */
export function starterXpConfirmText(left: number): string {
	const which = left <= 1 ? 'This is your last one.' : `Uses 1 of the ${left} you have left.`;
	return `${which} Each can only be used once. Use it now?`;
}

/** Dex numbers the Starter pack can add: every Gen 1 species not caught yet (unchanged in 2.0.0). */
export function starterChoices(data: PokedexData): number[] {
	const out: number[] = [];
	for (const s of speciesUpTo(1)) if (!data.caught[String(s.dex)]) out.push(s.dex);
	return out;
}

/** The Starter pack's stones: the original 6, never the later ones (Sheikh, 2026-10-25). */
export const STARTER_STONES: readonly StoneKind[] = ['fire', 'water', 'thunder', 'leaf', 'moon', 'trade'];

/** One of each stone, once. */
export function claimStarterStones(data: PokedexData): StarterResult {
	if (!data.starter.stones) return { ok: false, reason: 'used' };
	const stones = { ...data.stones };
	for (const k of STARTER_STONES) stones[k] += 1;
	return { ok: true, data: { ...data, stones, starter: { ...data.starter, stones: false } } };
}

/**
 * One uncaught Pokémon, once. It joins the Pokedex at level 5, marked `source: 'starter'`.
 * Not a close and not a catch: no ledger, progress, daily or catch-total change.
 */
export function claimStarterPokemon(data: PokedexData, dex: number, now: Date): StarterResult {
	if (!data.starter.pokemon) return { ok: false, reason: 'used' };
	if (speciesByDex(dex)?.gen !== 1) return { ok: false, reason: 'unknown' };
	const key = String(dex);
	if (data.caught[key]) return { ok: false, reason: 'already-caught' };
	const at = now.toISOString();
	return {
		ok: true,
		data: {
			...data,
			caught: { ...data.caught, [key]: { count: 1, firstAt: at, lastAt: at, source: 'starter' } },
			mons: { ...data.mons, [key]: data.mons[key] ?? newMon() },
			starter: { ...data.starter, pokemon: false },
		},
	};
}

/**
 * STARTER_XP for the current partner, one use of STARTER_XP_USES. Refused, with nothing used up,
 * when there's no partner or the partner is already at the top level (the XP would be lost).
 */
export function useStarterXp(data: PokedexData): StarterResult {
	if (data.starter.xpLeft <= 0) return { ok: false, reason: 'used' };
	if (data.partner === null) return { ok: false, reason: 'no-partner' };
	const level = data.mons[String(data.partner)]?.level ?? START_LEVEL;
	if (level >= MAX_LEVEL) return { ok: false, reason: 'max-level' };
	const next: PokedexData = { ...data, mons: { ...data.mons } };
	const xp = givePartnerXp(next, STARTER_XP);
	if (!xp) return { ok: false, reason: 'no-partner' };
	return { ok: true, data: { ...next, starter: { ...data.starter, xpLeft: data.starter.xpLeft - 1 } }, xp };
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
 * With `stone` (or a Trade Item, 2.0.0), one of that kind is used; refused if none is held.
 * 2.0.0: refused when `toDex` is in a locked Gen (Sheikh's Q1 (b)); each evolution is counted.
 */
export function evolve(
	data: PokedexData,
	fromDex: number,
	toDex: number,
	now: Date,
	stone?: StoneKind,
	item?: TradeItemKind,
): PokedexData | null {
	const fromKey = String(fromDex);
	const toKey = String(toDex);
	const from = data.mons[fromKey];
	const target = speciesByDex(toDex);
	if (!from || !data.caught[fromKey] || target?.evolvesFrom !== fromDex) return null;
	if (target.gen > data.unlockedGen) return null;
	if (stone && data.stones[stone] <= 0) return null;
	if (item && data.tradeItems[item] <= 0) return null;
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
		tradeItems: item ? { ...data.tradeItems, [item]: data.tradeItems[item] - 1 } : data.tradeItems,
		evolutions: data.evolutions + 1,
	};
}
