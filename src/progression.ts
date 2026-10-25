// Phase 3 (Sheikh, 2026-10-12): partner Pokémon, per-Pokémon levels and XP,
// evolution (asked first, re-asked a level later if cancelled), and earned stones.
// Pure functions on plain data, no Obsidian imports.

import { SPECIES } from './data/pokedex';
import { stonesUpTo } from './gens';
import { Move, Species, StoneKind, TRADE_ITEM_KINDS, TradeItemKind } from './species';

export const START_LEVEL = 5;
export const MAX_LEVEL = 100;
export const BASE_CLOSE_XP = 10;
/** +1 XP per this many minutes of task size, up to MAX_SIZE_XP. */
export const SIZE_MINUTES_PER_XP = 30;
export const MAX_SIZE_XP = 40;
export const DUPLICATE_BONUS_XP = 50;
/** 1 in 25 of all catches (Sheikh, 2026-10-12): about one stone every 5 days at 5 catches a day (1.4.0 default). */
export const STONE_CHANCE = 1 / 25;

export interface Mon {
	level: number;
	/** XP into the current level. */
	xp: number;
	/** Level at which an evolution was last cancelled; asked again once the level is higher. */
	declinedAt?: number;
}

export type Stones = Record<StoneKind, number>;

export function noStones(): Stones {
	return { fire: 0, water: 0, thunder: 0, leaf: 0, moon: 0, trade: 0, sun: 0 };
}

/** Trade Items held (2.0.0, #44). */
export type TradeItems = Record<TradeItemKind, number>;

export function noTradeItems(): TradeItems {
	const out = {} as TradeItems;
	for (const k of TRADE_ITEM_KINDS) out[k] = 0;
	return out;
}

export function newMon(): Mon {
	return { level: START_LEVEL, xp: 0 };
}

/** XP needed to go from `level` to `level + 1`. */
export function xpToNext(level: number): number {
	return 10 * level;
}

/** XP for one counted close: 10, plus 1 per 30 minutes of task size, up to +40. */
export function xpForClose(sizeMinutes: number | null): number {
	if (sizeMinutes === null || !Number.isFinite(sizeMinutes) || sizeMinutes <= 0) return BASE_CLOSE_XP;
	return BASE_CLOSE_XP + Math.min(MAX_SIZE_XP, Math.floor(sizeMinutes / SIZE_MINUTES_PER_XP));
}

export interface XpResult {
	mon: Mon;
	fromLevel: number;
	toLevel: number;
}

export function addXp(mon: Mon, amount: number): XpResult {
	const next: Mon = { ...mon };
	const fromLevel = mon.level;
	next.xp += Math.max(0, Math.floor(amount));
	while (next.level < MAX_LEVEL && next.xp >= xpToNext(next.level)) {
		next.xp -= xpToNext(next.level);
		next.level += 1;
	}
	if (next.level >= MAX_LEVEL) next.xp = 0;
	return { mon: next, fromLevel, toLevel: next.level };
}

/** Any released species, locked or not. */
export function speciesByDex(dex: number): Species | undefined {
	return SPECIES[dex - 1];
}

/** The species that evolve directly from `dex`. */
export function evolutionsOf(dex: number, all: readonly Species[]): Species[] {
	return all.filter((s) => s.evolvesFrom === dex);
}

/** A level evolution this Pokémon can take now, unless it was cancelled at this level or later. */
export function readyLevelEvolution(dex: number, mon: Mon, all: readonly Species[]): Species | null {
	if (mon.declinedAt !== undefined && mon.level <= mon.declinedAt) return null;
	for (const s of evolutionsOf(dex, all)) {
		const e = s.evolution;
		if (e?.trigger === 'level' && e.minLevel !== null && mon.level >= e.minLevel) return s;
	}
	return null;
}

/** A level evolution the Pokémon has reached, even if it was cancelled ("Evolve now" after a Cancel). */
export function levelEvolutionAvailable(dex: number, mon: Mon, all: readonly Species[]): Species | null {
	return readyLevelEvolution(dex, { level: mon.level, xp: mon.xp }, all);
}

/**
 * Every evolution function takes `all`: the species of the unlocked Gens (2.0.0, Sheikh's Q1 (b)).
 * An evolution into a locked Gen isn't in `all`, so it's never offered, hinted or named.
 */

/** Stone and trade evolutions for `dex`, with whether a stone of that kind is held. */
export function stoneEvolutions(dex: number, stones: Stones, all: readonly Species[]): { to: Species; stone: StoneKind; have: boolean }[] {
	const out: { to: Species; stone: StoneKind; have: boolean }[] = [];
	for (const s of evolutionsOf(dex, all)) {
		const stone = s.evolution?.stone;
		if (stone) out.push({ to: s, stone, have: stones[stone] > 0 });
	}
	return out;
}

