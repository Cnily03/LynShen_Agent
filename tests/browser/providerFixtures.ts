// ?anthropic[=keyed]: the engine also lists Anthropic as a built-in provider,
// with the fields `lynshen providers` prints (LynShen CLI 0.7.0: no
// `reasoning`, no input kinds). A key saved here (set_auth_key) counts as
// saved. =keyed: its key is saved already, and it is the default provider in
// config.json (ticket #24: the custom settings of a built-in provider).
//
// ?engine070: the engine also lists Moonshot as LynShen CLI 0.7.0 prints
// it (every Chat Completions model with only "none", thinking or not) and one
// model as CLI 0.7.1 prints it (`reasoning: false`).
//
// Always: 获取可用模型 (provider_models) answers a relay's model list, or
// for a base URL with "denied" in it, the relay's refusal; for one with
// "thinking" in it, a list that says which models think (what
// provider_models.rs reads from capabilities, supported_parameters, …).
const THINKING_MODELS = [
	// Anthropic's list: capabilities.thinking and capabilities.effort.
	{ id: 'claude-relay-5', display_name: 'Claude Relay 5', context_window: 1000000, max_output_tokens: 128000, input_modalities: ['text', 'image'], reasoning: true, reasoning_efforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'] },
	// OpenRouter: "reasoning" in supported_parameters.
	{ id: 'vendor/thinker-x', display_name: 'Thinker X', context_window: 256000, reasoning: true },
	// Says nothing; the engine's table lists it with only "none".
	{ id: 'kimi-k2-thinking' },
	// Says it does not think.
	{ id: 'plain-chat', reasoning: false }
];
const RELAY_MODELS = [
	{ id: 'claude-opus-5-5' },
	{ id: 'glm-5.3-flash' },
	{ id: 'vendor/long-ctx', display_name: 'Long Context', context_window: 2000000, max_output_tokens: 100000, input_modalities: ['text'] },
	{ id: 'relay-mystery' }
];
function modelList(command: string, args: any): unknown {
	if (command !== 'provider_models') return undefined;
	if (String(args.baseUrl).includes('denied')) throw 'HTTP 401: invalid api key';
	return { url: `${args.baseUrl}/models`, models: String(args.baseUrl).includes('thinking') ? THINKING_MODELS : RELAY_MODELS };
}

const MOONSHOT_070 = {
	id: 'moonshot',
	base_url: 'https://api.moonshot.ai/v1',
	protocol: 'chat',
	models: [
		{ name: 'kimi-k2-thinking', display_name: 'Kimi K2 Thinking', context_window: 262144, max_context_window: 0, max_output_tokens: 262144, reasoning_efforts: ['none'] },
		{ name: 'moonshot-v1-8k', display_name: null, context_window: 8192, max_context_window: 0, max_output_tokens: 4096, reasoning: false, reasoning_efforts: ['none'] }
	]
};

export function builtinProviderFixture(params: URLSearchParams): (command: string, args: any) => unknown {
	if (params.has('engine070'))
		return (command, args) =>
			command === 'list_providers' ? [{ id: 'openai', base_url: 'https://api.openai.com/v1', protocol: 'responses', models: [{ name: 'gpt-5' }] }, MOONSHOT_070] : modelList(command, args);
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
