<script lang="ts">
	// A subagent call in the conversation: a spawn (spawn_agent, claude's Task /
	// Agent) as the agent it started — name, role, model, the task's first
	// line, its state, time, changed files and latest action — and a wait as
	// the agents it waits on with theirs. A click shows the agent's own
	// conversation. An agent that wrote in a worktree of its own offers its
	// changes: view them, merge them into the project, or drop them. One
	// still at work can be stopped; one in the background says so.
	import RobotIcon from 'phosphor-svelte/lib/RobotIcon';
	import GitDiffIcon from 'phosphor-svelte/lib/GitDiffIcon';
	import GitMergeIcon from 'phosphor-svelte/lib/GitMergeIcon';
	import WarningIcon from 'phosphor-svelte/lib/WarningIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import HourglassMediumIcon from 'phosphor-svelte/lib/HourglassMediumIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import { t } from '$lib/i18n';
	import {
		canStop,
		discardedRun,
		mergeView,
		shortPath,
		spawnAgentRow,
		spawnPayload,
		WAIT_TOOLS,
		waitTargets,
		type AgentRow,
		type MergeView
	} from '$lib/agentProgress';
	import Button from '$lib/ui/Button.svelte';
	import { confirm } from '$lib/ui/confirm.svelte';
	import StateIcon from './StateIcon.svelte';
	import Elapsed from './Elapsed.svelte';
	import StopAgent from './StopAgent.svelte';
	import { roleLabel, teamNote } from './teamText';
	import type { OpenHow } from './subagentPages.svelte';

	let {
		name,
		callId,
		output,
		args = '',
		running,
		isError,
		rows,
		onOpen,
		onViewChanges,
		onMerge,
		onStop
	}: {
		name: string;
		callId: string;
		output: string;
		args?: string;
		running: boolean;
		isError: boolean;
		/** Every subagent of the conversation (see agentRows). */
		rows: AgentRow[];
		onOpen?: (row: AgentRow, how: OpenHow) => void;
		/** Shows a worktree agent's changes (the Changes panel at its workdir). */
		onViewChanges?: (row: AgentRow) => void;
		/** Sends merge_agent for it: `apply` merges, `discard` drops its worktree. */
		onMerge?: (row: AgentRow, action: 'apply' | 'discard') => void;
		/** Stops it (close_agent) while it is at work. */
		onStop?: (row: AgentRow) => void;
	} = $props();

	const wait = $derived(WAIT_TOOLS.has(name));
	const payload = $derived.by(() => {
		const a = spawnPayload(args);
		const o = spawnPayload(output);
		return { name: a.name || o.name, task: a.task || o.task, path: o.path || a.path };
	});
	// The agent it started: by the call, else by the path it names.
	const agent = $derived(wait ? undefined : spawnAgentRow(rows, callId, args, output));
	const label = $derived(agent?.label || shortPath(payload.name || payload.path) || t('chat.subagentCard.spawn'));
	const task = $derived((payload.task || agent?.prompt || '').split('\n').find((l) => l.trim())?.trim() ?? '');
	const state = $derived(agent?.state ?? (isError ? 'failed' : running ? 'running' : 'unknown'));
	// Its worktree changes and what became of them.
	const merge = $derived<MergeView | null>(agent ? mergeView(agent) : null);
	// A conflict shows under the card with its files, not in the activity line.
	const note = $derived(agent && merge?.state !== 'conflict' ? teamNote(agent) : '');
	const activity = $derived(
		isError
			? errorLine(output)
			: running && !agent
				? t('chat.subagentCard.starting')
				: note || agent?.activity || (state === 'failed' ? t('dock.agents.state.failed') : '')
	);
	// A stop button takes the place of the open arrow while it works.
	const stoppable = $derived(!!agent && !!onStop && (!!agent.stopping || canStop(agent)));
	const fileCount = $derived(merge && merge.state !== 'none' ? merge.files.length : (agent?.team?.files.length ?? 0));
	function mergeLabel(m: MergeView): string {
		switch (m.state) {
			case 'ready':
				return t('chat.team.ready', { n: m.files.length });
			case 'pending':
				return t(agent?.team?.pending === 'discard' ? 'chat.team.discarding' : 'chat.team.merging');
			case 'applied':
				return t('chat.team.applied', { n: m.files.length });
			case 'discarded':
				return t('chat.team.discarded');
			case 'failed':
				return m.error ? t('chat.team.failedWhy', { error: m.error }) : t('chat.team.failed');
			default:
				return '';
		}
	}
	async function discard(row: AgentRow, files: number) {
		const ok = await confirm({
			title: t('chat.team.discardTitle', { name: row.label }),
			message: t('chat.team.discardMessage', { name: row.label, n: files }),
			confirmLabel: t('chat.team.discard'),
			danger: true
		});
		if (ok) onMerge?.(row, 'discard');
	}

	// The agents a wait names, with their state now (the trace's, else the
	// wait's own answer).
	const targets = $derived(
		wait
			? waitTargets(output).map((w) => {
					const known = rows.find((r) => r.id === w.id || r.label === shortPath(w.id) || r.label === w.id);
					return { id: w.id, label: known?.label ?? shortPath(w.id), state: known?.state ?? w.state, row: known, timedOut: w.timedOut };
				})
			: []
	);
	// While a wait runs it names no one yet: the agents running now.
	const waitingOn = $derived(
		targets.length ? targets : running ? rows.filter((r) => r.state === 'running').map((r) => ({ id: r.id, label: r.label, state: r.state, row: r, timedOut: false })) : []
	);
	const timedOut = $derived(targets.some((x) => x.timedOut));

	function errorLine(out: string): string {
		try {
			const o = JSON.parse(out) as Record<string, unknown>;
			if (typeof o.error === 'string') return o.error;
		} catch {
			/* plain text */
		}
		return out.split('\n')[0] ?? '';
	}
