import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
	STATUS_BAR_MODES,
	STATUS_CATCH_MS,
	STATUS_COOLDOWN_MS,
	STATUS_HOP_MS,
	STATUS_PARTICLES,
	STATUS_PARTICLE_LAYOUT,
	effectiveStatusMode,
	mayPlay,
	moveDuration,
	moveFor,
	parseStatusBarMode,
	particlesForMove,
	redrawAction,
	rewardPartnerView,
	whenToPlay,
} from '../src/statusbar-anim';
import { DEFAULT_SETTINGS, freshData, normalizeData } from '../src/store';

const NOW = new Date('2026-11-19T12:00:00Z');
// Tests run from test-dist/, one level below the repo root (see test/run.mjs).
const ROOT = process.cwd();
const CSS = readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
const MAIN = readFileSync(path.join(ROOT, 'src', 'main.ts'), 'utf8');
const REWARD = readFileSync(path.join(ROOT, 'src', 'ui', 'reward-modal.ts'), 'utf8');

// ---------- Setting (Sheikh 2026-11-19: Animated / Still / Hidden, default Animated) ----------

test('Status bar partner: default Animated, for new installs and data from 2.0.0 or earlier', () => {
	assert.equal(DEFAULT_SETTINGS.statusBarPartner, 'animated');
	assert.equal(freshData(NOW).settings.statusBarPartner, 'animated');
	const from200 = normalizeData({ version: 3, settings: { dailyCap: 5, partnerAnimation: 'full' }, capUpgrade: 'done' }, NOW);
	assert.equal(from200.settings.statusBarPartner, 'animated', 'data from 2.0.0 has no setting');
	assert.equal(from200.settings.partnerAnimation, 'full', 'other settings are kept');
	assert.equal(from200.settings.dailyCap, 5);
});

test('Status bar partner: each saved mode is kept; unknown or wrong values fall back to Animated', () => {
	assert.deepEqual([...STATUS_BAR_MODES], ['animated', 'still', 'hidden']);
	for (const m of STATUS_BAR_MODES) {
		assert.equal(normalizeData({ version: 3, settings: { statusBarPartner: m }, capUpgrade: 'done' }, NOW).settings.statusBarPartner, m);
	}
	for (const bad of ['full', 'calm', 'off', 'Animated', '', 1, null, true]) {
		assert.equal(parseStatusBarMode(bad), 'animated', String(bad));
		// Through loading too: a bad saved value must not reach the settings.
		const loaded = normalizeData({ version: 3, settings: { statusBarPartner: bad }, capUpgrade: 'done' }, NOW);
		assert.equal(loaded.settings.statusBarPartner, 'animated', `loaded ${String(bad)}`);
	}
});

test('Reduced motion turns Animated into Still; Still and Hidden are unchanged', () => {
	assert.equal(effectiveStatusMode('animated', false), 'animated');
	assert.equal(effectiveStatusMode('animated', true), 'still');
	assert.equal(effectiveStatusMode('still', false), 'still');
	assert.equal(effectiveStatusMode('still', true), 'still');
	assert.equal(effectiveStatusMode('hidden', false), 'hidden');
	assert.equal(effectiveStatusMode('hidden', true), 'hidden');
});

// ---------- Which close gets which move (Sheikh 2026-11-19) ----------

test('A catch gets the catch move, progress a hop, everything else none', () => {
	assert.equal(moveFor('caught'), 'catch');
	assert.equal(moveFor('counted'), 'hop');
	assert.equal(moveFor('capped'), null, 'daily limit reached: no move, even with a level-up');
	assert.equal(moveFor('already'), null);
	assert.equal(moveFor('excluded'), null);
});

test('Only a catch with the reward window on waits for the window to close', () => {
	assert.equal(whenToPlay('catch', true), 'after-reward-window');
	assert.equal(whenToPlay('catch', false), 'now');
	assert.equal(whenToPlay('hop', true), 'now');
	assert.equal(whenToPlay('hop', false), 'now');
});

