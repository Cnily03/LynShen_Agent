#!/usr/bin/env node
// Writes the DeepSeek Harness (DSH) session logs that the agent_import::dsh
// tests read: a fake DSH home, `home/.dsh/sessions`, in the layout and the
// encoding that DSH 0.2.x writes (dsh-session-persistence-jsonl):
// `sessions/<project>/<session id>/session.v<N>.jsonl`, plain or `.zstd`. A
// compressed log is a header frame followed by one checksummed Zstandard
// frame per write, made with node:zlib as DSH makes them.
//
// The conversations are DSH's own snapshot logs (source/*.jsonl, copied from
// deepseek-ai/deepseek-harness `snapshots/web` at dsh-v0.2.1-alpha.5, MIT
// licensed, see source/LICENSE). This script fills in their placeholders and
// adds the `seq` and `time` fields that the snapshots leave out. They contain
// no real user data. Run it again after a change, then commit the output:
//
//   node src-tauri/tests/fixtures/dsh/make-fixtures.mjs

import { constants, zstdCompressSync } from 'node:zlib';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sessions = join(here, 'home', '.dsh', 'sessions');

const FILL = {
	system: 'You are DeepSeek Harness, a coding agent.',
	clientTimeZone: 'Asia/Shanghai',
	timeContextTimestamp: '2026-10-01T10:00:05+08:00',
	elapsed: '2s',
	sourceRoot: '/opt/deepseek-harness',
	webUrl: 'http://127.0.0.1:5173/',
	harnessHome: '/Users/demo/.dsh'
};

/** The rows of one snapshot log, its placeholders filled. */
function snapshot(name, ids, cwd) {
	const text = (s) =>
		s.replace(/\{\{(\w+)(?::(\d+))?\}\}/g, (_, key, n) => {
			if (key === 'session') return ids[Number(n) - 1];
			if (key === 'cwd') return cwd ?? '';
			if (key in FILL) return FILL[key];
			return `${key}-${n ?? 0}`;
		});
	const fill = (value) => {
		if (typeof value === 'string') return value === '{{tools}}' ? [] : text(value);
		if (Array.isArray(value)) return value.map(fill);
		if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v)]));
		return value;
	};
	return readFileSync(join(here, 'source', name), 'utf8')
		.split('\n')
		.filter(Boolean)
		.map((line) => fill(JSON.parse(line)));
}

/** The header fields in the order DSH writes them. */
const HEADER = ['type', 'version', 'id', 'createdAt', 'cwd', 'parentSession', 'isSeeded', 'origin', 'delegationDepth', 'agentPreset'];

/** A header and its events as DSH writes them: `seq` from 0, `time` in ms. */
function log(rows, headerChanges = {}) {
	const merged = { ...rows[0], ...headerChanges };
	const header = Object.fromEntries(HEADER.filter((k) => merged[k] !== undefined).map((k) => [k, merged[k]]));
	const events = rows.slice(1).map(({ type, data, ...rest }, seq) => ({
		type,
		seq,
		time: header.createdAt + (seq + 1) * 1000,
		data,
		...rest
	}));
	return { header, events };
}

/** Appends events after the ones a log has, numbered on. */
function append(l, rows) {
	for (const { type, data, ...rest } of rows) {
		const seq = l.events.length;
		l.events.push({ type, seq, time: l.header.createdAt + (seq + 1) * 1000, data, ...rest });
	}
	return l;
}

/** DSH's `projectKey`: the readable project folder name of a working folder. */
function projectKey(cwd) {
	let readable = '';
	let run = false;
	for (let i = 0; i < cwd.length; i++) {
		const code = cwd.charCodeAt(i);
		const ch = String.fromCharCode(code);
		if (ch === '/' || ch === '\\' || ch === ':') {
			if (!run) readable += '-';
			run = true;
		} else if (/^[A-Za-z0-9._-]$/.test(ch)) {
			readable += ch;
			run = false;
		} else {
			readable += '~' + code.toString(16).toUpperCase().padStart(4, '0');
			run = false;
		}
	}
	return `--${(readable.replace(/^-+/, '') || 'root').slice(0, 251)}--`;
}

const zstd = (text) => zstdCompressSync(Buffer.from(text), { params: { [constants.ZSTD_c_checksumFlag]: 1 } });
const lines = (rows) => rows.map((r) => JSON.stringify(r) + '\n').join('');

/** Byte offset of the first block header in a frame. */
function firstBlock(frame) {
	const descriptor = frame[4];
	const single = (descriptor & 0x20) !== 0;
	const sizeFlag = descriptor >> 6;
	const dict = [0, 1, 2, 4][descriptor & 3];
	const size = sizeFlag === 0 ? (single ? 1 : 0) : 1 << sizeFlag;
	return 5 + (single ? 0 : 1) + dict + size;
}

/**
 * Writes one conversation's log. `batch`: events per write (one frame each
 * when compressed). `torn`: the last write was cut short by a crash (half a
 * frame, or a line without its newline). `corrupt`: the second frame's first
 * block has the reserved block type, as a damaged file would.
 */
function write(cwd, l, { version = 4, compressed = true, batch = 6, torn = false, corrupt = false } = {}) {
	const dir = join(sessions, cwd === undefined ? '_no-cwd' : projectKey(cwd), l.header.id);
	mkdirSync(dir, { recursive: true });
	const name = `session.v${version}.jsonl${compressed ? '.zstd' : ''}`;
	const writes = [];
	for (let i = 0; i < l.events.length; i += batch) writes.push(l.events.slice(i, i + batch));
	if (!compressed) {
		let text = lines([l.header]) + writes.map(lines).join('');
		if (torn) text += JSON.stringify(torn).slice(0, 40);
		writeFileSync(join(dir, name), text);
		return;
	}
	const frames = [zstd(lines([l.header])), ...writes.map((w) => zstd(lines(w)))];
	if (corrupt) {
		const frame = Buffer.from(frames[2]);
		frame[firstBlock(frame)] |= 0b110;
		frames[2] = frame;
	}
	if (torn) {
		const last = zstd(lines(torn));
		frames.push(last.subarray(0, Math.floor(last.length / 2)));
	}
	writeFileSync(join(dir, name), Buffer.concat(frames));
}

