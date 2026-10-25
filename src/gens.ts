// Generations (2.0.0, issue #42; Sheikh's decisions 2026-10-25, plan read by project-manager).
// Which Gens exist, which are unlocked, the unlock rule, and the Trade Item table.
// Pure: no Obsidian, no DOM.

import { SPECIES } from './data/pokedex';
import { Species, StoneKind, STONE_GEN, STONE_KINDS, TRADE_ITEM_GEN, TRADE_ITEM_KINDS, TradeItemKind } from './species';

/** The highest Gen in this release. Later Gens raise it, one per release. */
export const RELEASED_GEN = 2;

/** The dex range of each released Gen. */
export const GEN_RANGES: Record<number, { first: number; last: number }> = {
	1: { first: 1, last: 151 },
	2: { first: 152, last: 251 },
};

export function genOf(dex: number): number {
	for (const [g, r] of Object.entries(GEN_RANGES)) if (dex >= r.first && dex <= r.last) return Number(g);
	return 0;
}

const byGen = new Map<number, readonly Species[]>();
/** Every species of Gens 1..`gen`, in dex order. Cached. */
export function speciesUpTo(gen: number): readonly Species[] {
	const g = Math.max(1, Math.min(RELEASED_GEN, Math.floor(gen)));
	let list = byGen.get(g);
	if (!list) {
		list = SPECIES.filter((s) => s.gen <= g);
		byGen.set(g, list);
	}
	return list;
}

/** Every released species, locked or not (the Pokedex grid shows them all). */
export const ALL_SPECIES: readonly Species[] = SPECIES;

/** Stones that can be found or shown with Gens 1..`gen` unlocked. */
export function stonesUpTo(gen: number): StoneKind[] {
	return STONE_KINDS.filter((k) => STONE_GEN[k] <= gen);
}

/** Trade Items that can drop or be shown with Gens 1..`gen` unlocked (Sheikh's Q1 (b)). */
export function tradeItemsUpTo(gen: number): TradeItemKind[] {
	return TRADE_ITEM_KINDS.filter((k) => TRADE_ITEM_GEN[k] <= gen);
}

// ---------- Unlock rule (Sheikh 2026-10-25: same for every Gen; counts restart at each unlock) ----------

export const UNLOCK_CATCHES = 3;
export const UNLOCK_LEVELS = 2;
export const UNLOCK_EVOLUTIONS = 1;

/** Counts taken when the last Gen unlocked (or at install / the 2.0.0 update). */
export interface UnlockBase {
	catches: number;
	/** Each Pokémon's level at that moment. Missing = joined later, counted from level 5. */
	levels: Record<string, number>;
	evolutions: number;
}

export interface UnlockInput {
	unlockedGen: number;
	catches: number;
	evolutions: number;
	mons: Record<string, { level: number }>;
	unlockBase: UnlockBase;
}

export interface UnlockProgress {
	/** The Gen this progress is toward, or null when every released Gen is unlocked. */
	next: number | null;
	catches: number;
	/** The most levels any one Pokémon has gained since the last unlock. */
	levels: number;
	evolutions: number;
	met: boolean;
}

/** Level a Pokémon counts from when it isn't in the base (caught or evolved into later). */
const START = 5;

export function unlockProgress(d: UnlockInput): UnlockProgress {
	const next = d.unlockedGen < RELEASED_GEN ? d.unlockedGen + 1 : null;
	const catches = Math.max(0, d.catches - d.unlockBase.catches);
	let levels = 0;
	for (const [k, m] of Object.entries(d.mons)) {
		const from = d.unlockBase.levels[k] ?? START;
		levels = Math.max(levels, m.level - from);
	}
	const evolutions = Math.max(0, d.evolutions - d.unlockBase.evolutions);
	// (3 catches and a Pokémon up 2+ levels) or any evolution (Sheikh's (b): evolving unlocks early on its own).
	const met = next !== null && ((catches >= UNLOCK_CATCHES && levels >= UNLOCK_LEVELS) || evolutions >= UNLOCK_EVOLUTIONS);
	return { next, catches, levels, evolutions, met };
}

/** A new base from the current counts, taken at each unlock. */
export function baseNow(d: Pick<UnlockInput, 'catches' | 'evolutions' | 'mons'>): UnlockBase {
	const levels: Record<string, number> = {};
	for (const [k, m] of Object.entries(d.mons)) levels[k] = m.level;
	return { catches: d.catches, levels, evolutions: d.evolutions };
}

/**
 * Evolutions before 2.0.0 weren't recorded as events. Worked out from the ledger (project-manager's
 * read, 2026-10-25): a real catch writes one `caught` ledger entry with its dex; an evolution adds a
 * copy with no ledger entry. So copies beyond the recorded catches came from evolving, less 1 for a
 * Starter pick (its copy has no ledger entry either). Test commands in 0.7.2–0.8.0 also added copies
 * without a ledger entry; those read as evolutions. A wrong guess only unlocks Gen 2 early.
 */
export function inferEvolutions(
	caught: Record<string, { count: number; source?: string }>,
	ledger: Record<string, { outcome: string; dex?: number }>,
): number {
	const caughtByLedger = new Map<number, number>();
	for (const e of Object.values(ledger)) {
		if (e.outcome === 'caught' && typeof e.dex === 'number') caughtByLedger.set(e.dex, (caughtByLedger.get(e.dex) ?? 0) + 1);
	}
	let n = 0;
	for (const [k, c] of Object.entries(caught)) {
		const recorded = (caughtByLedger.get(Number(k)) ?? 0) + (c.source === 'starter' ? 1 : 0);
		n += Math.max(0, (typeof c.count === 'number' ? c.count : 0) - recorded);
	}
	return n;
}

// ---------- Trade Items: which one the partner's type finds (Sheikh's table, 2026-10-25) ----------

export const TYPE_TRADE_ITEM: Record<string, TradeItemKind> = {
	water: 'kings-rock',
	psychic: 'kings-rock',
	steel: 'metal-coat',
	bug: 'metal-coat',
	rock: 'metal-coat',
	ground: 'metal-coat',
	dragon: 'dragon-scale',
	ice: 'dragon-scale',
	electric: 'up-grade',
	normal: 'friendship',
	fairy: 'friendship',
	poison: 'friendship',
	flying: 'friendship',
	fighting: 'general',
	fire: 'general',
	grass: 'general',
	ghost: 'general',
	dark: 'general',
};

/** The Trade Item the partner's primary type finds, if that item's Gen is unlocked. */
export function tradeItemForPartner(types: readonly string[], unlockedGen: number): TradeItemKind | null {
	const item = TYPE_TRADE_ITEM[types[0] ?? 'normal'] ?? 'general';
	return TRADE_ITEM_GEN[item] <= unlockedGen ? item : null;
}

/** 20% on each partner level-up from a close (Sheikh, 2026-10-25). */
export const LEVEL_UP_ITEM_CHANCE = 0.2;
/** 30% each time the hidden 2–4 counted-close target fills. */
export const CLOSE_ITEM_CHANCE = 0.3;
export const ITEM_TARGET_MIN = 2;
export const ITEM_TARGET_MAX = 4;
