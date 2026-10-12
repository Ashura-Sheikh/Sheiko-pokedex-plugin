import { App, Modal } from 'obsidian';
import { Species, StoneKind } from '../species';
import { STONE_LABELS } from '../progression';
import { dexLabel, renderBadge, renderTypes } from './art';

/**
 * "X is evolving!" with Evolve / Cancel (Sheikh, 2026-10-12: always ask first).
 * Closing the window any other way counts as Cancel.
 */
export class EvolveModal extends Modal {
	private decided = false;

	constructor(
		app: App,
		private from: Species,
		private to: Species,
		private stone: StoneKind | null,
		private onDecide: (evolve: boolean) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('sheiko-pokedex-reward');
		const row = contentEl.createDiv({ cls: 'sheiko-pokedex-evolve-row' });
		renderBadge(row, this.from, true, 'large');
		row.createDiv({ cls: 'sheiko-pokedex-evolve-arrow', text: '→' });
		renderBadge(row, this.to, true, 'large');
		contentEl.createEl('h2', {
			text: this.stone ? `Use a ${STONE_LABELS[this.stone]} on ${this.from.name}?` : `What? ${this.from.name} is evolving!`,
		});
		contentEl.createEl('p', { cls: 'sheiko-pokedex-tier', text: `${this.to.name} ${dexLabel(this.to.dex)}` });
		renderTypes(contentEl, this.to);
		contentEl.createEl('p', {
			cls: 'sheiko-pokedex-why',
			text: this.stone
				? 'The stone is used up. Both forms stay in your Pokédex.'
				: 'Cancel to stay as you are. You will be asked again at the next level. Both forms stay in your Pokédex.',
		});
		const buttons = contentEl.createDiv({ cls: 'modal-button-container' });
		buttons.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.decide(false));
		const ok = buttons.createEl('button', { cls: 'mod-cta', text: 'Evolve' });
		ok.addEventListener('click', () => this.decide(true));
		window.setTimeout(() => ok.focus(), 0);
	}

	private decide(evolve: boolean): void {
		if (this.decided) return;
		this.decided = true;
		this.onDecide(evolve);
		this.close();
	}

	onClose(): void {
		if (!this.decided) {
			this.decided = true;
			this.onDecide(false);
		}
		this.contentEl.empty();
	}
}
