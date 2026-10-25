import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPECIES } from '../src/data/pokedex';
import { speciesUpTo } from '../src/gens';
import { STONE_KINDS, TIERS, TRADE_ITEM_KINDS } from '../src/species';

const by = (n: number) => SPECIES[n - 1]!;
/** How an evolution is done, as one label: level, a stone, or a Trade Item. */
const how = (n: number) => {
	const e = by(n).evolution;
	return e?.item ? `item:${e.item}` : e?.stone ? `stone:${e.stone}` : e?.trigger;
};

test('251 species, numbered 1..251 in order: Gen 1 is 1-151, Gen 2 is 152-251 (2.0.0)', () => {
	assert.equal(SPECIES.length, 251);
	SPECIES.forEach((p, i) => assert.equal(p.dex, i + 1));
	assert.ok(SPECIES.every((p) => p.gen === (p.dex <= 151 ? 1 : 2)));
	assert.equal(speciesUpTo(1).length, 151);
	assert.equal(speciesUpTo(2).length, 251);
});

test('every species has a name, 1-2 types, a known tier and level-up moves', () => {
	for (const p of SPECIES) {
		assert.ok(p.name.length > 0);
		assert.ok(p.types.length >= 1 && p.types.length <= 2, p.name);
		assert.ok(TIERS.includes(p.tier), p.name);
		assert.ok(p.moves.length > 0, `${p.name}: no moves`);
	}
});

test('evolution links stay inside the data, carry a method, and name only known stones and items', () => {
	for (const p of SPECIES) {
		if (p.evolvesFrom === null) {
			assert.equal(p.evolution, undefined, p.name);
			continue;
		}
		assert.ok(p.evolvesFrom >= 1 && p.evolvesFrom <= 251 && p.evolvesFrom !== p.dex, p.name);
		const e = p.evolution;
		assert.ok(e, p.name);
		if (e.stone) assert.ok(STONE_KINDS.includes(e.stone), `${p.name}: ${e.stone}`);
		if (e.item) assert.ok(TRADE_ITEM_KINDS.includes(e.item), `${p.name}: ${e.item}`);
		assert.ok(!(e.stone && e.item), `${p.name}: a stone or an item, not both`);
		if (e.trigger === 'level') assert.ok(e.minLevel !== null, p.name);
		else assert.ok(e.stone || e.item, `${p.name}: a non-level evolution names what it uses`);
	}
});

test("Gen 1's own 72 evolutions are unchanged: 52 by level, 16 by stone, 4 by Trade Stone", () => {
	// The same split as the shipped 1.5.0 gen1.ts (checked against it when 2.0.0 was built).
	const c: Record<string, number> = {};
	for (const p of speciesUpTo(1)) if (p.evolvesFrom !== null && p.evolvesFrom <= 151) c[how(p.dex)!] = (c[how(p.dex)!] ?? 0) + 1;
	assert.deepEqual(c, {
		level: 52,
		'stone:fire': 3,
		'stone:water': 4,
		'stone:thunder': 2,
		'stone:leaf': 3,
		'stone:moon': 4,
		'stone:trade': 4,
	});
});

test("Gen 2's 50 evolutions (project-manager's gate check): 31 level, 8 Friendship, 3 general, 2 Sun Stone, 6 named items", () => {
	const c: Record<string, number> = {};
	for (const p of SPECIES) {
		if (p.evolvesFrom === null || Math.max(p.dex, p.evolvesFrom) <= 151) continue;
		c[how(p.dex)!] = (c[how(p.dex)!] ?? 0) + 1;
	}
	assert.deepEqual(c, {
		level: 31,
		'item:friendship': 8,
		'item:general': 3,
		'stone:sun': 2,
		'item:kings-rock': 2,
		'item:metal-coat': 2,
		'item:dragon-scale': 1,
		'item:up-grade': 1,
	});
});

test('the 8 Gen 1 Pokémon that gain a Gen 2 baby form, and the 10 that gain a Gen 2 evolution', () => {
	const babies = speciesUpTo(1).filter((p) => p.evolvesFrom !== null && p.evolvesFrom > 151).map((p) => p.name);
	assert.deepEqual(babies, ['Pikachu', 'Clefairy', 'Jigglypuff', 'Hitmonlee', 'Hitmonchan', 'Jynx', 'Electabuzz', 'Magmar']);
	const grows = [...new Set(SPECIES.filter((p) => p.gen === 2 && p.evolvesFrom !== null && p.evolvesFrom <= 151).map((p) => by(p.evolvesFrom!).name))];
	assert.deepEqual(grows.sort(), ['Chansey', 'Eevee', 'Gloom', 'Golbat', 'Onix', 'Poliwhirl', 'Porygon', 'Scyther', 'Seadra', 'Slowpoke']);
});

test('known facts hold (spot checks against the games)', () => {
	assert.equal(by(25).name, 'Pikachu');
	assert.equal(by(25).evolvesFrom, 172, 'Pichu, from Gen 2');
	assert.equal(how(25), 'item:friendship');
	assert.deepEqual(by(5).evolution, { trigger: 'level', minLevel: 16 });
	assert.equal(how(65), 'stone:trade', 'Alakazam: a plain trade');
	assert.equal(how(26), 'stone:thunder');
	assert.equal(how(169), 'item:friendship', 'Crobat');
	assert.equal(how(182), 'stone:sun', 'Bellossom');
	assert.equal(how(208), 'item:metal-coat', 'Steelix');
	assert.equal(how(237), 'item:general', 'Hitmontop: Attack = Defense, a real condition');
	assert.equal(how(186), 'item:kings-rock', 'Politoed');
	assert.equal(how(153), 'level', 'Bayleef');
	assert.deepEqual(
		SPECIES.filter((p) => p.tier === 'legendary').map((p) => p.name),
		['Articuno', 'Zapdos', 'Moltres', 'Mewtwo', 'Mew', 'Raikou', 'Entei', 'Suicune', 'Lugia', 'Ho-Oh', 'Celebi'],
	);
	assert.ok(SPECIES.every((p) => p.tier !== 'common' || p.captureRate > 120));
	assert.equal(by(152).moves[0]?.name, 'Tackle', 'Chikorita: X/Y moves for #152+');
});

test('every tier has species to draw from, in Gen 1 alone and with Gen 2', () => {
	for (const t of TIERS) {
		assert.ok(speciesUpTo(1).some((p) => p.tier === t), t);
		assert.ok(speciesUpTo(2).some((p) => p.gen === 2 && p.tier === t), `Gen 2 ${t}`);
	}
});
