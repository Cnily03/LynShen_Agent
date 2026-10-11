// The web chat's sign-in callback, off with the web chat (APP_CAPS.webChat).
import { redirect } from '@sveltejs/kit';
import { APP_CAPS } from '$lib/appCaps';

export function load() {
	if (!APP_CAPS.webChat) redirect(307, '/remote');
}
