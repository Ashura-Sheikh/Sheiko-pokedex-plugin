# Sheiko Pokédex

An Obsidian plugin that turns finishing tasks into catching Pokémon. Close tasks in [TaskNotes](https://github.com/callumalpass/tasknotes) and catch a random Gen 1 Pokémon every 4–7 closes; the more you close in a day, the better your odds. Pick a partner, level it up from your work, evolve it, and fill your Pokédex.

> **Unofficial fan project.** Not affiliated with, endorsed by, or sponsored by Nintendo, Game Freak, Creatures Inc. or The Pokémon Company. Pokémon and Pokémon names are trademarks of their respective owners. **This repository contains no Pokémon artwork.** By default every Pokémon is drawn as a coloured placeholder badge. Sprites are optional and fetched on your own machine (see [Sprites](#sprites-optional-local-only)).

## Requirements

- Obsidian desktop (the plugin is desktop only)
- [TaskNotes](https://github.com/callumalpass/tasknotes), enabled
- [Sheiko Task Lifecycle](https://github.com/Ashura-Sheikh/Sheiko-obsidian-plugin), enabled

## Install

Not in the Obsidian community directory. To install by hand:

```
npm install
npm run sprites   # optional: fetch sprites locally, see below
npm run build
```

Copy `main.js`, `manifest.json` and `styles.css` into `<your vault>/.obsidian/plugins/sheiko-pokedex/`, then enable **Sheiko Pokédex** in Settings → Community plugins.

If your vault is in git, add `.obsidian/plugins/sheiko-pokedex/` to its `.gitignore`. That keeps your catch data, and the sprites inside `main.js` if you fetched them, out of your vault's history.

## How a catch works

1. **A close is detected.** A task's status changes from open to a completed status (as defined in TaskNotes' own settings) while Obsidian is running. Tasks that were already done when the Pokédex started never count, so rewards start from install.
2. **The plugin reads after Sheiko has finished.** It waits 2 seconds (Sheiko waits 0.6 s) and then reads the task's frontmatter. **It never writes to your notes.** All Pokédex state is kept in the plugin's own `data.json`.
3. **Some closes count for nothing:**
   - a task that has already counted once, including after a reopen, a rename or an archive move
   - a task closed with `closeReason: superseded` or `parked`
   - any close after the day's catch limit (default 3 catches a day) is reached. That close never counts later.
4. **Each counted close moves you toward the next catch.**
   - The target is a hidden number from 4 to 7, drawn again after every catch.
   - You see "close N toward your next catch". The target itself is never shown.
   - Progress is kept overnight.
   - **Bulk closes:** when more than 50 tasks close within 6 minutes, the closes after the 50th count as **half a close**, toward both the hidden target and the daily boost, and weigh half in the batch average. XP isn't affected. Every close counts toward detecting a burst, including superseded, parked and over-the-limit ones. Both numbers are settings.
5. **Each close gets a score:** priority points (high 3, medium 2, normal 1, other 0) + 2 if it closed within its SLA target.
   - **SLA targets:** high 1 day, medium 2, normal 3, other 7, measured from `dateCreated` to `completedDate`.
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

## Partner, levels, evolution and stones

- **Partner card:** the partner gets a large card at the top of the Pokédex view: a 2× sprite, level and XP bar, its current moves, its next move and what it evolves into (level, stone or fully evolved).
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
- **Evolution by level:** when the partner reaches its evolution level, the **Game Boy evolution scene** starts: "What? CHARMELEON is evolving!" on an original green screen. **Press B** (or **Stop**, or close the window) to stop it. Stop it and you're asked again at the next level.
  - The evolved form keeps the level and becomes the partner.
  - **Both forms stay caught** in the Pokédex.
- **The evolution scene** follows Pokémon Red/Blue's own timing (from the pret/pokered disassembly):
  - the Pokémon in colour, then black silhouettes of the old and new forms swapping in 8 bursts that get longer while the pauses get shorter (72 swaps, about 6 seconds)
  - then "CHARMELEON evolved into CHARIZARD!", or "Huh? CHARMELEON stopped evolving!"
  - B is read during the pauses, as in the game, so pressing or holding it stops the scene at the next pause
  - stone evolutions play the same scene but can't be stopped, as in the game
  - **Calm evolution scene** (a setting, and automatic when your system asks for reduced motion) replaces the flicker with a slow fade
  - no sound
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
- **Moves:** each Pokémon uses its original **Red/Blue level-up moves**.
  - **Under each card:** the moves it knows now, meaning the last 4 learned by its level, as in the games.
  - **Detail window:** the full list with levels: ✓ for the 4 it knows, faded for moves it has outgrown, → for the next one (e.g. "next: Rage at Lv 22").
  - **Level-ups:** the XP notice and the reward window add "Learned Ember!".
  - An evolved form already knows its pre-evolution's starting moves. Red/Blue lists 101 such moves twice; only the first entry is kept.
- **Test tools (off by default):** Settings → **Test tools** adds three commands for trying things out in a test vault:
  - **Test: give partner 500 XP:** about 3 presses take a level-5 Charmander to 16
  - **Test: give one of each stone**
  - **Test: add a Pokémon to the Pokédex:** not counted as a close

  Leave the setting off for real use.

## Sprites (optional, local only)

This repository never contains Pokémon artwork, and a test enforces it: CI fails if an image file or embedded image data is ever committed. Builds from a fresh clone, including CI, use coloured placeholder badges.

To see the classic 96×96 pixel sprites in your own install:

```
npm run sprites   # writes src/data/sprites.local.ts (git-ignored)
npm run build     # prints "Sprites: local file (sprites included)"
```

- **Where they come from:** `scripts/fetch_sprites.py` downloads the 151 Gen 1 sprites from the [PokeAPI sprites repository](https://github.com/PokeAPI/sprites). Each download is checked: it must be a PNG, 96×96 and under 64 KB. The sprites are written into the git-ignored `src/data/sprites.local.ts`.
- **What the build does with them:** when that file exists, the build bundles it into your local `main.js`; otherwise it uses an empty map.
- **Unseen Pokémon** show as black silhouettes.
- **To go back to badges,** delete the local file and rebuild.
- **Sprites are for your own use.** Don't commit or redistribute builds that include them.

## Data

`src/data/gen1.ts` is generated from [PokeAPI's CSV data](https://github.com/PokeAPI/pokeapi/tree/master/data/v2/csv) by `scripts/build_gen1_data.py`. It holds names, types, capture rates, evolution links (with each stone) and Red/Blue level-up moves (989 after removing repeats). No images.
- **Tiers:** legendary/mythical (5); then by capture rate: ≤ 45 rare (55), ≤ 120 uncommon (45), otherwise common (46).
- **Types** are PokeAPI's current ones, so Clefairy is Fairy and Magnemite is Electric/Steel.

To regenerate (needs `pokemon_species`, `pokemon_species_names`, `pokemon_types`, `types`, `pokemon_evolution`, `items`, `pokemon_moves`, `move_names` and `moves` CSVs):

```
python3 -I scripts/build_gen1_data.py <folder with the CSV files>
```

## Development

```
npm install
npm run build   # type-check + bundle to main.js
npm test        # Node's built-in test runner, obsidian mocked; never uses local sprites
npm run lint
```

**CI:** `.github/workflows/ci.yml` runs build, lint and test on Node 20, 22 and 24 for every pull request into `main` and every push to `main`.

If you open the repo folder itself as an Obsidian test vault, its `.obsidian/`, `TaskNotes/` and screenshot folders are git-ignored.

## Changelog

- **0.7.1:** licensed under MIT (code only; see Credits and licence).
- **0.7.0:** the Game Boy evolution scene: Red/Blue timing and text on an original green screen, B to stop, unstoppable stone evolutions, and a calm mode without flicker.
- **0.6.1:** the partner is the main visual: a large card at the top of the Pokédex with a 2× sprite, level and XP, current moves, next move and what it evolves into, plus Details and Change partner.
- **0.6.0:** optional local sprites (fetched by `npm run sprites`, never committed; silhouettes for unseen Pokémon). The README is written for a public audience.
- **0.5.0:** bulk-close rule: more than 50 closes within 6 minutes → half credit for the rest of the burst.
- **0.4.0:** Red/Blue level-up moves (current 4 under each card, full list in the detail window, "Learned …!" on level-ups), plus status-bar hover, click and right-click.
- **0.3.0:** partner, per-Pokémon levels and XP, evolution prompts (asked first, re-asked a level later after Cancel), earned stones including the Trade Stone, and the partner in the status bar. Saved 0.2.0 data is migrated: every caught species starts at level 5, with no partner and no stones.
- **0.2.0:** a catch every 4–7 closes (hidden target), rarity from the batch average plus a daily boost, limit 3 catches a day, and date-only `completedDate` handled. Saved 0.1.0 data is migrated.
- **0.1.0:** first working version: close detection, rarity draw, reward window, Pokédex view.

## Known limits

- **Only live closes count.** A close made while Obsidian is closed, or synced in from another device, isn't seen.
- **The SLA targets are fixed** in `src/rarity.ts`. They aren't read from your vault.
- **The Sheiko check uses an internal Obsidian API.** It reads `app.plugins.enabledPlugins`, which isn't part of the documented API.

## Credits and licence

- Pokémon data (names, types, evolutions, moves) and the optional sprites come from [PokeAPI](https://pokeapi.co/).
- Built to work alongside [TaskNotes](https://github.com/callumalpass/tasknotes) and [Sheiko Task Lifecycle](https://github.com/Ashura-Sheikh/Sheiko-obsidian-plugin).
- **Licence:** [MIT](LICENSE), © 2026 Sheikh M Sahil. It covers this plugin's own code and documentation.
  - It doesn't cover Pokémon names, move names or other Pokémon content. Those belong to their owners and aren't licensed by this project.
  - It doesn't cover the PokeAPI-derived data or the optional sprites, which come under PokeAPI's own terms.
