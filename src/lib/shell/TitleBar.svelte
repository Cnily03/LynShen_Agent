<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import SidebarSimpleIcon from 'phosphor-svelte/lib/SidebarSimpleIcon';
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import MinusIcon from 'phosphor-svelte/lib/MinusIcon';
	import SquareIcon from 'phosphor-svelte/lib/SquareIcon';
	import CopyIcon from 'phosphor-svelte/lib/CopyIcon';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import { getCurrentWindow } from '@tauri-apps/api/window';
	import { t } from '$lib/i18n';
	import { withShortcut } from '$lib/shortcuts';
	import PopMenu, { type PopMenuItem } from '$lib/ui/PopMenu.svelte';

	// The window's title bar (design.md, "Title bar"): 38px across the full
	// width with no fill of its own, so the frame tone shows. The traffic
	// lights (macOS) and the navigator toggle over the navigator, then the
	// title of what is in front, aligned with the canvas, and the canvas
	// actions (plus the drawn window controls on Windows/Linux).
	let {
		leftWidth,
		resizing = false,
		sidebarOpen,
		onToggleSidebar,
		showToggle = true,
		heading = false,
		title = '',
		subtitle = '',
		addOptions = [],
		onAdd,
		actions
	}: {
		/** Width of the columns left of the canvas; the title starts past them. */
		leftWidth: number;
		/** The sidebar is being dragged: follow it without easing. */
		resizing?: boolean;
		/** The sidebar is expanded (not the icon rail). */
		sidebarOpen: boolean;
		onToggleSidebar: () => void;
		/** Hide the toggle on full-window surfaces (the welcome screen). */
		showToggle?: boolean;
		/** The title is the view's heading (h1): a conversation in front, whose
		 *  canvas has no page title of its own. */
		heading?: boolean;
		title?: string;
		subtitle?: string;
		/** Panels that can be opened next to the focused one. */
		addOptions?: { key: string; label: string; icon?: PopMenuItem['icon']; group?: string }[];
		onAdd?: (key: string) => void;
		/** Extra actions for the session in front (e.g. continue in the TUI). */
		actions?: Snippet;
	} = $props();

	let menuOpen = $state(false);

	// Windows and Linux run without the system title bar (decorations off in
	// tauri.windows/linux.conf.json), so the window controls are drawn here.
	// macOS keeps its native traffic lights.
	const drawnControls =
		typeof document !== 'undefined' && document.documentElement.dataset.os !== 'macos';
	let maximized = $state(false);
	onMount(() => {
		if (!drawnControls || !('__TAURI_INTERNALS__' in window)) return;
		const win = getCurrentWindow();
		const sync = () => win.isMaximized().then((m) => (maximized = m)).catch(() => {});
		sync();
		const unlisten = win.onResized(sync);
		return () => {
			unlisten.then((f) => f());
		};
	});
	const win = () => getCurrentWindow();
</script>

