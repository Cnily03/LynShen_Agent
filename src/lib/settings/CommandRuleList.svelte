<script lang="ts">
	// Command rules, one row each: how the command starts, an optional label
	// of where the rule applies, allow / ask / forbid, remove. A prefix is
	// reported when the field is left (a half-typed one is never saved). The
	// Agent page and Settings → 权限与沙箱 use it.
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import IconButton from '$lib/ui/IconButton.svelte';
	import Select from '$lib/ui/Select.svelte';
	import { t } from '$lib/i18n';

	type Action = 'allow' | 'ask' | 'forbid';
	type Rule = { prefix: string; action: Action; badge?: string; badgeTitle?: string };
	let {
		rules,
		empty,
		onChange,
		onRemove
	}: {
		rules: Rule[];
		/** The line in place of an empty list. */
		empty: string;
		onChange: (index: number, rule: { prefix: string; action: Action }) => void;
		onRemove: (index: number) => void;
	} = $props();

	const ACTIONS = $derived([
		{ value: 'allow', label: t('shell.agentPage.allow') },
		{ value: 'ask', label: t('shell.agentPage.ask') },
		{ value: 'forbid', label: t('shell.agentPage.forbid') }
	]);
</script>

{#each rules as rule, index (index)}
	<div class="item">
		<input
			class="grow"
			value={rule.prefix}
			placeholder={t('shell.agentPage.rulePrefix')}
			aria-label={t('shell.agentPage.rulePrefix')}
			onchange={(e) => onChange(index, { prefix: e.currentTarget.value, action: rule.action })}
		/>
		{#if rule.badge}<span class="badge" title={rule.badgeTitle ?? rule.badge}>{rule.badge}</span>{/if}
		<div class="pick">
			<Select value={rule.action} options={ACTIONS} onChange={(action) => onChange(index, { prefix: rule.prefix, action: action as Action })} />
		</div>
		<IconButton label={t('shell.agentPage.remove')} onclick={() => onRemove(index)}>
			<XIcon size={13} />
		</IconButton>
	</div>
{:else}
	<p class="none">{empty}</p>
{/each}

<style>
	.item {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 12px 10px 18px;
	}
	.grow {
		flex: 1;
		min-width: 0;
	}
	input {
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		background: var(--surface2);
		color: var(--text);
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		padding: 6px 9px;
		outline: none;
	}
	input:focus {
		border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
	}
	/* One width, so the controls line up whatever the label. */
	.badge {
		flex: none;
		width: 120px;
		text-align: right;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.pick {
		flex: none;
		width: 120px;
	}
	.none {
		margin: 0;
		padding: 16px 18px;
		font-size: var(--fs-xs);
		color: var(--dim2);
	}
</style>