</script>

{#if wait}
	<div class="sa wait">
		<div class="head">
			<span class="ico"><HourglassMediumIcon size={14} /></span>
			<span class="title">{waitingOn.length ? t('chat.subagentCard.waitN', { n: waitingOn.length }) : t('chat.subagentCard.wait')}</span>
			{#if timedOut}<span class="tag">{t('chat.subagentCard.timedOut')}</span>{/if}
			{#if running}<StateIcon state="running" size={12} />{/if}
		</div>
		{#if waitingOn.length}
			<div class="targets">
				{#each waitingOn as w (w.id)}
					<button class="target" disabled={!onOpen || !w.row} onclick={(e) => w.row && onOpen?.(w.row, e.metaKey || e.ctrlKey ? 'other' : 'default')} title={w.id}>
						<StateIcon state={w.state} size={12} label={t(`dock.agents.state.${w.state === 'unknown' ? 'queued' : w.state}`)} />
						<span>{w.label}</span>
					</button>
				{/each}
			</div>
		{/if}
	</div>
{:else}
	<div class="sa box" class:link={!!onOpen && !!agent}>
		<div class="top">
			<button class="spawn" disabled={!onOpen || !agent} onclick={(e) => agent && onOpen?.(agent, e.metaKey || e.ctrlKey ? 'other' : 'default')} aria-label={t('chat.progress.open', { name: label })}>
				<span class="ico"><RobotIcon size={15} /></span>
				<span class="col">
					<span class="line">
						<span class="name">{label}</span>
						{#if agent?.role}<span class="role" title={t('chat.team.roleTitle', { role: agent.role })}>{roleLabel(agent.role)}</span>{/if}
						{#if agent?.background}<span class="role" title={t('chat.team.backgroundTitle')}>{t('chat.team.background')}</span>{/if}
						{#if agent?.model}<span class="model">{agent.model.replace(/^claude-/, '')}</span>{/if}
						<span class="grow"></span>
						{#if fileCount}<span class="files" title={t('chat.team.filesTitle')}>{t('chat.team.filesN', { n: fileCount })}</span>{/if}
						{#if agent}<Elapsed row={agent} />{/if}
						<!-- A discarded worktree: grey, not done (the line under the card says so). -->
						{#if agent && discardedRun(agent)}<StateIcon state="skipped" size={14} label={t('chat.team.discarded')} />
						{:else}<StateIcon state={state} size={14} label={state === 'unknown' ? '' : t(`dock.agents.state.${state}`)} />{/if}
					</span>
					{#if task}<span class="task">{task}</span>{/if}
					{#if activity}<span class="act" class:err={state === 'failed'} class:warn={!!note} title={state === 'failed' && agent?.error ? agent.error : undefined}>{activity}</span>{/if}
				</span>
				{#if onOpen && agent && !stoppable}<span class="go"><CaretRightIcon size={13} /></span>{/if}
			</button>
			{#if agent && onStop && stoppable}<span class="stop"><StopAgent row={agent} {onStop} /></span>{/if}
		</div>
		{#if agent && merge && merge.state !== 'none'}
			{@const m = merge}
			<div class="team">
				{#if m.state === 'conflict'}
					<div class="cbox" role="alert">
						<span class="ctitle"><WarningIcon size={13} />{t('chat.team.conflict')}</span>
						{#if m.conflicts.length}
							<ul class="cfiles">
								{#each m.conflicts as f (f)}<li>{f}</li>{/each}
							</ul>
						{/if}
					</div>
				{/if}
				<div class="actions">
					<span class="mstate {m.state}">
						{#if m.state === 'pending'}<CircleNotchIcon size={12} class="spin" />{/if}
						{mergeLabel(m)}
					</span>
					<span class="grow"></span>
					<Button size="sm" variant="ghost" disabled={!m.actionable || !onViewChanges} onclick={() => onViewChanges?.(agent)}>
						<GitDiffIcon size={13} />{t('chat.team.viewChanges')}
					</Button>
					<Button size="sm" variant="secondary" disabled={!m.actionable || !onMerge} onclick={() => onMerge?.(agent, 'apply')}>
						<GitMergeIcon size={13} />{t('chat.team.merge')}
					</Button>
					<Button size="sm" variant="ghost" disabled={!m.actionable || !onMerge} onclick={() => discard(agent, m.files.length)}>
						{t('chat.team.discard')}
					</Button>
				</div>
			</div>
		{/if}
	</div>
{/if}

<style>
	.sa {
		display: flex;
		max-width: min(560px, 100%);
		border-radius: var(--r-lg);
		background: var(--surface);
		box-shadow: inset 0 0 0 1px var(--hairline);
		color: var(--text);
	}
	.box {
		flex-direction: column;
		width: 100%;
		overflow: hidden;
		transition: background var(--t-fast) var(--ease-out);
	}
	.box.link:has(.spawn:hover) {
		background: var(--surface2);
	}
	.top {
		display: flex;
		align-items: flex-start;
		min-width: 0;
	}
	.stop {
		display: inline-flex;
		flex: none;
		margin: 8px 8px 0 0;
	}
	.spawn {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		width: 100%;
		padding: 10px 12px;
		border: none;
		background: none;
		color: inherit;
		text-align: left;
		font: inherit;
		cursor: default;
	}
	.box.link .spawn {
		cursor: pointer;
	}
	.wait {
		flex-direction: column;
		gap: 6px;
		padding: 8px 12px;
		background: none;
	}
	.ico {
		display: inline-flex;
		flex: none;
		margin-top: 2px;
		color: var(--dim);
	}
	.wait .ico {
		margin-top: 0;
	}
	.col {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex: 1;
		min-width: 0;
	}
	.line,
	.head {
		display: flex;
		align-items: center;
		gap: 7px;
		min-width: 0;
	}
	.name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--fs-sm);
		font-weight: 600;
	}
	.title {
		font-size: var(--fs-sm);
		font-weight: 500;
		color: var(--dim);
	}
	.model {
		flex: none;
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		color: var(--dim2);
	}
	.role {
		flex: none;
		padding: 0 6px;
		border-radius: var(--r-xs);
		background: var(--surface2);
		font-size: var(--fs-2xs);
		line-height: 1.6;
		color: var(--dim);
	}
	.files {
		flex: none;
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		font-variant-numeric: tabular-nums;
		color: var(--dim);
	}
	.team {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 0 12px 10px 37px;
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}
	.mstate {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--fs-2xs);
		color: var(--dim);
	}
	.mstate.applied {
		color: var(--ok);
	}
	.mstate.conflict {
		color: var(--warn);
	}
	.mstate.failed {
		color: var(--err);
	}
	.cbox {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 8px 10px;
		border-radius: var(--r-md);
		background: color-mix(in oklab, var(--warn) 10%, transparent);
		color: var(--warn);
		font-size: var(--fs-xs);
	}
	.ctitle {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-weight: 500;
	}
	.cfiles {
		margin: 0;
		padding: 0 0 0 19px;
		list-style: none;
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		color: var(--text);
	}
	.cfiles li {
		overflow-wrap: anywhere;
	}
	.grow {
		flex: 1;
	}
	.task {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.act {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--fs-2xs);
		color: var(--dim2);
	}
	.act.err {
		color: var(--err);
	}
	.act.warn {
		color: var(--warn);
	}
	.tag {
		font-size: var(--fs-2xs);
		color: var(--warn);
	}
	.go {
		display: inline-flex;
		align-self: center;
		color: var(--dim2);
	}
	.targets {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		padding-left: 21px;
	}
	.target {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 3px 9px;
		border: none;
		border-radius: var(--r-full);
		background: var(--surface2);
		color: var(--text);
		font-size: var(--fs-xs);
		cursor: pointer;
		transition: background var(--t-fast) var(--ease-out);
	}
	.target:disabled {
		cursor: default;
	}
	.target:hover:not(:disabled) {
		background: color-mix(in oklab, var(--text) 10%, transparent);
	}
</style>
