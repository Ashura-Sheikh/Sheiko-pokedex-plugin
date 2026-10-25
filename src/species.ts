// Shape of one bundled species entry (see src/data/pokedex.ts, generated).

export type Tier = 'common' | 'uncommon' | 'rare' | 'legendary';
export const TIERS: readonly Tier[] = ['common', 'uncommon', 'rare', 'legendary'];

/**
 * The 5 Gen 1 stones plus a Trade Stone for plain trade evolutions (Sheikh, 2026-10-12),
 * and the Sun Stone from Gen 2 (2.0.0, #44).
 */
export type StoneKind = 'fire' | 'water' | 'thunder' | 'leaf' | 'moon' | 'trade' | 'sun';
export const STONE_KINDS: readonly StoneKind[] = ['fire', 'water', 'thunder', 'leaf', 'moon', 'trade', 'sun'];
/** The Gen each stone arrives with. Only stones of unlocked Gens can be found or shown. */
export const STONE_GEN: Record<StoneKind, number> = { fire: 1, water: 1, thunder: 1, leaf: 1, moon: 1, trade: 1, sun: 2 };

/**
 * Trade Items (2.0.0, #44; Sheikh, 2026-10-25): the items held for a trade evolution, plus themed
 * items standing in for the evolution methods a task plugin can't model (friendship, and the rest).
 */
export type TradeItemKind = 'kings-rock' | 'metal-coat' | 'dragon-scale' | 'up-grade' | 'friendship' | 'general';
export const TRADE_ITEM_KINDS: readonly TradeItemKind[] = ['kings-rock', 'metal-coat', 'dragon-scale', 'up-grade', 'friendship', 'general'];
/** The Gen each Trade Item arrives with. Only items of unlocked Gens can drop (Sheikh's Q1 (b)). */
export const TRADE_ITEM_GEN: Record<TradeItemKind, number> = {
	'kings-rock': 2,
	'metal-coat': 2,
	'dragon-scale': 2,
	'up-grade': 2,
	friendship: 2,
	general: 2,
};

export interface Evolution {
	trigger: 'level' | 'trade' | 'item' | 'other';
	minLevel: number | null;
	/** Set for stone evolutions and plain trade evolutions (the Trade Stone). */
	stone?: StoneKind;
	/** Set for trade-while-holding evolutions and the themed ones (2.0.0). */
	item?: TradeItemKind;
}

/** A level-up move. Level 1 means a starting move. Red/Blue for #1–151, X/Y for #152+. */
export interface Move {
	level: number;
	name: string;
	type: string;
}

export interface Species {
	dex: number;
	/** The generation it was introduced in (2.0.0). */
	gen: number;
	name: string;
	types: string[];
	tier: Tier;
	captureRate: number;
	evolvesFrom: number | null;
	evolution?: Evolution;
	/** Level-up moves, in learning order (Sheikh, 2026-10-12; X/Y for #152+, 2026-10-25). */
	moves: Move[];
}
