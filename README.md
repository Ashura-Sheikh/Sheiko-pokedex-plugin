# Sheiko Pokédex

**Private plugin. Not for publication.** It uses Pokémon names, which are trademarks of Nintendo, Game Freak and The Pokémon Company. Keep this repository private, and don't post screenshots publicly. No sprite images are bundled or fetched: every Pokémon is shown as a coloured placeholder badge.

Each time you close a task in [TaskNotes](https://github.com/callumalpass/tasknotes), you catch a random Gen 1 Pokémon. Browse what you've caught in the Pokédex view.

Needs **TaskNotes** and **Sheiko Task Lifecycle**, both enabled. Desktop only.

## How a catch works

1. **A close is detected.** A task's status changes from open to a completed status (as defined in TaskNotes' own settings) while Obsidian is running. Tasks that were already done when the Pokédex started never pay out, so rewards start from install.
2. **The plugin reads after Sheiko has finished.** It waits 2 seconds (Sheiko waits 0.6 s) and then reads the task's frontmatter. **It never writes to task notes.** All Pokédex state is kept in its own `data.json`.
3. **Some closes earn nothing:**
   - a task that has already been through a reward, including after a reopen, a rename or an archive move
   - a task closed with `closeReason: superseded` or `parked`
   - a close beyond the daily limit (default 10). That task never pays out later.
4. **Rarity tier:** the score sets the odds.
   - **Score** = priority points (high 3, medium 2, normal 1, other 0) + 2 if the task closed within SLA.
   - **SLA targets** match the vault's `sla-tracking.base`: high 1 day, medium 2, normal 3, other 7. Closing time is measured from `dateCreated` to `completedDate`.

   | Score | Common | Uncommon | Rare | Legendary |
   |---|---|---|---|---|
   | 0 | 70 | 25 | 5 | 0 |
   | 1 | 62 | 28 | 9 | 1 |
   | 2 | 52 | 32 | 14 | 2 |
   | 3 | 42 | 35 | 20 | 3 |
   | 4 | 32 | 37 | 26 | 5 |
   | 5 | 22 | 38 | 32 | 8 |

5. **Species:** the task's `contexts` narrow which types can appear. The mapping is editable in the plugin's settings. If no species in the drawn tier matches, any species in that tier can appear.
6. **The draw is repeatable.** It's seeded from the task's path and `dateCreated`, so the same task always gives the same result and the logic can be tested.

Task size (worked time) doesn't affect rarity. It will scale XP once partner levels arrive.

## Data

`src/data/gen1.ts` is generated from [PokeAPI's CSV data](https://github.com/PokeAPI/pokeapi/tree/master/data/v2/csv) by `scripts/build_gen1_data.py`. It holds names, types, capture rates and evolution links only.
- **Tiers:** legendary/mythical (5); then by capture rate: ≤ 45 rare (55), ≤ 120 uncommon (45), otherwise common (46).
- **Types** are PokeAPI's current ones, so Clefairy is Fairy and Magnemite is Electric/Steel.

To regenerate:

```
python3 -I scripts/build_gen1_data.py <folder with the 5 CSV files>
```

## Development

```
npm install
npm run build   # type-check + bundle to main.js
npm test        # 32 tests, Node's built-in runner, obsidian mocked
npm run lint
```

This repo folder doubles as the test vault. `.obsidian/` and `TaskNotes/` are git-ignored. To try a build, copy or link `main.js`, `manifest.json` and `styles.css` into `.obsidian/plugins/sheiko-pokedex/`.

## Status

**0.1.0 = Phase 2** (first working version): close detection, rarity draw, reward window, Pokédex view, tests.

Still to come:
- **Phase 3:** XP, levels and evolution for a partner Pokémon you choose and can swap. Task size, from Sheiko's `timeWorkingMinutes` or else `dateCreated`→`completedDate`, scales XP. Duplicates give bonus XP.
- **Phase 4:** polish.

project-manager signs off after Phase 2, before the plugin is installed in the main vault.

## Known limits

- **Only live closes count.** A close made while Obsidian is closed, or synced in from another device, isn't seen.
- **The SLA rule is a copy.** If `sla-tracking.base` changes, `src/rarity.ts` must be updated to match.
- **The Sheiko check uses an internal Obsidian API.** It reads `app.plugins.enabledPlugins`, which isn't part of the documented API.
