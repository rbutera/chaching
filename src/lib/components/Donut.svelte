<script lang="ts">
	// Per-model donut using d3-shape arc/pie as pure path helpers. SVG, no rAF.
	// Each segment is a button (keyboard-operable, 44px legend alternative below)
	// that scopes the whole dashboard to that model.
	import { pie as d3pie, arc as d3arc } from 'd3-shape';
	import { modelColor, modelLabel, money } from '$lib/format';
	import type { ModelTotal } from '$lib/core/aggregate';

	let {
		models,
		activeFilter,
		onToggle,
		size = 168
	}: {
		models: ModelTotal[];
		activeFilter: Set<string>;
		onToggle: (model: string) => void;
		size?: number;
	} = $props();

	const r = $derived(size / 2);
	const thickness = 26;

	let arcs = $derived.by(() => {
		const data = models.filter((m) => m.cost > 0);
		if (data.length === 0) return [];
		const layout = d3pie<ModelTotal>()
			.value((d) => d.cost)
			.sort(null);
		const gen = d3arc<import('d3-shape').PieArcDatum<ModelTotal>>()
			.innerRadius(r - thickness)
			.outerRadius(r)
			.padAngle(0.02)
			.cornerRadius(3);
		return layout(data).map((d) => ({
			model: d.data.model,
			cost: d.data.cost,
			path: gen(d) ?? '',
			color: modelColor(d.data.model)
		}));
	});

	const total = $derived(models.reduce((a, m) => a + m.cost, 0));
	function isActive(model: string) {
		return activeFilter.size === 0 || activeFilter.has(model);
	}
</script>

<div class="donut-wrap">
	<svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
		<g transform={`translate(${r},${r})`}>
			{#each arcs as a (a.model)}
				<path
					d={a.path}
					fill={a.color}
					opacity={isActive(a.model) ? 1 : 0.28}
					style="cursor:pointer"
					onclick={() => onToggle(a.model)}
					role="presentation"
				/>
			{/each}
		</g>
		<text
			x={r}
			y={r - 4}
			text-anchor="middle"
			fill="var(--fg-muted)"
			font-size="10"
			letter-spacing="0.08em">SPEND</text
		>
		<text
			x={r}
			y={r + 14}
			text-anchor="middle"
			fill="var(--fg)"
			font-size="16"
			font-weight="600"
			class="num">{money(total)}</text
		>
	</svg>

	<ul class="legend" aria-label="Per-model spend; activate to filter">
		{#each models.filter((m) => m.cost > 0) as m (m.model)}
			<li>
				<button
					class="legend-btn"
					class:dim={!isActive(m.model)}
					onclick={() => onToggle(m.model)}
					aria-pressed={activeFilter.has(m.model)}
				>
					<span class="swatch" style={`background:${modelColor(m.model)}`}></span>
					<span class="lbl">{modelLabel(m.model)}</span>
					<span class="val num">{money(m.cost)}</span>
					<span class="pct num">{total > 0 ? Math.round((m.cost / total) * 100) : 0}%</span>
				</button>
			</li>
		{/each}
	</ul>
</div>

<style>
	.donut-wrap {
		display: flex;
		gap: 1rem;
		align-items: center;
		flex-wrap: wrap;
	}
	.legend {
		list-style: none;
		margin: 0;
		padding: 0;
		flex: 1;
		min-width: 180px;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.legend-btn {
		display: grid;
		grid-template-columns: 14px 1fr auto auto;
		gap: 0.5rem;
		align-items: center;
		width: 100%;
		min-height: 36px;
		padding: 0.3rem 0.4rem;
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		text-align: left;
		transition: background 0.15s;
	}
	.legend-btn:hover {
		background: var(--surface-2);
	}
	.legend-btn[aria-pressed='true'] {
		border-color: var(--border-strong);
		background: var(--surface-2);
	}
	.legend-btn.dim {
		opacity: 0.45;
	}
	.swatch {
		width: 11px;
		height: 11px;
		border-radius: 3px;
	}
	.lbl {
		font-size: 0.85rem;
	}
	.val {
		font-size: 0.85rem;
		color: var(--fg);
	}
	.pct {
		font-size: 0.78rem;
		color: var(--fg-dim);
		width: 2.6em;
		text-align: right;
	}
</style>
