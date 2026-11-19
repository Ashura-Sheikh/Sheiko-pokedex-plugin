// Status bar partner (2.1.0, issue #53; Sheikh's decisions 2026-11-19).
// A mini sprite (or badge) of the partner sits next to the "Pikachu Lv 22" text and hops when a
// closed task counts: a small hop for progress, a bigger hop with particles for a catch. It sits
// still between closes. Setting: Animated (default) / Still / Hidden. Reduced motion gives Still.
// This file has no Obsidian or DOM code, so the rules can be tested. The page side is in
// src/ui/statusbar-anim-ui.ts.

export type StatusBarMode = 'animated' | 'still' | 'hidden';
export const STATUS_BAR_MODES: readonly StatusBarMode[] = ['animated', 'still', 'hidden'];
export const STATUS_BAR_MODE_LABELS: Record<StatusBarMode, string> = {
	animated: 'Animated: hops when a close counts',
	still: 'Still: shown, no movement',
	hidden: 'Hidden: text only',
};
export const DEFAULT_STATUS_BAR_MODE: StatusBarMode = 'animated';

/** Reads a saved setting; anything missing (data from 2.0.0 or earlier) or unknown → Animated. */
export function parseStatusBarMode(v: unknown): StatusBarMode {
	return STATUS_BAR_MODES.includes(v as StatusBarMode) ? (v as StatusBarMode) : DEFAULT_STATUS_BAR_MODE;
}

/** The mode actually used: Hidden stays hidden; reduced motion turns Animated into Still. */
export function effectiveStatusMode(setting: StatusBarMode, reducedMotion: boolean): StatusBarMode {
	if (setting === 'hidden') return 'hidden';
	if (reducedMotion) return 'still';
	return setting;
}

/** `hop`: progress toward the next catch. `catch`: a new catch (bigger hop + particles). */
export type StatusMove = 'hop' | 'catch';

/** A close's outcome, as `decide()` in store.ts reports it. */
export type CloseKind = 'already' | 'excluded' | 'capped' | 'counted' | 'caught';

/**
 * Which move a close earns (Sheikh, 2026-11-19): a catch gets the catch move, progress gets a
 * hop, everything else (already handled, excluded, daily limit reached, even with a level-up)
 * gets none.
 */
export function moveFor(kind: CloseKind): StatusMove | null {
	if (kind === 'caught') return 'catch';
	if (kind === 'counted') return 'hop';
	return null;
}

/**
 * When the move plays: a catch with the reward window on waits until the window closes
 * (Sheikh, 2026-11-19, 9a); everything else plays straight away.
 */
export function whenToPlay(move: StatusMove, rewardWindowOn: boolean): 'now' | 'after-reward-window' {
	return move === 'catch' && rewardWindowOn ? 'after-reward-window' : 'now';
}

/** Same cooldown as the hero card, counted from the start of a move. */
export const STATUS_COOLDOWN_MS = 2000;
export const STATUS_HOP_MS = 450;
export const STATUS_CATCH_MS = 800;
/** Particles around the mini sprite for a catch. Hard number (Sheikh, 2026-11-19: 2–3). */
export const STATUS_PARTICLES = 3;

export function moveDuration(move: StatusMove): number {
	return move === 'catch' ? STATUS_CATCH_MS : STATUS_HOP_MS;
}

export interface LastMove {
	at: number;
	move: StatusMove;
}

/**
 * Whether a move may start now. Outside the cooldown, always. Inside it, only a catch replacing
 * a smaller hop (Sheikh, 2026-11-19, 1a); so a bulk close plays one move, and a catch in it still
 * shows as a catch.
 */
export function mayPlay(last: LastMove | null, move: StatusMove, now: number): boolean {
	if (last === null || now - last.at >= STATUS_COOLDOWN_MS) return true;
	return move === 'catch' && last.move === 'hop';
}

/** One particle: where it starts on the sprite (%), and how far it drifts (px). Fixed, no randomness. */
export interface StatusParticle {
	x: number;
	y: number;
	dx: number;
	dy: number;
	delay: number;
}

/** Left, up and right of the sprite, kept within a few pixels of it. */
export const STATUS_PARTICLE_LAYOUT: readonly StatusParticle[] = [
	{ x: 10, y: 40, dx: -6, dy: -5, delay: 0 },
	{ x: 50, y: 5, dx: 0, dy: -7, delay: 60 },
	{ x: 90, y: 40, dx: 6, dy: -5, delay: 120 },
];

export function particlesForMove(move: StatusMove): readonly StatusParticle[] {
	return move === 'catch' ? STATUS_PARTICLE_LAYOUT.slice(0, STATUS_PARTICLES) : [];
}

/** What's on screen in the status bar: which Pokémon, and whether its sprite (or a badge) is shown. */
export interface MiniKey {
	dex: number;
	sprite: string | null;
}

/**
 * What a status bar redraw does with the mini sprite. Every close redraws the status bar, so a
 * redraw must not cancel a running move (project-manager's pre-build read, finding 1):
 * - `none`: no mini sprite and none wanted (Hidden or no partner).
 * - `remove`: take it away, ending any move (setting turned to Hidden, or no partner).
 * - `create`: add it.
 * - `keep`: same Pokémon, same art: text changes only, a running move continues.
 * - `swap-art`: same Pokémon, art changed (sprites downloaded or removed): the art is replaced
 *   inside the element that moves, so a running move continues.
 * - `replace`: a different Pokémon (partner changed or evolved): new art, any move ends.
 */
export type RedrawAction = 'none' | 'remove' | 'create' | 'keep' | 'swap-art' | 'replace';

export function redrawAction(shown: MiniKey | null, wanted: MiniKey | null): RedrawAction {
	if (wanted === null) return shown === null ? 'none' : 'remove';
	if (shown === null) return 'create';
	if (shown.dex !== wanted.dex) return 'replace';
	return shown.sprite === wanted.sprite ? 'keep' : 'swap-art';
}

/**
 * The partner in the reward window (Sheikh, 2026-11-19, 9a + 3a): a mini sprite by the caught
 * Pokémon that hops once. Still: shown, no hop. Hidden or no partner: not shown. Reduced motion:
 * no hop.
 */
export function rewardPartnerView(hasPartner: boolean, setting: StatusBarMode, reducedMotion: boolean): 'none' | 'still' | 'hop' {
	if (!hasPartner) return 'none';
	const mode = effectiveStatusMode(setting, reducedMotion);
	if (mode === 'hidden') return 'none';
	return mode === 'still' ? 'still' : 'hop';
}
