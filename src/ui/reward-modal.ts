import { App, Modal } from 'obsidian';
import { Draw } from '../rarity';
import { XpGain } from '../store';
import { STONE_LABELS, learnedText, speciesByDex } from '../progression';
import { StoneKind } from '../species';
import { dexLabel, renderBadge, renderTypes, tierLabel } from './art';

export interface RewardInfo {
	draw: Draw;
	duplicate: boolean;
	count: number;
	taskName: string;
	xp: XpGain | null;
	stone: StoneKind | null;
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
		const { draw, duplicate, count, taskName, xp, stone } = this.info;
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
				text: xp ? `Already caught: you now have ${count}. Bonus XP for your partner.` : `Already caught: you now have ${count}.`,
			});
		}
		if (xp) {
			const name = speciesByDex(xp.dex)?.name ?? 'Your partner';
			const up = xp.toLevel > xp.fromLevel ? ` · grew to Lv ${xp.toLevel}!` : '';
			contentEl.createEl('p', { cls: 'sheiko-pokedex-xp-line', text: `${name} +${xp.gained} XP${up}${learnedText(xp)}` });
		} else {
			contentEl.createEl('p', { cls: 'sheiko-pokedex-why', text: 'Choose a partner in the Pokédex to earn XP from your closes.' });
		}
		if (stone) {
			contentEl.createEl('p', { cls: 'sheiko-pokedex-stone-found', text: `You found a ${STONE_LABELS[stone]}!` });
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
