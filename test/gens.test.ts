// Gen 2 (2.0.0, #42–#47; Sheikh's decisions 2026-10-25). One test per check in project-manager's
// 2.0.0 gate list where it can be tested without Obsidian.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	ALL_SPECIES,
	TYPE_TRADE_ITEM,
	UnlockBase,
	inferEvolutions,
	speciesUpTo,
	stonesUpTo,
	tradeItemForPartner,
	tradeItemsUpTo,
	unlockProgress,
} from '../src/gens';
import { ALL_TYPES, MAX_PARTICLES } from '../src/partner-anim';
import { evolutionHint, newMon, noStones, noTradeItems, stoneEvolutions, stoneForTypes, tradeItemEvolutions } from '../src/progression';
import { draw, parseContextTypes, seededRandom } from '../src/rarity';
import { browse, defaultControls } from '../src/browse';
import { SPRITE_BUCKETS, bucketDexes, downloadSprites, missingDexes, releasedBuckets } from '../src/sprites';
import {
	CloseInput,
	PokedexData,
	applyUnlock,
	claimStarterPokemon,
	decide,
	evolve,
	freshData,
	markAnnounced,
	normalizeData,
	setPartner,
	starterChoices,
	unlockToAnnounce,
} from '../src/store';

const NOW = new Date('2026-10-25T12:00:00Z');
const MAP = parseContextTypes('');
const at = NOW.toISOString();

function close(path: string, extra: Partial<CloseInput> = {}): CloseInput {
	return {
		path,
		priority: 'normal',
		contexts: [],
		closeReason: null,
		dateCreated: '2026-10-25T09:00:00Z',
		completedDate: '2026-10-25T11:00:00Z',
		...extra,
	};
}

function withCaught(dexes: number[], data: PokedexData = freshData(NOW)): PokedexData {
	for (const d of dexes) {
		data.caught[String(d)] = { count: 1, firstAt: at, lastAt: at };
		data.mons[String(d)] = newMon();
	}
	return data;
}

/** Data shaped like a saved 1.x data.json: no 2.0.0 fields at all. */
function v1x(extra: Record<string, unknown> = {}): Record<string, unknown> {
	const base = JSON.parse(JSON.stringify(freshData(NOW))) as Record<string, unknown>;
	for (const k of ['unlockedGen', 'announcedGen', 'unlockBase', 'evolutions', 'tradeItems', 'itemProgress']) delete base[k];
	return { ...base, ...extra };
}

// ---------- Unlock rule (#45) ----------

test('a fresh install starts on Gen 1, locked, with nothing to announce', () => {
	const d = freshData(NOW);
	assert.equal(d.unlockedGen, 1);
	assert.equal(applyUnlock(d), d, 'nothing met, same object');
	assert.equal(unlockToAnnounce(d), null);
	assert.equal(normalizeData(undefined, NOW).unlockedGen, 1);
});

test('unlock: 3 catches and one Pokémon up 2 levels; either alone is not enough', () => {
	const base: UnlockBase = { catches: 0, levels: {}, evolutions: 0 };
	const p = (catches: number, level: number, evolutions = 0) =>
		unlockProgress({ unlockedGen: 1, catches, evolutions, mons: { '4': { level } }, unlockBase: base });
	assert.equal(p(3, 7).met, true);
	assert.equal(p(2, 7).met, false, '2 catches');
	assert.equal(p(3, 6).met, false, '1 level');
	assert.equal(p(9, 5).met, false, 'many catches, no levels');
	assert.equal(p(0, 5, 1).met, true, "an evolution unlocks on its own (Sheikh's (b))");
});

test('unlock: counts restart at the unlock, and nothing is left to unlock after the last Gen', () => {
	let d = withCaught([4]);
	d.catches = 3;
	d.mons['4'] = { level: 7, xp: 0 };
	d = applyUnlock(d);
	assert.equal(d.unlockedGen, 2);
	assert.deepEqual(d.unlockBase, { catches: 3, levels: { '4': 7 }, evolutions: 0 });
	const after = unlockProgress(d);
	assert.equal(after.next, null, 'Gen 2 is the last released Gen');
	assert.equal(after.met, false);
	assert.equal(applyUnlock(d), d);
});

