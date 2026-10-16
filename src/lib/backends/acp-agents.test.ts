import { describe, it, expect } from 'vitest';
import { tokenizeArgs, formatArgs, slugifyAgentId, isOpencodeAgent, agentEnv, opencodeRefusal } from './acp-agents';

describe('tokenizeArgs', () => {
	it('splits on whitespace and honors quotes', () => {
		expect(tokenizeArgs('--experimental-acp')).toEqual(['--experimental-acp']);
		expect(tokenizeArgs('acp  --verbose')).toEqual(['acp', '--verbose']);
		expect(tokenizeArgs('--flag "a b" \'c d\'')).toEqual(['--flag', 'a b', 'c d']);
		expect(tokenizeArgs('')).toEqual([]);
		expect(tokenizeArgs('   ')).toEqual([]);
	});

	it('round-trips through formatArgs', () => {
		const args = ['acp', '--model', 'gemini 3 pro'];
		expect(tokenizeArgs(formatArgs(args))).toEqual(args);
		expect(formatArgs(args)).toBe('acp --model "gemini 3 pro"');
	});
});

describe('slugifyAgentId', () => {
	it('lowercases, strips punctuation and never returns empty', () => {
		expect(slugifyAgentId('Gemini CLI')).toBe('gemini-cli');
		expect(slugifyAgentId('  LynShen (ACP)!  ')).toBe('lynshen-acp');
		expect(slugifyAgentId('日本語')).toBe('agent');
	});

	it('deduplicates against taken ids with a numeric suffix', () => {
		const taken = new Set(['gemini-cli', 'gemini-cli-2']);
		expect(slugifyAgentId('Gemini CLI', taken)).toBe('gemini-cli-3');
	});
});

describe('OpenCode agents', () => {
	const opencode = { id: 'opencode', name: 'OpenCode', command: 'opencode', args: ['acp'], env: {} };

	it('are recognised by program, with a path or a Windows extension', () => {
		expect(isOpencodeAgent(opencode)).toBe(true);
		expect(isOpencodeAgent({ command: '/opt/homebrew/bin/opencode', args: ['acp'] })).toBe(true);
		expect(isOpencodeAgent({ command: 'C:\\npm\\node_modules\\opencode-ai\\bin\\opencode.exe', args: ['acp'] })).toBe(true);
		expect(isOpencodeAgent({ command: 'opencode', args: ['serve'] })).toBe(false);
		expect(isOpencodeAgent({ command: 'gemini', args: ['--experimental-acp'] })).toBe(false);
	});

	it('get a server password of their own unless one is set', () => {
		const env = agentEnv(opencode, { HTTPS_PROXY: 'http://p' }, () => 'secret');
		expect(env).toEqual({ HTTPS_PROXY: 'http://p', OPENCODE_SERVER_PASSWORD: 'secret' });
		const own = { ...opencode, env: { OPENCODE_SERVER_PASSWORD: 'mine' } };
		expect(agentEnv(own, {}, () => 'secret').OPENCODE_SERVER_PASSWORD).toBe('mine');
		expect(agentEnv(opencode).OPENCODE_SERVER_PASSWORD).toMatch(/^[0-9a-f]{48}$/);
		expect(agentEnv(opencode).OPENCODE_SERVER_PASSWORD).not.toBe(agentEnv(opencode).OPENCODE_SERVER_PASSWORD);
	});

	it('leave other agents\' environment as configured, the agent\'s own winning', () => {
		const gemini = { id: 'gemini', name: 'Gemini', command: 'gemini', args: ['--experimental-acp'], env: { A: 'agent' } };
		expect(agentEnv(gemini, { A: 'base', B: 'base' })).toEqual({ A: 'agent', B: 'base' });
	});
});

describe('opencodeRefusal', () => {
	it('names 2.x and later, and lets 1.x or an unreadable version pass', () => {
		expect(opencodeRefusal('1.19.0')).toBeNull();
		expect(opencodeRefusal('opencode 1.2.3')).toBeNull();
		expect(opencodeRefusal('2.0.29')).toBe('2.0.29');
		expect(opencodeRefusal('opencode v3.1.0\n')).toBe('3.1.0');
		expect(opencodeRefusal('')).toBeNull();
		expect(opencodeRefusal(undefined)).toBeNull();
	});
});
