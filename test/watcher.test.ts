// Runs the real Watcher against a tiny in-memory app: TaskNotes config on disk,
// a metadata cache, Sheiko on/off, and fake timers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TFile } from './obsidian-mock';
import { READ_DELAY_MS, SHEIKO_ID, Watcher, sheikoEnabled } from '../src/watcher';
import type { CloseInput } from '../src/store';
import type { App, TFile as RealTFile } from 'obsidian';

type FM = Record<string, unknown>;

const timers = new Map<number, { fn: () => void; ms: number }>();
let nextId = 1;
(globalThis as unknown as { window: unknown }).window = {
	setTimeout: (fn: () => void, ms: number) => {
		const id = nextId++;
		timers.set(id, { fn, ms });
		return id;
	},
	clearTimeout: (id: number) => timers.delete(id),
};

async function runTimers(): Promise<void> {
	const all = [...timers.values()];
	timers.clear();
	for (const t of all) {
		assert.equal(t.ms, READ_DELAY_MS);
		t.fn();
	}
	for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
}

class FakeApp {
	notes = new Map<string, FM>();
	files = new Map<string, TFile>();
	disk = new Map<string, string>();
	enabled = new Set<string>(['tasknotes', SHEIKO_ID]);
	vault = {
		configDir: '.obsidian',
		adapter: {
			exists: (p: string) => Promise.resolve(this.disk.has(p)),
			read: (p: string) => Promise.resolve(this.disk.get(p) ?? ''),
		},
		getMarkdownFiles: () => [...this.files.values()],
	};
	metadataCache = {
		getFileCache: (f: TFile) => (this.notes.has(f.path) ? { frontmatter: this.notes.get(f.path) } : null),
	};
	plugins = { enabledPlugins: this.enabled };

	constructor(taskNotes = true) {
		if (taskNotes) {
			this.disk.set('.obsidian/community-plugins.json', JSON.stringify(['tasknotes', SHEIKO_ID]));
			this.disk.set(
				'.obsidian/plugins/tasknotes/data.json',
				JSON.stringify({
					taskTag: 'task',
					customStatuses: [
						{ value: 'open', isCompleted: false },
						{ value: 'done', isCompleted: true },
					],
				}),
			);
		}
	}

	add(path: string, fm: FM): TFile {
		const f = new TFile(path);
		this.files.set(path, f);
		this.notes.set(path, { tags: ['task'], ...fm });
		return f;
	}

	edit(path: string, changes: FM): void {
		this.notes.set(path, { ...this.notes.get(path), ...changes });
	}
}

function setup(taskNotes = true) {
	timers.clear();
	const app = new FakeApp(taskNotes);
	const closes: CloseInput[] = [];
	const renames: [string, string][] = [];
	const watcher = new Watcher({
		app: app as unknown as App,
		onClose: (input) => void closes.push(input),
		onPathRenamed: (a, b) => void renames.push([a, b]),
	});
	const change = (f: TFile, fm: FM) => {
		app.edit(f.path, fm);
		watcher.onMetadataChanged(f as unknown as RealTFile);
	};
	return { app, watcher, closes, renames, change };
}

test('a live open → done change is reported after the read delay, with its fields', async () => {
	const { app, watcher, closes, change } = setup();
	const f = app.add('T/A.md', { status: 'open', priority: 'high', contexts: ['legal'], dateCreated: '2026-10-12' });
	assert.equal(await watcher.start(), true);
	change(f, { status: 'done', completedDate: '2026-10-12T10:00:00+01:00', closeReason: 'parked' });
	assert.equal(closes.length, 0, 'nothing before the delay');
	await runTimers();
	assert.deepEqual(closes, [
		{
			path: 'T/A.md',
			priority: 'high',
			contexts: ['legal'],
			closeReason: 'parked',
			dateCreated: '2026-10-12',
			completedDate: '2026-10-12T10:00:00+01:00',
			workingMinutes: null,
		},
	]);
});

test("Sheiko's timeWorkingMinutes is passed on when present", async () => {
	const { app, watcher, closes, change } = setup();
	const f = app.add('T/W.md', { status: 'open' });
	await watcher.start();
	change(f, { status: 'done', timeWorkingMinutes: 95 });
	await runTimers();
	assert.equal(closes[0]?.workingMinutes, 95);
});

test('tasks already done at startup never pay out (rewards start from install)', async () => {
	const { app, watcher, closes, change } = setup();
	const f = app.add('T/Old.md', { status: 'done' });
	await watcher.start();
	change(f, { priority: 'high' });
	await runTimers();
	assert.equal(closes.length, 0);
});

test('a note first seen already done (created closed) is not a live close', async () => {
	const { app, watcher, closes, change } = setup();
	await watcher.start();
	const f = app.add('T/New.md', { status: 'open' });
	app.edit(f.path, { status: 'done' });
	watcher.onMetadataChanged(f as unknown as RealTFile);
	await runTimers();
	assert.equal(closes.length, 0);
	change(f, { status: 'open' });
	change(f, { status: 'done' });
	await runTimers();
	assert.equal(closes.length, 1, 'a later real close still counts');
});

test('reopened within the delay: no close reported', async () => {
	const { app, watcher, closes, change } = setup();
	const f = app.add('T/A.md', { status: 'open' });
	await watcher.start();
	change(f, { status: 'done' });
	change(f, { status: 'open' });
	await runTimers();
	assert.equal(closes.length, 0);
});

test('non-task notes are ignored', async () => {
	const { app, watcher, closes } = setup();
	const f = app.add('Notes/x.md', { status: 'open' });
	app.notes.set(f.path, { status: 'open' }); // no task tag
	await watcher.start();
	app.edit(f.path, { status: 'done' });
	watcher.onMetadataChanged(f as unknown as RealTFile);
	await runTimers();
	assert.equal(closes.length, 0);
});

test('rename during the delay: reported under the new path, and the host is told', async () => {
	const { app, watcher, closes, renames, change } = setup();
	const f = app.add('T/A.md', { status: 'open' });
	await watcher.start();
	change(f, { status: 'done' });
	const moved = new TFile('Archive/A.md');
	app.notes.set(moved.path, app.notes.get('T/A.md')!);
	watcher.onRename(moved as unknown as RealTFile, 'T/A.md');
	await runTimers();
	assert.deepEqual(renames, [['T/A.md', 'Archive/A.md']]);
	assert.equal(closes.length, 1);
	assert.equal(closes[0]!.path, 'Archive/A.md');
});

test('TaskNotes missing: start() reports false and nothing is watched', async () => {
	const { watcher } = setup(false);
	assert.equal(await watcher.start(), false);
});

test('sheikoEnabled follows the enabled-plugins list', () => {
	const { app } = setup();
	assert.equal(sheikoEnabled(app as unknown as App), true);
	app.enabled.delete(SHEIKO_ID);
	assert.equal(sheikoEnabled(app as unknown as App), false);
});
