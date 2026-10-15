// Choosing a model from any picker: a model that does not work now asks
// first (it stays selectable), and the pick joins the recents.

import { t } from '$lib/i18n';
import { confirm } from '$lib/ui/confirm.svelte';
import type { PickItem } from './catalog';
import { modelPicks } from './picks.svelte';

/** Whether to go ahead with `item`: asks when the gateway reports it unavailable. */
export async function confirmPick(item: PickItem): Promise<boolean> {
	if (item.health !== 'down') return true;
	return confirm({
		title: t('models.downTitle'),
		message: t('models.downBody', { name: item.name }),
		confirmLabel: t('models.downConfirm')
	});
}

/** Confirms `item` when it needs it, records it as used, then runs `apply`. */
export async function pick(item: PickItem, apply: (item: PickItem) => void): Promise<boolean> {
	if (!(await confirmPick(item))) return false;
	modelPicks.used(item.key);
	apply(item);
	return true;
}
