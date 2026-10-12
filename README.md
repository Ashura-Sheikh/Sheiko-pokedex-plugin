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
   - **Bulk closes (0.5.0):** when more than 50 tasks close within 6 minutes, the closes after the 50th count as **half a close**, toward both the hidden target and the daily boost, and weigh half in the batch average. XP isn't affected. Every close counts toward detecting a burst, including superseded, parked and over-the-limit ones. Both numbers are settings.
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

Task size (worked time) doesn't affect rarity. It scales your partner's XP (below).

## Partner, levels, evolution and stones (0.3.0)

- **Partner:** choose one caught Pokémon as your partner, from the Pokédex view (**Choose partner**, or click a Pokémon and pick **Make partner**) or with the **Choose partner** command.
- **Status bar:** shows the partner and its level, e.g. "Charmeleon Lv 17".
  - **Hover:** shows XP, e.g. "140 / 170 XP", and whether an evolution is available.
  - **Click:** opens the Pokédex, or the partner picker if no partner is set yet.
  - **Right-click:** a menu with Open Pokédex, Choose partner and, when the partner has reached its evolution level (including after a Cancel), **Evolve now**.
- **XP:** every counted close gives the partner XP:
  - 10, plus 1 per 30 minutes of task size, up to +40
  - task size is Sheiko's `timeWorkingMinutes` when present, otherwise `dateCreated` → close
  - a duplicate catch adds +50
  - without a partner, no XP is earned, and the notice says so
- **Levels:** every caught Pokémon starts at level 5 and keeps its own level and XP, so swapping partners loses nothing. Going from level L to L+1 takes 10 × L XP, up to level 100.
- **Evolution by level:** when the partner reaches its evolution level, you're asked first, with **Evolve** or **Cancel**. Cancel and you're asked again at the next level.
  - The evolved form keeps the level and becomes the partner.
  - **Both forms stay caught** in the Pokédex.
- **Stones:** 1 in 25 catches (about one every 8 days at 3 catches a day) also finds a stone matching the caught Pokémon's type:

  | Caught type | Stone |
  |---|---|
  | Fire | Fire Stone |
  | Water, Ice | Water Stone |
  | Electric | Thunder Stone |
  | Grass, Bug | Leaf Stone |
  | Fairy, Normal, Poison | Moon Stone |
  | Psychic, Fighting, Rock, Ground, Ghost | Trade Stone |
  | anything else | a random one |

  The primary type is checked first, then the second.
- **Using a stone:** click the Pokémon in the Pokédex and choose the stone. The **Trade Stone** stands in for Gen 1's trade evolutions (Kadabra, Machoke, Graveler, Haunter). Eevee's form depends on the stone (Water, Thunder or Fire).
- **Moves (0.4.0):** each Pokémon uses its original **Red/Blue level-up moves**.
  - **Under each card:** the moves it knows now, meaning the last 4 learned by its level, as in the games.
  - **Detail window:** the full list with levels: ✓ for the 4 it knows, faded for moves it has outgrown, → for the next one (e.g. "next: Rage at Lv 22").
  - **Level-ups:** the XP notice and the reward window add "Learned Ember!".
  - An evolved form already knows its pre-evolution's starting moves. Red/Blue lists 101 such moves twice; only the first entry is kept.
- **Test tools (off by default):** Settings → **Test tools** adds three commands for the test vault:
  - **Test: give partner 500 XP:** about 3 presses take a level-5 Charmander to 16
  - **Test: give one of each stone**
  - **Test: add a Pokémon to the Pokédex:** not counted as a close

  Leave the setting off for real use.

## Data

`src/data/gen1.ts` is generated from [PokeAPI's CSV data](https://github.com/PokeAPI/pokeapi/tree/master/data/v2/csv) by `scripts/build_gen1_data.py`. It holds names, types, capture rates, evolution links (with each stone) and Red/Blue level-up moves (989 after removing repeats). No images.
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
npm test        # 83 tests, Node's built-in runner, obsidian mocked
npm run lint
```

**CI:** `.github/workflows/ci.yml` runs build, lint and test on Node 20, 22 and 24 for every pull request into `main` and every push to `main`.

This repo folder doubles as the test vault. `.obsidian/` and `TaskNotes/` are git-ignored. To try a build, copy or link `main.js`, `manifest.json` and `styles.css` into `.obsidian/plugins/sheiko-pokedex/`.

## Status

**0.1.0 = Phase 2** (first working version): close detection, rarity draw, reward window, Pokédex view, tests.

**0.2.0:** a catch every 4–7 closes (hidden target), rarity from the batch average plus a daily boost, limit 3 catches a day, and date-only `completedDate` handled. Saved 0.1.0 data is migrated: catches are kept, and the old default limit of 10 becomes 3.

**0.3.0 = Phase 3:** partner, per-Pokémon levels and XP, evolution prompts (asked first, re-asked a level later after Cancel), earned stones including the Trade Stone, and the partner in the status bar. Saved 0.2.0 data is migrated: every caught species starts at level 5, with no partner and no stones.

**0.4.0:** Red/Blue level-up moves (current 4 under each card, full list in the detail window, "Learned …!" on level-ups), plus status-bar hover/click/right-click.

**0.5.0:** bulk-close rule: more than 50 closes within 6 minutes → half credit for the rest of the burst.

Still to come:
- **Phase 4:** polish.

project-manager signs off after Phase 2, before the plugin is installed in the main vault.

## Known limits

- **Only live closes count.** A close made while Obsidian is closed, or synced in from another device, isn't seen.
- **The SLA rule is a copy.** If `sla-tracking.base` changes, `src/rarity.ts` must be updated to match.
- **The Sheiko check uses an internal Obsidian API.** It reads `app.plugins.enabledPlugins`, which isn't part of the documented API.
