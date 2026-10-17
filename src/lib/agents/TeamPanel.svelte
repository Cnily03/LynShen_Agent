<script lang="ts">
	// The agent team (工作组) of a LynShen session, as a workbench panel: the
	// task board by state (owner, what a task waits for, its files, its
	// result on demand), the subagents of the turn (stop one that is still at
	// work), and the messages between the agents, oldest first.
	import { onMount } from 'svelte';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import { t } from '$lib/i18n';
	import type { BoardTask, ChatState, TaskStatus } from '$lib/chat.svelte';
	import type { Op } from '$lib/protocol';
	import { agentRows, boardGroups, boardProgress, canStop, discardedRun, isLive, shortPath, waitingOn, type AgentRow } from '$lib/agentProgress';
	import StateIcon from './StateIcon.svelte';
	import Elapsed from './Elapsed.svelte';
	import StopAgent from './StopAgent.svelte';
	import AgentMessageLine from './AgentMessageLine.svelte';
	import { confirmStop } from './confirmStop';
	import { teamSwitch } from './teamSwitch.svelte';
	import { roleLabel, teamNote } from './teamText';

	let { chat, onOp, onOpenAgent }: { chat: ChatState; onOp: (op: Op) => void; onOpenAgent?: (id: string) => void } = $props();

	// The subagents of the turn (and any still at work), as the subagents card lists them.
	const rows = $derived(
		agentRows({
			runs: chat.agentRuns,
			subagents: chat.subagents,
			team: chat.team,
			stopping: chat.stopRequested,
			failed: chat.failedAgents,
			since: chat.turnStartedAt
		})
	);
	const board = $derived(chat.taskBoard ?? []);
	const groups = $derived(boardGroups(board));
	const progress = $derived(boardProgress(board));
	const running = $derived(rows.filter(isLive).length);

	onMount(() => {
		if (chat.backendId === 'lynshen') onOp({ op: 'agent_runs' });
	});

	async function stop(row: AgentRow) {
		if (await confirmStop(row)) onOp(chat.closeAgent(row.id));
	}

	const ICON: Record<TaskStatus, 'running' | 'done' | 'failed' | 'pending' | 'queued'> = {
		claimed: 'running',
		completed: 'done',
		failed: 'failed',
		pending: 'pending',
		blocked: 'queued'
	};
	const ownerOf = (task: BoardTask) => (task.owner ? rows.find((r) => r.id === task.owner) : undefined);
	/** What a task still waits for, in one line ('' for nothing). */
	function waits(task: BoardTask): string {
		if (task.status === 'completed' || task.status === 'failed') return '';
		const list = waitingOn(task, board)
			.map((w) => (w.title ? `${w.id} ${w.title}` : w.id))
			.join(t('dock.team.sep'));
		if (!list) return '';
		return t(task.status === 'blocked' ? 'dock.team.waitsFor' : 'dock.team.dependsOn', { list });
	}
	let openResults = $state<Record<string, boolean>>({});
	// A failed agent's error line opens its whole error (the engine sends the
	// model, the address and the provider's answer).
	let openErrors = $state<Record<string, boolean>>({});
</script>

