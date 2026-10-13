import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from './i18n';
import { AVATAR_PICK_MAX_BYTES, avatarErrorKey, avatarFileProblem, centeredSquare, retryMinutes } from './accountAvatar';

const calls = vi.hoisted(() => ({
	cached: vi.fn(),
	sync: vi.fn(),
	upload: vi.fn()
}));
vi.mock('$lib/protocol', async () => {
	const actual = await vi.importActual<typeof import('$lib/protocol')>('$lib/protocol');
	return {
		GatewayError: actual.GatewayError,
		monoizeAvatarCached: calls.cached,
		monoizeAvatarSync: calls.sync,
		monoizeAvatarUpload: calls.upload
	};
});
const { accountAvatar } = await import('./accountAvatar.svelte');
const { GatewayError } = await import('./protocol');

setLocale('zh');

const URL1 = '/api/desktop/oauth/avatars/a1';
const URL2 = '/api/desktop/oauth/avatars/a2';
const user = (avatar_url?: string | null) => ({ id: 'u1', username: 'lin', role: 'user', avatar_url });
const png = (size = 8) => new File([new Uint8Array(size)], 'me.png', { type: 'image/png' });
const webp = (bytes = 4) => async () => new Blob([new Uint8Array(bytes).fill(7)], { type: 'image/webp' });

describe('avatar rules (as the website applies them)', () => {
	it('takes PNG, JPEG and WebP up to 20 MB', () => {
		expect(avatarFileProblem({ type: 'image/png', size: 10 })).toBeNull();
		expect(avatarFileProblem({ type: 'image/jpeg', size: AVATAR_PICK_MAX_BYTES })).toBeNull();
		expect(avatarFileProblem({ type: 'image/webp', size: 1 })).toBeNull();
		expect(avatarFileProblem({ type: 'image/gif', size: 1 })).toBe('unsupported');
		expect(avatarFileProblem({ type: 'image/svg+xml', size: 1 })).toBe('unsupported');
		expect(avatarFileProblem({ type: 'image/png', size: AVATAR_PICK_MAX_BYTES + 1 })).toBe('tooLarge');
	});

	it('cuts the largest centred square', () => {
		expect(centeredSquare(300, 200)).toEqual({ x: 50, y: 0, side: 200 });
		expect(centeredSquare(201, 400)).toEqual({ x: 0, y: 99, side: 201 });
		expect(centeredSquare(64, 64)).toEqual({ x: 0, y: 0, side: 64 });
	});

	it('gives the rate limit in whole minutes, rounded up', () => {
		expect(retryMinutes('61')).toBe(2);
		expect(retryMinutes('3600')).toBe(60);
		expect(retryMinutes(null)).toBe(1);
		expect(retryMinutes('0')).toBe(1);
	});

	it('has a sentence for every refusal of the gateway', () => {
		for (const code of ['avatar_unsupported_type', 'avatar_invalid_image', 'avatar_too_large', 'avatar_rate_limited', 'not_signed_in'])
			expect(avatarErrorKey(code)).toMatch(/^settings\.avatar\./);
		expect(avatarErrorKey('something_else')).toBeNull();
	});
});

