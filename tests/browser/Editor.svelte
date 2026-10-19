<script lang="ts">
	// ?editor: 审阅 (EditorPane) on a Markdown file, as the review panel
	// shows one (tickets #44, #53); `read_text` answers in main.ts.
	import { onMount } from 'svelte';
	import EditorPane from '../../src/lib/editor/EditorPane.svelte';
	import Toaster from '../../src/lib/ui/Toaster.svelte';
	import ContextMenuHost from '../../src/lib/ui/ContextMenuHost.svelte';
	import { editorStore } from '../../src/lib/editor/editorStore.svelte';
	import { setLocale } from '../../src/lib/i18n';
	import '../../src/lib/app.css';

	setLocale('zh');
	const theme = new URL(location.href).searchParams.get('theme') === 'light' ? 'light' : 'dark';
	document.documentElement.dataset.theme = theme;
	onMount(() => {
		void editorStore.open('/Users/me/code/app/HANDOFF.md', '/Users/me/code/app');
	});
</script>

<div class="pane"><EditorPane /></div>
<Toaster />
<ContextMenuHost />

<style>
	.pane {
		width: 640px;
		height: 600px;
		display: flex;
		background: var(--bg);
		color: var(--text);
	}
</style>
