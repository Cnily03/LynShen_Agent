import { describe, expect, it } from 'vitest';
import { feedbackError, webPlatform } from './feedback';
import { setLocale } from '$lib/i18n';

describe('反馈问题 on the phone page (ticket #45)', () => {
	it('names the platform, an iPad apart from a Mac', () => {
		const ipad = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
		expect(webPlatform(ipad, 5)).toBe('iPadOS · Safari');
		expect(webPlatform(ipad, 0)).toBe('macOS · Safari');
		expect(webPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/130.0 Mobile Safari/604.1', 5)).toBe('iOS · Chrome');
		expect(webPlatform('Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36', 5)).toBe('Android · Chrome');
	});

	it('says what to do when the computer cannot send it', () => {
		setLocale('zh');
		expect(feedbackError('feedback_send requires session')).toMatch(/版本较旧/);
		expect(feedbackError("this computer's Aogiri is not signed in to LynShen")).toBe('请先登录 LynShen 账户再提交。');
		expect(feedbackError('the gateway said no')).toBe('the gateway said no');
	});
});
