import { ItemView, WorkspaceLeaf } from 'obsidian';
import { GEN1 } from '../data/gen1';
import { PokedexData, localDate } from '../store';
import { TIERS } from '../species';
import { dexLabel, renderBadge, renderTypes, tierLabel } from './art';

export const VIEW_TYPE_POKEDEX = 'sheiko-pokedex-view';

export class PokedexView extends ItemView {
	constructor(
		leaf: WorkspaceLeaf,
		private getData: () => PokedexData,
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_POKEDEX;
	}

	getDisplayText(): string {
		return 'Pokédex';
	}

	getIcon(): string {
		return 'circle-dot';
	}

	async onOpen(): Promise<void> {
		this.render();
	}

	render(): void {
		const data = this.getData();
		const el = this.contentEl;
		el.empty();
		el.addClass('sheiko-pokedex-view');

		const caughtDex = new Set(Object.keys(data.caught).map(Number));
		const total = Object.values(data.caught).reduce((n, c) => n + c.count, 0);
		const today = data.daily.date === localDate(new Date()) ? data.daily.count : 0;

		const head = el.createDiv({ cls: 'sheiko-pokedex-head' });
		head.createEl('h2', { text: 'Pokédex' });
		const stats = head.createDiv({ cls: 'sheiko-pokedex-stats' });
		const stat = (label: string, value: string) => {
			const s = stats.createDiv({ cls: 'sheiko-pokedex-stat' });
			s.createDiv({ cls: 'sheiko-pokedex-stat-value', text: value });
			s.createDiv({ cls: 'sheiko-pokedex-stat-label', text: label });
		};
		stat('Species caught', `${caughtDex.size} / ${GEN1.length}`);
		stat('Total catches', String(total));
		stat('Today', `${today} / ${data.settings.dailyCap}`);
		for (const t of TIERS) {
			const all = GEN1.filter((p) => p.tier === t);
			stat(tierLabel(t), `${all.filter((p) => caughtDex.has(p.dex)).length} / ${all.length}`);
		}

		const grid = el.createDiv({ cls: 'sheiko-pokedex-grid' });
		for (const p of GEN1) {
			const seen = caughtDex.has(p.dex);
			const cell = grid.createDiv({ cls: `sheiko-pokedex-cell${seen ? '' : ' is-unseen'}` });
			renderBadge(cell, p, seen, 'small');
			cell.createDiv({ cls: 'sheiko-pokedex-num', text: dexLabel(p.dex) });
			if (seen) {
				const c = data.caught[String(p.dex)];
				cell.createDiv({ cls: 'sheiko-pokedex-name', text: p.name });
				renderTypes(cell, p);
				if (c && c.count > 1) cell.createDiv({ cls: 'sheiko-pokedex-count', text: `×${c.count}` });
				cell.setAttr('aria-label', `${p.name}, ${tierLabel(p.tier)}, caught ${c?.count ?? 1}`);
			} else {
				cell.createDiv({ cls: 'sheiko-pokedex-name', text: '???' });
			}
		}
	}
}
