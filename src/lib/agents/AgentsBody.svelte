<script lang="ts">
	// The subagents card's body: one row per subagent of the turn — a 6px
	// state dot, its name and role, the time it has run and, on the line
	// below, what it does now. A click opens its conversation (⌘/Ctrl-click
	// the other way); its actions show on hover and keyboard focus: stop it
	// while it works (close_agent in LynShen's agent team, stop_task for a
	// claude background agent), open it beside the chat or in a tab. Above
	// the rows, LynShen's agent team adds its tokens against the turn's
	// budget, its task board's progress and its panel.
	import StopIcon from 'phosphor-svelte/lib/StopIcon';
	import SquareSplitHorizontalIcon from 'phosphor-svelte/lib/SquareSplitHorizontalIcon';
	import AppWindowIcon from 'phosphor-svelte/lib/AppWindowIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import UsersThreeIcon from 'phosphor-svelte/lib/UsersThreeIcon';
	import { t } from '$lib/i18n';
	import IconButton from '$lib/ui/IconButton.svelte';
	import { boardProgress, canStop, discardedRun, planSummary, teamSummary, type AgentRow } from '$lib/agentProgress';
	import { formatCount, shortModel } from '$lib/agentTrace';
	import type { ChatState } from '$lib/chat.svelte';
	import type { OpenHow } from './subagentPages.svelte';
	import { roleLabel, teamNote } from './teamText';
	import { dotTone } from './progressCards';
	import Elapsed from './Elapsed.svelte';
	import StopAgent from './StopAgent.svelte';

	let {
		chat,
		rows,
		onOpen,
		onStop,
		onStopAgent,
		onOpenTeam
	}: {
		chat: ChatState;
		rows: AgentRow[];
		/** Shows a subagent's conversation. Absent: rows are not links. */
		onOpen?: (row: AgentRow, how: OpenHow) => void;
		/** Stops a subagent the engine runs as a background task (its id). */
		onStop?: (id: string) => void;
		/** Stops an agent of LynShen's agent team still at work (close_agent). */
		onStopAgent?: (row: AgentRow) => void;
		/** Opens the agent team's panel (task board, messages). */
		onOpenTeam?: () => void;
	} = $props();

	const teamStop = (r: AgentRow) => !!onStopAgent && (!!r.stopping || canStop(r));
	const stoppable = (r: AgentRow) => !teamStop(r) && !!onStop && r.state === 'running' && chat.bgTasks.some((task) => task.id === r.id);
	const hasActions = (r: AgentRow) => (!!onOpen && !r.workflow) || stoppable(r) || teamStop(r);
	const how = (e: MouseEvent): OpenHow => (e.metaKey || e.ctrlKey ? 'other' : 'default');

	const budget = $derived(teamSummary(planSummary([]), rows, chat.teamBudget, false).budget);
	const board = $derived(chat.taskBoard?.length ? boardProgress(chat.taskBoard) : null);

	/** Its role (or kind), whether it runs in the background, its attempt
	 *  and a Workflow's agents done: plain text, joined. */
	const facts = (r: AgentRow) =>
		[
			r.role ? roleLabel(r.role) : r.type,
			r.background ? t('chat.team.background') : '',
			r.attempt ? `#${r.attempt}` : '',
			r.progress ? `${r.progress.done}/${r.progress.total}` : ''
		]
			.filter(Boolean)
			.join(' · ');
	/** The team's word for its state wins over its latest action (a
	 *  discarded worktree too); a failed one with no error says it failed. */
	const activity = (r: AgentRow) =>
		teamNote(r) ||
		(discardedRun(r) ? t('chat.team.discarded') : '') ||
		r.activity ||
		(r.state === 'queued' ? t('chat.progress.waiting') : r.state === 'failed' ? t('dock.agents.state.failed') : t('chat.progress.noActivity'));
	/** The tooltip: a failed one's whole error, its task, then model, tokens
	 *  and tool calls. */
	const tip = (r: AgentRow) =>
		[
			r.state === 'failed' ? r.error : '',
			r.prompt || r.label,
			[
				r.model ? shortModel(r.model) : '',
				r.tokens ? t('dock.agents.tokens', { n: formatCount(r.tokens) }) : '',
				r.toolCalls ? t('dock.agents.toolCalls', { n: r.toolCalls }) : ''
			]
				.filter(Boolean)
				.join(' · ')
		]
			.filter(Boolean)
			.join('\n');
	const stateLabel = (r: AgentRow) => (discardedRun(r) ? t('chat.team.discarded') : t(`dock.agents.state.${r.state}`));
	// A failed one's error line opens the whole error under the row (the
	// engine sends the model, the address and the provider's answer).
	let openErrors = $state<Record<string, boolean>>({});
