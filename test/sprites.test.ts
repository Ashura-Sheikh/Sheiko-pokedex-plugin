// Sprites. S1 (Sheikh 2026-10-12): no art is ever committed; CI fails if image files (outside the
// user guide's badge-only screenshots) or embedded PNG data end up tracked by git. DB (Sheikh 2026-10-13): users download sprites from settings;
// the download is checked here with fake network responses, so no real images are involved.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setSprites, spriteFor } from '../src/ui/art';
import {
	DOWNLOAD_PAUSE_MS,
	MAX_SPRITE_BYTES,
	SPRITE_BUCKETS,
	bucketDexes,
	SPRITES_GITIGNORE,
	checkSprite,
	downloadSprites,
	SPRITES_INTRO,
	spriteFileName,
	spriteInfo,
	spriteUrl,
} from '../src/sprites';

const root = new URL('..', import.meta.url).pathname; // test-dist/x.mjs → repo root

function tracked(): string[] {
	return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
}

test('no sprites until some are loaded: badges by default', () => {
	assert.equal(spriteFor(25), null);
	setSprites(new Map([[25, 'blob:x']]));
	assert.equal(spriteFor(25), 'blob:x');
	setSprites(new Map());
	assert.equal(spriteFor(25), null);
});

// User guide (Sheikh 2026-10-13): screenshots are allowed, but only as PNGs in docs/images/, and only
// in placeholder-badge mode, with no sprites showing. That last part is a review rule, not something a
// test can see; the size check below catches the most likely slip, a sprite file itself.
const GUIDE_IMAGES = 'docs/images/';

test('image files are tracked only as PNG screenshots in docs/images/', () => {
	const images = tracked().filter((f) => /\.(png|gif|jpe?g|webp|bmp|ico)$/i.test(f));
	const outside = images.filter((f) => !(f.startsWith(GUIDE_IMAGES) && /\.png$/i.test(f)));
	assert.deepEqual(outside, []);
});

