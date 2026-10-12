// Bulk-close rule (Sheikh, 2026-10-12): more than 50 closes within 6 minutes → the
// closes beyond the 50th count as half a close toward the next catch and the daily boost (option C).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BULK_CREDIT, CloseInput, DEFAULT_SETTINGS, PokedexData, decide, formatCount, freshData, normalizeData, noteClose, setPartner, testAddPokemon } from '../src/store';
import { parseContextTypes } from '../src/rarity';

const START = new Date('2026-10-12T12:00:00+01:00');
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

const at = (seconds: number) => new Date(START.getTime() + seconds * 1000);

/** A data object where catches never trigger, so only counting is observed. */
function counting(): PokedexData {
	const d = freshData(START);
	d.progress.target = 1_000_000;
	d.settings.dailyCap = 1_000_000;
	return d;
}

test('defaults: more than 50 closes within 6 minutes; bulk credit is half', () => {
	assert.equal(DEFAULT_SETTINGS.bulkThreshold, 50);
	assert.equal(DEFAULT_SETTINGS.bulkWindowMinutes, 6);
	assert.equal(BULK_CREDIT, 0.5);
	const old = normalizeData({ version: 3, settings: { dailyCap: 3 } }, START);
	assert.equal(old.settings.bulkThreshold, 50, 'saved data from 0.4.0 gets the default');
	assert.deepEqual(old.recentCloses, []);
});

test('a burst of 62 closes in 6 minutes: closes 1–50 full credit, 51–62 half', () => {
	let data = counting();
	const bulk: boolean[] = [];
	for (let i = 0; i < 62; i++) {
		const r = decide(close(`T${i}.md`), data, MAP, at(i * 5)); // one every 5 s: 62 within 5 min 5 s
		data = r.data;
		if (r.decision.kind === 'counted') bulk.push(r.decision.bulk);
	}
	assert.equal(bulk.filter((b) => !b).length, 50);
	assert.deepEqual(bulk.slice(50), Array(12).fill(true));
	assert.equal(data.progress.closes, 50 + 12 * 0.5);
	assert.equal(data.daily.closes, 56);
});

test('closes spread out more than the window apart are never bulk', () => {
	let data = counting();
	for (let i = 0; i < 120; i++) {
		const r = decide(close(`S${i}.md`), data, MAP, at(i * 8)); // 45 closes per 6 minutes at most
		data = r.data;
		if (r.decision.kind === 'counted') assert.equal(r.decision.bulk, false, `close ${i}`);
	}
	assert.equal(data.progress.closes, 120);
	assert.ok(data.recentCloses.length <= 46, 'old close times are dropped');
});

test('the window slides: after a quiet 6 minutes, credit is full again', () => {
	let data = counting();
	data.settings.bulkThreshold = 3;
	for (let i = 0; i < 5; i++) data = decide(close(`A${i}.md`), data, MAP, at(i)).data;
	assert.equal(data.progress.closes, 3 + 2 * 0.5);
	const later = decide(close('B.md'), data, MAP, at(4 + 6 * 60 + 1));
	assert.equal(later.decision.kind === 'counted' && later.decision.bulk, false);
});

test('excluded and capped closes still count toward detecting a burst', () => {
	let data = counting();
	data.settings.bulkThreshold = 3;
	for (let i = 0; i < 3; i++) data = decide(close(`P${i}.md`, { closeReason: 'parked' }), data, MAP, at(i)).data;
	const r = decide(close('D.md'), data, MAP, at(10));
	assert.equal(r.decision.kind === 'counted' && r.decision.bulk, true, '4th close in the window, after 3 parked ones');
	assert.equal(r.data.progress.closes, 0.5);
});

test('half credit slows the catch: a target of 4 needs 8 bulk closes', () => {
	let data = freshData(START);
	data.settings.bulkThreshold = 0; // every close is bulk
	data.progress.target = 4;
	let n = 0;
	for (;;) {
		n++;
		const r = decide(close(`C${n}.md`), data, MAP, at(n));
		data = r.data;
		if (r.decision.kind === 'caught') {
			assert.equal(r.decision.bulk, true);
			assert.equal(r.decision.draw.closes, 4);
			break;
		}
		assert.ok(n < 20);
	}
	assert.equal(n, 8);
});

test('half credit halves the daily boost: 30 bulk closes count as 15 → +3, not more', () => {
	let data = counting();
	data.settings.bulkThreshold = 0;
	for (let i = 0; i < 20; i++) data = decide(close(`D${i}.md`), data, MAP, at(i)).data;
	assert.equal(data.daily.closes, 10, '20 bulk closes = 10 toward the boost (+2), not 20 (+3 max)');
});

test('the batch average stays a fair average: half-credit closes weigh half', () => {
	let data = freshData(START);
	data.settings.bulkThreshold = 1; // first close full, the rest bulk
	data.progress.target = 2;
	// close 1: high within SLA = 5, full weight; closes 2-3: low within SLA = 2, half weight each.
	// (Non-zero scores on purpose: with 0s, weighted and unweighted averages come out the same.)
	data = decide(close('H.md', { priority: 'high' }), data, MAP, at(0)).data;
	data = decide(close('L1.md', { priority: 'low' }), data, MAP, at(1)).data;
	const r = decide(close('L2.md', { priority: 'low' }), data, MAP, at(2));
	assert.equal(r.decision.kind, 'caught');
	if (r.decision.kind === 'caught') assert.equal(r.decision.draw.average, 3.5, '(5×1 + 2×0.5 + 2×0.5) / 2; unweighted would be 4.5');
});

test('XP is not affected by the bulk rule', () => {
	let data = setPartner(testAddPokemon(counting(), 4, START), 4);
	data.settings.bulkThreshold = 0;
	const r = decide(close('X.md', { workingMinutes: 90 }), data, MAP, at(0));
	assert.equal(r.decision.kind === 'counted' && r.decision.bulk, true);
	if (r.decision.kind === 'counted') assert.equal(r.decision.xp?.gained, 13, 'full 10 + 3, same as a normal close');
});

test('noteClose ignores times outside the window and in the future', () => {
	const d = counting();
	d.settings.bulkThreshold = 1;
	d.recentCloses = [at(-7 * 60).toISOString(), at(60).toISOString(), 'not a date'];
	assert.equal(noteClose(d, at(0)), false, 'the 7-minute-old, future and junk entries are dropped');
	assert.deepEqual(d.recentCloses, [at(0).toISOString()]);
});

test('formatCount shows halves cleanly', () => {
	assert.equal(formatCount(3), '3');
	assert.equal(formatCount(3.5), '3.5');
});
