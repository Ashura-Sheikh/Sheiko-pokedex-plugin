// Browsing the Pokedex grid (1.3.0, issue #25; Sheikh's decisions 2026-10-15).
// Pure: takes the caught data and the toolbar's controls, returns which cells to show
// and in what order. No Obsidian, no DOM, and it never changes the data it's given.
//
// The one rule that matters most: nothing shown, its order or its count may reveal
// anything about an unseen Pokémon (its name, types, rarity or anything else hidden).

import { GEN1 } from './data/gen1';
import type { Species, Tier } from './species';
import type { PokedexData } from './store';

/** All 151 (the default, Sheikh 2026-10-15), only caught, or only unseen. */
export type Scope = 'all' | 'caught' | 'uncaught';
export const SCOPES: readonly Scope[] = ['all', 'caught', 'uncaught'];

export interface BrowseControls {
	scope: Scope;
	/** Case-insensitive: part of a caught Pokémon's name, or a dex number (`25`, `025`, `#025`). */
	search: string;
	/** A type such as `fire`, or null for Any. */
	type: string | null;
	/** A rarity tier, or null for Any. */
	tier: Tier | null;
}

export function defaultControls(): BrowseControls {
	return { scope: 'all', search: '', type: null, tier: null };
}

/** Every type in the Gen 1 data, sorted. Listing them reveals nothing about which are caught. */
export function allTypes(all: readonly Species[] = GEN1): string[] {
	return [...new Set(all.flatMap((p) => p.types))].sort();
}

/** A dex number typed as `25`, `025` or `#025` (1-3 digits); null for anything else. */
export function parseDexQuery(q: string): number | null {
	const m = /^#?(\d{1,3})$/.exec(q.trim());
	if (!m) return null;
	const n = Number(m[1]);
	return n >= 1 ? n : null;
}

export interface BrowseCell {
	dex: number;
	seen: boolean;
}

/**
 * `nothing-caught`: Caught view with no Pokémon caught yet (offer "Show all Pokémon").
 * `no-results`: nothing matches the controls (offer "Clear filters").
 */
export type BrowseState = 'ok' | 'nothing-caught' | 'no-results';

export interface BrowseResult {
	cells: BrowseCell[];
	state: BrowseState;
}

export type BrowseData = Pick<PokedexData, 'caught' | 'mons'>;

export function browse(data: BrowseData, c: BrowseControls, all: readonly Species[] = GEN1): BrowseResult {
	const isCaught = (dex: number) => Object.prototype.hasOwnProperty.call(data.caught, String(dex));
	const query = c.search.trim().toLowerCase();
	const dexQuery = parseDexQuery(query);
	// Sheikh, 2026-10-15: with a type or rarity filter on, unseen cards are hidden in every
	// scope, number search included (project-manager: otherwise "Fire + 4" reveals #004's type).
	const filtering = c.type !== null || c.tier !== null;
	const cells: BrowseCell[] = [];
	for (const p of all) {
		const seen = isCaught(p.dex);
		if (c.scope === 'caught' && !seen) continue;
		if (c.scope === 'uncaught' && seen) continue;
		if (filtering) {
			if (!seen) continue;
			if (c.type !== null && !p.types.includes(c.type)) continue;
			if (c.tier !== null && p.tier !== c.tier) continue;
		}
		if (query) {
			if (dexQuery !== null) {
				// A number is already shown on every card, so it may match an unseen one.
				if (p.dex !== dexQuery) continue;
			} else if (!seen || !p.name.toLowerCase().includes(query)) {
				// Names are searched on caught Pokémon only; unseen cards are hidden.
				continue;
			}
		}
		cells.push({ dex: p.dex, seen });
	}
	const anyCaught = Object.keys(data.caught).length > 0;
	const state: BrowseState =
		c.scope === 'caught' && !anyCaught ? 'nothing-caught' : cells.length === 0 ? 'no-results' : 'ok';
	return { cells, state };
}
