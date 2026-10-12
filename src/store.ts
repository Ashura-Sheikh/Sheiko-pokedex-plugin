// Saved state and the reward decision. Pure: takes data in, returns new data out.
// The Pokédex never writes to task notes; everything lives in the plugin's own data.json.

import { ContextTypes, Draw, draw } from './rarity';

export interface Settings {
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
	dailyCap: 10,
	showRewardWindow: true,
	contextTypes: DEFAULT_CONTEXT_TYPES,
};

/** No reward for these, matching the SLA view's exclusion. */
export const EXCLUDED_CLOSE_REASONS = ['superseded', 'parked'];

export type Outcome = 'caught' | 'excluded' | 'capped';

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

export interface PokedexData {
	version: 1;
	installedAt: string;
	settings: Settings;
	/** One entry per task path that has ever been through a reward decision. Never paid twice. */
	ledger: Record<string, LedgerEntry>;
	caught: Record<string, CaughtEntry>;
	daily: { date: string; count: number };
}

export function freshData(now: Date): PokedexData {
	return {
		version: 1,
		installedAt: now.toISOString(),
		settings: { ...DEFAULT_SETTINGS },
		ledger: {},
		caught: {},
		daily: { date: localDate(now), count: 0 },
	};
}

/** Fills in anything missing from older or hand-edited data. */
export function normalizeData(raw: unknown, now: Date): PokedexData {
	const base = freshData(now);
	if (!raw || typeof raw !== 'object') return base;
	const r = raw as Partial<PokedexData>;
	return {
		version: 1,
		installedAt: typeof r.installedAt === 'string' ? r.installedAt : base.installedAt,
		settings: { ...DEFAULT_SETTINGS, ...(r.settings ?? {}) },
		ledger: r.ledger && typeof r.ledger === 'object' ? { ...r.ledger } : {},
		caught: r.caught && typeof r.caught === 'object' ? { ...r.caught } : {},
		daily:
			r.daily && typeof r.daily.date === 'string' && typeof r.daily.count === 'number'
				? { ...r.daily }
				: base.daily,
	};
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
}

export type Decision =
	| { kind: 'already' }
	| { kind: 'excluded'; reason: string }
	| { kind: 'capped'; cap: number }
	| { kind: 'caught'; draw: Draw; duplicate: boolean; count: number };

export function decide(
	input: CloseInput,
	data: PokedexData,
	map: ContextTypes,
	now: Date,
): { data: PokedexData; decision: Decision } {
	if (data.ledger[input.path]) return { data, decision: { kind: 'already' } };

	const at = now.toISOString();
	const next: PokedexData = {
		...data,
		ledger: { ...data.ledger },
		caught: { ...data.caught },
		daily: data.daily.date === localDate(now) ? { ...data.daily } : { date: localDate(now), count: 0 },
	};

	const reason = input.closeReason?.trim().toLowerCase() ?? '';
	if (EXCLUDED_CLOSE_REASONS.includes(reason)) {
		next.ledger[input.path] = { at, outcome: 'excluded' };
		return { data: next, decision: { kind: 'excluded', reason } };
	}

	const cap = Math.max(0, Math.floor(data.settings.dailyCap));
	if (next.daily.count >= cap) {
		next.ledger[input.path] = { at, outcome: 'capped' };
		return { data: next, decision: { kind: 'capped', cap } };
	}

	const d = draw(
		{
			seed: `${input.path}|${String(input.dateCreated)}`,
			priority: input.priority,
			contexts: input.contexts,
			created: input.dateCreated,
			completed: input.completedDate ?? at,
		},
		map,
	);
	const key = String(d.species.dex);
	const prev = next.caught[key];
	const entry: CaughtEntry = prev
		? { ...prev, count: prev.count + 1, lastAt: at }
		: { count: 1, firstAt: at, lastAt: at };
	next.caught[key] = entry;
	next.daily.count += 1;
	next.ledger[input.path] = { at, outcome: 'caught', dex: d.species.dex };
	return {
		data: next,
		decision: { kind: 'caught', draw: d, duplicate: !!prev, count: entry.count },
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
