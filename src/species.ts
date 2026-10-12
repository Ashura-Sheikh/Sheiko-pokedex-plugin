// Shape of one bundled Gen 1 entry (see src/data/gen1.ts, generated).

export type Tier = 'common' | 'uncommon' | 'rare' | 'legendary';
export const TIERS: readonly Tier[] = ['common', 'uncommon', 'rare', 'legendary'];

export interface Evolution {
	trigger: 'level' | 'trade' | 'item' | 'other';
	minLevel: number | null;
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
