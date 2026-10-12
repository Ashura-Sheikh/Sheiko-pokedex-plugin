import { App, Modal } from 'obsidian';
import { PokedexData } from '../store';
import { STONE_LABELS, START_LEVEL, speciesByDex, stoneEvolutions, xpToNext } from '../progression';
import { StoneKind } from '../species';
import { dexLabel, renderBadge, renderTypes, tierLabel } from './art';

export interface DetailActions {
	makePartner(dex: number): void;
	useStone(fromDex: number, toDex: number, stone: StoneKind): void;
}

/** Details for one caught Pokémon: level, XP, Make partner, and any stone evolutions. */
export class DetailModal extends Modal {
	constructor(
		app: App,
		private dex: number,
		private data: PokedexData,
		private actions: DetailActions,
	) {
		super(app);
	}

	onOpen(): void {
		const s = speciesByDex(this.dex);
		const caught = this.data.caught[String(this.dex)];
		const { contentEl } = this;
		if (!s || !caught) {
			this.close();
			return;
		}
		const mon = this.data.mons[String(this.dex)] ?? { level: START_LEVEL, xp: 0 };
		const isPartner = this.data.partner === this.dex;

		contentEl.addClass('sheiko-pokedex-reward');
		renderBadge(contentEl, s, true, 'large');
		contentEl.createEl('h2', { text: s.name });
		contentEl.createEl('p', { cls: `sheiko-pokedex-tier tier-${s.tier}`, text: `${dexLabel(s.dex)} · ${tierLabel(s.tier)}` });
		renderTypes(contentEl, s);

		const lv = contentEl.createDiv({ cls: 'sheiko-pokedex-level' });
		lv.createSpan({ text: `Lv ${mon.level}` });
		renderXpBar(lv, mon.xp, xpToNext(mon.level));

		const first = new Date(caught.firstAt).toLocaleDateString();
		contentEl.createEl('p', {
			cls: 'sheiko-pokedex-why',
			text: `Caught ${caught.count}× · first on ${first}${isPartner ? ' · your partner' : ''}`,
		});

		const buttons = contentEl.createDiv({ cls: 'modal-button-container' });
		for (const opt of stoneEvolutions(this.dex, this.data.stones)) {
			const held = this.data.stones[opt.stone];
			const b = buttons.createEl('button', {
				text: `${STONE_LABELS[opt.stone]} → ${opt.to.name} (${held})`,
			});
			if (!opt.have) {
				b.disabled = true;
				b.setAttr('aria-label', `No ${STONE_LABELS[opt.stone]} yet`);
			}
			b.addEventListener('click', () => {
				this.close();
				this.actions.useStone(this.dex, opt.to.dex, opt.stone);
			});
		}
		const partner = buttons.createEl('button', { cls: 'mod-cta', text: isPartner ? 'Partner' : 'Make partner' });
		partner.disabled = isPartner;
		partner.addEventListener('click', () => {
			this.close();
			this.actions.makePartner(this.dex);
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export function renderXpBar(parent: HTMLElement, xp: number, needed: number): void {
	const wrap = parent.createDiv({ cls: 'sheiko-pokedex-xp' });
	const bar = wrap.createDiv({ cls: 'sheiko-pokedex-xp-bar' });
	const fill = bar.createDiv({ cls: 'sheiko-pokedex-xp-fill' });
	fill.style.setProperty('width', `${Math.min(100, Math.round((xp / Math.max(1, needed)) * 100))}%`);
	wrap.createSpan({ cls: 'sheiko-pokedex-xp-text', text: `${xp} / ${needed} XP` });
}
