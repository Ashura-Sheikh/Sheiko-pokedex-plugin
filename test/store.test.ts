import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	CloseInput,
	PokedexData,
	closeMoment,
	decide,
	freshData,
	localDate,
	normalizeData,
	renamePath,
} from '../src/store';
import { parseContextTypes } from '../src/rarity';

const NOW = new Date('2026-10-12T12:00:00+01:00');
const MAP = parseContextTypes('legal: psychic');

function close(path: string, extra: Partial<CloseInput> = {}): CloseInput {
	return {
		path,
		priority: 'normal',
		contexts: ['legal'],
		closeReason: null,
		dateCreated: '2026-10-11T09:00:00+01:00',
		completedDate: '2026-10-12T11:00:00+01:00',
		...extra,
	};
}

/** Closes tasks until the next catch; returns the data and how many closes it took. */
function closeUntilCatch(data: PokedexData, prefix: string, now = NOW) {
	for (let i = 1; i <= 7; i++) {
		const r = decide(close(`${prefix}${i}.md`), data, MAP, now);
		data = r.data;
		if (r.decision.kind === 'caught') return { data, closes: i, decision: r.decision };
		assert.equal(r.decision.kind, 'counted');
	}
	throw new Error('no catch within 7 closes');
}

test('a catch comes exactly when the hidden target (4..7) is reached', () => {
	const start = freshData(NOW);
	const target = start.progress.target;
	assert.ok(target >= 4 && target <= 7);
	const { data, closes, decision } = closeUntilCatch(start, 'T');
	assert.equal(closes, target);
	assert.equal(decision.draw.closes, target);
	assert.equal(data.catches, 1);
	assert.equal(data.daily.catches, 1);
	assert.equal(data.daily.closes, target);
	assert.equal(data.progress.closes, 0, 'progress resets');
	assert.equal(data.progress.scoreSum, 0);
	assert.ok(data.progress.target >= 4 && data.progress.target <= 7, 'new hidden target drawn');
	assert.equal(data.ledger[`T${target}.md`]?.outcome, 'caught');
	assert.equal(data.ledger['T1.md']?.outcome, 'counted');
});

test('counted closes report progress only, never the target', () => {
	const r = decide(close('A.md'), freshData(NOW), MAP, NOW);
	assert.deepEqual(r.decision, { kind: 'counted', closes: 1 });
});

test('rarity uses the batch average: one high close among normals does not set it alone', () => {
	let data = freshData(NOW);
	data.progress.target = 4;
	for (const p of ['1', '2', '3']) data = decide(close(`${p}.md`, { priority: 'low', completedDate: '2026-10-30' }), data, MAP, NOW).data;
	const last = decide(close('4.md', { priority: 'high', dateCreated: '2026-10-12T09:00:00+01:00' }), data, MAP, NOW);
	assert.equal(last.decision.kind, 'caught');
	if (last.decision.kind !== 'caught') return;
	// 3 low outside SLA (0 each) + 1 high within SLA (5) = 5 / 4 = 1.25 → 1, no boost under 5 closes.
	assert.equal(last.decision.draw.average, 1.25);
	assert.equal(last.decision.draw.score, 1);
});

test('the batch collects every close\'s contexts', () => {
	let data = freshData(NOW);
	data.progress.target = 7;
	data = decide(close('1.md', { contexts: ['legal'] }), data, MAP, NOW).data;
	data = decide(close('2.md', { contexts: ['TOS', 'legal'] }), data, MAP, NOW).data;
	assert.deepEqual(data.progress.contexts, ['legal', 'TOS']);
});

test('daily boost counts today\'s closes across batches', () => {
	let data = freshData(NOW);
	data.settings.dailyCap = 10;
	data.progress.target = 4;
	data = closeUntilCatch(data, 'a').data; // 4 closes today
	data.progress.target = 4;
	const second = closeUntilCatch(data, 'b'); // closes 5..8 today
	assert.equal(second.decision.draw.boost, 1, '8 closes today → +1');
});

test('progress is kept overnight; the daily counts reset', () => {
	let data = freshData(NOW);
	data.progress.target = 7;
	data = decide(close('1.md'), data, MAP, NOW).data;
	data = decide(close('2.md'), data, MAP, NOW).data;
	const tomorrow = new Date('2026-10-13T09:00:00+01:00');
	const r = decide(close('3.md'), data, MAP, tomorrow);
	assert.deepEqual(r.decision, { kind: 'counted', closes: 3 });
	assert.equal(r.data.daily.date, '2026-10-13');
	assert.equal(r.data.daily.closes, 1);
	assert.equal(r.data.daily.catches, 0);
});

test('default limit is 3 catches a day; after that closes earn nothing and never count later', () => {
	let data = freshData(NOW);
	assert.equal(data.settings.dailyCap, 3);
	for (const p of ['a', 'b', 'c']) data = closeUntilCatch(data, p).data;
	assert.equal(data.daily.catches, 3);
	const before = data.progress;
	const capped = decide(close('x.md'), data, MAP, NOW);
	assert.equal(capped.decision.kind, 'capped');
	assert.deepEqual(capped.data.progress, before, 'no progress from a capped close');
	const tomorrow = new Date('2026-10-13T09:00:00+01:00');
	assert.equal(decide(close('x.md'), capped.data, MAP, tomorrow).decision.kind, 'already');
	assert.equal(decide(close('y.md'), capped.data, MAP, tomorrow).decision.kind, 'counted');
});

test('reopen and re-close never counts twice', () => {
	const first = decide(close('A.md'), freshData(NOW), MAP, NOW);
	const second = decide(close('A.md'), first.data, MAP, NOW);
	assert.equal(second.decision.kind, 'already');
	assert.equal(second.data, first.data, 'data unchanged');
});

