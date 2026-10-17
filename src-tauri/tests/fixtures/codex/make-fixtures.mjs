#!/usr/bin/env node
// Writes the Codex home that the native_import and agent_import tests read
// (`home/.codex`): rollouts as Codex 0.158+ writes them in its paginated
// history mode (every row with an `ordinal`; a prompt is the `item_completed`
// event of a `UserMessage` item, no `user_message` event), an older
// (legacy) rollout, and rollouts Codex compressed into `.jsonl.zst`: one
// Zstandard frame of the whole file at level 3, as codex-rs
// rollout/src/compression.rs writes it (node:zlib uses the same libzstd).
// Row shapes follow openai/codex codex-rs/protocol (RolloutLine, EventMsg,
// TurnItem, UserInput) at ce0323f2. No real user data. Run it again after a
// change, then commit the output:
//
//   node src-tauri/tests/fixtures/codex/make-fixtures.mjs

import { constants, zstdCompressSync } from 'node:zlib';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const home = join(here, 'home', '.codex');
rmSync(join(here, 'home'), { recursive: true, force: true });

export const CWD = 'D:\\我要干大活\\三角帧不掉洲';
// Thread ids (UUID v7, as Codex makes them).
const PAGED = '019a3b10-6c2e-7d11-9a40-1d3c5e7f0a01';
const PACKED = '019a1f22-3b4c-7e55-8f66-2a4b6c8d0e02';
const LEGACY = '019963aa-1b2c-7d3e-8f40-3c5e7a9b1d03';
const FORKED = '019a2c33-4d5e-7f60-9a71-4e6f8a0b2c04';
const FORK_SEG = '019a3a44-5e6f-7071-8b82-5f708192a305';
const BOTH = '019a3b55-6f70-7182-9c93-6a8192a3b406';

const at = (day, hms) => `2026-10-${day}T${hms}.000Z`;

/** A paginated rollout: rows with contiguous ordinals from `first`. */
function paged(id, day, turns, { first = 0, meta = {} } = {}) {
	const rows = [];
	let ordinal = first;
	let t = 0;
	const ts = () => at(day, `0${Math.floor(t / 60) % 10}:${String(t++ % 60).padStart(2, '0')}:00`.slice(-8));
	const row = (type, payload) => rows.push({ timestamp: ts(), ordinal: ordinal++, type, payload });
	row('session_meta', {
		session_id: id,
		id,
		timestamp: ts(),
		cwd: CWD,
		originator: 'Codex Desktop',
		cli_version: '0.163.0',
		source: 'vscode',
		model_provider: 'openai',
		history_mode: 'paginated',
		...meta
	});
	turns.forEach((prompt, i) => {
		const turn = `turn-${id.slice(-4)}-${i + 1}`;
		row('event_msg', { type: 'task_started', turn_id: turn, model_context_window: 258400 });
		if (i === 0) {
			row('response_item', { type: 'message', role: 'developer', content: [{ type: 'input_text', text: '<permissions instructions>\nworkspace-write\n</permissions instructions>' }] });
			row('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: `# AGENTS.md instructions for ${CWD}\n\n<INSTRUCTIONS>\n用中文回答。\n</INSTRUCTIONS>` }] });
			row('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: `<environment_context>\n  <cwd>${CWD}</cwd>\n  <shell>powershell</shell>\n</environment_context>` }] });
		}
		row('turn_context', { turn_id: turn, cwd: CWD, approval_policy: 'on-request', model: 'gpt-5.5', effort: 'medium', summary: 'auto' });
		row('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt }] });
		row('event_msg', { type: 'item_completed', thread_id: id, turn_id: turn, item: { type: 'UserMessage', id: `${turn}-u`, content: [{ type: 'text', text: prompt, text_elements: [] }] }, completed_at_ms: 1792000000000 + ordinal });
		row('response_item', { type: 'reasoning', summary: [], content: null, encrypted_content: 'gAAAAABpaginated-reasoning' });
		row('response_item', { type: 'function_call', name: 'shell_command', arguments: JSON.stringify({ command: 'Get-ChildItem src', workdir: CWD }), call_id: `call_${turn}` });
		row('response_item', { type: 'function_call_output', call_id: `call_${turn}`, output: 'Exit code: 0\nOutput:\nmain.cpp\nlauncher.cpp' });
		const answer = `好的，${prompt}已经完成。`;
		row('response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: answer }], phase: 'final_answer' });
		row('event_msg', { type: 'item_completed', thread_id: id, turn_id: turn, item: { type: 'AgentMessage', id: `${turn}-a`, content: [{ type: 'Text', text: answer }], phase: 'final_answer' }, completed_at_ms: 1792000000000 + ordinal });
		row('event_msg', { type: 'token_count', info: null, rate_limits: null });
		row('event_msg', { type: 'task_complete', turn_id: turn, last_agent_message: answer });
	});
	return rows;
}

/** An older (legacy) rollout: no ordinals; prompts as `user_message` events. */
function legacy(id, day, turns) {
	const rows = [{ timestamp: at(day, '01:00:00'), type: 'session_meta', payload: { id, timestamp: at(day, '01:00:00'), cwd: CWD, originator: 'codex_cli_rs', cli_version: '0.120.0', model_provider: 'openai' } }];
	turns.forEach((prompt, i) => {
		const ts = at(day, `01:0${i + 1}:00`);
		rows.push({ timestamp: ts, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt }] } });
		rows.push({ timestamp: ts, type: 'event_msg', payload: { type: 'user_message', message: prompt, images: [], local_images: [], text_elements: [] } });
		rows.push({ timestamp: ts, type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: `已处理：${prompt}` }] } });
		rows.push({ timestamp: ts, type: 'event_msg', payload: { type: 'agent_message', message: `已处理：${prompt}` } });
	});
	return rows;
}

