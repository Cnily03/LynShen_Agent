// Settings page structure: the nav's sections (in groups, shown as one flat
// list with a gap between groups), and the static search index of the rows
// each section renders (SettingsRow / SettingsSection `id`s). Keep ROWS in
// sync with the rows in SettingsPage and the section components.

import { SHORTCUT_IDS } from '$lib/shortcuts';

export type SectionKey =
	| 'general'
	| 'shortcuts'
	| 'account'
	| 'invite'
	| 'devices'
	| 'usage'
	| 'voice'
	| 'providers'
	| 'models'
	| 'network'
	| 'mcp'
	| 'market'
	| 'agents'
	| 'team'
	| 'acp'
	| 'import'
	| 'daemon'
	| 'updates';

export const GROUPS: { key: string; sections: SectionKey[] }[] = [
	{ key: 'app', sections: ['general', 'shortcuts', 'account', 'invite', 'devices', 'usage', 'voice'] },
	{ key: 'models', sections: ['providers', 'models', 'network'] },
	{ key: 'agents', sections: ['agents', 'team', 'acp', 'mcp', 'market', 'import'] },
	{ key: 'system', sections: ['daemon', 'updates'] }
];

const KEYS = new Set<string>(GROUPS.flatMap((g) => g.sections));

/** Section to open for a caller's request; legacy modal keys map onto the new pages. */
export function resolveSection(key: string | undefined): SectionKey {
	if (key === 'overview') return 'usage';
	if (key && KEYS.has(key)) return key as SectionKey;
	return 'general';
}

export interface SearchRow {
	section: SectionKey;
	id: string;
	titleKey: string;
	descKey?: string;
}

