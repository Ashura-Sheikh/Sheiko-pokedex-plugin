import { App, FuzzySuggestModal } from 'obsidian';
import { GEN1 } from '../data/gen1';
import { PokedexData } from '../store';
import { START_LEVEL, speciesByDex } from '../progression';
import { Species } from '../species';
import { dexLabel } from './art';

/** "Choose partner": search your caught Pokémon. */
export class PartnerSuggestModal extends FuzzySuggestModal<Species> {
	constructor(
		app: App,
		private data: PokedexData,
		private onPick: (dex: number) => void,
	) {
		super(app);
		this.setPlaceholder('Choose a partner from your caught Pokémon');
	}

	getItems(): Species[] {
		return Object.keys(this.data.caught)
			.map((k) => speciesByDex(Number(k)))
			.filter((s): s is Species => !!s)
			.sort((a, b) => a.dex - b.dex);
	}

	getItemText(s: Species): string {
		const lv = this.data.mons[String(s.dex)]?.level ?? START_LEVEL;
		const mark = this.data.partner === s.dex ? ' (partner)' : '';
		return `${s.name} ${dexLabel(s.dex)} · Lv ${lv}${mark}`;
	}

	onChooseItem(s: Species): void {
		this.onPick(s.dex);
	}
}

/** Test tools: pick any of the 151 Gen 1 species. */
export class SpeciesSuggestModal extends FuzzySuggestModal<Species> {
	constructor(
		app: App,
		private onPick: (dex: number) => void,
	) {
		super(app);
		this.setPlaceholder('Test: add which Pokémon?');
	}

	getItems(): Species[] {
		return [...GEN1];
	}

	getItemText(s: Species): string {
		return `${s.name} ${dexLabel(s.dex)}`;
	}

	onChooseItem(s: Species): void {
		this.onPick(s.dex);
	}
}