test('no tracked PNG has a sprite size (96×96)', () => {
	const sized = tracked()
		.filter((f) => /\.png$/i.test(f))
		.filter((f) => {
			const b = readFileSync(root + f);
			return b.length >= 24 && b.readUInt32BE(16) === 96 && b.readUInt32BE(20) === 96;
		});
	assert.deepEqual(sized, []);
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

// --- DB: the download button's core ---

/** Just enough of a PNG for the checks: signature + IHDR with the given size, padded to `length`. */
function fakePng(w = 96, h = 96, length = 200): Uint8Array {
	const b = new Uint8Array(length);
	b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
	const v = new DataView(b.buffer);
	v.setUint32(16, w);
	v.setUint32(20, h);
	return b;
}

function buf(b: Uint8Array): ArrayBuffer {
	return b.slice().buffer;
}

test('checkSprite: accepts a 96×96 PNG under 64 KB, rejects anything else', () => {
	assert.equal(checkSprite(fakePng()), null);
	assert.match(checkSprite(fakePng(96, 96, MAX_SPRITE_BYTES + 1)) ?? '', /over the/);
	assert.match(checkSprite(fakePng(64, 96)) ?? '', /64×96/);
	assert.match(checkSprite(fakePng(96, 120)) ?? '', /96×120/);
	const notPng = fakePng();
	notPng[1] = 0x00;
	assert.equal(checkSprite(notPng), 'not a PNG');
	const noIhdr = fakePng();
	noIhdr[12] = 0x58;
	assert.equal(checkSprite(noIhdr), 'not a PNG');
	assert.equal(checkSprite(new Uint8Array(10)), 'not a PNG');
	assert.equal(checkSprite(new TextEncoder().encode('<html>404</html>'.padEnd(40))), 'not a PNG');
});

/** Gen 1's bucket: these tests check the Gen 1 download, as before 2.0.0. */
const GEN1_SPRITES = bucketDexes(SPRITE_BUCKETS[0]!);

test('the source is PokeAPI\'s sprite repository, 151 files named 001.png to 151.png', () => {
	assert.equal(GEN1_SPRITES.length, 151);
	assert.equal(spriteUrl(25), 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png');
	assert.equal(spriteFileName(1), '001.png');
	assert.equal(spriteFileName(151), '151.png');
	assert.match(SPRITES_GITIGNORE, /^\*$/m, 'the sprite folder ignores everything in it');
});

test('download: all 151, one at a time, with a pause between each', async () => {
	const urls: string[] = [];
	const pauses: number[] = [];
	let inFlight = 0;
	let maxInFlight = 0;
	const progress: number[] = [];
	const r = await downloadSprites({
		fetchBytes: async (url) => {
			inFlight++;
			maxInFlight = Math.max(maxInFlight, inFlight);
			urls.push(url);
			await Promise.resolve();
			inFlight--;
			return buf(fakePng());
		},
		sleep: async (ms) => {
			pauses.push(ms);
		},
		onProgress: (done) => progress.push(done),
	}, GEN1_SPRITES);
	assert.ok(r.ok);
	assert.equal(r.sprites.size, 151);
	assert.equal(urls.length, 151);
	assert.equal(urls[0], spriteUrl(1));
	assert.equal(urls[150], spriteUrl(151));
	assert.equal(maxInFlight, 1, 'never more than one request at a time');
	assert.equal(pauses.length, 150);
	assert.ok(pauses.every((p) => p === DOWNLOAD_PAUSE_MS));
	assert.equal(progress.at(-1), 151);
});

test('download: unreachable source → error, nothing returned to save', async () => {
	let calls = 0;
	const r = await downloadSprites({
		fetchBytes: async () => {
			if (++calls === 40) throw new Error('net::ERR_INTERNET_DISCONNECTED');
			return buf(fakePng());
		},
		sleep: async () => {},
	}, GEN1_SPRITES);
	assert.equal(r.ok, false);
	assert.ok(!r.ok && /#40/.test(r.error) && /ERR_INTERNET_DISCONNECTED/.test(r.error));
	assert.equal(calls, 40, 'stops at the first failure');
});

test('download: one bad image → error, nothing returned to save', async () => {
	const r = await downloadSprites({
		fetchBytes: async (url) => buf(url.endsWith('/7.png') ? fakePng(128, 128) : fakePng()),
		sleep: async () => {},
	}, GEN1_SPRITES);
	assert.equal(r.ok, false);
	assert.ok(!r.ok && /#7/.test(r.error) && /128×128/.test(r.error));
});

test('download: stops when cancelled (plugin unloading)', async () => {
	let calls = 0;
	const r = await downloadSprites({
		fetchBytes: async () => {
			calls++;
			return buf(fakePng());
		},
		sleep: async () => {},
		cancelled: () => calls >= 3,
	}, GEN1_SPRITES);
	assert.equal(r.ok, false);
	assert.equal(calls, 3);
});

test('main.ts only fetches when the user presses the button', () => {
	const main = readFileSync(root + 'src/main.ts', 'utf8');
	// requestUrl appears once, inside downloadAndSaveSprites, which only the settings button calls.
	assert.equal(main.match(/requestUrl\(/g)?.length, 1);
	const calls = main.match(/downloadAndSaveSprites\(/g)?.length;
	assert.equal(calls, 2, 'its definition plus the one call from the Download button');
	assert.ok(!/void this\.downloadAndSaveSprites/.test(main), 'never started automatically');
});

test('settings explain the download before it happens (RAID row 87, condition 3)', () => {
	const rows = spriteInfo('.obsidian/plugins/sheiko-pokedex/sprites');
	const text = [SPRITES_INTRO, ...rows.map((r) => `${r.name}: ${r.desc}`)].join('\n');
	assert.deepEqual(
		rows.map((r) => r.name),
		['What you get', 'Where they come from', 'Checks', 'Where they are saved', 'Who owns them'],
	);
	for (const must of [
		'Nothing is downloaded unless you press',
		'github.com/PokeAPI/sprites',
		"one request per sprite you don't have yet to raw.githubusercontent.com",
		'no other network requests',
		'PNG, 96×96 and under 64 KB',
		'nothing is saved and the badges stay',
		'.obsidian/plugins/sheiko-pokedex/sprites',
		'.gitignore',
		'Nintendo / Game Freak',
		'do not commit, share or redistribute',
	]) {
		assert.ok(text.includes(must), `settings text missing: ${must}`);
	}
});
