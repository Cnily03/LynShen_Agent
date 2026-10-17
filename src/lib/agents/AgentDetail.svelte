<script lang="ts">
	// One subagent: who it is (state, kind, model, time, tokens, tool calls,
	// its result or error), then its own conversation, read-only. Shown in the
	// agent trace panel and in a subagent's own page (beside the chat or as a
	// tab of its own). In LynShen's agent team: its role, the messages it sent
	// and received, and a stop button while it is at work (agent team v2).
	import { t } from '$lib/i18n';
	import AgentTranscript from './AgentTranscript.svelte';
	import AgentMessageLine from './AgentMessageLine.svelte';
	import StateIcon from './StateIcon.svelte';
	import StopAgent from './StopAgent.svelte';
	import { confirmStop } from './confirmStop';
	import { teamSwitch } from './teamSwitch.svelte';
	import { roleLabel } from './teamText';
	import type { AgentRun, ChatState, WorkflowRun } from '$lib/chat.svelte';
	import type { Op } from '$lib/protocol';
	import { elapsed, formatCount, formatDuration, shortModel } from '$lib/agentTrace';
	import { agentOutcome, agentRows, discardedRun, shortPath, type AgentRow } from '$lib/agentProgress';

	let {
		chat,
		agentId,
		scroller,
		onOp
	}: {
		chat: ChatState;
		agentId: string;
		/** The scroll viewport the conversation sits in. */
		scroller: HTMLElement | null;
		onOp: (op: Op) => void;
	} = $props();

	const units = $derived({ s: t('dock.agents.unit.s'), m: t('dock.agents.unit.m'), h: t('dock.agents.unit.h') });

	const focused = $derived.by((): { agent: AgentRun; run: WorkflowRun | null } | null => {
		for (const w of chat.agentRuns.workflows) {
			const a = w.agents.find((x) => x.id === agentId);
			if (a) return { agent: a, run: w };
		}
		const a = chat.agentRuns.agents.find((x) => x.id === agentId);
		return a ? { agent: a, run: null } : null;
	});
	// Known from its lifecycle only (an engine without the trace).
	const life = $derived(chat.subagents[agentId]);
	// A run that failed stays failed past a merge or discard of its worktree.
	const outcome = $derived(agentOutcome(focused?.agent.state ?? life?.status ?? '', focused?.agent.error ?? '', chat.failedAgents[agentId]));
	const status = $derived(outcome.state);
	const running = $derived(status === 'running');
	// Its worktree discarded: grey, not done.
	const dropped = $derived(discardedRun({ state: status, status: focused?.agent.state ?? life?.status ?? '' }));
	const iconState = $derived(dropped ? 'skipped' : status);
	const stateWord = $derived(dropped ? t('chat.team.discarded') : t(`dock.agents.state.${status}`));

	// LynShen's agent team: the subagent shown can be stopped while at work
	// (agent team v2).
	const stopRow = $derived(
		chat.backendId === 'lynshen' && teamSwitch.on
			? agentRows({ runs: chat.agentRuns, subagents: chat.subagents, team: chat.team, stopping: chat.stopRequested, failed: chat.failedAgents }).find(
					(r) => r.id === agentId
				)
			: undefined
	);
	async function stopAgent(row: AgentRow) {
		if (await confirmStop(row)) onOp(chat.closeAgent(row.id));
	}
	const role = $derived(chat.team[agentId]?.role ?? '');
	// The messages it sent and received in the agent team.
	const mail = $derived(chat.messagesOf(agentId));

	let now = $state(Date.now());
	$effect(() => {
		if (!running) return;
		now = Date.now();
		const id = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(id);
	});
</script>

{#if focused}
	{@const a = focused.agent}
	<div class="head">
		<div class="title">
			<StateIcon state={iconState} size={15} label={stateWord} />
			<span class="name">{a.label || a.id}</span>
			{#if role}<span class="kind" title={t('chat.team.roleTitle', { role })}>{roleLabel(role)}</span>
			{:else if a.type}<span class="kind">{a.type}</span>{/if}
			<span class="grow"></span>
			{#if stopRow}<StopAgent row={stopRow} onStop={stopAgent} />{/if}
		</div>
		<div class="meta">
			{#if focused.run}<span>{focused.run.name || focused.run.description}</span>{/if}
			{#if a.model}<span class="mono">{shortModel(a.model)}</span>{/if}
			<span>{stateWord}</span>
			<span class="num">{formatDuration(elapsed(a, status, now), units)}</span>
			{#if a.tokens}<span class="num">{t('dock.agents.tokens', { n: formatCount(a.tokens) })}</span>{/if}
			{#if a.toolCalls}<span class="num">{t('dock.agents.toolCalls', { n: a.toolCalls })}</span>{/if}
		</div>
		{#if outcome.error}<p class="err">{outcome.error}</p>{/if}
		{#if a.result && status !== 'running'}<p class="res"><span>{t('dock.agents.result')}</span>{a.result}</p>{/if}
	</div>
{:else if life}
	<div class="head">
		<div class="title">
			<StateIcon state={iconState} size={15} label={stateWord} />
			<span class="name">{shortPath(life.label || agentId)}</span>
			{#if role}<span class="kind" title={t('chat.team.roleTitle', { role })}>{roleLabel(role)}</span>{/if}
			<span class="grow"></span>
			{#if stopRow}<StopAgent row={stopRow} onStop={stopAgent} />{/if}
		</div>
		<div class="meta">
			{#if life.model}<span class="mono">{shortModel(life.model)}</span>{/if}
			<span>{stateWord}</span>
		</div>
		{#if outcome.error}<p class="err">{outcome.error}</p>{/if}
	</div>
{/if}
{#if mail.length}
	<div class="mail">
		{#each mail as m, i (i)}<AgentMessageLine from={m.from} to={m.to} summary={m.summary} />{/each}
	</div>
{/if}
{#key agentId}
	<AgentTranscript {chat} {agentId} live={running} {scroller} {onOp} />
{/key}

<style>
	.head {
		padding: 4px 18px 10px;
	}
	.title {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	.name {
		min-width: 0;
		overflow-wrap: anywhere;
		font-size: var(--fs-md);
		font-weight: 600;
	}
	.grow {
		flex: 1;
	}
	.mail {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 0 18px 8px;
	}
	.kind {
		flex: none;
		padding: 1px 7px;
		border-radius: var(--r-full);
		background: var(--surface2);
		color: var(--dim);
		font-size: var(--fs-2xs);
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 12px;
		margin-top: 6px;
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.mono {
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
	}
	.num {
		font-variant-numeric: tabular-nums;
	}
	.res {
		margin: 8px 0 0;
		font-size: var(--fs-sm);
		line-height: 1.5;
		overflow-wrap: anywhere;
	}
	.res span {
		margin-right: 8px;
		color: var(--dim);
		font-size: var(--fs-xs);
	}
	/* The whole error: the engine sends the model, the address and the
	   provider's answer, on several lines. */
	.err {
		margin: 6px 0 0;
		font-size: var(--fs-xs);
		color: var(--err);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
</style>
