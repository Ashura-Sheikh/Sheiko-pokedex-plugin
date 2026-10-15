import { ItemView, WorkspaceLeaf } from 'obsidian';
import { GEN1 } from '../data/gen1';
import { PokedexData, formatCount, localDate } from '../store';
import { STONE_KINDS, Species, TIERS, Tier } from '../species';
import { BrowseControls, SCOPES, Scope, allTypes, browse, defaultControls } from '../browse';
import { START_LEVEL, STONE_LABELS, currentMoves, evolutionHint, nextMove, speciesByDex, xpToNext } from '../progression';
import { dexLabel, renderBadge, renderTypes, tierLabel, titleCase } from './art';
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
		return 'Pokedex';
	}

	getIcon(): string {
		return 'circle-dot';
	}

	async onOpen(): Promise<void> {
		this.render();
	}

	// 1.3.0 (#25): the toolbar's controls live here, on the open view only. They survive
	// refreshes (a catch while the view is open) and are never saved to data.json.
	private controls: BrowseControls = defaultControls();
	private headEl: HTMLElement | null = null;
	private toolbarEl: HTMLElement | null = null;
	private resultsEl: HTMLElement | null = null;

	/**
	 * Redraws the header and the grid. The toolbar is built once and left alone, so a
	 * refresh doesn't reset the controls or take focus away from the search box.
	 */
	render(): void {
		const el = this.contentEl;
		if (!this.headEl || !this.toolbarEl || !this.resultsEl || !el.contains(this.toolbarEl)) {
			el.empty();
			el.addClass('sheiko-pokedex-view');
			this.headEl = el.createDiv({ cls: 'sheiko-pokedex-head' });
			this.toolbarEl = el.createDiv({ cls: 'sheiko-pokedex-toolbar' });
			this.resultsEl = el.createDiv({ cls: 'sheiko-pokedex-results' });
			this.buildToolbar(this.toolbarEl);
		}
		this.renderHead(this.headEl);
		this.renderResults();
	}

	private buildToolbar(bar: HTMLElement): void {
		const scopeGroup = bar.createDiv({ cls: 'sheiko-pokedex-scope' });
		scopeGroup.setAttr('role', 'group');
		scopeGroup.setAttr('aria-label', 'Show');
		const labels: Record<Scope, string> = { all: 'All', caught: 'Caught', uncaught: 'Uncaught' };
		const buttons = new Map<Scope, HTMLButtonElement>();
		const sync = () => {
			for (const [s, b] of buttons) {
				const on = this.controls.scope === s;
				b.toggleClass('is-active', on);
				b.setAttr('aria-pressed', on ? 'true' : 'false');
			}
		};
		for (const s of SCOPES) {
			const b = scopeGroup.createEl('button', { text: labels[s] });
			b.addEventListener('click', () => {
				this.controls = { ...this.controls, scope: s };
				sync();
				this.renderResults();
			});
			buttons.set(s, b);
		}
		sync();

		const search = bar.createEl('input', {
			cls: 'sheiko-pokedex-search',
			type: 'search',
			placeholder: 'Search caught by name, or #number',
		});
		search.setAttr('aria-label', 'Search caught Pokémon by name, or any Pokémon by number');
		search.value = this.controls.search;
		search.addEventListener('input', () => {
			this.controls = { ...this.controls, search: search.value };
			this.renderResults();
		});

		// Type and rarity: with either on, only caught Pokémon that match are shown (#28).
		const typeSelect = this.select(bar, 'Type', [
			['', 'Any type'],
			...allTypes().map((t): [string, string] => [t, titleCase(t)]),
		]);
		typeSelect.value = this.controls.type ?? '';
		typeSelect.addEventListener('change', () => {
			this.controls = { ...this.controls, type: typeSelect.value || null };
			this.renderResults();
		});
		const tierSelect = this.select(bar, 'Rarity', [
			['', 'Any rarity'],
			...TIERS.map((t): [string, string] => [t, tierLabel(t)]),
		]);
		tierSelect.value = this.controls.tier ?? '';
		tierSelect.addEventListener('change', () => {
			const v = tierSelect.value;
			this.controls = { ...this.controls, tier: (TIERS as readonly string[]).includes(v) ? (v as Tier) : null };
			this.renderResults();
		});
	}

	private select(parent: HTMLElement, label: string, options: [string, string][]): HTMLSelectElement {
		const sel = parent.createEl('select', { cls: 'dropdown sheiko-pokedex-select' });
		sel.setAttr('aria-label', label);
		for (const [value, text] of options) sel.createEl('option', { value, text });
		return sel;
	}

	private renderResults(): void {
		const el = this.resultsEl;
		if (!el) return;
		el.empty();
		const data = this.host.getData();
		const result = browse(data, this.controls);
		const grid = el.createDiv({ cls: 'sheiko-pokedex-grid' });
		for (const cell of result.cells) {
			const p = speciesByDex(cell.dex);
			if (p) this.renderCell(grid, p, cell.seen, data);
		}
	}

	private renderHead(head: HTMLElement): void {
		head.empty();
		const data = this.host.getData();
		const caughtDex = new Set(Object.keys(data.caught).map(Number));
		const total = Object.values(data.caught).reduce((n, c) => n + c.count, 0);
		const isToday = data.daily.date === localDate(new Date());
		const catchesToday = isToday ? data.daily.catches : 0;
		const closesToday = isToday ? data.daily.closes : 0;

		head.createEl('h2', { text: 'Pokedex' });

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
	}

	private renderCell(grid: HTMLElement, p: Species, seen: boolean, data: PokedexData): void {
		const cell = grid.createDiv({ cls: `sheiko-pokedex-cell${seen ? ' is-caught' : ' is-unseen'}` });
		if (data.partner === p.dex) cell.addClass('is-partner');
		renderBadge(cell, p, seen, 'small');
		cell.createDiv({ cls: 'sheiko-pokedex-num', text: dexLabel(p.dex) });
		if (!seen) {
			// Unseen: the number only. No name, types, tier or label (#25's no-leak rule).
			cell.createDiv({ cls: 'sheiko-pokedex-name', text: '???' });
			return;
		}
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
