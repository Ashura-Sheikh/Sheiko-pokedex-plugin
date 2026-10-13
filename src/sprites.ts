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
	'# Sheiko Pokedex sprites: downloaded for your own use, not for redistribution. Do not commit.\n*\n';

/** The file operations the save needs; Obsidian's DataAdapter has all of them. */
export interface SpriteFs {
	exists(path: string): Promise<boolean>;
	mkdir(path: string): Promise<void>;
	write(path: string, data: string): Promise<void>;
	writeBinary(path: string, data: ArrayBuffer): Promise<void>;
	/** Files and folders (DataAdapter.rename: "Rename a file or folder"). */
	rename(from: string, to: string): Promise<void>;
	rmdir(path: string, recursive: boolean): Promise<void>;
}

async function removeQuietly(fs: SpriteFs, path: string): Promise<void> {
	try {
		if (await fs.exists(path)) await fs.rmdir(path, true);
	} catch {
		// Best effort: a leftover temp folder is ignored by loading and removed by the next save.
	}
}

/**
 * Saves the sprites all-or-nothing (0.9.1, project-manager's 0.8.0 gate note: the save step wasn't
 * atomic). Everything is written into `<dir>.tmp` first, `.gitignore` before any image, so the folder
 * is never committable. Only when every file is written is the temp folder swapped into place. On any
 * failure the temp folder is removed and `dir` is exactly as it was. Throws the original error.
 */
export async function saveSpritesAtomically(fs: SpriteFs, dir: string, sprites: Map<number, Uint8Array>): Promise<void> {
	const tmp = `${dir}.tmp`;
	const old = `${dir}.old`;
	// Leftovers from a save that was interrupted (e.g. Obsidian closed mid-way).
	await removeQuietly(fs, tmp);
	await removeQuietly(fs, old);
	try {
		await fs.mkdir(tmp);
		await fs.write(`${tmp}/.gitignore`, SPRITES_GITIGNORE);
		for (const [dex, bytes] of sprites) {
			const copy = bytes.slice(); // its own ArrayBuffer, exactly the PNG's bytes
			await fs.writeBinary(`${tmp}/${spriteFileName(dex)}`, copy.buffer);
		}
	} catch (e) {
		await removeQuietly(fs, tmp);
		throw e;
	}
	const hadDir = await fs.exists(dir);
	if (hadDir) {
		try {
			await fs.rename(dir, old);
		} catch (e) {
			await removeQuietly(fs, tmp);
			throw e;
		}
	}
	try {
		await fs.rename(tmp, dir);
	} catch (e) {
		if (hadDir) {
			try {
				await fs.rename(old, dir);
			} catch {
				// Couldn't put the old folder back; it stays at `<dir>.old` and loading shows badges.
			}
		}
		await removeQuietly(fs, tmp);
		throw e;
	}
	if (hadDir) await removeQuietly(fs, old);
}

/** First line of the Sprites section in settings. */
export const SPRITES_INTRO =
	'Optional pixel sprites for every Pokémon, in place of the coloured badges. Nothing is downloaded unless you press Download sprites below.';

/** The rows shown above the Download button, so users know exactly what happens before they press it. */
export function spriteInfo(dir: string): { name: string; desc: string }[] {
	return [
		{
			name: 'What you get',
			desc: `${SPRITE_COUNT} pixel sprites, one for each Gen 1 Pokémon: ${SPRITE_SIZE}×${SPRITE_SIZE} PNG files, about 120 KB in total. Unseen Pokémon show as black silhouettes.`,
		},
		{
			name: 'Where they come from',
			desc:
				"PokeAPI's sprite repository on GitHub (github.com/PokeAPI/sprites). " +
				`The download makes ${SPRITE_COUNT} requests to raw.githubusercontent.com, one at a time with a short pause, ` +
				'and takes about 30 seconds. The plugin makes no other network requests.',
		},
		{
			name: 'Checks',
			desc:
				`Each image must be a PNG, ${SPRITE_SIZE}×${SPRITE_SIZE} and under ${MAX_SPRITE_BYTES / 1024} KB. ` +
				`All ${SPRITE_COUNT} are downloaded and checked before anything is saved. ` +
				'If the source cannot be reached or any image fails a check, nothing is saved and the badges stay. ' +
				'Saved sprites are checked again each time Obsidian starts.',
		},
		{
			name: 'Where they are saved',
			desc: `${dir}, as 001.png to ${spriteFileName(SPRITE_COUNT)}. The folder has its own .gitignore, so a vault kept in git won't commit them.`,
		},
		{
			name: 'Who owns them',
			desc:
				'The artwork belongs to Nintendo / Game Freak. It is not part of this plugin or its licence. ' +
				'Keep it for your own use: do not commit, share or redistribute it.',
		},
	];
}
