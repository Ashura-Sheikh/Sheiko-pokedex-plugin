import { Notice, Plugin, PluginSettingTab, Setting, TFile, App } from 'obsidian';
import { parseContextTypes } from './rarity';
import {
	CloseInput,
	Decision,
	PokedexData,
	XpGain,
	declineEvolution,
	decide,
	evolve,
	normalizeData,
	renamePath,
	setPartner,
} from './store';
import { START_LEVEL, STONE_LABELS, readyLevelEvolution, speciesByDex } from './progression';
import { StoneKind } from './species';
import { SHEIKO_ID, Watcher, sheikoEnabled } from './watcher';
import { RewardInfo, RewardModal } from './ui/reward-modal';
import { PokedexView, VIEW_TYPE_POKEDEX } from './ui/pokedex-view';
import { EvolveModal } from './ui/evolve-modal';
import { DetailModal } from './ui/detail-modal';
import { PartnerSuggestModal } from './ui/partner-suggest';

export default class SheikoPokedexPlugin extends Plugin {
	data!: PokedexData;
	private watcher!: Watcher;
	/** Serialises every change to `data` so two quick events can't both read stale data. */
	private queue: Promise<void> = Promise.resolve();
	/** Windows waiting to open, one at a time, while no other window is open. */
	private pendingWindows: (() => void)[] = [];
	private windowTimer: number | null = null;
	private warnedNoSheiko = false;
	private statusBar: HTMLElement | null = null;

	async onload(): Promise<void> {
		this.data = normalizeData(await this.loadData(), new Date());
		await this.saveData(this.data);

		this.registerView(
			VIEW_TYPE_POKEDEX,
			(leaf) =>
				new PokedexView(leaf, {
					getData: () => this.data,
					openDetail: (dex) => this.openDetail(dex),
					choosePartner: () => this.choosePartner(),
				}),
		);
		this.addRibbonIcon('circle-dot', 'Open Pokédex', () => void this.openPokedex());
		this.addCommand({ id: 'open', name: 'Open Pokédex', callback: () => void this.openPokedex() });
		this.addCommand({ id: 'choose-partner', name: 'Choose partner', callback: () => this.choosePartner() });
		this.addSettingTab(new PokedexSettingTab(this.app, this));

		// Partner in Obsidian's bottom bar (Sheikh, 2026-10-12). Click opens the Pokédex.
		this.statusBar = this.addStatusBarItem();
		this.statusBar.addClass('sheiko-pokedex-status', 'mod-clickable');
		this.statusBar.addEventListener('click', () => void this.openPokedex());
		this.updateStatusBar();

		this.watcher = new Watcher({
			app: this.app,
			onClose: (input, file) => this.enqueue(() => this.handleClose(input, file)),
			onPathRenamed: (oldPath, newPath) =>
				this.enqueue(async () => {
					const next = renamePath(this.data, oldPath, newPath);
					if (next !== this.data) await this.commit(next);
				}),
		});

		this.app.workspace.onLayoutReady(async () => {
			const ok = await this.watcher.start();
			if (!ok) {
				new Notice('Sheiko Pokédex: TaskNotes is not installed and enabled, so no tasks are watched.');
				return;
			}
			if (!sheikoEnabled(this.app)) this.warnNoSheiko();
			this.registerEvent(this.app.metadataCache.on('changed', (f) => this.watcher.onMetadataChanged(f)));
			this.registerEvent(this.app.vault.on('rename', (f, old) => this.watcher.onRename(f, old)));
			this.registerEvent(this.app.vault.on('delete', (f) => this.watcher.onDelete(f)));
		});
	}

	onunload(): void {
		this.watcher?.stop();
		if (this.windowTimer !== null) window.clearInterval(this.windowTimer);
	}

	private enqueue(fn: () => Promise<void>): Promise<void> {
		this.queue = this.queue.then(fn).catch((e) => console.error('[Sheiko Pokédex]', e));
		return this.queue;
	}

	/** Saves new data and refreshes every place it shows. */
	private async commit(next: PokedexData): Promise<void> {
		this.data = next;
		await this.saveData(this.data);
		this.refreshViews();
		this.updateStatusBar();
	}

