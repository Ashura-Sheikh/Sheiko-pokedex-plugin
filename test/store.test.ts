import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CloseInput, PokedexData, decide, freshData, localDate, normalizeData, renamePath } from '../src/store';
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

test('a first close catches one Pokémon and records it once', () => {
	const { data, decision } = decide(close('A.md'), freshData(NOW), MAP, NOW);
	assert.equal(decision.kind, 'caught');
	if (decision.kind !== 'caught') return;
	assert.equal(decision.duplicate, false);
	assert.equal(decision.count, 1);
	assert.equal(data.ledger['A.md']?.outcome, 'caught');
	assert.equal(data.ledger['A.md']?.dex, decision.draw.species.dex);
	assert.equal(data.caught[String(decision.draw.species.dex)]?.count, 1);
	assert.equal(data.daily.count, 1);
});

test('reopen and re-close never pays twice', () => {
	const first = decide(close('A.md'), freshData(NOW), MAP, NOW);
	const second = decide(close('A.md'), first.data, MAP, NOW);
	assert.equal(second.decision.kind, 'already');
	assert.equal(second.data, first.data, 'data unchanged');
});

test('superseded and parked closes earn nothing but are still recorded', () => {
	for (const reason of ['superseded', 'Parked ']) {
		const { data, decision } = decide(close('B.md', { closeReason: reason }), freshData(NOW), MAP, NOW);
		assert.equal(decision.kind, 'excluded');
		assert.equal(data.ledger['B.md']?.outcome, 'excluded');
		assert.equal(Object.keys(data.caught).length, 0);
		assert.equal(data.daily.count, 0);
	}
});

test('the daily cap stops catches, and a capped task never pays out later', () => {
	let data: PokedexData = freshData(NOW);
	data.settings.dailyCap = 2;
	for (const p of ['1.md', '2.md']) data = decide(close(p), data, MAP, NOW).data;
	const capped = decide(close('3.md'), data, MAP, NOW);
	assert.equal(capped.decision.kind, 'capped');
	assert.equal(capped.data.ledger['3.md']?.outcome, 'capped');
	const tomorrow = new Date('2026-10-13T09:00:00+01:00');
	assert.equal(decide(close('3.md'), capped.data, MAP, tomorrow).decision.kind, 'already');
	assert.equal(decide(close('4.md'), capped.data, MAP, tomorrow).decision.kind, 'caught');
});

test('the daily count resets on a new local day', () => {
	let data = freshData(NOW);
	data = decide(close('1.md'), data, MAP, NOW).data;
	const next = decide(close('2.md'), data, MAP, new Date('2026-10-13T08:00:00+01:00')).data;
	assert.equal(next.daily.date, '2026-10-13');
	assert.equal(next.daily.count, 1);
});

test('duplicates count up and are flagged', () => {
	let data = freshData(NOW);
	data.settings.dailyCap = 1000;
	let dup = false;
	for (let i = 0; i < 400 && !dup; i++) {
		const r = decide(close(`T${i}.md`), data, MAP, NOW);
		data = r.data;
		if (r.decision.kind === 'caught' && r.decision.duplicate) {
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
	decide(close('A.md'), before, MAP, NOW);
	assert.deepEqual(before, copy);
});

test('renames move the ledger entry, so a renamed task still cannot pay twice', () => {
	const first = decide(close('A.md'), freshData(NOW), MAP, NOW).data;
	const moved = renamePath(first, 'A.md', 'Archive/A.md');
	assert.equal(moved.ledger['A.md'], undefined);
	assert.ok(moved.ledger['Archive/A.md']);
	assert.equal(decide(close('Archive/A.md'), moved, MAP, NOW).decision.kind, 'already');
	assert.equal(renamePath(first, 'nope.md', 'x.md'), first, 'unknown paths are a no-op');
});

test('normalizeData fills gaps and keeps saved state', () => {
	const fresh = normalizeData(undefined, NOW);
	assert.equal(fresh.settings.dailyCap, 10);
	assert.equal(fresh.daily.date, localDate(NOW));
	const kept = normalizeData({ ledger: { 'A.md': { at: 'x', outcome: 'caught', dex: 1 } }, settings: { dailyCap: 3 } }, NOW);
	assert.equal(kept.settings.dailyCap, 3);
	assert.equal(kept.settings.showRewardWindow, true);
	assert.equal(kept.ledger['A.md']?.dex, 1);
});
