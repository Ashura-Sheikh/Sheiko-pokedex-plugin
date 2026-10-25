# Sheiko Pokedex: how it works

The rules behind each feature: odds, XP, limits and timing. For what the plugin does and how to install it, see the [README](../README.md). For a walk-through with screenshots, see the [user guide](USER-GUIDE.md).

## Contents

- [Catching](#catching)
- [Unlocking Gens](#unlocking-gens)
- [Partner, XP and levels](#partner-xp-and-levels)
- [Evolution scene](#evolution-scene)
- [Stones and Trade Items](#stones-and-trade-items)
- [Moves](#moves)
- [Sprite download](#sprite-download)

## Catching

1. **A close is detected.** A task's status changes from open to a completed status (as defined in TaskNotes' own settings) while Obsidian is running. Tasks that were already done when the Pokedex started never count, so rewards start from install.
   - To know which tasks were already done, the plugin goes through your vault's Markdown files once at startup and reads each one's frontmatter from Obsidian's cache, keeping only the task notes and their status. That's the "vault enumeration" the Community directory's scan reports. It needs every file because TaskNotes can mark a note as a task anywhere in the vault. Nothing is written or sent anywhere.
2. **The plugin reads after Sheiko has finished.** It waits 2 seconds (Sheiko waits 0.6 s) and then reads the task's frontmatter. It never writes to your notes; all Pokedex state is kept in the plugin's own `data.json`.
3. **Some closes count for nothing:**
   - a task that has already counted once, including after a reopen, a rename or an archive move
   - a task closed with `closeReason: superseded` or `parked`
4. **Closes after the day's catch limit** (default 5) give your partner XP only. They add no catch progress and no daily boost, and they never count toward a catch later. The notice says the limit is reached and shows the XP.
5. **Each counted close moves you toward the next catch.**
   - The target is a hidden number from 4 to 7, drawn again after every catch.
   - You see "close N toward your next catch". The target itself is never shown.
   - Progress is kept overnight.
6. **Bulk closes:** when more than 50 tasks close within 6 minutes, the closes after the 50th count as **half a close**, toward both the hidden target and the daily boost, and weigh half in the batch average. XP isn't affected, including for closes over the daily limit. Every close counts toward detecting a burst, including superseded, parked and over-the-limit ones. Both numbers are settings.
7. **Each close gets a score:** priority points (high 3, medium 2, normal 1, other 0) + 2 if it closed within its SLA target.
   - **SLA targets:** high 1 day, medium 2, normal 3, other 7, measured from `dateCreated` to `completedDate`. They're fixed in `src/rarity.ts`, not read from your vault.
   - If `completedDate` has a date but no time and it's today's date (TaskNotes' default when Sheiko isn't writing), the moment the close was seen is used instead.
8. **When the target is reached, the catch score sets the rarity odds.**
   - **Catch score** = the batch's average close score (rounded) + a daily boost of +1 for every 5 closes counted today, up to +3. That gives 0–8.
   - Using the average stops one high-priority task from carrying a batch of low ones.
   - Task size (worked time) doesn't affect rarity. It scales your partner's XP.

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

9. **Species:** any species of the unlocked Gens. The `contexts` of every close in the batch narrow which types can appear. The mapping is editable in the plugin's settings. If no species in the drawn tier matches, any species in that tier can appear.
10. **Draws are seeded,** so the logic is repeatable and testable. The hidden target is seeded from the install time and the catch number.

## Unlocking Gens

- **The rule:** catch **3 Pokémon** and level **one Pokémon up by 2 levels**, or **evolve any Pokémon**. Later Gens will use the same rule, counted again from each unlock.
- **Updating from 1.x:** if you already meet the rule, Gen 2 unlocks straight away. Evolutions before 2.0.0 weren't recorded as such, so the plugin works them out: a Pokémon you have more copies of than you caught (not counting a Starter pack pick) got the extra by evolving.
- **Locked cards** are treated exactly like unseen cards: no name search, hidden by type and rarity filters, not clickable. Nothing from a locked Gen can be caught, evolved into or found, and no hint names a locked evolution.
- **Filling Gen 1 slows down after the unlock (a known trade-off).** A catch picks a rarity, then any unlocked species of it, with no preference for ones you haven't caught. With Gen 2 open, about 60% of catches are Gen 1 (151 of 251 species; it varies by rarity). Grass catches also split between the Leaf and the Sun Stone, so Gen 1's Leaf Stone evolutions come a little slower.

## Partner, XP and levels

- **XP:** every counted close gives the partner XP, and so does every close after the daily catch limit:
  - 10, plus 1 per 30 minutes of task size, up to +40
  - task size is Sheiko's `timeWorkingMinutes` when present, otherwise `dateCreated` → close
  - a duplicate catch adds +50
  - without a partner, no XP is earned, and the notice says so
- **Levels:** every caught Pokémon starts at level 5 and keeps its own level and XP, so swapping partners loses nothing. Going from level L to L+1 takes 10 × L XP, up to level 100.
- **Partner animation:** about a second long. Calm has no movement. It doesn't loop and waits 2 seconds before it can play again. When your system asks for reduced motion, Full plays as Calm. Only the partner card animates; the grid and the status bar don't.

## Evolution scene

The scene follows Pokémon Red/Blue's own timing (from the pret/pokered disassembly):

- the Pokémon in colour, then black silhouettes of the old and new forms swapping in 8 bursts that get longer while the pauses get shorter (72 swaps, about 6 seconds)
- then "CHARMELEON evolved into CHARIZARD!", or "Huh? CHARMELEON stopped evolving!"
- B is read during the pauses, as in the game, so pressing or holding it stops the scene at the next pause
- stone evolutions play the same scene but can't be stopped, as in the game
- **Calm evolution scene** (a setting, and automatic when your system asks for reduced motion) replaces the flicker with a slow fade
- no sound

## Stones and Trade Items

- **Stones:** 1 in 25 catches (about one every 5 days at 5 catches a day) also finds a stone matching the caught Pokémon's type (the table is in the [README](../README.md#stones-and-trade-items)). The primary type is checked first, then the second.
- **Trade Items** (with Gen 2 unlocked) are found:
  - **20%** on each level your partner gains from a close.
  - **30%** each time a hidden 2–4 counted closes fill up (a new target is drawn each time). Closes over the daily limit don't count toward it.
  - No partner, no Trade Item. To get a different item, change partner.

## Moves

- Gen 1 uses its original **Red/Blue level-up moves**; Gen 2 uses **X/Y** level-up moves.
- A Pokémon knows the last 4 moves learned by its level, as in the games.
- **Detail window:** the full list with levels: ✓ for the 4 it knows, faded for moves it has outgrown, → for the next one (e.g. "next: Rage at Lv 22").
- An evolved form already knows its pre-evolution's starting moves. Red/Blue lists 101 such moves twice; only the first entry is kept.

## Sprite download

- **The network call:** one request per missing sprite, one at a time with a short pause, to `raw.githubusercontent.com`, for the default sprites in [PokeAPI's sprite repository](https://github.com/PokeAPI/sprites) (`sprites/pokemon/1.png` to `251.png`). Gen 1 takes about half a minute.
- **Checks:** each image must be a PNG, 96×96 and under 64 KB. A group is downloaded and checked in full before anything is saved. If the source can't be reached or any image fails a check, nothing is saved and the badges stay.
- **All-or-nothing saving:** the files go into a temporary folder that's only moved into place once every one is written, so a disk error partway through leaves nothing behind.
- **Where they're saved:** `<your vault>/.obsidian/plugins/sheiko-pokedex/sprites/` (`001.png` to `251.png`), with a `.gitignore` that ignores the whole folder. They're checked again each time Obsidian loads them.
- **Each group loads on its own:** if a group is incomplete, only that group shows badges.
