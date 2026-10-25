"""Builds src/data/pokedex.ts from PokeAPI's published CSV files.

Usage:
    python3 -I scripts/build_species_data.py <csv-dir>

<csv-dir> must contain these files from
https://github.com/PokeAPI/pokeapi/tree/master/data/v2/csv :
    pokemon_species.csv, pokemon_species_names.csv, pokemon_types.csv,
    types.csv, pokemon_evolution.csv, items.csv,
    pokemon_moves.csv, move_names.csv, moves.csv

Only names, types, capture rates, generations, evolution links and level-up
moves are kept (Red/Blue for #1-151, X/Y for #152 and up). No images.
Run it again and commit the output if the data ever needs refreshing.
"""

import csv
import json
import os
import sys


# PokeAPI's licence (BSD-3-Clause), copied verbatim from
# https://github.com/PokeAPI/pokeapi/blob/master/LICENSE.md . Its second condition asks
# binary redistributions to reproduce the notice, and this data ships inside main.js,
# so it is written into gen1.ts as a /*! legal comment */, which esbuild keeps in the build.
POKEAPI_LICENSE = """Copyright (c) © 2013–2023 Paul Hallett and PokéAPI contributors (https://github.com/PokeAPI/pokeapi#contributing). Pokémon and Pokémon character names are trademarks of Nintendo.

All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

* Neither the name of PokéAPI nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
"""


def legal_comment(text):
    lines = ["/*!", " * Pokémon data in this file comes from PokeAPI (https://pokeapi.co/), used under this licence:", " *"]
    lines += [(" * " + line).rstrip() for line in text.strip("\n").split("\n")]
    return "\n".join(lines + [" */"]) + "\n"


MAX_DEX = 251  # Gen 2 (2.0.0). Raise with each new Gen.
ENGLISH = 9
RED_BLUE = 1  # version_group id, moves for #1-151 (Sheikh, 2026-10-12)
X_Y = 15  # version_group id, moves for #152 and up (Sheikh's (b), 2026-10-25)
LEVEL_UP = 1  # pokemon_move_method id
# PokeAPI evolution_trigger ids
LEVEL_UP_TRIGGER, TRADE_TRIGGER, USE_ITEM_TRIGGER = 1, 2, 3
# Evolution stones -> the plugin's stone kinds. Plain trades use a "trade" stone (Sheikh, 2026-10-12).
STONES = {"fire-stone": "fire", "water-stone": "water", "thunder-stone": "thunder", "leaf-stone": "leaf", "moon-stone": "moon", "sun-stone": "sun"}
# Items held for a trade evolution -> the plugin's Trade Items (2.0.0, Sheikh 2026-10-25).
HELD_ITEMS = {"kings-rock": "kings-rock", "metal-coat": "metal-coat", "dragon-scale": "dragon-scale", "up-grade": "up-grade"}


