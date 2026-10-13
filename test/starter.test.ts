// Starter pack (Sheikh, 2026-10-13, 0.9.0): one-time per install, never refilled.
// Plus: the unlimited test commands exist only in development builds (checked on a real production bundle).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MAX_LEVEL, START_LEVEL } from '../src/progression';
import {
	PokedexData,
	STARTER_XP,
	STARTER_XP_USES,
	claimStarterPokemon,
	claimStarterStones,
	freshData,
	fullStarterPack,
	normalizeData,
	setPartner,
	starterChoices,
	starterSummary,
	starterXpConfirmText,
	useStarterXp,
} from '../src/store';

const NOW = new Date('2026-10-13T12:00:00+01:00');

/** Saved and loaded again, as Obsidian would after a restart. */
function reload(data: PokedexData): PokedexData {
	return normalizeData(JSON.parse(JSON.stringify(data)), NOW);
}

function ok<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
	assert.equal(r.ok, true, JSON.stringify(r));
	return r as Extract<T, { ok: true }>;
}

/** Fresh data with Charmander caught and set as partner (via the Starter pack itself). */
function withPartner(): PokedexData {
	return setPartner(ok(claimStarterPokemon(freshData(NOW), 4, NOW)).data, 4);
}

// ---------- Loading ----------

test('a new install starts with a full Starter pack', () => {
	assert.deepEqual(freshData(NOW).starter, { stones: true, pokemon: true, xpLeft: STARTER_XP_USES });
});

test('data from 0.8.0 (no starter field) gets a full pack once', () => {
	const old = { version: 3, installedAt: '2026-10-12T10:00:00.000Z', caught: { '25': { count: 1, firstAt: 'x', lastAt: 'x' } } };
	assert.deepEqual(normalizeData(old, NOW).starter, fullStarterPack());
});

test('a saved pack is kept as saved: a reload never refills it', () => {
	let data = withPartner();
	data = ok(useStarterXp(data)).data;
	data = ok(claimStarterStones(data)).data;
	const again = reload(reload(data));
	assert.deepEqual(again.starter, { stones: false, pokemon: false, xpLeft: STARTER_XP_USES - 1 });
});

test('changing settings does not touch the pack', () => {
	const data = ok(claimStarterStones(freshData(NOW))).data;
	const changed = reload({ ...data, settings: { ...data.settings, testTools: true, dailyCap: 5 } });
	assert.equal(changed.starter.stones, false);
});

test('a damaged saved pack counts as used, never as a refill; XP uses are clamped', () => {
	assert.deepEqual(normalizeData({ version: 3, starter: {} }, NOW).starter, { stones: false, pokemon: false, xpLeft: 0 });
	assert.deepEqual(normalizeData({ version: 3, starter: { stones: 'yes', pokemon: 1, xpLeft: 'x' } }, NOW).starter, {
		stones: false,
		pokemon: false,
		xpLeft: 0,
	});
	assert.equal(normalizeData({ version: 3, starter: { xpLeft: 99 } }, NOW).starter.xpLeft, STARTER_XP_USES);
	assert.equal(normalizeData({ version: 3, starter: { xpLeft: -2 } }, NOW).starter.xpLeft, 0);
	assert.equal(normalizeData({ version: 3, starter: { xpLeft: 2.7 } }, NOW).starter.xpLeft, 2);
});

// ---------- Stones ----------

test('stones: one of each, once; the second use is refused and changes nothing', () => {
	const first = ok(claimStarterStones(freshData(NOW))).data;
	assert.deepEqual(Object.values(first.stones), [1, 1, 1, 1, 1, 1]);
	assert.equal(first.starter.stones, false);
	assert.deepEqual(claimStarterStones(first), { ok: false, reason: 'used' });
});

// ---------- Pokémon ----------

test('Pokémon: only uncaught species are offered, legendaries included', () => {
	const fresh = freshData(NOW);
	assert.equal(starterChoices(fresh).length, 151);
	assert.ok(starterChoices(fresh).includes(150), 'Mewtwo offered');
	const withPika = ok(claimStarterPokemon(fresh, 25, NOW)).data;
	assert.equal(starterChoices(withPika).length, 150);
	assert.ok(!starterChoices(withPika).includes(25));
});

test('Pokémon: joins at the start level, marked as from the Starter pack, and is not a close or a catch', () => {
	const before = freshData(NOW);
	const after = ok(claimStarterPokemon(before, 150, NOW)).data;
	assert.deepEqual(after.caught['150'], { count: 1, firstAt: NOW.toISOString(), lastAt: NOW.toISOString(), source: 'starter' });
	assert.equal(after.mons['150']?.level, START_LEVEL);
	assert.equal(after.starter.pokemon, false);
	assert.deepEqual(after.ledger, before.ledger);
	assert.deepEqual(after.progress, before.progress);
	assert.deepEqual(after.daily, before.daily);
	assert.equal(after.catches, before.catches);
});