	private warnNoSheiko(): void {
		if (this.warnedNoSheiko) return;
		this.warnedNoSheiko = true;
		new Notice(`Sheiko Pokédex needs Sheiko Task Lifecycle (${SHEIKO_ID}) enabled. Closes won't earn Pokémon until it is.`, 10000);
	}

	private async handleClose(input: CloseInput, file: TFile): Promise<void> {
		// Checked per close, so turning Sheiko on later works without a restart.
		if (!sheikoEnabled(this.app)) {
			this.warnNoSheiko();
			return;
		}
		const map = parseContextTypes(this.data.settings.contextTypes);
		const { data, decision } = decide(input, this.data, map, new Date());
		if (data !== this.data) await this.commit(data);
		this.announce(decision, file);
	}

	private xpText(xp: XpGain | null): string {
		if (!xp) return ' · choose a partner to earn XP';
		const name = speciesByDex(xp.dex)?.name ?? 'your partner';
		const up = xp.toLevel > xp.fromLevel ? ` ${name} grew to Lv ${xp.toLevel}!` : '';
		return ` · +${xp.gained} XP to ${name}.${up}`;
	}

	private announce(decision: Decision, file: TFile): void {
		switch (decision.kind) {
			case 'already':
				return;
			case 'excluded':
				new Notice(`Sheiko Pokédex: no catch, "${file.basename}" was closed as ${decision.reason}.`);
				return;
			case 'capped':
				new Notice(`Sheiko Pokédex: today's limit of ${decision.cap} catches is reached. "${file.basename}" doesn't count.`);
				return;
			case 'counted':
				// The target stays hidden (Sheikh, 2026-10-12): show progress, not the goal.
				new Notice(`Sheiko Pokédex: close ${decision.closes} toward your next catch${this.xpText(decision.xp)}`);
				this.maybeAskToEvolve(decision.xp);
				return;
			case 'caught': {
				const info: RewardInfo = {
					draw: decision.draw,
					duplicate: decision.duplicate,
					count: decision.count,
					taskName: file.basename,
					xp: decision.xp,
					stone: decision.stone,
				};
				if (!this.data.settings.showRewardWindow) {
					const stone = decision.stone ? ` Found a ${STONE_LABELS[decision.stone]}!` : '';
					new Notice(`You caught ${decision.draw.species.name}! (${decision.draw.tier})${this.xpText(decision.xp)}${stone}`);
				} else {
					this.showWindow(() => new RewardModal(this.app, info, () => void this.openPokedex()).open());
				}
				this.maybeAskToEvolve(decision.xp);
			}
		}
	}

	/** After a level-up, ask whether the partner should evolve (never automatic). */
	private maybeAskToEvolve(xp: XpGain | null): void {
		if (!xp || xp.toLevel <= xp.fromLevel) return;
		const mon = this.data.mons[String(xp.dex)];
		const from = speciesByDex(xp.dex);
		const to = mon ? readyLevelEvolution(xp.dex, mon) : null;
		if (!from || !to) return;
		this.showWindow(() =>
			new EvolveModal(this.app, from, to, null, (yes) =>
				void this.enqueue(async () => {
					// Re-check against current data: it may have changed while the window was waiting.
					const now = this.data.mons[String(from.dex)];
					if (!now || !readyLevelEvolution(from.dex, now)) return;
					if (yes) {
						const next = evolve(this.data, from.dex, to.dex, new Date());
						if (next) {
							await this.commit(next);
							new Notice(`${from.name} evolved into ${to.name}!`);
						}
					} else {
						await this.commit(declineEvolution(this.data, from.dex));
						new Notice(`${from.name} stopped evolving. You'll be asked again at the next level.`);
					}
				}),
			).open(),
		);
	}

	/** Opens windows one at a time, waiting while any other window (such as Sheiko's sign-off) is open. */
	private showWindow(open: () => void): void {
		this.pendingWindows.push(open);
		if (this.windowTimer !== null) return;
		const tick = () => {
			if (document.querySelector('.modal-container')) return;
			const next = this.pendingWindows.shift();
			if (!next) {
				if (this.windowTimer !== null) window.clearInterval(this.windowTimer);
				this.windowTimer = null;
				return;
			}
			next();
		};
		this.windowTimer = window.setInterval(tick, 500);
		this.registerInterval(this.windowTimer);
		tick();
	}

