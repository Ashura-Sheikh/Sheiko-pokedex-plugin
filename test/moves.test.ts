import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GEN1 } from '../src/data/gen1';
import { MOVE_SLOTS, currentMoves, learnedText, movesLearned, nextMove, speciesByDex } from '../src/progression';

const by = (n: number) => speciesByDex(n)!;
const names = (ms: { name: string }[]) => ms.map((m) => m.name);

test('every Gen 1 species has Red/Blue level-up moves, sorted by level, no repeats', () => {
	for (const s of GEN1) {
		assert.ok(s.moves.length >= 1, s.name);
		for (let i = 1; i < s.moves.length; i++) assert.ok(s.moves[i]!.level >= s.moves[i - 1]!.level, s.name);
		assert.equal(new Set(names(s.moves)).size, s.moves.length, `${s.name} repeats a move`);
		for (const m of s.moves) assert.ok(m.name && m.type && m.level >= 1, s.name);
	}
});

test('Red/Blue spot checks: Charmander, Pikachu, Magikarp, Mewtwo', () => {
	assert.deepEqual(
		by(4).moves.map((m) => `${m.level}:${m.name}`),
		['1:Scratch', '1:Growl', '9:Ember', '15:Leer', '22:Rage', '30:Slash', '38:Flamethrower', '46:Fire Spin'],
	);
	assert.deepEqual(names(by(25).moves), ['Thunder Shock', 'Growl', 'Thunder Wave', 'Quick Attack', 'Swift', 'Agility', 'Thunder']);
	assert.deepEqual(names(by(129).moves), ['Splash', 'Tackle']);
	assert.equal(by(150).moves.filter((m) => m.name === 'Psychic').length, 1, 'Mewtwo keeps Psychic once, as a starting move');
	assert.equal(by(150).moves.find((m) => m.name === 'Psychic')?.level, 1);
});

test('an evolved form already knows its pre-evolution moves from the start (Charmeleon: Ember at 1)', () => {
	assert.equal(by(5).moves.find((m) => m.name === 'Ember')?.level, 1);
});

test('current moves are the last 4 learned by that level', () => {
	assert.deepEqual(names(currentMoves(by(4), 5)), ['Scratch', 'Growl']);
	assert.deepEqual(names(currentMoves(by(4), 17)), ['Scratch', 'Growl', 'Ember', 'Leer']);
	assert.deepEqual(names(currentMoves(by(4), 30)), ['Ember', 'Leer', 'Rage', 'Slash'], 'Scratch and Growl replaced');
	assert.deepEqual(names(currentMoves(by(129), 100)), ['Splash', 'Tackle']);
	for (const s of GEN1) assert.ok(currentMoves(s, 100).length <= MOVE_SLOTS, s.name);
});

test('next move and moves learned on a level-up', () => {
	assert.equal(nextMove(by(4), 17)?.name, 'Rage');
	assert.equal(nextMove(by(4), 22)?.name, 'Slash', 'learned exactly at 22, so the next is Slash');
	assert.equal(nextMove(by(4), 46), null);
	assert.deepEqual(names(movesLearned(by(4), 8, 15)), ['Ember', 'Leer']);
	assert.deepEqual(movesLearned(by(4), 15, 21), []);
});

test('learned text for notices', () => {
	assert.equal(learnedText(null), '');
	assert.equal(learnedText({ dex: 4, fromLevel: 8, toLevel: 8 }), '', 'no level-up');
	assert.equal(learnedText({ dex: 4, fromLevel: 8, toLevel: 9 }), ' Learned Ember!');
	assert.equal(learnedText({ dex: 4, fromLevel: 8, toLevel: 22 }), ' Learned Ember, Leer and Rage!');
	assert.equal(learnedText({ dex: 4, fromLevel: 10, toLevel: 14 }), '');
});
