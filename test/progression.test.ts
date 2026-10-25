import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	MAX_LEVEL,
	START_LEVEL,
	STONE_CHANCE,
	addXp,
	evolutionsOf,
	evolutionHint,
	levelEvolutionAvailable,
	newMon,
	noStones,
	readyLevelEvolution,
	stoneEvolutions,
	stoneForTypes,
	xpForClose,
	xpToNext,
} from '../src/progression';
import {
	CloseInput,
	PokedexData,
	declineEvolution,
	decide,
	evolve,
	freshData,
	normalizeData,
	setPartner,
	sizeMinutes,
	testAddPokemon,
	testGiveEachStone,
	testGivePartnerXp,
} from '../src/store';
import { hashString, parseContextTypes, seededRandom } from '../src/rarity';

const NOW = new Date('2026-10-12T12:00:00+01:00');
const MAP = parseContextTypes('');

function close(path: string, extra: Partial<CloseInput> = {}): CloseInput {
	return {
		path,
		priority: 'normal',
		contexts: [],
		closeReason: null,
		dateCreated: '2026-10-12T11:00:00+01:00',
		completedDate: '2026-10-12T11:30:00+01:00',
		...extra,
	};
}

function withCaught(dexes: number[], data: PokedexData = freshData(NOW)): PokedexData {
	const at = NOW.toISOString();
	for (const d of dexes) {
		data.caught[String(d)] = { count: 1, firstAt: at, lastAt: at };
		data.mons[String(d)] = newMon();
	}
	return data;
}

// ---------- XP and levels ----------

test('XP per close: 10 base, +1 per 30 minutes of task size, capped at +40', () => {
	assert.equal(xpForClose(null), 10);
	assert.equal(xpForClose(0), 10);
	assert.equal(xpForClose(29), 10);
	assert.equal(xpForClose(30), 11);
	assert.equal(xpForClose(600), 30);
	assert.equal(xpForClose(100000), 50);
	assert.equal(xpForClose(-5), 10);
});

test('levels: 10 × level XP to the next one; several level-ups at once; capped at 100', () => {
	assert.equal(xpToNext(5), 50);
	const one = addXp(newMon(), 49);
	assert.deepEqual([one.toLevel, one.mon.xp], [5, 49]);
	const two = addXp(newMon(), 50 + 60 + 5);
	assert.deepEqual([two.fromLevel, two.toLevel, two.mon.xp], [5, 7, 5]);
	const max = addXp(newMon(), 10_000_000);
	assert.equal(max.toLevel, MAX_LEVEL);
	assert.equal(max.mon.xp, 0);
});

test('task size: Sheiko working minutes first, else created → close', () => {
	assert.equal(sizeMinutes(close('a', { workingMinutes: 95 }), NOW), 95);
	assert.equal(sizeMinutes(close('a'), NOW), 30);
	assert.equal(sizeMinutes(close('a', { dateCreated: null }), NOW), null);
	// date-only completedDate today → the moment the close was seen (12:00): 60 minutes.
	assert.equal(sizeMinutes(close('a', { completedDate: '2026-10-12' }), NOW), 60);
});

// ---------- Partner XP through decide ----------

test('without a partner, closes give no XP and the decision says so', () => {
	const r = decide(close('A.md'), freshData(NOW), MAP, NOW);
	assert.equal(r.decision.kind, 'counted');
	if (r.decision.kind === 'counted') assert.equal(r.decision.xp, null);
});

test('with a partner, every counted close gives it XP; other Pokémon keep their own levels', () => {
	let data = setPartner(withCaught([4, 25]), 4);
	data.progress.target = 7;
	data = decide(close('A.md', { workingMinutes: 90 }), data, MAP, NOW).data;
	assert.equal(data.mons['4']?.xp, 13, '10 + 3 for 90 minutes');
	assert.equal(data.mons['25']?.xp, 0);
	data = setPartner(data, 25);
	data = decide(close('B.md'), data, MAP, NOW).data;
	assert.equal(data.mons['25']?.xp, 11, '10 + 1 for the default 30 minutes');
	assert.equal(data.mons['4']?.xp, 13, 'swapping partners loses nothing');
});

