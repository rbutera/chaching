<script lang="ts">
	// Throwaway: three quota-first layouts on /?variant=A|B|C, with fictional data.
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import BrandMark from '$lib/components/ds/BrandMark.svelte';
	import MoneyFigure from '$lib/components/ds/MoneyFigure.svelte';
	import PrototypeSwitcher from '$lib/components/PrototypeSwitcher.svelte';
	let variant = $derived(page.url.searchParams.get('variant') ?? 'A');
	let scene = $derived(page.url.searchParams.get('state') ?? 'overview');
	let section = $state('Dashboard');
	let period = $state('30 days');
	let selected = $state(0);
	let detailDialog = $state<HTMLDialogElement>();
	$effect(() => {
		if (!detailDialog) return;
		if (scene === 'detail' && !detailDialog.open) detailDialog.showModal();
		else if (scene !== 'detail' && detailDialog.open) detailDialog.close();
	});
	const accounts = [
		{ name: 'Claude 01', provider: 'Claude', plan: 'Max 20×', short: 18, week: 42, reset: '1h 24m', weeklyReset: 'Mon, 09:00', active: true },
		{ name: 'Claude 02', provider: 'Claude', plan: 'Max 20×', short: 86, week: 71, reset: '3h 12m', weeklyReset: 'Wed, 14:00', active: false },
		{ name: 'Codex 01', provider: 'Codex', plan: 'Pro', short: 64, week: 38, reset: '2h 08m', weeklyReset: 'Tue, 11:00', active: true }
	];
	const sessions = [
		{ name: 'Untangle the auth flow', project: 'rennet', model: 'Fable 5.1', cost: 128.42, time: 'Today · 14:32', tokens: '2.41M' },
		{ name: 'Account reconciliation', project: 'chaching', model: 'GPT-6 Astra', cost: 96.18, time: 'Today · 11:06', tokens: '1.82M' },
		{ name: 'Make the diff readable', project: 'rennet', model: 'Fable 5.1', cost: 82.60, time: 'Yesterday · 18:14', tokens: '1.53M' },
		{ name: 'Trace the sync worker', project: 'chaching', model: 'GPT-6 Astra', cost: 74.22, time: 'Yesterday · 10:41', tokens: '1.21M' },
		{ name: 'The one-line fix', project: 'rennet', model: 'Fable 5.1', cost: 61.08, time: '08 Sep · 16:52', tokens: '940K' }
	];
	const windows = [{ label: 'All time', value: 48216 }, { label: 'Today', value: 184.72 }, { label: '7 days', value: 1248.90 }, { label: '30 days', value: 5820 }];
	function setParam(key: string, value: string) {
		const url = new URL(page.url); url.searchParams.set(key, value);
		void goto(url, { replaceState: true, noScroll: true, keepFocus: true });
	}
	function openSession(index: number) { selected = index; setParam('state', 'detail'); }
</script>

<svelte:head><title>chaching · Dashboard layout prototype</title><meta name="robots" content="noindex" /></svelte:head>

