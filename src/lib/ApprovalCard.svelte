<script lang="ts">
	import ShieldWarningIcon from 'phosphor-svelte/lib/ShieldWarningIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import RobotIcon from 'phosphor-svelte/lib/RobotIcon';
	import ChatCircleDotsIcon from 'phosphor-svelte/lib/ChatCircleDotsIcon';
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon';
	import ClipboardTextIcon from 'phosphor-svelte/lib/ClipboardTextIcon';
	import CopyIcon from 'phosphor-svelte/lib/CopyIcon';
	import DownloadSimpleIcon from 'phosphor-svelte/lib/DownloadSimpleIcon';
	import { t } from '$lib/i18n';
	import Button from '$lib/ui/Button.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import Markdown from '$lib/Markdown.svelte';
	import {
		allHunkIds,
		buildApproveOp,
		selectionState,
		toggleHunk,
		type ApprovalHunk,
		type AlwaysScope,
		type ApproveOp,
		type Question
	} from '$lib/approval';
	import PopMenu from '$lib/ui/PopMenu.svelte';
	import { openExternal } from '$lib/openExternal';
	import TerminalWindowIcon from 'phosphor-svelte/lib/TerminalWindowIcon';
	import {
		approvalChoices,
		baseName,
		buildSandboxApproveOp,
		TERMINAL_FEEDBACK,
		type SandboxAnswer,
		type SandboxRequest
	} from '$lib/sandbox/request';

	let {
		approval,
		onRespond,
		ruleScopes = false,
		keys = true,
		remote = false,
		onTerminal
	}: {
		approval: {
			callId: string;
			name: string;
			summary: string;
			subagentId: string | null;
			hunks: ApprovalHunk[] | null;
			questions?: Question[] | null;
			/** An MCP elicitation's page to open. */
			url?: string;
			/** Where this request's always-allow can be kept (Codex: the session,
			 *  or a rule for commands like it). */
			scopes?: AlwaysScope[];
			/** A LynShen sandbox request (kind, reason, scopes…). */
			sandbox?: SandboxRequest;
		};
		onRespond: (op: ApproveOp) => void;
		/** 始终允许 asks where to keep the rule (caps.ruleScopes). */
		ruleScopes?: boolean;
		/** Answers the 1/2/3 keys (only the active pane's card). */
		keys?: boolean;
		/** On the phone: what needs the computer (admin rights) says so. */
		remote?: boolean;
		/** Opens a terminal in `cwd` with `command` typed, not run (在终端里运行). */
		onTerminal?: (command: string, cwd: string) => void;
	} = $props();

	// --- LynShen sandbox requests: title by kind, reason / command / cwd,
	// answers from the scopes the engine allows (a must-ask request gets no
	// more), a deny that tells the agent what to do instead.
	const sbx = $derived(approval.sandbox ?? null);
	const choices = $derived(sbx ? approvalChoices(sbx, { terminal: !!onTerminal && !remote }) : null);
	let feedbackOpen = $state(false);
	let feedback = $state('');
	let cmdOpen = $state(false);
	const clip = (s: string, n = 32) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
	function answer(a: SandboxAnswer) {
		onRespond(buildSandboxApproveOp(approval.callId, a));
	}
	function runInTerminal() {
		if (!sbx || !onTerminal) return;
		onTerminal(sbx.command, sbx.cwd);
		answer({ type: 'deny', feedback: TERMINAL_FEEDBACK });
	}
	function openFeedback() {
		feedbackOpen = true;
	}
	function sendDeny() {
		answer({ type: 'deny', feedback });
	}
	function onFeedbackKey(e: KeyboardEvent) {
		if (e.isComposing) return;
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			sendDeny();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			feedbackOpen = false;
			feedback = '';
		}
	}
	const focusOnMount = (el: HTMLElement) => el.focus();
	/** The answer key 2 gives: the narrowest wider-than-once answer offered. */
	const secondKey = $derived<SandboxAnswer | null>(
		!choices || !sbx
			? null
			: choices.session
				? { type: 'session' }
				: choices.pathSession
					? { type: 'dir', path: choices.target, persist: 'session' }
					: choices.project
						? { type: 'project' }
						: null
	);

	// An MCP server asking the user (claude elicitation): accept / decline,
	// with its page to open when it names one; never an always-allow rule.
	const isElicitation = $derived(approval.name === 'mcp_elicitation');
	let scopeOpen = $state(false);
	const scopeKeys = $derived<AlwaysScope[] | null>(
		approval.scopes?.length ? approval.scopes : ruleScopes ? ['session', 'project', 'user'] : null
	);
	const scopeItems = $derived(
		(scopeKeys ?? []).map((key) => ({
			key,
			label: t(`shell.alwaysScope.${key}`),
			desc: t(`shell.alwaysScope.${key}Desc`)
		}))
	);
	// Keys for the plain allow / deny card (not questions, hunks or plans):
	// 1 / y allow once, 2 / a always, 3 / n / Esc deny. Never while the user
	// types somewhere, nor within a second of the last keystroke (a sentence
	// in the composer must not answer a card that just appeared).
	let lastTyped = 0;
	function onKey(e: KeyboardEvent) {
		if (!keys || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
		const el = document.activeElement as HTMLElement | null;
		const typing = !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
		if (typing) {
			lastTyped = Date.now();
			if (e.key !== 'Escape') return;
		}
		if (Date.now() - lastTyped < 1000 || questions || approval.hunks?.length || isPlan) return;
		const key = e.key.toLowerCase();
		if (sbx && choices) {
			if (feedbackOpen && key !== 'escape') return;
			if (key === '1' || key === 'y') {
				e.preventDefault();
				if (choices.terminal) runInTerminal();
				else answer({ type: 'once' });
			} else if ((key === '2' || key === 'a') && secondKey) {
				e.preventDefault();
				answer(secondKey);
			} else if (key === '3' || key === 'n') {
				e.preventDefault();
				openFeedback();
			} else if (key === 'escape' && !typing && !feedbackOpen) {
				e.preventDefault();
				answer({ type: 'deny' });
			}
			return;
		}
		let op: ApproveOp | null = null;
		if (key === '1' || key === 'y') op = buildApproveOp(approval.callId, 'allow');
		else if ((key === '2' || key === 'a') && !isElicitation) {
			e.preventDefault();
			if (scopeKeys) scopeOpen = true;
			else allowAlways();
			return;
		} else if (key === '3' || key === 'n' || (key === 'escape' && !typing && !scopeOpen))
			op = buildApproveOp(approval.callId, 'deny');
		if (!op) return;
		e.preventDefault();
		onRespond(op);
	}
	function allowAlways(scope?: AlwaysScope) {
		scopeOpen = false;
		onRespond(buildApproveOp(approval.callId, 'allow', { always: true, scope }));
	}

	// --- AskUserQuestion: an interactive picker instead of allow/deny ---
	const questions = $derived(approval.questions ?? null);
	let picks = $state<Record<number, string[]>>({});
	// svelte-ignore state_referenced_locally -- deliberate: tracks the last-seen request identity
	let seenQCallId = approval.callId;
	$effect.pre(() => {
		if (approval.callId === seenQCallId) return;
		seenQCallId = approval.callId;
		picks = {};
	});
	function pickOption(qi: number, label: string, multi: boolean) {
		const cur = picks[qi] ?? [];
		if (multi) picks[qi] = cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label];
		else picks[qi] = [label];
	}
	const answersReady = $derived(!!questions && questions.every((_, i) => (picks[i]?.length ?? 0) > 0));
	function submitAnswers() {
		if (!questions || !answersReady) return;
		const answers: Record<string, string> = {};
		for (let i = 0; i < questions.length; i++) answers[questions[i].question] = (picks[i] ?? []).join(', ');
		onRespond({ op: 'approve', call_id: approval.callId, decision: 'allow', answers });
	}

	const isShell = $derived(
		['bash', 'execute', 'exec_command', 'shell_command'].includes(approval.name)
	);
	// ExitPlanMode: the model is proposing a plan and asking to leave plan mode.
	// Render the plan markdown with copy/download actions instead of a raw diff.
	const isPlan = $derived(approval.name === 'ExitPlanMode' || approval.name === 'update_plan');
	let copied = $state(false);
	async function copyPlan() {
		try {
			await navigator.clipboard.writeText(approval.summary);
			copied = true;
			setTimeout(() => (copied = false), 1400);
		} catch {
			/* clipboard blocked — ignore */
		}
	}
	function downloadPlan() {
		const blob = new Blob([approval.summary], { type: 'text/markdown' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'plan.md';
		a.click();
		URL.revokeObjectURL(url);
	}
	// Per-hunk selection only kicks in for multi-hunk edits; a single hunk (or a
	// non-edit tool) keeps the whole-call card, incl. 始终允许 (the engine rejects
	// always+hunks, so the hunk card never offers it).
	const hunks = $derived(approval.hunks ?? []);
	const multiHunk = $derived(hunks.length > 1);

	// Per-request defaults: everything selected; diffs expanded when the list is
	// short (≤3), collapsed beyond that. The card is remounted per request
	// ({#key callId} at the call site) so plain initializers are enough; the
	// effect below is a guard for an unkeyed rerender with a new request (it
	// depends only on the request identity, so user toggles never re-trigger it).
	const defaults = (hs: ApprovalHunk[] | null) => ({
		selected: allHunkIds(hs ?? []),
		expanded: Object.fromEntries((hs ?? []).map((h) => [h.id, (hs ?? []).length <= 3]))
	});
	// svelte-ignore state_referenced_locally -- deliberate: per-request initial value, reset via the effect below
	let selected = $state<string[]>(defaults(approval.hunks).selected);
	// svelte-ignore state_referenced_locally -- deliberate: per-request initial value, reset via the effect below
	let expanded = $state<Record<string, boolean>>(defaults(approval.hunks).expanded);
	// svelte-ignore state_referenced_locally -- deliberate: tracks the last-seen request identity
	let seenCallId = approval.callId;
	$effect.pre(() => {
		if (approval.callId === seenCallId) return;
		seenCallId = approval.callId;
		({ selected, expanded } = defaults(approval.hunks));
	});

	const selState = $derived(selectionState(hunks, selected));

	const lineCls = (line: string) =>
		line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : 'ctx';
	import Checkbox from '$lib/ui/Checkbox.svelte';
</script>

<svelte:window onkeydowncapture={onKey} />
<div class="approval" class:ask={!!questions} class:plan={isPlan}>
	<div class="approval-head">
		{#if questions}
			<ChatCircleDotsIcon size={15} />
			<span>{t('shell.askQuestion')}</span>
		{:else if isPlan}
			<ClipboardTextIcon size={15} />
			<span>{t('shell.proposePlan')}</span>
		{:else if sbx}
			<ShieldWarningIcon size={15} />
			<span class="aname"
				>{t(`shell.sandbox.kind.${sbx.kind}`)}{#if sbx.kind === 'tool' || sbx.kind === 'edit'} · <b>{approval.name}</b>{/if}</span
			>
			{#if sbx.mustAsk}<span class="must" title={t('shell.sandbox.mustAskHint')}>{t('shell.sandbox.mustAsk')}</span>{/if}
		{:else}
			<ShieldWarningIcon size={15} />
			<span class="aname"
				>{isShell ? t('shell.approveCommand') : t('shell.approveFile')} · <b>{approval.name}</b
				></span
			>
		{/if}
		{#if multiHunk}
			<span class="hunk-count">{t('shell.hunkCount', { n: hunks.length })}</span>
		{/if}
		{#if approval.subagentId}
			<span class="subagent-chip" title={approval.subagentId}
				><RobotIcon size={11} />{t('chat.subagentChip', { id: approval.subagentId })}</span
			>
		{/if}
	</div>

	{#if questions}
		<div class="questions">
			{#each questions as q, qi (qi)}
				<div class="q">
					<div class="q-text">{q.question}</div>
					<div class="q-opts">
						{#each q.options as o (o.label)}
							{@const on = (picks[qi] ?? []).includes(o.label)}
							<button class="q-opt" class:on onclick={() => pickOption(qi, o.label, q.multiSelect)}>
								<span class="q-mark" class:multi={q.multiSelect}>{#if on}<CheckIcon size={12} />{/if}</span>
								<span class="q-body">
									<span class="q-label">{o.label}</span>
									{#if o.description}<span class="q-desc">{o.description}</span>{/if}
								</span>
							</button>
						{/each}
					</div>
				</div>
			{/each}
		</div>
		<div class="approval-actions">
			<Button variant="primary" size="sm" disabled={!answersReady} onclick={submitAnswers}>{t('shell.answerSubmit')}</Button>
			<Button variant="danger" size="sm" onclick={() => onRespond(buildApproveOp(approval.callId, 'deny'))}>{t('shell.answerCancel')}</Button>
		</div>
	{:else if isPlan}
		<div class="plan-body">
			<Markdown text={approval.summary} />
		</div>
		<div class="approval-actions">
			<Button
				variant="primary"
				size="sm"
				onclick={() => onRespond(buildApproveOp(approval.callId, 'allow'))}
				>{t('shell.approvePlan')}</Button
			>
			<Button
				variant="danger"
				size="sm"
				onclick={() => onRespond(buildApproveOp(approval.callId, 'deny'))}
				>{t('shell.keepPlanning')}</Button
			>
			<span class="plan-spacer"></span>
			<Button variant="ghost" size="sm" onclick={copyPlan}>
				{#if copied}<CheckIcon size={13} />{t('shell.copiedPlan')}{:else}<CopyIcon size={13} />{t('shell.copyPlan')}{/if}
			</Button>
			<Button variant="ghost" size="sm" onclick={downloadPlan}><DownloadSimpleIcon size={13} />{t('shell.downloadPlan')}</Button>
		</div>
	{:else if multiHunk}
		<div class="hunks">
			{#each hunks as h (h.id)}
				<div class="hunk" class:off={!selected.includes(h.id)}>
					<div class="hunk-row">
						<label class="hunk-pick">
							<Checkbox checked={selected.includes(h.id)} onchange={() => (selected = toggleHunk(selected, h.id))} />
							<span class="hunk-file">{h.file}</span>
							<span class="hunk-header">{h.header}</span>
						</label>
						<button
							class="hunk-toggle"
							aria-label={t('shell.toggleDiff')}
							title={t('shell.toggleDiff')}
							onclick={() => (expanded[h.id] = !expanded[h.id])}
						>
							<span class="chev" class:open={expanded[h.id]}><CaretRightIcon size={13} /></span>
						</button>
					</div>
					{#if expanded[h.id]}
						<pre class="diff">{#each h.lines as line, i (i)}<span class={lineCls(line)}>{line}
</span>{/each}</pre>
					{/if}
				</div>
			{/each}
		</div>
		{#if selState === 'none'}
			<div class="none-hint"><Notice tone="warn">{t('shell.noneSelectedHint')}</Notice></div>
		{/if}
		<div class="approval-actions">
			<Button
				variant="primary"
				size="sm"
				onclick={() => onRespond(buildApproveOp(approval.callId, 'allow'))}
				>{t('shell.allowAll')}</Button
			>
			<Button
				variant="secondary"
				size="sm"
				disabled={selState !== 'some'}
				onclick={() => onRespond(buildApproveOp(approval.callId, 'allow', { hunks: selected }))}
				>{t('shell.allowSelected', { n: selected.length })}</Button
			>
			<Button
				variant="danger"
				size="sm"
				onclick={() => onRespond(buildApproveOp(approval.callId, 'deny'))}>{t('shell.deny')}</Button
			>
		</div>
	{:else if sbx && choices}
		<div class="sbx-lines">
			{#if sbx.justification}
				<div class="sline" title={sbx.justification}><span class="sk">{t('shell.sandbox.reason')}</span><span class="sv">{sbx.justification}</span></div>
			{/if}
			{#if sbx.command}
				<button class="sline cmdline" class:open={cmdOpen} title={sbx.command} aria-expanded={cmdOpen} onclick={() => (cmdOpen = !cmdOpen)}
					><span class="sk">{t('shell.sandbox.command')}</span><code class="sv">$ {sbx.command}</code></button
				>
			{:else if approval.summary}
				<pre class="approval-sum">{approval.summary}</pre>
			{/if}
			{#if sbx.paths.length}
				<div class="sline" title={sbx.paths.join('\n')}><span class="sk">{t('shell.sandbox.writes')}</span><code class="sv">{sbx.paths.join(', ')}</code></div>
			{/if}
			{#if sbx.cwd}
				<div class="sline" title={sbx.cwd}><span class="sk">{t('shell.sandbox.cwd')}</span><code class="sv">{sbx.cwd}</code></div>
			{/if}
		</div>
		{#if sbx.elevation && remote}
			<div class="sbx-note"><Notice tone="info">{t('shell.sandbox.onComputer')} {t(`shell.sandbox.onComputerHint.${sbx.elevation}`)}</Notice></div>
		{:else if sbx.elevation === 'uac'}
			<p class="sbx-hint">{t('shell.sandbox.uacHint')}</p>
		{/if}
		{#if feedbackOpen}
			<div class="feedback">
				<textarea
					class="fb-input"
					rows="2"
					bind:value={feedback}
					placeholder={t('shell.sandbox.feedbackPlaceholder')}
					aria-label={t('shell.sandbox.feedbackLabel')}
					onkeydown={onFeedbackKey}
					use:focusOnMount
				></textarea>
				<div class="approval-actions">
					<Button variant="danger" size="sm" onclick={sendDeny}>{feedback.trim() ? t('shell.sandbox.denySend') : t('shell.deny')}</Button>
					<Button variant="ghost" size="sm" onclick={() => ((feedbackOpen = false), (feedback = ''))}>{t('common.cancel')}</Button>
				</div>
			</div>
		{:else}
			<div class="approval-actions">
				{#if choices.terminal}
					<Button variant="primary" size="sm" onclick={runInTerminal} title={t('shell.sandbox.terminalHint')}
						><TerminalWindowIcon size={13} />{t('shell.sandbox.terminal')}<kbd>1</kbd></Button
					>
					<Button variant="secondary" size="sm" onclick={() => answer({ type: 'once' })}>{t('shell.allowOnce')}</Button>
				{:else}
					<Button variant="primary" size="sm" onclick={() => answer({ type: 'once' })}>{t('shell.allowOnce')}<kbd>1</kbd></Button>
				{/if}
				{#if choices.session}
					<Button variant="secondary" size="sm" title={sbx.prefix} onclick={() => answer({ type: 'session' })}
						>{sbx.kind === 'edit' ? t('shell.sandbox.sessionEdits') : t('shell.sandbox.sessionPrefix', { prefix: clip(sbx.prefix) })}{#if secondKey?.type === 'session'}<kbd>2</kbd>{/if}</Button
					>
				{/if}
				{#if choices.project}
					<Button variant="secondary" size="sm" title={t('shell.sandbox.alwaysHint', { prefix: sbx.prefix })} onclick={() => answer({ type: 'project' })}
						>{t('shell.sandbox.always')}{#if secondKey?.type === 'project'}<kbd>2</kbd>{/if}</Button
					>
				{/if}
				{#if choices.pathSession}
					<Button variant="secondary" size="sm" title={choices.target} onclick={() => answer({ type: 'dir', path: choices.target, persist: 'session' })}
						>{t('shell.sandbox.dirSession', { dir: clip(baseName(choices.target), 24) })}{#if secondKey?.type === 'dir'}<kbd>2</kbd>{/if}</Button
					>
				{/if}
				{#if choices.pathProject}
					<Button variant="secondary" size="sm" title={t('shell.sandbox.dirProjectHint', { dir: choices.target })} onclick={() => answer({ type: 'dir', path: choices.target, persist: 'project' })}
						>{t('shell.sandbox.dirProject', { dir: clip(baseName(choices.target), 24) })}</Button
					>
				{/if}
				<Button variant="danger" size="sm" onclick={openFeedback}>{t('shell.sandbox.denyTell')}<kbd>3</kbd></Button>
			</div>
		{/if}
	{:else}
		{#if approval.summary}
			<pre class="approval-sum" class:cmd={isShell}>{isShell
					? `$ ${approval.summary}`
					: approval.summary}</pre>
		{/if}
		<div class="approval-actions">
			{#if isElicitation && approval.url}
				<Button variant="secondary" size="sm" onclick={() => openExternal(approval.url!)}>{t('shell.elicitOpen')}</Button>
			{/if}
			<Button
				variant="primary"
				size="sm"
				onclick={() => onRespond(buildApproveOp(approval.callId, 'allow'))}
				>{isElicitation ? t('shell.elicitAccept') : t('shell.allowOnce')}<kbd>1</kbd></Button
			>
			{#if !isElicitation}
				<span class="scope-anchor">
					<Button
						variant="secondary"
						size="sm"
						onclick={() => (scopeKeys ? (scopeOpen = !scopeOpen) : allowAlways())}
						>{scopeKeys ? t('shell.allowAlwaysScoped') : t('shell.allowAlways')}<kbd>2</kbd></Button
					>
					{#if scopeOpen}
						<PopMenu
							title={t('shell.alwaysScope.title')}
							items={scopeItems}
							placement="up-left"
							onSelect={(key) => allowAlways(key as AlwaysScope)}
							onClose={() => (scopeOpen = false)}
						/>
					{/if}
				</span>
			{/if}
			<Button
				variant="danger"
				size="sm"
				onclick={() => onRespond(buildApproveOp(approval.callId, 'deny'))}
				>{isElicitation ? t('shell.elicitDecline') : t('shell.deny')}<kbd>{isElicitation ? '2' : '3'}</kbd></Button
			>
		</div>
	{/if}
</div>

<style>
	/* Every prompt (an action to allow, a question, a plan) is the same raised
	   card as the composer it sits on: it stands out by elevation, not tint.
	   It rises in with fill backwards only: a fill that held the end left the
	   card transformed (by an identity matrix) for good, the containing block
	   of its scope menu's fixed click-away backdrop, which then covered only
	   the card. The end values are the card's own. Positioned, so it still
	   paints over the composer below (its shadow on the composer's edge), as
	   it does with glass. */
	.approval {
		position: relative;
		padding: 12px 14px;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: var(--r-lg);
		box-shadow: var(--shadow-float);
		animation: rise var(--t-slow) var(--ease-out) backwards;
	}
	.plan-body {
		margin-top: 10px;
		padding: 10px 12px;
		background: var(--sidebar);
		border: 1px solid var(--hairline);
		border-radius: var(--r-sm);
		font-size: var(--fs-sm);
		max-height: 340px;
		overflow-y: auto;
	}
	.plan-spacer {
		flex: 1;
	}
	.approval-head {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: var(--fs-sm);
		font-weight: 500;
		color: var(--text);
	}
	.approval-head > :global(svg) {
		flex-shrink: 0;
		color: var(--dim);
	}
	.questions {
		display: flex;
		flex-direction: column;
		gap: 14px;
		margin-top: 10px;
	}
	.q-text {
		font-size: var(--fs-sm);
		font-weight: 600;
		color: var(--text);
		margin-bottom: 7px;
	}
	.q-opts {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.q-opt {
		display: flex;
		align-items: flex-start;
		gap: 9px;
		width: 100%;
		text-align: left;
		padding: 8px 10px;
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		background: var(--sidebar);
		color: var(--text);
		cursor: pointer;
		transition:
			border-color var(--t-fast) var(--ease-out),
			background var(--t-fast) var(--ease-out),
			transform var(--t-fast) var(--ease-spring);
	}
	.q-opt:active {
		transform: scale(0.99);
	}
	.q-opt:hover {
		border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
	}
	.q-opt.on {
		border-color: var(--accent);
		background: color-mix(in oklab, var(--accent) 12%, var(--sidebar));
	}
	.q-mark {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		flex-shrink: 0;
		margin-top: 1px;
		border: 1.5px solid var(--border);
		border-radius: var(--r-full);
		color: var(--on-accent);
	}
	.q-mark.multi {
		border-radius: var(--r-xs);
	}
	.q-opt.on .q-mark {
		background: var(--accent);
		border-color: var(--accent);
	}
	.q-body {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.q-label {
		font-size: var(--fs-sm);
		font-weight: 500;
	}
	.q-desc {
		font-size: var(--fs-xs);
		color: var(--dim);
		line-height: 1.4;
	}
	.approval-head b {
		font-family: var(--font-mono);
		color: var(--text);
	}
	.hunk-count {
		font-size: var(--fs-2xs);
		color: var(--dim);
	}
	.subagent-chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		margin-left: auto;
		padding: 1px 7px;
		font-size: var(--fs-2xs);
		font-family: var(--font-mono);
		color: var(--dim);
		background: var(--surface2);
		border: 1px solid var(--hairline);
		border-radius: var(--r-full);
		max-width: 200px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.approval-sum {
		margin: 8px 0 0;
		padding: 8px 10px;
		background: var(--sidebar);
		border: 1px solid var(--hairline);
		border-radius: var(--r-sm);
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		white-space: pre-wrap;
		word-break: break-word;
		max-height: 120px;
		overflow-y: auto;
	}
	.approval-sum.cmd {
		color: var(--text);
	}
	.approval-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 10px;
	}
	.scope-anchor {
		position: relative;
		display: inline-flex;
	}
	/* --- hunk list --- */
	.hunks {
		margin-top: 8px;
		display: flex;
		flex-direction: column;
		gap: 6px;
		max-height: 300px;
		overflow-y: auto;
	}
	.hunk {
		background: var(--sidebar);
		border: 1px solid var(--hairline);
		border-radius: var(--r-sm);
		overflow: hidden;
	}
	.hunk.off {
		opacity: 0.55;
	}
	.hunk-row {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 5px 8px;
	}
	.hunk-pick {
		display: flex;
		align-items: center;
		gap: 7px;
		flex: 1;
		min-width: 0;
		cursor: pointer;
		font-size: var(--fs-xs);
	}
	.hunk-file {
		font-family: var(--font-mono);
		color: var(--text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.hunk-header {
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		color: var(--accent);
		white-space: nowrap;
		flex-shrink: 0;
	}
	.hunk-toggle {
		display: inline-flex;
		padding: 3px;
		border: none;
		background: none;
		color: var(--dim);
		cursor: pointer;
		flex-shrink: 0;
	}
	.chev {
		display: inline-flex;
		transition: transform var(--t-med) var(--ease-spring);
	}
	.chev.open {
		transform: rotate(90deg);
	}
	.none-hint {
		margin-top: 8px;
	}
	/* Diff rendering, matching ToolCard's diff styles. */
	.diff {
		margin: 0;
		padding: 6px 10px;
		border-top: 1px solid var(--hairline);
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		line-height: 1.45;
		color: var(--text);
		max-height: 160px;
		overflow: auto;
		white-space: pre-wrap;
		word-break: break-word;
	}
	.diff .add {
		color: var(--ok);
		background: color-mix(in oklch, var(--ok) 10%, transparent);
		display: block;
	}
	.diff .del {
		color: var(--err);
		background: color-mix(in oklch, var(--err) 10%, transparent);
		display: block;
	}
	.diff .ctx {
		display: block;
	}
	.approval-actions :global(kbd) {
		margin-left: 6px;
		padding: 0 4px;
		border-radius: 3px;
		background: color-mix(in oklab, currentColor 14%, transparent);
		font: inherit;
		font-size: 10px;
		opacity: 0.75;
	}
	.aname {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	/* --- sandbox request --- */
	.must {
		flex-shrink: 0;
		padding: 1px 7px;
		font-size: var(--fs-2xs);
		font-weight: 500;
		color: var(--warn);
		background: color-mix(in oklab, var(--warn) 12%, transparent);
		border-radius: var(--r-full);
		white-space: nowrap;
	}
	.sbx-lines {
		display: flex;
		flex-direction: column;
		gap: 3px;
		margin-top: 8px;
	}
	/* One line each: the reason, the command (opens to its full text), the paths, the directory. */
	.sline {
		display: flex;
		align-items: baseline;
		gap: 8px;
		min-width: 0;
		padding: 0;
		border: none;
		background: none;
		color: var(--text);
		font: inherit;
		font-size: var(--fs-xs);
		line-height: 1.5;
		text-align: left;
	}
	.sk {
		flex: none;
		min-width: 3em;
		color: var(--dim);
	}
	.sv {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	code.sv {
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
	}
	.cmdline {
		padding: 5px 8px;
		margin: 2px 0;
		background: var(--sidebar);
		border: 1px solid var(--hairline);
		border-radius: var(--r-sm);
		cursor: pointer;
	}
	.cmdline code.sv {
		font-size: var(--fs-xs);
		color: var(--text);
	}
	.cmdline.open code.sv {
		white-space: pre-wrap;
		word-break: break-word;
		max-height: 160px;
		overflow-y: auto;
	}
	.sbx-note {
		margin-top: 8px;
	}
	.sbx-hint {
		margin: 6px 0 0;
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.feedback {
		margin-top: 10px;
	}
	.fb-input {
		display: block;
		width: 100%;
		box-sizing: border-box;
		resize: vertical;
		min-height: 52px;
		padding: 7px 10px;
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		background: var(--surface2);
		color: var(--text);
		font-family: var(--font-sans);
		font-size: var(--fs-sm);
		line-height: 1.5;
		outline: none;
	}
	.fb-input:focus {
		border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
	}
	.hunk-count {
		flex-shrink: 0;
		white-space: nowrap;
	}
</style>