const ID = (n) => `session-0d5a${n}-1b2c-4d3e-8f40-5a6b7c8d9e0f`;

rmSync(join(here, 'home'), { recursive: true, force: true });

// A file and an image sent with the prompt, a tool round, the title DSH
// gave it, and a record of a plugin of DSH's desktop edition (ignorable).
{
	const l = log(snapshot('file-upload-round.v4.jsonl', [ID('0001')], '/Users/demo/upload'));
	append(l, [{ type: 'plugin:dsh-tauri-kernel/identity', data: { name: 'Nemo' }, ignorable: true }]);
	write('/Users/demo/upload', l);
}

// Plain text (`compression: none`): a compaction whose checkpoint replaced
// the first prompt, and a last line a crash cut short.
{
	const cwd = '/Users/demo/compact';
	const l = log(snapshot('minimal-compact.v4.jsonl', [ID('0002')], cwd));
	write(cwd, l, { compressed: false, torn: { type: 'turn/start', seq: l.events.length, time: 1, data: { turn: 3 } } });
}

// A Windows folder; a question answered through a tool, a prompt sent while
// the agent worked, and a last write a crash cut short.
{
	const cwd = 'C:\\Users\\demo\\steer';
	const l = log(snapshot('steering.v4.jsonl', [ID('0003')], cwd));
	const seq = l.events.length;
	const time = l.header.createdAt + (seq + 1) * 1000;
	write(cwd, l, {
		torn: [
			{ type: 'turn/start', seq, time, data: { turn: 2 } },
			{
				type: 'user/message',
				seq: seq + 1,
				time: time + 1,
				data: { content: [{ type: 'text', text: 'LOST_IN_THE_CRASH' }], source: { kind: 'user' }, role: 'user', id: 'message-99' },
				surfaceOp: 'append'
			}
		]
	});
}

// A conversation and the sub-agent it ran: the sub-agent's log belongs to it.
{
	const cwd = '/Users/demo/fork';
	const ids = [ID('0004'), ID('0005')];
	write(cwd, log(snapshot('subagent-fork-schedule.v4.jsonl', ids, cwd)));
	write(cwd, log(snapshot('subagent-fork-schedule.child.v4.jsonl', ids, cwd)));
}

// Format 3 only: DSH updates it when the conversation is opened there.
{
	const cwd = '/Users/demo/chat';
	write(cwd, log(snapshot('deepseek-messages-chat.v3.jsonl', [ID('0006')], cwd)), { version: 3 });
}

// Updated already: format 3 kept beside format 4, which is read. Then a fork
// of it: the inherited history, its marker, and a prompt of its own.
{
	const cwd = '/Users/demo/chat';
	write(cwd, log(snapshot('deepseek-messages-chat.v3.jsonl', [ID('0007')], cwd)), { version: 3 });
	const l = log(snapshot('deepseek-messages-chat.v4.jsonl', [ID('0007')], cwd), { createdAt: 1788785100000 });
	write(cwd, l);
	const fork = log(snapshot('deepseek-messages-chat.v4.jsonl', [ID('0008')], cwd), {
		createdAt: 1788785200000,
		parentSession: ID('0007'),
		isSeeded: true
	});
	append(fork, [
		{ type: 'session/end-seed', data: { inherited: true } },
		{ type: 'turn/start', data: { turn: 2 } },
		{
			type: 'user/message',
			data: { content: [{ type: 'text', text: '换个说法再回复一次。' }], source: { kind: 'user' }, role: 'user', id: 'message-20' },
			surfaceOp: 'append'
		},
		{
			type: 'assistant/message',
			data: {
				turn: 2,
				step: 1,
				message: {
					role: 'assistant',
					content: [{ type: 'text', text: 'MESSAGES_WEB_READY（第二次）' }],
					source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-v4-flash' },
					id: 'message-21'
				},
				stream: []
			},
			surfaceOp: 'append'
		},
		{ type: 'session/title', data: { title: '分叉：再回复一次', messageSeqs: [], source: { kind: 'user' } } },
		{ type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } }
	]);
	write(cwd, fork);
}

// Written by a newer DSH: format 5, and format 4 with an event this
// version does not know and may not skip.
{
	write('/Users/demo/future', log(snapshot('deepseek-messages-chat.v4.jsonl', [ID('0009')], '/Users/demo/future'), { version: 5 }), {
		version: 5
	});
	const l = log(snapshot('deepseek-messages-chat.v4.jsonl', [ID('0010')], '/Users/demo/unknown'));
	append(l, [{ type: 'review/verdict', data: { verdict: 'accept' } }]);
	write('/Users/demo/unknown', l);
}

// No working folder recorded; a damaged frame; a session with no prompt.
{
	write(undefined, log(snapshot('deepseek-messages-chat.v4.jsonl', [ID('0011')], undefined), { cwd: undefined }));
	write('/Users/demo/broken', log(snapshot('deepseek-messages-chat.v4.jsonl', [ID('0012')], '/Users/demo/broken')), {
		corrupt: true,
		batch: 4
	});
	const empty = log(snapshot('deepseek-messages-chat.v4.jsonl', [ID('0013')], '/Users/demo/empty'));
	empty.events = empty.events.slice(0, 3);
	write('/Users/demo/empty', empty);
}