	choosePartner(): void {
		if (!Object.keys(this.data.caught).length) {
			new Notice('Sheiko Pokédex: catch a Pokémon first, then choose it as your partner.');
			return;
		}
		new PartnerSuggestModal(this.app, this.data, (dex) => this.makePartner(dex)).open();
	}

	private makePartner(dex: number): void {
		void this.enqueue(async () => {
			const next = setPartner(this.data, dex);
			if (next === this.data) return;
			await this.commit(next);
			new Notice(`${speciesByDex(dex)?.name ?? 'Your Pokémon'} is now your partner.`);
		});
	}

	private openDetail(dex: number): void {
		new DetailModal(this.app, dex, this.data, {
			makePartner: (d) => this.makePartner(d),
			useStone: (from, to, stone) => this.askStoneEvolution(from, to, stone),
		}).open();
	}

	private askStoneEvolution(fromDex: number, toDex: number, stone: StoneKind): void {
		const from = speciesByDex(fromDex);
		const to = speciesByDex(toDex);
		if (!from || !to) return;
		this.showWindow(() =>
			new EvolveModal(this.app, from, to, stone, (yes) => {
				if (!yes) return;
				void this.enqueue(async () => {
					const next = evolve(this.data, fromDex, toDex, new Date(), stone);
					if (!next) {
						new Notice(`Sheiko Pokédex: no ${STONE_LABELS[stone]} left.`);
						return;
					}
					await this.commit(next);
					new Notice(`${from.name} evolved into ${to.name}!`);
				});
			}).open(),
		);
	}

	private updateStatusBar(): void {
		if (!this.statusBar) return;
		const dex = this.data.partner;
		const p = dex !== null ? speciesByDex(dex) : undefined;
		if (!p || dex === null) {
			this.statusBar.setText('Pokédex: choose a partner');
			return;
		}
		const lv = this.data.mons[String(dex)]?.level ?? START_LEVEL;
		this.statusBar.setText(`${p.name} Lv ${lv}`);
		this.statusBar.setAttr('aria-label', 'Open Pokédex');
	}

	refreshViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_POKEDEX)) {
			if (leaf.view instanceof PokedexView) leaf.view.render();
		}
	}

	async openPokedex(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_POKEDEX)[0];
		const leaf = existing ?? this.app.workspace.getLeaf('tab');
		if (!existing) await leaf.setViewState({ type: VIEW_TYPE_POKEDEX, active: true });
		this.app.workspace.setActiveLeaf(leaf, { focus: true });
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.data);
		this.refreshViews();
	}
}

class PokedexSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: SheikoPokedexPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		const s = this.plugin.data.settings;
		containerEl.empty();

		const sheiko = sheikoEnabled(this.app);
		containerEl.createEl('p', {
			text: sheiko
				? 'Sheiko Task Lifecycle is enabled. Task closes earn Pokémon.'
				: 'Sheiko Task Lifecycle is not enabled. Closes will not earn Pokémon until it is.',
		});

		new Setting(containerEl)
			.setName('Daily catch limit')
			.setDesc('Catches per day. Once reached, further closes that day earn nothing and never count later.')
			.addText((t) =>
				t.setValue(String(s.dailyCap)).onChange(async (v) => {
					const n = Number(v);
					if (Number.isFinite(n) && n >= 0) {
						s.dailyCap = Math.floor(n);
						await this.plugin.saveSettings();
					}
				}),
			);

		new Setting(containerEl)
			.setName('Show reward window')
			.setDesc('Off: a short notice instead of a window.')
			.addToggle((t) =>
				t.setValue(s.showRewardWindow).onChange(async (v) => {
					s.showRewardWindow = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName('Context to type')
			.setDesc('One per line, "context: type, type". A task\'s contexts narrow which types can appear. Unknown contexts allow any type.')
			.addTextArea((t) => {
				t.inputEl.rows = 10;
				t.inputEl.addClass('sheiko-pokedex-context-map');
				t.setValue(s.contextTypes).onChange(async (v) => {
					s.contextTypes = v;
					await this.plugin.saveSettings();
				});
			});
	}
}
