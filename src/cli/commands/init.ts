// `chaching init` — install wizard stub.
// TODO(wave-3): implement the full @clack/prompts wizard here.
// Wire: provider multiselect (all-ticked default), env-first secret handling,
// write config with 0600, then continue to TUI.

export async function runWizard(): Promise<void> {
	console.log('chaching init: wizard coming in wave 3.');
	console.log('');
	console.log('For now, create ~/.config/chaching/config.json manually.');
	console.log('See: https://github.com/rbutera/chaching#configuration');
}
