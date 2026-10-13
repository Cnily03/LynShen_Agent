<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { listen } from '@tauri-apps/api/event';
	import { Terminal } from '@xterm/xterm';
	import { FitAddon } from '@xterm/addon-fit';
	import '@xterm/xterm/css/xterm.css';
	import { terminalLook, useTerminalInput, useWebgl } from './terminal';
	import { ptyOpen, ptyWrite, ptyResize, ptyClose } from '$lib/protocol';
	import { terminalRequests, typedCommand } from '$lib/sandbox/terminal.svelte';
	import { copyText } from '$lib/clipboard';
	import { toast } from '$lib/ui/toast.svelte';
	import { t } from '$lib/i18n';

	/** `tabId`: a tab opened by 在终端里运行 gets its command typed (not run). */
	let { cwd = '', tabId = '' }: { cwd?: string; tabId?: string } = $props();
	let lastOutput = 0;
	let host = $state<HTMLDivElement | null>(null);
	let term: Terminal | undefined;
	let fit: FitAddon | undefined;
	const id = `term-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
	let cleanups: Array<() => void> = [];

	/** Fit the grid to the panel and tell the shell its new size. */
	function refit() {
		try {
			fit?.fit();
		} catch {
			/* ignore */
		}
	}

	onMount(() => {
		let disposed = false;
		(async () => {
			term = new Terminal({ ...terminalLook(), cursorBlink: true, allowProposedApi: true });
			fit = new FitAddon();
			term.loadAddon(fit);
			if (host) term.open(host);
			cleanups.push(useTerminalInput(term));
			useWebgl(term);
			fit.fit();

			const unOut = await listen<{ id: string; data: string }>('pty-output', (e) => {
				if (e.payload.id !== id) return;
				lastOutput = Date.now();
				term?.write(e.payload.data);
			});
			const unExit = await listen<string>('pty-exit', (e) => {
				if (e.payload === id) term?.write('\r\n\x1b[2m[process exited]\x1b[0m\r\n');
			});
			cleanups.push(unOut, unExit);

			term.onData((d) => ptyWrite(id, d));
			term.onResize(({ cols, rows }) => ptyResize(id, cols, rows).catch(() => {}));
			await ptyOpen(id, term.cols, term.rows, cwd || undefined);

			const ro = new ResizeObserver(refit);
			if (host) ro.observe(host);
			cleanups.push(() => ro.disconnect());

			if (disposed) {
				// Closed while opening: onDestroy ran before the pty existed.
				cleanups.forEach((f) => f());
				ptyClose(id).catch(() => {});
				return;
			}
			if (tabId) typeWhenReady(Date.now());
		})();
		return () => {
			disposed = true;
		};
	});

	/** Types the tab's command once the shell has drawn its prompt (its
	 *  output has started and gone quiet; at the latest after 4 s), so the
	 *  shell's line editor takes it. Never with Enter. */
	function typeWhenReady(start: number) {
		const now = Date.now();
		const quiet = lastOutput > 0 && now - lastOutput > 350;
		if (!quiet && now - start < 4000) {
			const timer = setTimeout(() => typeWhenReady(start), 120);
			cleanups.push(() => clearTimeout(timer));
			return;
		}
		const command = terminalRequests.take(tabId);
		if (!command || !term) return;
		const text = typedCommand(command, term.modes.bracketedPasteMode);
		if (text) {
			ptyWrite(id, text);
			term.focus();
		} else {
			// Several lines and a shell that would run each one: copy instead.
			void copyText(command).then(() => toast.info(t('shell.sandbox.terminalCopied')));
		}
	}

	// Theme and font changes; a new font size changes the grid.
	$effect(() => {
		const look = terminalLook();
		if (!term) return;
		Object.assign(term.options, look);
		refit();
	});

	onDestroy(() => {
		cleanups.forEach((f) => f());
		ptyClose(id);
		term?.dispose();
	});
</script>

<div class="term-host" bind:this={host}></div>

<style>
	.term-host {
		height: 100%;
		width: 100%;
		background: var(--panel);
	}
	:global(.term-host .xterm) {
		height: 100%;
		padding: 8px 6px 6px 10px;
	}
	:global(.term-host .xterm-viewport) {
		background: transparent !important;
	}
</style>
