"""Builds src/data/gen1.ts from PokeAPI's published CSV files.

Usage:
    python3 -I scripts/build_gen1_data.py <csv-dir>

<csv-dir> must contain these files from
https://github.com/PokeAPI/pokeapi/tree/master/data/v2/csv :
    pokemon_species.csv, pokemon_species_names.csv, pokemon_types.csv,
    types.csv, pokemon_evolution.csv, items.csv,
    pokemon_moves.csv, move_names.csv, moves.csv

Only names, types, capture rates, evolution links and Red/Blue level-up
moves are kept. No images.
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


GEN1_MAX = 151
ENGLISH = 9
RED_BLUE = 1  # version_group id
LEVEL_UP = 1  # pokemon_move_method id
# PokeAPI evolution_trigger ids
TRIGGERS = {1: "level", 2: "trade", 3: "item"}
# Gen 1 evolution items -> the plugin's stone kinds. Trade evolutions use a "trade" stone (Sheikh, 2026-10-12).
STONES = {"fire-stone": "fire", "water-stone": "water", "thunder-stone": "thunder", "leaf-stone": "leaf", "moon-stone": "moon"}


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


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    csv_dir = sys.argv[1]

    species = [r for r in rows(csv_dir, "pokemon_species") if int(r["id"]) <= GEN1_MAX]
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
        if pid <= GEN1_MAX:  # Gen 1 default forms share their species id
            types.setdefault(pid, []).append((int(r["slot"]), type_names[int(r["type_id"])]))
    evolution = {}
    for r in rows(csv_dir, "pokemon_evolution"):
        sid = int(r["evolved_species_id"])
        # The first row per species is the original Gen 1 method; later rows are regional forms.
        if sid <= GEN1_MAX and sid not in evolution:
            trig = TRIGGERS.get(int(r["evolution_trigger_id"]), "other")
            lvl = int(r["minimum_level"]) if r["minimum_level"] else None
            entry = {"trigger": trig, "minLevel": lvl}
            if trig == "item":
                item = items.get(int(r["trigger_item_id"])) if r["trigger_item_id"] else None
                if item not in STONES:
                    sys.exit("unexpected evolution item for species %d: %s" % (sid, item))
                entry["stone"] = STONES[item]
            elif trig == "trade":
                entry["stone"] = "trade"
            evolution[sid] = entry

    # Red/Blue level-up moves (Sheikh, 2026-10-12), in the order the games teach them.
    move_names = {
        int(r["move_id"]): r["name"]
        for r in rows(csv_dir, "move_names")
        if int(r["local_language_id"]) == ENGLISH
    }
    move_types = {int(r["id"]): type_names[int(r["type_id"])] for r in rows(csv_dir, "moves")}
    learn = {}
    for r in rows(csv_dir, "pokemon_moves"):
        pid = int(r["pokemon_id"])
        if pid <= GEN1_MAX and int(r["version_group_id"]) == RED_BLUE and int(r["pokemon_move_method_id"]) == LEVEL_UP:
            order = int(r["order"]) if r["order"] else 0
            learn.setdefault(pid, []).append((int(r["level"]), order, int(r["move_id"])))
    moves = {}
    for pid, lst in learn.items():
        seen = set()
        out_moves = []
        for lvl, _, mid in sorted(lst):
            name = move_names[mid]
            # Red/Blue lists 101 moves twice per species: once as a starting move (level 1) and
            # again at a later level (e.g. Charmeleon: Ember at 1 and 9; Mewtwo: Psychic at 1 and 66).
            # Keep the first, so a freshly caught or evolved Pokémon already knows it.
            if name in seen:
                continue
            seen.add(name)
            out_moves.append({"level": lvl, "name": name, "type": move_types[mid]})
        moves[pid] = out_moves

    out = []
    for s in sorted(species, key=lambda r: int(r["id"])):
        sid = int(s["id"])
        parent = int(s["evolves_from_species_id"]) if s["evolves_from_species_id"] else None
        if parent is not None and parent > GEN1_MAX:
            parent = None  # e.g. Pikachu's later-generation baby form
        entry = {
            "dex": sid,
            "name": names[sid],
            "types": [t for _, t in sorted(types[sid])],
            "tier": tier_for(s),
            "captureRate": int(s["capture_rate"]),
            "evolvesFrom": parent,
        }
        if parent is not None:
            entry["evolution"] = evolution.get(sid, {"trigger": "other", "minLevel": None})
        entry["moves"] = moves.get(sid, [])
        out.append(entry)

    if len(out) != GEN1_MAX:
        sys.exit("expected %d species, got %d" % (GEN1_MAX, len(out)))

    target = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "data", "gen1.ts")
    with open(target, "w", encoding="utf-8") as f:
        f.write(legal_comment(POKEAPI_LICENSE) + "\n")
        f.write("// GENERATED by scripts/build_gen1_data.py from PokeAPI CSV data. Do not edit by hand.\n")
        f.write("// Names, types, capture rates, evolution links and Red/Blue level-up moves. No images.\n\n")
        f.write("import type { Species } from '../species';\n\n")
        f.write("export const GEN1: readonly Species[] = ")
        f.write(json.dumps(out, ensure_ascii=False, indent="\t"))
        f.write(";\n")
    print("wrote %d species to %s" % (len(out), os.path.normpath(target)))


if __name__ == "__main__":
    main()
