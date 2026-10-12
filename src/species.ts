// Shape of one bundled Gen 1 entry (see src/data/gen1.ts, generated).

export type Tier = 'common' | 'uncommon' | 'rare' | 'legendary';
export const TIERS: readonly Tier[] = ['common', 'uncommon', 'rare', 'legendary'];

/** The 5 Gen 1 stones plus a Trade Stone for trade evolutions (Sheikh, 2026-10-12). */
export type StoneKind = 'fire' | 'water' | 'thunder' | 'leaf' | 'moon' | 'trade';
export const STONE_KINDS: readonly StoneKind[] = ['fire', 'water', 'thunder', 'leaf', 'moon', 'trade'];

export interface Evolution {
	trigger: 'level' | 'trade' | 'item' | 'other';
	minLevel: number | null;
	/** Set for item and trade evolutions. */
	stone?: StoneKind;
}

export interface Species {
	dex: number;
	name: string;
	types: string[];
	tier: Tier;
	captureRate: number;
	evolvesFrom: number | null;
	evolution?: Evolution;
}
