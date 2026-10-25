// Partner animation on the hero card (1.5.0, issue #31). The rules are in src/partner-anim.ts.
// One animator per drawn hero card. The view calls destroy() before every redraw and when it
// closes, which removes the listeners, timers, classes and particles it added.

import {
	ANIM_DURATION_MS,
	AnimMode,
	PARTICLE_MS,
	animFor,
	cooldownPassed,
	effectiveMode,
	particlesFor,
} from '../partner-anim';

export interface PartnerAnimOptions {
	/** The whole hero card: hover and keyboard focus on it start a run. */
	panel: HTMLElement;
	/** The badge's wrapper: it moves, and particles appear around it. */
	art: HTMLElement;
	types: readonly string[];
	/** The partner's primary type colour, for the Calm glow and the effects. */
	colour: string;
	/** Read at each run, so a setting change applies straight away. */
	getMode: () => AnimMode;
}

const RUN_CLASSES = ['is-anim-full', 'is-anim-calm'];

export class PartnerAnimator {
	private lastStart: number | null = null;
	private endTimer: number | null = null;
	private layer: HTMLElement | null = null;
	private readonly onEnter = () => this.play();
	private readonly onFocusIn = (e: FocusEvent) => {
		// Only when focus arrives from outside the card, not when moving between its buttons.
		const from = e.relatedTarget;
		if (from instanceof Node && this.o.panel.contains(from)) return;
		this.play();
	};

	constructor(private o: PartnerAnimOptions) {
		o.panel.addEventListener('pointerenter', this.onEnter);
		o.panel.addEventListener('focusin', this.onFocusIn);
		o.panel.style.setProperty('--sheiko-pokedex-anim-colour', o.colour);
	}

	/** Starts a run if the mode allows it and the cooldown has passed. Returns the mode played. */
	play(): AnimMode {
		const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		const mode = effectiveMode(this.o.getMode(), reduced);
		if (mode === 'off') return 'off';
		const now = Date.now();
		if (!cooldownPassed(this.lastStart, now)) return 'off';
		this.lastStart = now;
		this.stopRun();

		const anim = animFor(this.o.types);
		const { panel, art } = this.o;
		if (mode === 'calm') {
			panel.addClass('is-anim-calm');
		} else {
			panel.addClass('is-anim-full');
			art.dataset.motion = anim.motion;
			art.dataset.effect = anim.effect;
			const parts = particlesFor(anim, Math.random);
			if (parts.length) {
				const layer = art.createDiv({ cls: 'sheiko-pokedex-anim-layer' });
				layer.setAttr('aria-hidden', 'true');
				for (const p of parts) {
					const el = layer.createSpan({ cls: `sheiko-pokedex-particle fx-${anim.effect}` });
					el.style.setProperty('--x', `${p.x}%`);
					el.style.setProperty('--y', `${p.y}%`);
					el.style.setProperty('--dx', `${p.dx}px`);
					el.style.setProperty('--dy', `${p.dy}px`);
					el.style.setProperty('--size', `${p.size}px`);
					el.style.setProperty('--delay', `${p.delay}ms`);
					el.style.setProperty('--dur', `${PARTICLE_MS}ms`);
				}
				this.layer = layer;
			}
		}
		this.endTimer = window.setTimeout(() => this.stopRun(), ANIM_DURATION_MS);
		return mode;
	}

	/** Ends the current run, if any: classes, data attributes, particles and its timer. */
	private stopRun(): void {
		if (this.endTimer !== null) {
			window.clearTimeout(this.endTimer);
			this.endTimer = null;
		}
		this.o.panel.removeClasses(RUN_CLASSES);
		delete this.o.art.dataset.motion;
		delete this.o.art.dataset.effect;
		this.layer?.remove();
		this.layer = null;
	}

	/** Removes everything this animator added. Safe to call more than once. */
	destroy(): void {
		this.stopRun();
		this.o.panel.removeEventListener('pointerenter', this.onEnter);
		this.o.panel.removeEventListener('focusin', this.onFocusIn);
	}
}
