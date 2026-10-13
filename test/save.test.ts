// 0.9.1: the sprite save is all-or-nothing (project-manager's 0.8.0 gate note). Checked on an
// in-memory file system that can be told to fail at any step.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPRITES_GITIGNORE, SPRITE_COUNT, SpriteFs, saveSpritesAtomically, spriteFileName } from '../src/sprites';

const DIR = 'plugins/sheiko-pokedex/sprites';

type Op = 'mkdir' | 'write' | 'writeBinary' | 'rename' | 'rmdir';

/** Files only (folders are implied by their files, plus explicit empty ones). */
class FakeFs implements SpriteFs {
	files = new Map<string, string>();
	dirs = new Set<string>();
	log: string[] = [];
	/** Throw on the n-th call (1-based) of an operation, optionally only for a matching path. */
	failAt: { op: Op; n: number; path?: RegExp } | null = null;
	private counts: Record<string, number> = {};

	private hit(op: Op, path: string): void {
		this.log.push(`${op} ${path}`);
		if (!this.failAt || this.failAt.op !== op) return;
		if (this.failAt.path && !this.failAt.path.test(path)) return;
		this.counts[op] = (this.counts[op] ?? 0) + 1;
		if (this.counts[op] === this.failAt.n) throw new Error(`disk error on ${op} ${path}`);
	}
	private under(path: string): string[] {
		return [...this.files.keys()].filter((f) => f.startsWith(`${path}/`));
	}
	async exists(path: string): Promise<boolean> {
		return this.files.has(path) || this.dirs.has(path) || this.under(path).length > 0;
	}
	async mkdir(path: string): Promise<void> {
		this.hit('mkdir', path);
		this.dirs.add(path);
	}
	async write(path: string, data: string): Promise<void> {
		this.hit('write', path);
		this.files.set(path, data);
	}
	async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
		this.hit('writeBinary', path);
		this.files.set(path, `bin:${new Uint8Array(data)[0]}`);
	}
	async rename(from: string, to: string): Promise<void> {
		this.hit('rename', `${from} -> ${to}`);
		for (const f of this.under(from)) {
			this.files.set(to + f.slice(from.length), this.files.get(f)!);
			this.files.delete(f);
		}
		if (this.dirs.delete(from)) this.dirs.add(to);
	}
	async rmdir(path: string): Promise<void> {
		this.hit('rmdir', path);
		for (const f of this.under(path)) this.files.delete(f);
		this.dirs.delete(path);
	}
	/** Everything under `path`, relative, sorted. */
	listing(path: string): string[] {
		return this.under(path)
			.map((f) => f.slice(path.length + 1))
			.sort();
	}
}

/** 151 one-byte "images"; the byte tells old from new. */
function sprites(marker: number): Map<number, Uint8Array> {
	const m = new Map<number, Uint8Array>();
	for (let dex = 1; dex <= SPRITE_COUNT; dex++) m.set(dex, new Uint8Array([marker]));
	return m;
}

const FULL = ['.gitignore', ...Array.from({ length: SPRITE_COUNT }, (_, i) => spriteFileName(i + 1))].sort();

/** A folder holding a complete earlier save, marked 1. */
async function withOldSave(): Promise<FakeFs> {
	const fs = new FakeFs();
	await saveSpritesAtomically(fs, DIR, sprites(1));
	fs.log = [];
	return fs;
}

function noLeftovers(fs: FakeFs): void {
	assert.deepEqual(fs.listing(`${DIR}.tmp`), [], 'temp folder removed');
	assert.deepEqual(fs.listing(`${DIR}.old`), [], 'old folder removed');
}

test('a first save creates the folder with .gitignore and all 151, and leaves nothing else', async () => {
	const fs = new FakeFs();
	await saveSpritesAtomically(fs, DIR, sprites(7));
	assert.deepEqual(fs.listing(DIR), FULL);
	assert.equal(fs.files.get(`${DIR}/.gitignore`), SPRITES_GITIGNORE);
	assert.equal(fs.files.get(`${DIR}/${spriteFileName(151)}`), 'bin:7');
	noLeftovers(fs);
});

