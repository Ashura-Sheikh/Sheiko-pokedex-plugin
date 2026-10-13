# Contributing to Sheiko Pokédex

Thanks for your interest. This is a small, unofficial fan plugin maintained on a best-effort basis by one person, so please keep that in mind when opening issues or pull requests.

## Reporting a bug

Open an issue on [GitHub](https://github.com/Ashura-Sheikh/Sheiko-pokedex-plugin/issues) with:

- Your Obsidian version, the plugin version, and your **TaskNotes** and **Sheiko Task Lifecycle** versions (development testing uses TaskNotes 4.13.8 and Sheiko Task Lifecycle 0.2.2)
- What you did, what you expected, and what happened instead
- Whether you have sprites downloaded or are on the placeholder badges
- If your Pokédex looks wrong: the relevant part of the plugin's `data.json`. **Remove anything private first.** The `ledger` lists your task files by path, so it shows your task names.
- Any error in the developer console (lines start with `[Sheiko Pokédex]`)

**Screenshots:** please take them on the placeholder badges (**Settings → Sheiko Pokédex → Remove sprites** first). The sprite artwork belongs to Nintendo / Game Freak and isn't ours to share.

## Suggesting a feature

Open an issue describing the problem you want solved, not just the solution. Sheiko Pokédex deliberately stays small:

- It **never writes to your notes.** Everything lives in the plugin's own `data.json`.
- It makes **no network requests** except the optional **Download sprites** button.
- It **ships no Pokémon artwork**, and won't.
- Rewards are tuned so closing real tasks stays the point. Features that hand out progress more freely get a high bar.

## Pull requests

1. Open an issue first for anything bigger than a small fix, so we can agree on the approach.
2. Set up: Node.js 20+ (CI runs 20, 22 and 24), then `npm i`.
3. Before opening the PR, all of these must pass:
   - `npm run build` (type-check and production build)
   - `npm run lint` (ESLint with the Obsidian plugin rules)
   - `npm test` (type-checks the tests, then runs them; Obsidian is mocked by `test/obsidian-mock.ts`)
4. If you change how catches, XP, evolution, stones or the Starter pack work, add or update a test in `test/`. The logic lives in pure functions (mostly `src/store.ts` and `src/progression.ts`), so tests don't need Obsidian.
5. **Never commit Pokémon artwork:** no sprite files, and no embedded image data in code. CI fails on any image outside `docs/images/`, on any PNG of sprite size (96×96), and on embedded PNG data. The release workflow also fails if `main.js` contains image data.
6. **Screenshots for the docs** go in `docs/images/` as PNGs, taken on placeholder badges only (no sprites, and no sprite silhouettes). Remove personal content first, for example your own contexts in **Context to type**.
7. **Pokémon data** in `src/data/gen1.ts` is generated from PokeAPI's CSV files by `scripts/build_gen1_data.py` (see *Data* in the README). Regenerate it rather than editing it by hand, and keep PokeAPI's BSD-3 notice: tests check that it's at the top of `gen1.ts` and in the built `main.js`. It's also reproduced in the README's *Third-party notices*. Keep that in place too.
8. **Test tools** (unlimited XP, stones and Pokémon) exist only in development builds (`npm run dev`). Release builds (`npm run build`) must not contain them, and a test builds the production bundle and checks.
9. Test in a separate vault, never one with tasks you care about. You can open the repo folder itself as a test vault: its `.obsidian/`, `TaskNotes/` and screenshot folders are git-ignored.

## Licence

By contributing, you agree your contributions are licensed under the project's [MIT licence](LICENSE). That licence covers this plugin's own code and documentation only. Pokémon names and artwork belong to their owners, and the Pokémon data comes under PokeAPI's own licence (see *Credits and licence* and *Third-party notices* in the README).
