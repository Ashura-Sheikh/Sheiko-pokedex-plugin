// The sprite map used when no local sprite file exists: in this repo, in CI, and for anyone
// who clones it. Empty on purpose. Sprite images are never committed (Sheikh chose S1,
// 2026-10-12): `npm run sprites` fetches them into the git-ignored src/data/sprites.local.ts,
// and esbuild.config.mjs uses that file instead when it exists.

export const SPRITES: Readonly<Record<number, string>> = {};
