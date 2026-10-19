// 反馈问题 on the phone page (ticket #45): the page has no LynShen key of its
// own, so the report goes through the computer it shows, which sends it
// with its sign-in and attaches its own logs (the daemon's `feedback_send`,
// LynShen CLI 0.7.8).
import type { FeedbackRemote } from '$lib/FeedbackDialog.svelte';
import type { DaemonClient } from '$lib/daemon';
import { t } from '$lib/i18n';

/** This browser's platform for the ticket: iPadOS Safari says Macintosh,
 *  a touch screen tells them apart. */
export function webPlatform(ua: string, touchPoints: number): string {
	const os = /iPad/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1)
		? 'iPadOS'
		: /iPhone/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Web';
	const browser = /EdgiOS|Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome/.test(ua) ? 'Chrome' : /FxiOS|Firefox/.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : 'Browser';
	return `${os} · ${browser}`;
}

/** What a failed send says: an engine before `feedback_send` answers that
 *  the op needs a session. */
export function feedbackError(message: string): string {
	if (/feedback_send requires session|unknown op/i.test(message)) return t('shell.feedback.needNewerEngine');
	if (/not signed in|401/i.test(message)) return t('shell.feedback.needLogin');
	if (/timed out|closed|not connected|unreachable/i.test(message)) return t('shell.feedback.needComputer');
	return message;
}

export function feedbackRemote(daemon: DaemonClient, computer: string): FeedbackRemote {
	return {
		computer,
		client: { version: 'web', os: webPlatform(navigator.userAgent, navigator.maxTouchPoints ?? 0) },
		async send(ticket) {
			try {
				return await daemon.request({ op: 'feedback_send', ...ticket });
			} catch (e) {
				throw new Error(feedbackError(e instanceof Error ? e.message : String(e)));
			}
		}
	};
}
