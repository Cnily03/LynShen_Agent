// Pure packing of the in-chat model picker rows: the current engine's
// model_view catalog plus (for lynshen sessions) the models of every other
// provider that has credentials, grouped for display; for Claude Code / Codex,
// one list of what runs on this machine and on the LynShen gateway. Kept
// free of Svelte so the row shape stays unit-testable.

export interface ModelRow {
	id: string;
	label: string;
	vendor?: string;
	/** Second line: where the model runs (group · channel) and its window. */
	detail: string;
	active: boolean;
	command: string;
	depth: number | undefined;
	group?: string;
	/** The gateway Provider this row pins the model to (`monoize_providers`). */
	route?: string;
	/** Several gateway Providers serve the model: the row opens a page to
	 *  pick one; `command` runs the chosen (or first) one. */
	choices?: RouteChoice[];
	/** A LynShen model several groups serve: the row opens the group page. */
	groupsPage?: boolean;
	/** The model id the row describes (Claude Code: the resolved id, not the alias). */
	model?: string;
	/** The provider that runs it (`claude` / `codex` for their own lists). */
	provider?: string;
	context?: number;
	efforts?: string[];
	/** From the custom provider form: ["text", "image"]. */
	modalities?: string[];
	/** Claude Code / Codex: where the model runs ("此电脑 · LynShen"), and
	 *  whether the LynShen gateway is one of the places. */
	where?: string;
	onGateway?: boolean;
}

/** One line a model can run through, on the model's route page. */
export interface RouteChoice {
	id: string;
	label: string;
	detail: string;
	active: boolean;
	command: string;
}

export interface EngineModel {
	model: string;
	label?: string;
	vendor?: string;
	active: boolean;
	context_window?: number;
	reasoning_efforts?: string[];
	/** false: not in the engine's catalog, only marking what runs. */
	listed?: boolean;
}

/** A gateway Provider one picker row routes through (DA-8a). */
export interface ModelRoute {
	id: string;
	name: string;
	group?: string;
	account_class?: string;
}

export interface CatalogProvider {
	id: string;
	/** Shown as the provider's heading in the model menu. */
	name?: string;
	models: {
		name: string;
		display_name?: string | null;
		context_window?: number;
		/** Input and output together, when it is larger than the window. */
		context_total?: number;
		groups?: string[];
		routes?: ModelRoute[];
		reasoning_efforts?: string[];
		input_modalities?: string[];
	}[];
}

export interface ModelGroupLabels {
	lynshen: string;
	byok: string;
	/** "（共 {total}）" after a window smaller than the whole context. */
	ofTotal?: (total: string) => string;
	/** "Group {group}" / "Channel {channel}" for the route line. */
	routeGroup?: (group: string) => string;
	routeChannel?: (channel: string) => string;
	/** "私有" for `private`: the first half of a Provider row's second line. */
	accountClass?: (accountClass: string) => string;
}

/** The provider's display name for the channel part of the route line. */
const CHANNEL_NAMES: Record<string, string> = { monoize: 'LynShen', lynshen: 'LynShen' };

/** A gateway model's route, "Group default, test · Channel LynShen". */
function routeOf(provider: string, groups: string[] | undefined, labels: ModelGroupLabels): string {
	const parts: string[] = [];
	if (groups?.length && labels.routeGroup) parts.push(labels.routeGroup(groups.join(', ')));
	const channel = CHANNEL_NAMES[provider] ?? provider;
	if (labels.routeChannel) parts.push(labels.routeChannel(channel));
	return parts.join(' · ');
}

/** ChatGPT sign-ins made for Codex (the engine's OAuth providers). */
const CODEX_LOGINS = new Set(['openai-codex', 'openai-codex-device']);

/** Marks the Provider a pick routes through, after the model in its command. */
export const ROUTE_MARK = '@route=';

/** Splits `/model x [effort] @route=p` into the command without it and the Provider. */
export function splitRoute(command: string): { command: string; route?: string } {
	const parts = command.split(/\s+/);
	const at = parts.findIndex((part) => part.startsWith(ROUTE_MARK));
	if (at < 0) return { command };
	const route = parts[at].slice(ROUTE_MARK.length);
	parts.splice(at, 1);
	return { command: parts.join(' '), route: route || undefined };
}

