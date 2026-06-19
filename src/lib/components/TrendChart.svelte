<script lang="ts">
	// Dense, always-on stacked-by-model spend trend on a uPlot CANVAS.
	// - one uPlot instance, never recreated on data change (setData only)
	// - ResizeObserver -> setSize (debounced)
	// - drag-select to zoom (re-aggregates via a callback), reset affordance
	// - visually-hidden data-table alternative for screen readers (canvas has no DOM)
	import { onMount, untrack } from 'svelte';
	import uPlot from 'uplot';
	import 'uplot/dist/uPlot.min.css';
	import { modelHex, modelLabel, money, fmtPeriodKey } from '$lib/format';
	import type { PeriodBucket } from '$lib/aggregate';

	let {
		buckets,
		models,
		onZoom,
		onPick,
		zoomed = false,
		onReset
	}: {
		buckets: PeriodBucket[];
		models: string[]; // stacking order (cost desc); first = bottom
		onZoom: (fromDay: string, toDay: string) => void;
		onPick: (bucket: PeriodBucket) => void;
		zoomed?: boolean;
		onReset: () => void;
	} = $props();

	let el: HTMLDivElement;
	let chart: uPlot | null = null;
	let ro: ResizeObserver | null = null;
	let resizeTimer: ReturnType<typeof setTimeout> | null = null;

	const css = (v: string) => v; // colors already resolved via modelHex

	function buildData(): uPlot.AlignedData {
		const xs = buckets.map((b) => bucketTs(b));
		// stacked: each model series is cumulative sum for a filled-area stack
		const series: number[][] = [];
		let running = new Array(buckets.length).fill(0);
		for (const m of models) {
			const next = buckets.map((b, i) => running[i] + (b.byModel.get(m)?.cost ?? 0));
			series.push(next);
			running = next;
		}
		return [xs, ...series] as unknown as uPlot.AlignedData;
	}

	function bucketTs(b: PeriodBucket): number {
		const [y, mo, d] = b.startDay.split('-').map(Number);
		return Date.UTC(y, mo - 1, d) / 1000; // uPlot wants seconds
	}

	function makeOpts(width: number, height: number): uPlot.Options {
		const seriesOpts: uPlot.Series[] = [
			{ label: 'date' },
			...models.map((m, i) => ({
				label: modelLabel(m),
				stroke: modelHex(m),
				width: 1,
				// stacked bands: fill between this series and the one below it
				fill: hexA(modelHex(m), 0.55),
				points: { show: false },
				// draw as area to the previous stacked series
				band: i > 0
			}))
		];

		return {
			width,
			height,
			pxAlign: false,
			cursor: {
				drag: { x: true, y: false, setScale: false },
				points: { show: false }
			},
			scales: { x: { time: true }, y: { range: (_u, _min, max) => [0, max * 1.05] } },
			axes: [
				{
					stroke: css('var(--fg-dim)'),
					grid: { stroke: 'rgba(255,255,255,0.04)', width: 1 },
					ticks: { stroke: 'rgba(255,255,255,0.08)' }
				},
				{
					stroke: css('var(--fg-dim)'),
					grid: { stroke: 'rgba(255,255,255,0.04)', width: 1 },
					ticks: { stroke: 'rgba(255,255,255,0.08)' },
					values: (_u, vals) => vals.map((v) => (v >= 1 ? `$${Math.round(v)}` : `$${v.toFixed(1)}`)),
					size: 52
				}
			],
			series: seriesOpts,
			bands: models.map((_m, i) => ({ series: [i + 1, i] as [number, number] })).slice(1),
			legend: { show: false },
			hooks: {
				setSelect: [
					(u) => {
						const { left, width: w } = u.select;
						if (w <= 4) return; // ignore taps
						const minX = u.posToVal(left, 'x');
						const maxX = u.posToVal(left + w, 'x');
						u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
						const from = dayFromTs(minX * 1000);
						const to = dayFromTs(maxX * 1000);
						onZoom(from, to);
					}
				],
				ready: [
					(u) => {
						// click a point/region -> pick the nearest bucket for drill-down
						u.over.addEventListener('click', () => {
							const idx = u.cursor.idx;
							if (idx != null && buckets[idx]) onPick(buckets[idx]);
						});
					}
				]
			}
		};
	}

	function dayFromTs(ms: number): string {
		const d = new Date(ms);
		return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
	}

	function hexA(hex: string, a: number): string {
		const h = hex.replace('#', '');
		const r = parseInt(h.slice(0, 2), 16);
		const g = parseInt(h.slice(2, 4), 16);
		const b = parseInt(h.slice(4, 6), 16);
		return `rgba(${r},${g},${b},${a})`;
	}

	onMount(() => {
		const width = el.clientWidth || 600;
		const height = el.clientHeight || 280;
		chart = new uPlot(makeOpts(width, height), buildData(), el);

		ro = new ResizeObserver(() => {
			if (resizeTimer) clearTimeout(resizeTimer);
			resizeTimer = setTimeout(() => {
				if (chart && el.clientWidth > 0) {
					chart.setSize({ width: el.clientWidth, height: el.clientHeight || 280 });
				}
			}, 120);
		});
		ro.observe(el);

		return () => {
			ro?.disconnect();
			if (resizeTimer) clearTimeout(resizeTimer);
			chart?.destroy();
			chart = null;
		};
	});

	// rebuild when the model set (series identity) changes; otherwise setData only.
	let modelSig = $derived(models.join('|'));
	let lastSig = '';

	$effect(() => {
		// track buckets + modelSig
		void buckets;
		void modelSig;
		untrack(() => {
			if (!chart) return;
			if (modelSig !== lastSig) {
				lastSig = modelSig;
				const width = el.clientWidth || 600;
				const height = el.clientHeight || 280;
				chart.destroy();
				chart = new uPlot(makeOpts(width, height), buildData(), el);
			} else {
				chart.setData(buildData());
			}
		});
	});

	// accessible data-table rows (top model per bucket + total)
	let tableRows = $derived(
		buckets.map((b) => ({
			key: b.key,
			label: fmtPeriodKey(b.key),
			cost: b.cost,
			top: [...b.byModel.entries()].sort((a, c) => c[1].cost - a[1].cost)[0]
		}))
	);
</script>

<div class="trend">
	<div class="trend-head">
		<span class="trend-title">Spend over time, stacked by model</span>
		{#if zoomed}
			<button class="reset" onclick={onReset}>← Reset zoom</button>
		{/if}
	</div>
	<div class="chart" bind:this={el}></div>
	<p class="hint">Drag to zoom · click a bar to drill in</p>

	<table class="visually-hidden">
		<caption>Spend by period, stacked by model</caption>
		<thead>
			<tr><th>Period</th><th>Spend (USD)</th><th>Top model</th></tr>
		</thead>
		<tbody>
			{#each tableRows as r (r.key)}
				<tr>
					<td>{r.label}</td>
					<td>{money(r.cost)}</td>
					<td>{r.top ? `${modelLabel(r.top[0])} ${money(r.top[1].cost)}` : '—'}</td>
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
	.reset {
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0.25rem 0.7rem;
		font-size: 0.78rem;
		color: var(--fg-muted);
	}
	.reset:hover {
		color: var(--fg);
		border-color: var(--border-strong);
	}
	.chart {
		width: 100%;
		height: 280px;
		min-height: 280px;
	}
	.hint {
		margin: 0;
		font-size: 0.72rem;
		color: var(--fg-dim);
	}
</style>
