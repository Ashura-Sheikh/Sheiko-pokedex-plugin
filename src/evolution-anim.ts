// Game Boy evolution scene (Sheikh, 2026-10-12: option B flow, original green screen,
// calm mode for reduced motion). Timing follows Pokémon Red/Blue's EvolveMon routine in
// the pret/pokered disassembly (engine/movie/evolution.asm):
//   - 80 frames of the old Pokémon in colour, then the palette goes black (silhouettes)
//   - 8 cycles: a cancel-check pause of c frames (16, 14, ... 2), then b back-and-forth
//     swaps (1, 2, ... 8), each swap held 3 frames (Delay3); 72 swaps in total
//   - then the new Pokémon in colour. B is read every frame of every pause.
// Pure: no DOM, no timers. The window (ui/gameboy-evolve-modal.ts) plays it.

/** Game Boy frame rate: about 59.73 frames a second. */
export const GB_FRAME_MS = 1000 / 59.7275;

export type Pic = 'old' | 'new';

export type Step =
	| { kind: 'show'; pic: Pic; silhouette: boolean; frames: number }
	/** A pause where a cancel takes effect, with the given picture held on screen. */
	| { kind: 'pause'; pic: Pic; silhouette: boolean; frames: number }
	/** Calm mode: a cross-fade from the old to the new picture. */
	| { kind: 'fade'; frames: number };

export const INTRO_FRAMES = 80;
export const SWAP_FRAMES = 3;
export const CYCLES = 8;

/** The full Red/Blue sequence. Each cycle's swaps end on the old picture, as in the game. */
export function gameBoyTimeline(): Step[] {
	const steps: Step[] = [{ kind: 'show', pic: 'old', silhouette: false, frames: INTRO_FRAMES }];
	for (let b = 1, c = 16; c > 0; b++, c -= 2) {
		steps.push({ kind: 'pause', pic: 'old', silhouette: true, frames: c });
		for (let i = 0; i < b; i++) {
			steps.push({ kind: 'show', pic: 'new', silhouette: true, frames: SWAP_FRAMES });
			steps.push({ kind: 'show', pic: 'old', silhouette: true, frames: SWAP_FRAMES });
		}
	}
	return steps;
}

/** Calm mode (reduced motion or the setting): no flicker. A hold, then a slow cross-fade with pauses to cancel. */
export function calmTimeline(): Step[] {
	return [
		{ kind: 'show', pic: 'old', silhouette: false, frames: INTRO_FRAMES },
		{ kind: 'pause', pic: 'old', silhouette: true, frames: 40 },
		{ kind: 'fade', frames: 90 },
		{ kind: 'pause', pic: 'new', silhouette: true, frames: 20 },
	];
}

export function totalFrames(steps: Step[]): number {
	return steps.reduce((n, s) => n + s.frames, 0);
}

export type Outcome = 'evolved' | 'cancelled';

export interface Player {
	/** Draws a step (show/pause: a picture; fade: the cross-fade, given its duration). */
	render(step: Step): void;
	wait(ms: number): Promise<void>;
	/** True once B / Esc / Stop has been pressed (held or tapped). */
	cancelRequested(): boolean;
	/** Stone evolutions can't be stopped, as in the game. */
	cancellable: boolean;
}

/**
 * Plays the steps. A cancel request is honoured at the next pause (the only time Red/Blue
 * reads B), so pressing or holding B any time during the scene stops it, as in the game.
 */
export async function play(steps: Step[], p: Player): Promise<Outcome> {
	for (const step of steps) {
		p.render(step);
		await p.wait(step.frames * GB_FRAME_MS);
		if (step.kind === 'pause' && p.cancellable && p.cancelRequested()) return 'cancelled';
	}
	return 'evolved';
}

// ---------- Original Game Boy (DMG) green screen ----------

/** The 4 DMG shades, lightest first. The lightest is also the screen background. */
export const DMG_SHADES = ['#9bbc0f', '#8bac0f', '#306230', '#0f380f'] as const;

/** Maps a colour to a DMG shade index (0 lightest … 3 darkest) by brightness. */
export function dmgShade(r: number, g: number, b: number): 0 | 1 | 2 | 3 {
	const lum = 0.299 * r + 0.587 * g + 0.114 * b;
	if (lum >= 192) return 0;
	if (lum >= 128) return 1;
	if (lum >= 64) return 2;
	return 3;
}

/**
 * Converts RGBA pixels in place: transparent stays transparent (the screen shows through),
 * opaque pixels become their DMG shade, or the darkest shade for a silhouette.
 */
export function toDmg(pixels: Uint8ClampedArray, silhouette: boolean): void {
	const rgb = DMG_SHADES.map((h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
	for (let i = 0; i < pixels.length; i += 4) {
		if (pixels[i + 3]! < 128) {
			pixels[i + 3] = 0;
			continue;
		}
		const shade = silhouette ? 3 : dmgShade(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!);
		const c = rgb[shade]!;
		pixels[i] = c[0]!;
		pixels[i + 1] = c[1]!;
		pixels[i + 2] = c[2]!;
		pixels[i + 3] = 255;
	}
}

/** Red/Blue's lines, names in capitals as the game shows them (data/text/text_3.asm). */
export const evolutionText = {
	start: (from: string) => `What? ${from.toUpperCase()}\nis evolving!`,
	done: (from: string, to: string) => `${from.toUpperCase()} evolved\ninto ${to.toUpperCase()}!`,
	stopped: (from: string) => `Huh? ${from.toUpperCase()}\nstopped evolving!`,
};
