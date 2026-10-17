import { describe, expect, it } from 'vitest';
import { anthropicV1Suggestion, messagesUrl, normalizeBaseUrl, requestUrl, resolveFormat } from './endpoint';

describe('requestUrl (the engine’s transport::endpoint)', () => {
	it('builds the Anthropic Messages URL as llm-provider-kit messages_url does', () => {
		// anthropic.rs builds_messages_url_for_gateway_and_official_bases
		expect(messagesUrl('https://gateway.example.com')).toBe('https://gateway.example.com/anthropic/v1/messages');
		expect(messagesUrl('https://gateway.example.com/anthropic')).toBe('https://gateway.example.com/anthropic/v1/messages');
		expect(messagesUrl('https://gateway.example.com/v1')).toBe('https://gateway.example.com/v1/messages');
		expect(messagesUrl('https://api.anthropic.com')).toBe('https://api.anthropic.com/v1/messages');
		expect(messagesUrl('https://api.anthropic.com/v1/')).toBe('https://api.anthropic.com/v1/messages');
		// Ticket #24: the host alone goes to a path the LynShen gateway does not serve.
		expect(requestUrl('anthropic', 'https://www.lynshen.org')).toBe('https://www.lynshen.org/anthropic/v1/messages');
		expect(requestUrl('anthropic', 'https://www.lynshen.org/v1')).toBe('https://www.lynshen.org/v1/messages');
	});

	it('places each Responses dialect and Chat Completions at its own path', () => {
		// responses.rs urls_place_each_responses_dialect_at_its_own_endpoint
		expect(requestUrl('responses', 'https://api.openai.com/v1')).toBe('https://api.openai.com/v1/responses');
		expect(requestUrl('codex', 'https://chatgpt.com/backend-api')).toBe('https://chatgpt.com/backend-api/codex/responses');
		expect(requestUrl('azure', 'https://res.openai.azure.com/openai/v1')).toBe('https://res.openai.azure.com/openai/v1/responses?api-version=v1');
		// chat.rs completions_url_joins_base_without_double_slash
		expect(requestUrl('chat', 'http://127.0.0.1:11434/v1/')).toBe('http://127.0.0.1:11434/v1/chat/completions');
		expect(requestUrl('chat', 'https://openrouter.ai/api/v1')).toBe('https://openrouter.ai/api/v1/chat/completions');
	});

	it('reads the base URL as config.json does', () => {
		expect(normalizeBaseUrl('  https://api.example.com/v1/// ')).toBe('https://api.example.com/v1');
		expect(normalizeBaseUrl('https://api.lynshen.cn/v1')).toBe('https://api.lynshen.org/v1');
		expect(normalizeBaseUrl('https://api.lynshen.net')).toBe('https://api.lynshen.org');
		expect(normalizeBaseUrl('https://api.lynshen.cnx')).toBe('https://api.lynshen.cnx');
		expect(requestUrl('responses', 'https://api.lynshen.cn/v1/')).toBe('https://api.lynshen.org/v1/responses');
	});

	it('picks the format by model when none is set', () => {
		expect(resolveFormat('', 'claude-fable-5')).toBe('anthropic');
		expect(resolveFormat('', 'gpt-5')).toBe('responses');
		expect(resolveFormat('openai-codex-responses', 'gpt-5')).toBe('responses');
		expect(requestUrl('', 'https://relay.example.com/v1', 'claude-fable-5')).toBe('https://relay.example.com/v1/messages');
	});
});

describe('anthropicV1Suggestion', () => {
	it('offers {host}/v1 for a bare host in the Anthropic format', () => {
		expect(anthropicV1Suggestion('anthropic', 'https://www.lynshen.org')).toBe('https://www.lynshen.org/v1');
		expect(anthropicV1Suggestion('anthropic', 'https://www.lynshen.org/ ')).toBe('https://www.lynshen.org/v1');
		expect(anthropicV1Suggestion('anthropic', 'http://127.0.0.1:8080')).toBe('http://127.0.0.1:8080/v1');
	});

	it('offers nothing where the engine already builds a /v1 path or the format differs', () => {
		expect(anthropicV1Suggestion('anthropic', 'https://www.lynshen.org/v1')).toBeNull();
		expect(anthropicV1Suggestion('anthropic', 'https://relay.example.com/anthropic')).toBeNull();
		expect(anthropicV1Suggestion('anthropic', 'https://relay.example.com/api')).toBeNull();
		expect(anthropicV1Suggestion('anthropic', 'https://api.anthropic.com')).toBeNull();
		expect(anthropicV1Suggestion('anthropic', 'not a url')).toBeNull();
		expect(anthropicV1Suggestion('anthropic', '')).toBeNull();
		expect(anthropicV1Suggestion('responses', 'https://www.lynshen.org')).toBeNull();
		expect(anthropicV1Suggestion('chat', 'https://www.lynshen.org')).toBeNull();
	});
});