describe('accountAvatar', () => {
	beforeEach(() => {
		accountAvatar.clear();
		calls.cached.mockReset();
		calls.sync.mockReset();
		calls.upload.mockReset();
	});

	it('shows the kept picture, then follows the avatar the session user names', async () => {
		calls.cached.mockResolvedValue({ url: URL1, data_url: 'data:image/webp;base64,AAA' });
		await accountAvatar.restore();
		expect(accountAvatar.src).toBe('data:image/webp;base64,AAA');
		// The same avatar: nothing to fetch.
		await accountAvatar.sync(user(URL1));
		expect(calls.sync).not.toHaveBeenCalled();
		// Changed on the website.
		calls.sync.mockResolvedValue('data:image/webp;base64,BBB');
		await accountAvatar.sync(user(URL2));
		expect(calls.sync).toHaveBeenCalledWith(URL2);
		expect(accountAvatar.src).toBe('data:image/webp;base64,BBB');
		// Removed on the website.
		calls.sync.mockResolvedValue(null);
		await accountAvatar.sync(user(null));
		expect(calls.sync).toHaveBeenLastCalledWith(null);
		expect(accountAvatar.src).toBeNull();
	});

	it('keeps what it shows for a user without avatar_url and when offline', async () => {
		calls.cached.mockResolvedValue({ url: URL1, data_url: 'data:image/webp;base64,AAA' });
		await accountAvatar.restore();
		await accountAvatar.sync(user(undefined));
		expect(calls.sync).not.toHaveBeenCalled();
		calls.sync.mockRejectedValue(new GatewayError('all gateways unreachable', null, null));
		await accountAvatar.sync(user(URL2));
		expect(accountAvatar.src).toBe('data:image/webp;base64,AAA');
	});

	it('lets a newer answer win over the kept picture', async () => {
		let resolveCache: (v: unknown) => void = () => {};
		calls.cached.mockReturnValue(new Promise((r) => (resolveCache = r)));
		calls.sync.mockResolvedValue('data:image/webp;base64,NEW');
		const restoring = accountAvatar.restore();
		await accountAvatar.sync(user(URL2));
		resolveCache({ url: URL1, data_url: 'data:image/webp;base64,OLD' });
		await restoring;
		expect(accountAvatar.src).toBe('data:image/webp;base64,NEW');
	});

	it('forgets the picture on sign-out', async () => {
		calls.cached.mockResolvedValue({ url: URL1, data_url: 'data:image/webp;base64,AAA' });
		await accountAvatar.restore();
		accountAvatar.clear();
		expect(accountAvatar.src).toBeNull();
	});

	it('uploads the processed picture and shows the gateway’s', async () => {
		calls.upload.mockResolvedValue({ user: user(URL2), data_url: 'data:image/webp;base64,SERVER' });
		const done = accountAvatar.change(png(), webp(3));
		expect(accountAvatar.busy).toBe(true);
		expect(await done).toBe('');
		expect(calls.upload).toHaveBeenCalledWith(btoa('\x07\x07\x07'));
		expect(accountAvatar.src).toBe('data:image/webp;base64,SERVER');
		expect(accountAvatar.busy).toBe(false);
		// The next session read names the same avatar: nothing to fetch.
		await accountAvatar.sync(user(URL2));
		expect(calls.sync).not.toHaveBeenCalled();
	});

	it('refuses files the website refuses, without a request', async () => {
		expect(await accountAvatar.change(new File(['GIF89a'], 'a.gif', { type: 'image/gif' }))).toBe('请选择 PNG、JPEG 或 WebP 图片。');
		expect(await accountAvatar.change(png(), webp(1024 * 1024 + 1))).toBe('图片处理后仍超过 1 MB，请选择更小的图片。');
		expect(
			await accountAvatar.change(png(), async () => {
				throw new Error('decode');
			})
		).toBe('无法读取这张图片，请换一张。');
		expect(calls.upload).not.toHaveBeenCalled();
	});

	it('puts the previous picture back when the gateway refuses', async () => {
		calls.cached.mockResolvedValue({ url: URL1, data_url: 'data:image/webp;base64,AAA' });
		await accountAvatar.restore();
		calls.upload.mockRejectedValue(new GatewayError('too often', 'avatar_rate_limited', 429, '61'));
		expect(await accountAvatar.change(png(), webp())).toBe('头像更换太频繁，请 2 分钟后再试。');
		expect(accountAvatar.src).toBe('data:image/webp;base64,AAA');
		calls.upload.mockRejectedValue(new GatewayError('gateway error 404', null, 404));
		expect(await accountAvatar.change(png(), webp())).toMatch(/暂不支持在应用里更换头像/);
		calls.upload.mockRejectedValue(new GatewayError('all gateways unreachable', null, null));
		expect(await accountAvatar.change(png(), webp())).toMatch(/连不上 LynShen 服务/);
		expect(accountAvatar.src).toBe('data:image/webp;base64,AAA');
	});
});
