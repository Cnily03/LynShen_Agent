import { beforeAll, describe, expect, it } from 'vitest';
import { setLocale } from '$lib/i18n';
import { canSetUp, deviceLabel, isOldDaemonForAndroid, parseAndroidUse, statusLine } from './androidUse';

const reply = {
	type: 'android_use',
	enabled: true,
	version: '1.2.0',
	installed: true,
	asset: 'android-use-v1.2.0-macos-aarch64.tar.gz',
	adb: '/Users/me/Library/Android/sdk/platform-tools/adb',
	devices: [{ serial: 'emulator-5554', state: 'device', model: 'sdk gphone64 arm64' }, { bad: 1 }],
	phase: 'ready',
	ready: true,
	hint: '已就绪',
	wireless_hint: 'adb pair'
};

describe('android-use settings row', () => {
	beforeAll(() => setLocale('zh'));

	it('parses the daemon reply and drops malformed devices', () => {
		const s = parseAndroidUse(reply);
		expect(s.devices).toEqual([{ serial: 'emulator-5554', state: 'device', model: 'sdk gphone64 arm64' }]);
		expect(s.wirelessHint).toBe('adb pair');
		expect(parseAndroidUse({}).installed).toBe(false);
		expect(parseAndroidUse({}).asset).toBeNull();
	});

	it('says what is missing in the status line', () => {
		expect(statusLine(parseAndroidUse(reply))).toBe('android-use 1.2.0 · 已开启 · sdk gphone64 arm64 · 已连接');
		expect(statusLine(parseAndroidUse({ ...reply, installed: false }))).toBe('未安装 · android-use 1.2.0');
		expect(statusLine(parseAndroidUse({ ...reply, enabled: false, adb: null }))).toBe('android-use 1.2.0 · 已关闭 · 未找到 adb');
		expect(statusLine(parseAndroidUse({ ...reply, devices: [] }))).toContain('没有连接手机');
		expect(statusLine(parseAndroidUse({ ...reply, asset: '' }))).toContain('没有 android-use 的版本');
		expect(deviceLabel({ serial: 'R58N', state: 'unauthorized', model: '' })).toBe('R58N · 等待手机上允许 USB 调试');
	});

	it('offers 连接手机 only with one authorized phone that is not ready', () => {
		const s = parseAndroidUse({ ...reply, ready: false, phase: 'enable_accessibility' });
		expect(canSetUp(s)).toBe(true);
		expect(canSetUp(parseAndroidUse(reply))).toBe(false);
		expect(canSetUp({ ...s, devices: [...s.devices, { serial: 'b', state: 'device', model: '' }] })).toBe(false);
		expect(canSetUp({ ...s, installed: false })).toBe(false);
	});

	it('recognizes a daemon that predates the ops', () => {
		expect(isOldDaemonForAndroid('unknown op android_use_status')).toBe(true);
		expect(isOldDaemonForAndroid('android_use_status requires session')).toBe(true);
		expect(isOldDaemonForAndroid('adb was not found')).toBe(false);
	});
});