test('the unlock notice is announced once', () => {
	let d = withCaught([4]);
	d.evolutions = 1;
	d = applyUnlock(d);
	assert.equal(unlockToAnnounce(d), 2);
	d = markAnnounced(d);
	assert.equal(unlockToAnnounce(d), null);
	assert.equal(normalizeData(JSON.parse(JSON.stringify(d)), NOW).announcedGen, 2, 'kept across reloads');
});

// ---------- Existing users on update (load tests, 1.x and 0.x shapes) ----------

test('update from 1.x: a user who already meets the rule unlocks Gen 2 on load, and is told once', () => {
	const ledger = { 'a.md': { at, outcome: 'caught', dex: 4 }, 'b.md': { at, outcome: 'caught', dex: 7 }, 'c.md': { at, outcome: 'caught', dex: 1 } };
	const caught = { '4': { count: 1, firstAt: at, lastAt: at }, '7': { count: 1, firstAt: at, lastAt: at }, '1': { count: 1, firstAt: at, lastAt: at } };
	const d = normalizeData(v1x({ ledger, caught, catches: 3, mons: { '4': { level: 9, xp: 0 }, '7': { level: 5, xp: 0 }, '1': { level: 5, xp: 0 } } }), NOW);
	assert.equal(d.unlockedGen, 2);
	assert.equal(unlockToAnnounce(d), 2);
	assert.deepEqual(Object.values(d.tradeItems), [0, 0, 0, 0, 0, 0]);
	assert.equal(d.caught['4']?.count, 1, 'catches untouched');
});

test('update from 1.x: a user who does not meet it stays on Gen 1 (2 catches, levels unchanged)', () => {
	const ledger = { 'a.md': { at, outcome: 'caught', dex: 4 }, 'b.md': { at, outcome: 'caught', dex: 7 } };
	const caught = { '4': { count: 1, firstAt: at, lastAt: at }, '7': { count: 1, firstAt: at, lastAt: at } };
	const d = normalizeData(v1x({ ledger, caught, catches: 2, mons: { '4': { level: 9, xp: 0 }, '7': { level: 5, xp: 0 } } }), NOW);
	assert.equal(d.unlockedGen, 1);
	assert.equal(unlockToAnnounce(d), null);
});

test('update from 0.x (version 1): loads, stays on Gen 1 with one catch', () => {
	const d = normalizeData(
		{
			version: 1,
			installedAt: '2026-10-12T11:59:14.956Z',
			settings: { dailyCap: 10 },
			ledger: { 'x.md': { at, outcome: 'caught', dex: 145 } },
			caught: { '145': { count: 1, firstAt: at, lastAt: at } },
			daily: { date: '2026-10-12', count: 1 },
		},
		NOW,
	);
	assert.equal(d.unlockedGen, 1);
	assert.equal(d.evolutions, 0);
});

test('evolution inference: copies beyond ledger catches are evolutions; a Starter pick and duplicates are not', () => {
	const caught = {
		'4': { count: 2, firstAt: at, lastAt: at }, // caught twice
		'5': { count: 1, firstAt: at, lastAt: at }, // evolved into, no ledger entry
		'25': { count: 2, firstAt: at, lastAt: at, source: 'starter' }, // Starter pick, then caught once
		'26': { count: 1, firstAt: at, lastAt: at }, // evolved into from the Starter Pikachu
	};
	const ledger = {
		'a.md': { at, outcome: 'caught', dex: 4 },
		'b.md': { at, outcome: 'caught', dex: 4 },
		'c.md': { at, outcome: 'caught', dex: 25 },
		'd.md': { at, outcome: 'counted' },
	};
	assert.equal(inferEvolutions(caught, ledger), 2, 'Charmeleon and Raichu');
	assert.equal(inferEvolutions({ '25': { count: 1, source: 'starter' } }, {}), 0, 'a Starter pick alone');
});