/** A Provider row's second line: account class and Provider, "私有 · 新科研". */
function routeLineOf(route: ModelRoute, labels: ModelGroupLabels): string {
	const scope = route.account_class && labels.accountClass ? labels.accountClass(route.account_class) : '';
	return [scope, route.name].filter(Boolean).join(' · ');
}

/** "claude-opus（default）" → "claude-opus": older configs put the group in the label. */
export function stripGroupSuffix(label: string): string {
	return label.replace(/\s*[（(][^（）()]*[）)]\s*(\/.*)?$/, '').trim() || label;
}

/** Context window as shown beside a model: 272K, 1M; empty when unknown. */
export const fmtContext = (n?: number) =>
	!n ? '' : n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : `${n}`;
/** The group header already names lynshen and the agent's own catalog; BYOK rows
 *  from several providers share one group, so they keep the provider id. */
const detailOf = (provider: string | null, ctx?: number) => [provider, fmtContext(ctx)].filter(Boolean).join(' · ');
/** A LynShen gateway model's window: what a conversation may fill. A model
 *  the gateway registers with a smaller input limit than its whole context
 *  (glm-5.3: 128K of 1M) names both, so 128K does not read as the model's
 *  size; one with no window at all says so (the user can set one in the
 *  model settings) instead of showing nothing. */
function lynshenDetail(ctx: number | undefined, total: number | undefined, unsetWindow: string, ofTotal?: (total: string) => string): string {
	const window = fmtContext(ctx);
	if (!window) return unsetWindow;
	return total && ctx && total > ctx && ofTotal ? `${window}${ofTotal(fmtContext(total))}` : window;
}

/**
 * A Claude Code / Codex model and where it runs: `local` is the engine's own
 * id for it (its catalog, on this machine's login or config), `lynshen` the
 * gateway's name. A model both offer is one entry (the engine's catalog
 * resolves aliases: "opus" is `claude-opus-5-5`).
 */
export interface ToolModel {
	key: string;
	label: string;
	vendor: string;
	context_window?: number;
	local?: string;
	lynshen?: string;
	active: boolean;
}

/** "claude-opus-4-8" → "Opus 4.8", as the daemon names Claude Code's models
 *  ("claude-haiku-4-5-20251001" → "Haiku 4.5": a date suffix is dropped). */
function claudeLabel(id: string): string {
	const [family = '', ...rest] = id.replace(/^claude-/, '').split('-');
	const version: string[] = [];
	for (const part of rest) {
		if (!/^\d+$/.test(part) || part.length === 8) break;
		version.push(part);
	}
	const name = family.charAt(0).toUpperCase() + family.slice(1);
	return version.length ? `${name} ${version.join('.')}` : name;
}

export function toolModels(
	models: EngineModel[],
	served: { name: string; display_name?: string | null; context_window?: number }[],
	onLynShen: boolean
): ToolModel[] {
	const keyOf = (m: EngineModel) => m.vendor || m.model;
	const running = models.find((m) => m.active);
	const byKey = new Map<string, ToolModel>();
	for (const m of models) {
		// A model the engine only marks as running runs here when the session
		// is on this machine; on the gateway it is the gateway's.
		if (m.listed === false && onLynShen) continue;
		const key = keyOf(m);
		if (byKey.has(key)) continue;
		byKey.set(key, {
			key,
			label: m.label || m.model,
			vendor: key,
			context_window: m.context_window,
			local: m.model,
			active: false
		});
	}
	for (const g of served) {
		const known = byKey.get(g.name);
		if (known) {
			known.lynshen = g.name;
			known.context_window ||= g.context_window;
			continue;
		}
		byKey.set(g.name, {
			key: g.name,
			label: g.display_name || (g.name.startsWith('claude-') ? claudeLabel(g.name) : g.name),
			vendor: g.name,
			context_window: g.context_window,
			lynshen: g.name,
			active: false
		});
	}
	const list = [...byKey.values()];
	if (running) {
		const key = keyOf(running);
		const known = byKey.get(key);
		if (known) known.active = true;
		else
			list.unshift({
				key,
				label: running.label || running.model,
				vendor: key,
				context_window: running.context_window,
				...(onLynShen ? { lynshen: running.model } : { local: running.model }),
				active: true
			});
	}
	return list;
}

