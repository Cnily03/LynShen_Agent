// Aggregated message catalog. Each area module (common, chat, settings, …) owns
// its own file so string migration can happen area-by-area without edit
// conflicts; this index merges them under a namespace key. New keys go in the
// area files, not here.

import common from './common';
import chat from './chat';
import settings from './settings';
import setup from './setup';
import dock from './dock';
import shell from './shell';
import editor from './editor';
import web from './web';
import preview from './preview';
import models from './models';

export type Locale = 'zh' | 'en';

export const catalog = {
	zh: {
		common: common.zh,
		chat: chat.zh,
		settings: settings.zh,
		setup: setup.zh,
		dock: dock.zh,
		shell: shell.zh,
		editor: editor.zh,
		web: web.zh,
		preview: preview.zh,
		models: models.zh
	},
	en: {
		common: common.en,
		chat: chat.en,
		settings: settings.en,
		setup: setup.en,
		dock: dock.en,
		shell: shell.en,
		editor: editor.en,
		web: web.en,
		preview: preview.en,
		models: models.en
	}
} as const;
