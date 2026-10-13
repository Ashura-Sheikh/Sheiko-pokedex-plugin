// Optional sprites, downloaded by the user (DB: Sheikh, 2026-10-13; RAID row 87's 6 conditions).
// Off by default: nothing is fetched until the user presses "Download sprites" in settings.
// The images come from PokeAPI's sprite repository on GitHub and are saved in this plugin's own
// folder, never in the repo or a release. The art belongs to Nintendo / Game Freak.
//
// This file holds the parts that don't need Obsidian: the URL, the checks on each image, and the
// download itself (all 151 fetched and checked before anything is written, so a failure leaves
// nothing half-written and the placeholder badges stay).

import { GEN1 } from './data/gen1';

export const SPRITE_COUNT = GEN1.length; // 151
export const MAX_SPRITE_BYTES = 64 * 1024;
export const SPRITE_SIZE = 96;
/** Pause between downloads, so the one-time fetch stays gentle on the host. */
export const DOWNLOAD_PAUSE_MS = 100;

export function spriteUrl(dex: number): string {
	return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${dex}.png`;
}

export function spriteFileName(dex: number): string {
	return `${String(dex).padStart(3, '0')}.png`;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Why these bytes aren't an acceptable sprite, or null if they are: a PNG, 96×96, under 64 KB. */
export function checkSprite(bytes: Uint8Array): string | null {
	if (bytes.length > MAX_SPRITE_BYTES) return `${bytes.length} bytes is over the ${MAX_SPRITE_BYTES} limit`;
	if (bytes.length < 24) return 'not a PNG';
	for (let i = 0; i < PNG_SIGNATURE.length; i++) if (bytes[i] !== PNG_SIGNATURE[i]) return 'not a PNG';
	// The first chunk must be IHDR, which holds width and height as big-endian 32-bit numbers.
	if (String.fromCharCode(bytes[12] ?? 0, bytes[13] ?? 0, bytes[14] ?? 0, bytes[15] ?? 0) !== 'IHDR') return 'not a PNG';
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const w = view.getUint32(16);
	const h = view.getUint32(20);
	if (w !== SPRITE_SIZE || h !== SPRITE_SIZE) return `${w}×${h}, expected ${SPRITE_SIZE}×${SPRITE_SIZE}`;
	return null;
}

export interface DownloadDeps {
	/** Fetches a URL's bytes; throws if it can't be reached or doesn't return 200. */
	fetchBytes: (url: string) => Promise<ArrayBuffer>;
	sleep: (ms: number) => Promise<void>;
	onProgress?: (done: number, total: number) => void;
	/** Checked before each download; true stops the download (e.g. the plugin is unloading). */
	cancelled?: () => boolean;
}

export type DownloadResult =
	| { ok: true; sprites: Map<number, Uint8Array> }
	| { ok: false; error: string };

/** Fetches and checks all 151 sprites, one at a time. Returns all of them or none. */
export async function downloadSprites(deps: DownloadDeps): Promise<DownloadResult> {
	const sprites = new Map<number, Uint8Array>();
	for (let dex = 1; dex <= SPRITE_COUNT; dex++) {
		if (deps.cancelled?.()) return { ok: false, error: 'Download stopped.' };
		let bytes: Uint8Array;
		try {
			bytes = new Uint8Array(await deps.fetchBytes(spriteUrl(dex)));
		} catch (e) {
			return { ok: false, error: `Couldn't reach the sprite source (#${dex}): ${e instanceof Error ? e.message : String(e)}` };
		}
		const problem = checkSprite(bytes);
		if (problem) return { ok: false, error: `Sprite #${dex} failed the checks: ${problem}.` };
		sprites.set(dex, bytes);
		deps.onProgress?.(dex, SPRITE_COUNT);
		if (dex < SPRITE_COUNT) await deps.sleep(DOWNLOAD_PAUSE_MS);
	}
	return { ok: true, sprites };
}

/** Written next to the sprites so a vault kept in git doesn't commit them. */
export const SPRITES_GITIGNORE =
	'# Sheiko Pokédex sprites: downloaded for your own use, not for redistribution. Do not commit.\n*\n';
