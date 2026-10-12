import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GEN1 } from '../src/data/gen1';
import { TIERS } from '../src/species';

test('exactly 151 species, numbered 1..151 in order', () => {
	assert.equal(GEN1.length, 151);
	GEN1.forEach((p, i) => assert.equal(p.dex, i + 1));
});

test('every species has a name, 1-2 types and a known tier', () => {
	for (const p of GEN1) {
		assert.ok(p.name.length > 0);
		assert.ok(p.types.length >= 1 && p.types.length <= 2, p.name);
		assert.ok(TIERS.includes(p.tier), p.name);
	}
});

test('evolution links point inside Gen 1 and carry a trigger', () => {
	for (const p of GEN1) {
		if (p.evolvesFrom === null) {
			assert.equal(p.evolution, undefined, p.name);
			continue;
		}
		assert.ok(p.evolvesFrom >= 1 && p.evolvesFrom < p.dex, p.name);
		assert.ok(p.evolution, p.name);
	}
});

test('known facts hold (spot checks against the games)', () => {
	const by = (n: number) => GEN1[n - 1]!;
	assert.equal(by(25).name, 'Pikachu');
	assert.equal(by(25).evolvesFrom, null, 'Pichu is Gen 2, so the link is dropped');
	assert.deepEqual(by(64).evolution, { trigger: 'level', minLevel: 16 });
	assert.equal(by(65).evolution?.trigger, 'trade');
	assert.equal(by(26).evolution?.trigger, 'item');
	assert.deepEqual(
		GEN1.filter((p) => p.tier === 'legendary').map((p) => p.name),
		['Articuno', 'Zapdos', 'Moltres', 'Mewtwo', 'Mew'],
	);
	assert.ok(GEN1.every((p) => p.tier !== 'common' || p.captureRate > 120));
});

test('every tier has species to draw from', () => {
	for (const t of TIERS) assert.ok(GEN1.some((p) => p.tier === t), t);
});
