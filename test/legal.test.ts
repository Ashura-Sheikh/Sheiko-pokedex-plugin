// PokeAPI's data is BSD-3-Clause, whose second condition asks binary redistributions to
// reproduce its notice. The data ships inside main.js, so the notice must too (2026-10-13).
// The generator holds the licence text; these tests check it reaches gen1.ts and main.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname; // test-dist/x.mjs → repo root

function licenceLines(): string[] {
	const py = readFileSync(root + 'scripts/build_gen1_data.py', 'utf8');
	const body = py.match(/POKEAPI_LICENSE = """([\s\S]*?)"""/)?.[1];
	assert.ok(body, 'POKEAPI_LICENSE not found in the generator');
	return body.split('\n').map((l) => l.trim()).filter(Boolean);
}

test('the licence text is the full BSD-3 notice', () => {
	const text = licenceLines().join('\n');
	for (const part of [
		'Paul Hallett and PokéAPI contributors',
		'Redistributions of source code must retain',
		'Redistributions in binary form must reproduce',
		'Neither the name of PokéAPI',
		'EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.',
	]) {
		assert.ok(text.includes(part), `missing: ${part}`);
	}
});

test('gen1.ts starts with the notice as a /*! legal comment */', () => {
	const src = readFileSync(root + 'src/data/gen1.ts', 'utf8');
	assert.ok(src.startsWith('/*!'), 'gen1.ts must open with /*!');
	const header = src.slice(0, src.indexOf('*/'));
	for (const line of licenceLines()) assert.ok(header.includes(line), `gen1.ts header missing: ${line.slice(0, 60)}`);
});

test('the built main.js carries the notice', (t) => {
	const file = root + 'main.js';
	if (!existsSync(file)) {
		// CI and the release workflow always build before testing, so there it must exist.
		assert.ok(!process.env.CI, 'main.js missing in CI: build before testing');
		t.skip('main.js not built locally');
		return;
	}
	const built = readFileSync(file, 'utf8');
	for (const line of licenceLines()) assert.ok(built.includes(line), `main.js missing: ${line.slice(0, 60)}`);
});
