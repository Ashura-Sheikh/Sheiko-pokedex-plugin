import { App, Modal } from 'obsidian';

/**
 * "This can only be used once. Use it now?" before a Starter pack gift is used up
 * (Sheikh, 2026-10-13). `onAnswer(true)` only for the confirm button; closing any other way is a no.
 */
export class ConfirmModal extends Modal {
	private answered = false;

	constructor(
		app: App,
		private heading: string,
		private message: string,
		private confirmText: string,
		private onAnswer: (yes: boolean) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('sheiko-pokedex-confirm');
		contentEl.createEl('h2', { text: this.heading });
		contentEl.createEl('p', { text: this.message });
		const buttons = contentEl.createDiv({ cls: 'modal-button-container' });
		buttons.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
		const ok = buttons.createEl('button', { cls: 'mod-cta', text: this.confirmText });
		ok.addEventListener('click', () => {
			this.answered = true;
			this.close();
			this.onAnswer(true);
		});
		window.setTimeout(() => ok.focus(), 0);
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.answered) this.onAnswer(false);
	}
}