test('Pokémon: the mark survives a reload; a second pick is refused', () => {
	const data = reload(ok(claimStarterPokemon(freshData(NOW), 1, NOW)).data);
	assert.equal(data.caught['1']?.source, 'starter');
	assert.deepEqual(claimStarterPokemon(data, 7, NOW), { ok: false, reason: 'used' });
});

test('Pokémon: an already-caught or unknown species is refused without using the pick', () => {
	const caught = setPartner(ok(claimStarterPokemon(freshData(NOW), 4, NOW)).data, 4);
	const fresh = { ...caught, starter: fullStarterPack() };
	assert.deepEqual(claimStarterPokemon(fresh, 4, NOW), { ok: false, reason: 'already-caught' });
	assert.deepEqual(claimStarterPokemon(fresh, 999, NOW), { ok: false, reason: 'unknown' });
	assert.equal(fresh.starter.pokemon, true);
});

// ---------- XP ----------

test('XP: three uses of 500, then refused', () => {
	let data = withPartner();
	for (let i = STARTER_XP_USES; i > 0; i--) {
		assert.equal(data.starter.xpLeft, i);
		const r = ok(useStarterXp(data));
		assert.equal(r.xp?.gained, STARTER_XP);
		data = r.data;
	}
	assert.equal(data.starter.xpLeft, 0);
	assert.deepEqual(useStarterXp(data), { ok: false, reason: 'used' });
	assert.ok(data.mons['4']!.level >= 16, `Charmander level ${data.mons['4']!.level}`);
});

test('XP: without a partner nothing is used up', () => {
	const data = freshData(NOW);
	assert.deepEqual(useStarterXp(data), { ok: false, reason: 'no-partner' });
	assert.equal(data.starter.xpLeft, STARTER_XP_USES);
});

test('XP: a partner at the top level is refused, so the XP is not lost', () => {
	const data = withPartner();
	const maxed = { ...data, mons: { ...data.mons, '4': { level: MAX_LEVEL, xp: 0 } } };
	assert.deepEqual(useStarterXp(maxed), { ok: false, reason: 'max-level' });
	assert.equal(maxed.starter.xpLeft, STARTER_XP_USES);
});

test('XP: uses can be split between partners', () => {
	let data = withPartner();
	data = ok(useStarterXp(data)).data;
	data = setPartner({ ...data, caught: { ...data.caught, '7': { count: 1, firstAt: 'x', lastAt: 'x' } }, mons: { ...data.mons, '7': { level: 5, xp: 0 } } }, 7);
	const r = ok(useStarterXp(data));
	assert.equal(r.xp?.dex, 7);
	assert.equal(r.data.starter.xpLeft, STARTER_XP_USES - 2);
});

test('XP confirmation says how many are left without repeating itself (0.9.1)', () => {
	assert.equal(starterXpConfirmText(3), 'Uses 1 of the 3 you have left. Each can only be used once. Use it now?');
	assert.equal(starterXpConfirmText(2), 'Uses 1 of the 2 you have left. Each can only be used once. Use it now?');
	assert.equal(starterXpConfirmText(1), 'This is your last one. Each can only be used once. Use it now?');
	for (const n of [1, 2, 3]) assert.ok(!/out of|remaining/.test(starterXpConfirmText(n)), 'old 0.9.0 wording gone');
});

test('settings summary lists what is left', () => {
	assert.equal(starterSummary(fullStarterPack()), 'stones · 1 Pokémon · XP 3 of 3');
	assert.equal(starterSummary({ stones: false, pokemon: true, xpLeft: 1 }), '1 Pokémon · XP 1 of 3');
	assert.equal(starterSummary({ stones: false, pokemon: false, xpLeft: 0 }), 'nothing, all used');
});

// ---------- Release builds ----------

test('the production bundle has the Starter pack and none of the unlimited test commands', () => {
	const root = new URL('..', import.meta.url).pathname; // test-dist/x.mjs → repo root
	const dir = mkdtempSync(path.join(tmpdir(), 'sheiko-pokedex-prod-'));
	const out = path.join(dir, 'main.js');
	try {
		execFileSync(process.execPath, ['esbuild.config.mjs', 'production'], {
			cwd: root,
			env: { ...process.env, SHEIKO_OUTFILE: out },
			stdio: 'pipe',
		});
		const js = readFileSync(out, 'utf8');
		for (const s of ['test-give-xp', 'test-give-stones', 'test-add-pokemon', 'Test: give', 'Test tools']) {
			assert.ok(!js.includes(s), `release build contains "${s}"`);
		}
		for (const s of ['starter-stones', 'starter-pokemon', 'starter-xp']) {
			assert.ok(js.includes(s), `release build is missing "${s}"`);
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