test('a catch gives XP; a duplicate catch adds +50; a new catch starts at level 5', () => {
	let data = setPartner(withCaught([4]), 4);
	data.settings.dailyCap = 1000;
	let sawNew = false;
	let sawDup = false;
	for (let i = 0; i < 300 && !(sawNew && sawDup); i++) {
		data.progress.target = 1;
		const before = data.mons['4']!;
		const r = decide(close(`T${i}.md`), data, MAP, NOW);
		data = r.data;
		if (r.decision.kind !== 'caught') continue;
		assert.equal(r.decision.xp?.gained, r.decision.duplicate ? 61 : 11);
		assert.ok(data.mons[String(r.decision.draw.species.dex)], 'caught species has a level');
		if (!r.decision.duplicate && r.decision.draw.species.dex !== 4) {
			sawNew = true;
			assert.deepEqual(data.mons[String(r.decision.draw.species.dex)], newMon());
		}
		if (r.decision.duplicate) sawDup = true;
		assert.ok(data.mons['4']!.level >= before.level);
	}
	assert.ok(sawNew && sawDup);
});

// ---------- Over the daily limit (1.2.0, Sheikh, 2026-10-15, issue #26) ----------

/** Partner Charmander, and a daily limit of 3 already reached (3 catches today). Set, not the default. */
function overTheLimit(): PokedexData {
	const data = setPartner(withCaught([4]), 4);
	data.settings.dailyCap = 3;
	data.daily = { date: data.daily.date, closes: 9, catches: 3 };
	return data;
}

test('over the daily limit, the partner still gets the normal close XP', () => {
	const data = overTheLimit();
	const r = decide(close('A.md', { workingMinutes: 90 }), data, MAP, NOW);
	assert.deepEqual(r.decision, {
		kind: 'capped',
		cap: 3,
		xp: { dex: 4, gained: 13, fromLevel: 5, toLevel: 5 },
	});
	assert.equal(r.data.mons['4']?.xp, 13, '10 + 3 for 90 minutes, the same as a counted close');
	assert.equal(r.data.ledger['A.md']?.outcome, 'capped');
});

test('over the daily limit: no catch, no progress, no daily boost, nothing carried over', () => {
	const data = overTheLimit();
	const r = decide(close('A.md'), data, MAP, NOW);
	assert.deepEqual(r.data.progress, data.progress, 'no progress toward the next catch');
	assert.deepEqual(r.data.daily, data.daily, "today's closes (the daily boost) and catches unchanged");
	assert.equal(r.data.catches, data.catches);
	assert.deepEqual(r.data.caught, data.caught, 'nothing caught');
	// The same task can't earn twice, today or tomorrow.
	const tomorrow = new Date('2026-10-13T09:00:00+01:00');
	const again = decide(close('A.md'), r.data, MAP, tomorrow);
	assert.equal(again.decision.kind, 'already');
	assert.equal(again.data.mons['4']?.xp, r.data.mons['4']?.xp);
});

test('over the daily limit without a partner: no XP, and the decision says so', () => {
	const data = withCaught([4]);
	data.settings.dailyCap = 3;
	data.daily = { date: data.daily.date, closes: 9, catches: 3 };
	const r = decide(close('A.md'), data, MAP, NOW);
	assert.deepEqual(r.decision, { kind: 'capped', cap: 3, xp: null });
	assert.deepEqual(r.data.mons['4'], newMon());
});

test('over the daily limit, superseded and parked closes still give no XP', () => {
	for (const reason of ['superseded', 'parked']) {
		const r = decide(close('A.md', { closeReason: reason }), overTheLimit(), MAP, NOW);
		assert.equal(r.decision.kind, 'excluded');
		assert.equal(r.data.mons['4']?.xp, 0, reason);
	}
});

test('over-the-limit XP can level the partner up and make an evolution ready', () => {
	const data = overTheLimit();
	data.mons['4'] = { level: 15, xp: xpToNext(15) - 1 };
	const r = decide(close('A.md'), data, MAP, NOW);
	assert.equal(r.decision.kind, 'capped');
	if (r.decision.kind !== 'capped') return;
	assert.deepEqual([r.decision.xp?.fromLevel, r.decision.xp?.toLevel], [15, 16]);
	assert.equal(readyLevelEvolution(4, r.data.mons['4']!)?.name, 'Charmeleon', 'the evolution prompt can follow');
});

