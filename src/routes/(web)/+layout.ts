// The web chat is off in this build (APP_CAPS.webChat): its pages go to the
// remote page.
import { redirect } from '@sveltejs/kit';
import { APP_CAPS } from '$lib/appCaps';

export function load() {
	if (!APP_CAPS.webChat) redirect(307, '/remote');
}