/** Trade Item evolutions for `dex` (2.0.0), with whether that item is held. */
export function tradeItemEvolutions(
	dex: number,
	items: TradeItems,
	all: readonly Species[],
): { to: Species; item: TradeItemKind; have: boolean }[] {
	const out: { to: Species; item: TradeItemKind; have: boolean }[] = [];
	for (const s of evolutionsOf(dex, all)) {
		const item = s.evolution?.item;
		if (item) out.push({ to: s, item, have: items[item] > 0 });
	}
	return out;
}

/**
 * One line for the partner card about what comes next for this Pokémon:
 * a level evolution (or that it's ready), stone/trade evolutions with stones held, or fully evolved.
 */
export function evolutionHint(dex: number, mon: Mon, stones: Stones, items: TradeItems, all: readonly Species[]): string {
	const parts: string[] = [];
	for (const s of evolutionsOf(dex, all)) {
		const e = s.evolution;
		if (e?.trigger === 'level' && e.minLevel !== null) {
			parts.push(
				mon.level >= e.minLevel
					? `Ready to evolve into ${s.name}`
					: `Evolves into ${s.name} at Lv ${e.minLevel}`,
			);
		} else if (e?.stone) {
			parts.push(`${STONE_LABELS[e.stone]} → ${s.name} (have ${stones[e.stone]})`);
		} else if (e?.item) {
			parts.push(`${TRADE_ITEM_LABELS[e.item]} → ${s.name} (have ${items[e.item]})`);
		}
	}
	return parts.length ? parts.join(' · ') : 'Fully evolved';
}

// ---------- Moves (Red/Blue level-up, Sheikh 2026-10-12) ----------

export const MOVE_SLOTS = 4;

/** The moves known at `level`: the last 4 learned, as in the games. */
export function currentMoves(species: Species, level: number): Move[] {
	const known = species.moves.filter((m) => m.level <= level);
	return known.slice(-MOVE_SLOTS);
}

/** The next move to learn after `level`, or null when there are none left. */
export function nextMove(species: Species, level: number): Move | null {
	return species.moves.find((m) => m.level > level) ?? null;
}

/** Moves learned on the way from `fromLevel` (exclusive) to `toLevel` (inclusive). */
export function movesLearned(species: Species, fromLevel: number, toLevel: number): Move[] {
	return species.moves.filter((m) => m.level > fromLevel && m.level <= toLevel);
}

/** " Learned Ember and Leer!" for moves a level-up reached, or "". Takes the partner's XP gain. */
export function learnedText(xp: { dex: number; fromLevel: number; toLevel: number } | null): string {
	if (!xp || xp.toLevel <= xp.fromLevel) return '';
	const s = speciesByDex(xp.dex);
	if (!s) return '';
	const names = movesLearned(s, xp.fromLevel, xp.toLevel).map((m) => m.name);
	if (!names.length) return '';
	const list = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]!}`;
	return ` Learned ${list}!`;
}

const TYPE_STONE: Record<string, StoneKind> = {
	fire: 'fire',
	water: 'water',
	ice: 'water',
	electric: 'thunder',
	grass: 'leaf',
	bug: 'leaf',
	fairy: 'moon',
	normal: 'moon',
	poison: 'moon',
	psychic: 'trade',
	fighting: 'trade',
	rock: 'trade',
	ground: 'trade',
	ghost: 'trade',
};

/**
 * Stone matching the caught Pokémon's type (primary first); otherwise a random kind of the
 * unlocked Gens. With Gen 2 unlocked, Grass finds a Leaf or a Sun Stone at random (2.0.0, #44).
 * Before that, the draw is exactly as in 1.x (no extra random number is taken).
 */
export function stoneForTypes(types: readonly string[], rand: () => number, unlockedGen = 1): StoneKind {
	for (const t of types) {
		const s = TYPE_STONE[t];
		if (s === 'leaf' && t === 'grass' && unlockedGen >= 2) return rand() < 0.5 ? 'leaf' : 'sun';
		if (s) return s;
	}
	const kinds = stonesUpTo(unlockedGen);
	return kinds[Math.floor(rand() * kinds.length)]!;
}

export const STONE_LABELS: Record<StoneKind, string> = {
	fire: 'Fire Stone',
	water: 'Water Stone',
	thunder: 'Thunder Stone',
	leaf: 'Leaf Stone',
	moon: 'Moon Stone',
	trade: 'Trade Stone',
	sun: 'Sun Stone',
};

/** What an evolution uses up (2.0.0): a stone or a Trade Item. */
export type EvolveUse = { stone: StoneKind } | { item: TradeItemKind };

export function useLabel(use: EvolveUse): string {
	return 'stone' in use ? STONE_LABELS[use.stone] : TRADE_ITEM_LABELS[use.item];
}

export const TRADE_ITEM_LABELS: Record<TradeItemKind, string> = {
	'kings-rock': "King's Rock",
	'metal-coat': 'Metal Coat',
	'dragon-scale': 'Dragon Scale',
	'up-grade': 'Up-Grade',
	friendship: 'Friendship Charm',
	general: 'Trade Item',
};
