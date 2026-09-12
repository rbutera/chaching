import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { money } from '@chaching/shared/format';
import { subsidyMultipleText } from '@chaching/shared/subsidisation';
import { renderPng, svgToPngDataUri, type RenderNode } from '../receipt/png-pipeline';
import { PAPER, GOLD_MARK_SVG } from '../receipt/assets';
import type { YearlyWrapped } from './yearly';

export async function renderYearlyWrappedPng(model: YearlyWrapped, assetRoot: string): Promise<Buffer> {
	const mark = await svgToPngDataUri(GOLD_MARK_SVG, 48);
	const line = (text: string, size = 24): RenderNode => ({ type: 'div', props: { style: { display: 'flex', fontSize: size, marginBottom: 12 }, children: text } });
	return renderPng({ type: 'div', props: {
		style: { display: 'flex', flexDirection: 'column', backgroundColor: PAPER.cream, color: PAPER.ink, padding: 48, width: 800, fontFamily: 'JetBrains Mono' },
		children: [{ type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20, color: PAPER.gold }, children: [{ type: 'img', props: { src: mark, width: 48, height: 48 } }, line('Chaching!', 38)] } }, line(`${model.year} WRAPPED${model.yearToDate ? ' · YEAR TO DATE' : ''}`, 30),
			line(`${model.from} — ${model.to}`, 18), line(model.scope, 18),
			line(model.headline.requests ? `${money(model.headline.cost)} API-priced usage${model.headline.costUnknownRequests ? ' + unpriced usage' : ''}` : 'No usage evidence', 30),
			line(`Configured subscription fees: ${model.comparison.windowFeeUsd === null ? 'unavailable' : money(model.comparison.windowFeeUsd)}`, 20),
			line(`${model.comparisonUnknownRequests ? 'Known subscription value' : 'Subscription value'}: ${money(model.comparison.sub.apiEquivalentUsd)} · ${model.comparisonUnknownRequests && model.comparison.sub.multiple !== null ? 'at least ' : ''}${subsidyMultipleText(model.comparison.sub)}`, 20),
			...(model.partial ? [line('Partial history · based on retained usage', 18), line(model.availableFrom ? `Retained usage: ${model.availableFrom} to ${model.availableTo}` : 'No retained usage', 16)] : []),
			...model.highlights.flatMap(item => [line(item.label, 18), line(item.value, 30), line(item.detail, 16)]),
			line('Your year. Itemised.', 20)]
	} }, { width: 800, fonts: [{ name: 'JetBrains Mono', data: readFileSync(join(assetRoot, 'fonts', 'jetbrains-mono-latin-400-normal.woff')) }] });
}
