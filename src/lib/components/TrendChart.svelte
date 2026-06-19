<script lang="ts">
	// Hand-rolled SVG stacked bar chart: one vertical bar per day in the period
	// window, each bar stacked + color-coded by model (segment height = that
	// model's cost in the day, full bar = the day's total). Matches the pure-SVG
	// d3-scale style of Donut/Sparkline (zero rAF, no canvas).
	//
	// The SVG is purely visual (aria-hidden); a row of real, absolutely-positioned
	// <button>s overlays it so each bar is keyboard-operable (Enter/Space drill
	// into the day) and exposed to assistive tech with a descriptive aria-label.
	// The visually-hidden data table is the non-visual fallback representation.
	import { scaleLinear } from 'd3-scale';
	import { modelColor, modelLabel, money, fmtDay } from '$lib/format';
	import type { PeriodBucket } from '$lib/core/aggregate';

	let {
		buckets,
		models,
		onPick
	}: {
		buckets: PeriodBucket[];
		models: string[]; // stacking order (cost desc); first = bottom
		onPick: (bucket: PeriodBucket) => void;
	} = $props();

	const W = 640;
	const H = 280;
	const PAD = { top: 12, right: 8, bottom: 28, left: 44 };

	let plotW = $derived(W - PAD.left - PAD.right);
	let plotH = $derived(H - PAD.top - PAD.bottom);

	let maxCost = $derived(Math.max(1, ...buckets.map((b) => b.cost)));
	let y = $derived(scaleLinear().domain([0, maxCost]).range([plotH, 0]).nice());
	let yTicks = $derived(y.ticks(4));

	// per-bar geometry, in SVG user units (the overlay maps these to % of W/H).
	let bars = $derived.by(() => {
		const n = buckets.length;
		if (n === 0) return [];
		const band = plotW / n;
		const gap = Math.min(band * 0.22, 8);
		const barW = Math.max(1, band - gap);
		return buckets.map((b, i) => {
			const x = PAD.left + i * band + gap / 2;
			let acc = 0;
			const segs = models
				.map((m) => ({ model: m, cost: b.byModel.get(m)?.cost ?? 0 }))
				.filter((s) => s.cost > 0)
				.map((s) => {
					const y1 = PAD.top + y(acc);
					acc += s.cost;
					const y0 = PAD.top + y(acc);
					return { model: s.model, cost: s.cost, y: y0, h: Math.max(0, y1 - y0), color: modelColor(s.model) };
				});
			return { bucket: b, x, w: barW, segs, total: b.cost };
		});
	});

	let labelEvery = $derived(Math.max(1, Math.ceil(buckets.length / 8)));

	let hovered = $state<number | null>(null);
	let tip = $derived(hovered != null ? bars[hovered] : null);
	let tipRows = $derived(tip ? [...tip.segs].sort((a, b) => b.cost - a.cost) : []);

	const pctX = (v: number) => (v / W) * 100;
	const pctY = (v: number) => (v / H) * 100;
</script>

