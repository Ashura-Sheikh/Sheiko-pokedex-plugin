// The plugin's name is "Sheiko Pokedex" with no accent, matching its ID (1.0.1). 1.3.0's first
// draft brought "Pokédex" back in a sort label and the docs, and a plain text search of main.js
// missed it because the build writes é as \xE9. These tests keep the accent out everywhere,
// in the escaped forms too. (The bundled PokeAPI data in src/data is left as it is.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname; // test-dist/x.mjs → repo root

/** "Pokédex" as written, or as a build may escape the é. */
const ACCENTED = /Pok(?:é|\\xE9|\\u00E9|\\u{e9}|&eacute;)dex/i;

function filesUnder(dir: string, ext: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(root + dir)) {
		const rel = `${dir}/${name}`;
		if (rel === 'src/data') continue;
		if (statSync(root + rel).isDirectory()) out.push(...filesUnder(rel, ext));
		else if (name.endsWith(ext)) out.push(rel);
	}
	return out;
}

test('docs and source say "Pokedex", without the accent', () => {
	const files = ['README.md', 'CONTRIBUTING.md', ...filesUnder('docs', '.md'), ...filesUnder('src', '.ts')];
	for (const f of files) {
		const lines = readFileSync(root + f, 'utf8').split('\n');
		lines.forEach((line, i) => assert.ok(!ACCENTED.test(line), `${f}:${i + 1}: ${line.trim().slice(0, 80)}`));
	}
});

test('the built main.js has no accented "Pokédex", escaped or not', (t) => {
	const file = root + 'main.js';
	if (!existsSync(file)) {
		assert.ok(!process.env.CI, 'main.js missing in CI: build before testing');
		t.skip('main.js not built locally');
		return;
	}
	const match = ACCENTED.exec(readFileSync(file, 'utf8'));
	assert.equal(match, null, `main.js contains ${match?.[0]}`);
});

test('the guard catches every form it is meant to', () => {
	for (const s of ['Pokédex', 'Pok\\xE9dex', 'Pok\\u00E9dex', 'Pok\\u{e9}dex', 'Pok&eacute;dex']) assert.ok(ACCENTED.test(s), s);
	for (const s of ['Pokedex', 'Pokémon', 'PokéAPI']) assert.ok(!ACCENTED.test(s), s);
});
