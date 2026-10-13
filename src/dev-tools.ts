// Unlimited test commands: development builds only (Sheikh, 2026-10-13, 0.9.0).
// main.ts calls registerTestCommands only inside `if (__SHEIKO_DEV__)`. esbuild sets that to false for
// `npm run build` (which releases use), drops the branch, and with it this whole module, so release
// main.js files don't contain these commands. A test builds the production bundle and checks.
// Real users get the one-time Starter pack instead.

import { App, Command, Notice } from 'obsidian';
import { PokedexData, XpGain, testAddPokemon, testGiveEachStone, testGivePartnerXp } from './store';
import { speciesByDex } from './progression';
import { SpeciesSuggestModal } from './ui/partner-suggest';

export interface DevToolsHost {
	app: App;
	addCommand(command: Command): Command;
	getData(): PokedexData;
	enqueue(fn: () => Promise<void>): Promise<void>;
	commit(next: PokedexData): Promise<void>;
	xpText(xp: XpGain | null): string;
	maybeAskToEvolve(xp: XpGain | null): void;
}

/** Test commands, shown only while Settings → Test tools (development builds only) is on. */
export function registerTestCommands(host: DevToolsHost): void {
	const on = () => host.getData().settings.testTools;
	host.addCommand({
		id: 'test-give-xp',
		name: 'Test: give partner 500 XP',
		checkCallback: (checking) => {
			if (!on()) return false;
			if (!checking) {
				void host.enqueue(async () => {
					const { data, xp } = testGivePartnerXp(host.getData(), 500);
					if (!xp) {
						new Notice('Sheiko Pokedex test: choose a partner first.');
						return;
					}
					await host.commit(data);
					new Notice(`Sheiko Pokedex test${host.xpText(xp)}`);
					host.maybeAskToEvolve(xp);
				});
			}
			return true;
		},
	});
	host.addCommand({
		id: 'test-give-stones',
		name: 'Test: give one of each stone',
		checkCallback: (checking) => {
			if (!on()) return false;
			if (!checking) {
				void host.enqueue(async () => {
					await host.commit(testGiveEachStone(host.getData()));
					new Notice('Sheiko Pokedex test: added one of each stone.');
				});
			}
			return true;
		},
	});
	host.addCommand({
		id: 'test-add-pokemon',
		name: 'Test: add a Pokémon to the Pokedex',
		checkCallback: (checking) => {
			if (!on()) return false;
			if (!checking) {
				new SpeciesSuggestModal(host.app, 'Test: add which Pokémon?', null, (dex) =>
					void host.enqueue(async () => {
						await host.commit(testAddPokemon(host.getData(), dex, new Date()));
						new Notice(`Sheiko Pokedex test: added ${speciesByDex(dex)?.name ?? dex}.`);
					}),
				).open();
			}
			return true;
		},
	});
}