{#snippet quota(account: typeof accounts[number], compact = false)}
	<div class:compact class="quota-pair">
		{#each [{label: 'Short term', value: account.short, reset: account.reset}, {label: 'Weekly', value: account.week, reset: account.weeklyReset}] as q}
			<div class="quota-window" class:low={q.value < 25}>
				<div class="window-label"><span>{q.label}</span><span class="remaining"><b>{q.value}%</b> left</span></div>
				<meter min="0" max="100" value={q.value} aria-label={`${account.name} ${q.label} quota remaining`}></meter>
				<small>Resets {q.reset}</small>
			</div>
		{/each}
	</div>
{/snippet}

{#snippet accountName(account: typeof accounts[number])}
	<div class="account-name"><strong>{account.name}</strong><span>{account.plan}</span></div>
	{#if account.active}<span class="active">Current on MacBook</span>{:else}<span class="available">Available</span>{/if}
{/snippet}

<div class="prototype" class:ledger={variant === 'B'} class:lanes={variant === 'C'}>
	<div class="sample">DESIGN PROTOTYPE <span>Fictional data · Thu 10 Sep, 16:00 UTC</span></div>
	<header><BrandMark wordmark size={25}/><nav aria-label="Main navigation">{#each ['Dashboard', 'Explore usage', 'Settings'] as item}<button class:chosen={section === item} onclick={() => section = item}>{item}</button>{/each}</nav><span class="machine">MacBook · local</span></header>
	<main>
		{#if scene === 'loading'}
			<section class="cold" aria-live="polite"><h1>Counting your sins…</h1><p>Cold-scanning Claude Code transcripts.</p><div class="scan-line"></div><p class="muted">First load streams every session file once.<br/>This is the only slow part.</p><button onclick={() => setParam('state','overview')}>Preview loaded dashboard →</button></section>
		{:else if section === 'Settings'}
			<div class="page-title"><div><h1>Settings</h1></div><span>Preview only</span></div>
			<section class="settings"><h2>Accounts</h2>{#each accounts as account}<div class="settings-row">{@render accountName(account)}<span>$200 / month</span></div>{/each}<h2>Sync</h2><p>MacBook · this machine</p><p class="muted">Account editing and pool setup live here. This prototype does not change your settings.</p></section>
		{:else if section === 'Explore usage'}
			<div class="page-title"><div><h1>Explore usage</h1></div><button onclick={() => section = 'Dashboard'}>Back to dashboard</button></div>
			<section class="explore"><h2>September activity</h2><div class="heatmap" aria-label="Fictional daily activity">{#each Array.from({length: 70}, (_, i) => i) as day}<button aria-label={`Preview day ${day + 1}`} style:opacity={0.2 + ((day * 7) % 9) / 12} onclick={() => openSession(0)}></button>{/each}</div><div class="breakdowns">{#each [{title: 'By model', rows: ['Fable 5.1', 'GPT-6 Astra']}, {title: 'By project', rows: ['rennet', 'chaching']}] as group}<section><h2>{group.title}</h2>{#each group.rows as row,i}<div class="breakdown"><span>{row}</span><meter aria-label={`${row} share`} min="0" max="100" value={i ? 38 : 62}></meter><b>{i ? '38' : '62'}%</b></div>{/each}</section>{/each}</div><h2>Sessions</h2>{@render sessionList()}</section>
		{:else}
			<h1 class="sr-only">Dashboard</h1>
			<section class="quota-section" aria-label="Account quotas">
				{#if variant === 'A'}
					<div class="section-heading"><h2>Current on this machine</h2><span>Remaining allowance</span></div>
					<div class="current-focus">{#each accounts.filter(a => a.active) as account}<article class:attention={account.short < 25}><div class="account-top">{@render accountName(account)}</div>{@render quota(account)}{#if account.short < 25}<p class="hint">Another Claude Account has 86% short-term quota left.</p>{:else}<p class="hint">Your current Codex Account.</p>{/if}</article>{/each}</div>
					<div class="other-account"><div><span class="eyebrow">Also available</span><strong>Claude 02 <small>Max 20×</small></strong></div>{@render quota(accounts[1], true)}</div>
				{:else if variant === 'B'}
					<div class="section-heading"><h2>All Accounts</h2><span>Most constrained first · remaining allowance</span></div>
					<div class="ledger-head"><span>Account / plan</span><span>Short term</span><span>Weekly</span></div>
					{#each [...accounts].sort((a,b) => Math.min(a.short,a.week)-Math.min(b.short,b.week)) as account}<article class="ledger-row"><div>{@render accountName(account)}</div>{@render quota(account)}</article>{/each}
				{:else}
					<div class="provider-lanes">{#each ['Claude','Codex'] as provider}<section class="provider-lane"><div class="provider-title"><h2>{provider}</h2><span>{accounts.filter(a=>a.provider===provider).length} {accounts.filter(a=>a.provider===provider).length === 1 ? 'Account' : 'Accounts'}</span></div>{#each accounts.filter(a=>a.provider===provider) as account}<article><div class="account-top">{@render accountName(account)}</div>{@render quota(account)}</article>{/each}</section>{/each}</div>
				{/if}
			</section>
			<section class="spend" aria-label="Spend overview">{#each windows as stat}<div><span class="eyebrow">{stat.label}</span><MoneyFigure amount={stat.value} size="lg" animate={false}/></div>{/each}</section>
			<div class="lower">
				<div class="reading-column"><section class="block"><div class="section-heading"><h2>Five-hour spend block</h2><span>This MacBook only</span></div><div class="block-value"><MoneyFigure amount={142.68} size="lg" tone="gold" animate={false}/><span>13:00–18:00 UTC<br/>2h remaining</span></div><div class="ticks" aria-label="Three of five hours elapsed">{#each Array.from({length: 30},(_,i)=>i) as tick}<i class:elapsed={tick < 18}></i>{/each}</div><p class="muted">Local usage spend · separate from Account quotas</p></section>
				<section class="sessions"><div class="section-heading"><h2>Most expensive sessions</h2><button onclick={() => section = 'Explore usage'}>View all →</button></div>{@render sessionList()}</section></div>
				<aside class="receipt"><div class="section-heading"><h2>Subsidisation</h2><label>Period <select bind:value={period}><option>30 days</option></select></label></div><div class="multiplier">9.7<span>×</span></div><p>API value across 3 Accounts</p><dl><div><dt>Usage value</dt><dd>$5,820.00</dd></div><div><dt>Account fees</dt><dd>$600.00</dd></div><div class="net"><dt>Difference</dt><dd>+$5,220.00</dd></div></dl><div class="average"><span>Average $/hour</span><b>$8.17</b></div><small>12 Aug–10 Sep 2026<br/>30 days ending today · 712 elapsed hours</small></aside>
			</div>
		{/if}
	</main>
	
</div>

{#snippet sessionList()}
	<div class="session-list">{#each sessions as session, i}<button class="session" onclick={() => openSession(i)}><span class="rank">0{i+1}</span><span class="session-name"><strong>{session.name}</strong><small>{session.project} · {session.model}</small></span><span class="session-cost">${session.cost.toFixed(2)}<small>{session.time}</small></span><span aria-hidden="true">↗</span></button>{/each}</div>
{/snippet}

<dialog bind:this={detailDialog} oncancel={() => setParam('state','overview')} aria-labelledby="detail-title">
	<div class="detail-head"><span class="eyebrow">Session receipt · fictional data</span><button aria-label="Close session detail" onclick={() => setParam('state','overview')}>×</button></div><h2 id="detail-title">{sessions[selected].name}</h2><p>{sessions[selected].project} · {sessions[selected].model}</p><MoneyFigure amount={sessions[selected].cost} size="hero" animate={false}/><dl><div><dt>Tokens</dt><dd>{sessions[selected].tokens}</dd></div><div><dt>Started</dt><dd>{sessions[selected].time}</dd></div><div><dt>Machine</dt><dd>MacBook</dd></div></dl><button onclick={() => setParam('state','overview')}>Back to dashboard</button>
</dialog>
<PrototypeSwitcher {variant} onchange={v => setParam('variant',v)} state={scene} onstate={s => setParam('state',s)}/>

<style>
	:global(body){margin:0;background:var(--surface-1);color:var(--text)}
	.prototype{max-width:1440px;margin:auto;padding:0 48px;font:var(--type-body)}
	.sample{font:var(--type-label);color:var(--text-muted);padding:14px 0;display:flex;justify-content:space-between;border-bottom:1px solid var(--border-faint);letter-spacing:.06em}
	header{display:flex;align-items:center;gap:48px;padding:24px 0;border-bottom:1px solid var(--border)}
	nav{display:flex;gap:24px}button,select{font:inherit;color:inherit}button{cursor:pointer;background:none;border:0;min-height:44px;padding:8px 0;text-align:left}button:hover{color:var(--accent)}button:focus-visible,select:focus-visible{outline:2px solid var(--accent);outline-offset:4px}
	nav button{color:var(--text-muted)}nav button.chosen{color:var(--text);box-shadow:0 2px var(--accent)}.machine{margin-left:auto;font:var(--type-label);color:var(--text-muted)}
	main{padding:28px 0 160px}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}.page-title{display:flex;justify-content:space-between;align-items:end;margin-bottom:32px;gap:20px}.eyebrow{display:block;font:var(--type-label);letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted)}h1{font:var(--type-display);letter-spacing:-.045em;margin:10px 0 0}h2{font:var(--type-title);margin:0}.page-title>span{font:var(--type-label);color:var(--text-muted);padding-bottom:6px}.section-heading{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:20px}.section-heading>span,.section-heading label{font:var(--type-label);color:var(--text-muted)}.section-heading h2{font-size:var(--text-lg)}
	.current-focus{display:grid;grid-template-columns:1.2fr 1fr;border:1px solid var(--border)}.current-focus article{padding:24px 28px}.current-focus article+article{border-left:1px solid var(--border)}.current-focus article.attention{background:var(--accent-soft);border-top:3px solid var(--accent);padding-top:21px}.account-top{display:flex;align-items:start;justify-content:space-between;gap:16px}.account-name{display:flex;flex-direction:column;gap:3px}.account-name strong{font-size:var(--text-lg)}.account-name span,.available{font-size:var(--text-xs);color:var(--text-muted)}.active{font:var(--type-label);color:var(--accent);padding-top:5px}.quota-pair{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:30px}.window-label{display:flex;justify-content:space-between;align-items:baseline;gap:10px;font-size:var(--text-sm)}.remaining{font-size:var(--text-xs);color:var(--text-muted)}.remaining b{font:700 30px/1.2 var(--font-num);color:var(--text)}.low .remaining b{color:var(--accent)}meter{display:block;width:100%;height:7px;appearance:none;border:0;margin:12px 0;background:var(--border);border-radius:0}meter::-webkit-meter-bar{background:var(--border);border:0;border-radius:0;height:7px}meter::-webkit-meter-optimum-value{background:var(--paper-200)}.low meter::-webkit-meter-optimum-value{background:var(--accent)}meter::-moz-meter-bar{background:var(--paper-200)}small{font-size:var(--text-xs);color:var(--text-muted)}.hint{margin:24px 0 0;font-size:var(--text-xs);color:var(--text-muted)}
	.other-account{display:grid;grid-template-columns:1fr 2fr;gap:36px;align-items:center;border-bottom:1px solid var(--border);padding:22px 28px}.other-account strong{display:block;margin-top:12px}.other-account strong small{margin-left:8px}.compact{margin:0}.compact .remaining b{font-size:var(--text-lg)}
	.spend{display:grid;grid-template-columns:repeat(4,1fr);border-top:1px solid var(--border);border-bottom:1px solid var(--border);margin:36px 0;padding:24px 0}.spend>div{padding-left:28px;border-left:1px solid var(--border)}.spend>div:first-child{border-left:0;padding-left:0}.spend .eyebrow{margin-bottom:12px}.spend :global(.money){font-size:var(--text-2xl)}
	.lower{display:grid;grid-template-columns:1fr 330px;gap:40px}.block{border-bottom:1px solid var(--border);padding-bottom:24px;margin-bottom:28px}.block-value{display:flex;gap:24px;align-items:center}.block-value>span{font:var(--type-label);line-height:1.8;color:var(--text-muted)}.ticks{display:flex;gap:5px;height:32px;margin:20px 0 12px}.ticks i{flex:1;background:var(--border-faint)}.ticks i.elapsed{background:var(--accent)}.muted{color:var(--text-muted);font-size:var(--text-sm)}.block p{margin-bottom:0}.receipt{align-self:start;background:var(--cream-50);color:var(--cream-ink);padding:28px;border-bottom:5px dashed var(--surface-1)}.receipt .eyebrow,.receipt .section-heading label,.receipt small{color:var(--cream-ink)}.receipt h2{color:var(--cream-ink);font-size:var(--text-xl);margin-top:0}.multiplier{font:700 80px/1.2 var(--font-num);letter-spacing:-.08em;margin:16px 0}.multiplier span{font-size:40px}.receipt p{font-size:var(--text-sm)}select{background:transparent;border:0;max-width:100px}.receipt dl{font:var(--type-label);line-height:1.5;margin:24px 0}.receipt dl>div,dialog dl>div{display:flex;justify-content:space-between;gap:12px;margin:12px 0}.receipt dd,dialog dd{margin:0}.net{border-top:1px dashed currentColor;padding-top:12px}.average{display:flex;justify-content:space-between;font-size:var(--text-sm);padding:16px 0;border-top:1px dashed currentColor}.receipt small{display:block;font-size:10px;line-height:1.7}
	.session{display:grid;width:100%;grid-template-columns:24px 1fr auto 16px;gap:14px;align-items:center;padding:15px 0;border-bottom:1px solid var(--border-faint)}.rank{color:var(--text-muted);font:var(--type-label)}.session-name strong{font-size:var(--text-sm);font-weight:500}.session small{display:block;margin-top:4px;font-size:11px}.session-cost{text-align:right;font:var(--type-num)}.session>span:last-child{color:var(--text-muted)}.session-list{margin-top:-10px}
	.prototype.ledger{max-width:1200px}.ledger-head{display:grid;grid-template-columns:1fr 1fr 1fr;gap:28px;font:var(--type-label);color:var(--text-muted);padding:12px 24px;border-bottom:1px solid var(--border)}.ledger-row{display:grid;grid-template-columns:1fr 2fr;gap:28px;padding:24px;border-bottom:1px solid var(--border)}.ledger-row>div:first-child{display:flex;flex-direction:column;gap:12px}.ledger-row .quota-pair{margin:0}.ledger .quota-section{border-top:3px solid var(--accent)}.ledger .quota-section>.section-heading{padding-top:20px}.ledger .spend{background:var(--surface-2);padding:24px}.ledger .lower{grid-template-columns:1fr 330px}
	.provider-lanes{display:grid;grid-template-columns:1fr 1fr;gap:40px}.provider-title{display:flex;justify-content:space-between;align-items:center;padding:0 0 16px;border-bottom:3px solid var(--accent)}.provider-title h2{font-size:var(--text-2xl)}.provider-title>span{color:var(--text-muted);font:var(--type-label)}.provider-lane article{padding:24px 0;border-bottom:1px solid var(--border)}.provider-lane .quota-pair{gap:24px;margin-top:20px}.lanes .spend{margin-top:28px}
	.cold{min-height:65vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}.cold h1{font-size:var(--text-4xl)}.scan-line{height:3px;width:220px;background:linear-gradient(to right,var(--accent) 62%,var(--border) 62%);margin:28px}.cold button{color:var(--accent)}dialog{position:fixed;inset:70px 24px auto auto;width:min(460px,calc(100vw - 48px));box-sizing:border-box;max-height:calc(100vh - 170px);overflow:auto;background:var(--surface-2);color:var(--text);border:1px solid var(--accent-line);padding:28px;z-index:10}dialog::backdrop{background:#0009}dialog:not([open]){display:none}.detail-head button{min-width:44px;text-align:center}.detail-head{display:flex;justify-content:space-between;align-items:center}dialog h2{margin:24px 0 12px}dialog p{color:var(--text-muted)}dialog dl{margin-top:32px}dialog>button{color:var(--accent)}.settings{max-width:850px}.settings h2{margin-top:32px}.settings-row{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:24px 0;border-bottom:1px solid var(--border)}.explore{max-width:1000px}.heatmap{display:grid;grid-template-columns:repeat(14,1fr);gap:8px;margin:24px 0 40px}.heatmap button{background:var(--accent);min-height:30px}.breakdowns{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-bottom:40px}.breakdown{display:grid;grid-template-columns:110px 1fr 40px;gap:16px;align-items:center;margin:24px 0;font-size:var(--text-sm)}
	@media(max-width:1000px){.prototype{padding:0 24px}header{gap:24px}.machine{display:none}.current-focus article{padding:20px}.quota-pair{gap:16px}.remaining b{font-size:24px}.account-top{flex-direction:column;gap:6px}.lower,.ledger .lower{grid-template-columns:1fr 290px;gap:24px}.spend>div{padding-left:16px}.spend :global(.money){font-size:var(--text-xl)}}
	@media(max-width:650px){.prototype{padding:0 20px}.sample{font-size:9px}.sample span{max-width:165px;text-align:right;line-height:1.5}header{flex-wrap:wrap;padding:20px 0;gap:12px}nav{width:100%;gap:22px}nav button{font-size:var(--text-sm)}main{padding-top:28px}.page-title{display:block;margin-bottom:24px}h1{font-size:32px}.section-heading{align-items:start}.section-heading>span{max-width:130px;text-align:right;line-height:1.5}.current-focus{grid-template-columns:1fr}.current-focus article+article{border-left:0;border-top:1px solid var(--border)}.current-focus article{padding:20px}.account-top{flex-direction:row}.account-name strong{font-size:18px}.active{max-width:100px;line-height:1.5;text-align:right}.quota-pair{margin-top:24px;gap:20px}.remaining b{font-size:25px}.window-label{display:block}.remaining{display:block;margin-top:8px}.other-account{grid-template-columns:1fr;padding:24px 0;gap:20px}.compact .window-label{display:flex}.compact .remaining{margin:0}.spend{grid-template-columns:1fr 1fr;gap:24px 16px;margin:28px 0}.spend>div:nth-child(3){padding-left:0;border-left:0}.spend>div{padding-left:16px}.spend :global(.money){font-size:var(--text-xl)}.lower,.ledger .lower{grid-template-columns:1fr}.receipt{padding:24px;margin-top:8px}.receipt .multiplier{font-size:72px}.session{grid-template-columns:20px 1fr auto;gap:10px}.session>span:last-child{display:none}.session-name strong{font-size:12px}.session small{font-size:10px}.session-cost{font-size:13px}.session-cost small{max-width:82px}.ledger-head{display:none}.ledger-row{grid-template-columns:1fr;padding:24px 0;gap:20px}.ledger-row>div:first-child{flex-direction:row;justify-content:space-between}.ledger-row .window-label{display:flex}.ledger-row .remaining{margin:0}.provider-lanes{grid-template-columns:1fr;gap:28px}.provider-lane .account-top{flex-direction:row}.provider-title h2{font-size:24px}.cold h1{font-size:36px}.heatmap{gap:5px;grid-template-columns:repeat(10,1fr)}.heatmap button{min-height:24px}.breakdowns{grid-template-columns:1fr;gap:0}.settings-row{flex-wrap:wrap}.settings-row>span:last-child{margin-left:auto}.block .section-heading h2{font-size:18px}dialog{inset:30px 12px auto;width:calc(100vw - 24px);padding:24px}}
</style>
