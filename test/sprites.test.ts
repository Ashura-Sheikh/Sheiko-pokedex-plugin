// Sprites (S1, Sheikh 2026-10-12): art is fetched only into a git-ignored local file and is
// never committed. These tests keep it that way: CI fails if image files or embedded PNG
// data ever end up tracked by git, since the repo is planned to go public.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { spriteFor } from '../src/ui/art';
import { SPRITES } from '../src/data/sprites.none';

const root = new URL('..', import.meta.url).pathname; // test-dist/x.mjs → repo root

function tracked(): string[] {
	return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
}

test('tests and CI build with the empty sprite map, never the local art', () => {
	assert.deepEqual(SPRITES, {});
	assert.equal(spriteFor(25), null, 'badge fallback: no sprite in the test build');
});

test('no image files are tracked by git', () => {
	const images = tracked().filter((f) => /\.(png|gif|jpe?g|webp|bmp|ico)$/i.test(f));
	assert.deepEqual(images, []);
});

test('no embedded PNG data is tracked by git', () => {
	// Built from pieces so this file doesn't contain the pattern itself.
	const pngBase64 = ['data:image/png;base64,', 'iVBORw0KGgo'].join('');
	const hits = tracked().filter((f) => {
		if (f === 'package-lock.json') return false;
		try {
			return readFileSync(root + f, 'utf8').includes(pngBase64);
		} catch {
			return false;
		}
	});
	assert.deepEqual(hits, []);
});

test('the local sprite file is git-ignored', () => {
	const out = execFileSync('git', ['check-ignore', 'src/data/sprites.local.ts'], { cwd: root, encoding: 'utf8' });
	assert.equal(out.trim(), 'src/data/sprites.local.ts');
});
