<script lang="ts">
	// Best-of-N in the conversation: the agents that try the same task (one
	// attempt group) as one card, their attempts side by side (stacked when
	// the card is narrow) with state, model, time, changed files and lines.
	// Each attempt's changes can be viewed; picking one merges it and
	// discards the others (pick_attempt), after which the card says which.
	import StackIcon from 'phosphor-svelte/lib/StackIcon';
	import GitDiffIcon from 'phosphor-svelte/lib/GitDiffIcon';
	import GitMergeIcon from 'phosphor-svelte/lib/GitMergeIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import { t } from '$lib/i18n';
	import { attemptState, isLive, mergeView, shortPath, type AgentRow, type AttemptState } from '$lib/agentProgress';
	import Button from '$lib/ui/Button.svelte';
	import StateIcon from './StateIcon.svelte';
	import Elapsed from './Elapsed.svelte';
	import StopAgent from './StopAgent.svelte';
	import { teamNote } from './teamText';
	import type { OpenHow } from './subagentPages.svelte';

	let {
		group,
		rows,
		picked = '',
		onOpen,
		onViewChanges,
		onPick,
		onStop
	}: {
		/** The task the attempts are at (their attempt_group). */
		group: string;
		/** Its attempts, by number (see attemptGroups). */
		rows: AgentRow[];
		/** The attempt picked (its path; '' for none yet). */
		picked?: string;
		onOpen?: (row: AgentRow, how: OpenHow) => void;
		onViewChanges?: (row: AgentRow) => void;
		/** Sends pick_attempt: merge `row`, discard the others. */
		onPick?: (group: string, row: AgentRow) => void;
		onStop?: (row: AgentRow) => void;
	} = $props();

	const views = $derived(
		rows.map((r, i) => {
			const merge = mergeView(r);
			const a = r.team;
			return {
				row: r,
				n: r.attempt ?? i + 1,
				state: attemptState(r),
				merge,
				files: merge.state !== 'none' ? merge.files.length : (a?.files.length ?? 0),
				diff: a?.diff && (a.diff.added || a.diff.removed) ? a.diff : null
			};
		})
	);
	// The pick is settled once an attempt merged, or on its way while the
	// merges run; a pick that conflicted or failed can be made again.
	const merged = $derived(views.find((v) => v.state === 'merged'));
	const moving = $derived(views.some((v) => v.state === 'merging' || v.state === 'discarding'));
	const chosen = $derived(merged ?? (moving ? views.find((v) => v.row.id === picked) : undefined));
	const summary = $derived.by(() => {
		if (chosen) return t('chat.attempts.picked', { n: chosen.n });
		const running = rows.filter(isLive).length;
		const done = rows.filter((r) => r.state === 'done').length;
		return [running ? t('chat.attempts.running', { n: running }) : '', done ? t('chat.attempts.done', { n: done }) : ''].filter(Boolean).join(' · ');
	});
	const canPick = (v: (typeof views)[number]) =>
		!!onPick && !chosen && !moving && v.row.state === 'done' && (v.state === 'open' || v.state === 'conflict' || v.state === 'failed');

	const LABEL: Partial<Record<AttemptState, string>> = {
		merging: 'chat.team.merging',
		discarding: 'chat.team.discarding',
		merged: 'chat.attempts.merged',
		discarded: 'chat.attempts.discarded',
		conflict: 'chat.team.conflict'
	};
	function stateLine(v: (typeof views)[number]): string {
		if (v.state === 'failed') return v.merge.error ? t('chat.team.failedWhy', { error: v.merge.error }) : t('chat.team.failed');
		const key = LABEL[v.state];
		return key ? t(key) : '';
	}
</script>