test('update: a stone evolution unlocks Gen 2 even with fewer than 3 catches', () => {
	const ledger = { 'a.md': { at, outcome: 'caught', dex: 133 } };
	const caught = { '133': { count: 1, firstAt: at, lastAt: at }, '135': { count: 1, firstAt: at, lastAt: at } };
	const d = normalizeData(v1x({ ledger, caught, catches: 1, mons: { '133': { level: 5, xp: 0 }, '135': { level: 5, xp: 0 } } }), NOW);
	assert.equal(d.evolutions, 1, 'Jolteon has no ledger catch');
	assert.equal(d.unlockedGen, 2);
});

// ---------- Catch pool (#45) ----------

test('seeded draws: never a Gen 2 Pokémon before unlock; Gen 2 Pokémon drawn after', () => {
	let gen2Before = 0;
	let gen2After = 0;
	for (let i = 0; i < 2000; i++) {
		const input = { seed: `s${i}`, scoreSum: 3 * 5, closes: 5, closesToday: 5, contexts: [] };
		if (draw(input, MAP, speciesUpTo(1)).species.gen === 2) gen2Before++;
		if (draw(input, MAP, speciesUpTo(2)).species.gen === 2) gen2After++;
	}
	assert.equal(gen2Before, 0);
	assert.ok(gen2After > 400 && gen2After < 1000, `Gen 2 share after unlock: ${gen2After}/2000`);
});

test('decide() catches only from unlocked Gens', () => {
	let d = freshData(NOW);
	d.settings.dailyCap = 100000;
	for (let i = 0; i < 300; i++) {
		const r = decide(close(`t${i}.md`), d, MAP, NOW);
		if (r.decision.kind === 'caught') assert.equal(r.decision.draw.species.gen, 1);
		d = r.data;
	}
	assert.ok(d.catches > 20);
});

// ---------- Stones and Trade Items (#44) ----------

test('no Sun Stone before unlock; Grass finds Leaf or Sun after; other types unchanged', () => {
	for (let i = 0; i < 200; i++) {
		assert.equal(stoneForTypes(['grass'], seededRandom(i), 1), 'leaf');
		assert.notEqual(stoneForTypes(['dragon'], seededRandom(i), 1), 'sun', 'random kind: Gen 1 stones only');
	}
	const after = new Set(Array.from({ length: 200 }, (_, i) => stoneForTypes(['grass', 'poison'], seededRandom(i), 2)));
	assert.deepEqual([...after].sort(), ['leaf', 'sun']);
	assert.equal(stoneForTypes(['bug'], seededRandom(1), 2), 'leaf', 'only Grass splits');
	assert.deepEqual(stonesUpTo(1), ['fire', 'water', 'thunder', 'leaf', 'moon', 'trade']);
	assert.deepEqual(tradeItemsUpTo(1), []);
});

test("the Trade Item table covers all 18 types (Sheikh's table, 2026-10-25)", () => {
	assert.deepEqual(Object.keys(TYPE_TRADE_ITEM).sort(), [...ALL_TYPES].sort());
	assert.equal(tradeItemForPartner(['water'], 2), 'kings-rock');
	assert.equal(tradeItemForPartner(['steel', 'ground'], 2), 'metal-coat');
	assert.equal(tradeItemForPartner(['electric'], 2), 'up-grade');
	assert.equal(tradeItemForPartner(['normal'], 2), 'friendship');
	assert.equal(tradeItemForPartner(['fire', 'flying'], 2), 'general', 'primary type decides');
	assert.equal(tradeItemForPartner(['water'], 1), null, 'no Gen 2 items before unlock');
});

/** Gen 2 unlocked, partner Squirtle (Water → King's Rock). */
function gen2WithPartner(): PokedexData {
	const d = setPartner(withCaught([7]), 7);
	d.unlockedGen = 2;
	d.announcedGen = 2;
	d.settings.dailyCap = 100000;
	return d;
}

