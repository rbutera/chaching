<script lang="ts">
	import type { entries as fixtureEntries } from './prototype-data';
	type Entry = (typeof fixtureEntries)[number];
	type Field = 'model' | 'project';
	let { entries, onselect }: { entries: Entry[]; onselect: (entry: Entry) => void } = $props();
	let filters = $state<Record<Field, { query: string; sort: string; page: number; selected: string }>>({
		model: { query: '', sort: 'cost', page: 0, selected: '' },
		project: { query: '', sort: 'cost', page: 0, selected: '' }
	});
	const fields: Field[] = ['model', 'project'];
	const dollars = (value: number) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
	let query = $state('');
	let sort = $state('cost');
	let page = $state(0);
	let groups = $derived(fields.map(field => {
		const totals = new Map<string, { name: string; cents: number; count: number }>();
		for (const entry of entries) {
			const name = entry[field];
			const total = totals.get(name) ?? { name, cents: 0, count: 0 };
			total.cents += Math.round(entry.cost * 100);
			total.count += 1;
			totals.set(name, total);
		}
		const rows = [...totals.values()]
			.filter(row => row.name.toLowerCase().includes(filters[field].query.trim().toLowerCase()))
			.sort((a, b) => filters[field].sort === 'name' ? a.name.localeCompare(b.name) : b.cents - a.cents || a.name.localeCompare(b.name));
		return { field, rows, total: totals.size, page: Math.min(filters[field].page, Math.max(0, Math.ceil(rows.length / 8) - 1)) };
	}));
	let sessions = $derived(entries
		.filter(entry => fields.every(field => !filters[field].selected || entry[field] === filters[field].selected))
		.filter(entry => `${entry.name} ${entry.project} ${entry.model}`.toLowerCase().includes(query.trim().toLowerCase()))
		.toSorted((a, b) => sort === 'newest' ? a.day - b.day || b.cost - a.cost : b.cost - a.cost || a.day - b.day));
	let sessionPage = $derived(Math.min(page, Math.max(0, Math.ceil(sessions.length / 10) - 1)));
	function select(field: Field, name: string) {
		filters[field].selected = filters[field].selected === name ? '' : name;
		page = 0;
	}
</script>

