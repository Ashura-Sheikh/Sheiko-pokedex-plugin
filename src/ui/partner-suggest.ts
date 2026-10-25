import { App, FuzzySuggestModal } from 'obsidian';
import { ALL_SPECIES } from '../gens';
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

/** Pick a species: from `only` (the Starter pack's uncaught ones), or every released species when null (test tools). */
export class SpeciesSuggestModal extends FuzzySuggestModal<Species> {
	constructor(
		app: App,
		placeholder: string,
		private only: number[] | null,
		private onPick: (dex: number) => void,
	) {
		super(app);
		this.setPlaceholder(placeholder);
	}

	getItems(): Species[] {
		if (!this.only) return [...ALL_SPECIES];
		return this.only.map((dex) => speciesByDex(dex)).filter((s): s is Species => !!s);
	}

	getItemText(s: Species): string {
		return `${s.name} ${dexLabel(s.dex)}`;
	}

	onChooseItem(s: Species): void {
		this.onPick(s.dex);
	}
}