test('a limit of 0 means every close is over the limit, and still gives XP', () => {
	const data = setPartner(withCaught([4]), 4);
	data.settings.dailyCap = 0;
	const r = decide(close('A.md'), data, MAP, NOW);
	assert.deepEqual(r.decision, { kind: 'capped', cap: 0, xp: { dex: 4, gained: 11, fromLevel: 5, toLevel: 5 } });
});

// ---------- Stones ----------

test('stone kind follows the caught type table; unmatched types get a random kind', () => {
	const r = () => 0;
	assert.equal(stoneForTypes(['fire'], r), 'fire');
	assert.equal(stoneForTypes(['ice', 'psychic'], r), 'water', 'primary type first');
	assert.equal(stoneForTypes(['electric', 'steel'], r), 'thunder');
	assert.equal(stoneForTypes(['bug', 'poison'], r), 'leaf');
	assert.equal(stoneForTypes(['normal', 'flying'], r), 'moon');
	assert.equal(stoneForTypes(['fighting'], r), 'trade');
	assert.equal(stoneForTypes(['flying', 'normal'], r), 'moon', 'secondary used when primary has no stone');
	assert.equal(stoneForTypes(['dragon'], () => 0.99), 'trade');
	assert.equal(stoneForTypes(['dragon'], () => 0), 'fire');
});

test('about 1 in 25 catches finds a stone (checked over 5,000 seeded catches)', () => {
	let found = 0;
	const n = 5000;
	for (let i = 0; i < n; i++) if (seededRandom(hashString(`install|stone|${i}`))() < STONE_CHANCE) found++;
	const pct = (found / n) * 100;
	assert.ok(Math.abs(pct - 4) < 0.8, `${pct.toFixed(2)}%`);
});

test('a stone found on a catch lands in the inventory', () => {
	let data = withCaught([]);
	data.settings.dailyCap = 100000;
	let got = 0;
	for (let i = 0; i < 400; i++) {
		data.progress.target = 1;
		const r = decide(close(`S${i}.md`), data, MAP, NOW);
		data = r.data;
		if (r.decision.kind === 'caught' && r.decision.stone) got++;
	}
	const held = Object.values(data.stones).reduce((a, b) => a + b, 0);
	assert.equal(held, got);
	// 1 in 25 of 400 catches ≈ 16 stones. The seeds are fixed, so this is exact for a given
	// build; the wide band is there to catch a broken rate (every catch, or never), not noise.
	assert.ok(got >= 4 && got <= 32, `got ${got} stones from 400 catches`);
});

// ---------- Evolution ----------

test('Gen 1 evolution links: Charmander → Charmeleon at 16; Eevee has three stone forms; Kadabra trades', () => {
	assert.deepEqual(evolutionsOf(4).map((s) => s.name), ['Charmeleon']);
	assert.deepEqual(
		stoneEvolutions(133, noStones()).map((o) => `${o.to.name}:${o.stone}`),
		['Vaporeon:water', 'Jolteon:thunder', 'Flareon:fire'],
	);
	assert.deepEqual(stoneEvolutions(64, noStones()).map((o) => `${o.to.name}:${o.stone}`), ['Alakazam:trade']);
	assert.equal(readyLevelEvolution(4, { level: 15, xp: 0 }), null);
	assert.equal(readyLevelEvolution(4, { level: 16, xp: 0 })?.name, 'Charmeleon');
	assert.equal(readyLevelEvolution(133, { level: 99, xp: 0 }), null, 'stone-only: never a level prompt');
	assert.equal(readyLevelEvolution(150, { level: 99, xp: 0 }), null, 'legendaries do not evolve');
});

test('cancelled evolution is asked again only at the next level', () => {
	let data = setPartner(withCaught([4]), 4);
	data.mons['4'] = { level: 16, xp: 0 };
	data = declineEvolution(data, 4);
	assert.equal(readyLevelEvolution(4, data.mons['4']!), null);
	data.mons['4'] = addXp(data.mons['4']!, xpToNext(16)).mon;
	assert.equal(data.mons['4']!.level, 17);
	assert.equal(readyLevelEvolution(4, data.mons['4']!)?.name, 'Charmeleon');
});