<header class="titlebar" data-tauri-drag-region>
	<div class="lead" class:resizing style:width="{leftWidth}px" data-tauri-drag-region>
		{#if showToggle}
			<button
				class="tb-btn"
				title={withShortcut(t(sidebarOpen ? 'shell.sidebarCollapse' : 'shell.sidebarExpand'), 'sidebar')}
				aria-label={t(sidebarOpen ? 'shell.sidebarCollapse' : 'shell.sidebarExpand')}
				aria-expanded={sidebarOpen}
				onclick={onToggleSidebar}><SidebarSimpleIcon size={16} /></button
			>
		{/if}
	</div>
	<svelte:element this={heading ? 'h1' : 'div'} class="title" data-tauri-drag-region>
		{#if title}<span class="t">{title}</span>{/if}
		{#if subtitle}<span class="s">{subtitle}</span>{/if}
	</svelte:element>
	<div class="acts">
		{#if actions}{@render actions()}{/if}
		{#if addOptions.length}
			<button class="tb-btn" class:open={menuOpen} title={t('shell.addPanel')} aria-label={t('shell.addPanel')} aria-expanded={menuOpen} onclick={() => (menuOpen = !menuOpen)}
				><PlusIcon size={16} /></button
			>
			{#if menuOpen}
				<PopMenu
					items={addOptions.map((o) => ({ key: o.key, label: o.label, icon: o.icon, group: o.group }))}
					onSelect={(key) => {
						menuOpen = false;
						onAdd?.(key);
					}}
					onClose={() => (menuOpen = false)}
				/>
			{/if}
		{/if}
	</div>
	{#if drawnControls}
		<div class="winctl">
			<button class="wc" title={t('shell.window.minimize')} aria-label={t('shell.window.minimize')} onclick={() => win().minimize()}><MinusIcon size={16} /></button>
			<button
				class="wc"
				title={maximized ? t('shell.window.restore') : t('shell.window.maximize')}
				aria-label={maximized ? t('shell.window.restore') : t('shell.window.maximize')}
				onclick={() => win().toggleMaximize()}
			>
				{#if maximized}<CopyIcon size={13} />{:else}<SquareIcon size={12} />{/if}
			</button>
			<button class="wc close" title={t('shell.window.close')} aria-label={t('shell.window.close')} onclick={() => win().close()}><XIcon size={16} /></button>
		</div>
	{/if}
</header>

<style>
	.titlebar {
		position: relative;
		display: flex;
		align-items: center;
		height: 38px;
		flex-shrink: 0;
		padding-right: 8px;
		background: transparent;
		user-select: none;
	}
	/* Over the navigator, as wide as it is (or as its own contents). The
	   toggle sits on the collapsed rail's centre line; on macOS the traffic
	   lights come first (trafficLightPosition in tauri.macos.conf.json
	   centres them on the bar, on the toggle's centre line). */
	.lead {
		display: flex;
		align-items: center;
		flex-shrink: 0;
		min-width: max-content;
		height: 100%;
		padding-left: 10px;
		/* Moves with the sidebar collapsing and expanding (Sidebar.svelte). */
		transition: width var(--t-base) var(--ease-base);
	}
	.lead.resizing {
		transition: none;
	}
	/* Over a custom background the image shows through, at --chrome-tint,
	   blurred when glass is on (app.css, prefs.svelte.ts). */
	/* On a layer behind the bar: on the bar itself the blur would make it
	   the box its menus' fixed click-away backdrops fill. */
	/* The layer makes the bar a stacking context: on the popover level, or
	   the canvas (later in the page) would paint over the bar's menus. */
	:global(:root[data-canvas-bg]) .titlebar {
		isolation: isolate;
		z-index: 80;
	}
	:global(:root[data-canvas-bg]) .titlebar::before {
		content: '';
		position: absolute;
		inset: 0;
		z-index: -1;
		background: color-mix(in oklab, var(--rail) var(--chrome-tint), transparent);
		pointer-events: none;
	}
	:global(:root[data-canvas-bg][data-glass]) .titlebar::before {
		-webkit-backdrop-filter: var(--glass-filter);
		backdrop-filter: var(--glass-filter);
	}
	:global(:root[data-os='macos']) .lead {
		padding-left: 84px;
	}
	:global(:root[data-os='windows']) .titlebar,
	:global(:root[data-os='linux']) .titlebar {
		padding-right: 0;
	}
	.winctl {
		display: flex;
		align-self: stretch;
		margin-left: 6px;
	}
	.wc {
		display: inline-flex;
		padding: 0;
		align-items: center;
		justify-content: center;
		width: 46px;
		border: none;
		background: none;
		color: var(--dim);
		cursor: pointer;
	}
	.wc:hover {
		background: var(--surface2);
		color: var(--text);
	}
	/* Close turns red on hover, as the system controls do. */
	.wc.close:hover {
		background: var(--err);
		color: var(--on-accent);
	}
	.tb-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		flex-shrink: 0;
		padding: 0;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--dim);
		cursor: pointer;
	}
	.tb-btn:hover,
	.tb-btn.open {
		background: var(--surface2);
		color: var(--text);
	}
	/* Starts at the canvas's left edge (past the 1px divider), plus a gap. */
	.title {
		flex: 1;
		margin: 0;
		padding-left: 13px;
		min-width: 0;
		display: flex;
		align-items: baseline;
		gap: 8px;
		font: inherit;
		line-height: 18px;
		white-space: nowrap;
		overflow: hidden;
	}
	.t {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--text);
		font-size: var(--fs-sm);
		font-weight: 500;
	}
	.s {
		flex-shrink: 0;
		color: var(--dim2);
		font-size: var(--fs-xs);
	}
	.acts {
		position: relative;
		display: flex;
		align-items: center;
		gap: 2px;
	}
</style>
