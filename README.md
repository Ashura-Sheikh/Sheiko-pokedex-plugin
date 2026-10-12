# Sheiko Pokédex

**Private plugin. Not for publication.** It uses Pokémon names, which are trademarks of Nintendo, Game Freak and The Pokémon Company. Keep this repository private, and don't post screenshots publicly. No sprite images are bundled or fetched: every Pokémon is shown as a coloured placeholder badge.

Close tasks in [TaskNotes](https://github.com/callumalpass/tasknotes) and catch a random Gen 1 Pokémon every 4–7 closes. The more you close in a day, the better your odds. Browse what you've caught in the Pokédex view.

Needs **TaskNotes** and **Sheiko Task Lifecycle**, both enabled. Desktop only.

## How a catch works

1. **A close is detected.** A task's status changes from open to a completed status (as defined in TaskNotes' own settings) while Obsidian is running. Tasks that were already done when the Pokédex started never count, so rewards start from install.
2. **The plugin reads after Sheiko has finished.** It waits 2 seconds (Sheiko waits 0.6 s) and then reads the task's frontmatter. **It never writes to task notes.** All Pokédex state is kept in its own `data.json`.
3. **Some closes count for nothing:**
   - a task that has already counted once, including after a reopen, a rename or an archive move
   - a task closed with `closeReason: superseded` or `parked`
   - any close after the day's catch limit (default 3 catches a day) is reached. That close never counts later.
4. **Each counted close moves you toward the next catch.**
   - The target is a hidden number from 4 to 7, drawn again after every catch.
   - You see "close N toward your next catch". The target itself is never shown.
   - Progress is kept overnight.
5. **Each close gets a score:** priority points (high 3, medium 2, normal 1, other 0) + 2 if it closed within SLA.
   - **SLA targets** match the vault's `sla-tracking.base`: high 1 day, medium 2, normal 3, other 7, measured from `dateCreated` to `completedDate`.
   - If `completedDate` has a date but no time and it's today's date (TaskNotes' default when Sheiko isn't writing), the moment the close was seen is used instead.
6. **When the target is reached, the catch score sets the rarity odds.**
   - **Catch score** = the batch's average close score (rounded) + a daily boost of +1 for every 5 closes counted today, up to +3. That gives 0–8.
   - Using the average stops one high-priority task from carrying a batch of low ones.

   | Score | Common | Uncommon | Rare | Legendary |
   |---|---|---|---|---|
   | 0 | 70 | 25 | 5 | 0 |
   | 1 | 62 | 28 | 9 | 1 |
   | 2 | 52 | 32 | 14 | 2 |
   | 3 | 42 | 35 | 20 | 3 |
   | 4 | 32 | 37 | 26 | 5 |
   | 5 | 22 | 38 | 32 | 8 |
   | 6 | 16 | 37 | 37 | 10 |
   | 7 | 12 | 35 | 41 | 12 |
   | 8 | 8 | 32 | 45 | 15 |

7. **Species:** the `contexts` of every close in the batch narrow which types can appear. The mapping is editable in the plugin's settings. If no species in the drawn tier matches, any species in that tier can appear.
8. **Draws are seeded,** so the logic is repeatable and testable. The hidden target is seeded from the install time and the catch number.

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
npm test        # 42 tests, Node's built-in runner, obsidian mocked
npm run lint
```

This repo folder doubles as the test vault. `.obsidian/` and `TaskNotes/` are git-ignored. To try a build, copy or link `main.js`, `manifest.json` and `styles.css` into `.obsidian/plugins/sheiko-pokedex/`.

## Status

**0.1.0 = Phase 2** (first working version): close detection, rarity draw, reward window, Pokédex view, tests.

**0.2.0:** a catch every 4–7 closes (hidden target), rarity from the batch average plus a daily boost, limit 3 catches a day, and date-only `completedDate` handled. Saved 0.1.0 data is migrated: catches are kept, and the old default limit of 10 becomes 3.

Still to come:
- **Phase 3:** XP, levels and evolution for a partner Pokémon you choose and can swap. Task size, from Sheiko's `timeWorkingMinutes` or else `dateCreated`→`completedDate`, scales XP. Duplicates give bonus XP.
- **Phase 4:** polish.

project-manager signs off after Phase 2, before the plugin is installed in the main vault.

## Known limits

- **Only live closes count.** A close made while Obsidian is closed, or synced in from another device, isn't seen.
- **The SLA rule is a copy.** If `sla-tracking.base` changes, `src/rarity.ts` must be updated to match.
- **The Sheiko check uses an internal Obsidian API.** It reads `app.plugins.enabledPlugins`, which isn't part of the documented API.
