// Stand-in for the `obsidian` module, used only by the test build (test/run.mjs
// aliases `obsidian` to this file). Covers just what watcher.ts and tasknotes.ts need.

export class TAbstractFile {
	path: string;
	constructor(path: string) {
		this.path = path;
	}
}

export class TFile extends TAbstractFile {
	get basename(): string {
		const name = this.path.split('/').pop() ?? this.path;
		return name.replace(/\.[^.]+$/, '');
	}
	get extension(): string {
		const m = /\.([^./]+)$/.exec(this.path);
		return m?.[1] ?? '';
	}
}

export function normalizePath(path: string): string {
	return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
}