test('Only the catch move has particles, and exactly 3', () => {
	assert.equal(STATUS_PARTICLES, 3);
	assert.equal(particlesForMove('catch').length, 3);
	assert.equal(particlesForMove('hop').length, 0);
	assert.ok(STATUS_PARTICLE_LAYOUT.length >= 3, 'the layout has a position for each particle');
	for (const p of particlesForMove('catch')) {
		assert.ok(Math.abs(p.dx) <= 8 && Math.abs(p.dy) <= 8, 'particles stay within a few pixels of the sprite');
	}
});

test('Durations: hop 450 ms, catch 800 ms, both shorter than the 2 s cooldown', () => {
	assert.equal(STATUS_HOP_MS, 450);
	assert.equal(STATUS_CATCH_MS, 800);
	assert.equal(STATUS_COOLDOWN_MS, 2000);
	assert.equal(moveDuration('hop'), 450);
	assert.equal(moveDuration('catch'), 800);
});

// ---------- Cooldown (Sheikh 2026-11-19, 1a: a catch replaces a smaller move) ----------

test('Cooldown: the first move always plays; a repeat within 2 s does not; after 2 s it does', () => {
	assert.equal(mayPlay(null, 'hop', 0), true);
	assert.equal(mayPlay(null, 'catch', 0), true);
	assert.equal(mayPlay({ at: 1000, move: 'hop' }, 'hop', 1000 + 1999), false);
	assert.equal(mayPlay({ at: 1000, move: 'hop' }, 'hop', 1000 + 2000), true);
	assert.equal(mayPlay({ at: 1000, move: 'catch' }, 'catch', 1000 + 1999), false);
	assert.equal(mayPlay({ at: 1000, move: 'catch' }, 'catch', 1000 + 2000), true);
});

test('Cooldown: a catch replaces a hop within 2 s, but a hop never replaces a catch', () => {
	assert.equal(mayPlay({ at: 1000, move: 'hop' }, 'catch', 1100), true);
	assert.equal(mayPlay({ at: 1000, move: 'catch' }, 'hop', 1100), false);
	assert.equal(mayPlay({ at: 1000, move: 'catch' }, 'hop', 3000), true);
});

test('A bulk close plays one move, and a catch in it still shows as a catch', () => {
	// 10 closes 100 ms apart: progress, progress, a catch, then progress again.
	const kinds = ['counted', 'counted', 'caught', 'counted', 'counted', 'counted', 'counted', 'counted', 'counted', 'counted'] as const;
	let last: { at: number; move: 'hop' | 'catch' } | null = null;
	const played: string[] = [];
	kinds.forEach((k, i) => {
		const move = moveFor(k);
		const now = i * 100;
		if (move && mayPlay(last, move, now)) {
			last = { at: now, move };
			played.push(`${now}:${move}`);
		}
	});
	assert.deepEqual(played, ['0:hop', '200:catch']);
});

// ---------- Redraws (project-manager's read, finding 1: a redraw must not cancel a move) ----------

test('Redraw: the same Pokémon and art keeps the element, so a running move continues', () => {
	assert.equal(redrawAction({ dex: 25, sprite: null }, { dex: 25, sprite: null }), 'keep');
	assert.equal(redrawAction({ dex: 25, sprite: 'blob:a' }, { dex: 25, sprite: 'blob:a' }), 'keep');
});

test('Redraw: art changing on the same Pokémon swaps the art only; a new Pokémon replaces it', () => {
	assert.equal(redrawAction({ dex: 25, sprite: null }, { dex: 25, sprite: 'blob:a' }), 'swap-art');
	assert.equal(redrawAction({ dex: 25, sprite: 'blob:a' }, { dex: 25, sprite: null }), 'swap-art');
	assert.equal(redrawAction({ dex: 25, sprite: null }, { dex: 26, sprite: null }), 'replace');
});

