// Badges: the user's downloaded sprite when there is one (DB, Sheikh 2026-10-13: fetched only
// when the user presses "Download sprites", saved in the plugin folder, never in the repo or a
// release), otherwise a coloured placeholder badge with the initial.

import { Species, Tier } from '../species';

/** dex → image URL (blob:) for the downloaded sprites. Empty until they're loaded. */
let sprites: ReadonlyMap<number, string> = new Map();

/** Swaps in a new set of sprite URLs (or an empty map to go back to badges). */
export function setSprites(next: ReadonlyMap<number, string>): void {
	sprites = next;
}

/** The downloaded sprite for a species, or null (none downloaded: badges). */
export function spriteFor(dex: number): string | null {
	return sprites.get(dex) ?? null;
}

/** Our own palette, one colour per type. */
const TYPE_COLOURS: Record<string, string> = {
	normal: '#9a9a8a',
	fire: '#e0653a',
	water: '#4a8fdc',
	grass: '#5fae4a',
	electric: '#e8c22a',
	ice: '#7cc8d8',
	fighting: '#b0443a',
	poison: '#9a55a8',
	ground: '#c9a45a',
	flying: '#8a9be0',
	psychic: '#e05a8a',
	bug: '#9aae2a',
	rock: '#aa9a5a',
	ghost: '#6a5a9a',
	dragon: '#6a5ae0',
	dark: '#5a4a42', // 1.5.0: not in Gen 1; here so all 18 types have a colour
	steel: '#9aa8b8',
	fairy: '#e09ad0',
};

export function typeColour(type: string): string {
	return TYPE_COLOURS[type] ?? '#888888';
}

export function dexLabel(dex: number): string {
	return `#${String(dex).padStart(3, '0')}`;
}

export function tierLabel(tier: Tier): string {
	return tier.charAt(0).toUpperCase() + tier.slice(1);
}

export function titleCase(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A badge for a caught species, or a grey silhouette for an unseen one. */
export function renderBadge(parent: HTMLElement, species: Species, seen: boolean, size: 'small' | 'large' | 'hero'): HTMLElement {
	const badge = parent.createDiv({ cls: `sheiko-pokedex-badge sheiko-pokedex-badge-${size}` });
	const sprite = spriteFor(species.dex);
	if (sprite) {
		// Downloaded sprite (DB): the art itself; unseen Pokémon show as a black silhouette.
		badge.addClass('has-sprite');
		const img = badge.createEl('img', { cls: 'sheiko-pokedex-sprite' });
		img.src = sprite;
		img.alt = seen ? species.name : 'Unknown Pokémon';
		img.draggable = false;
		if (seen) badge.addClass(`tier-${species.tier}`);
		else badge.addClass('is-unseen');
		return badge;
	}
	if (!seen) {
		badge.addClass('is-unseen');
		badge.setText('?');
		return badge;
	}
	const [first, second] = species.types;
	const c1 = typeColour(first ?? 'normal');
	const c2 = second ? typeColour(second) : c1;
	badge.style.setProperty('--sheiko-pokedex-c1', c1);
	badge.style.setProperty('--sheiko-pokedex-c2', c2);
	badge.setText(species.name.charAt(0));
	badge.addClass(`tier-${species.tier}`);
	return badge;
}

export function renderTypes(parent: HTMLElement, species: Species): void {
	const row = parent.createDiv({ cls: 'sheiko-pokedex-types' });
	for (const t of species.types) {
		const chip = row.createSpan({ cls: 'sheiko-pokedex-type', text: titleCase(t) });
		chip.style.setProperty('--sheiko-pokedex-type', typeColour(t));
	}
}
