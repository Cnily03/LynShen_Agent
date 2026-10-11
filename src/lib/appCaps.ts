// What this build offers besides the desktop app and the remote page, in the
// way backends/caps.ts says what each backend can do.

export interface AppCaps {
	/** The web chat (src/lib/web, the (web) routes and /auth/callback). It
	 *  needs an account service with an OAuth web client and conversations
	 *  stored on the account, which LynShen's gateway does not have: off, its
	 *  routes go to /remote and nothing links to it. */
	webChat: boolean;
}

export const APP_CAPS: AppCaps = {
	webChat: false
};
