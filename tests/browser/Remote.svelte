<script lang="ts">
	// The phone remote page's conversation (RemoteSession, as HostView shows
	// it) on a computer it never reaches: the conversation is the history the
	// computer sends when the page opens it, and the test can send more
	// frames (window.__remoteFrame). For the browser regressions and the
	// screenshots of the phone page.
	//   ?remote                 a conversation with messages sent with files
	import { onMount } from 'svelte';
	import RemoteSession from '../../src/lib/RemoteSession.svelte';
	import Toaster from '../../src/lib/ui/Toaster.svelte';
	import { HostConnection, provideHost } from '../../src/lib/remote/connection.svelte';
	import { setLocale } from '../../src/lib/i18n';
	import { withFiles, withVideo } from '../../src/lib/attachments';

	const mode = new URL(location.href).searchParams;
	setLocale(mode.get('lang') === 'en' ? 'en' : 'zh');
	// Never started: no socket opens.
	provideHost(
		new HostConnection(
			'fixture',
			'lan',
			async () => ({ url: 'ws://fake-remote', token: '' }),
			() => {
				throw new Error('no computer in the fixture');
			}
		)
	);

	let deliver: ((raw: string) => void) | null = null;
	const register = (_id: string, onFrame: (raw: string) => void) => {
		deliver = onFrame;
		return () => (deliver = null);
	};
	const frame = (f: Record<string, unknown>) => deliver?.(JSON.stringify(f));
	Object.assign(window, { __remoteFrame: frame });

	onMount(() => {
		// The history as the engine keeps it: the files listed after the text
		// (attachments.ts).
		frame({
			type: 'transcript',
			items: [
				{ role: 'user', content: withFiles('帮我看看谁发的消息更多', ['/Users/me/Documents/私聊_墨竹.jsonl']) },
				{ role: 'assistant', content: '墨竹发了 1,284 条，你发了 1,102 条：墨竹多 182 条。' },
				{
					role: 'user',
					content: withFiles('对比这三份文件，列出口径不一致的地方', [
						'/Users/me/Documents/季度报告/2026 Q3 经营分析.pdf',
						'C:\\Users\\me\\Desktop\\销售明细.xlsx',
						'/Users/me/code/lynshen-desktop/docs/metrics.md'
					])
				},
				{ role: 'assistant', content: '三份文件的「活跃用户」口径不同：报告按月活，表格按周活，metrics.md 按日活。' },
				{ role: 'user', content: withVideo(withFiles('', ['/Users/me/Downloads/error-log-1013.txt']), '录屏 2026-10-13.mov', 12.4, 8) }
			]
		});
	});
</script>

<Toaster />
<div class="remote">
	<RemoteSession title="对比口径" chat {register} />
</div>

<style>
	/* The page around it, as in src/routes/remote/+page.svelte. */
	.remote {
		min-height: 100dvh;
		background: var(--bg);
		color: var(--text);
		font-family: var(--font-sans);
	}
</style>