test('Trade Items drop from closes once Gen 2 is unlocked, matched to the partner type', () => {
	let d = gen2WithPartner();
	const found: string[] = [];
	for (let i = 0; i < 200; i++) {
		const r = decide(close(`i${i}.md`), d, MAP, NOW);
		const items = 'items' in r.decision ? r.decision.items : undefined;
		if (items) found.push(...items);
		d = r.data;
	}
	assert.ok(found.length > 0, 'some drops in 200 closes');
	assert.ok(found.every((k) => k === 'kings-rock'));
	assert.equal(d.tradeItems['kings-rock'], found.length);
});

test('no Trade Items before unlock, and no partner means no drop and no counter move', () => {
	let locked = setPartner(withCaught([7]), 7);
	locked.settings.dailyCap = 100000;
	let none = gen2WithPartner();
	none.partner = null;
	for (let i = 0; i < 200; i++) {
		locked = decide(close(`l${i}.md`), locked, MAP, NOW).data;
		none = decide(close(`n${i}.md`), none, MAP, NOW).data;
	}
	assert.deepEqual(Object.values(locked.tradeItems), [0, 0, 0, 0, 0, 0]);
	assert.deepEqual(Object.values(none.tradeItems), [0, 0, 0, 0, 0, 0]);
	assert.equal(none.itemProgress.closes, 0);
});

test("closes over the daily limit don't fill the 2-4 Trade Item counter (Q2 (a))", () => {
	const d = gen2WithPartner();
	d.settings.dailyCap = 0; // every close is over the limit
	const before = d.itemProgress;
	let next = d;
	for (let i = 0; i < 20; i++) next = decide(close(`c${i}.md`), next, MAP, NOW).data;
	assert.deepEqual(next.itemProgress, before);
});

test('the counter: a roll each time the hidden 2-4 target fills, then a new target', () => {
	let d = gen2WithPartner();
	d.itemProgress = { closes: 0, target: 2 };
	d = decide(close('x1.md'), d, MAP, NOW).data;
	assert.equal(d.itemProgress.closes, 1);
	d = decide(close('x2.md'), d, MAP, NOW).data;
	assert.equal(d.itemProgress.closes, 0, 'filled and reset');
	assert.ok(d.itemProgress.target >= 2 && d.itemProgress.target <= 4);
});

// ---------- Evolutions (#44, Q1 (b)) ----------

test('an evolution into a locked Gen is not offered, hinted or allowed', () => {
	const d = withCaught([42, 95, 133]); // Golbat, Onix, Eevee
	d.tradeItems = { ...noTradeItems(), friendship: 1, 'metal-coat': 1 };
	assert.equal(evolutionHint(42, newMon(), noStones(), d.tradeItems, speciesUpTo(1)), 'Fully evolved', 'no "→ Crobat" before Gen 2');
	assert.deepEqual(tradeItemEvolutions(95, d.tradeItems, speciesUpTo(1)), []);
	assert.deepEqual(
		stoneEvolutions(133, noStones(), speciesUpTo(1)).map((o) => o.to.name),
		['Vaporeon', 'Jolteon', 'Flareon'],
		'no Espeon / Umbreon before Gen 2',
	);
	assert.equal(evolve(d, 42, 169, NOW, undefined, 'friendship'), null, 'Crobat blocked while Gen 2 is locked');
});

test('after unlock: Golbat evolves into Crobat with a Friendship Charm, and it counts', () => {
	let d = withCaught([42]);
	d.unlockedGen = 2;
	d.tradeItems = { ...noTradeItems(), friendship: 1 };
	assert.match(evolutionHint(42, newMon(), noStones(), d.tradeItems, speciesUpTo(2)), /Friendship Charm → Crobat \(have 1\)/);
	assert.equal(evolve(d, 42, 169, NOW, undefined, 'metal-coat'), null, 'none of that item held');
	d = evolve(d, 42, 169, NOW, undefined, 'friendship')!;
	assert.equal(d.caught['169']?.count, 1);
	assert.equal(d.tradeItems.friendship, 0);
	assert.equal(d.evolutions, 1);
});