def rows(csv_dir, name):
    with open(os.path.join(csv_dir, name + ".csv"), newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def tier_for(species):
    if species["is_legendary"] == "1" or species["is_mythical"] == "1":
        return "legendary"
    rate = int(species["capture_rate"])
    if rate <= 45:
        return "rare"
    if rate <= 120:
        return "uncommon"
    return "common"


def has(r, key):
    """A condition column is set. PokeAPI leaves unset ones empty; a 0 can be a real value."""
    return r.get(key) not in (None, "")


def evolution_for(sid, r, items):
    """The plugin's evolution entry for PokeAPI evolution row `r`."""
    trig = int(r["evolution_trigger_id"])
    lvl = int(r["minimum_level"]) if r["minimum_level"] else None
    if trig == USE_ITEM_TRIGGER:
        item = items.get(int(r["trigger_item_id"])) if r["trigger_item_id"] else None
        if item not in STONES:
            sys.exit("unexpected evolution item for species %d: %s" % (sid, item))
        return {"trigger": "item", "minLevel": lvl, "stone": STONES[item]}
    if trig == TRADE_TRIGGER:
        if has(r, "held_item_id"):
            held = items.get(int(r["held_item_id"]))
            if held not in HELD_ITEMS:
                sys.exit("unexpected held item for species %d: %s" % (sid, held))
            return {"trigger": "trade", "minLevel": None, "item": HELD_ITEMS[held]}
        return {"trigger": "trade", "minLevel": None, "stone": "trade"}
    if trig == LEVEL_UP_TRIGGER:
        if has(r, "minimum_happiness") or has(r, "minimum_affection") or has(r, "minimum_beauty"):
            return {"trigger": "other", "minLevel": None, "item": "friendship"}
        # Any other condition (relative stats, held item, time of day, gender, party ...) makes it
        # a "general" Trade Item evolution. relative_physical_stats = 0 (Attack = Defense, Hitmontop)
        # is a real condition, so has() is used, not truthiness.
        others = ["relative_physical_stats", "held_item_id", "gender_id", "party_species_id", "party_type_id",
                  "trade_species_id", "known_move_id", "known_move_type_id", "location_id"]
        if any(has(r, k) for k in others) or r.get("time_of_day") or r.get("needs_overworld_rain") == "1" \
                or r.get("turn_upside_down") == "1" or lvl is None:
            return {"trigger": "other", "minLevel": None, "item": "general"}
        return {"trigger": "level", "minLevel": lvl}
    return {"trigger": "other", "minLevel": None, "item": "general"}


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    csv_dir = sys.argv[1]

    species = [r for r in rows(csv_dir, "pokemon_species") if int(r["id"]) <= MAX_DEX]
    names = {
        int(r["pokemon_species_id"]): r["name"]
        for r in rows(csv_dir, "pokemon_species_names")
        if int(r["local_language_id"]) == ENGLISH
    }
    type_names = {int(r["id"]): r["identifier"] for r in rows(csv_dir, "types")}
    items = {int(r["id"]): r["identifier"] for r in rows(csv_dir, "items")}
    types = {}
    for r in rows(csv_dir, "pokemon_types"):
        pid = int(r["pokemon_id"])
        if pid <= MAX_DEX:  # default forms share their species id
            types.setdefault(pid, []).append((int(r["slot"]), type_names[int(r["type_id"])]))
    evolution = {}
    for r in rows(csv_dir, "pokemon_evolution"):
        sid = int(r["evolved_species_id"])
        # The first row per species is the original method; later rows are later games or regional forms.
        if sid <= MAX_DEX and sid not in evolution:
            evolution[sid] = evolution_for(sid, r, items)

    move_names = {
        int(r["move_id"]): r["name"]
        for r in rows(csv_dir, "move_names")
        if int(r["local_language_id"]) == ENGLISH
    }
    move_types = {int(r["id"]): type_names[int(r["type_id"])] for r in rows(csv_dir, "moves")}
    learn = {}
    for r in rows(csv_dir, "pokemon_moves"):
        pid = int(r["pokemon_id"])
        if pid > MAX_DEX or int(r["pokemon_move_method_id"]) != LEVEL_UP:
            continue
        want = RED_BLUE if pid <= 151 else X_Y
        if int(r["version_group_id"]) == want:
            order = int(r["order"]) if r["order"] else 0
            learn.setdefault(pid, []).append((int(r["level"]), order, int(r["move_id"])))
    moves = {}
    for pid, lst in learn.items():
        seen = set()
        out_moves = []
        for lvl, _, mid in sorted(lst):
            name = move_names[mid]
            # A move listed twice (once at level 1, again later) is kept at its first level,
            # so a freshly caught or evolved Pokemon already knows it.
            if name in seen:
                continue
            seen.add(name)
            out_moves.append({"level": lvl, "name": name, "type": move_types[mid]})
        moves[pid] = out_moves

    out = []
    for s in sorted(species, key=lambda r: int(r["id"])):
        sid = int(s["id"])
        parent = int(s["evolves_from_species_id"]) if s["evolves_from_species_id"] else None
        if parent is not None and parent > MAX_DEX:
            parent = None  # a baby form from a later Gen (e.g. Munchlax before Snorlax)
        entry = {
            "dex": sid,
            "gen": int(s["generation_id"]),
            "name": names[sid],
            "types": [t for _, t in sorted(types[sid])],
            "tier": tier_for(s),
            "captureRate": int(s["capture_rate"]),
            "evolvesFrom": parent,
        }
        if parent is not None:
            entry["evolution"] = evolution.get(sid, {"trigger": "other", "minLevel": None, "item": "general"})
        entry["moves"] = moves.get(sid, [])
        out.append(entry)

    if len(out) != MAX_DEX:
        sys.exit("expected %d species, got %d" % (MAX_DEX, len(out)))

    target = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "data", "pokedex.ts")
    with open(target, "w", encoding="utf-8") as f:
        f.write(legal_comment(POKEAPI_LICENSE) + "\n")
        f.write("// GENERATED by scripts/build_species_data.py from PokeAPI CSV data. Do not edit by hand.\n")
        f.write("// Names, types, capture rates, generations, evolution links and level-up moves\n")
        f.write("// (Red/Blue for #1-151, X/Y for #152+). No images.\n\n")
        f.write("import type { Species } from '../species';\n\n")
        f.write("export const SPECIES: readonly Species[] = ")
        f.write(json.dumps(out, ensure_ascii=False, indent="\t"))
        f.write(";\n")
    print("wrote %d species to %s" % (len(out), os.path.normpath(target)))


if __name__ == "__main__":
    main()
