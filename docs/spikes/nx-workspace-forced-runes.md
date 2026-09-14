Resolved by a minimal two-package workspace in a detached worktree at `6221826`. No production changes.

## Results

| Check | isolated | hoisted |
| --- | --- | --- |
| Original forced-runes predicate, linked legacy `.svelte` component | Fails: `legacy_export_invalid` | Same failure |
| Predicate scoped to `apps/web/src`, same component | Production build passes | Production build passes |
| App-local Vitest config: `$lib` import plus `vi.mock('$app/paths')` | 1 test passes | 1 test passes |
| Root invocation through `pnpm --filter @spike/web exec vitest run` | Passes | Passes |
| App-local generated tsconfig after `svelte-kit sync` | svelte-check: 0 errors/warnings | Same |

The adapter-node output also returned HTTP 200 at `/spike`, rendering both the app and the linked component.

## Forced runes

Neither linker makes workspace components behave like installed third-party components. Vite supplies the real `.../packages/ui/Widget.svelte` filename in both modes, without a `node_modules` segment. The current predicate therefore forces **true**, not undefined. A linked component using `export let` fails.

If forced runes should apply only to the app, the tested replacement in `apps/web/svelte.config.js` is:

```js
import { fileURLToPath } from 'node:url';

runes: ({ filename }) =>
  filename.startsWith(fileURLToPath(new URL('./src/', import.meta.url)))
    ? true
    : undefined
```

Returning undefined lets workspace libraries infer their own mode. If all first-party UI packages deliberately require runes, the current predicate already enforces that; do not change the linker to try to exempt them. The workspace-hygiene decision owns that policy and the linker choice. These checks give no correctness reason to require hoisted.

## Per-package tests and types

Keep `sveltekit()` in the app-local Vitest config and run with the app as working directory, directly or through pnpm filtering. No hand-written `$lib` or `$app/paths` alias was needed. The test imported `$lib/probe.js`, which imports `$app/paths`, and verified the mocked base path.

Keep `apps/web/tsconfig.json` extending `./.svelte-kit/tsconfig.json`; generate it with app-local `svelte-kit sync`. The relative extension survives relocation unchanged.

Remove or rewrite the **old root** tsconfig extension when moving the app. In this fixture, leaving the original root config pointing at a nonexistent root `.svelte-kit/tsconfig.json` broke cold Vitest dependency optimization with `Could not resolve 'node:module' ... Tsconfig not found`. Removing that stale config fixed it. Reintroduced and reproduced under hoisted after clearing the fixture's `.vite` cache; a warm cache can conceal it. A dependency-version pin did not fix it.

The minimal UI package also needed an exported component declaration for svelte-check. Adding `Widget.svelte.d.ts` and a `types` export fixed the missing declaration diagnostic. That is a package export/type contract, not a linker failure.

## Reproduction and limits

Local fixture and logs: `/tmp/chaching-workspace-spike/spike`. Run `python3 verify.py` there to reinstall each linker mode and assert the expected failing original build plus successful fixed build, type check and tests. `results.json` records the matrix; filename traces and command logs are alongside it.

Node 26.7.0; pnpm 10.32.1; Svelte 5.56.4; SvelteKit 2.67.0; vite-plugin-svelte 7.1.2; adapter-node 5.5.4; Vite 8.1.0; Vitest 4.1.7; TypeScript 6.0.3; svelte-check 4.7.1. The final matrix used Rolldown 1.1.3; the initial failure also occurred with 1.1.5.

This was the requested minimal workspace spike, not a full application migration or a dependency/native-module compatibility audit. All surfaced questions already belong to “Workspace hygiene: linker, lint tooling, tsconfig base, test layout, supply-chain settings”; no new ticket is needed.
