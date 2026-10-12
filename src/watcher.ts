// Watches task notes for a close and asks store.decide() whether it earns a Pokémon.
// Reads only. Waits for TaskNotes and then Sheiko to finish their own writes first.

import { App, TAbstractFile, TFile } from 'obsidian';
import {
	TaskNotesConfig,
	isCompletedStatus,
	isTaskFile,
	loadTaskNotesConfig,
	statusOf,
} from './tasknotes';
import { CloseInput } from './store';

export const SHEIKO_ID = 'sheiko-task-lifecycle';

/**
 * Sheiko waits 600 ms after a status change (SETTLE_MS in its tracker.ts) and then
 * writes closure fields. 2 s leaves room for both TaskNotes' and Sheiko's writes.
 */
export const READ_DELAY_MS = 2000;

type FM = Record<string, unknown>;

export interface WatcherHost {
	app: App;
	onClose(input: CloseInput, file: TFile): void | Promise<void>;
	onPathRenamed(oldPath: string, newPath: string): void | Promise<void>;
}

export function sheikoEnabled(app: App): boolean {
	// Obsidian doesn't type app.plugins; it's stable and widely used.
	const plugins = (app as unknown as { plugins?: { enabledPlugins?: Set<string> } }).plugins;
	return plugins?.enabledPlugins?.has(SHEIKO_ID) ?? false;
}

function list(v: unknown): string[] {
	if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
	return typeof v === 'string' && v ? [v] : [];
}

function text(v: unknown): string | null {
	return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export class Watcher {
	cfg: TaskNotesConfig | null = null;
	/** Last known status per task path. Seeded at startup, so already-done tasks never pay out. */
	private status = new Map<string, string | null>();
	private timers = new Map<string, number>();

	constructor(private host: WatcherHost) {}

	async start(): Promise<boolean> {
		this.cfg = await loadTaskNotesConfig(this.host.app);
		if (!this.cfg.found) return false;
		for (const f of this.host.app.vault.getMarkdownFiles()) {
			if (isTaskFile(this.host.app, f, this.cfg)) this.status.set(f.path, statusOf(this.host.app, f, this.cfg));
		}
		return true;
	}

	stop(): void {
		this.timers.forEach((t) => window.clearTimeout(t));
		this.timers.clear();
	}

	onMetadataChanged(file: TFile): void {
		const cfg = this.cfg;
		if (!cfg?.found) return;
		if (!isTaskFile(this.host.app, file, cfg)) {
			this.status.delete(file.path);
			return;
		}
		const known = this.status.has(file.path);
		const before = this.status.get(file.path) ?? null;
		const now = statusOf(this.host.app, file, cfg);
		this.status.set(file.path, now);
		// A note first seen already closed (created as done) is not a live close.
		if (known && !isCompletedStatus(cfg, before) && isCompletedStatus(cfg, now)) this.schedule(file);
	}

	onRename(file: TAbstractFile, oldPath: string): void {
		if (this.status.has(oldPath)) {
			this.status.set(file.path, this.status.get(oldPath) ?? null);
			this.status.delete(oldPath);
		}
		const t = this.timers.get(oldPath);
		if (t !== undefined) {
			window.clearTimeout(t);
			this.timers.delete(oldPath);
			if (file instanceof TFile) this.schedule(file);
		}
		void this.host.onPathRenamed(oldPath, file.path);
	}

	onDelete(file: TAbstractFile): void {
		this.status.delete(file.path);
		const t = this.timers.get(file.path);
		if (t !== undefined) window.clearTimeout(t);
		this.timers.delete(file.path);
	}

	private schedule(file: TFile): void {
		const existing = this.timers.get(file.path);
		if (existing !== undefined) window.clearTimeout(existing);
		this.timers.set(
			file.path,
			window.setTimeout(() => {
				this.timers.delete(file.path);
				void this.evaluate(file);
			}, READ_DELAY_MS),
		);
	}

	private async evaluate(file: TFile): Promise<void> {
		const cfg = this.cfg;
		if (!cfg) return;
		// Reopened within the delay: not a close any more.
		if (!isCompletedStatus(cfg, statusOf(this.host.app, file, cfg))) return;
		const fm: FM = this.host.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
		await this.host.onClose(
			{
				path: file.path,
				priority: text(fm[cfg.field.priority]),
				contexts: list(fm.contexts),
				closeReason: text(fm.closeReason),
				dateCreated: fm[cfg.field.dateCreated],
				completedDate: fm[cfg.field.completedDate],
			},
			file,
		);
	}
}