test('Redraw: Hidden or no partner removes the mini sprite; turning it on adds it', () => {
	assert.equal(redrawAction({ dex: 25, sprite: null }, null), 'remove');
	assert.equal(redrawAction(null, null), 'none');
	assert.equal(redrawAction(null, { dex: 25, sprite: null }), 'create');
});

test('main.ts: Hidden passes no Pokémon, and the status bar text is drawn only through the mini partner', () => {
	assert.match(MAIN, /statusBarPartner === 'hidden' \? null : p/);
	assert.doesNotMatch(MAIN, /this\.statusBar\.setText\(/, 'a setText on the item would wipe the mini sprite and end a move');
});

// ---------- Reward window (Sheikh 2026-11-19: 9a, 3a) ----------

test('Reward window partner: hops when Animated, still when Still or reduced motion, absent when Hidden or none', () => {
	assert.equal(rewardPartnerView(true, 'animated', false), 'hop');
	assert.equal(rewardPartnerView(true, 'animated', true), 'still');
	assert.equal(rewardPartnerView(true, 'still', false), 'still');
	assert.equal(rewardPartnerView(true, 'hidden', false), 'none');
	assert.equal(rewardPartnerView(false, 'animated', false), 'none');
});

test("The catch's status bar move is hooked on the reward window's own close, called once", () => {
	assert.match(MAIN, /new RewardModal\([^)]*\(\) => void this\.openPokedex\(\), partner, \(\) => this\.playStatusMove\('catch'\)\)/);
	assert.match(REWARD, /onClose\(\): void \{\s*this\.contentEl\.empty\(\);\s*const done = this\.onClosed;\s*this\.onClosed = null;\s*done\?\.\(\);/);
	assert.match(MAIN, /private playStatusMove\(move: StatusMove\): void \{\s*if \(this\.unloading\) return;/, 'a queued move is dropped on unload');
});

// ---------- CSS ----------

test('CSS: the moves use transform only, particles take no clicks, reduced motion stops everything', () => {
	for (const k of ['sheiko-pokedex-mini-hop', 'sheiko-pokedex-mini-catch', 'sheiko-pokedex-reward-hop']) {
		const m = new RegExp(`@keyframes ${k} \\{([^\\n]*)\\}`).exec(CSS);
		assert.ok(m, k);
		assert.doesNotMatch(m[1]!, /top|bottom|margin|height|width/, `${k} must not change layout`);
	}
	assert.match(CSS, /\.sheiko-pokedex-status-particles \{[^}]*pointer-events: none/);
	assert.match(CSS, /\.sheiko-pokedex-status-particle \{[^}]*pointer-events: none/);
	assert.match(CSS, /\.sheiko-pokedex-status-mini \{[^}]*pointer-events: none/, 'clicks on the sprite reach the status bar item');
	const reduced = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)'));
	assert.match(reduced, /\.sheiko-pokedex-status-mini\.is-hop,\s*\.sheiko-pokedex-status-mini\.is-catch,\s*\.sheiko-pokedex-reward-partner\.is-hop \{ animation: none; \}/);
	assert.match(reduced, /\.sheiko-pokedex-status-particles \{ display: none; \}/);
});

test('CSS sizes (Sheikh 2026-11-19, (a)): status bar box 20 px, sprite 36 px; reward window box 40 px, sprite 72 px', () => {
	assert.match(CSS, /\.sheiko-pokedex-badge-mini \{ width: 20px; height: 20px;/);
	assert.match(CSS, /\.sheiko-pokedex-status-mini \{[^}]*width: 20px; height: 20px;/);
	assert.match(CSS, /\.sheiko-pokedex-badge-mini\.has-sprite \.sheiko-pokedex-sprite \{[^}]*width: 36px;\s*height: 36px;/);
	assert.match(CSS, /\.sheiko-pokedex-reward-partner \.sheiko-pokedex-badge-mini \{ width: 40px; height: 40px;/);
	assert.match(CSS, /\.sheiko-pokedex-reward-partner \.sheiko-pokedex-badge-mini\.has-sprite \.sheiko-pokedex-sprite \{ width: 72px; height: 72px; \}/);
});
