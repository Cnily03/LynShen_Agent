// ?anthropic[=keyed]: the engine also lists Anthropic as a built-in provider,
// with the fields `lynshen providers` prints (LynShen CLI 0.7.0: no
// `reasoning`, no input kinds). A key saved here (set_auth_key) counts as
// saved. =keyed: its key is saved already, and it is the default provider in
// config.json (ticket #24: the custom settings of a built-in provider).
export function builtinProviderFixture(params: URLSearchParams): ((command: string, args: any) => unknown) | null {
	if (!params.has('anthropic')) return null;
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
