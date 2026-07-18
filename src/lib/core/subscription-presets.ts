/**
 * Client-safe subscription plan constants. NO Node imports allowed here — this
 * module is consumed by browser components (SubsidisationCard), so it must stay
 * importable in the client bundle, mirroring the pricing-client.ts discipline.
 * Server config code re-exports these from config.ts.
 */

/** A single selectable subscription preset for a provider. */
export interface SubscriptionPreset {
	/** stable id stored in config (e.g. "corporate", "max-5x", "custom") */
	id: string;
	/** human label for the switcher */
	label: string;
	/** flat monthly fee in USD; ignored for the special `custom` preset (user supplies) */
	monthlyUsd: number;
	/** true for the free-form Custom amount entry (monthlyUsd is a placeholder) */
	custom?: boolean;
}

/**
 * A flat subscription plan for a provider whose API-equivalent cost chaching
 * computes (Claude, Codex). `tier` is a preset id or `"custom"`; `monthlyUsd` is
 * the flat fee actually paid that the API value is subsidised against. $0 (Free)
 * is allowed and handled without divide-by-zero (see subsidisation.ts).
 */
export interface SubscriptionConfig {
	tier: string;
	monthlyUsd: number;
}

/** The Corporate $99 default both subsidised providers fall back to. */
export const DEFAULT_SUBSCRIPTION: SubscriptionConfig = { tier: 'corporate', monthlyUsd: 99 };

/**
 * Static preset tables per subsidised provider. The switcher writes the chosen
 * preset's `id` + `monthlyUsd` (or `custom` + the user's number), so a future
 * preset price change never silently rewrites a persisted fee (design D4).
 */
export const SUBSCRIPTION_PRESETS: {
	claude: SubscriptionPreset[];
	codex: SubscriptionPreset[];
} = {
	claude: [
		{ id: 'free', label: 'Free', monthlyUsd: 0 },
		{ id: 'pro', label: 'Pro', monthlyUsd: 20 },
		{ id: 'max-5x', label: 'Max 5×', monthlyUsd: 100 },
		{ id: 'max-20x', label: 'Max 20×', monthlyUsd: 200 },
		{ id: 'team', label: 'Team Premium', monthlyUsd: 100 },
		{ id: 'corporate', label: 'Corporate', monthlyUsd: 99 },
		{ id: 'custom', label: 'Custom', monthlyUsd: 0, custom: true }
	],
	codex: [
		{ id: 'free', label: 'Free', monthlyUsd: 0 },
		{ id: 'go', label: 'Go', monthlyUsd: 8 },
		{ id: 'plus', label: 'Plus', monthlyUsd: 20 },
		{ id: 'pro-5x', label: 'Pro 5×', monthlyUsd: 100 },
		{ id: 'pro-20x', label: 'Pro 20×', monthlyUsd: 200 },
		{ id: 'corporate', label: 'Corporate', monthlyUsd: 99 },
		{ id: 'custom', label: 'Custom', monthlyUsd: 0, custom: true }
	]
};
