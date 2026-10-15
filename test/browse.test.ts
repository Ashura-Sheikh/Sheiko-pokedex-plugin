// Pokedex toolbar (1.3.0, issue #25; Sheikh's decisions 2026-10-15). The pure browse()
// decides which cells show and in what order; these tests pin the no-leak rule.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrowseControls, BrowseData, SORT_KEYS, SortKey, allTypes, browse, defaultControls, parseDexQuery } from '../src/browse';
import { GEN1 } from '../src/data/gen1';
import { TIERS } from '../src/species';

const AT = '2026-10-15T12:00:00.000Z';

/** Caught data for the given dex numbers. */
function caught(dexes: number[]): BrowseData {
	const data: BrowseData = { caught: {}, mons: {} };
	for (const d of dexes) {
		data.caught[String(d)] = { count: 1, firstAt: AT, lastAt: AT };
		data.mons[String(d)] = { level: 5, xp: 0 };
	}
	return data;
}

const controls = (extra: Partial<BrowseControls> = {}): BrowseControls => ({ ...defaultControls(), ...extra });
const dexes = (r: ReturnType<typeof browse>) => r.cells.map((c) => c.dex);

// ---------- #32: scope ----------

test('defaults: scope All (Sheikh, 2026-10-15), all 151 in Pokédex order', () => {
	assert.deepEqual(defaultControls(), { scope: 'all', search: '', type: null, tier: null, sort: 'number' });
	const r = browse(caught([4, 25]), defaultControls());
	assert.equal(r.cells.length, GEN1.length);
	assert.deepEqual(dexes(r), GEN1.map((p) => p.dex));
	assert.deepEqual(r.cells.filter((c) => c.seen).map((c) => c.dex), [4, 25]);
	assert.equal(r.state, 'ok');
});

test('scope Caught shows only caught; Uncaught only unseen', () => {
	const data = caught([4, 25, 150]);
	assert.deepEqual(dexes(browse(data, controls({ scope: 'caught' }))), [4, 25, 150]);
	const unseen = browse(data, controls({ scope: 'uncaught' }));
	assert.equal(unseen.cells.length, GEN1.length - 3);
	assert.ok(unseen.cells.every((c) => !c.seen));
});

test('Caught with nothing caught yet: the nothing-caught state', () => {
	const r = browse(caught([]), controls({ scope: 'caught' }));
	assert.deepEqual(r, { cells: [], state: 'nothing-caught' });
	assert.equal(browse(caught([]), defaultControls()).state, 'ok', 'All still shows 151 unseen');
});

test('Uncaught with everything caught: no-results', () => {
	const r = browse(caught(GEN1.map((p) => p.dex)), controls({ scope: 'uncaught' }));
	assert.deepEqual(r, { cells: [], state: 'no-results' });
});

test('browse never changes the data it is given', () => {
	const data = caught([4, 25]);
	const before = JSON.stringify(data);
	for (const scope of ['all', 'caught', 'uncaught'] as const) browse(data, controls({ scope }));
	assert.equal(JSON.stringify(data), before);
});

// ---------- #27: search ----------

test('dex numbers: 25, 025 and #025; anything else is not a number', () => {
	for (const q of ['25', '025', '#025', ' #25 ']) assert.equal(parseDexQuery(q), 25, q);
	for (const q of ['', '#', '0', '1000', 'char', '25a', '2 5']) assert.equal(parseDexQuery(q), null, q);
});

test('name search: case-insensitive, partial, caught only', () => {
	const data = caught([4, 5, 25]); // Charmander, Charmeleon, Pikachu (Charizard #6 unseen)
	assert.deepEqual(dexes(browse(data, controls({ search: 'CHAR' }))), [4, 5]);
	assert.deepEqual(dexes(browse(data, controls({ search: 'meleon' }))), [5]);
});

test('a name search never shows an unseen Pokémon, in any scope', () => {
	const data = caught([4]);
	for (const scope of ['all', 'caught', 'uncaught'] as const) {
		// "zard" only matches Charizard, which is unseen: nothing, not a ??? card.
		const r = browse(data, controls({ scope, search: 'zard' }));
		assert.deepEqual(r, { cells: [], state: 'no-results' }, scope);
	}
	// Every unseen name: none ever matches.
	const none = caught([]);
	for (const p of GEN1) assert.equal(browse(none, controls({ search: p.name })).cells.length, 0, p.name);
});

test('number search finds caught and unseen cards alike (numbers are already shown)', () => {
	const data = caught([25]);
	assert.deepEqual(browse(data, controls({ search: '#025' })).cells, [{ dex: 25, seen: true }]);
	assert.deepEqual(browse(data, controls({ search: '6' })).cells, [{ dex: 6, seen: false }]);
	assert.deepEqual(browse(data, controls({ scope: 'caught', search: '6' })).cells, []);
	assert.deepEqual(browse(data, controls({ search: '152' })).cells, [], 'no #152 in Gen 1');
});

// ---------- #28: type and rarity filters ----------

test('type and rarity filter caught Pokémon, together with each other and with search', () => {
	const data = caught([4, 6, 7, 25, 146]); // Charmander, Charizard, Squirtle, Pikachu, Moltres
	assert.deepEqual(dexes(browse(data, controls({ type: 'fire' }))), [4, 6, 146]);
	assert.deepEqual(dexes(browse(data, controls({ tier: 'legendary' }))), [146]);
	assert.deepEqual(dexes(browse(data, controls({ type: 'fire', tier: 'legendary' }))), [146]);
	assert.deepEqual(dexes(browse(data, controls({ type: 'fire', search: 'char' }))), [4, 6]);
	assert.deepEqual(dexes(browse(data, controls({ type: 'flying' }))), [6, 146], 'second types count');
});

