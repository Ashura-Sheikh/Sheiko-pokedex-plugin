// Status bar partner (2.1.0, issue #53). The rules are in src/statusbar-anim.ts.
// Owns the mini sprite inside the status bar item. Every close redraws the status bar, so
// render() updates in place and only ends a running move when the partner changes, the setting
// turns to Hidden, or there is no partner (project-manager's pre-build read, finding 1).

import { Species } from '../species';
import {
	LastMove,
	MiniKey,
	StatusBarMode,
	StatusMove,
	mayPlay,
	moveDuration,
	particlesForMove,
	redrawAction,
} from '../statusbar-anim';
import { renderBadge, spriteFor, typeColour } from './art';

const MOVE_CLASSES = ['is-hop', 'is-catch'];

export class StatusBarPartner {
	/** The element that moves. Holds the art slot and, during a catch, the particles. */
	private mini: HTMLElement | null = null;
	private art: HTMLElement | null = null;
	private text: HTMLElement | null = null;
	private shown: MiniKey | null = null;
	private layer: HTMLElement | null = null;
	private endTimer: number | null = null;
	private last: LastMove | null = null;

	constructor(private host: HTMLElement) {}

	/** Draws the text, and the mini sprite for `partner` (null: Hidden or no partner, text only). */
	render(text: string, partner: Species | null): void {
		const wanted: MiniKey | null = partner ? { dex: partner.dex, sprite: spriteFor(partner.dex) } : null;
		const action = redrawAction(this.shown, wanted);
		if (action === 'none' || action === 'remove') {
			this.removeMini();
			// Exactly as 2.0.0: the item holds only its text.
			this.host.setText(text);
			return;
		}
		if (!partner) return;
		if (action === 'create') {
			this.host.empty();
			this.host.addClass('has-mini');
			this.mini = this.host.createSpan({ cls: 'sheiko-pokedex-status-mini' });
			this.mini.setAttr('aria-hidden', 'true');
			this.art = this.mini.createSpan({ cls: 'sheiko-pokedex-status-art' });
			this.text = this.host.createSpan({ cls: 'sheiko-pokedex-status-text' });
		}
		if (action === 'replace') this.stopRun();
		if (action === 'create' || action === 'replace' || action === 'swap-art') {
			this.art?.empty();
			if (this.art) renderBadge(this.art, partner, true, 'mini');
			this.mini?.style.setProperty('--sheiko-pokedex-anim-colour', typeColour(partner.types[0] ?? 'normal'));
		}
		this.shown = wanted;
		this.text?.setText(text);
	}

	/** Plays a move if the mode is Animated and the cooldown allows it. Returns true if it played. */
	play(move: StatusMove, mode: StatusBarMode): boolean {
		const mini = this.mini;
		if (!mini || mode !== 'animated') return false;
		const now = Date.now();
		if (!mayPlay(this.last, move, now)) return false;
		this.last = { at: now, move };
		this.stopRun();
		// Reading a layout value restarts the CSS animation when the same class is added again.
		void mini.offsetWidth;
		mini.addClass(`is-${move}`);
		const parts = particlesForMove(move);
		if (parts.length) {
			const layer = mini.createSpan({ cls: 'sheiko-pokedex-status-particles' });
			for (const p of parts) {
				const el = layer.createSpan({ cls: 'sheiko-pokedex-status-particle' });
				el.style.setProperty('--x', `${p.x}%`);
				el.style.setProperty('--y', `${p.y}%`);
				el.style.setProperty('--dx', `${p.dx}px`);
				el.style.setProperty('--dy', `${p.dy}px`);
				el.style.setProperty('--delay', `${p.delay}ms`);
			}
			this.layer = layer;
		}
		this.endTimer = window.setTimeout(() => this.stopRun(), moveDuration(move));
		return true;
	}

	/** Ends the current move, if any: its classes, particles and timer. */
	private stopRun(): void {
		if (this.endTimer !== null) {
			window.clearTimeout(this.endTimer);
			this.endTimer = null;
		}
		this.mini?.removeClasses(MOVE_CLASSES);
		this.layer?.remove();
		this.layer = null;
	}

	private removeMini(): void {
		this.stopRun();
		this.mini?.remove();
		this.text?.remove();
		this.mini = null;
		this.art = null;
		this.text = null;
		this.shown = null;
		this.host.removeClass('has-mini');
	}

	/** Removes everything this added. Safe to call more than once. */
	destroy(): void {
		this.removeMini();
	}
}
