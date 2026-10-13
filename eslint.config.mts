import obsidianmd from 'eslint-plugin-obsidianmd';
import { DEFAULT_BRANDS } from 'eslint-plugin-obsidianmd/dist/lib/rules/ui/brands.js';
import globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'dist',
		'esbuild.config.mjs',
		'version-bump.mjs',
		'versions.json',
		'main.js',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
		'tsconfig.test.json',
		// Tests aren't shipped; they're type-checked by `npm test` (tsconfig.test.json).
		'test',
		'test-dist',
		// This folder doubles as Sheikh's test vault: skip its config and notes.
		'.obsidian',
		'TaskNotes',
		// Left from 0.6–0.7's `npm run sprites` (removed in 0.8.0): git-ignored, unused.
		'src/data/sprites.local.ts',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mts', 'manifest.json'],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		// Product names and a frontmatter field name, not words to sentence-case.
		rules: {
			'obsidianmd/ui/sentence-case': [
				'warn',
				{ brands: [...DEFAULT_BRANDS, 'Sheiko', 'TaskNotes', 'Pokédex', 'Pokémon'], ignoreWords: ['closedBy', 'XP'] },
			],
		},
	},
);
