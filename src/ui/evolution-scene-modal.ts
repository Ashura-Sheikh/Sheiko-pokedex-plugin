import { App, Modal } from 'obsidian';
import { Species } from '../species';
import {
	DMG_SHADES,
	GB_FRAME_MS,
	Outcome,
	Pic,
	Step,
	calmTimeline,
	evolutionText,
	evolutionTimeline,
	play,
	toDmg,
} from '../evolution-anim';
import { spriteFor } from './art';

const PX = 96;

/** Loads a picture into 96×96 RGBA pixels: the sprite if there is one, else the placeholder letter. */
async function loadPixels(species: Species): Promise<ImageData> {
	const canvas = createEl('canvas');
	canvas.width = PX;
	canvas.height = PX;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('no 2d context');
	const sprite = spriteFor(species.dex);
	if (sprite) {
		const img = new Image();
		img.src = sprite;
		await img.decode();
		ctx.drawImage(img, 0, 0, PX, PX);
	} else {
		ctx.fillStyle = '#505050';
		ctx.font = 'bold 64px sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(species.name.charAt(0), PX / 2, PX / 2 + 4);
	}
	return ctx.getImageData(0, 0, PX, PX);
}

function dmgCopy(src: ImageData, silhouette: boolean): ImageData {
	const out = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
	toDmg(out.data, silhouette);
	return out;
}

export interface EvolutionSceneOptions {
	/** Level evolutions can be stopped (B / Stop / closing the window); stone ones can't. */
	cancellable: boolean;
	/** Calm mode: no flicker (reduced-motion system setting or the plugin setting). */
	calm: boolean;
	/** Called once, when the outcome is known (before the closing text is read). */
	onResult: (outcome: Outcome) => void;
}

/**
 * The Red/Blue evolution scene on an original Game Boy green screen
 * (Sheikh, 2026-10-12: flow B, look 2, calm mode for reduced motion).
 */
export class EvolutionSceneModal extends Modal {
	private cancel = false;
	private closed = false;
	private delivered = false;
	private layers: Record<Pic, HTMLCanvasElement> | null = null;
	private frames: Record<Pic, { colour: ImageData; silhouette: ImageData }> | null = null;
	private textEl: HTMLElement | null = null;
	private buttons: HTMLElement | null = null;

	constructor(
		app: App,
		private from: Species,
		private to: Species,
		private opts: EvolutionSceneOptions,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('sheiko-pokedex-gb');
		const screen = contentEl.createDiv({ cls: 'sheiko-pokedex-gb-screen' });
		screen.style.setProperty('--gb-0', DMG_SHADES[0]);
		screen.style.setProperty('--gb-1', DMG_SHADES[1]);
		screen.style.setProperty('--gb-2', DMG_SHADES[2]);
		screen.style.setProperty('--gb-3', DMG_SHADES[3]);
		const stage = screen.createDiv({ cls: 'sheiko-pokedex-gb-stage' });
		const mk = (pic: Pic) => {
			const c = stage.createEl('canvas', { cls: `sheiko-pokedex-gb-pic gb-${pic}` });
			c.width = PX;
			c.height = PX;
			return c;
		};
		this.layers = { old: mk('old'), new: mk('new') };
		this.textEl = screen.createDiv({ cls: 'sheiko-pokedex-gb-text' });
		this.textEl.setText(evolutionText.start(this.from.name));
		this.buttons = contentEl.createDiv({ cls: 'modal-button-container' });
		if (this.opts.cancellable) {
			contentEl.createDiv({ cls: 'sheiko-pokedex-gb-hint', text: 'Press B (or Stop) to stop the evolution.' });
			const stop = this.buttons.createEl('button', { text: 'Stop' });
			stop.addEventListener('click', () => (this.cancel = true));
			this.scope.register([], 'b', () => {
				this.cancel = true;
				return false;
			});
		}
		void this.run();
	}

	private async run(): Promise<void> {
		try {
			const [a, b] = await Promise.all([loadPixels(this.from), loadPixels(this.to)]);
			this.frames = {
				old: { colour: dmgCopy(a, false), silhouette: dmgCopy(a, true) },
				new: { colour: dmgCopy(b, false), silhouette: dmgCopy(b, true) },
			};
		} catch (e) {
			console.error('[Sheiko Pokedex] Evolution pictures failed to load', e);
		}
		const steps = this.opts.calm ? calmTimeline() : evolutionTimeline();
		const outcome = await play(steps, {
			render: (s) => this.render(s),
			wait: (ms) => (this.closed ? Promise.resolve() : new Promise((r) => window.setTimeout(r, ms))),
			cancelRequested: () => this.cancel,
			cancellable: this.opts.cancellable,
		});
		this.finish(outcome);
	}

	private draw(pic: Pic, silhouette: boolean): void {
		if (!this.layers || !this.frames) return;
		const ctx = this.layers[pic].getContext('2d');
		ctx?.putImageData(silhouette ? this.frames[pic].silhouette : this.frames[pic].colour, 0, 0);
	}

	private showOnly(pic: Pic, fadeMs = 0): void {
		if (!this.layers) return;
		for (const p of ['old', 'new'] as Pic[]) {
			const el = this.layers[p];
			el.style.setProperty('transition', fadeMs ? `opacity ${fadeMs}ms linear` : 'none');
			el.style.setProperty('opacity', p === pic ? '1' : '0');
		}
	}

	private render(step: Step): void {
		if (this.closed) return;
		if (step.kind === 'fade') {
			this.draw('old', true);
			this.draw('new', true);
			this.showOnly('new', step.frames * GB_FRAME_MS);
			return;
		}
		this.draw(step.pic, step.silhouette);
		this.showOnly(step.pic);
	}

	private finish(outcome: Outcome): void {
		this.deliver(outcome);
		if (this.closed) return;
		const pic: Pic = outcome === 'evolved' ? 'new' : 'old';
		this.draw(pic, false);
		this.showOnly(pic);
		this.textEl?.setText(
			outcome === 'evolved' ? evolutionText.done(this.from.name, this.to.name) : evolutionText.stopped(this.from.name),
		);
		this.contentEl.querySelector('.sheiko-pokedex-gb-hint')?.remove();
		if (this.buttons) {
			this.buttons.empty();
			const ok = this.buttons.createEl('button', { cls: 'mod-cta', text: 'OK' });
			ok.addEventListener('click', () => this.close());
			window.setTimeout(() => ok.focus(), 0);
		}
	}

	private deliver(outcome: Outcome): void {
		if (this.delivered) return;
		this.delivered = true;
		this.opts.onResult(outcome);
	}

	onClose(): void {
		this.closed = true;
		// Closed mid-scene: a level evolution counts as stopped (like pressing B);
		// a stone evolution still completes, since the game can't stop those either.
		this.deliver(this.opts.cancellable ? 'cancelled' : 'evolved');
		this.contentEl.empty();
	}
}
