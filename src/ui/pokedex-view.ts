import { ItemView, WorkspaceLeaf } from 'obsidian';
import { GEN1 } from '../data/gen1';
import { PokedexData, formatCount, localDate } from '../store';
import { STONE_KINDS, TIERS } from '../species';
import { START_LEVEL, STONE_LABELS, currentMoves, evolutionHint, nextMove, speciesByDex, xpToNext } from '../progression';
import { dexLabel, renderBadge, renderTypes, tierLabel } from './art';
import { renderXpBar } from './detail-modal';

export const VIEW_TYPE_POKEDEX = 'sheiko-pokedex-view';

export interface PokedexViewHost {
	getData(): PokedexData;
	openDetail(dex: number): void;
	choosePartner(): void;
}

export class PokedexView extends ItemView {
	constructor(
		leaf: WorkspaceLeaf,
		private host: PokedexViewHost,
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
		const data = this.host.getData();
		const el = this.contentEl;
		el.empty();
		el.addClass('sheiko-pokedex-view');

		const caughtDex = new Set(Object.keys(data.caught).map(Number));
		const total = Object.values(data.caught).reduce((n, c) => n + c.count, 0);
		const isToday = data.daily.date === localDate(new Date());
		const catchesToday = isToday ? data.daily.catches : 0;
		const closesToday = isToday ? data.daily.closes : 0;

		const head = el.createDiv({ cls: 'sheiko-pokedex-head' });
		head.createEl('h2', { text: 'Pokédex' });

		this.renderPartner(head, data);

		const stats = head.createDiv({ cls: 'sheiko-pokedex-stats' });
		const stat = (label: string, value: string) => {
			const s = stats.createDiv({ cls: 'sheiko-pokedex-stat' });
			s.createDiv({ cls: 'sheiko-pokedex-stat-value', text: value });
			s.createDiv({ cls: 'sheiko-pokedex-stat-label', text: label });
		};
		stat('Species caught', `${caughtDex.size} / ${GEN1.length}`);
		stat('Total catches', String(total));
		stat('Catches today', `${catchesToday} / ${data.settings.dailyCap}`);
		stat('Closes today', formatCount(closesToday));
		stat('Toward next catch', formatCount(data.progress.closes));
		for (const t of TIERS) {
			const all = GEN1.filter((p) => p.tier === t);
			stat(tierLabel(t), `${all.filter((p) => caughtDex.has(p.dex)).length} / ${all.length}`);
		}

		const stones = head.createDiv({ cls: 'sheiko-pokedex-stones' });
		for (const k of STONE_KINDS) {
			const chip = stones.createSpan({ cls: `sheiko-pokedex-stone stone-${k}`, text: `${STONE_LABELS[k]} × ${data.stones[k]}` });
			if (data.stones[k] === 0) chip.addClass('is-empty');
		}

		const grid = el.createDiv({ cls: 'sheiko-pokedex-grid' });
		for (const p of GEN1) {
			const seen = caughtDex.has(p.dex);
			const cell = grid.createDiv({ cls: `sheiko-pokedex-cell${seen ? ' is-caught' : ' is-unseen'}` });
			if (data.partner === p.dex) cell.addClass('is-partner');
			renderBadge(cell, p, seen, 'small');
			cell.createDiv({ cls: 'sheiko-pokedex-num', text: dexLabel(p.dex) });
			if (seen) {
				const c = data.caught[String(p.dex)];
				const lv = data.mons[String(p.dex)]?.level ?? START_LEVEL;
				cell.createDiv({ cls: 'sheiko-pokedex-name', text: p.name });
				cell.createDiv({ cls: 'sheiko-pokedex-cell-level', text: `Lv ${lv}` });
				renderTypes(cell, p);
				// Current moves under the card: the last 4 learned by this level (Sheikh, 2026-10-12).
				const moves = cell.createEl('ul', { cls: 'sheiko-pokedex-moves' });
				for (const m of currentMoves(p, lv)) moves.createEl('li', { text: m.name });
				if (c && c.count > 1) cell.createDiv({ cls: 'sheiko-pokedex-count', text: `×${c.count}` });
				cell.setAttr('aria-label', `${p.name}, level ${lv}, ${tierLabel(p.tier)}. Click for details.`);
				cell.setAttr('role', 'button');
				cell.tabIndex = 0;
				const open = () => this.host.openDetail(p.dex);
				cell.addEventListener('click', open);
				cell.addEventListener('keydown', (e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						open();
					}
				});
			} else {
				cell.createDiv({ cls: 'sheiko-pokedex-name', text: '???' });
			}
		}
	}

	/**
	 * The partner is the main visual (Sheikh, 2026-10-12): a large card with a 2× sprite,
	 * level and XP, current moves, the next move and what it evolves into.
	 */
	private renderPartner(parent: HTMLElement, data: PokedexData): void {
		const p = data.partner !== null ? speciesByDex(data.partner) : undefined;
		const hasCaught = Object.keys(data.caught).length > 0;
		const panel = parent.createDiv({ cls: `sheiko-pokedex-partner${p ? ' is-hero' : ''}` });
		if (!p) {
			panel.createDiv({
				cls: 'sheiko-pokedex-partner-empty',
				text: hasCaught
					? 'No partner yet. Choose one to start earning XP from your closes.'
					: 'Catch your first Pokémon, then choose it as your partner to earn XP.',
			});
			if (hasCaught) {
				const b = panel.createEl('button', { cls: 'mod-cta', text: 'Choose partner' });
				b.addEventListener('click', () => this.host.choosePartner());
			}
			return;
		}

		const mon = data.mons[String(p.dex)] ?? { level: START_LEVEL, xp: 0 };
		const art = panel.createDiv({ cls: 'sheiko-pokedex-hero-art' });
		renderBadge(art, p, true, 'hero');

		const info = panel.createDiv({ cls: 'sheiko-pokedex-hero-info' });
		info.createDiv({ cls: 'sheiko-pokedex-hero-label', text: 'Your partner' });
		const title = info.createDiv({ cls: 'sheiko-pokedex-hero-title' });
		title.createSpan({ cls: 'sheiko-pokedex-hero-name', text: p.name });
		title.createSpan({ cls: 'sheiko-pokedex-hero-level', text: `Lv ${mon.level}` });
		info.createDiv({ cls: `sheiko-pokedex-tier tier-${p.tier}`, text: `${dexLabel(p.dex)} · ${tierLabel(p.tier)}` });
		renderTypes(info, p);
		renderXpBar(info, mon.xp, xpToNext(mon.level));

		const moves = info.createDiv({ cls: 'sheiko-pokedex-hero-moves' });
		for (const m of currentMoves(p, mon.level)) moves.createSpan({ cls: 'sheiko-pokedex-hero-move', text: m.name });
		const next = nextMove(p, mon.level);
		const facts: string[] = [next ? `Next move: ${next.name} at Lv ${next.level}` : 'All moves learned'];
		facts.push(evolutionHint(p.dex, mon, data.stones));
		info.createDiv({ cls: 'sheiko-pokedex-hero-facts', text: facts.join(' · ') });

		const buttons = info.createDiv({ cls: 'sheiko-pokedex-hero-buttons' });
		const details = buttons.createEl('button', { text: 'Details' });
		details.addEventListener('click', () => this.host.openDetail(p.dex));
		const change = buttons.createEl('button', { text: 'Change partner' });
		change.addEventListener('click', () => this.host.choosePartner());
	}
}
