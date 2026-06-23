<script lang="ts">
	// Persistent prev/next-day navigator + jump-to-day + a "viewing <day> ✕" mode chip.
	// When no day is pinned (focusedDay == null) it offers a "Focus a day" entry that pins
	// the latest banked day; once pinned, the arrows step ±1 day (clamped, no wrap) and the
	// ✕ exits back to rolling-period mode. Bounds come from earliest/latest.
	import { fmtDay } from '$lib/format';

	let {
		focusedDay,
		earliest,
		latest,
		onStep,
		onJump,
		onClear,
		onEnter
	}: {
		focusedDay: string | null;
		earliest: string | null;
		latest: string | null;
		onStep: (delta: number) => void;
		onJump: (day: string) => void;
		onClear: () => void;
		/** enter pinned mode from rolling-period mode (pins the latest day) */
		onEnter: () => void;
	} = $props();

	let atEarliest = $derived(focusedDay != null && earliest != null && focusedDay <= earliest);
	let atLatest = $derived(focusedDay != null && latest != null && focusedDay >= latest);
	let canFocus = $derived(earliest != null && latest != null);
</script>

<div class="daynav" aria-label="Day navigator">
	{#if focusedDay == null}
		<button class="enter" type="button" disabled={!canFocus} onclick={onEnter}>
			Focus a day →
		</button>
	{:else}
		<div class="pinned">
			<button
				class="arrow"
				type="button"
				aria-label="Previous day"
				disabled={atEarliest}
				onclick={() => onStep(-1)}
			>‹</button>
			<span class="chip">
				<span class="chip-label">Viewing</span>
				<span class="chip-day num">{fmtDay(focusedDay)}</span>
				<button class="chip-x" type="button" aria-label="Exit focused day" onclick={onClear}>✕</button>
			</span>
			<button
				class="arrow"
				type="button"
				aria-label="Next day"
				disabled={atLatest}
				onclick={() => onStep(1)}
			>›</button>
			<label class="jump">
				<span class="visually-hidden">Jump to day</span>
				<input
					type="date"
					value={focusedDay}
					min={earliest ?? undefined}
					max={latest ?? undefined}
					onchange={(e) => onJump((e.currentTarget as HTMLInputElement).value)}
				/>
			</label>
		</div>
	{/if}
</div>

<style>
	.daynav {
		display: flex;
		align-items: center;
	}
	.pinned {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		flex-wrap: wrap;
	}
	.enter,
	.arrow {
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 999px;
		color: var(--fg-muted);
		min-height: 36px;
		cursor: pointer;
	}
	.enter {
		padding: 0.35rem 0.9rem;
		font-size: 0.78rem;
	}
	.arrow {
		width: 36px;
		font-size: 1.1rem;
		line-height: 1;
		padding: 0;
	}
	.enter:hover:not(:disabled),
	.arrow:hover:not(:disabled) {
		color: var(--fg);
	}
	.arrow:disabled,
	.enter:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.arrow:focus-visible,
	.enter:focus-visible,
	.chip-x:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		background: color-mix(in srgb, var(--accent) 16%, var(--surface-2));
		border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border));
		border-radius: 999px;
		padding: 0.3rem 0.4rem 0.3rem 0.75rem;
		font-size: 0.78rem;
		color: var(--fg);
	}
	.chip-label {
		color: var(--fg-dim);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		font-size: 0.64rem;
	}
	.chip-x {
		background: transparent;
		border: 0;
		color: var(--fg-muted);
		cursor: pointer;
		font-size: 0.8rem;
		line-height: 1;
		padding: 0.15rem 0.3rem;
		border-radius: 999px;
	}
	.chip-x:hover {
		color: var(--fg);
		background: color-mix(in srgb, var(--fg) 12%, transparent);
	}
	.jump input {
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 8px;
		color: var(--fg);
		padding: 0.3rem 0.45rem;
		font-family: var(--font-num);
		font-size: 0.76rem;
		color-scheme: dark;
		min-height: 36px;
	}
</style>
