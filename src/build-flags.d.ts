/**
 * Set by esbuild.config.mjs: true for `npm run dev`, false for `npm run build` (what releases use).
 * Only main.ts reads it, so the tests (which never import main.ts) don't need it defined.
 */
declare const __SHEIKO_DEV__: boolean;
