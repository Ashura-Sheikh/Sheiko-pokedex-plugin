// Pokedex toolbar (1.3.0, issue #25; Sheikh's decisions 2026-10-15). The pure browse()
// decides which cells show and in what order; these tests pin the no-leak rule.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrowseControls, BrowseData, browse, defaultControls, parseDexQuery } from '../src/browse';
import { GEN1 } from '../src/data/gen1';

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
	assert.deepEqual(defaultControls(), { scope: 'all', search: '' });
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
