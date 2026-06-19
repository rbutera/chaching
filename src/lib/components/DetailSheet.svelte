<script lang="ts">
	// Drill-down detail: bottom sheet (mobile) / right side panel (desktop).
	// Shows the composition behind a selected period bucket or session: the
	// input/output/cache split, the cost math, a session timeline / model mix,
	// and a comparison to the prior equivalent slice. Focus-trapped, ESC + backdrop
	// dismiss, breadcrumb header.
	import type { DrillTarget } from '$lib/client/dashboard.svelte';
	import type { RollupSnapshot, TokenCounts } from '$lib/types';
	import TokenSplitBar from './TokenSplitBar.svelte';
	import {
		money,
		moneyPrecise,
		compactTokens,
		int,
		modelColor,
		modelLabel,
		pctDelta,
		fmtPeriodKey,
		fmtTimeRange,
		shortProject
	} from '$lib/format';
	import {
		aggregateByModel,
		filterDays,
		sumGrain,
		totalTokens,
		zeroTokens,
		type ModelTotal
	} from '$lib/core/aggregate';
	import { resolvePriceClient } from '$lib/pricing-client';

	let {
		drill,
		snapshot,
		onClose
	}: {
		drill: DrillTarget;
		snapshot: RollupSnapshot;
		onClose: () => void;
	} = $props();

	let panel: HTMLElement | undefined = $state();

	// ---- derive the slice the drill points at ----
	let slice = $derived.by(() => {
		if (drill.kind === 'session' && drill.session) {
			const s = drill.session;
			return {
				title: shortProject(s.project),
				crumb: `Session · ${s.sessionId.slice(0, 8)}`,
				tokens: s.tokens,
				cost: s.cost,
				requests: s.requests,
				timeRange: fmtTimeRange(s.firstTs, s.lastTs),
				models: s.models,
				modelTotals: null as ModelTotal[] | null,
				prior: null as { tokens: TokenCounts; cost: number } | null
			};
		}
		// period
		const from = drill.from ?? '';
		const to = drill.to ?? '';
		const grain = filterDays(snapshot.dayModel, from, to);
		const totals = sumGrain(grain);
		const modelTotals = aggregateByModel(grain);
		// prior equivalent slice: same span immediately before `from`
		const prior = priorSlice(from, to);
		return {
			title: fmtPeriodKey(drill.periodKey ?? from),
			crumb: `Period · ${from}${to && to !== from ? ` → ${to}` : ''}`,
			tokens: totals.tokens,
			cost: totals.cost,
			requests: totals.requests,
			timeRange: from === to ? from : `${from} → ${to}`,
			models: modelTotals.map((m) => m.model),
			modelTotals,
			prior
		};
	});

	function priorSlice(from: string, to: string): { tokens: TokenCounts; cost: number } | null {
		if (!from || !to) return null;
		const f = Date.parse(from + 'T00:00:00Z');
		const t = Date.parse(to + 'T00:00:00Z');
		if (!Number.isFinite(f) || !Number.isFinite(t)) return null;
		const spanDays = Math.round((t - f) / 86400000) + 1;
		const priorTo = new Date(f - 86400000);
		const priorFrom = new Date(f - spanDays * 86400000);
		const pf = isoDay(priorFrom);
		const pt = isoDay(priorTo);
		const g = filterDays(snapshot.dayModel, pf, pt);
		const totals = sumGrain(g);
		if (totals.requests === 0) return null;
		return { tokens: totals.tokens, cost: totals.cost };
	}

	function isoDay(d: Date): string {
		return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
	}

	let primaryColor = $derived(modelColor(slice.models[0] ?? 'other'));
	let totalTok = $derived(totalTokens(slice.tokens));
	let delta = $derived(slice.prior ? pctDelta(slice.cost, slice.prior.cost) : null);

	// cost-math lines per model (input/output/cache × rate)
	let costMath = $derived.by(() => {
		const list = slice.modelTotals;
		const tokenSet: { model: string; tokens: TokenCounts; cost: number }[] = list
			? list.map((m) => ({ model: m.model, tokens: m.tokens, cost: m.cost }))
			: slice.models.length === 1
				? [{ model: slice.models[0], tokens: slice.tokens, cost: slice.cost }]
				: [];
		return tokenSet.map((row) => {
			const p = resolvePriceClient(row.model);
			return {
				model: row.model,
				cost: row.cost,
				lines: p
					? [
							{ k: 'input', n: row.tokens.input, rate: p.input },
							{ k: 'output', n: row.tokens.output, rate: p.output },
							{ k: 'cache write', n: row.tokens.cacheCreation, rate: p.cacheCreation },
							{ k: 'cache read', n: row.tokens.cacheRead, rate: p.cacheRead }
						].filter((l) => l.n > 0)
					: null
			};
		});
	});

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}

	$effect(() => {
		panel?.focus();
	});