<div class="ag">
	<div class="head">
		<span class="ico"><StackIcon size={15} /></span>
		<span class="title">{t('chat.attempts.title', { n: rows.length })}</span>
		<span class="task" title={group}>{shortPath(group)}</span>
		<span class="grow"></span>
		{#if summary}<span class="sum" class:ok={!!merged}>{summary}</span>{/if}
	</div>
	<div class="attempts">
		{#each views as v (v.row.id)}
			{@const r = v.row}
			{@const line = stateLine(v)}
			<div class="att" class:dropped={v.state === 'discarded'}>
				<div class="ahead">
					<button class="aname" disabled={!onOpen} onclick={(e) => onOpen?.(r, e.metaKey || e.ctrlKey ? 'other' : 'default')} title={r.label} aria-label={t('chat.progress.open', { name: r.label })}>
						<StateIcon state={r.state} size={13} label={t(`dock.agents.state.${r.state}`)} />
						<span>{t('chat.attempts.attempt', { n: v.n })}</span>
					</button>
					<span class="grow"></span>
					<Elapsed row={r} />
					{#if onStop}<StopAgent row={r} {onStop} size="xs" />{/if}
				</div>
				{#if r.model}<span class="model">{r.model.replace(/^claude-/, '')}</span>{/if}
				{#if teamNote(r) || r.activity}<span class="act" class:err={r.state === 'failed'}>{teamNote(r) || r.activity}</span>{/if}
				<span class="stats">
					{#if v.files}{t('chat.team.filesN', { n: v.files })}{:else if !isLive(r)}{t('chat.attempts.noChanges')}{/if}
					{#if v.diff}<span class="add">+{v.diff.added}</span> <span class="del">−{v.diff.removed}</span>{/if}
				</span>
				{#if line}
					<span class="mstate {v.state}">
						{#if v.state === 'merging' || v.state === 'discarding'}<CircleNotchIcon size={12} class="spin" />{/if}
						{line}
					</span>
				{/if}
				{#if !isLive(r) && (v.state === 'open' || v.state === 'conflict' || v.state === 'failed')}
					<div class="actions">
						<Button size="sm" variant="ghost" disabled={!onViewChanges || !v.merge.actionable} onclick={() => onViewChanges?.(r)}>
							<GitDiffIcon size={13} />{t('chat.team.viewChanges')}
						</Button>
						{#if !chosen && onPick}
							<Button size="sm" variant="secondary" disabled={!canPick(v)} onclick={() => onPick?.(group, r)} title={t('chat.attempts.pickTitle')}>
								<GitMergeIcon size={13} />{t('chat.attempts.pick')}
							</Button>
						{/if}
					</div>
				{/if}
			</div>
		{/each}
	</div>
</div>

<style>
	.ag {
		display: flex;
		flex-direction: column;
		width: 100%;
		border-radius: var(--r-lg);
		background: var(--surface);
		box-shadow: inset 0 0 0 1px var(--hairline);
		color: var(--text);
		overflow: hidden;
		container-type: inline-size;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 7px;
		min-width: 0;
		padding: 10px 12px;
	}
	.ico {
		display: inline-flex;
		flex: none;
		color: var(--dim);
	}
	.title {
		flex: none;
		font-size: var(--fs-sm);
		font-weight: 600;
	}
	.task {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		color: var(--dim);
	}
	.grow {
		flex: 1;
	}
	.sum {
		flex: none;
		font-size: var(--fs-2xs);
		color: var(--dim);
	}
	.sum.ok {
		color: var(--ok);
	}
	.attempts {
		display: flex;
		border-top: 1px solid var(--hairline);
	}
	.att {
		display: flex;
		flex: 1 1 0;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
		padding: 8px 12px 10px;
	}
	.att + .att {
		border-left: 1px solid var(--hairline);
	}
	/* Narrow: the attempts stack. */
	@container (max-width: 480px) {
		.attempts {
			flex-direction: column;
		}
		.att + .att {
			border-left: none;
			border-top: 1px solid var(--hairline);
		}
	}
	.ahead {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		min-height: 22px;
	}
	.aname {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		margin-left: -4px;
		padding: 1px 4px;
		border: none;
		border-radius: var(--r-xs);
		background: none;
		color: var(--text);
		font-size: var(--fs-xs);
		font-weight: 600;
		cursor: pointer;
		transition: background var(--t-fast) var(--ease-out);
	}
	.aname span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.aname:disabled {
		cursor: default;
	}
	.aname:hover:not(:disabled) {
		background: var(--surface2);
	}
	.dropped .aname {
		color: var(--dim);
	}
	.model {
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
		font-size: var(--fs-2xs);
		color: var(--dim);
	}
	.act.err {
		color: var(--err);
	}
	.stats {
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		font-variant-numeric: tabular-nums;
		color: var(--dim);
	}
	.add {
		margin-left: 6px;
		color: var(--ok);
	}
	.del {
		color: var(--err);
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
	.mstate.merged {
		color: var(--ok);
	}
	.mstate.conflict {
		color: var(--warn);
	}
	.mstate.failed {
		color: var(--err);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 4px;
	}
</style>
