<script lang="ts">
	// Throwaway: seven palettes on the accepted dashboard, with fictional data.
	import { page } from '$app/state';
	import NumberFlow from '@number-flow/svelte';
	import { goto } from '$app/navigation';
	import BrandMark from '$lib/components/ds/BrandMark.svelte';
	import MoneyOdometer from '$lib/components/ds/MoneyOdometer.svelte';
	import PrototypeSettings from '$lib/components/PrototypeSettings.svelte';
	import MoneyFigure from '$lib/components/ds/MoneyFigure.svelte';
	import { accounts as allAccounts, selectUsage, spendChange } from '$lib/components/prototype-data';
	import { flourishFor, formatFlourishText, DAILY_FLOURISHES, LIFETIME_FLOURISHES, BLOCK_FLOURISHES } from '$lib/voice';
	import PrototypeExplore from '$lib/components/PrototypeExplore.svelte';
	import PrototypePalette from '$lib/components/PrototypePalette.svelte';
	let variant = $derived(page.url.searchParams.get('variant') ?? 'A');
	let scene = $derived(page.url.searchParams.get('state') ?? 'overview');
	let section = $state('Dashboard');
	let personality = $state(true);
	let motion = $state(true);
	let windowDays = $state(30);
	let endDay = $state(0);
	let selected = $state(0);
	let detailDialog = $state<HTMLDialogElement>();
	$effect(() => {
		if (!detailDialog) return;
		if (scene === 'detail' && !detailDialog.open) detailDialog.showModal();
		else if (scene !== 'detail' && detailDialog.open) detailDialog.close();
	});
	let provider = $state('all');
	let machine = $state('all');
	let accountId = $state('all');
	let hoveredDay = $state<number | null>(null);
	const usage = $derived(selectUsage(provider, machine, accountId, endDay, windowDays));
	const accounts = $derived(usage.accounts);
	const sessions = $derived(usage.windowEntries.toSorted((a,b) => a.day-b.day || b.time.localeCompare(a.time)));
	let chosenEntry = $state<typeof usage.entries[number] | null>(null);
	const detail = $derived(chosenEntry ?? sessions[selected] ?? sessions[0]);
	const fees = $derived(accounts.reduce((sum,account) => sum + account.monthlyUsd, 0) * windowDays / 30);
	const windows = $derived([
		{ label: '5h block', value: 42.68, remark: formatFlourishText(flourishFor(42.68,BLOCK_FLOURISHES)), days: 0, comparison: '' },
		{ label: 'Today', value: usage.totals.today, remark: formatFlourishText(flourishFor(usage.totals.today,DAILY_FLOURISHES)), days: 1, comparison: `${spendChange(usage.totals.today, usage.previousTotals.today)} vs yesterday` },
		{ label: '7 days', value: usage.totals.week, remark: '', days: 7, comparison: `${spendChange(usage.totals.week, usage.previousTotals.week)} vs previous 7d` },
		{ label: '30 days', value: usage.totals.month, remark: '', days: 30, comparison: `${spendChange(usage.totals.month, usage.previousTotals.month)} vs previous 30d` },
		{ label: 'All time', value: usage.totals.all, remark: formatFlourishText(flourishFor(usage.totals.all,LIFETIME_FLOURISHES)), days: 120, comparison: '' }
	]);
	const chartMax = $derived(Math.max(1, ...usage.dailyCosts));
	const providerTotals = $derived(['Claude','Codex'].map(name => ({ name, value: usage.windowEntries.filter(e => allAccounts.find(a => a.id === e.accountId)?.provider === name).reduce((sum,e)=>sum+e.cost,0) })));
	function money(value: number) { return value.toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}); }
	function dayLabel(index: number) { return new Date(Date.UTC(2026,8,10-endDay-windowDays+1+index)).toLocaleDateString('en-GB',{day:'numeric',month:'short',timeZone:'UTC'}); }
	function clearFilters() { provider='all'; machine='all'; accountId='all'; }
	function setParam(key: string, value: string) {
		const url = new URL(page.url); url.searchParams.set(key, value);
		void goto(url, { replaceState: true, noScroll: true, keepFocus: true });
	}
	function openSession(index: number) { chosenEntry=null; selected = index; setParam('state', 'detail'); }
	function dateISO(age: number) { return new Date(Date.UTC(2026,8,10-age)).toISOString().slice(0,10); }
	function setWindow(days: number) { windowDays=days; endDay=Math.min(endDay,120-days); hoveredDay=null; }
	function stepWindow(direction: number) { endDay=Math.max(0,Math.min(120-windowDays,endDay+direction*windowDays)); hoveredDay=null; }
	function jumpDate(value: string) { const timestamp=Date.parse(value+'T00:00:00Z'); if(Number.isFinite(timestamp)) { endDay=Math.max(0,Math.min(120-windowDays,Math.round((Date.UTC(2026,8,10)-timestamp)/86400000))); hoveredDay=null; } }
	function focusDay(index: number) { endDay=endDay+windowDays-1-index; windowDays=1; hoveredDay=null; }
	function showEntry(entry: typeof usage.entries[number]) { chosenEntry=entry; setParam('state','detail'); }

</script>