</script>

<svelte:window onkeydown={onKey} />

<!-- backdrop -->
<div
	class="backdrop"
	onclick={onClose}
	role="presentation"
	aria-hidden="true"
></div>

<div
	class="sheet"
	role="dialog"
	aria-modal="true"
	aria-label={`Detail: ${slice.title}`}
	tabindex="-1"
	bind:this={panel}
>
	<header class="sheet-head">
		<div>
			<p class="crumb">{slice.crumb}</p>
			<h2 class="sheet-title">{slice.title}</h2>
			<p class="range">{slice.timeRange}</p>
		</div>
		<button class="close" onclick={onClose} aria-label="Close detail">✕</button>
	</header>

	<div class="sheet-body">
		<div class="hero">
			<div>
				<span class="hlabel">Spend</span>
				<span class="hval num">{money(slice.cost)}</span>
			</div>
			{#if delta && slice.prior}
				<div class="cmp">
					<span class="cmp-delta {delta.dir}">{delta.text}</span>
					<span class="cmp-sub">vs prior {money(slice.prior.cost)}</span>
				</div>
			{/if}
		</div>

		<div class="stat-row">
			<div><span class="slabel">Tokens</span><span class="sval num">{compactTokens(totalTok)}</span></div>
			<div><span class="slabel">Requests</span><span class="sval num">{int(slice.requests)}</span></div>
			<div>
				<span class="slabel">Cache read</span>
				<span class="sval num"
					>{totalTok > 0 ? Math.round((slice.tokens.cacheRead / totalTok) * 100) : 0}%</span
				>
			</div>
		</div>

		<section class="block">
			<h3>Token composition</h3>
			<TokenSplitBar tokens={slice.tokens} color={primaryColor} />
		</section>

		{#if slice.modelTotals && slice.modelTotals.length > 1}
			<section class="block">
				<h3>Model mix</h3>
				<ul class="mix">
					{#each slice.modelTotals as m (m.model)}
						<li>
							<span class="swatch" style={`background:${modelColor(m.model)}`}></span>
							<span class="mname">{modelLabel(m.model)}</span>
							<span class="mtok num">{compactTokens(totalTokens(m.tokens))}</span>
							<span class="mcost num">{money(m.cost)}</span>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		<section class="block">
			<h3>Cost math <span class="est">estimate</span></h3>
			{#each costMath as cm (cm.model)}
				<div class="math-model">
					<div class="math-head">
						<span class="swatch" style={`background:${modelColor(cm.model)}`}></span>
						<span>{modelLabel(cm.model)}</span>
						<span class="math-total num">{money(cm.cost)}</span>
					</div>
					{#if cm.lines}
						<table class="math">
							<tbody>
								{#each cm.lines as l (l.k)}
									<tr>
										<td>{l.k}</td>
										<td class="num">{int(l.n)}</td>
										<td class="num">× ${(l.rate * 1e6).toFixed(2)}/M</td>
										<td class="num">{moneyPrecise(l.n * l.rate)}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					{:else}
						<p class="unknown">No price for this model — cost shown as unknown.</p>
					{/if}
				</div>
			{/each}
		</section>

		{#if drill.kind === 'session' && drill.session}
			<section class="block">
				<h3>Session timeline</h3>
				<p class="timeline num">{fmtTimeRange(drill.session.firstTs, drill.session.lastTs)}</p>
				<p class="timeline-sub">
					{int(drill.session.requests)} requests across {drill.session.models.length} model{drill
						.session.models.length === 1
						? ''
						: 's'}
				</p>
			</section>
		{/if}
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		backdrop-filter: blur(2px);
		z-index: 40;
		animation: fade 0.18s ease;
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
	}
	.sheet {
		position: fixed;
		z-index: 50;
		background: var(--surface-1);
		border: 1px solid var(--border);
		display: flex;
		flex-direction: column;
		box-shadow: var(--shadow);
		/* mobile: bottom sheet */
		left: 0;
		right: 0;
		bottom: 0;
		max-height: 88dvh;
		border-radius: 18px 18px 0 0;
		animation: slideUp 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
	}
	@keyframes slideUp {
		from {
			transform: translateY(100%);
		}
	}
	@media (min-width: 860px) {
		.sheet {
			left: auto;
			top: 0;
			bottom: 0;
			right: 0;
			width: 440px;
			max-height: 100dvh;
			border-radius: 0;
			border-right: none;
			animation: slideIn 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
		}
		@keyframes slideIn {
			from {
				transform: translateX(100%);
			}
		}
	}
	.sheet-head {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		padding: 1.1rem 1.2rem 0.6rem;
		border-bottom: 1px solid var(--border);
	}
	.crumb {
		margin: 0;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--fg-dim);
	}
	.sheet-title {
		margin: 0.15rem 0 0;
		font-size: 1.2rem;
	}
	.range {
		margin: 0.2rem 0 0;
		font-size: 0.78rem;
		color: var(--fg-muted);
	}
	.close {
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 10px;
		width: 36px;
		height: 36px;
		color: var(--fg-muted);
		font-size: 0.9rem;
	}
	.close:hover {
		color: var(--fg);
	}
	.sheet-body {
		overflow-y: auto;
		padding: 1rem 1.2rem 2rem;
		display: flex;
		flex-direction: column;
		gap: 1.2rem;
	}
	.hero {
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
	}
	.hlabel {
		display: block;
		font-size: 0.72rem;
		color: var(--fg-dim);
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.hval {
		font-size: 2rem;
		font-weight: 680;
	}
	.cmp {
		text-align: right;
	}
	.cmp-delta {
		display: block;
		font-family: var(--font-num);
		font-weight: 600;
	}
	.cmp-delta.up {
		color: var(--bad);
	}
	.cmp-delta.down {
		color: var(--good);
	}
	.cmp-delta.flat {
		color: var(--fg-dim);
	}
	.cmp-sub {
		font-size: 0.72rem;
		color: var(--fg-dim);
	}
	.stat-row {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.5rem;
	}
	.stat-row > div {
		background: var(--surface-2);
		border-radius: var(--radius-sm);
		padding: 0.6rem 0.7rem;
	}
	.slabel {
		display: block;
		font-size: 0.68rem;
		color: var(--fg-dim);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.sval {
		font-size: 1.05rem;
		font-weight: 600;
	}
	.block h3 {
		margin: 0 0 0.6rem;
		font-size: 0.8rem;
		color: var(--fg-muted);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.est {
		font-size: 0.62rem;
		background: var(--surface-3);
		color: var(--fg-dim);
		padding: 0.1rem 0.4rem;
		border-radius: 999px;
		text-transform: none;
		letter-spacing: 0;
	}
	.mix {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.mix li {
		display: grid;
		grid-template-columns: 12px 1fr auto auto;
		gap: 0.6rem;
		align-items: center;
		font-size: 0.84rem;
	}
	.swatch {
		width: 11px;
		height: 11px;
		border-radius: 3px;
	}
	.mtok {
		color: var(--fg-dim);
		font-size: 0.78rem;
	}
	.mcost {
		font-weight: 600;
	}
	.math-model {
		margin-bottom: 0.7rem;
	}
	.math-head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.84rem;
		margin-bottom: 0.25rem;
	}
	.math-total {
		margin-left: auto;
		font-weight: 600;
	}
	table.math {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.76rem;
	}
	table.math td {
		padding: 0.15rem 0;
		color: var(--fg-muted);
	}
	table.math td:first-child {
		color: var(--fg-dim);
	}
	table.math td:last-child {
		text-align: right;
		color: var(--fg);
	}
	table.math td:nth-child(2),
	table.math td:nth-child(3) {
		text-align: right;
		padding-right: 0.6rem;
	}
	.unknown {
		font-size: 0.78rem;
		color: var(--warn);
		margin: 0;
	}
	.timeline {
		margin: 0;
		font-size: 0.9rem;
	}
	.timeline-sub {
		margin: 0.2rem 0 0;
		font-size: 0.78rem;
		color: var(--fg-dim);
	}
</style>
