import { Menu, Notice, Plugin, PluginSettingTab, SettingDefinitionItem, TFile, App, normalizePath, requestUrl } from 'obsidian';
import { parseContextTypes } from './rarity';
import {
	CloseInput,
	Decision,
	PokedexData,
	XpGain,
	declineEvolution,
	decide,
	evolve,
	formatCount,
	normalizeData,
	STARTER_XP,
	STARTER_XP_USES,
	StarterRefusal,
	StarterResult,
	DEFAULT_SETTINGS,
	OLD_DEFAULT_DAILY_CAP,
	chooseDailyCap,
	claimStarterPokemon,
	claimStarterStones,
	renamePath,
	setPartner,
	starterChoices,
	starterSummary,
	starterXpConfirmText,
	useStarterXp,
} from './store';
import { registerTestCommands } from './dev-tools';
import { ConfirmModal } from './ui/confirm-modal';
import {
	START_LEVEL,
	STONE_LABELS,
	learnedText,
	levelEvolutionAvailable,
	readyLevelEvolution,
	speciesByDex,
	xpToNext,
} from './progression';
import { StoneKind } from './species';
import { SHEIKO_ID, Watcher, sheikoEnabled } from './watcher';
import { RewardInfo, RewardModal } from './ui/reward-modal';
import { PokedexView, VIEW_TYPE_POKEDEX } from './ui/pokedex-view';
import { EvolveModal } from './ui/evolve-modal';
import { EvolutionSceneModal } from './ui/evolution-scene-modal';
import { DetailModal } from './ui/detail-modal';
import { PartnerSuggestModal, SpeciesSuggestModal } from './ui/partner-suggest';
import { setSprites } from './ui/art';
import {
	SPRITES_INTRO,
	SPRITE_COUNT,
	checkSprite,
	downloadSprites,
	saveSpritesAtomically,
	spriteFileName,
	spriteInfo,
} from './sprites';

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
	/** blob: URLs for the downloaded sprites; revoked when replaced or on unload. */
	private spriteUrls: string[] = [];
	/** True while "Download sprites" runs. */
	spriteDownloadRunning = false;
	/** Why the last download failed (shown in settings), or null. Not saved. */
	lastSpriteError: string | null = null;
	private unloading = false;
	private settingTab: PokedexSettingTab | null = null;

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
		this.addRibbonIcon('circle-dot', 'Open Pokedex', () => void this.openPokedex());
		this.addCommand({ id: 'open', name: 'Open Pokedex', callback: () => void this.openPokedex() });
		this.addCommand({ id: 'choose-partner', name: 'Choose partner', callback: () => this.choosePartner() });
		this.addStarterCommands();
		if (__SHEIKO_DEV__) {
			// Development builds only; esbuild removes this branch (and src/dev-tools.ts) from release builds.
			registerTestCommands({
				app: this.app,
				addCommand: (c) => this.addCommand(c),
				getData: () => this.data,
				enqueue: (fn) => this.enqueue(fn),
				commit: (next) => this.commit(next),
				xpText: (xp) => this.xpText(xp),
				maybeAskToEvolve: (xp) => this.maybeAskToEvolve(xp),
			});
		}
		this.settingTab = new PokedexSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);

		// Partner in Obsidian's bottom bar (Sheikh, 2026-10-12).
		// Click: Pokedex (or the partner picker when none is set). Right-click: menu. Hover: level and XP.
		this.statusBar = this.addStatusBarItem();
		this.statusBar.addClass('sheiko-pokedex-status', 'mod-clickable');
		this.statusBar.setAttr('data-tooltip-position', 'top');
		this.statusBar.addEventListener('click', () => this.onStatusBarClick());
		this.statusBar.addEventListener('contextmenu', (e) => this.showStatusBarMenu(e));
		this.updateStatusBar();

		// Downloaded sprites, if the user fetched them earlier (DB). Badges until then.
		void this.loadSprites();

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
			this.announceCapUpgrade();
			const ok = await this.watcher.start();
			if (!ok) {
				new Notice('Sheiko Pokedex: TaskNotes is not installed and enabled, so no tasks are watched.');
				return;
			}
			if (!sheikoEnabled(this.app)) this.warnNoSheiko();
			this.registerEvent(this.app.metadataCache.on('changed', (f) => this.watcher.onMetadataChanged(f)));
			this.registerEvent(this.app.vault.on('rename', (f, old) => this.watcher.onRename(f, old)));
			this.registerEvent(this.app.vault.on('delete', (f) => this.watcher.onDelete(f)));
		});
	}

	onunload(): void {
		this.unloading = true;
		this.clearSpriteUrls();
		this.watcher?.stop();
		if (this.windowTimer !== null) window.clearInterval(this.windowTimer);
	}

	private enqueue(fn: () => Promise<void>): Promise<void> {
		this.queue = this.queue.then(fn).catch((e) => console.error('[Sheiko Pokedex]', e));
		return this.queue;
	}

	/** Saves new data and refreshes every place it shows. */
	private async commit(next: PokedexData): Promise<void> {
		this.data = next;
		await this.saveData(this.data);
		this.refreshViews();
		this.updateStatusBar();
	}

	/** 1.4.0 (#39): tells users still on the old limit of 3, once, that the default is now 5. */
	private announceCapUpgrade(): void {
		if (this.data.capUpgrade !== 'new') return;
		new Notice(
			`Sheiko Pokedex: the default daily catch limit is now ${DEFAULT_SETTINGS.dailyCap}; yours is ${this.data.settings.dailyCap}. ` +
				`Choose Move to ${DEFAULT_SETTINGS.dailyCap} or Keep ${OLD_DEFAULT_DAILY_CAP} in Settings → Sheiko Pokedex.`,
			15000,
		);
		void this.enqueue(async () => {
			if (this.data.capUpgrade === 'new') await this.commit({ ...this.data, capUpgrade: 'asked' });
		});
	}

	/** Answers the 1.4.0 question from the Settings box (#39). */
	async answerCapUpgrade(cap: number): Promise<void> {
		await this.enqueue(async () => {
			await this.commit(chooseDailyCap(this.data, cap));
		});
		this.settingTab?.refreshIfOpen();
	}

	private warnNoSheiko(): void {
		if (this.warnedNoSheiko) return;
		this.warnedNoSheiko = true;
		new Notice(`Sheiko Pokedex needs Sheiko Task Lifecycle (${SHEIKO_ID}) enabled. Closes won't earn Pokémon until it is.`, 10000);
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
		return ` · +${xp.gained} XP to ${name}.${up}${learnedText(xp)}`;
	}

	private announce(decision: Decision, file: TFile): void {
		switch (decision.kind) {
			case 'already':
				return;
			case 'excluded':
				new Notice(`Sheiko Pokedex: no catch, "${file.basename}" was closed as ${decision.reason}.`);
				return;
			case 'capped':
				// 1.2.0 (#26): no catch progress over the limit, but the partner still earns XP.
				new Notice(
					`Sheiko Pokedex: today's limit of ${decision.cap} catches is reached. ` +
						`No catch progress from "${file.basename}"${this.xpText(decision.xp)}`,
				);
				this.maybeAskToEvolve(decision.xp);
				return;
			case 'counted':
				// The target stays hidden (Sheikh, 2026-10-12): show progress, not the goal.
				new Notice(
					`Sheiko Pokedex: close ${formatCount(decision.closes)} toward your next catch` +
						`${decision.bulk ? ' (bulk close: half credit)' : ''}${this.xpText(decision.xp)}`,
				);
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
		this.askLevelEvolution(xp.dex, false);
	}

	/**
	 * Shows the Evolve / Cancel window. `manual` is "Evolve now" from the status-bar menu:
	 * it also offers an evolution that was cancelled earlier at this level.
	 */
	private askLevelEvolution(dex: number, manual: boolean): void {
		const check = manual ? levelEvolutionAvailable : readyLevelEvolution;
		const mon = this.data.mons[String(dex)];
		const from = speciesByDex(dex);
		const to = mon ? check(dex, mon) : null;
		if (!from || !to) return;
		// Evolution scene flow (Sheikh, 2026-10-12, option B): the scene starts straight away with
		// "What? X is evolving!"; B, Stop or closing the window stops it.
		this.showWindow(() =>
			new EvolutionSceneModal(this.app, from, to, {
				cancellable: true,
				calm: this.calmEvolution(),
				onResult: (outcome) => void this.enqueue(async () => {
					const yes = outcome === 'evolved';
					// Re-check against current data: it may have changed while the window was waiting.
					const now = this.data.mons[String(from.dex)];
					if (!now || check(from.dex, now)?.dex !== to.dex) return;
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
			}).open(),
		);
	}

	/** Calm evolution scene: the plugin setting, or the system's reduced-motion setting. */
	private calmEvolution(): boolean {
		return this.data.settings.calmEvolution || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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

	// --- Starter pack (Sheikh, 2026-10-13, 0.9.0): one-time per install, never refilled. ---

	/** Commands for each gift; each one is hidden from the command list once it's used up. */
	private addStarterCommands(): void {
		this.addCommand({
			id: 'starter-stones',
			name: 'Starter pack: one of each stone',
			checkCallback: (checking) => {
				if (!this.data.starter.stones) return false;
				if (!checking) void this.starterStones();
				return true;
			},
		});
		this.addCommand({
			id: 'starter-pokemon',
			name: 'Starter pack: choose a Pokémon',
			checkCallback: (checking) => {
				if (!this.data.starter.pokemon) return false;
				if (!checking) void this.starterPokemon();
				return true;
			},
		});
		this.addCommand({
			id: 'starter-xp',
			name: `Starter pack: give partner ${STARTER_XP} XP`,
			checkCallback: (checking) => {
				if (this.data.starter.xpLeft <= 0) return false;
				if (!checking) void this.starterXp();
				return true;
			},
		});
	}

	/** Asks "can only be used once" first. Resolves to true only if the user confirmed. */
	private confirmOnce(heading: string, message: string, confirmText: string): Promise<boolean> {
		return new Promise((resolve) => new ConfirmModal(this.app, heading, message, confirmText, resolve).open());
	}

	private starterRefusalText(reason: StarterRefusal): string {
		switch (reason) {
			case 'used':
				return 'Sheiko Pokedex: that part of the Starter pack is already used.';
			case 'no-partner':
				return 'Sheiko Pokedex: choose a partner first. Nothing was used.';
			case 'max-level':
				return 'Sheiko Pokedex: your partner is already at the top level, so the XP would be lost. Nothing was used.';
			case 'already-caught':
				return 'Sheiko Pokedex: you already have that Pokémon. Nothing was used.';
			case 'unknown':
				return 'Sheiko Pokedex: unknown Pokémon. Nothing was used.';
		}
	}

	/** Re-checks inside the queue, so a double click can't use a gift twice. */
	private async applyStarter(run: () => StarterResult, done: (r: StarterResult & { ok: true }) => void): Promise<void> {
		await this.enqueue(async () => {
			const r = run();
			if (!r.ok) {
				new Notice(this.starterRefusalText(r.reason));
				return;
			}
			await this.commit(r.data);
			this.settingTab?.refreshIfOpen();
			done(r);
		});
	}

	async starterStones(): Promise<void> {
		if (!this.data.starter.stones) return void new Notice(this.starterRefusalText('used'));
		const yes = await this.confirmOnce(
			'Starter pack: one of each stone',
			'Adds a Fire, Water, Thunder, Leaf, Moon and Trade Stone. This can only be used once. Use it now?',
			'Use it now',
		);
		if (!yes) return;
		await this.applyStarter(
			() => claimStarterStones(this.data),
			() => new Notice('Sheiko Pokedex: Starter pack used. You got one of each stone.'),
		);
	}

	async starterPokemon(): Promise<void> {
		if (!this.data.starter.pokemon) return void new Notice(this.starterRefusalText('used'));
		const choices = starterChoices(this.data);
		if (!choices.length) return void new Notice('Sheiko Pokedex: you have every Pokémon already. Nothing was used.');
		// Closing the picker without choosing simply ends here: nothing is used.
		new SpeciesSuggestModal(this.app, 'Starter pack: choose a Pokémon you have not caught', choices, (dex) =>
			void this.starterPokemonConfirm(dex),
		).open();
	}

	private async starterPokemonConfirm(dex: number): Promise<void> {
		const name = speciesByDex(dex)?.name ?? `#${dex}`;
		const yes = await this.confirmOnce(
			`Starter pack: add ${name}?`,
			`${name} joins your Pokedex at Lv ${START_LEVEL}. This can only be used once. Use it now?`,
			'Use it now',
		);
		if (!yes) return;
		await this.applyStarter(
			() => claimStarterPokemon(this.data, dex, new Date()),
			() => new Notice(`Sheiko Pokedex: Starter pack used. ${name} joined your Pokedex.`),
		);
	}

	async starterXp(): Promise<void> {
		const pre = useStarterXp(this.data);
		if (!pre.ok) return void new Notice(this.starterRefusalText(pre.reason));
		const name = speciesByDex(this.data.partner ?? 0)?.name ?? 'your partner';
		const left = this.data.starter.xpLeft;
		const yes = await this.confirmOnce(
			`Starter pack: ${STARTER_XP} XP for ${name}?`,
			starterXpConfirmText(left),
			'Use it now',
		);
		if (!yes) return;
		await this.applyStarter(
			() => useStarterXp(this.data),
			(r) => {
				const rest = this.data.starter.xpLeft;
				new Notice(`Sheiko Pokedex: Starter pack${this.xpText(r.xp ?? null)} ${rest} of ${STARTER_XP_USES} left.`);
				this.maybeAskToEvolve(r.xp ?? null);
			},
		);
	}

	choosePartner(): void {
		if (!Object.keys(this.data.caught).length) {
			new Notice('Sheiko Pokedex: catch a Pokémon first, then choose it as your partner.');
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
				// Confirmed: play the Evolution scene. Stone evolutions can't be stopped, as in the game.
				this.showWindow(() =>
					new EvolutionSceneModal(this.app, from, to, {
						cancellable: false,
						calm: this.calmEvolution(),
						onResult: () =>
							void this.enqueue(async () => {
								const next = evolve(this.data, fromDex, toDex, new Date(), stone);
								if (!next) {
									new Notice(`Sheiko Pokedex: no ${STONE_LABELS[stone]} left.`);
									return;
								}
								await this.commit(next);
								new Notice(`${from.name} evolved into ${to.name}!`);
							}),
					}).open(),
				);
			}).open(),
		);
	}

	private updateStatusBar(): void {
		if (!this.statusBar) return;
		const dex = this.data.partner;
		const p = dex !== null ? speciesByDex(dex) : undefined;
		if (!p || dex === null) {
			this.statusBar.setText('Pokedex: choose a partner');
			const hasCaught = Object.keys(this.data.caught).length > 0;
			this.statusBar.setAttr(
				'aria-label',
				hasCaught ? 'Choose a partner to earn XP. Click to choose.' : 'Catch a Pokémon first. Click to open the Pokedex.',
			);
			return;
		}
		const mon = this.data.mons[String(dex)] ?? { level: START_LEVEL, xp: 0 };
		this.statusBar.setText(`${p.name} Lv ${mon.level}`);
		const waiting = levelEvolutionAvailable(dex, mon);
		const evo = waiting ? ` · can evolve into ${waiting.name}` : '';
		this.statusBar.setAttr(
			'aria-label',
			`${p.name} · Lv ${mon.level} · ${mon.xp} / ${xpToNext(mon.level)} XP${evo}. Click to open the Pokedex, right-click for more.`,
		);
	}

	private onStatusBarClick(): void {
		if (this.data.partner === null && Object.keys(this.data.caught).length > 0) this.choosePartner();
		else void this.openPokedex();
	}

	private showStatusBarMenu(e: MouseEvent): void {
		e.preventDefault();
		const menu = new Menu();
		menu.addItem((i) => i.setTitle('Open Pokedex').setIcon('circle-dot').onClick(() => void this.openPokedex()));
		menu.addItem((i) => i.setTitle('Choose partner').setIcon('user').onClick(() => this.choosePartner()));
		const dex = this.data.partner;
		const mon = dex !== null ? this.data.mons[String(dex)] : undefined;
		const to = dex !== null && mon ? levelEvolutionAvailable(dex, mon) : null;
		if (dex !== null && to) {
			menu.addItem((i) =>
				i
					.setTitle(`Evolve now: ${to.name}`)
					.setIcon('sparkles')
					.onClick(() => this.askLevelEvolution(dex, true)),
			);
		}
		menu.showAtMouseEvent(e);
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

	// --- Sprites (DB, Sheikh 2026-10-13). Off by default; downloaded only when the user asks. ---

	/** This plugin's own folder: <config>/plugins/<id>/sprites. Never part of the repo or a release. */
	spritesDir(): string {
		const pluginDir = this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
		return normalizePath(`${pluginDir}/sprites`);
	}

	/** How many sprites are loaded right now (0 = badges). */
	spritesLoaded(): number {
		return this.spriteUrls.length;
	}

	private clearSpriteUrls(): void {
		setSprites(new Map());
		for (const url of this.spriteUrls) URL.revokeObjectURL(url);
		this.spriteUrls = [];
	}

	/** Loads the saved sprites. All 151 must be there and pass the checks, or it stays on badges. */
	async loadSprites(): Promise<boolean> {
		const adapter = this.app.vault.adapter;
		const dir = this.spritesDir();
		this.clearSpriteUrls();
		try {
			if (!(await adapter.exists(dir))) return false;
			const urls = new Map<number, string>();
			for (let dex = 1; dex <= SPRITE_COUNT; dex++) {
				const path = `${dir}/${spriteFileName(dex)}`;
				if (!(await adapter.exists(path))) throw new Error(`missing ${spriteFileName(dex)}`);
				const bytes = new Uint8Array(await adapter.readBinary(path));
				const problem = checkSprite(bytes);
				if (problem) throw new Error(`${spriteFileName(dex)}: ${problem}`);
				urls.set(dex, URL.createObjectURL(new Blob([bytes], { type: 'image/png' })));
			}
			if (this.unloading) {
				for (const url of urls.values()) URL.revokeObjectURL(url);
				return false;
			}
			this.spriteUrls = [...urls.values()];
			setSprites(urls);
			return true;
		} catch (e) {
			console.warn('[Sheiko Pokedex] Saved sprites not used, showing badges:', e);
			this.clearSpriteUrls();
			return false;
		} finally {
			this.refreshViews();
			this.updateStatusBar();
		}
	}

	/** Downloads all 151 sprites, checks them, then saves them. On any failure nothing is saved. */
	async downloadAndSaveSprites(onProgress: (done: number, total: number) => void): Promise<void> {
		if (this.spriteDownloadRunning) return;
		this.spriteDownloadRunning = true;
		try {
			const result = await downloadSprites({
				fetchBytes: async (url) => (await requestUrl({ url, throw: true })).arrayBuffer,
				sleep: (ms) => new Promise((r) => window.setTimeout(r, ms)),
				onProgress,
				cancelled: () => this.unloading,
			});
			if (!result.ok) {
				this.lastSpriteError = result.error;
				new Notice(`Sheiko Pokedex: sprites not downloaded. ${result.error} Placeholder badges stay.`, 10000);
				return;
			}
			// All-or-nothing (0.9.1): written to a temp folder, then swapped in; on failure nothing changes.
			await saveSpritesAtomically(this.app.vault.adapter, this.spritesDir(), result.sprites);
			const ok = await this.loadSprites();
			this.lastSpriteError = ok ? null : 'Saved but could not be loaded. See the developer console.';
			new Notice(ok ? `Sheiko Pokedex: ${SPRITE_COUNT} sprites downloaded.` : 'Sheiko Pokedex: sprites saved but could not be loaded. See the console.');
		} catch (e) {
			console.error('[Sheiko Pokedex] Sprite download failed:', e);
			this.lastSpriteError = `Could not save the sprites: ${e instanceof Error ? e.message : String(e)}`;
			new Notice('Sheiko Pokedex: sprites not downloaded. Placeholder badges stay.', 10000);
		} finally {
			this.spriteDownloadRunning = false;
		}
	}

	/** Deletes the sprite folder and goes back to badges. */
	async removeSprites(): Promise<void> {
		const adapter = this.app.vault.adapter;
		const dir = this.spritesDir();
		this.clearSpriteUrls();
		if (await adapter.exists(dir)) await adapter.rmdir(dir, true);
		this.refreshViews();
		this.updateStatusBar();
		new Notice('Sheiko Pokedex: sprites removed. Placeholder badges are back.');
	}
}

/** Settings keys shown as declarative controls (1.1.0, Obsidian 1.13 settings API). */
type ControlKey = 'dailyCap' | 'showRewardWindow' | 'bulkThreshold' | 'bulkWindowMinutes' | 'calmEvolution' | 'contextTypes' | 'testTools';

/**
 * Settings tab, declarative since 1.1.0 (Obsidian 1.13's getSettingDefinitions, so settings appear
 * in Obsidian's settings search; minAppVersion 1.13.0). Plain settings are controls; the Sprites and
 * Starter pack rows keep their buttons as `render` rows. `update()` redraws (display() is gone).
 */
class PokedexSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: SheikoPokedexPlugin,
	) {
		super(app, plugin);
	}

	getControlValue(key: string): unknown {
		return (this.plugin.data.settings as unknown as Record<string, unknown>)[key];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const s = this.plugin.data.settings;
		switch (key as ControlKey) {
			case 'dailyCap':
				s.dailyCap = Math.floor(Number(value));
				// Typing a limit answers the 1.4.0 question too (#39). Not redrawn now, so typing keeps
				// focus; the box is gone the next time this tab opens.
				this.plugin.data.capUpgrade = 'done';
				break;
			case 'bulkThreshold':
				s.bulkThreshold = Math.floor(Number(value));
				break;
			case 'bulkWindowMinutes':
				s.bulkWindowMinutes = Number(value);
				break;
			case 'showRewardWindow':
				s.showRewardWindow = value === true;
				break;
			case 'calmEvolution':
				s.calmEvolution = value === true;
				break;
			case 'testTools':
				s.testTools = value === true;
				break;
			case 'contextTypes':
				s.contextTypes = typeof value === 'string' ? value : s.contextTypes;
				break;
			default:
				return;
		}
		await this.plugin.saveSettings();
	}

	getSettingDefinitions(): SettingDefinitionItem<ControlKey>[] {
		const sheiko = sheikoEnabled(this.app);
		const items: SettingDefinitionItem<ControlKey>[] = [
			{
				name: sheiko ? 'Sheiko Task Lifecycle is enabled' : 'Sheiko Task Lifecycle is not enabled',
				desc: sheiko ? 'Task closes earn Pokémon.' : 'Closes will not earn Pokémon until it is.',
			},
			...this.capUpgradeItems(),
			{
				name: 'Daily catch limit',
				desc: 'Catches per day. Once reached, further closes that day give your partner XP but no catch progress, and never count toward a catch later.',
				control: {
					type: 'number',
					key: 'dailyCap',
					min: 0,
					step: 1,
					validate: (v) => (Number.isInteger(v) && v >= 0 ? undefined : 'Enter a whole number, 0 or more.'),
				},
			},
			{
				name: 'Show reward window',
				desc: 'Off: a short notice instead of a window.',
				control: { type: 'toggle', key: 'showRewardWindow' },
			},
			{
				name: 'Bulk closes',
				desc: 'Closes beyond this many within the window below count as half a close toward your next catch and the daily boost. This does not change XP.',
				control: {
					type: 'number',
					key: 'bulkThreshold',
					min: 1,
					step: 1,
					validate: (v) => (Number.isInteger(v) && v >= 1 ? undefined : 'Enter a whole number, 1 or more.'),
				},
			},
			{
				name: 'Bulk window (minutes)',
				desc: 'How far back closes are counted for the bulk rule.',
				control: {
					type: 'number',
					key: 'bulkWindowMinutes',
					step: 'any',
					validate: (v) => (Number.isFinite(v) && v > 0 ? undefined : 'Enter a number greater than 0.'),
				},
			},
			{
				name: 'Calm evolution scene',
				desc: 'Replaces the fast flicker of the evolution scene with a slow fade. Turned on automatically when your system asks for reduced motion.',
				control: { type: 'toggle', key: 'calmEvolution' },
			},
			this.spritesGroup(),
			this.starterGroup(),
		];
		if (__SHEIKO_DEV__) {
			// Development builds only (npm run dev). Release builds have the Starter pack instead.
			items.push({
				name: 'Test tools (development build)',
				desc: 'Adds unlimited commands to give your partner 500 XP, give one of each stone, and add any Pokémon, so evolution can be tried quickly. Only in development builds; releases do not include them.',
				control: { type: 'toggle', key: 'testTools' },
			});
		}
		items.push({
			type: 'group',
			cls: 'sheiko-pokedex-context-group',
			items: [
				{
					name: 'Context to type',
					desc: 'One per line, "context: type, type". A task\'s contexts narrow which types can appear. Unknown contexts allow any type.',
					control: { type: 'textarea', key: 'contextTypes', rows: 10 },
				},
			],
		});
		return items;
	}

	/** Redraws the tab if it's on screen (after a Starter pack gift is used, which finishes after a dialog). */
	refreshIfOpen(): void {
		if (this.containerEl.isConnected) this.update();
	}

	/** 1.4.0 (#39): "Move to 5 or Keep 3", shown above the limit until answered. */
	private capUpgradeItems(): SettingDefinitionItem<ControlKey>[] {
		if (this.plugin.data.capUpgrade === 'done') return [];
		const next = DEFAULT_SETTINGS.dailyCap;
		return [
			{
				name: `New default: ${next} catches a day`,
				render: (setting) => {
					setting
						.setDesc(
							`Since 1.4.0 the default daily catch limit is ${next}. Yours is still ${OLD_DEFAULT_DAILY_CAP}. Choose one; you can change it again below at any time.`,
						)
						.addButton((b) =>
							b
								.setButtonText(`Move to ${next}`)
								.setCta()
								.onClick(() => void this.plugin.answerCapUpgrade(next)),
						)
						.addButton((b) =>
							b.setButtonText(`Keep ${OLD_DEFAULT_DAILY_CAP}`).onClick(() => void this.plugin.answerCapUpgrade(OLD_DEFAULT_DAILY_CAP)),
						);
				},
			},
		];
	}

	/** Starter pack (Sheikh, 2026-10-13, 0.9.0): always shown; each gift once per install, asked first. */
	private starterGroup(): SettingDefinitionItem<ControlKey> {
		const p = this.plugin.data.starter;
		return {
			type: 'group',
			heading: 'Starter pack',
			items: [
				{
					name: 'Once per install',
					desc: `A one-time boost to get you started. Each part can be used once, ever, for this install, and nothing refills it. You're asked to confirm before anything is used. Left: ${starterSummary(p)}.`,
				},
				{
					name: 'One of each stone',
					render: (setting) => {
						setting.setDesc(p.stones ? 'A Fire, Water, Thunder, Leaf, Moon and Trade Stone.' : 'Used.').addButton((b) =>
							b
								.setButtonText(p.stones ? 'Use' : 'Used')
								.setDisabled(!p.stones)
								.onClick(() => void this.plugin.starterStones()),
						);
					},
				},
				{
					name: 'Choose a Pokémon',
					render: (setting) => {
						setting
							.setDesc(p.pokemon ? `Any Pokémon you haven't caught yet, legendaries included. It joins at Lv ${START_LEVEL}.` : 'Used.')
							.addButton((b) =>
								b
									.setButtonText(p.pokemon ? 'Choose' : 'Used')
									.setDisabled(!p.pokemon)
									.onClick(() => void this.plugin.starterPokemon()),
							);
					},
				},
				{
					name: `${STARTER_XP} XP for your partner`,
					render: (setting) => {
						setting
							.setDesc(
								p.xpLeft > 0
									? `${p.xpLeft} of ${STARTER_XP_USES} left. Goes to whoever is your partner when you use it.`
									: 'All used.',
							)
							.addButton((b) =>
								b
									.setButtonText(p.xpLeft > 0 ? 'Give XP' : 'Used')
									.setDisabled(p.xpLeft <= 0)
									.onClick(() => void this.plugin.starterXp()),
							);
					},
				},
			],
		};
	}

	/** Sprites (DB): states the network call, the source and the rules before anything is fetched. */
	private spritesGroup(): SettingDefinitionItem<ControlKey> {
		const loaded = this.plugin.spritesLoaded();
		const error = this.plugin.lastSpriteError;
		return {
			type: 'group',
			heading: 'Sprites',
			items: [
				{ name: 'Optional sprites', desc: SPRITES_INTRO },
				...spriteInfo(this.plugin.spritesDir()).map((info) => ({ name: info.name, desc: info.desc })),
				{
					name: loaded ? `Downloaded: ${loaded} sprites` : 'Not downloaded: showing placeholder badges',
					render: (setting) => {
						setting.setDesc(
							loaded
								? 'Remove deletes the sprites folder and brings the badges back. You can download again at any time.'
								: error
									? `Last download failed, nothing was saved: ${error}`
									: 'Takes about 30 seconds. Keep this window open until it finishes.',
						);
						if (loaded) {
							setting.addButton((b) =>
								b.setButtonText('Remove sprites').onClick(() => {
									void this.plugin.removeSprites().then(() => this.update());
								}),
							);
						} else {
							setting.addButton((b) => {
								b.setButtonText(this.plugin.spriteDownloadRunning ? 'Downloading…' : 'Download sprites')
									.setCta()
									.setDisabled(this.plugin.spriteDownloadRunning)
									.onClick(() => {
										b.setDisabled(true);
										void this.plugin
											.downloadAndSaveSprites((done, total) => {
												b.setButtonText(`Downloading ${done}/${total}…`);
											})
											.then(() => this.update());
									});
							});
						}
					},
				},
			],
		};
	}
}
