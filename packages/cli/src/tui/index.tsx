// TUI launcher. Bridges the real engine to the Ink root and owns process-level
// lifecycle: cold-scan loading state, render, clean teardown on quit.
//
// `runDashboard()` is what the router calls for a bare `chaching` invocation. It
// keeps the React tree free of disk IO by doing the cold scan here, then handing
// the started engine to <DashboardApp> as an injected DashboardSource.

import { render } from 'ink';
import { createEngine, type Engine } from '@chaching/core/engine';
import { loadConfig } from '@chaching/core/config';
import { discoverTerminalTheme } from './terminal-theme';
import { noArt, applyTerminalTheme } from './theme';
import { DashboardApp, type DashboardSource } from './app';

export interface RunDashboardOptions {
	argv?: string[];
}

export async function runDashboard(opts: RunDashboardOptions = {}): Promise<void> {
	// Not a TTY (piped/redirected) → don't try to start an interactive raw-mode UI.
	// Fall back to the one-shot stats print so `chaching | cat` stays useful.
	if (!process.stdout.isTTY) {
		const { runStats } = await import('../commands/stats');
		await runStats({});
		return;
	}

	applyTerminalTheme(await discoverTerminalTheme());
	const cfg = await loadConfig();
	const engine: Engine = createEngine(cfg);

	// The cold scan runs INSIDE the React lifecycle (source.start) so the loading
	// frame renders with keypresses already live (q/Ctrl-C work during the scan).
	const source: DashboardSource = {
		snapshot: () => engine.snapshot(),
		subscribe: (fn) => engine.subscribe(fn),
		dispose: () => engine.dispose(),
		start: () => engine.ensureStarted()
	};

	const { waitUntilExit } = render(<DashboardApp source={source} noArt={noArt(opts.argv)} />, {
		// We restore the terminal + dispose the engine in the app's unmount effect;
		// let Ink handle Ctrl-C → exit (default true) so raw mode is restored cleanly.
		exitOnCtrlC: true
	});

	await waitUntilExit();
	// Belt-and-braces: the app effect disposes on unmount, but ensure it's gone.
	engine.dispose();
}