<div class="trend">
	<div class="trend-head">
		<span class="trend-title">Spend by day, stacked by model</span>
	</div>

	<div class="chart-wrap">
		<svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" class="chart" aria-hidden="true">
			{#each yTicks as t (t)}
				<line
					x1={PAD.left}
					x2={W - PAD.right}
					y1={PAD.top + y(t)}
					y2={PAD.top + y(t)}
					stroke="rgba(255,255,255,0.05)"
					stroke-width="1"
				/>
				<text x={PAD.left - 6} y={PAD.top + y(t) + 3} text-anchor="end" class="axis-lbl">
					{t >= 1 ? `$${Math.round(t)}` : `$${t.toFixed(1)}`}
				</text>
			{/each}

			{#each bars as bar, i (bar.bucket.key)}
				<g class="bar-seg" class:dim={hovered != null && hovered !== i}>
					{#each bar.segs as s (s.model)}
						<rect x={bar.x} y={s.y} width={bar.w} height={s.h} fill={s.color} rx="1" />
					{/each}
				</g>
			{/each}

			{#each bars as bar, i (bar.bucket.key)}
				{#if i % labelEvery === 0}
					<text x={bar.x + bar.w / 2} y={H - 10} text-anchor="middle" class="axis-lbl">
						{fmtDay(bar.bucket.startDay)}
					</text>
				{/if}
			{/each}
		</svg>

		<!-- real <button> overlay: one per bar, keyboard + AT accessible -->
		<div class="bar-buttons">
			{#each bars as bar, i (bar.bucket.key)}
				<button
					type="button"
					class="bar-btn"
					style={`left:${pctX(bar.x)}%;width:${pctX(bar.w)}%;top:${pctY(PAD.top)}%;height:${pctY(plotH)}%`}
					aria-label={`${fmtDay(bar.bucket.startDay)}: ${money(bar.total)}${bar.segs.length ? ` across ${bar.segs.length} model${bar.segs.length === 1 ? '' : 's'}` : ' (no spend)'}. Open the day's detail.`}
					onclick={() => onPick(bar.bucket)}
					onmouseenter={() => (hovered = i)}
					onmouseleave={() => (hovered = null)}
					onfocus={() => (hovered = i)}
					onblur={() => (hovered = null)}
				></button>
			{/each}
		</div>

		{#if tip}
			<div
				class="tooltip"
				style={`left:${pctX(tip.x + tip.w / 2)}%`}
				class:flip={tip.x + tip.w / 2 > W * 0.62}
			>
				<p class="tip-head">{fmtDay(tip.bucket.startDay)} · <span class="num">{money(tip.total)}</span></p>
				{#if tipRows.length}
					<ul>
						{#each tipRows as r (r.model)}
							<li>
								<span class="tip-sw" style={`background:${modelColor(r.model)}`}></span>
								<span class="tip-lbl">{modelLabel(r.model)}</span>
								<span class="tip-val num">{money(r.cost)}</span>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="tip-empty">No spend</p>
				{/if}
			</div>
		{/if}
	</div>

	<p class="hint">Click a bar to open that day's detail</p>

	<table class="visually-hidden">
		<caption>Spend by day, stacked by model</caption>
		<thead>
			<tr><th>Day</th><th>Spend (USD)</th><th>Top model</th></tr>
		</thead>
		<tbody>
			{#each buckets as b (b.key)}
				{@const top = [...b.byModel.entries()].sort((a, c) => c[1].cost - a[1].cost)[0]}
				<tr>
					<td>{fmtDay(b.startDay)}</td>
					<td>{money(b.cost)}</td>
					<td>{top ? `${modelLabel(top[0])} ${money(top[1].cost)}` : '—'}</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	.trend {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.trend-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.trend-title {
		font-size: 0.8rem;
		color: var(--fg-muted);
	}
	.chart-wrap {
		position: relative;
		width: 100%;
		height: 280px;
	}
	.chart {
		width: 100%;
		height: 100%;
		display: block;
		overflow: visible;
	}
	.axis-lbl {
		fill: var(--fg-dim);
		font-size: 10px;
		font-family: var(--font-num);
	}
	.bar-seg {
		transition: opacity 0.12s;
	}
	.bar-seg.dim {
		opacity: 0.5;
	}
	.bar-buttons {
		position: absolute;
		inset: 0;
	}
	.bar-btn {
		position: absolute;
		background: transparent;
		border: 0;
		padding: 0;
		margin: 0;
		cursor: pointer;
		border-radius: 2px;
	}
	.bar-btn:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
	.tooltip {
		position: absolute;
		top: 4px;
		transform: translateX(-50%);
		background: var(--surface-3);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		padding: 0.5rem 0.6rem;
		box-shadow: var(--shadow);
		pointer-events: none;
		min-width: 150px;
		max-width: 220px;
		z-index: 5;
	}
	.tooltip.flip {
		transform: translateX(-90%);
	}
	.tip-head {
		margin: 0 0 0.35rem;
		font-size: 0.78rem;
		color: var(--fg);
		font-weight: 600;
	}
	.tooltip ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.tooltip li {
		display: grid;
		grid-template-columns: 10px 1fr auto;
		gap: 0.4rem;
		align-items: center;
		font-size: 0.74rem;
	}
	.tip-sw {
		width: 9px;
		height: 9px;
		border-radius: 2px;
	}
	.tip-lbl {
		color: var(--fg-muted);
	}
	.tip-val {
		color: var(--fg);
	}
	.tip-empty {
		margin: 0;
		font-size: 0.72rem;
		color: var(--fg-dim);
	}
	.hint {
		margin: 0;
		font-size: 0.72rem;
		color: var(--fg-dim);
	}
</style>
