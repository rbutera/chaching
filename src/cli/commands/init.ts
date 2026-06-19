// `chaching init` — full install wizard (wave 3).

import { runWizard } from '../wizard.js';

export async function runInit(): Promise<void> {
	const result = await runWizard();
	if (result === null) {
		// User cancelled; wizard already printed a cancel message.
		process.exit(0);
	}
	// wizard printed the outro; nothing else to do here.
}
