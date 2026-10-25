// Browsing the Pokedex grid (1.3.0, issue #25; Sheikh's decisions 2026-10-15).
// Pure: takes the caught data and the toolbar's controls, returns which cells to show
// and in what order. No Obsidian, no DOM, and it never changes the data it's given.
//
// The one rule that matters most: nothing shown, its order or its count may reveal
// anything about an unseen Pokémon (its name, types, rarity or anything else hidden).
//
// 2.0.0 (#46): a Gen filter, and locked cards (a Gen not unlocked yet). A locked card is treated
// exactly like an unseen one in every rule here (project-manager's read, 2026-10-25).

import { ALL_SPECIES } from './gens';
import { START_LEVEL } from './progression';
import type { Species, Tier } from './species';
import type { PokedexData } from './store';

/** All (the default, Sheikh 2026-10-15), only caught, or only unseen (locked cards included). */
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
	/** A Gen such as 2, or null for All (2.0.0). */
	gen: number | null;
	sort: SortKey;
}

/**
 * Pokedex number, name (A-Z), level (highest first), number of catches (most first), and
 * date added to the Pokedex, newest or oldest first. "Date added" is `firstAt`, which is
 * also set by an evolution and by the Starter pack, so it isn't strictly the first catch.
 */
export type SortKey = 'number' | 'name' | 'level' | 'catches' | 'newest' | 'oldest';
export const SORT_KEYS: readonly SortKey[] = ['number', 'name', 'level', 'catches', 'newest', 'oldest'];

export function defaultControls(): BrowseControls {
	return { scope: 'all', search: '', type: null, tier: null, gen: null, sort: 'number' };
}

/** Every type in the data, sorted. Listing them reveals nothing about which are caught. */
export function allTypes(all: readonly Species[] = ALL_SPECIES): string[] {
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
	/** Caught, and in an unlocked Gen. */
	seen: boolean;
	/** In a Gen that isn't unlocked yet (drawn with a lock; otherwise exactly like unseen). */
	locked: boolean;
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

export type BrowseData = Pick<PokedexData, 'caught' | 'mons' | 'unlockedGen'>;

export function browse(data: BrowseData, c: BrowseControls, all: readonly Species[] = ALL_SPECIES): BrowseResult {
	const isCaught = (dex: number) => Object.prototype.hasOwnProperty.call(data.caught, String(dex));
	const query = c.search.trim().toLowerCase();
	const dexQuery = parseDexQuery(query);
	// Sheikh, 2026-10-15: with a type or rarity filter on, unseen cards are hidden in every
	// scope, number search included (project-manager: otherwise "Fire + 4" reveals #004's type).
	const filtering = c.type !== null || c.tier !== null;
	const cells: BrowseCell[] = [];
	for (const p of all) {
		const locked = p.gen > data.unlockedGen;
		const seen = !locked && isCaught(p.dex);
		if (c.gen !== null && p.gen !== c.gen) continue;
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
		cells.push({ dex: p.dex, seen, locked });
	}
	sortCells(cells, c.sort, data, all);
	const anyCaught = Object.keys(data.caught).length > 0;
	const state: BrowseState =
		c.scope === 'caught' && !anyCaught ? 'nothing-caught' : cells.length === 0 ? 'no-results' : 'ok';
	return { cells, state };
}

/**
 * Sheikh's option (a), 2026-10-15: by Pokedex number, everything stays in order. For any
 * other sort, caught Pokémon come first in that order, then unseen cards in dex order.
 * The unseen cards' positions depend only on how many are caught, so they reveal nothing.
 * Ties fall back to Pokedex number. Sorts `cells` in place.
 */
function sortCells(cells: BrowseCell[], sort: SortKey, data: BrowseData, all: readonly Species[]): void {
	if (sort === 'number') return; // already in dex order
	const name = (dex: number) => all.find((p) => p.dex === dex)?.name ?? '';
	const level = (dex: number) => data.mons[String(dex)]?.level ?? START_LEVEL;
	const count = (dex: number) => data.caught[String(dex)]?.count ?? 0;
	const added = (dex: number) => {
		const ms = Date.parse(data.caught[String(dex)]?.firstAt ?? '');
		return Number.isFinite(ms) ? ms : 0;
	};
	const byKey = (a: number, b: number): number => {
		switch (sort) {
			case 'name':
				return name(a).localeCompare(name(b));
			case 'level':
				return level(b) - level(a);
			case 'catches':
				return count(b) - count(a);
			case 'newest':
				return added(b) - added(a);
			case 'oldest':
				return added(a) - added(b);
			default:
				return 0;
		}
	};
	cells.sort((a, b) => {
		if (a.seen !== b.seen) return a.seen ? -1 : 1;
		if (!a.seen) return a.dex - b.dex;
		return byKey(a.dex, b.dex) || a.dex - b.dex;
	});
}
