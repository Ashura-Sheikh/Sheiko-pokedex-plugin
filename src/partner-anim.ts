// Partner animation (1.5.0, issue #31; Sheikh's decisions 2026-10-25).
// Hovering or focusing the partner's hero card plays a short animation: a movement plus a small
// effect for the partner's primary type. Full / Calm (default) / Off; reduced motion gives Calm.
// This file has no Obsidian or DOM code, so the rules can be tested. The page side is in
// src/ui/partner-anim-ui.ts.

export type AnimMode = 'full' | 'calm' | 'off';
export const ANIM_MODES: readonly AnimMode[] = ['full', 'calm', 'off'];
export const ANIM_MODE_LABELS: Record<AnimMode, string> = {
	full: 'Full: movement and a type effect',
	calm: 'Calm: a soft glow, no movement',
	off: 'Off',
};

/** About one second (#31), never looped. */
export const ANIM_DURATION_MS = 1000;
/** Counted from the start of a run, so retriggering waits a second after it ends. */
export const ANIM_COOLDOWN_MS = 2000;
/** Upper bound on generated particles per run, to keep it light. */
export const MAX_PARTICLES = 8;

/** The mode actually played: Off stays off; reduced motion turns Full into Calm. */
export function effectiveMode(setting: AnimMode, reducedMotion: boolean): AnimMode {
	if (setting === 'off') return 'off';
	if (reducedMotion) return 'calm';
	return setting;
}

/** Reads a saved setting; anything unknown falls back to the default, Calm. */
export function parseAnimMode(v: unknown): AnimMode {
	return ANIM_MODES.includes(v as AnimMode) ? (v as AnimMode) : 'calm';
}

/** True when a run may start: never run yet, or the cooldown has passed. */
export function cooldownPassed(lastStart: number | null, now: number): boolean {
	return lastStart === null || now - lastStart >= ANIM_COOLDOWN_MS;
}

/** How the card moves (Full only). Each is a single out-and-back, ending where it started. */
export type Motion = 'bounce' | 'shake' | 'float' | 'rise' | 'tilt' | 'slide' | 'pulse' | 'fade';

/** What appears around the card (Full only). Plain CSS shapes, no images. */
export type Effect =
	| 'flames'
	| 'splash'
	| 'sparks'
	| 'leaves'
	| 'frost'
	| 'glow'
	| 'shadow'
	| 'gust'
	| 'dust'
	| 'bubbles'
	| 'stars'
	| 'impact'
	| 'scales'
	| 'shine'
	| 'hearts'
	| 'swirl'
	| 'none';

export interface TypeAnim {
	motion: Motion;
	effect: Effect;
	/** How many particles the effect spawns (0 for none). */
	particles: number;
}

/** All 18 types. Gen 1 has 17 (no Dark); Dark is here for later Gens. */
export const ALL_TYPES = [
	'normal',
	'fire',
	'water',
	'grass',
	'electric',
	'ice',
	'fighting',
	'poison',
	'ground',
	'flying',
	'psychic',
	'bug',
	'rock',
	'ghost',
	'dragon',
	'dark',
	'steel',
	'fairy',
] as const;
export type TypeName = (typeof ALL_TYPES)[number];

/** The issue's examples, plus one for each other type (Technical Lead's choice). */
export const TYPE_ANIMS: Record<TypeName, TypeAnim> = {
	normal: { motion: 'bounce', effect: 'none', particles: 0 },
	fire: { motion: 'bounce', effect: 'flames', particles: 7 },
	water: { motion: 'bounce', effect: 'splash', particles: 6 },
	grass: { motion: 'tilt', effect: 'leaves', particles: 5 },
	electric: { motion: 'shake', effect: 'sparks', particles: 6 },
	ice: { motion: 'shake', effect: 'frost', particles: 6 },
	fighting: { motion: 'slide', effect: 'impact', particles: 4 },
	poison: { motion: 'pulse', effect: 'bubbles', particles: 6 },
	ground: { motion: 'bounce', effect: 'dust', particles: 6 },
	flying: { motion: 'rise', effect: 'gust', particles: 4 },
	psychic: { motion: 'float', effect: 'glow', particles: 0 },
	bug: { motion: 'shake', effect: 'leaves', particles: 4 },
	rock: { motion: 'bounce', effect: 'dust', particles: 5 },
	ghost: { motion: 'fade', effect: 'shadow', particles: 0 },
	dragon: { motion: 'rise', effect: 'scales', particles: 6 },
	dark: { motion: 'slide', effect: 'swirl', particles: 5 },
	steel: { motion: 'tilt', effect: 'shine', particles: 0 },
	fairy: { motion: 'float', effect: 'hearts', particles: 5 },
};

/** The partner's primary type decides the animation; unknown types animate like Normal. */
export function animFor(types: readonly string[]): TypeAnim & { type: TypeName } {
	const t = types[0];
	const type: TypeName = t && t in TYPE_ANIMS ? (t as TypeName) : 'normal';
	return { type, ...TYPE_ANIMS[type] };
}

/** One generated particle: where it starts (% of the card art) and how far it travels (px). */
export interface Particle {
	x: number;
	y: number;
	dx: number;
	dy: number;
	/** ms after the run starts. */
	delay: number;
	/** px. */
	size: number;
}

/**
 * Lays out the particles for one run. `rand` returns [0, 1); tests pass a seeded one.
 * Everything starts and ends inside the run's one second.
 */
export function particlesFor(anim: TypeAnim, rand: () => number): Particle[] {
	const n = Math.min(MAX_PARTICLES, Math.max(0, anim.particles));
	const out: Particle[] = [];
	for (let i = 0; i < n; i++) {
		const spread = (i + 0.5) / n; // even spread across the card, jittered below
		const jitter = (rand() - 0.5) * 0.15;
		const up = anim.effect === 'flames' || anim.effect === 'bubbles' || anim.effect === 'scales' || anim.effect === 'hearts';
		const down = anim.effect === 'leaves' || anim.effect === 'frost';
		const out1: Particle = {
			x: Math.round(Math.min(95, Math.max(5, (spread + jitter) * 100))),
			y: up ? 75 : down ? 15 : 50,
			dx: Math.round((rand() - 0.5) * 60),
			dy: Math.round(up ? -40 - rand() * 40 : down ? 30 + rand() * 40 : (rand() - 0.5) * 60),
			delay: Math.round(rand() * 250),
			size: Math.round(6 + rand() * 8),
		};
		out.push(out1);
	}
	return out;
}

/** Each particle's own fade runs this long, so delay + this stays within the run. */
export const PARTICLE_MS = 700;
