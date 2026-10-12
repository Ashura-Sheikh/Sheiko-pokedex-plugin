// Pure rarity logic: SLA check, score, seeded random draw, species pick.
// No Obsidian imports, so everything here is unit-tested directly.

import { GEN1 } from './data/gen1';
import { Species, Tier, TIERS } from './species';

// ---------- SLA (mirrors the vault's sla-tracking.base) ----------

/** Target days by priority: high 1, medium 2, normal 3, anything else 7. */
export function slaTargetDays(priority: string | null): number {
	switch (priority) {
		case 'high':
			return 1;
		case 'medium':
			return 2;
		case 'normal':
			return 3;
		default:
			return 7;
	}
}

/** Date-only values read as local midnight, the same way Bases' date() does. */
export function parseDate(value: unknown): Date | null {
	if (typeof value !== 'string' || value.trim() === '') return null;
	const v = value.trim();
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
	if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
	const d = new Date(v);
	return isNaN(d.getTime()) ? null : d;
}

/** true / false, or null when either date is missing or unreadable (no bonus then). */
export function withinSla(priority: string | null, created: unknown, completed: unknown): boolean | null {
	const c = parseDate(created);
	const d = parseDate(completed);
	if (!c || !d) return null;
	const days = (d.getTime() - c.getTime()) / 86_400_000;
	return days <= slaTargetDays(priority);
}

// ---------- Score and tier odds ----------

export function priorityPoints(priority: string | null): number {
	switch (priority) {
		case 'high':
			return 3;
		case 'medium':
			return 2;
		case 'normal':
			return 1;
		default:
			return 0;
	}
}

/** 0..5. Task size is deliberately not here: Sheikh chose size → XP only (2026-10-12). */
export function score(priority: string | null, sla: boolean | null): number {
	return priorityPoints(priority) + (sla === true ? 2 : 0);
}

/** Percent odds per tier [common, uncommon, rare, legendary], indexed by score. Each row sums to 100. */
export const TIER_ODDS: readonly (readonly [number, number, number, number])[] = [
	[70, 25, 5, 0],
	[62, 28, 9, 1],
	[52, 32, 14, 2],
	[42, 35, 20, 3],
	[32, 37, 26, 5],
	[22, 38, 32, 8],
];

export function oddsFor(s: number): readonly [number, number, number, number] {
	const i = Math.max(0, Math.min(TIER_ODDS.length - 1, Math.floor(s)));
	return TIER_ODDS[i]!;
}

// ---------- Seeded random ----------

/** FNV-1a 32-bit. */
export function hashString(s: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

/** mulberry32: small, fast, good enough for a game draw. Returns floats in [0, 1). */
export function seededRandom(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export function pickTier(rand: () => number, s: number): Tier {
	const odds = oddsFor(s);
	let roll = rand() * 100;
	for (let i = 0; i < TIERS.length; i++) {
		roll -= odds[i]!;
		if (roll < 0) return TIERS[i]!;
	}
	return 'common';
}

// ---------- Context → type pool ----------

export type ContextTypes = Record<string, string[]>;

/** Parses lines like "legal: psychic, fighting". Blank and malformed lines are skipped. */
export function parseContextTypes(text: string): ContextTypes {
	const out: ContextTypes = {};
	for (const line of text.split('\n')) {
		const i = line.indexOf(':');
		if (i <= 0) continue;
		const ctx = line.slice(0, i).trim();
		const types = line
			.slice(i + 1)
			.split(',')
			.map((t) => t.trim().toLowerCase())
			.filter(Boolean);
		if (ctx && types.length) out[ctx] = types;
	}
	return out;
}

export function typePool(contexts: string[], map: ContextTypes): Set<string> {
	const pool = new Set<string>();
	for (const c of contexts) for (const t of map[c] ?? []) pool.add(t);
	return pool;
}

/** Species of the tier that share a type with the pool; the whole tier if none do (or the pool is empty). */
export function candidates(tier: Tier, pool: Set<string>, all: readonly Species[] = GEN1): Species[] {
	const inTier = all.filter((p) => p.tier === tier);
	if (pool.size === 0) return inTier;
	const matched = inTier.filter((p) => p.types.some((t) => pool.has(t)));
	return matched.length ? matched : inTier;
}

export interface Draw {
	species: Species;
	tier: Tier;
	score: number;
	sla: boolean | null;
}

export interface DrawInput {
	seed: string;
	priority: string | null;
	contexts: string[];
	created: unknown;
	completed: unknown;
}

export function draw(input: DrawInput, map: ContextTypes, all: readonly Species[] = GEN1): Draw {
	const sla = withinSla(input.priority, input.created, input.completed);
	const s = score(input.priority, sla);
	const rand = seededRandom(hashString(input.seed));
	const tier = pickTier(rand, s);
	const list = candidates(tier, typePool(input.contexts, map), all);
	const species = list[Math.floor(rand() * list.length)]!;
	return { species, tier, score: s, sla };
}
