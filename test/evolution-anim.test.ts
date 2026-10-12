// The Game Boy evolution scene, checked against Red/Blue's EvolveMon (pret/pokered,
// engine/movie/evolution.asm): 80-frame intro, 8 cycles of a pause (16..2 frames) then
// 1..8 back-and-forth swaps of 3 frames each, B read during pauses only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	CYCLES,
	DMG_SHADES,
	INTRO_FRAMES,
	Player,
	Step,
	calmTimeline,
	dmgShade,
	evolutionText,
	gameBoyTimeline,
	play,
	toDmg,
	totalFrames,
} from '../src/evolution-anim';

test('Red/Blue timeline: intro, then 8 cycles of a shrinking pause and a growing burst', () => {
	const t = gameBoyTimeline();
	assert.deepEqual(t[0], { kind: 'show', pic: 'old', silhouette: false, frames: INTRO_FRAMES });
	const pauses = t.filter((s) => s.kind === 'pause');
	assert.equal(pauses.length, CYCLES);
	assert.deepEqual(pauses.map((s) => s.frames), [16, 14, 12, 10, 8, 6, 4, 2]);
	const swaps = t.filter((s) => s.kind === 'show' && s.silhouette);
	assert.equal(swaps.length, 72, '2 × (1 + 2 + … + 8)');
	assert.ok(swaps.every((s) => s.frames === 3), 'every swap is held 3 frames (Delay3)');
	assert.equal(totalFrames(t), 80 + 72 + 72 * 3, '368 frames, about 6.2 seconds');
});

test('each burst alternates new/old and ends on the old picture, all as silhouettes', () => {
	const t = gameBoyTimeline();
	let burst: Step[] = [];
	const bursts: Step[][] = [];
	for (const s of t.slice(1)) {
		if (s.kind === 'pause') {
			if (burst.length) bursts.push(burst);
			burst = [];
			assert.equal(s.silhouette, true);
		} else burst.push(s);
	}
	bursts.push(burst);
	assert.equal(bursts.length, 8);
	bursts.forEach((b, i) => {
		assert.equal(b.length, 2 * (i + 1));
		b.forEach((s, j) => assert.equal(s.kind === 'show' && s.pic, j % 2 === 0 ? 'new' : 'old'));
	});
});

function player(opts: { cancelAfterRenders?: number; cancellable?: boolean }) {
	const rendered: Step[] = [];
	const p: Player = {
		render: (s) => void rendered.push(s),
		wait: () => Promise.resolve(),
		cancelRequested: () => opts.cancelAfterRenders !== undefined && rendered.length >= opts.cancelAfterRenders,
		cancellable: opts.cancellable ?? true,
	};
	return { p, rendered };
}

test('no cancel: the whole scene plays and the Pokémon evolves', async () => {
	const { p, rendered } = player({});
	assert.equal(await play(gameBoyTimeline(), p), 'evolved');
	assert.equal(rendered.length, gameBoyTimeline().length);
});

test('B pressed mid-burst takes effect at the next pause, as in the game', async () => {
	const t = gameBoyTimeline();
	// Step 3 is the first swap of burst 1 (intro, pause 16, new, old, pause 14, …).
	const { p, rendered } = player({ cancelAfterRenders: 3 });
	assert.equal(await play(t, p), 'cancelled');
	const last = rendered[rendered.length - 1]!;
	assert.equal(last.kind, 'pause', 'stopped at a pause, not mid-burst');
	assert.equal(last.frames, 14, 'the pause after burst 1');
});

test('B during the intro stops at the very first pause, before any swap', async () => {
	const { p, rendered } = player({ cancelAfterRenders: 1 });
	assert.equal(await play(gameBoyTimeline(), p), 'cancelled');
	assert.equal(rendered.length, 2);
	assert.equal(rendered.filter((s) => s.kind === 'show' && s.silhouette).length, 0);
});

test('stone evolutions cannot be stopped, even with B held', async () => {
	const { p } = player({ cancelAfterRenders: 0, cancellable: false });
	assert.equal(await play(gameBoyTimeline(), p), 'evolved');
});

test('calm timeline: no flicker, still cancellable, ends on the new picture', async () => {
	const t = calmTimeline();
	assert.equal(t.filter((s) => s.kind === 'show' && s.silhouette).length, 0, 'no rapid swaps');
	assert.ok(t.some((s) => s.kind === 'fade'));
	const { p } = player({ cancelAfterRenders: 1 });
	assert.equal(await play(t, p), 'cancelled');
	const done = player({});
	assert.equal(await play(t, done.p), 'evolved');
});

test('DMG shades: 4 greens, lightest first; brightness picks the shade', () => {
	assert.deepEqual([...DMG_SHADES], ['#9bbc0f', '#8bac0f', '#306230', '#0f380f']);
	assert.equal(dmgShade(255, 255, 255), 0);
	assert.equal(dmgShade(160, 160, 160), 1);
	assert.equal(dmgShade(100, 100, 100), 2);
	assert.equal(dmgShade(0, 0, 0), 3);
});

test('toDmg: transparent stays transparent; silhouettes use the darkest shade', () => {
	const px = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 0, 200, 50, 50, 255]);
	const sil = new Uint8ClampedArray(px);
	toDmg(px, false);
	assert.deepEqual([...px.slice(0, 4)], [0x9b, 0xbc, 0x0f, 255], 'white → lightest');
	assert.equal(px[7], 0, 'transparent stays transparent');
	toDmg(sil, true);
	assert.deepEqual([...sil.slice(0, 4)], [0x0f, 0x38, 0x0f, 255]);
	assert.deepEqual([...sil.slice(8, 12)], [0x0f, 0x38, 0x0f, 255]);
});

test("Red/Blue's lines, names in capitals", () => {
	assert.equal(evolutionText.start('Charmeleon'), 'What? CHARMELEON\nis evolving!');
	assert.equal(evolutionText.done('Charmeleon', 'Charizard'), 'CHARMELEON evolved\ninto CHARIZARD!');
	assert.equal(evolutionText.stopped('Charmeleon'), 'Huh? CHARMELEON\nstopped evolving!');
});