/**
 * The active provider's rows come from the engine's model_view (already
 * filtered and flagged with the active model — the running engine resolved
 * its credentials, possibly from an env var); other providers come from the
 * client-side catalog, limited to the ones with credentials, so a lynshen
 * session can switch to any of them.
 * Same-provider picks use /model (instant); cross-provider picks switch via
 * @switch (config rewrite + engine restart). Claude Code / Codex list
 * toolModels: a model the current side lacks switches sides (@tool, an
 * engine restart).
 */
export function buildModelRows(input: {
	models: EngineModel[];
	backendId: string;
	provider: string;
	providersList: CatalogProvider[];
	/** Provider ids with credentials (read_auth_providers: a stored API key
	 *  under auth.json `providers`, or `lynshen` when logged in). Cross-provider
	 *  rows for any other provider are dropped — the engine can't run them. */
	configured: string[];
	groups: ModelGroupLabels;
	/** Claude/Codex: on this machine's config or the LynShen gateway. */
	toolMode?: 'system' | 'lynshen';
	/** Claude/Codex: what "this machine" is called beside a model. */
	localLabel?: string;
	/** Shown beside a LynShen model with no context window configured. */
	unsetWindow?: string;
	/** The session's model, marked active when the rows come from the catalog. */
	current?: string;
	/** The gateway Provider chosen per model (`monoize_providers`). */
	routes?: Record<string, string>;
}): ModelRow[] {
	const {
		models,
		backendId,
		provider: cur,
		providersList,
		configured,
		groups,
		toolMode,
		localLabel = '',
		unsetWindow = '',
		current = '',
		routes = {}
	} = input;
	if (backendId === 'claude' || backendId === 'codex') {
		const onLynShen = toolMode === 'lynshen';
		const served = configured.includes('lynshen')
			? (providersList.find((p) => p.id === 'lynshen')?.models ?? [])
			: [];
		return toolModels(models, served, onLynShen).map((m) => ({
			id: m.key,
			label: m.label,
			vendor: m.vendor,
			// The window first: a narrow menu truncates the detail from the end.
			detail: [fmtContext(m.context_window), m.local !== undefined && localLabel, m.lynshen !== undefined && 'LynShen']
				.filter(Boolean)
				.join(' · '),
			active: m.active,
			command: onLynShen
				? m.lynshen !== undefined
					? `/model ${m.lynshen}`
					: `@tool system ${m.local}`
				: m.local !== undefined
					? `/model ${m.local}`
					: `@tool lynshen ${m.lynshen}`,
			depth: undefined,
			model: m.key,
			provider: backendId,
			context: m.context_window,
			where: [m.local !== undefined && localLabel, m.lynshen !== undefined && 'LynShen'].filter(Boolean).join(' · '),
			onGateway: m.lynshen !== undefined
		}));
	}
	// One heading per provider: the LynShen gateway (monoize, or the old lynshen
	// login) under LynShen, every other provider under its own name.
	const isGateway = (id: string) => id === 'lynshen' || id === 'monoize';
	const groupOf = (id: string) =>
		isGateway(id) ? groups.lynshen : providersList.find((p) => p.id === id)?.name || id;
	const activeGroup = groupOf(cur);
	/** A gateway model (lynshen, monoize) names its route; others their provider. */
	const lineTwo = (provider: string, groupsOf: string[] | undefined, ctx: number | undefined, byok: boolean, total?: number) => {
		if (provider === 'lynshen' || provider === 'monoize')
			return [routeOf(provider, groupsOf, groups), lynshenDetail(ctx, total, unsetWindow, groups.ofTotal)]
				.filter(Boolean)
				.join(' · ');
		return detailOf(byok ? provider : null, ctx);
	};
	const activeCatalog = providersList.find((p) => p.id === cur)?.models ?? [];
	const routeLine = (route: ModelRoute) => routeLineOf(route, groups);
	// Before the engine reports its list (a draft, or a provider just switched
	// to) the provider's own catalog stands in, else the menu would be empty.
	const engineModels: EngineModel[] = models.length
		? models
		: activeCatalog.map((m) => ({
				model: m.name,
				label: m.display_name ?? undefined,
				active: m.name === current,
				context_window: m.context_window
			}));
	const activeRows: ModelRow[] = engineModels.flatMap((m) => {
		const entry = activeCatalog.find((row) => row.name === m.model);
		const row: ModelRow = {
			id: `${cur}::${m.model}`,
			label: stripGroupSuffix(entry?.display_name || m.label || m.model),
			vendor: m.vendor || m.model,
			detail: lineTwo(cur, entry?.groups, m.context_window, !isGateway(cur), entry?.context_total),
			active: m.active,
			command: `/model ${m.model}`,
			depth: undefined,
			group: activeGroup,
			model: m.model,
			provider: cur,
			context: m.context_window,
			efforts: m.reasoning_efforts?.length ? m.reasoning_efforts : entry?.reasoning_efforts,
			modalities: entry?.input_modalities
		};
		// A gateway model several Providers serve: one row, its route page lists them.
		const choices = entry?.routes ?? [];
		// One Provider: the same "私有 · 国模模型组" line, nothing to pin.
		if (choices.length === 1) return [{ ...row, detail: routeLine(choices[0]) }];
		if (choices.length < 2) return [cur === 'lynshen' && (entry?.groups?.length ?? 0) > 1 ? { ...row, groupsPage: true } : row];
		const chosen = choices.some((r) => r.id === routes[m.model]) ? routes[m.model] : choices[0].id;
		return [withChoices(row, choices, chosen, m.active)];
	});
	const otherRows: ModelRow[] = (backendId !== 'lynshen' ? [] : providersList)
		.filter((pv) => pv.id !== cur && configured.includes(pv.id))
		// The ChatGPT (Codex) sign-in belongs to Codex: LynShen's menu lists it
		// only while it is the session's own provider.
		.filter((pv) => !CODEX_LOGINS.has(pv.id))
		// The live gateway (monoize) makes the old lynshen login a second copy.
		.filter((pv) => !(pv.id === 'lynshen' && (cur === 'monoize' || configured.includes('monoize'))))
		.flatMap((pv) =>
			pv.models.flatMap((m) => {
				const row: ModelRow = {
					id: `${pv.id}::${m.name}`,
					label: stripGroupSuffix(m.display_name || m.name),
					vendor: m.name,
					detail: lineTwo(pv.id, m.groups, m.context_window, true, m.context_total),
					active: false,
					command: `@switch ${pv.id} ${m.name}`,
					depth: undefined,
					group: groupOf(pv.id),
					model: m.name,
					provider: pv.id,
					context: m.context_window,
					efforts: m.reasoning_efforts,
					modalities: m.input_modalities
				};
				const choices = m.routes ?? [];
				if (choices.length === 1) return [{ ...row, detail: routeLine(choices[0]) }];
				if (choices.length < 2) return [row];
				return [withChoices(row, choices, choices[0].id, false)];
			})
		);
	/** One row for a model several Providers serve; its line is the chosen one. */
	function withChoices(row: ModelRow, choices: ModelRoute[], chosen: string, active: boolean): ModelRow {
		const pick = choices.find((r) => r.id === chosen) ?? choices[0];
		const routeDetail = (route: ModelRoute) =>
			[
				route.account_class && groups.accountClass ? groups.accountClass(route.account_class) : '',
				route.group && groups.routeGroup ? groups.routeGroup(route.group) : ''
			]
				.filter(Boolean)
				.join(' · ');
		return {
			...row,
			detail: routeLine(pick),
			active,
			command: `${row.command} ${ROUTE_MARK}${pick.id}`,
			route: pick.id,
			choices: choices.map((route) => ({
				id: route.id,
				label: route.name,
				detail: routeDetail(route),
				active: active && route.id === pick.id,
				command: `${row.command} ${ROUTE_MARK}${route.id}`
			}))
		};
	}
	// LynShen first, then the session's provider, then the rest in list order.
	const order = [
		groups.lynshen,
		activeGroup,
		...providersList.filter((p) => !isGateway(p.id)).map((p) => p.name || p.id)
	];
	const rank = (row: ModelRow) => {
		const at = order.indexOf(row.group ?? '');
		return at < 0 ? order.length : at;
	};
	return [...activeRows, ...otherRows].sort((a, b) => rank(a) - rank(b));
}
