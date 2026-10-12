<script lang="ts">
	// A subagent's own page (a `subagent:` tab): its head and conversation,
	// read-only, with no composer. It reads the conversation through its
	// session's engine, like the agent trace panel.
	import type { ChatState } from '$lib/chat.svelte';
	import type { Op } from '$lib/protocol';
	import { t } from '$lib/i18n';
	import { prefs } from '$lib/prefs.svelte';
	import { CHAT_PAD, CHAT_W_STANDARD, chatColumnWidth } from '$lib/chatWidth';
	import AgentDetail from './AgentDetail.svelte';

	let { chat, agentId, onOp }: { chat: ChatState | undefined; agentId: string; onOp: (op: Op) => void } = $props();

	let scroller = $state<HTMLElement | null>(null);
	// The same column as a conversation in a pane this wide (chatWidth.ts).
	let paneW = $state(0);
	const chatW = $derived(paneW > 0 ? chatColumnWidth(paneW, prefs.chatWidth, CHAT_PAD) : CHAT_W_STANDARD);
</script>

<div class="page" bind:this={scroller} bind:clientWidth={paneW} style:--chat-w="{chatW}px">
	{#if chat}
		<div class="inner">
			<AgentDetail {chat} {agentId} {scroller} {onOp} />
		</div>
	{:else}
		<p class="gone">{t('shell.chatGone')}</p>
	{/if}
</div>

<style>
	.page {
		height: 100%;
		overflow-y: auto;
		background: var(--bg);
	}
	.inner {
		max-width: calc(var(--chat-w, 844px) + 2 * var(--chat-pad, 32px));
		margin: 0 auto;
		padding: 16px 0 32px;
	}
	.gone {
		margin: 24px;
		font-size: var(--fs-sm);
		color: var(--dim);
	}
</style>