<div class="panel">
	<div class="head">
		<span class="title">{t('dock.team.title')}</span>
		<span class="sum">
			{[
				progress.total ? t('chat.progress.tasksDone', progress) : '',
				running ? t('chat.progress.runningAgentsN', { n: running }) : rows.length ? t('chat.progress.agentsN', { n: rows.length }) : ''
			]
				.filter(Boolean)
				.join(' · ')}
		</span>
	</div>

	{#if !board.length && !rows.length && !chat.agentMessages.length}
		<p class="empty">{t('dock.team.noBoard')}</p>
	{:else}
		<section>
			<h4 class="sec">{t('dock.team.tasks')}{#if board.length}<span class="num">{board.length}</span>{/if}</h4>
			{#if !board.length}
				<p class="line">{t('dock.team.noBoard')}</p>
			{/if}
			{#each groups as g (g.status)}
				<div class="group">{t(`dock.team.status.${g.status}`)}<span class="num">{g.tasks.length}</span></div>
				<ul class="tasks">
					{#each g.tasks as task (task.id)}
						{@const owner = ownerOf(task)}
						{@const wait = waits(task)}
						<li class="task {task.status}">
							<StateIcon state={ICON[task.status]} size={14} label={t(`dock.team.status.${task.status}`)} />
							<div class="tcol">
								<div class="tline">
									<span class="tid">{task.id}</span>
									<span class="ttitle">{task.title || task.id}</span>
									{#if task.role}<span class="badge" title={t('chat.team.roleTitle', { role: task.role })}>{roleLabel(task.role)}</span>{/if}
									<span class="grow"></span>
									{#if task.owner}
										<button
											class="owner"
											disabled={!onOpenAgent}
											onclick={() => task.owner && onOpenAgent?.(task.owner)}
											title={t('chat.progress.open', { name: owner?.label ?? shortPath(task.owner) })}
										>
											{#if owner}<StateIcon state={owner.state} size={11} />{/if}
											<span>{owner?.label ?? shortPath(task.owner)}</span>
										</button>
									{:else if task.status === 'pending' || task.status === 'blocked'}
										<span class="unowned">{t('dock.team.unowned')}</span>
									{/if}
								</div>
								{#if task.detail}<p class="tdetail">{task.detail}</p>{/if}
								{#if wait}<p class="twait" class:blocked={task.status === 'blocked'}>{wait}</p>{/if}
								{#if task.files.length}<p class="tfiles" title={t('dock.team.files')}>{task.files.join('  ')}</p>{/if}
								{#if task.result}
									{@const open = !!openResults[task.id]}
									<button class="rtoggle" class:open aria-expanded={open} onclick={() => (openResults[task.id] = !open)}>
										<span class="caret"><CaretRightIcon size={11} /></span>{t('dock.team.result')}
									</button>
									{#if open}<div class="tres" class:err={task.status === 'failed'}>{task.result}</div>{/if}
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			{/each}
		</section>

		{#if rows.length}
			<section>
				<h4 class="sec">{t('dock.team.agents')}<span class="num">{rows.length}</span></h4>
				<ul class="agents">
					{#each rows as r (r.id)}
						{@const failed = r.state === 'failed'}
						{@const dropped = discardedRun(r)}
						{@const error = failed && !teamNote(r) ? r.error : ''}
						{@const open = !!error && !!openErrors[r.id]}
						{@const line = teamNote(r) || (dropped ? t('chat.team.discarded') : '') || r.activity || (failed ? t('dock.agents.state.failed') : '')}
						<li class="arow">
							<!-- A failed one: its whole error on hover, and its error line opens it below. -->
							<button
								class="agent"
								disabled={!onOpenAgent || r.workflow}
								onclick={() => onOpenAgent?.(r.id)}
								aria-label={t('chat.progress.open', { name: r.label })}
								title={error && !open ? error : undefined}
							>
								<!-- A discarded worktree: grey, not done. -->
								<StateIcon state={dropped ? 'skipped' : r.state} size={14} label={dropped ? t('chat.team.discarded') : t(`dock.agents.state.${r.state}`)} />
								<span class="acol">
									<span class="aline">
										<span class="aname">{r.label}</span>
										{#if r.role}<span class="badge" title={t('chat.team.roleTitle', { role: r.role })}>{roleLabel(r.role)}</span>{/if}
										{#if r.background}<span class="badge" title={t('chat.team.backgroundTitle')}>{t('chat.team.background')}</span>{/if}
										{#if r.attempt}<span class="amodel num">#{r.attempt}</span>{/if}
										{#if r.model}<span class="amodel">{r.model.replace(/^claude-/, '')}</span>{/if}
										<span class="grow"></span>
										<Elapsed row={r} />
									</span>
									{#if line && !error}<span class="act" class:err={failed} class:warn={!!teamNote(r)}>{line}</span>{/if}
								</span>
							</button>
							{#if teamSwitch.on && (r.stopping || canStop(r))}<span class="stop" class:held={r.stopping}><StopAgent row={r} onStop={stop} /></span>{/if}
							{#if error}
								<button class="etoggle" aria-expanded={open} onclick={() => (openErrors[r.id] = !open)}>
									<span class="caret" class:open aria-hidden="true"><CaretRightIcon size={11} /></span>
									<span class="etext">{line}</span>
								</button>
								{#if open}<div class="tres err efull">{error}</div>{/if}
							{/if}
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if chat.agentMessages.length}
			<section>
				<h4 class="sec">{t('dock.team.messages')}<span class="num">{chat.agentMessages.length}</span></h4>
				<div class="mail">
					{#each chat.agentMessages as m, i (i)}<AgentMessageLine from={m.from} to={m.to} summary={m.summary} />{/each}
				</div>
			</section>
		{/if}
	{/if}
</div>

<style>
	.panel {
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow-y: auto;
		overflow-x: hidden;
		padding-bottom: 20px;
	}
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: 4px 12px;
		padding: 16px 18px 6px;
	}
	.title {
		font-size: var(--fs-md);
		font-weight: 600;
	}
	.sum {
		font-size: var(--fs-xs);
		font-variant-numeric: tabular-nums;
		color: var(--dim);
	}
	.empty,
	.line {
		margin: 0;
		padding: 8px 18px;
		font-size: var(--fs-sm);
		color: var(--dim);
	}
	.line {
		padding: 2px 18px 6px;
		font-size: var(--fs-xs);
	}
	section {
		padding: 6px 12px 4px;
	}
	.sec {
		display: flex;
		align-items: baseline;
		gap: 6px;
		margin: 8px 6px 4px;
		font-size: var(--fs-xs);
		font-weight: 600;
		color: var(--dim);
	}
	.num {
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		font-weight: 400;
		font-variant-numeric: tabular-nums;
		color: var(--dim2);
	}
	.group {
		display: flex;
		align-items: baseline;
		gap: 6px;
		margin: 8px 6px 2px;
		font-size: var(--fs-2xs);
		font-weight: 500;
		color: var(--dim2);
	}
	.tasks,
	.agents {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.task {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		padding: 6px;
		border-radius: var(--r-md);
	}
	.task :global(.si) {
		margin-top: 2px;
	}
	.tcol {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.tline {
		display: flex;
		align-items: baseline;
		gap: 6px;
		min-width: 0;
	}
	.tid {
		flex: none;
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		color: var(--dim2);
	}
	.ttitle {
		min-width: 0;
		font-size: var(--fs-sm);
		line-height: 1.4;
		overflow-wrap: anywhere;
	}
	.task.completed .ttitle {
		color: var(--dim);
	}
	.badge {
		flex: none;
		padding: 0 5px;
		border-radius: var(--r-xs);
		background: var(--surface2);
		font-size: var(--fs-2xs);
		color: var(--dim);
	}
	.grow {
		flex: 1;
	}
	.owner {
		display: inline-flex;
		flex: none;
		align-items: center;
		gap: 4px;
		max-width: 140px;
		padding: 0 4px;
		border: none;
		border-radius: var(--r-xs);
		background: none;
		color: var(--dim);
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		line-height: 1.6;
		cursor: pointer;
		transition:
			background var(--t-fast) var(--ease-out),
			color var(--t-fast) var(--ease-out);
	}
	.owner span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.owner:disabled {
		cursor: default;
	}
	.owner:hover:not(:disabled) {
		background: var(--surface2);
		color: var(--text);
	}
	.unowned {
		flex: none;
		font-size: var(--fs-2xs);
		color: var(--dim2);
	}
	.tdetail,
	.twait,
	.tfiles {
		margin: 0;
		font-size: var(--fs-xs);
		line-height: 1.45;
		color: var(--dim);
		overflow-wrap: anywhere;
	}
	.tdetail {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		overflow: hidden;
	}
	.twait.blocked {
		color: var(--warn);
	}
	.tfiles {
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		white-space: pre-wrap;
	}
	.rtoggle {
		display: inline-flex;
		align-items: center;
		align-self: flex-start;
		gap: 4px;
		margin: 1px 0 0 -4px;
		padding: 1px 4px;
		border: none;
		border-radius: var(--r-xs);
		background: none;
		color: var(--dim);
		font-size: var(--fs-2xs);
		cursor: pointer;
		transition:
			background var(--t-fast) var(--ease-out),
			color var(--t-fast) var(--ease-out);
	}
	.rtoggle:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.caret {
		display: inline-flex;
		transition: transform var(--t-fast) var(--ease-out);
	}
	.rtoggle.open .caret {
		transform: rotate(90deg);
	}
	.tres {
		max-height: 240px;
		overflow-y: auto;
		padding: 6px 8px;
		border-radius: var(--r-md);
		background: var(--surface);
		font-size: var(--fs-xs);
		line-height: 1.5;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.tres.err {
		background: color-mix(in oklab, var(--err) 10%, transparent);
		color: var(--err);
	}
	.arow {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: 2px;
	}
	/* A failed agent's error line, under its name where the action line is
	   (28px: the row's padding, its icon and the gap), and its whole error. */
	.etoggle {
		display: flex;
		flex-basis: 100%;
		align-items: center;
		gap: 2px;
		min-width: 0;
		margin-top: -6px;
		padding: 0 6px 6px 14px;
		border: none;
		border-radius: var(--r-md);
		background: none;
		color: var(--err);
		font: inherit;
		font-size: var(--fs-xs);
		text-align: left;
		cursor: pointer;
	}
	.etoggle:focus-visible {
		outline-offset: -2px;
	}
	.etoggle .caret {
		justify-content: center;
		width: 12px;
	}
	.etoggle .caret.open {
		transform: rotate(90deg);
	}
	.etext {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.efull {
		flex-basis: 100%;
		margin: 0 6px 6px 28px;
		overscroll-behavior: contain;
		user-select: text;
	}
	.agent {
		display: flex;
		flex: 1;
		align-items: flex-start;
		gap: 8px;
		min-width: 0;
		padding: 6px;
		border: none;
		border-radius: var(--r-md);
		background: none;
		color: var(--text);
		text-align: left;
		cursor: pointer;
		transition: background var(--t-fast) var(--ease-out);
	}
	.agent:disabled {
		cursor: default;
	}
	.agent:hover:not(:disabled) {
		background: var(--surface2);
	}
	.agent :global(.si) {
		margin-top: 2px;
	}
	.acol {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}
	.aline {
		display: flex;
		align-items: baseline;
		gap: 6px;
		min-width: 0;
	}
	.aname {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--fs-sm);
		font-weight: 500;
	}
	.amodel {
		flex: none;
		max-width: 120px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		color: var(--dim2);
	}
	.act {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.act.err {
		color: var(--err);
	}
	.act.warn {
		color: var(--warn);
	}
	/* The stop button shows on hover and keyboard focus. */
	.stop {
		display: inline-flex;
		flex: none;
		margin-top: 2px;
		opacity: 0;
		transition: opacity var(--t-fast) var(--ease-out);
	}
	.arow:hover .stop,
	.arow:focus-within .stop,
	.stop.held {
		opacity: 1;
	}
	.mail {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 0 6px;
	}
</style>
