import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	TIER_ODDS,
	candidates,
	draw,
	hashString,
	parseContextTypes,
	parseDate,
	pickTier,
	score,
	seededRandom,
	slaTargetDays,
	typePool,
	withinSla,
} from '../src/rarity';
import { GEN1 } from '../src/data/gen1';
import { TIERS, Tier } from '../src/species';

test('SLA targets match sla-tracking.base: high 1, medium 2, normal 3, other 7', () => {
	assert.equal(slaTargetDays('high'), 1);
	assert.equal(slaTargetDays('medium'), 2);
	assert.equal(slaTargetDays('normal'), 3);
	assert.equal(slaTargetDays('low'), 7);
	assert.equal(slaTargetDays(null), 7);
	assert.equal(slaTargetDays('urgent'), 7);
});

test('withinSla: boundary is inclusive, missing dates give null', () => {
	assert.equal(withinSla('high', '2026-10-01T09:00:00+01:00', '2026-10-02T09:00:00+01:00'), true);
	assert.equal(withinSla('high', '2026-10-01T09:00:00+01:00', '2026-10-02T09:00:01+01:00'), false);
	assert.equal(withinSla('medium', '2026-10-01T09:00:00+01:00', '2026-10-03T08:00:00+01:00'), true);
	assert.equal(withinSla('normal', null, '2026-10-02'), null);
	assert.equal(withinSla('normal', '2026-10-01', 'not a date'), null);
});

test('parseDate reads date-only values as local midnight', () => {
	const d = parseDate('2026-10-12');
	assert.ok(d);
	assert.equal(d.getHours(), 0);
	assert.equal(d.getDate(), 12);
});

test('score: priority points plus 2 for within SLA; size is not part of it', () => {
	assert.equal(score('high', true), 5);
	assert.equal(score('high', false), 3);
	assert.equal(score('medium', true), 4);
	assert.equal(score('normal', null), 1);
	assert.equal(score('low', true), 2);
});

test('every odds row sums to 100 and higher scores never lower rare or legendary odds', () => {
	for (const row of TIER_ODDS) assert.equal(row.reduce((a, b) => a + b, 0), 100);
	for (let i = 1; i < TIER_ODDS.length; i++) {
		assert.ok(TIER_ODDS[i]![2] >= TIER_ODDS[i - 1]![2]);
		assert.ok(TIER_ODDS[i]![3] >= TIER_ODDS[i - 1]![3]);
	}
	assert.equal(TIER_ODDS[0]![3], 0, 'score 0 can never give a legendary');
});

test('seeded random is repeatable and different seeds differ', () => {
	const a = seededRandom(hashString('x'));
	const b = seededRandom(hashString('x'));
	const c = seededRandom(hashString('y'));
	const va = [a(), a(), a()];
	assert.deepEqual(va, [b(), b(), b()]);
	assert.notDeepEqual(va, [c(), c(), c()]);
	for (const v of va) assert.ok(v >= 0 && v < 1);
});

test('tier frequencies over 20,000 seeds track the odds table (within 1.5 points)', () => {
	for (const s of [0, 5]) {
		const counts: Record<Tier, number> = { common: 0, uncommon: 0, rare: 0, legendary: 0 };
		const n = 20000;
		for (let i = 0; i < n; i++) counts[pickTier(seededRandom(hashString(`seed-${i}`)), s)]++;
		TIERS.forEach((t, i) => {
			const pct = (counts[t] / n) * 100;
			assert.ok(Math.abs(pct - TIER_ODDS[s]![i]!) < 1.5, `score ${s} ${t}: ${pct.toFixed(2)}%`);
		});
	}
});

test('context map parsing skips junk and lower-cases types', () => {
	const m = parseContextTypes('legal: Psychic, steel\n\nbad line\n: fire\nTOS: water');
	assert.deepEqual(m, { legal: ['psychic', 'steel'], TOS: ['water'] });
	assert.deepEqual([...typePool(['legal', 'TOS', 'unknown'], m)].sort(), ['psychic', 'steel', 'water']);
});

test('candidates narrow by type and fall back to the whole tier when nothing matches', () => {
	const electric = candidates('common', new Set(['electric']));
	assert.ok(electric.length > 0);
	assert.ok(electric.every((p) => p.tier === 'common' && p.types.includes('electric')));
	const none = candidates('legendary', new Set(['bug']));
	assert.deepEqual(
		none.map((p) => p.dex),
		GEN1.filter((p) => p.tier === 'legendary').map((p) => p.dex),
	);
	assert.equal(candidates('rare', new Set()).length, GEN1.filter((p) => p.tier === 'rare').length);
});

test('draw is deterministic per seed and respects the drawn tier', () => {
	const input = {
		seed: 'TaskNotes/Tasks/A.md|2026-10-01T09:00:00+01:00',
		priority: 'high',
		contexts: ['technical-delivery'],
		created: '2026-10-01T09:00:00+01:00',
		completed: '2026-10-01T15:00:00+01:00',
	};
	const map = parseContextTypes('technical-delivery: electric');
	const a = draw(input, map);
	const b = draw(input, map);
	assert.equal(a.species.dex, b.species.dex);
	assert.equal(a.score, 5);
	assert.equal(a.sla, true);
	assert.equal(a.species.tier, a.tier);
});
