// `chaching provider` — provider management stub.
// TODO(wave-3): implement add | enable | disable subcommands via @clack/prompts.

export async function runProvider(args: string[]): Promise<void> {
	const [action, name] = args;

	if (!action) {
		console.log('chaching provider: sub-subcommands: add | enable | disable');
		console.log('');
		console.log('Provider management is coming in wave 3.');
		return;
	}

	// Recognise the subcommands so we give a useful message, not "unknown"
	if (action === 'add' || action === 'enable' || action === 'disable') {
		console.log(`chaching provider ${action}${name ? ` ${name}` : ''}: coming in wave 3.`);
		return;
	}

	console.error(`chaching provider: unknown action '${action}' (must be add|enable|disable)`);
	process.exit(1);
}
