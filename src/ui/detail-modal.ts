import { App, Modal } from 'obsidian';
import { PokedexData } from '../store';
import { STONE_LABELS, START_LEVEL, currentMoves, nextMove, speciesByDex, stoneEvolutions, xpToNext } from '../progression';
import { StoneKind } from '../species';
import { dexLabel, renderBadge, renderTypes, tierLabel, titleCase } from './art';

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

		// Full Red/Blue level-up list: the 4 it knows now, ones it has outgrown, the next one, and later ones.
		const known = new Set(currentMoves(s, mon.level).map((m) => m.name));
		const next = nextMove(s, mon.level);
		contentEl.createEl('h4', { cls: 'sheiko-pokedex-moves-head', text: next ? `Moves · next: ${next.name} at Lv ${next.level}` : 'Moves · all learned' });
		const list = contentEl.createEl('ul', { cls: 'sheiko-pokedex-movelist' });
		for (const m of s.moves) {
			const state = known.has(m.name) ? 'is-known' : m.level <= mon.level ? 'is-forgotten' : m === next ? 'is-next' : 'is-later';
			const li = list.createEl('li', { cls: state });
			li.createSpan({ cls: 'sheiko-pokedex-move-level', text: m.level === 1 ? 'Start' : `Lv ${m.level}` });
			li.createSpan({ cls: 'sheiko-pokedex-move-name', text: m.name });
			li.createSpan({ cls: 'sheiko-pokedex-move-type', text: titleCase(m.type) });
			li.setAttr(
				'aria-label',
				state === 'is-known' ? 'Knows this move' : state === 'is-forgotten' ? 'Learned earlier, replaced by a newer move' : state === 'is-next' ? 'Next move' : 'Learned later',
			);
		}

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