export const ROWS: SearchRow[] = [
	{ section: 'general', id: 'language', titleKey: 'settings.language' },
	{ section: 'general', id: 'theme', titleKey: 'settings.theme' },
	{ section: 'general', id: 'background', titleKey: 'settings.behavior.background' },
	{ section: 'general', id: 'vibrancy', titleKey: 'settings.behavior.vibrancy', descKey: 'settings.behavior.vibrancyHint' },
	{ section: 'general', id: 'glass', titleKey: 'settings.behavior.glass', descKey: 'settings.behavior.glassHint' },
	{ section: 'general', id: 'default-surface', titleKey: 'settings.behavior.defaultSurface', descKey: 'settings.behavior.defaultSurfaceHint' },
	{ section: 'general', id: 'open-elsewhere', titleKey: 'settings.behavior.openElsewhere', descKey: 'settings.behavior.openElsewhereHint' },
	{ section: 'general', id: 'terminal-font', titleKey: 'settings.behavior.terminalFont' },
	{ section: 'general', id: 'terminal-font-size', titleKey: 'settings.behavior.terminalFontSize' },
	{ section: 'general', id: 'turn-stats', titleKey: 'settings.behavior.turnStats', descKey: 'settings.behavior.turnStatsHint' },
	{ section: 'general', id: 'scroll-on-send', titleKey: 'settings.behavior.scrollOnSend', descKey: 'settings.behavior.scrollOnSendHint' },
	{ section: 'general', id: 'foot-context', titleKey: 'settings.behavior.footContext', descKey: 'settings.behavior.footContextHint' },
	{ section: 'general', id: 'foot-cost', titleKey: 'settings.behavior.footCost', descKey: 'settings.behavior.footCostHint' },
	{ section: 'general', id: 'thinking-summaries', titleKey: 'settings.behavior.thinkingSummaries', descKey: 'settings.behavior.thinkingSummariesHint' },
	{ section: 'general', id: 'cache-miss', titleKey: 'settings.behavior.cacheMissAlert', descKey: 'settings.behavior.cacheMissAlertHint' },
	{ section: 'general', id: 'html-open', titleKey: 'settings.behavior.htmlOpen' },
	{ section: 'general', id: 'autostart', titleKey: 'settings.autostart.title', descKey: 'settings.autostart.hint' },
	{ section: 'general', id: 'autostart-mode', titleKey: 'settings.autostart.mode', descKey: 'settings.autostart.modeHint' },
	{ section: 'general', id: 'feedback', titleKey: 'settings.help.feedback' },
	{ section: 'general', id: 'telemetry', titleKey: 'settings.help.telemetry', descKey: 'settings.help.telemetryHint' },
	{ section: 'shortcuts', id: 'shortcuts-reset', titleKey: 'settings.shortcuts.customize', descKey: 'settings.shortcuts.hint' },
	// One row per action (ShortcutsSection), titled as in the ⌘/ list.
	...SHORTCUT_IDS.map((id): SearchRow => ({ section: 'shortcuts', id: `shortcut-${id}`, titleKey: `shell.shortcuts.${id}` })),
	{ section: 'account', id: 'account-login', titleKey: 'settings.page.lynshenAccount' },
	{ section: 'account', id: 'account-balance', titleKey: 'settings.usage.balance' },
	{ section: 'account', id: 'account-models', titleKey: 'settings.monoize.square' },
	{ section: 'account', id: 'account-provider', titleKey: 'settings.page.apiKey', descKey: 'settings.monoize.managedKey' },
	{ section: 'invite', id: 'invite', titleKey: 'settings.section.invite', descKey: 'settings.accountPage.inviteSub' },
	{ section: 'devices', id: 'devices', titleKey: 'settings.section.devices', descKey: 'settings.accountPage.devicesSub' },
	{ section: 'usage', id: 'usage-daily', titleKey: 'settings.section.usage' },
	{ section: 'usage', id: 'usage-detail', titleKey: 'settings.overview.breakdownTitle' },
	{ section: 'voice', id: 'voice-provider', titleKey: 'settings.voice.provider' },
	{ section: 'voice', id: 'voice-base-url', titleKey: 'settings.voice.baseUrl' },
	{ section: 'voice', id: 'voice-model', titleKey: 'settings.voice.model' },
	{ section: 'voice', id: 'voice-key', titleKey: 'settings.page.voiceKey' },
	{ section: 'providers', id: 'default-provider', titleKey: 'settings.page.defaultProvider' },
	{ section: 'providers', id: 'provider-list', titleKey: 'settings.account.groupLabel' },
	{ section: 'providers', id: 'provider-add', titleKey: 'settings.custom.add' },
	{ section: 'models', id: 'default-model', titleKey: 'settings.behavior.defaultModel' },
	{ section: 'models', id: 'reasoning-effort', titleKey: 'settings.behavior.reasoningEffort', descKey: 'settings.page.reasoningEffortDesc' },
	{ section: 'models', id: 'project-instructions', titleKey: 'settings.behavior.includeProjectInstructions', descKey: 'settings.behavior.includeProjectInstructionsSub' },
	{ section: 'models', id: 'compact-model', titleKey: 'settings.behavior.compactModel' },
	{ section: 'models', id: 'compaction-threshold', titleKey: 'settings.behavior.compactionThreshold', descKey: 'settings.behavior.compactionThresholdSub' },
	{ section: 'models', id: 'title-model', titleKey: 'settings.behavior.titleModel', descKey: 'settings.behavior.titleModelHint' },
	{ section: 'models', id: 'image-model', titleKey: 'settings.behavior.imageModel', descKey: 'settings.behavior.imageModelHint' },
	{ section: 'network', id: 'retry-attempts', titleKey: 'settings.behavior.retryAttempts' },
	{ section: 'network', id: 'connect-timeout', titleKey: 'settings.behavior.connectTimeout' },
	{ section: 'network', id: 'read-timeout', titleKey: 'settings.behavior.readTimeout' },
	{ section: 'mcp', id: 'mcp-servers', titleKey: 'settings.mcp.groupLabel' },
	{ section: 'mcp', id: 'mcp-extensions', titleKey: 'settings.ext.groupLabel' },
	{ section: 'market', id: 'market-open', titleKey: 'settings.market.groupLabel' },
	{ section: 'agents', id: 'default-backend', titleKey: 'settings.backend.defaultLabel' },
	{ section: 'agents', id: 'shell-env', titleKey: 'settings.backend.shellEnvLabel', descKey: 'settings.backend.shellEnvHint' },
	{ section: 'agents', id: 'backend-list', titleKey: 'settings.section.agents' },
	{ section: 'agents', id: 'dependencies', titleKey: 'setup.deps.title' },
	{ section: 'team', id: 'team-v2', titleKey: 'settings.team.v2', descKey: 'settings.team.v2Hint' },
	{ section: 'team', id: 'team-fanout', titleKey: 'settings.team.fanout', descKey: 'settings.team.fanoutHint.plan' },
	{ section: 'team', id: 'team-messages', titleKey: 'settings.team.messages', descKey: 'settings.team.messagesHint.on' },
	{ section: 'team', id: 'team-wake', titleKey: 'settings.team.wakeOnResult', descKey: 'settings.team.wakeOnResultHint' },
	{ section: 'team', id: 'team-review', titleKey: 'settings.team.reviewOnComplete', descKey: 'settings.team.reviewOnCompleteHint' },
	{ section: 'team', id: 'team-max-live', titleKey: 'settings.team.maxLive', descKey: 'settings.team.maxLiveHint' },
	{ section: 'team', id: 'team-max-depth', titleKey: 'settings.team.maxDepth', descKey: 'settings.team.maxDepthHint' },
	{ section: 'team', id: 'team-budget', titleKey: 'settings.team.budget', descKey: 'settings.team.budgetHint' },
	{ section: 'team', id: 'team-keep-worktrees', titleKey: 'settings.team.keepDays', descKey: 'settings.team.keepDaysHint' },
	{ section: 'team', id: 'team-roles', titleKey: 'settings.team.roles', descKey: 'settings.team.rolesHint' },
	{ section: 'team', id: 'team-hooks', titleKey: 'settings.team.hooks', descKey: 'settings.team.hooksHint' },
	{ section: 'team', id: 'team-hook-task_completed', titleKey: 'settings.team.hook.task_completed', descKey: 'settings.team.hookHint.task_completed' },
	{ section: 'team', id: 'team-hook-agent_idle', titleKey: 'settings.team.hook.agent_idle', descKey: 'settings.team.hookHint.agent_idle' },
	{ section: 'acp', id: 'acp-agents', titleKey: 'settings.section.acp' },
	{ section: 'import', id: 'import-scan', titleKey: 'settings.import.title', descKey: 'settings.import.intro' },
	{ section: 'daemon', id: 'relay', titleKey: 'settings.backend.relayToggle', descKey: 'settings.backend.relayHint' },
	{ section: 'daemon', id: 'devices', titleKey: 'settings.backend.devices' },
	{ section: 'updates', id: 'app-version', titleKey: 'settings.update.currentVersion' },
	{ section: 'updates', id: 'licenses', titleKey: 'settings.licenses.title' }
];

/** Rows whose title or description contains the query (case-insensitive). */
export function searchRows(query: string, tr: (key: string) => string): SearchRow[] {
	const q = query.trim().toLowerCase();
	if (!q) return [];
	return ROWS.filter((r) => `${tr(r.titleKey)}\n${r.descKey ? tr(r.descKey) : ''}`.toLowerCase().includes(q));
}
