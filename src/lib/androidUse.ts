// Settings → MCP 与扩展 → 安卓手机（Android-Use）: what the daemon's
// `android_use_*` ops answer (LynShen-CLI crates/agent-core/src/android.rs)
// and what the row shows from it. The engine pins the android-use release,
// checks its SHA-256 and keeps it in ~/.lynshen/tools/android-use; the page
// never downloads anything itself.

import { t } from '$lib/i18n';

export type AndroidDeviceState = 'device' | 'unauthorized' | 'offline' | string;

export interface AndroidDevice {
	serial: string;
	state: AndroidDeviceState;
	model: string;
}

export interface AndroidUseStatus {
	enabled: boolean;
	version: string;
	installed: boolean;
	/** This computer's release archive; null where android-use has no build. */
	asset: string | null;
	/** adb's path, or null when it was not found. */
	adb: string | null;
	devices: AndroidDevice[];
	/** au's phase (`ready`, `approve_usb`, `enable_accessibility`, …). */
	phase: string;
	ready: boolean;
	/** The next step for the user, in Chinese. */
	hint: string;
	wirelessHint: string;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** The status of an `android_use_*` reply, with anything malformed dropped. */
export function parseAndroidUse(reply: Record<string, unknown>): AndroidUseStatus {
	const devices = Array.isArray(reply.devices) ? reply.devices : [];
	return {
		enabled: reply.enabled === true,
		version: str(reply.version),
		installed: reply.installed === true,
		asset: str(reply.asset) || null,
		adb: str(reply.adb) || null,
		devices: devices
			.filter((d): d is Record<string, unknown> => !!d && typeof d === 'object' && typeof d.serial === 'string')
			.map((d) => ({ serial: str(d.serial), state: str(d.state), model: str(d.model) })),
		phase: str(reply.phase),
		ready: reply.ready === true,
		hint: str(reply.hint),
		wirelessHint: str(reply.wireless_hint)
	};
}

/** A daemon too old for these ops (before CLI 0.7.9). */
export function isOldDaemonForAndroid(error: string): boolean {
	return /android_use_\w+ requires session|unknown op android_use_/.test(error);
}

/** One device as the row lists it: `Pixel 9 · 已连接`. */
export function deviceLabel(device: AndroidDevice): string {
	const known = ['device', 'unauthorized', 'offline'];
	const state = known.includes(device.state) ? t(`settings.androidUse.state.${device.state}`) : device.state;
	return `${device.model || device.serial} · ${state}`;
}

/** The status line under the row's title. */
export function statusLine(s: AndroidUseStatus): string {
	if (!s.asset) return t('settings.androidUse.noBuild');
	if (!s.installed) return t('settings.androidUse.notInstalled', { version: s.version });
	const parts = [`android-use ${s.version}`, t(s.enabled ? 'settings.androidUse.on' : 'settings.androidUse.off')];
	if (!s.adb) parts.push(t('settings.androidUse.noAdb'));
	else if (!s.devices.length) parts.push(t('settings.androidUse.noDevice'));
	else parts.push(s.devices.map(deviceLabel).join(', '));
	return parts.join(' · ');
}

/** Whether 连接手机 (au setup) can do something now: one phone that allows
 *  USB debugging, and the helper or its accessibility switch still missing. */
export function canSetUp(s: AndroidUseStatus): boolean {
	return s.installed && s.devices.filter((d) => d.state === 'device').length === 1 && !s.ready;
}