<div class="breakdowns">
	{#each groups as group (group.field)}
		<section aria-label={group.field === 'model' ? 'Models' : 'Projects'}>
			<header><h2>{group.field === 'model' ? 'Models' : 'Projects'}</h2><span>{group.total}</span></header>
			<div class="controls">
				<input type="search" aria-label={`Search ${group.field}s`} placeholder={`Search ${group.field}s`} bind:value={filters[group.field].query} oninput={() => filters[group.field].page = 0} />
				<select aria-label={`Sort ${group.field}s`} bind:value={filters[group.field].sort} onchange={() => filters[group.field].page = 0}>
					<option value="cost">Highest spend</option><option value="name">Name A–Z</option>
				</select>
			</div>
			<table>
				<thead><tr><th>{group.field === 'model' ? 'Model' : 'Project'}</th><th class="number">Sessions</th><th class="number">Spend</th></tr></thead>
				<tbody>
					{#each group.rows.slice(group.page * 8, group.page * 8 + 8) as row (row.name)}
						<tr class:selected={filters[group.field].selected === row.name}>
							<td><button class="row-link" aria-pressed={filters[group.field].selected === row.name} onclick={() => select(group.field, row.name)}>{row.name}</button></td>
							<td class="number">{row.count}</td><td class="number amount">{dollars(row.cents / 100)}</td>
						</tr>
					{:else}<tr><td colspan="3" class="empty">No matching {group.field}s.</td></tr>{/each}
				</tbody>
			</table>
			<nav aria-label={`${group.field} pages`}>
				<span>{group.rows.length ? group.page * 8 + 1 : 0}–{Math.min(group.page * 8 + 8, group.rows.length)} of {group.rows.length}</span>
				<button disabled={group.page === 0} onclick={() => filters[group.field].page = group.page - 1}>Previous</button>
				<button disabled={(group.page + 1) * 8 >= group.rows.length} onclick={() => filters[group.field].page = group.page + 1}>Next</button>
			</nav>
		</section>
	{/each}
</div>

<section class="sessions" aria-label="Sessions">
	<header><h2>Sessions</h2><span>{sessions.length}</span></header>
	{#if filters.model.selected || filters.project.selected}
		<div class="selections">
			{#each fields as field}
				{#if filters[field].selected}<button onclick={() => select(field, filters[field].selected)} aria-label={`Clear ${field} filter ${filters[field].selected}`}>{filters[field].selected} ×</button>{/if}
			{/each}
		</div>
	{/if}
	<div class="controls">
		<input type="search" aria-label="Search sessions" placeholder="Search sessions, projects or models" bind:value={query} oninput={() => page = 0} />
		<select aria-label="Sort sessions" bind:value={sort} onchange={() => page = 0}><option value="cost">Highest spend</option><option value="newest">Newest first</option></select>
	</div>
	<table>
		<thead><tr><th>Session</th><th class="number">Spend</th></tr></thead>
		<tbody>
			{#each sessions.slice(sessionPage * 10, sessionPage * 10 + 10) as entry}
				<tr><td><button class="row-link" onclick={() => onselect(entry)}>{entry.name}</button><small>{entry.project} · {entry.model} · {entry.time}</small></td><td class="number amount">{dollars(entry.cost)}</td></tr>
			{:else}<tr><td colspan="2" class="empty">No sessions match these filters.</td></tr>{/each}
		</tbody>
	</table>
	<nav aria-label="Session pages"><span>{sessions.length ? sessionPage * 10 + 1 : 0}–{Math.min(sessionPage * 10 + 10, sessions.length)} of {sessions.length}</span><button disabled={sessionPage === 0} onclick={() => page = sessionPage - 1}>Previous</button><button disabled={(sessionPage + 1) * 10 >= sessions.length} onclick={() => page = sessionPage + 1}>Next</button></nav>
</section>

<style>
	.breakdowns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; }
	section { min-width: 0; }
	header { display: flex; align-items: baseline; gap: 8px; margin-bottom: 10px; }
	h2 { font-size: 18px; margin: 0; }
	header span, small, nav span { color: var(--text-muted); font: 11px var(--font-mono); }
	.controls { display: flex; gap: 8px; margin-bottom: 8px; }
	input, select, nav button, .selections button { min-height: 34px; border: 1px solid var(--border); border-radius: 4px; padding: 6px 8px; background: var(--surface-2); color: var(--text); font: 11px var(--font-mono); }
	input { min-width: 0; width: 100%; }
	select { max-width: 145px; }
	table { border-collapse: collapse; width: 100%; table-layout: fixed; font: 11px var(--font-mono); }
	th { color: var(--text-muted); text-align: left; font-weight: 400; padding: 8px 0; }
	td { padding: 7px 0; border-top: 1px solid var(--border-faint); overflow-wrap: anywhere; }
	th:first-child, td:first-child { width: 54%; padding-right: 8px; }
	.number { text-align: right; font-variant-numeric: tabular-nums; }
	.amount { font-weight: 700; white-space: nowrap; }
	.row-link { display: block; text-align: left; width: 100%; min-height: 28px; color: var(--text); font: inherit; cursor: pointer; overflow-wrap: anywhere; }
	.row-link:hover, .selected .row-link { color: var(--gold-400); }
	.selected { background: var(--accent-soft); }
	small { display: block; font-size: 10px; padding-bottom: 3px; overflow-wrap: anywhere; }
	nav { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
	nav span { flex: 1; }
	button:disabled { opacity: .35; cursor: default; }
	button:not(:disabled) { cursor: pointer; }
	button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--gold-400); outline-offset: 2px; }
	.sessions { margin-top: 24px; }
	.sessions th:first-child, .sessions td:first-child { width: 80%; }
	.selections { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
	.empty { padding: 20px 0; color: var(--text-muted); }
	@media (max-width: 700px) { .breakdowns { grid-template-columns: 1fr; gap: 20px; } }
</style>