// ---------- Starter pack unchanged ----------

test('Starter pack: still Gen 1 only, even with Gen 2 unlocked', () => {
	const d = freshData(NOW);
	d.unlockedGen = 2;
	assert.equal(starterChoices(d).length, 151);
	assert.ok(starterChoices(d).every((n) => n <= 151));
	assert.deepEqual(claimStarterPokemon(d, 152, NOW), { ok: false, reason: 'unknown' });
});

// ---------- Locked cards in the Pokedex (#46): exactly like unseen ----------

test('locked Gen 2 cards are unseen in search, filters, every sort, and only shown as locked', () => {
	const data = { caught: {} as PokedexData['caught'], mons: {}, unlockedGen: 1 };
	data.caught['4'] = { count: 1, firstAt: at, lastAt: at };
	data.caught['152'] = { count: 1, firstAt: at, lastAt: at }; // even if a dev tool added one
	const all = browse(data, defaultControls());
	assert.equal(all.cells.length, 251);
	const chiko = all.cells.find((c) => c.dex === 152)!;
	assert.deepEqual(chiko, { dex: 152, seen: false, locked: true });
	assert.deepEqual(browse(data, { ...defaultControls(), search: 'chiko' }).cells, [], 'names of locked cards are not searched');
	assert.deepEqual(browse(data, { ...defaultControls(), type: 'grass' }).cells, [], 'filters hide locked cards');
	assert.deepEqual(browse(data, { ...defaultControls(), search: '152' }).cells, [{ dex: 152, seen: false, locked: true }]);
	const byName = browse(data, { ...defaultControls(), sort: 'name' }).cells;
	assert.equal(byName[0]!.dex, 4, 'caught first');
	assert.deepEqual(byName.slice(1).map((c) => c.dex), ALL_SPECIES.filter((p) => p.dex !== 4).map((p) => p.dex), 'the rest in dex order');
	const gen2 = browse(data, { ...defaultControls(), gen: 2 }).cells;
	assert.equal(gen2.length, 100);
	assert.ok(gen2.every((c) => c.locked && !c.seen));
	assert.ok(browse({ ...data, unlockedGen: 2 }, { ...defaultControls(), gen: 2 }).cells.every((c) => !c.locked));
});

// ---------- Sprites (#47) ----------

test('sprite buckets: Gen 1 (151) and Gens 2-4 (100 now); Gens 5-6 not shown until released', () => {
	assert.deepEqual(releasedBuckets().map((b) => b.id), ['gen1', 'gen2-4']);
	assert.equal(bucketDexes(SPRITE_BUCKETS[0]!).length, 151);
	assert.equal(bucketDexes(SPRITE_BUCKETS[1]!).length, 100);
	assert.deepEqual(bucketDexes(SPRITE_BUCKETS[2]!), []);
	const have = new Set(Array.from({ length: 160 }, (_, i) => i + 1));
	assert.deepEqual(missingDexes(SPRITE_BUCKETS[0]!, have), []);
	assert.equal(missingDexes(SPRITE_BUCKETS[1]!, have).length, 91, 'only the ones not saved yet');
});

test('a bucket download fetches exactly the given numbers', async () => {
	const urls: string[] = [];
	const png = new Uint8Array(30);
	png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 96, 0, 0, 0, 96]);
	const r = await downloadSprites(
		{
			fetchBytes: async (url) => {
				urls.push(url);
				return png.slice().buffer;
			},
			sleep: async () => {},
		},
		[152, 200, 251],
	);
	assert.ok(r.ok);
	assert.deepEqual([...r.sprites.keys()], [152, 200, 251]);
	assert.equal(urls.length, 3);
});

// ---------- 1.5.0 gate follow-up ----------

test('partner animation: at most 8 particles a run (a fixed number, not the constant itself)', () => {
	assert.equal(MAX_PARTICLES, 8);
});
