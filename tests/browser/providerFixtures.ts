// ?anthropic[=keyed]: the engine also lists Anthropic as a built-in provider,
// with the fields `lynshen providers` prints (LynShen CLI 0.7.0: no
// `reasoning`, no input kinds). A key saved here (set_auth_key) counts as
// saved. =keyed: its key is saved already, and it is the default provider in
// config.json (ticket #24: the custom settings of a built-in provider).
//
// Always: 获取可用模型 (provider_models) answers a relay's model list, or
// for a base URL with "denied" in it, the relay's refusal.
const RELAY_MODELS = [
	{ id: 'claude-opus-5-5' },
	{ id: 'glm-5.3-flash' },
	{ id: 'vendor/long-ctx', display_name: 'Long Context', context_window: 2000000, max_output_tokens: 100000, input_modalities: ['text'] },
	{ id: 'relay-mystery' }
];
function modelList(command: string, args: any): unknown {
	if (command !== 'provider_models') return undefined;
	if (String(args.baseUrl).includes('denied')) throw 'HTTP 401: invalid api key';
	return { url: `${args.baseUrl}/models`, models: RELAY_MODELS };
}

export function builtinProviderFixture(params: URLSearchParams): (command: string, args: any) => unknown {
	if (!params.has('anthropic')) return modelList;
	const anthropic = {
		id: 'anthropic',
		base_url: 'https://api.anthropic.com',
		protocol: 'anthropic',
		models: [
			{ name: 'claude-fable-5', display_name: 'Claude Fable 5', context_window: 200000, max_context_window: 1000000, max_output_tokens: 64000, reasoning_efforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'] },
			{ name: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5', context_window: 200000, max_output_tokens: 64000, reasoning_efforts: ['none', 'low', 'medium', 'high'] }
		]
	};
	const keyed = new Set(params.get('anthropic') === 'keyed' ? ['anthropic'] : []);
	return (command, args) => {
		switch (command) {
			case 'provider_models':
				return modelList(command, args);
			case 'list_providers':
				return [{ id: 'openai', base_url: 'https://api.openai.com/v1', protocol: 'responses', models: [{ name: 'gpt-5' }] }, anthropic];
			case 'read_auth_providers':
				return [...keyed];
			case 'set_auth_key':
				keyed.add(args.provider);
				return null;
			case 'read_config':
				return keyed.has('anthropic')
					? { provider: 'anthropic', base_url: anthropic.base_url, protocol: 'anthropic', models: anthropic.models, model: 'claude-fable-5', reasoning_effort: 'high' }
					: { provider: 'monoize', models: [] };
			default:
				return undefined;
		}
	};
}
