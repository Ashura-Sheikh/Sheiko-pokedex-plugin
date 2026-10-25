import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
	ALL_TYPES,
	ANIM_COOLDOWN_MS,
	ANIM_DURATION_MS,
	ANIM_MODES,
	MAX_PARTICLES,
	PARTICLE_MS,
	TYPE_ANIMS,
	animFor,
	cooldownPassed,
	effectiveMode,
	parseAnimMode,
	particlesFor,
} from '../src/partner-anim';
import { DEFAULT_SETTINGS, freshData, normalizeData } from '../src/store';
import { seededRandom } from '../src/rarity';
import { speciesUpTo } from '../src/gens';
/** Gen 1's species: these tests check Gen 1 behaviour, as before 2.0.0. */
const GEN1 = speciesUpTo(1);

const NOW = new Date('2026-10-25T12:00:00Z');
// Tests run from test-dist/, one level below the repo root (see test/run.mjs).
const CSS = readFileSync(path.join(process.cwd(), 'styles.css'), 'utf8');

// ---------- Mode (Sheikh 2026-10-25: default Calm; reduced motion gives Calm) ----------

test('the mode played: Off stays off, reduced motion turns Full into Calm', () => {
	assert.equal(effectiveMode('full', false), 'full');
	assert.equal(effectiveMode('full', true), 'calm');
	assert.equal(effectiveMode('calm', false), 'calm');
	assert.equal(effectiveMode('calm', true), 'calm');
	assert.equal(effectiveMode('off', false), 'off');
	assert.equal(effectiveMode('off', true), 'off');
});

test('the setting defaults to Calm, for new installs and for existing users', () => {
	assert.equal(DEFAULT_SETTINGS.partnerAnimation, 'calm');
	assert.equal(freshData(NOW).settings.partnerAnimation, 'calm');
	const from140 = normalizeData({ version: 3, settings: { dailyCap: 5 }, capUpgrade: 'done' }, NOW);
	assert.equal(from140.settings.partnerAnimation, 'calm', 'data from 1.4.0 has no setting');
});

test('a saved mode is kept; anything unknown becomes Calm', () => {
	for (const m of ANIM_MODES) {
		assert.equal(normalizeData({ version: 3, settings: { partnerAnimation: m }, capUpgrade: 'done' }, NOW).settings.partnerAnimation, m);
	}
	for (const bad of ['loud', '', 1, null, true]) assert.equal(parseAnimMode(bad), 'calm', String(bad));
});

// ---------- Cooldown and length (#31: about 1 s, a short cooldown) ----------

test('one run is about a second, and the cooldown is longer than a run', () => {
	assert.ok(ANIM_DURATION_MS >= 800 && ANIM_DURATION_MS <= 1200);
	assert.ok(ANIM_COOLDOWN_MS > ANIM_DURATION_MS);
});

test('cooldown: the first run always starts; another waits for the cooldown', () => {
	assert.equal(cooldownPassed(null, 0), true);
	assert.equal(cooldownPassed(1000, 1000), false, 'same moment');
	assert.equal(cooldownPassed(1000, 1000 + ANIM_COOLDOWN_MS - 1), false, 'just before');
	assert.equal(cooldownPassed(1000, 1000 + ANIM_COOLDOWN_MS), true, 'exactly at the cooldown');
});

// ---------- Type → animation (all 18 types) ----------

test('every one of the 18 types has a motion and an effect', () => {
	assert.equal(ALL_TYPES.length, 18);
	assert.deepEqual(Object.keys(TYPE_ANIMS).sort(), [...ALL_TYPES].sort(), 'no type missing, none extra');
	for (const t of ALL_TYPES) {
		const a = TYPE_ANIMS[t];
		assert.ok(a.motion && a.effect, t);
		assert.ok(a.particles >= 0 && a.particles <= MAX_PARTICLES, t);
		assert.equal(a.particles === 0, a.effect === 'none' || a.effect === 'glow' || a.effect === 'shadow' || a.effect === 'shine', `${t}: particles only for particle effects`);
	}
});

test('every type in the Gen 1 data is in the table', () => {
	for (const s of GEN1) for (const t of s.types) assert.ok(t in TYPE_ANIMS, `${s.name}: ${t}`);
});

test("the partner's primary type decides; Fire gives flames (#31's example)", () => {
	const charizard = GEN1[5]!;
	assert.deepEqual(charizard.types, ['fire', 'flying']);
	assert.equal(animFor(charizard.types).effect, 'flames');
	assert.equal(animFor(['water', 'fire']).effect, 'splash', 'primary only');
	assert.equal(animFor(['electric']).effect, 'sparks');
	assert.equal(animFor(['ghost']).motion, 'fade');
	assert.equal(animFor([]).type, 'normal');
	assert.equal(animFor(['shadow']).type, 'normal', 'unknown types animate like Normal');
});

// ---------- Particles ----------

test('particles: within the card, within the run, and capped', () => {
	for (const t of ALL_TYPES) {
		const a = TYPE_ANIMS[t];
		const parts = particlesFor(a, seededRandom(42));
		assert.equal(parts.length, a.particles, t);
		for (const p of parts) {
			assert.ok(p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 100, `${t}: starts on the card`);
			assert.ok(p.delay + PARTICLE_MS <= ANIM_DURATION_MS, `${t}: ends within the run`);
			assert.ok(p.size > 0 && p.size <= 20, t);
		}
	}
	assert.equal(particlesFor({ motion: 'bounce', effect: 'flames', particles: 99 }, seededRandom(1)).length, MAX_PARTICLES);
});

test('flames rise and leaves fall', () => {
	for (const p of particlesFor(TYPE_ANIMS.fire, seededRandom(7))) assert.ok(p.dy < 0);
	for (const p of particlesFor(TYPE_ANIMS.grass, seededRandom(7))) assert.ok(p.dy > 0);
});

// ---------- Stylesheet: no loops, no flashing, every motion and effect drawn ----------

test('styles.css: no animation loops forever', () => {
	assert.equal(/infinite/.test(CSS), false);
	const counts = [...CSS.matchAll(/animation-iteration-count:\s*([^;}]+)/g)].map((m) => m[1]!.trim());
	assert.ok(counts.length > 0, 'the rule is there to check');
	assert.deepEqual([...new Set(counts)], ['1'], 'only a count of 1');
});

test('styles.css: every motion has a keyframe rule, and every particle effect has a style', () => {
	const motions = new Set(Object.values(TYPE_ANIMS).map((a) => a.motion));
	for (const m of motions) {
		assert.ok(CSS.includes(`[data-motion='${m}']`), `motion ${m}: selector`);
		assert.ok(CSS.includes(`@keyframes sheiko-pokedex-${m} `), `motion ${m}: keyframes`);
	}
	for (const a of Object.values(TYPE_ANIMS)) {
		if (a.particles > 0) assert.ok(CSS.includes(`.fx-${a.effect} `), `effect ${a.effect}: style`);
	}
	assert.ok(CSS.includes("[data-effect='glow']") && CSS.includes("[data-effect='shine']"), 'badge-only effects');
	assert.ok(CSS.includes('prefers-reduced-motion'), 'safety net');
});
