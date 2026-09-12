import os from 'node:os';
import type {RedactOptions} from './redact.js';

function safeHostname(): string {
	try {
		return os.hostname();
	} catch {
		return '';
	}
}
function safeUserInfoUsername(): string {
	try {
		return os.userInfo().username;
	} catch {
		return '';
	}
}
function safeHomedir(): string {
	try {
		return os.homedir();
	} catch {
		return '';
	}
}

/**
 * The real "user@host" for the receipt header's user·path line — the machine the
 * receipt was cut on. Node-only (CLI command + the web PNG route, both server-side).
 * Falls back to neutral labels if the OS lookup fails (CI/sandbox). This is the
 * value the receipt shows by DEFAULT; `redactReceipt` scrubs it only on opt-in.
 */
export function currentAccount(env: Record<string, string | undefined> = process.env): string {
	const user = env.USER || env.USERNAME || safeUserInfoUsername() || 'user';
	const host = safeHostname() || 'host';
	return `${user}@${host}`;
}


export function redactionContext(): RedactOptions { return {env:{USER:process.env.USER,USERNAME:process.env.USERNAME,HOME:process.env.HOME}, username:process.env.USER ?? process.env.USERNAME ?? safeUserInfoUsername(),hostname:safeHostname(),homedir:safeHomedir()}; }
