import { Notice, Plugin, PluginSettingTab, Setting, TFile, App } from 'obsidian';
import { parseContextTypes } from './rarity';
import { CloseInput, Decision, PokedexData, decide, normalizeData, renamePath } from './store';
import { SHEIKO_ID, Watcher, sheikoEnabled } from './watcher';
import { RewardInfo, RewardModal } from './ui/reward-modal';
import { PokedexView, VIEW_TYPE_POKEDEX } from './ui/pokedex-view';

export default class SheikoPokedexPlugin extends Plugin {
	data!: PokedexData;
	private watcher!: Watcher;
	/** Serialises reward decisions so two quick closes can't both read stale data. */
	private queue: Promise<void> = Promise.resolve();
	private pendingRewards: RewardInfo[] = [];
	private rewardTimer: number | null = null;
	private warnedNoSheiko = false;

	async onload(): Promise<void> {
		this.data = normalizeData(await this.loadData(), new Date());
		await this.saveData(this.data);

		this.registerView(VIEW_TYPE_POKEDEX, (leaf) => new PokedexView(leaf, () => this.data));
		this.addRibbonIcon('circle-dot', 'Open Pokédex', () => void this.openPokedex());
		this.addCommand({ id: 'open', name: 'Open Pokédex', callback: () => void this.openPokedex() });
		this.addSettingTab(new PokedexSettingTab(this.app, this));

		this.watcher = new Watcher({
			app: this.app,
			onClose: (input, file) => this.enqueue(() => this.handleClose(input, file)),
			onPathRenamed: (oldPath, newPath) =>
				this.enqueue(async () => {
					const next = renamePath(this.data, oldPath, newPath);
					if (next !== this.data) {
						this.data = next;
						await this.saveData(this.data);
					}
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
		if (this.rewardTimer !== null) window.clearInterval(this.rewardTimer);
	}

	private enqueue(fn: () => Promise<void>): Promise<void> {
		this.queue = this.queue.then(fn).catch((e) => console.error('[Sheiko Pokédex]', e));
		return this.queue;
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
		if (data !== this.data) {
			this.data = data;
			await this.saveData(this.data);
			this.refreshViews();
		}
		this.announce(decision, file);
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
				new Notice(`Sheiko Pokédex: close ${decision.closes} toward your next catch.`);
				return;
			case 'caught': {
				const info: RewardInfo = { ...decision, taskName: file.basename };
				if (!this.data.settings.showRewardWindow) {
					new Notice(`You caught ${decision.draw.species.name}! (${decision.draw.tier})`);
					return;
				}
				this.pendingRewards.push(info);
				this.showNextReward();
			}
		}
	}

	/** Waits while any other window (such as Sheiko's sign-off) is open, then shows rewards one at a time. */
	private showNextReward(): void {
		if (this.rewardTimer !== null) return;
		const tick = () => {
			if (document.querySelector('.modal-container')) return;
			const info = this.pendingRewards.shift();
			if (!info) {
				if (this.rewardTimer !== null) window.clearInterval(this.rewardTimer);
				this.rewardTimer = null;
				return;
			}
			new RewardModal(this.app, info, () => void this.openPokedex()).open();
		};
		this.rewardTimer = window.setInterval(tick, 500);
		this.registerInterval(this.rewardTimer);
		tick();
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
