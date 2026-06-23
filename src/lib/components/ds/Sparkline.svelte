<script lang="ts" module>
	let sparkSeq = 0;

	export interface SparklineProps {
		values: number[];
		width?: number;
		height?: number;
		/** Stroke + fill color — defaults to brass gold. */
		color?: string;
		/** Soft gradient area fill under the line. */
		area?: boolean;
		/** Dot on the latest point. */
		dot?: boolean;
		strokeWidth?: number;
		/** Accessible label. Alias accepted for the existing `ariaLabel` callers. */
		ariaLabel?: string;
	}
</script>

<script lang="ts">
	// chaching Sparkline — a tiny honest SVG trend line in the brand accent.
	// Plain min→max linear scaling (no curve smoothing): the line spans the
	// series' real range. <2 values → an empty svg (no throw). Optional `area`
	// fill and a `dot` on the last point. `role="img"` + aria-label.
	let {
		values = [],
		width = 200,
		height = 56,
		color = 'var(--accent)',
		area = true,
		dot = true,
		strokeWidth = 2,
		ariaLabel = 'trend'
	}: SparklineProps = $props();

	// Stable per-instance gradient id (jsdom-safe, no crypto needed).
	const gid = `spark-${(sparkSeq += 1)}`;

	const geom = $derived.by(() => {
		if (!values || values.length < 2) return null;
		const max = Math.max(...values);
		const min = Math.min(...values);
		const range = max - min || 1;
		const pad = strokeWidth + 1;
		const w = width - pad * 2;
		const h = height - pad * 2;

		const pts = values.map((v, i) => {
			const x = pad + (i / (values.length - 1)) * w;
			const y = pad + h - ((v - min) / range) * h;
			return [x, y] as const;
		});

		const line = pts
			.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`)
			.join(' ');
		const last = pts[pts.length - 1];
		const fill = `${line} L${last[0].toFixed(1)} ${height} L${pts[0][0].toFixed(1)} ${height} Z`;
		return { line, fill, last };
	});
</script>

{#if geom}
	<svg
		{width}
		{height}
		viewBox={`0 0 ${width} ${height}`}
		role="img"
		aria-label={ariaLabel}
		style="display:block;overflow:visible"
	>
		<defs>
			<linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
				<stop offset="0%" stop-color={color} stop-opacity="0.28" />
				<stop offset="100%" stop-color={color} stop-opacity="0" />
			</linearGradient>
		</defs>
		{#if area}<path d={geom.fill} fill={`url(#${gid})`} />{/if}
		<path
			d={geom.line}
			fill="none"
			stroke={color}
			stroke-width={strokeWidth}
			stroke-linejoin="round"
			stroke-linecap="round"
		/>
		{#if dot}<circle cx={geom.last[0]} cy={geom.last[1]} r={strokeWidth + 1.5} fill={color} />{/if}
	</svg>
{:else}
	<svg {width} {height} role="img" aria-label={ariaLabel} style="display:block"></svg>
{/if}
