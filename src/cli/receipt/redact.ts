// redactReceipt — privacy-by-default scrub over the ReceiptModel.
//
// Runs BEFORE both the text and PNG render. Default-on: shareable output is safe
// even if the user forgets. `--reveal` / `--no-redact` is the ONLY way to include
// the real values. Scrubs: usernames ($USER / os.userInfo().username / home-dir
// path segment), hostname (os.hostname()), absolute file paths (→ basename or a
// placeholder), and project names (DayModelAgg/SessionSummary project fields).
//
// What is NOT redacted: provider ids (claude/codex/…), model ids, money, tokens,
// dates — none are PII and the receipt is meaningless without them.

import os from 'node:os';
import type { ReceiptModel } from './model.js';

const PLACEHOLDER = '‹redacted›';

export interface RedactOptions {
	/** true → no-op (reveal everything). */
	reveal?: boolean;
	/** injectable env for testing (defaults to process.env). */
	env?: NodeJS.ProcessEnv;
	/** injectable hostname for testing. */
	hostname?: string;
	/** injectable username for testing. */
	username?: string;
	/** injectable home dir for testing. */
	homedir?: string;
}

/** Build the list of secret tokens to scrub from free text. */
function secretsFor(opts: RedactOptions): string[] {
	const env = opts.env ?? process.env;
	const secrets = new Set<string>();

	const username =
		opts.username ?? env.USER ?? env.USERNAME ?? safeUserInfoUsername();
	if (username) secrets.add(username);

	const host = opts.hostname ?? safeHostname();
	if (host) {
		secrets.add(host);
		// also the short form before the first dot (e.g. "kinto" of "kinto.local")
		const short = host.split('.')[0];
		if (short && short !== host) secrets.add(short);
	}

	const home = opts.homedir ?? safeHomedir();
	if (home) {
		secrets.add(home);
		// the final segment of $HOME is usually the username
		const seg = home.split('/').filter(Boolean).slice(-1)[0];
		if (seg) secrets.add(seg);
	}

	// Longest first so we don't leave a fragment of a longer secret behind.
	return [...secrets].filter((s) => s.length > 0).sort((a, b) => b.length - a.length);
}

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

/** Escape a string for use inside a RegExp. */
function escapeRe(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Redact a free-text string: collapse absolute paths to a placeholder/basename,
 * then scrub any remaining secret tokens (username/host).
 */
function redactText(text: string, secrets: string[]): string {
	if (!text) return text;
	let out = text;

	// Absolute *nix paths and ~-paths → basename (last segment) so we keep some
	// signal (the file/project name) while dropping every interior segment that
	// might carry a username/host/project. Privacy bias is OVER-redaction:
	//
	// - Anchored on `/` or `~`, then segments allowed to contain ANY char except a
	//   newline or `/` (INCLUDING spaces, `@`, `(`, `)`, `+`, `#`, `:` …). The old
	//   `[\w.\- ]` class truncated at the first unsupported char and leaked the
	//   tail — a real leak. This consumes the whole path instead.
	// - `(?:\/[^\n\r/]*)+` requires at least one MORE separator, so a lone slash in
	//   prose (e.g. "a/b", "and/or") is left untouched; only multi-segment paths
	//   collapse. Each `[^\n\r/]*` is bounded by the `/` separators, so there is no
	//   overlapping unbounded quantifier → no catastrophic backtracking.
	out = out.replace(/(?:~|\/)[^\n\r/]*(?:\/[^\n\r/]*)+/g, (m) => {
		const base = m.split('/').filter(Boolean).slice(-1)[0];
		return base ? base.trim() : PLACEHOLDER;
	});

	for (const s of secrets) {
		out = out.replace(new RegExp(escapeRe(s), 'g'), PLACEHOLDER);
	}
	return out;
}

/**
 * Redact the receipt model. Pure: returns a NEW model; never mutates the input.
 * No-op when `reveal` is true.
 *
 * Note: the current ReceiptModel surface carries no usernames/hostnames/paths/
 * project names in its rendered fields (line items are provider+model+money+
 * tokens; the footer is canned personality copy). Redaction therefore acts as a
 * guarantee/guard: it scrubs every free-text field so that if a future field
 * ever carries an env-derived value, it is caught here by default. The leak test
 * injects adversarial values into the free-text fields and asserts they're gone.
 */
export function redactReceipt(model: ReceiptModel, opts: RedactOptions = {}): ReceiptModel {
	if (opts.reveal) return model;
	const secrets = secretsFor(opts);

	return {
		...model,
		wordmark: redactText(model.wordmark, secrets),
		periodLabel: redactText(model.periodLabel, secrets),
		footer: redactText(model.footer, secrets),
		ref: redactText(model.ref, secrets),
		// providers come straight from --provider argv, so a value like
		// `--provider "$USER"` would otherwise echo unredacted into the header
		// (text + PNG). Scrub each one.
		providers: model.providers ? model.providers.map((p) => redactText(p, secrets)) : null,
		// line items: model/provider ids are not PII, but scrub the label defensively
		lineItems: model.lineItems.map((it) => ({
			...it,
			modelLabel: redactText(it.modelLabel, secrets)
		})),
		coupons: model.coupons.map((c) => ({
			...c,
			modelLabel: redactText(c.modelLabel, secrets)
		}))
	};
}

export { PLACEHOLDER };