</script>

{#if budget || board || onOpenTeam}
	<div class="meta">
		{#if budget}
			<span class="budget {budget.level}" title={t('chat.progress.budgetTitle')}>
				{#if budget.level === 'warn'}<span class="dot warn" aria-hidden="true"></span>{/if}
				<span class="num">{t('chat.progress.budget', { used: budget.used, limit: budget.limit })}</span>
			</span>
		{/if}
		{#if budget && board}<span class="sep" aria-hidden="true">·</span>{/if}
		{#if board}<span class="board" title={t('chat.progress.tasksDone', board)}>{t('chat.progress.tasksShort', board)}</span>{/if}
		<span class="grow"></span>
		{#if onOpenTeam}
			<IconButton size="xs" label={t('chat.progress.openTeam')} title={t('chat.progress.openTeam')} onclick={onOpenTeam}><UsersThreeIcon size={14} /></IconButton>
		{/if}
	</div>
{/if}
<ul class="agents">
	{#each rows as r (r.id)}
		{@const note = teamNote(r)}
		{@const error = r.state === 'failed' && !note ? r.error : ''}
		{@const open = !!error && !!openErrors[r.id]}
		<li class="agent" class:link={!!onOpen} class:haserr={!!error} data-agent={r.id}>
			<button class="amain" disabled={!onOpen} onclick={(e) => onOpen?.(r, how(e))} title={tip(r)} aria-label={t('chat.progress.open', { name: r.label })}>
				<span class="l1">
					<span class="sdot {dotTone(r)}" class:pulse={r.state === 'running'} role="img" aria-label={stateLabel(r)}></span>
					<span class="aname">{r.label}</span>
					{#if facts(r)}<span class="facts">{facts(r)}</span>{/if}
					<span class="grow"></span>
					<Elapsed row={r} />
				</span>
				{#if !error}<span class="act" class:err={r.state === 'failed' && !note}>{activity(r)}</span>{/if}
			</button>
			{#if error}
				<button class="etoggle" aria-expanded={open} title={open ? undefined : error} onclick={() => (openErrors[r.id] = !open)}>
					<span class="ecaret" class:open aria-hidden="true"><CaretRightIcon size={10} /></span>
					<span class="etext">{r.activity || error}</span>
				</button>
				{#if open}<div class="efull">{error}</div>{/if}
			{/if}
			{#if hasActions(r)}
				<span class="aacts" class:held={r.stopping}>
					{#if teamStop(r)}<StopAgent row={r} onStop={(row) => onStopAgent?.(row)} size="xs" />{/if}
					{#if stoppable(r)}
						<IconButton size="xs" label={t('chat.task.stop')} title={t('chat.task.stop')} onclick={() => onStop?.(r.id)}><StopIcon size={12} /></IconButton>
					{/if}
					{#if onOpen && !r.workflow}
						<IconButton size="xs" label={t('chat.progress.openSide')} title={t('chat.progress.openSide')} onclick={() => onOpen?.(r, 'side')}
							><SquareSplitHorizontalIcon size={12} /></IconButton
						>
						<IconButton size="xs" label={t('chat.progress.openTab')} title={t('chat.progress.openTab')} onclick={() => onOpen?.(r, 'tab')}
							><AppWindowIcon size={12} /></IconButton
						>
					{/if}
				</span>
			{/if}
		</li>
	{/each}
</ul>

<style>
	.meta {
		display: flex;
		align-items: center;
		gap: 6px;
		min-height: 24px;
		padding: 0 4px 4px 8px;
		font-size: var(--fs-xs);
		line-height: 16px;
		white-space: nowrap;
		color: var(--dim);
	}
	.board {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.grow {
		flex: 1;
	}
	.num {
		font-variant-numeric: tabular-nums;
	}
	.sep {
		color: var(--dim2);
	}
	.budget {
		display: inline-flex;
		flex: none;
		align-items: center;
		gap: 6px;
	}
	.budget.over {
		color: var(--err);
	}
	.dot {
		width: 6px;
		height: 6px;
		border-radius: var(--r-full);
	}
	.dot.warn {
		background: var(--warn);
	}
	.agents {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.agent {
		position: relative;
		border-radius: var(--r-md);
		transition: background var(--t-fast) var(--ease-base);
	}
	.agent.link:hover {
		background: var(--surface2);
	}
	.amain {
		display: flex;
		flex-direction: column;
		gap: 2px;
		width: 100%;
		padding: 5px 8px;
		border: none;
		border-radius: inherit;
		background: none;
		color: var(--text);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.amain:disabled {
		cursor: default;
	}
	.amain:focus-visible {
		outline-offset: -2px;
	}
	.l1 {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		line-height: 18px;
	}
	.sdot {
		flex: none;
		width: 6px;
		height: 6px;
		border-radius: var(--r-full);
		background: var(--dim2);
	}
	.sdot.live {
		background: var(--info);
	}
	.sdot.ok {
		background: var(--ok);
	}
	.sdot.err {
		background: var(--err);
	}
	.sdot.warn {
		background: var(--warn);
	}
	.aname {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--fs-sm);
		font-weight: 500;
	}
	.facts {
		flex: none;
		max-width: 45%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.act {
		padding-left: 12px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--fs-xs);
		line-height: 16px;
		color: var(--dim);
	}
	.act.err {
		color: var(--err);
	}
	/* A failed one: its error line (where the activity line is) opens the
	   whole error below it. */
	.agent.haserr .amain {
		padding-bottom: 2px;
	}
	.etoggle {
		display: flex;
		align-items: center;
		gap: 2px;
		width: 100%;
		padding: 0 8px 5px;
		border: none;
		border-radius: inherit;
		background: none;
		color: var(--err);
		font: inherit;
		font-size: var(--fs-xs);
		line-height: 16px;
		text-align: left;
		cursor: pointer;
	}
	.etoggle:focus-visible {
		outline-offset: -2px;
	}
	.ecaret {
		display: inline-flex;
		flex: none;
		width: 10px;
		transition: transform var(--t-fast) var(--ease-base);
	}
	.ecaret.open {
		transform: rotate(90deg);
	}
	.etext {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.efull {
		max-height: 200px;
		margin: 0 8px 6px 20px;
		padding: 6px 8px;
		overflow-y: auto;
		overscroll-behavior: contain;
		border-radius: var(--r-md);
		background: color-mix(in oklab, var(--err) 10%, transparent);
		color: var(--err);
		font-size: var(--fs-xs);
		line-height: 1.5;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		user-select: text;
	}
	/* Its actions: over the first line's right end, on hover and keyboard focus. */
	/* Solid: the hovered row's fill over the card's (--bg; --panel in a
	   popover or sheet, which set it there), so the time under it does not
	   show through. */
	.aacts {
		position: absolute;
		top: 3px;
		right: 4px;
		display: inline-flex;
		align-items: center;
		gap: 2px;
		padding: 1px;
		border-radius: var(--r-sm);
		background: linear-gradient(var(--surface2), var(--surface2)), var(--bg);
		opacity: 0;
		pointer-events: none;
		transition: opacity var(--t-fast) var(--ease-base);
	}
	.agent:hover .aacts,
	.agent:focus-within .aacts,
	.aacts.held {
		opacity: 1;
		pointer-events: auto;
	}
	.aacts :global(.ib:hover:not(:disabled)) {
		background: var(--surface2);
		color: var(--text);
	}
	.aacts :global(.ib:focus-visible) {
		outline-offset: -2px;
	}
	@media (prefers-reduced-motion: reduce) {
		.sdot.pulse {
			animation: none;
		}
		.ecaret {
			transition: none;
		}
	}
</style>
