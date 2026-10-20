import { describe, expect, it } from 'vitest';
import { phoneCommand, slashMatches } from './slash';

const commands = ['/compact', '/context', '/goal', '/login', '/model', '/new', '/rewind', '/stats'].map((command) => ({ command, marker: null }));

describe('phone "/" commands (ticket #46)', () => {
	it('complete from the engine’s list, starts first, without the computer-only ones', () => {
		expect(slashMatches('/', commands).map((c) => c.command)).toEqual(['/compact', '/context', '/goal', '/model', '/rewind', '/stats']);
		expect(slashMatches('/co', commands).map((c) => c.command)).toEqual(['/compact', '/context']);
		expect(slashMatches('/at', commands).map((c) => c.command)).toEqual(['/stats']);
		// A finished word, a typed argument or plain text: no list.
		expect(slashMatches('/compact', commands)).toEqual([]);
		expect(slashMatches('/goal ship', commands)).toEqual([]);
		expect(slashMatches('hello', commands)).toEqual([]);
	});

	it('send a known command as a command, a path as a message, a computer one nowhere', () => {
		expect(phoneCommand('/compact', commands)).toEqual({ kind: 'command' });
		expect(phoneCommand('/goal ship the fix', commands)).toEqual({ kind: 'command' });
		expect(phoneCommand('/usr/bin 里有什么', commands)).toEqual({ kind: 'message' });
		expect(phoneCommand('/login', commands)).toEqual({ kind: 'computer', name: '/login' });
	});
});