test('evolving keeps both forms, carries the level, moves the partner, clears the cancel mark', () => {
	let data = setPartner(withCaught([4]), 4);
	data.mons['4'] = { level: 17, xp: 30, declinedAt: 16 };
	const next = evolve(data, 4, 5, NOW);
	assert.ok(next);
	assert.equal(next.caught['4']?.count, 1, 'Charmander still caught');
	assert.equal(next.caught['5']?.count, 1, 'Charmeleon now caught');
	assert.deepEqual(next.mons['5'], { level: 17, xp: 30 });
	assert.deepEqual(next.mons['4'], { level: 17, xp: 30 });
	assert.equal(next.partner, 5);
	assert.deepEqual(data.caught['5'], undefined, 'input not mutated');
});

test('evolving into an already-caught form keeps the higher level and adds to the count', () => {
	let data = withCaught([4, 5]);
	data.mons['4'] = { level: 20, xp: 0 };
	data.mons['5'] = { level: 25, xp: 7 };
	const next = evolve(data, 4, 5, NOW)!;
	assert.equal(next.caught['5']?.count, 2);
	assert.deepEqual(next.mons['5'], { level: 25, xp: 7 });
	assert.equal(next.partner, null, 'not the partner: partner unchanged');
});

test('stone evolution uses one stone and is refused without one', () => {
	let data = withCaught([133]);
	assert.equal(evolve(data, 133, 136, NOW, 'fire'), null, 'no Fire Stone');
	data.stones.fire = 2;
	const next = evolve(data, 133, 136, NOW, 'fire')!;
	assert.equal(next.stones.fire, 1);
	assert.equal(next.caught['136']?.count, 1, 'Flareon');
	assert.equal(next.caught['133']?.count, 1, 'Eevee kept');
});

test('evolve refuses a wrong pair or an uncaught Pokémon', () => {
	const data = withCaught([4]);
	assert.equal(evolve(data, 4, 6, NOW), null, 'Charmander cannot jump to Charizard');
	assert.equal(evolve(data, 1, 2, NOW), null, 'Bulbasaur not caught');
});

test('setPartner only accepts caught Pokémon', () => {
	const data = withCaught([25]);
	assert.equal(setPartner(data, 1), data);
	assert.equal(setPartner(data, 25).partner, 25);
});

// ---------- Migration ----------

test('migration from 0.2.0: every caught species gets level 5, no partner, no stones; progress kept', () => {
	const v2 = {
		version: 2,
		installedAt: '2026-10-12T11:59:14.956Z',
		settings: { dailyCap: 3, showRewardWindow: true, contextTypes: '' },
		ledger: {},
		caught: {
			'68': { count: 1, firstAt: 'x', lastAt: 'x' },
			'145': { count: 1, firstAt: 'x', lastAt: 'x' },
		},
		catches: 2,
		progress: { closes: 0, target: 7, scoreSum: 0, contexts: [] },
		daily: { date: '2026-10-12', closes: 7, catches: 2 },
	};
	const m = normalizeData(v2, NOW);
	assert.equal(m.version, 3);
	assert.deepEqual(m.mons, { '68': { level: START_LEVEL, xp: 0 }, '145': { level: START_LEVEL, xp: 0 } });
	assert.equal(m.partner, null);
	assert.deepEqual(m.stones, noStones());
	assert.deepEqual(m.progress, v2.progress);
	assert.deepEqual(m.daily, v2.daily);
	assert.equal(m.settings.dailyCap, 3);
});

