// redactWrapped — OPT-IN scrub over the WrappedModel, reusing the receipt's
// redaction semantics (secretsFor + redactText) so the two surfaces scrub
// username/host/paths identically. Runs BEFORE every render path (text/json/png).
//
// OPT-IN: a no-op unless `redact` is true (the default shows the user's own real
// details — it's their local data). The most sensitive field is the top project's
// `display` (a project/repo name derived from a local path); it is scrubbed here.

import { redactText, secretsFor, type RedactOptions } from '../receipt/redact.js';
import type { WrappedModel } from './model.js';

/**
 * Redact the wrapped model. Pure: returns a NEW model; never mutates the input.
 * A no-op unless `opts.redact` is true (default: show real details).
 */
export function redactWrapped(model: WrappedModel, opts: RedactOptions = {}): WrappedModel {
	if (!opts.redact) return model;
	const secrets = secretsFor(opts);

	return {
		...model,
		account: model.account ? redactText(model.account, secrets) : model.account,
		wordmark: redactText(model.wordmark, secrets),
		monthLabel: redactText(model.monthLabel, secrets),
		footer: redactText(model.footer, secrets),
		ref: redactText(model.ref, secrets),
		// The top project's display name can carry a local project/repo string → scrub it.
		topProject: model.topProject
			? { ...model.topProject, display: redactText(model.topProject.display, secrets) }
			: model.topProject,
		// Model label is normally not PII, but a custom/unknown id could carry a local
		// endpoint or project string — scrub defensively.
		topModel: model.topModel
			? { ...model.topModel, modelLabel: redactText(model.topModel.modelLabel, secrets) }
			: model.topModel
	};
}