test('with any filter on, no unseen card shows, in any scope, even for a number search', () => {
	const data = caught([4]);
	for (const scope of ['all', 'caught', 'uncaught'] as const) {
		for (const f of [{ type: 'fire' }, { tier: 'common' as const }]) {
			const r = browse(data, controls({ scope, ...f }));
			assert.ok(r.cells.every((c) => c.seen), `${scope} ${JSON.stringify(f)}`);
		}
	}
	// "Fire + 6": #006 Charizard is unseen; showing its ??? card would reveal it's Fire.
	assert.deepEqual(browse(data, controls({ type: 'fire', search: '6' })).cells, []);
	assert.deepEqual(browse(data, controls({ type: 'water', search: '6' })).cells, []);
	assert.equal(browse(data, controls({ scope: 'uncaught', type: 'fire' })).state, 'no-results');
});

test('filter results depend only on caught Pokémon: the same for any set of unseen ones', () => {
	// Two Pokédexes with the same caught Pokémon give identical results for every filter.
	const a = caught([4, 25]);
	for (const type of allTypes()) {
		for (const tier of [null, ...TIERS]) {
			const r = browse(a, controls({ type, tier }));
			const expected = [4, 25].filter((d) => {
				const p = GEN1[d - 1]!;
				return p.types.includes(type) && (tier === null || p.tier === tier);
			});
			assert.deepEqual(dexes(r), expected, `${type} ${tier}`);
		}
	}
});

// ---------- #29: sort ----------

/** Charmander Lv 20 ×1 (added 10-01), Pikachu Lv 9 ×3 (10-03), Abra Lv 20 ×2 (10-02). */
function sortData(): BrowseData {
	const data = caught([4, 25, 63]);
	data.mons['4'] = { level: 20, xp: 0 };
	data.mons['25'] = { level: 9, xp: 0 };
	data.mons['63'] = { level: 20, xp: 0 };
	data.caught['4'] = { count: 1, firstAt: '2026-10-01T09:00:00.000Z', lastAt: AT };
	data.caught['25'] = { count: 3, firstAt: '2026-10-03T09:00:00.000Z', lastAt: AT };
	data.caught['63'] = { count: 2, firstAt: '2026-10-02T09:00:00.000Z', lastAt: AT };
	return data;
}

test('each sort orders caught Pokémon; ties fall back to Pokédex number', () => {
	const data = sortData();
	const order = (sort: SortKey) => dexes(browse(data, controls({ scope: 'caught', sort })));
	assert.deepEqual(order('number'), [4, 25, 63]);
	assert.deepEqual(order('name'), [63, 4, 25], 'Abra, Charmander, Pikachu');
	assert.deepEqual(order('level'), [4, 63, 25], 'highest first; Lv 20 tie → #004 before #063');
	assert.deepEqual(order('catches'), [25, 63, 4], 'most first');
	assert.deepEqual(order('newest'), [25, 63, 4]);
	assert.deepEqual(order('oldest'), [4, 63, 25]);
});

test('option (a): in All, caught come first in the chosen order, then unseen in dex order', () => {
	const data = sortData();
	const unseenInOrder = GEN1.map((p) => p.dex).filter((d) => ![4, 25, 63].includes(d));
	for (const sort of SORT_KEYS) {
		const r = browse(data, controls({ sort }));
		assert.equal(r.cells.length, GEN1.length, sort);
		if (sort === 'number') {
			assert.deepEqual(dexes(r), GEN1.map((p) => p.dex));
			continue;
		}
		assert.deepEqual(dexes(r).slice(3), unseenInOrder, `${sort}: unseen in dex order, after the caught`);
		assert.ok(r.cells.slice(0, 3).every((c) => c.seen));
	}
});

test('unseen positions never depend on hidden data, for any sort or scope', () => {
	// The same caught Pokémon, so the unseen cards must land in identical positions,
	// whatever the sort: nothing about them (names, levels, dates) can move them.
	const data = sortData();
	for (const scope of ['all', 'uncaught'] as const) {
		const base = browse(data, controls({ scope }));
		const baseUnseen = base.cells.filter((c) => !c.seen).map((c) => c.dex);
		for (const sort of SORT_KEYS) {
			const r = browse(data, controls({ scope, sort }));
			assert.deepEqual(r.cells.filter((c) => !c.seen).map((c) => c.dex), baseUnseen, `${scope} ${sort}`);
		}
	}
});

test('missing level or date: the starting level and the oldest date', () => {
	const data = caught([1, 2]);
	delete data.mons['2']; // no saved level: counts as the starting level (5)
	data.mons['1'] = { level: 6, xp: 0 };
	assert.deepEqual(dexes(browse(data, controls({ scope: 'caught', sort: 'level' }))), [1, 2]);
	data.caught['1'] = { count: 1, firstAt: 'not a date', lastAt: AT };
	assert.deepEqual(dexes(browse(data, controls({ scope: 'caught', sort: 'newest' }))), [2, 1]);
});

test('the type list is every Gen 1 type, sorted', () => {
	const types = allTypes();
	assert.deepEqual(types, [...types].sort());
	assert.ok(types.includes('fire') && types.includes('psychic'));
	for (const p of GEN1) for (const t of p.types) assert.ok(types.includes(t));
});