test('.gitignore is written before any image, so the temp folder is never committable', async () => {
	const fs = new FakeFs();
	await saveSpritesAtomically(fs, DIR, sprites(7));
	const firstImage = fs.log.findIndex((l) => l.startsWith('writeBinary'));
	const gitignore = fs.log.indexOf(`write ${DIR}.tmp/.gitignore`);
	assert.ok(gitignore >= 0 && gitignore < firstImage, fs.log.slice(0, 4).join(' | '));
});

test('a failure partway through writing saves nothing: no sprites folder, no temp folder', async () => {
	const fs = new FakeFs();
	fs.failAt = { op: 'writeBinary', n: 40 };
	await assert.rejects(saveSpritesAtomically(fs, DIR, sprites(7)), /disk error/);
	assert.equal(await fs.exists(DIR), false);
	noLeftovers(fs);
});

test('a failure partway through leaves an earlier complete save exactly as it was', async () => {
	const fs = await withOldSave();
	fs.failAt = { op: 'writeBinary', n: 100 };
	await assert.rejects(saveSpritesAtomically(fs, DIR, sprites(2)), /disk error/);
	assert.deepEqual(fs.listing(DIR), FULL);
	assert.equal(fs.files.get(`${DIR}/${spriteFileName(1)}`), 'bin:1', 'still the old sprites');
	noLeftovers(fs);
});

test('a complete save replaces an earlier one entirely', async () => {
	const fs = await withOldSave();
	await saveSpritesAtomically(fs, DIR, sprites(2));
	assert.deepEqual(fs.listing(DIR), FULL);
	assert.equal(fs.files.get(`${DIR}/${spriteFileName(77)}`), 'bin:2');
	noLeftovers(fs);
});

test('if the new folder cannot be moved into place, the old one is put back', async () => {
	const fs = await withOldSave();
	fs.failAt = { op: 'rename', n: 1, path: /\.tmp -> / };
	await assert.rejects(saveSpritesAtomically(fs, DIR, sprites(2)), /disk error/);
	assert.deepEqual(fs.listing(DIR), FULL);
	assert.equal(fs.files.get(`${DIR}/${spriteFileName(1)}`), 'bin:1');
	noLeftovers(fs);
});

test('if the old folder cannot be moved aside, nothing changes', async () => {
	const fs = await withOldSave();
	fs.failAt = { op: 'rename', n: 1, path: /sprites -> .*\.old$/ };
	await assert.rejects(saveSpritesAtomically(fs, DIR, sprites(2)), /disk error/);
	assert.equal(fs.files.get(`${DIR}/${spriteFileName(1)}`), 'bin:1');
	noLeftovers(fs);
});

test('leftovers from an interrupted earlier save are cleared first', async () => {
	const fs = new FakeFs();
	fs.files.set(`${DIR}.tmp/${spriteFileName(5)}`, 'bin:9');
	fs.files.set(`${DIR}.old/${spriteFileName(6)}`, 'bin:9');
	await saveSpritesAtomically(fs, DIR, sprites(3));
	assert.deepEqual(fs.listing(DIR), FULL);
	noLeftovers(fs);
});

test('a temp folder that cannot be removed after a failure still reports the original error', async () => {
	const fs = new FakeFs();
	fs.failAt = { op: 'writeBinary', n: 3 };
	const rmdir = fs.rmdir.bind(fs);
	fs.rmdir = async (p: string) => {
		if (p.endsWith('.tmp')) throw new Error('cannot remove');
		return rmdir(p);
	};
	await assert.rejects(saveSpritesAtomically(fs, DIR, sprites(3)), /disk error on writeBinary/);
	assert.equal(await fs.exists(DIR), false, 'sprites folder never created');
});
