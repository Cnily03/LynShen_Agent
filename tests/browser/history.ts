// A long conversation as the engine streams it, for the performance checks
// (Perf.svelte): each turn a user message (every 10th with an image), a
// reasoning of a few paragraphs, five tool calls (a read, a command with a
// long log, an edit with a large diff, a search, and every 10th turn the read
// of a screenshot), and a Markdown reply with a code block and a table. Deterministic:
// the same turns every run.

const WORDS = ['我们', '需要', '考虑', '这个', '函数', 'the cache', '边界', '情况', 'returns', '`buf.len()`', '然后', 'maybe', '检查', '一下', 'session', 'layout', '。'];

function rng(seed: number) {
	let s = seed;
	return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff), s / 0x7fffffff);
}

function prose(rnd: () => number, words: number): string {
	let out = '';
	for (let i = 0; i < words; i++) out += WORDS[Math.floor(rnd() * WORDS.length)] + (rnd() < 0.3 ? ' ' : '');
	return out;
}

function diff(path: string, n: number, turn: number): string {
	const lines = [`--- a/${path}`, `+++ b/${path}`, `@@ -${turn},${n} +${turn},${n} @@`];
	for (let i = 0; i < n; i++) {
		lines.push(`-	const value${i} = compute(${i}, options.legacy); // turn ${turn}`);
		lines.push(`+	const value${i} = compute(${i}, options); // turn ${turn}, line ${i}`);
		if (i % 5 === 0) lines.push(`  	// context line ${i}`);
	}
	return lines.join('\n');
}

function log(n: number, turn: number): string {
	const out: string[] = [];
	for (let i = 0; i < n; i++) out.push(`[${String(i).padStart(4, '0')}] ✓ src/lib/module${i % 40}.test.ts > case ${turn}.${i} passes in ${(i % 17) + 1}ms`);
	return out.join('\n');
}

// A screenshot as the read tool returns it: about 400 KB of base64 (the
// screenshots read in real conversations are 300–800 KB each).
let shot = '';
function screenshotBase64(): string {
	if (shot) return shot;
	const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
	const rnd = rng(42);
	const out: string[] = [];
	for (let i = 0; i < 4096; i++) out.push(abc[Math.floor(rnd() * 64)]!);
	const block = out.join('');
	shot = block.repeat(100);
	return shot;
}

export function historyEvents(turns: number, from = 0): Record<string, unknown>[] {
	const evs: Record<string, unknown>[] = [];
	for (let t = from; t < from + turns; t++) {
		const rnd = rng(t + 1);
		const user = `第 ${t + 1} 轮：把会话缓存改成按会话分片，${prose(rnd, 12)}`;
		evs.push({ type: 'user_message', content: user, ...(t % 10 === 9 ? { images: [`/tmp/perf-project/shot-${t}.png`] } : {}) });
		evs.push({ type: 'status', message: 'streaming' });
		evs.push({ type: 'thinking_start' });
		const reasoning = Array.from({ length: 4 }, () => prose(rnd, 120)).join('\n\n');
		for (let i = 0; i < reasoning.length; i += 400) evs.push({ type: 'reasoning_delta', delta: reasoning.slice(i, i + 400) });
		const id = (k: string) => `t${t}-${k}`;
		const path = `/tmp/perf-project/src/lib/module${t % 40}.ts`;
		evs.push({ type: 'tool_start', call_id: id('r'), name: 'read' });
		evs.push({ type: 'tool_output', call_id: id('r'), name: 'read', output: JSON.stringify({ path, kind: 'text', content: log(60, t), hashlines: 'x' }) });
		evs.push({ type: 'tool_start', call_id: id('b'), name: 'bash' });
		evs.push({ type: 'tool_update', call_id: id('b'), name: 'bash', output: 'started: pnpm vitest run' });
		evs.push({ type: 'tool_output', call_id: id('b'), name: 'bash', output: JSON.stringify({ command: 'pnpm vitest run', exit_code: 0, stdout: log(200, t), stderr: '' }) });
		evs.push({ type: 'tool_start', call_id: id('e'), name: 'edit' });
		evs.push({ type: 'tool_output', call_id: id('e'), name: 'edit', output: JSON.stringify({ path, diff: diff(`src/lib/module${t % 40}.ts`, 80, t) }) });
		evs.push({ type: 'tool_start', call_id: id('g'), name: 'grep' });
		evs.push({ type: 'tool_output', call_id: id('g'), name: 'grep', output: JSON.stringify({ entries: Array.from({ length: 30 }, (_, i) => `src/lib/module${i}.ts:${i + 10}: sessionCache.get(key)`) }) });
		if (t % 10 === 4) {
			const base64 = screenshotBase64();
			evs.push({ type: 'tool_start', call_id: id('i'), name: 'read' });
			evs.push({ type: 'tool_output', call_id: id('i'), name: 'read', output: JSON.stringify({ base64, bytes: (base64.length * 3) / 4, kind: 'image', mime: 'image/png', path: `/tmp/perf-project/shot-${t}.png` }) });
		} else {
			evs.push({ type: 'tool_start', call_id: id('l'), name: 'list_dir' });
			evs.push({ type: 'tool_output', call_id: id('l'), name: 'list_dir', output: JSON.stringify({ entries: ['a.ts', 'b.ts', 'c.ts'] }) });
		}
		const reply = [
			`第 ${t + 1} 轮改好了：${prose(rnd, 40)}`,
			'',
			'```ts',
			...Array.from({ length: 12 }, (_, i) => `export const shard${i} = (session: string, key: string) => \`\${session}:\${key}:${i}\`;`),
			'```',
			'',
			'| 文件 | 改动 | 说明 |',
			'| --- | --- | --- |',
			...Array.from({ length: 6 }, (_, i) => `| src/lib/module${i}.ts | +${i * 3} −${i} | ${prose(rnd, 6)} |`),
			'',
			prose(rnd, 60)
		].join('\n');
		for (let i = 0; i < reply.length; i += 300) evs.push({ type: 'assistant_delta', delta: reply.slice(i, i + 300) });
		evs.push({ type: 'usage', input_tokens: 30000 + t, output_tokens: 800 });
		evs.push({ type: 'status', message: 'ready' });
	}
	return evs;
}

/** The same conversation as a `transcript` replay (what the engine sends
 *  when a conversation opens again): its messages, replies and tool calls. */
export function historyTranscript(turns: number): Record<string, unknown> {
	const items: Record<string, unknown>[] = [];
	let reply = '';
	for (const ev of historyEvents(turns)) {
		if (ev.type === 'user_message') items.push({ role: 'user', content: ev.content, ...(ev.images ? { images: ev.images } : {}) });
		else if (ev.type === 'assistant_delta') reply += ev.delta as string;
		else if (ev.type === 'tool_output') items.push({ role: 'tool', name: ev.name, output: ev.output });
		else if (ev.type === 'status' && ev.message === 'ready' && reply) {
			items.push({ role: 'assistant', content: reply });
			reply = '';
		}
	}
	return { type: 'transcript', items };
}