{#snippet comparison(text: string, range = false)}
	<span class:range-comparison={range} class:comparison={!range} class:up={text.startsWith('+')} class:down={text.startsWith('-')} title={text} aria-label={text}>{#if text.includes('%')}<span aria-hidden="true"><NumberFlow value={parseFloat(text)/100} format={{style:'percent',minimumFractionDigits:1,maximumFractionDigits:1,signDisplay:'exceptZero'}} animated={motion}/></span>{:else}—{/if}</span>
{/snippet}

{#snippet scopeControls()}
			<div class="filters" aria-label="Usage filters">
				<label><span>Provider</span><select aria-label="Provider" bind:value={provider}><option value="all">All providers</option><option>Claude</option><option>Codex</option></select></label>
				<label><span>Machine</span><select aria-label="Machine" bind:value={machine}><option value="all">All machines</option><option>MacBook</option><option>Mac mini</option></select></label>
				<label><span>Account</span><select aria-label="Account" bind:value={accountId}><option value="all">All Accounts</option>{#each allAccounts as account}<option value={account.id}>{account.name}</option>{/each}</select></label>
				{#if provider !== 'all' || machine !== 'all' || accountId !== 'all'}<button onclick={clearFilters}>Clear filters</button>{/if}
			</div>
	<div class="range-controls" aria-label="Date range navigation">
		<div class="period-options" aria-label="Time window">{#each [{days:1,label:'Day'},{days:7,label:'7d'},{days:30,label:'30d'},{days:90,label:'90d'},{days:120,label:'All'}] as option}<button class:chosen={windowDays===option.days} aria-pressed={windowDays===option.days} onclick={() => setWindow(option.days)}>{option.label}</button>{/each}</div>
		<div class="date-controls"><button aria-label="Previous window" disabled={endDay >= 120-windowDays} onclick={() => stepWindow(1)}>‹</button><label class="date-picker"><span>{windowDays===1 ? dayLabel(0) : `${dayLabel(0)} – ${dayLabel(windowDays-1)}`}</span><input aria-label="Window ending date" type="date" value={dateISO(endDay)} min={dateISO(120-windowDays)} max="2026-09-10" onchange={e => jumpDate(e.currentTarget.value)}/></label><button aria-label="Next window" disabled={endDay===0} onclick={() => stepWindow(-1)}>›</button>{#if endDay>0}<button onclick={() => {endDay=0;hoveredDay=null}}>Latest</button>{/if}</div>
		<span class="range-total">{money(usage.periodCost)}</span>{#if windowDays < 120}{@render comparison(`${spendChange(usage.periodCost, usage.previousPeriodCost)} vs previous ${windowDays === 1 ? 'day' : `${windowDays}d`}`, true)}{/if}
	</div>
{/snippet}

<svelte:head><title>chaching · Palette prototype</title><meta name="robots" content="noindex" /></svelte:head>

{#snippet quota(account: typeof accounts[number], compact = false)}
	<div class:compact class="quota-pair">
		{#each [{label: 'Short term', value: account.short, reset: account.reset}, {label: 'Weekly', value: account.week, reset: account.weeklyReset}] as q}
			<div class="quota-window" class:low={q.value < 25}>
				<div class="window-label"><span>{q.label}</span><span class="remaining"><b><NumberFlow value={q.value/100} format={{style:'percent'}} animated={motion}/></b> left</span></div>
				<meter min="0" max="100" value={q.value} aria-label={`${account.name} ${q.label} quota remaining`}></meter>
				<small>Resets {q.reset}</small>
			</div>
		{/each}
	</div>
{/snippet}

{#snippet accountName(account: typeof accounts[number])}
	<div class="account-name"><strong>{account.name}</strong><span>{account.plan}</span></div>
	{#if account.activeMachines.some(m => machine === 'all' || machine === m)}<span class="active">Current on {account.activeMachines.filter(m => machine === 'all' || machine === m).join(', ')}</span>{:else}<span class="available">Available</span>{/if}
{/snippet}

<div class="prototype" class:no-motion={!motion} class:ledger={variant === 'B'} class:lanes={variant === 'C'}>
	<div class="sample">DESIGN PROTOTYPE <span>Fictional data · Thu 10 Sep, 16:00 UTC</span></div>
	<header><BrandMark wordmark size={18}/><nav aria-label="Main navigation">{#each ['Dashboard', 'Explore', 'Settings'] as item}<button class:chosen={section === item} onclick={() => section = item}>{item}</button>{/each}</nav><select class="compact-nav" aria-label="View" bind:value={section}><option>Dashboard</option><option>Explore</option><option>Settings</option></select><span class="machine">MacBook</span></header>
	<div class="preview-controls"><label>Account view <select aria-label="Account view" value={variant} onchange={e => setParam('variant',e.currentTarget.value)}><option value="A">Current</option><option value="B">All accounts</option><option value="C">By provider</option></select></label><label>Preview state <select aria-label="Preview state" value={scene} onchange={e => setParam('state',e.currentTarget.value)}><option value="overview">Overview</option><option value="detail">Session detail</option><option value="loading">Cold scan</option></select></label></div>
	<main>
		{#if scene === 'loading'}
			<section class="cold" aria-live="polite"><h1>Counting your sins…</h1><p>Cold-scanning Claude Code transcripts.</p><div class="scan-line"></div><p class="muted">First load streams every session file once.<br/>This is the only slow part.</p><button onclick={() => setParam('state','overview')}>Preview loaded dashboard →</button></section>
		{:else if section === 'Settings'}
			<div class="page-title"><div><h1>Settings</h1></div><span>Preview only</span></div>
			<PrototypeSettings bind:personality bind:motion/>
		{:else if section === 'Explore'}
			<div class="page-title"><div><h1>Explore</h1></div><button onclick={() => section = 'Dashboard'}>Back to dashboard</button></div>
			{@render scopeControls()}
			<PrototypeExplore entries={usage.windowEntries} onselect={showEntry}/>

		{:else}
			<h1 class="sr-only">Dashboard</h1>

			<section class="spend" aria-label="Spend overview">{#each windows as stat}<div><button class="stat-select" disabled={stat.days===0} onclick={() => {endDay=0;setWindow(stat.days)}}><span class="eyebrow">{stat.label}</span><MoneyOdometer amount={stat.value} size="hero" tone="default" reducedMotion={motion ? undefined : true}/></button>{#if stat.comparison}{@render comparison(stat.comparison)}{/if}{#if personality}<small class="flavour">{stat.remark || '\u00a0'}</small>{/if}</div>{/each}</section>
			{@render scopeControls()}
			<div class="charts">
				<section class="daily-chart"><div class="section-heading"><h2>Spend</h2><span>{hoveredDay === null ? (windowDays===1 ? dayLabel(0) : `${windowDays} days`) : `${dayLabel(hoveredDay)} · ${money(usage.dailyCosts[hoveredDay])}`}</span></div>
				<div class="plot"><div class="axis"><span>{money(chartMax)}</span><span>{money(chartMax/2)}</span><span>$0</span></div><div class="bars">{#each usage.dailyCosts as value,i}<button class:bar-selected={hoveredDay === i} style:--bar-height={`${value/chartMax*100}%`} onclick={() => focusDay(i)} onmouseenter={() => hoveredDay=i} onmouseleave={() => hoveredDay=null} onfocus={() => hoveredDay=i} onblur={() => hoveredDay=null} aria-label={`${dayLabel(i)}: ${money(value)}`} title={`${dayLabel(i)}: ${money(value)}`}><span></span></button>{/each}</div></div><div class="dates"><span>{dayLabel(0)}</span><span>{windowDays>1 ? dayLabel(Math.floor((windowDays-1)/2)) : ''}</span><span>{windowDays>1 ? dayLabel(windowDays-1) : ''}</span></div>
				</section>
				<section class="provider-chart"><div class="section-heading"><h2>By provider</h2><span>{windowDays} {windowDays===1 ? 'day' : 'days'}</span></div>{#each providerTotals as entry}<div class="provider-total" style:--provider-color={entry.name === 'Claude' ? 'var(--p-claude)' : 'var(--p-codex)'}><div><span>{entry.name}</span><strong><MoneyOdometer amount={entry.value} size="sm" tone="default" reducedMotion={motion ? undefined : true}/></strong></div><meter min="0" max={Math.max(1,usage.periodCost)} value={entry.value} aria-label={`${entry.name} spend: ${money(entry.value)}`}></meter></div>{/each}</section>
			</div>

			<section class="quota-section" aria-label="Account quotas">
				{#if accounts.length === 0}<p class="empty">No Accounts match these filters. <button onclick={clearFilters}>Clear filters</button></p>{/if}
				{#if variant === 'A'}
					<div class="section-heading"><h2>Current Accounts</h2></div>
					<div class="current-focus">{#each accounts.filter(a => a.activeMachines.some(m => machine === 'all' || machine === m)) as account}<article class:attention={account.short < 25}><div class="account-top">{@render accountName(account)}</div>{@render quota(account)}</article>{/each}</div>
					{#each accounts.filter(a => !a.activeMachines.some(m => machine === 'all' || machine === m)) as account}<div class="other-account"><div><span class="eyebrow">Also available</span><strong>{account.name} <small>{account.plan}</small></strong></div>{@render quota(account, true)}</div>{/each}

				{:else if variant === 'B'}
					<div class="section-heading"><h2>All Accounts</h2></div>
					<div class="ledger-head"><span>Account / plan</span><span>Short term</span><span>Weekly</span></div>
					{#each [...accounts].sort((a,b) => Math.min(a.short,a.week)-Math.min(b.short,b.week)) as account}<article class="ledger-row"><div>{@render accountName(account)}</div>{@render quota(account)}</article>{/each}
				{:else}
					<div class="provider-lanes">{#each ['Claude','Codex'].filter(p => accounts.some(a => a.provider===p)) as provider}<section class="provider-lane"><div class="provider-title"><h2>{provider}</h2><span>{accounts.filter(a=>a.provider===provider).length} {accounts.filter(a=>a.provider===provider).length === 1 ? 'Account' : 'Accounts'}</span></div>{#each accounts.filter(a=>a.provider===provider) as account}<article><div class="account-top">{@render accountName(account)}</div>{@render quota(account)}</article>{/each}</section>{/each}</div>
				{/if}
			</section>
			
			<div class="lower">
				<div class="reading-column">
				<section class="sessions"><div class="section-heading"><h2>Sessions</h2><button onclick={() => section = 'Explore'}>View all →</button></div>{@render sessionList()}</section></div>
				<aside class="receipt"><div class="section-heading"><h2>Subsidisation</h2><span>{windowDays} {windowDays===1 ? 'day' : 'days'}</span></div><div class="multiplier">{fees ? (usage.periodCost/fees).toFixed(1) : '—'}{#if fees}<span>×</span>{/if}</div><p>API value across {accounts.length} {accounts.length === 1 ? 'Account' : 'Accounts'}</p><dl><div><dt>Usage value</dt><dd>{money(usage.periodCost)}</dd></div><div><dt>Account fees</dt><dd>{money(fees)}</dd></div><div class="net"><dt>Difference</dt><dd>{money(usage.periodCost-fees)}</dd></div></dl><div class="average"><span>Average $/hour</span><b>{money(usage.periodCost / (windowDays*24-(endDay===0 ? 8 : 0)))}</b></div><small>{dayLabel(0)} – {dayLabel(windowDays-1)} 2026</small></aside>
			</div>
		{/if}
	</main>
	
</div>

{#snippet sessionList()}
	<div class="session-list">{#each (section === 'Explore' ? sessions : sessions.slice(0,5)) as session, i}<button class="session" onclick={() => openSession(i)}><span class="session-name"><strong>{session.name}</strong><small>{session.project} · {session.model}</small></span><span class="session-cost">${session.cost.toFixed(2)}<small>{session.time}</small></span><span aria-hidden="true">↗</span></button>{/each}</div>
{/snippet}

{#if detail}<dialog bind:this={detailDialog} oncancel={() => setParam('state','overview')} aria-labelledby="detail-title">
	<div class="detail-head"><span class="eyebrow">Session receipt · fictional data</span><button aria-label="Close session detail" onclick={() => setParam('state','overview')}>×</button></div><h2 id="detail-title">{detail.name}</h2><p>{detail.project} · {detail.model}</p><MoneyFigure amount={detail.cost} size="hero" animate={false}/><dl><div><dt>Tokens</dt><dd>{detail.tokens}</dd></div><div><dt>Started</dt><dd>{detail.time}</dd></div><div><dt>Machine</dt><dd>{detail.machine}</dd></div></dl><button onclick={() => setParam('state','overview')}>Back to dashboard</button>
</dialog>{/if}
<PrototypePalette/>

<style>
	:global(body){margin:0;background:var(--surface-1);color:var(--text)}
	.prototype{--type-label:500 11px/1.3 var(--font-sans);--type-num:500 16px/1 var(--font-sans);font-variant-numeric:tabular-nums;max-width:1440px;margin:auto;padding:0 48px;font:var(--type-body)}
	.sample{font:var(--type-label);color:var(--text-muted);padding:14px 0;display:flex;justify-content:space-between;border-bottom:1px solid var(--border-faint);letter-spacing:.06em}
	header{display:flex;align-items:center;gap:48px;padding:24px 0;border-bottom:1px solid var(--border)}
	nav{display:flex;gap:24px}button,select{font:inherit;color:inherit}button{cursor:pointer;background:none;border:0;min-height:44px;padding:8px 0;text-align:left}button:hover{color:var(--accent)}button:focus-visible,select:focus-visible{outline:2px solid var(--accent);outline-offset:4px}
	nav button{color:var(--text-muted)}nav button.chosen{color:var(--text);box-shadow:0 2px var(--accent)}.machine{margin-left:auto;font:var(--type-label);color:var(--text-muted)}
	main{padding:28px 0 160px}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}.page-title{display:flex;justify-content:space-between;align-items:end;margin-bottom:32px;gap:20px}.eyebrow{display:block;font:var(--type-label);letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted)}h1{font:var(--type-display);letter-spacing:-.045em;margin:10px 0 0}h2{font:var(--type-title);margin:0}.page-title>span{font:var(--type-label);color:var(--text-muted);padding-bottom:6px}.section-heading{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:20px}.section-heading>span{font:var(--type-label);color:var(--text-muted)}.section-heading h2{font-size:var(--text-lg)}
	.current-focus{display:grid;grid-template-columns:1.2fr 1fr;border:1px solid var(--border)}.current-focus article{padding:24px 28px}.current-focus article+article{border-left:1px solid var(--border)}.current-focus article.attention{background:var(--accent-soft);border-top:3px solid var(--accent);padding-top:21px}.account-top{display:flex;align-items:start;justify-content:space-between;gap:16px}.account-name{display:flex;flex-direction:column;gap:3px}.account-name strong{font-size:var(--text-lg)}.account-name span,.available{font-size:var(--text-xs);color:var(--text-muted)}.active{font:var(--type-label);color:var(--accent);padding-top:5px}.quota-pair{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:30px}.window-label{display:flex;justify-content:space-between;align-items:baseline;gap:10px;font-size:var(--text-sm)}.remaining{font-size:var(--text-xs);color:var(--text-muted)}.remaining b{font:700 30px/1.2 var(--font-sans);color:var(--text)}.low .remaining b{color:var(--accent)}meter{display:block;width:100%;height:7px;appearance:none;border:0;margin:12px 0;background:var(--border);border-radius:0}meter::-webkit-meter-bar{background:var(--surface-3);border:0;border-radius:0;height:7px}meter::-webkit-meter-optimum-value{background:var(--paper-200)}.low meter::-webkit-meter-optimum-value{background:var(--accent)}meter::-moz-meter-bar{background:var(--paper-200)}small{font-size:var(--text-xs);color:var(--text-muted)}
	.other-account{display:grid;grid-template-columns:1fr 2fr;gap:36px;align-items:center;border-bottom:1px solid var(--border);padding:22px 28px}.other-account strong{display:block;margin-top:12px}.other-account strong small{margin-left:8px}.compact{margin:0}.compact .remaining b{font-size:var(--text-lg)}
	.spend{display:grid;grid-template-columns:repeat(4,1fr);border-top:1px solid var(--border);border-bottom:1px solid var(--border);margin:36px 0;padding:24px 0}.spend>div{padding-left:28px;border-left:1px solid var(--border)}.spend>div:first-child{border-left:0;padding-left:0}.spend .eyebrow{margin-bottom:12px}.spend :global(.money){font-size:var(--text-2xl)}
	.lower{display:grid;grid-template-columns:1fr 330px;gap:40px}.muted{color:var(--text-muted);font-size:var(--text-sm)}.receipt{align-self:start;background:var(--cream-50);color:var(--cream-ink);padding:28px;border-bottom:5px dashed var(--surface-1)}.receipt small{color:var(--cream-ink)}.receipt h2{color:var(--cream-ink);font-size:var(--text-xl);margin-top:0}.multiplier{font:700 80px/1.2 var(--font-sans);letter-spacing:-.08em;margin:16px 0}.multiplier span{font-size:40px}.receipt p{font-size:var(--text-sm)}select{background:transparent;border:0;max-width:100px}.receipt dl{font:var(--type-label);line-height:1.5;margin:24px 0}.receipt dl>div,dialog dl>div{display:flex;justify-content:space-between;gap:12px;margin:12px 0}.receipt dd,dialog dd{margin:0}.net{border-top:1px dashed currentColor;padding-top:12px}.average{display:flex;justify-content:space-between;font-size:var(--text-sm);padding:16px 0;border-top:1px dashed currentColor}.receipt small{display:block;font-size:10px;line-height:1.7}
	.session{display:grid;width:100%;grid-template-columns:1fr auto 16px;gap:14px;align-items:center;padding:15px 0;border-bottom:1px solid var(--border-faint)}.session-name strong{font-size:var(--text-sm);font-weight:500}.session small{display:block;margin-top:4px;font-size:11px}.session-cost{text-align:right;font:var(--type-num)}.session>span:last-child{color:var(--text-muted)}.session-list{margin-top:-10px}
	.prototype.ledger{max-width:1200px}.ledger-head{display:grid;grid-template-columns:1fr 1fr 1fr;gap:28px;font:var(--type-label);color:var(--text-muted);padding:12px 24px;border-bottom:1px solid var(--border)}.ledger-row{display:grid;grid-template-columns:1fr 2fr;gap:28px;padding:24px;border-bottom:1px solid var(--border)}.ledger-row>div:first-child{display:flex;flex-direction:column;gap:12px}.ledger-row .quota-pair{margin:0}.ledger .quota-section{border-top:3px solid var(--accent)}.ledger .quota-section>.section-heading{padding-top:20px}.ledger .spend{background:var(--surface-2);padding:24px}.ledger .lower{grid-template-columns:1fr 330px}
	.provider-lanes{display:grid;grid-template-columns:1fr 1fr;gap:40px}.provider-title{display:flex;justify-content:space-between;align-items:center;padding:0 0 16px;border-bottom:3px solid var(--accent)}.provider-title h2{font-size:var(--text-2xl)}.provider-title>span{color:var(--text-muted);font:var(--type-label)}.provider-lane article{padding:24px 0;border-bottom:1px solid var(--border)}.provider-lane .quota-pair{gap:24px;margin-top:20px}.lanes .spend{margin-top:28px}
	.cold{min-height:65vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}.cold h1{font-size:var(--text-4xl)}.scan-line{height:3px;width:220px;background:linear-gradient(to right,var(--accent) 62%,var(--border) 62%);margin:28px}.cold button{color:var(--accent)}dialog{position:fixed;inset:70px 24px auto auto;width:min(460px,calc(100vw - 48px));box-sizing:border-box;max-height:calc(100vh - 170px);overflow:auto;background:var(--surface-2);color:var(--text);border:1px solid var(--accent-line);padding:28px;z-index:10}dialog::backdrop{background:#0009}dialog:not([open]){display:none}.detail-head button{min-width:44px;text-align:center}.detail-head{display:flex;justify-content:space-between;align-items:center}dialog h2{margin:24px 0 12px}dialog p{color:var(--text-muted)}dialog dl{margin-top:32px}dialog>button{color:var(--accent)}
	@media(max-width:1000px){.prototype{padding:0 24px}header{gap:24px}.machine{display:none}.current-focus article{padding:20px}.quota-pair{gap:16px}.remaining b{font-size:24px}.account-top{flex-direction:column;gap:6px}.lower,.ledger .lower{grid-template-columns:1fr 290px;gap:24px}.spend>div{padding-left:16px}.spend :global(.money){font-size:var(--text-xl)}}
	@media(max-width:650px){.prototype{padding:0 20px}.sample{font-size:9px}.sample span{max-width:165px;text-align:right;line-height:1.5}header{flex-wrap:wrap;padding:20px 0;gap:12px}nav{width:100%;gap:22px}nav button{font-size:var(--text-sm)}main{padding-top:28px}.page-title{display:block;margin-bottom:24px}h1{font-size:32px}.section-heading{align-items:start}.section-heading>span{max-width:130px;text-align:right;line-height:1.5}.current-focus{grid-template-columns:1fr}.current-focus article+article{border-left:0;border-top:1px solid var(--border)}.current-focus article{padding:20px}.account-top{flex-direction:row}.account-name strong{font-size:18px}.active{max-width:100px;line-height:1.5;text-align:right}.quota-pair{margin-top:24px;gap:20px}.remaining b{font-size:25px}.window-label{display:block}.remaining{display:block;margin-top:8px}.other-account{grid-template-columns:1fr;padding:24px 0;gap:20px}.compact .window-label{display:flex}.compact .remaining{margin:0}.spend{grid-template-columns:1fr 1fr;gap:24px 16px;margin:28px 0}.spend>div:nth-child(3){padding-left:0;border-left:0}.spend>div{padding-left:16px}.spend :global(.money){font-size:var(--text-xl)}.lower,.ledger .lower{grid-template-columns:1fr}.receipt{padding:24px;margin-top:8px}.receipt .multiplier{font-size:72px}.session{grid-template-columns:1fr auto;gap:10px}.session>span:last-child{display:none}.session-name strong{font-size:12px}.session small{font-size:10px}.session-cost{font-size:13px}.session-cost small{max-width:82px}.ledger-head{display:none}.ledger-row{grid-template-columns:1fr;padding:24px 0;gap:20px}.ledger-row>div:first-child{flex-direction:row;justify-content:space-between}.ledger-row .window-label{display:flex}.ledger-row .remaining{margin:0}.provider-lanes{grid-template-columns:1fr;gap:28px}.provider-lane .account-top{flex-direction:row}.provider-title h2{font-size:24px}.cold h1{font-size:36px}dialog{inset:30px 12px auto;width:calc(100vw - 24px);padding:24px}}

	.filters{display:flex;gap:20px;align-items:center;flex-wrap:wrap;margin-bottom:20px}.filters label{display:flex;gap:10px;align-items:center;color:var(--text-muted);font-size:var(--text-xs)}.filters select{max-width:180px;min-height:44px;padding:8px 30px 8px 12px;border:1px solid var(--border);background:var(--surface-2);color:var(--text);border-radius:var(--radius-xs)}.filters button{font-size:var(--text-xs);margin-left:auto}
	.spend,.ledger .spend,.lanes .spend{margin:0 0 30px;padding:20px 0 24px;background:transparent;border-top:0}.spend :global(.money){font-size:clamp(32px,3.9vw,56px);line-height:1.15;letter-spacing:-.055em}.spend .flavour{display:block;min-height:20px;margin-top:12px;font-size:var(--text-xs);color:var(--accent)}
	.charts{display:grid;grid-template-columns:2fr 1fr;gap:40px;margin:0 0 36px;padding-bottom:28px;border-bottom:1px solid var(--border)}.plot{height:142px;display:flex;gap:12px}.axis{display:flex;flex-direction:column;justify-content:space-between;color:var(--text-muted);font:10px var(--font-sans);min-width:62px}.bars{flex:1;display:flex;gap:5px;align-items:end;border-bottom:1px solid var(--border);background:repeating-linear-gradient(to top,transparent 0,transparent 69px,var(--border-faint) 70px)}.bars button{height:100%;min-height:0;padding:0;flex:1;display:flex;align-items:end}.bars button span{width:100%;height:var(--bar-height);background:var(--accent);opacity:1}.bars button:hover span,.bars .bar-selected span{opacity:1}.dates{display:flex;justify-content:space-between;padding-left:74px;margin-top:10px;font:10px var(--font-sans);color:var(--text-muted)}.provider-total{margin:25px 0}.provider-total>div{display:flex;justify-content:space-between;gap:16px;font-size:var(--text-sm)}.provider-total strong{font-family:var(--font-sans);font-weight:500}.provider-total meter{height:9px;margin-top:16px}.provider-total meter::-webkit-meter-optimum-value{background:var(--provider-color)}.provider-total meter::-moz-meter-bar{background:var(--provider-color)}.quota-section{margin-bottom:36px}.current-focus{grid-template-columns:repeat(auto-fit,minmax(270px,1fr))}.current-focus article{padding:20px}.current-focus article.attention{padding-top:17px}.current-focus .account-top{flex-direction:column;gap:8px}.current-focus .quota-pair{gap:18px;margin-top:24px}.current-focus .remaining b{font-size:26px}.current-focus .window-label{display:block}.current-focus .remaining{display:block;margin-top:8px}.empty{padding:20px;border:1px solid var(--border);color:var(--text-muted)}
	@media(max-width:1000px){.charts{grid-template-columns:1.6fr 1fr;gap:24px}.spend :global(.money){font-size:36px}.filters{gap:12px}}
	@media(max-width:650px){.filters{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px}.filters label{display:grid;gap:6px}.filters select{width:100%;max-width:none}.filters label:last-of-type{grid-column:1/-1}.filters button{margin:0}.spend,.ledger .spend,.lanes .spend{padding:14px 0 20px;margin:0 0 24px;gap:20px 12px}.spend :global(.money){font-size:34px}.spend .flavour{font-size:10px;margin-top:8px}.charts{grid-template-columns:1fr;gap:24px;margin-bottom:28px}.plot{height:120px}.bars{gap:3px}.axis{min-width:54px;font-size:9px}.dates{padding-left:66px}.provider-total{margin:18px 0}.current-focus{grid-template-columns:1fr}.current-focus .account-top{flex-direction:row}.current-focus .active{text-align:right}.current-focus .window-label{display:flex}.current-focus .remaining{margin:0}.current-focus .quota-pair{gap:18px}.current-focus .remaining b{font-size:23px}.daily-chart .section-heading>span{max-width:170px}.provider-lane .account-top{flex-direction:row}.receipt .section-heading{gap:8px}}

	header{padding:6px 0;gap:28px;min-height:44px}nav{gap:24px}nav button{min-height:36px;font-size:var(--text-sm)}.sample{padding:8px 0;font-size:10px}.compact-nav{display:none}main{padding-top:18px}
	@media(max-width:760px),(max-height:650px){
		.prototype{padding:0 16px}.sample{padding:4px 0;font-size:8px;line-height:12px}.sample span{max-width:none;font-size:8px}.machine{display:none}header{flex-wrap:nowrap;min-height:36px;padding:4px 0;gap:16px}header :global(svg){max-width:120px;height:24px}nav{width:auto;gap:16px;margin-left:auto}nav button{min-height:32px;font-size:12px}.filters{display:flex;gap:8px;flex-wrap:nowrap;margin:0 0 8px}.filters label{display:block;min-width:0;flex:1}.filters label>span{display:none}.filters select{min-height:32px;width:100%;padding:4px 18px 4px 6px;font-size:11px}.filters button{font-size:10px;min-height:32px;margin:0}.spend,.ledger .spend,.lanes .spend{grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:0 0 14px;padding:8px 0 12px}.spend>div{padding-left:10px}.spend>div:nth-child(3){border-left:1px solid var(--border);padding-left:10px}.spend :global(.money){font-size:clamp(20px,4.3vw,34px)}.spend .eyebrow{font-size:10px;margin-bottom:7px}.spend .flavour{font-size:9px;line-height:1.3;margin-top:6px;min-height:13px}.charts{grid-template-columns:1fr;margin-bottom:16px;padding-bottom:14px;gap:0}.provider-chart{display:none}.plot{height:70px}.daily-chart .section-heading{margin-bottom:10px}.section-heading h2{font-size:16px}.section-heading>span{font-size:10px;max-width:none}.dates{font-size:9px;margin-top:6px}.axis{font-size:9px;min-width:54px}.quota-section>.section-heading{margin-bottom:10px}.current-focus{grid-template-columns:1fr;border:0;border-top:1px solid var(--border)}.current-focus article,.current-focus article.attention{display:grid;grid-template-columns:130px 1fr;gap:12px;align-items:center;padding:12px 10px;border:0;border-bottom:1px solid var(--border);background:transparent}.current-focus article+article{border-left:0}.current-focus article.attention{border-left:2px solid var(--accent);padding-left:8px}.current-focus .account-top{display:block}.account-name strong{font-size:14px}.account-name span{font-size:10px}.active{display:block;font-size:9px;line-height:1.5;max-width:none;text-align:left!important}.current-focus .quota-pair,.ledger-row .quota-pair{margin:0;gap:16px}.current-focus .window-label,.ledger-row .window-label{display:flex;font-size:10px}.current-focus .remaining,.ledger-row .remaining{display:inline;margin:0;font-size:0}.current-focus .remaining b,.ledger-row .remaining b{font-size:20px}.quota-window meter{margin:6px 0;height:4px}.quota-window meter::-webkit-meter-bar{height:4px}.quota-window small{font-size:9px}.other-account{grid-template-columns:130px 1fr;gap:12px;padding:12px 10px}.other-account .eyebrow{font-size:8px}.other-account strong{font-size:13px;margin-top:4px}.other-account strong small{display:block;margin:0;font-size:9px}.other-account .remaining b{font-size:20px}.other-account .window-label{font-size:10px}.other-account .remaining{font-size:0}.other-account .quota-pair{gap:16px}.quota-section{margin-bottom:20px}.provider-lanes{grid-template-columns:1fr;gap:16px}.provider-title{padding-bottom:8px}.provider-title h2{font-size:18px}.provider-lane article{display:grid;grid-template-columns:130px 1fr;gap:12px;padding:12px 0;align-items:center}.provider-lane .account-top{display:block}.provider-lane .quota-pair{margin:0;gap:16px}.provider-lane .window-label{display:flex;font-size:10px}.provider-lane .remaining{font-size:0;margin:0}.provider-lane .remaining b{font-size:20px}.ledger-head{display:none}.ledger-row{grid-template-columns:130px 1fr;padding:12px 0;gap:12px}.ledger-row>div:first-child{display:block}.ledger .quota-section>.section-heading{padding-top:12px}.lower,.ledger .lower{grid-template-columns:1fr}main{padding-top:12px;padding-bottom:80px}
	}
	@media(max-width:500px){header nav{display:none}.compact-nav{display:block;margin-left:auto;min-height:32px;max-width:150px;font-size:12px}.sample span{max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.spend,.ledger .spend,.lanes .spend{grid-template-columns:1fr 1fr;gap:12px}.spend>div:nth-child(3){border:0;padding:0}.spend :global(.money){font-size:32px}.current-focus article,.current-focus article.attention,.provider-lane article,.ledger-row,.other-account{grid-template-columns:95px 1fr;gap:8px}.current-focus .quota-pair,.provider-lane .quota-pair,.ledger-row .quota-pair,.other-account .quota-pair{gap:10px}.current-focus .remaining b,.provider-lane .remaining b,.ledger-row .remaining b,.other-account .remaining b{font-size:17px}.quota-window small{font-size:8px}.current-focus .window-label,.provider-lane .window-label,.ledger-row .window-label,.other-account .window-label{font-size:9px}.account-name strong{font-size:12px}.active{font-size:8px}.other-account strong{font-size:12px}}

	@media(max-width:760px),(max-height:650px){.plot{height:48px}.charts{padding-bottom:8px;margin-bottom:12px}.current-focus article,.current-focus article.attention{padding-top:8px;padding-bottom:8px}.current-focus .quota-pair{gap:16px}.section-heading{margin-bottom:12px}.other-account{padding-top:8px;padding-bottom:8px}}

	.spend,.ledger .spend,.lanes .spend{grid-template-columns:repeat(5,minmax(0,1fr));margin-bottom:18px;padding:4px 0 16px}.spend :global(.money){font-size:clamp(26px,3.4vw,48px)}.stat-select{padding:0;min-height:0;width:100%}.stat-select:disabled{cursor:default;color:inherit;opacity:1}.stat-select .eyebrow{margin-bottom:10px}.spend .flavour{font-size:11px;min-height:16px}.filters{margin-bottom:8px}.range-controls{display:flex;align-items:center;gap:20px;flex-wrap:wrap;padding-bottom:14px;margin-bottom:16px;border-bottom:1px solid var(--border)}.period-options,.date-controls{display:flex;align-items:center;gap:4px}.period-options button,.date-controls button{min-height:32px;min-width:30px;padding:4px 8px;font-size:12px;text-align:center}.period-options .chosen{background:var(--surface-3);box-shadow:inset 0 -2px var(--accent)}button:disabled{opacity:.35;cursor:default}.date-picker{position:relative;font:12px var(--font-sans);padding:8px;cursor:pointer}.date-picker input{position:absolute;inset:0;opacity:0;width:100%;cursor:pointer;color-scheme:inherit}.date-picker:focus-within{outline:2px solid var(--accent)}.range-total{margin-left:auto;font:var(--type-num);color:var(--text-muted)}.charts{margin-bottom:16px;padding-bottom:16px}.quota-section{margin-bottom:26px}.quota-section .section-heading{margin-bottom:10px}.current-focus{display:block;border:0;border-top:1px solid var(--border)}.current-focus article,.current-focus article.attention,.ledger-row,.provider-lane article{display:grid;grid-template-columns:minmax(160px,1fr) minmax(250px,2fr);gap:24px;align-items:center;padding:12px 16px;background:transparent;border:0;border-bottom:1px solid var(--border)}.current-focus article.attention{border-left:2px solid var(--accent);padding-left:14px}.current-focus .account-top,.provider-lane .account-top{display:flex;flex-direction:row;align-items:center;gap:12px}.account-name strong{font-size:15px}.account-name span{font-size:10px}.active{font-size:10px}.current-focus .quota-pair,.ledger-row .quota-pair,.provider-lane .quota-pair{margin:0;gap:28px}.current-focus .window-label,.ledger-row .window-label,.provider-lane .window-label{display:flex;font-size:11px}.current-focus .remaining,.ledger-row .remaining,.provider-lane .remaining{display:inline;margin:0;font-size:10px}.current-focus .remaining b,.ledger-row .remaining b,.provider-lane .remaining b{font-size:22px}.quota-window meter{height:4px;margin:6px 0}.quota-window meter::-webkit-meter-bar{height:4px}.quota-window small{font-size:10px}.other-account{padding:12px 16px;grid-template-columns:minmax(160px,1fr) minmax(250px,2fr);gap:24px}.other-account strong{margin:4px 0 0;font-size:14px}.other-account .eyebrow{font-size:9px}.provider-lanes{gap:24px}.provider-lane article{grid-template-columns:130px 1fr;padding:12px 0;gap:14px}.provider-lane .account-top{display:block}.provider-lane .quota-pair{gap:16px}.ledger-head{display:none}.ledger-row>div:first-child{display:block}.ledger .quota-section{border-top:0}.ledger .quota-section>.section-heading{padding-top:0}.receipt .section-heading>span{color:var(--cream-ink)}
	@media(max-width:760px),(max-height:650px){.spend,.ledger .spend,.lanes .spend{grid-template-columns:repeat(5,minmax(0,1fr));gap:6px;margin-bottom:10px}.spend :global(.money){font-size:clamp(18px,3.7vw,28px)}.spend>div{padding-left:8px}.spend .eyebrow{font-size:9px}.spend .flavour{font-size:8px;line-height:1.3}.range-controls{gap:6px;margin-bottom:10px;padding-bottom:8px}.range-total{display:none}.period-options button,.date-controls button{font-size:10px;padding:4px 6px;min-width:25px}.date-picker{font-size:10px;padding:4px}.charts{margin-bottom:12px;padding-bottom:10px}.quota-section{margin-bottom:18px}.current-focus article,.current-focus article.attention,.ledger-row,.provider-lane article,.other-account{grid-template-columns:120px 1fr;gap:10px;padding:8px 6px}.current-focus article.attention{padding-left:4px}.current-focus .account-top,.provider-lane .account-top{display:block}.account-name strong{font-size:12px}.account-name span,.active{font-size:8px}.current-focus .quota-pair,.ledger-row .quota-pair,.provider-lane .quota-pair{gap:16px}.current-focus .window-label,.ledger-row .window-label,.provider-lane .window-label{font-size:10px}.current-focus .remaining,.ledger-row .remaining,.provider-lane .remaining{font-size:0}.current-focus .remaining b,.ledger-row .remaining b,.provider-lane .remaining b{font-size:19px}.quota-window small{font-size:8px}.provider-lanes{grid-template-columns:1fr}}
	@media(max-width:500px){.spend,.ledger .spend,.lanes .spend{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.spend>div:last-child{grid-column:1/-1;border:0;padding-left:0}.spend>div:last-child .stat-select{display:flex;align-items:center;gap:16px}.spend>div:last-child .eyebrow{margin:0}.spend :global(.money){font-size:30px}.spend>div:last-child :global(.money){font-size:30px}.spend .flavour{font-size:9px;margin-top:4px}.date-controls{margin-left:auto}.current-focus article,.current-focus article.attention,.ledger-row,.provider-lane article,.other-account{grid-template-columns:90px 1fr;gap:8px}.current-focus .quota-pair,.ledger-row .quota-pair,.provider-lane .quota-pair{gap:10px}.current-focus .remaining b,.ledger-row .remaining b,.provider-lane .remaining b{font-size:17px}.window-label{font-size:9px}.range-controls{flex-wrap:wrap}.period-options{flex:1}.date-picker{font-size:9px}}

	.comparison,.range-comparison{font:600 13px var(--font-sans);color:var(--text-muted)}.up{color:var(--bad)}.down{color:var(--good)}.comparison{display:block;margin-top:8px;line-height:1.4}.range-comparison{white-space:nowrap}@media(max-width:760px),(max-height:650px){.comparison{font-size:12px;margin-top:5px}.range-comparison{font-size:12px}}

	.bars button span{transition:height 450ms cubic-bezier(.2,.7,.2,1),opacity 150ms}
	meter::-webkit-meter-optimum-value{transition:width 450ms cubic-bezier(.2,.7,.2,1)}
	meter::-moz-meter-bar{transition:width 450ms cubic-bezier(.2,.7,.2,1)}
	@media(prefers-reduced-motion:reduce){.bars button span{transition:none}meter::-webkit-meter-optimum-value{transition:none}meter::-moz-meter-bar{transition:none}}

	.no-motion .bars button span{transition:none}.no-motion meter::-webkit-meter-optimum-value{transition:none}.no-motion meter::-moz-meter-bar{transition:none}

	.prototype :global(.money){font-family:var(--font-sans);font-variant-numeric:tabular-nums}.eyebrow{text-transform:none;letter-spacing:0}.spend .eyebrow{font-size:12px}.session-name strong{font-family:var(--font-sans)}

	.preview-controls{display:flex;flex-wrap:wrap;gap:20px;padding:8px 0;color:var(--text-muted);font-size:11px}.preview-controls label{display:flex;align-items:center;gap:8px}.preview-controls select{min-height:36px;max-width:160px;background:var(--surface-2);color:var(--text);padding:4px 8px}
	:global(input::placeholder){color:var(--text-muted);opacity:1}:global(::selection){color:var(--text-on-gold);background:var(--accent)}:global(html){scrollbar-color:var(--text-dim) var(--surface-1);caret-color:var(--accent)}
	.prototype :global(.currency){opacity:1;color:var(--text-muted)}
	.receipt{background:var(--surface-2);color:var(--text)}.receipt h2,.receipt small,.receipt .section-heading>span{color:var(--text)}
</style>