const text = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
const pack = (s) => zstdCompressSync(Buffer.from(s), { params: { [constants.ZSTD_c_compressionLevel]: 3 } });
function put(path, data) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, data);
}
const day = (d) => join(home, 'sessions', '2026', '10', d);

// The thread of ticket #35's list, as Codex Desktop writes it now: plain,
// paginated, two prompts.
put(join(day('17'), `rollout-2026-10-17T13-50-00-${PAGED}.jsonl`), text(paged(PAGED, '17', ['添加关闭预启动开关', '启动时也读取这个开关'])));
// A week-old paginated thread, compressed: three prompts.
put(join(day('09'), `rollout-2026-10-09T08-10-00-${PACKED}.jsonl.zst`), pack(text(paged(PACKED, '09', ['修复安装包进程终止与启动', '安装失败时给出提示', '再跑一遍测试']))));
// An older legacy thread, compressed: two prompts.
put(join(home, 'sessions', '2026', '09', '20', `rollout-2026-09-20T09-00-00-${LEGACY}.jsonl.zst`), pack(text(legacy(LEGACY, '01', ['检查前台游戏调度时间片', '把结果写成表格']))));
// A thread rolled back (thread/revert) after Codex compressed its first
// file: the plain file continues the compressed one below ordinal 22, the
// end of its first turn.
const base = paged(FORKED, '11', ['评估项目能否用于优化工具', '这一轮被撤回了']);
const cut = base.findIndex((r) => r.payload.type === 'task_started' && r.ordinal > 0 && r.payload.turn_id.endsWith('-2'));
put(join(day('11'), `rollout-2026-10-11T10-00-00-${FORKED}.jsonl.zst`), pack(text(base)));
const offset = Buffer.byteLength(text(base.slice(0, cut)));
put(
	join(day('16'), `rollout-2026-10-16T12-00-00-${FORKED}_${FORK_SEG}.jsonl`),
	text(paged(FORKED, '16', ['改成先评估再优化'], { first: cut, meta: { history_base: { thread_id: FORKED, end_ordinal_exclusive: cut, end_byte_offset: offset } } }))
);
// A file in both forms (a compression that did not finish): one thread.
const both = text(paged(BOTH, '10', ['修复游戏目录识别崩溃']));
put(join(day('10'), `rollout-2026-10-10T07-00-00-${BOTH}.jsonl`), both);
put(join(day('10'), `rollout-2026-10-10T07-00-00-${BOTH}.jsonl.zst`), pack(both));
// Codex's compression staging file: not a rollout.
put(join(day('10'), 'rollout-compress-4242.tmp'), pack(both));
// The names Codex gave its threads (the last line of an id wins).
put(
	join(home, 'session_index.jsonl'),
	text([
		{ id: PAGED, thread_name: '添加预启动开关', updated_at: '2026-10-17T05:50:00Z' },
		{ id: PAGED, thread_name: '添加关闭预启动开关', updated_at: '2026-10-17T05:52:00Z' },
		{ id: PACKED, thread_name: '修复安装包进程终止与启动', updated_at: '2026-10-09T08:20:00Z' }
	])
);
console.log('wrote', home, { cut, offset });