test('superseded and parked closes earn nothing and add no progress', () => {
	for (const reason of ['superseded', 'Parked ']) {
		const { data, decision } = decide(close('B.md', { closeReason: reason }), freshData(NOW), MAP, NOW);
		assert.equal(decision.kind, 'excluded');
		assert.equal(data.ledger['B.md']?.outcome, 'excluded');
		assert.equal(data.progress.closes, 0);
		assert.equal(data.daily.closes, 0);
	}
});

test('duplicates count up and are flagged', () => {
	let data = freshData(NOW);
	data.settings.dailyCap = 100000;
	let dup = false;
	for (let i = 0; i < 400 && !dup; i++) {
		const r = closeUntilCatch(data, `T${i}-`);
		data = r.data;
		if (r.decision.duplicate) {
			dup = true;
			assert.equal(r.decision.count, data.caught[String(r.decision.draw.species.dex)]?.count);
			assert.ok(r.decision.count >= 2);
		}
	}
	assert.ok(dup, 'expected at least one duplicate in 400 catches');
});

test('decide does not mutate the data passed in', () => {
	const before = freshData(NOW);
	const copy = JSON.parse(JSON.stringify(before)) as PokedexData;
	closeUntilCatch(before, 'A');
	decide(close('A.md'), before, MAP, NOW);
	assert.deepEqual(before, copy);
});

test('date-only completedDate on the close day uses the moment the close was seen', () => {
	assert.equal(closeMoment('2026-10-12', NOW), NOW.toISOString());
	assert.equal(closeMoment(undefined, NOW), NOW.toISOString());
	assert.equal(closeMoment('2026-10-10', NOW), '2026-10-10', 'an older date is kept as written');
	assert.equal(closeMoment('2026-10-12T08:00:00+01:00', NOW), '2026-10-12T08:00:00+01:00');
	// High priority created yesterday 09:00, closed today 12:00 (27 h) with a date-only value: outside SLA.
	let data = freshData(NOW);
	data.progress.target = 7;
	data = decide(close('H.md', { priority: 'high', completedDate: '2026-10-12' }), data, MAP, NOW).data;
	assert.equal(data.progress.scoreSum, 3, 'high = 3, no SLA bonus');
});

test('renames move the ledger entry, so a renamed task still cannot count twice', () => {
	const first = decide(close('A.md'), freshData(NOW), MAP, NOW).data;
	const moved = renamePath(first, 'A.md', 'Archive/A.md');
	assert.equal(moved.ledger['A.md'], undefined);
	assert.ok(moved.ledger['Archive/A.md']);
	assert.equal(decide(close('Archive/A.md'), moved, MAP, NOW).decision.kind, 'already');
	assert.equal(renamePath(first, 'nope.md', 'x.md'), first, 'unknown paths are a no-op');
});

test('normalizeData: fresh install defaults', () => {
	const fresh = normalizeData(undefined, NOW);
	assert.equal(fresh.version, 2);
	assert.equal(fresh.settings.dailyCap, 3);
	assert.equal(fresh.daily.date, localDate(NOW));
	assert.equal(fresh.catches, 0);
	assert.equal(fresh.progress.closes, 0);
});

test('normalizeData migrates 0.1.0 data: keeps catches, limit 10 → 3, today\'s count carried', () => {
	const v1 = {
		version: 1,
		installedAt: '2026-10-12T11:59:14.956Z',
		settings: { dailyCap: 10, showRewardWindow: true, contextTypes: 'legal: psychic' },
		ledger: { 'TaskNotes/Tasks/Test 0 task.md': { at: '2026-10-12T12:07:53.149Z', outcome: 'caught', dex: 145 } },
		caught: { '145': { count: 1, firstAt: '2026-10-12T12:07:53.149Z', lastAt: '2026-10-12T12:07:53.149Z' } },
		daily: { date: '2026-10-12', count: 1 },
	};
	const m = normalizeData(v1, NOW);
	assert.equal(m.version, 2);
	assert.equal(m.settings.dailyCap, 3);
	assert.equal(m.settings.contextTypes, 'legal: psychic', 'other settings kept');
	assert.equal(m.caught['145']?.count, 1);
	assert.equal(m.ledger['TaskNotes/Tasks/Test 0 task.md']?.dex, 145);
	assert.equal(m.catches, 1);
	assert.deepEqual(m.daily, { date: '2026-10-12', closes: 1, catches: 1 });
	assert.equal(m.progress.closes, 0, 'counter starts at 0');
	assert.ok(m.progress.target >= 4 && m.progress.target <= 7);
});

test('normalizeData keeps a deliberately chosen limit and saved 0.2.0 progress', () => {
	const custom = normalizeData({ version: 1, settings: { dailyCap: 5 } }, NOW);
	assert.equal(custom.settings.dailyCap, 5, 'only the old default 10 is migrated');
	const v2 = normalizeData(
		{
			version: 2,
			settings: { dailyCap: 10 },
			catches: 4,
			progress: { closes: 2, target: 6, scoreSum: 7, contexts: ['legal'] },
			daily: { date: localDate(NOW), closes: 9, catches: 2 },
		},
		NOW,
	);
	assert.equal(v2.settings.dailyCap, 10, 'a 0.2.0 user choosing 10 is respected');
	assert.deepEqual(v2.progress, { closes: 2, target: 6, scoreSum: 7, contexts: ['legal'] });
	assert.deepEqual(v2.daily, { date: localDate(NOW), closes: 9, catches: 2 });
	assert.equal(v2.catches, 4);
});
