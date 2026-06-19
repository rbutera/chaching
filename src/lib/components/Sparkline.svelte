<script lang="ts">
	// Tiny SVG sparkline using d3-shape as a pure path helper. SVG = zero CPU at
	// rest (no rAF loop). Renders an area + line for a series of values.
	import { line as d3line, area as d3area, curveMonotoneX } from 'd3-shape';
	import { scaleLinear } from 'd3-scale';

	let {
		values,
		width = 120,
		height = 36,
		color = 'var(--accent)',
		ariaLabel = 'trend sparkline'
	}: {
		values: number[];
		width?: number;
		height?: number;
		color?: string;
		ariaLabel?: string;
	} = $props();

	const pad = 2;

	let paths = $derived.by(() => {
		const n = values.length;
		if (n === 0) return { line: '', area: '' };
		const xs = scaleLinear()
			.domain([0, Math.max(1, n - 1)])
			.range([pad, width - pad]);
		const max = Math.max(...values, 0);
		const min = Math.min(...values, 0);
		const ys = scaleLinear()
			.domain([min, max === min ? max + 1 : max])
			.range([height - pad, pad]);

		const l = d3line<number>()
			.x((_d, i) => xs(i))
			.y((d) => ys(d))
			.curve(curveMonotoneX);
		const a = d3area<number>()
			.x((_d, i) => xs(i))
			.y0(height - pad)
			.y1((d) => ys(d))
			.curve(curveMonotoneX);
		return { line: l(values) ?? '', area: a(values) ?? '' };
	});

	const gid = `spark-${Math.random().toString(36).slice(2, 8)}`;
</script>

<svg
	{width}
	{height}
	viewBox={`0 0 ${width} ${height}`}
	role="img"
	aria-label={ariaLabel}
	style="display:block"
>
	<defs>
		<linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
			<stop offset="0%" stop-color={color} stop-opacity="0.28" />
			<stop offset="100%" stop-color={color} stop-opacity="0" />
		</linearGradient>
	</defs>
	{#if paths.area}
		<path d={paths.area} fill={`url(#${gid})`} />
		<path d={paths.line} fill="none" stroke={color} stroke-width="1.6" stroke-linejoin="round" />
	{/if}
</svg>