test('saved 0.3.0 levels, partner and stones survive a reload; a partner that was never caught is dropped', () => {
	const saved = normalizeData(
		{
			version: 3,
			caught: { '4': { count: 1, firstAt: 'x', lastAt: 'x' } },
			mons: { '4': { level: 18, xp: 40, declinedAt: 16 } },
			partner: 4,
			stones: { fire: 2, trade: 1, bogus: 5 },
		},
		NOW,
	);
	assert.deepEqual(saved.mons['4'], { level: 18, xp: 40, declinedAt: 16 });
	assert.equal(saved.partner, 4);
	assert.equal(saved.stones.fire, 2);
	assert.equal(saved.stones.trade, 1);
	assert.equal((saved.stones as Record<string, number>).bogus, undefined);
	const orphan = normalizeData({ version: 3, caught: {}, partner: 25 }, NOW);
	assert.equal(orphan.partner, null);
});

// ---------- Test tools ----------

test('test tools are off by default, including for data saved before they existed', () => {
	assert.equal(freshData(NOW).settings.testTools, false);
	assert.equal(normalizeData({ version: 3, settings: { dailyCap: 3 } }, NOW).settings.testTools, false);
});

test('test: give partner XP levels it up and can make an evolution ready; no partner → nothing', () => {
	assert.equal(testGivePartnerXp(freshData(NOW), 500).xp, null);
	let data = setPartner(testAddPokemon(freshData(NOW), 4, NOW), 4);
	for (let i = 0; i < 3; i++) data = testGivePartnerXp(data, 500).data;
	assert.ok(data.mons['4']!.level >= 16, `level ${data.mons['4']!.level}`);
	assert.equal(readyLevelEvolution(4, data.mons['4']!)?.name, 'Charmeleon');
});

test('test: one of each stone, then a stone evolution works', () => {
	let data = testGiveEachStone(testAddPokemon(freshData(NOW), 133, NOW));
	assert.deepEqual(Object.values(data.stones), [1, 1, 1, 1, 1, 1]);
	data = evolve(data, 133, 135, NOW, 'thunder')!;
	assert.equal(data.caught['135']?.count, 1, 'Jolteon');
	assert.equal(data.stones.thunder, 0);
});

test('test: adding a Pokémon is not a close (no ledger, progress or daily change)', () => {
	const before = freshData(NOW);
	const after = testAddPokemon(before, 25, NOW);
	assert.equal(after.caught['25']?.count, 1);
	assert.deepEqual(after.mons['25'], newMon());
	assert.deepEqual(after.ledger, {});
	assert.deepEqual(after.progress, before.progress);
	assert.deepEqual(after.daily, before.daily);
	assert.equal(after.catches, 0);
	assert.equal(testAddPokemon(before, 999, NOW), before, 'unknown dex ignored');
});

test('"Evolve now" still offers an evolution after a Cancel; the automatic prompt does not', () => {
	const mon = { level: 16, xp: 0, declinedAt: 16 };
	assert.equal(readyLevelEvolution(4, mon), null, 'no automatic re-ask at the same level');
	assert.equal(levelEvolutionAvailable(4, mon)?.name, 'Charmeleon', 'manual Evolve now is available');
	assert.equal(levelEvolutionAvailable(4, { level: 15, xp: 0 }), null, 'not before level 16');
	assert.equal(levelEvolutionAvailable(133, { level: 99, xp: 0 }), null, 'stone-only Pokémon never');
});

// ---------- Partner card: evolution hint ----------

test('evolution hint covers level, ready, stones, trade, fully evolved and legendary', () => {
	const stones = { ...noStones(), thunder: 1, water: 2 };
	assert.equal(evolutionHint(4, { level: 12, xp: 0 }, stones), 'Evolves into Charmeleon at Lv 16');
	assert.equal(evolutionHint(4, { level: 18, xp: 0 }, stones), 'Ready to evolve into Charmeleon');
	assert.equal(evolutionHint(25, newMon(), stones), 'Thunder Stone → Raichu (have 1)');
	assert.equal(
		evolutionHint(133, newMon(), stones),
		'Water Stone → Vaporeon (have 2) · Thunder Stone → Jolteon (have 1) · Fire Stone → Flareon (have 0)',
	);
	assert.equal(evolutionHint(64, newMon(), noStones()), 'Trade Stone → Alakazam (have 0)');
	assert.equal(evolutionHint(6, newMon(), stones), 'Fully evolved');
	assert.equal(evolutionHint(145, newMon(), stones), 'Fully evolved', 'legendary');
});
