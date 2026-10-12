import { App, Modal } from 'obsidian';
import { Draw } from '../rarity';
import { dexLabel, renderBadge, renderTypes, tierLabel } from './art';

export interface RewardInfo {
	draw: Draw;
	duplicate: boolean;
	count: number;
	taskName: string;
}

export class RewardModal extends Modal {
	constructor(
		app: App,
		private info: RewardInfo,
		private openPokedex: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		const { draw, duplicate, count, taskName } = this.info;
		const s = draw.species;
		contentEl.addClass('sheiko-pokedex-reward');
		contentEl.createEl('p', { cls: 'sheiko-pokedex-reward-task', text: `Closed: ${taskName}` });
		renderBadge(contentEl, s, true, 'large');
		contentEl.createEl('h2', { text: `You caught ${s.name}!` });
		contentEl.createEl('p', {
			cls: `sheiko-pokedex-tier tier-${draw.tier}`,
			text: `${dexLabel(s.dex)} · ${tierLabel(draw.tier)}`,
		});
		renderTypes(contentEl, s);
		const avg = Math.round(draw.average * 10) / 10;
		const why = [`${draw.closes} closes, average ${avg}`];
		if (draw.boost > 0) why.push(`daily boost +${draw.boost}`);
		why.push(`score ${draw.score}/8`);
		contentEl.createEl('p', { cls: 'sheiko-pokedex-why', text: why.join(' · ') });
		if (duplicate) {
			contentEl.createEl('p', {
				cls: 'sheiko-pokedex-dup',
				text: `Already caught: you now have ${count}. Duplicates will give bonus XP once partner levels arrive.`,
			});
		}
		const buttons = contentEl.createDiv({ cls: 'modal-button-container' });
		buttons.createEl('button', { text: 'Open Pokédex' }).addEventListener('click', () => {
			this.close();
			this.openPokedex();
		});
		const ok = buttons.createEl('button', { cls: 'mod-cta', text: 'Nice' });
		ok.addEventListener('click', () => this.close());
		window.setTimeout(() => ok.focus(), 0);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
