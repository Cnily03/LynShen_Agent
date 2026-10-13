// The signed-in LynShen account's avatar, wherever the app shows the account
// (the sidebar's account row and rail, the account card, Settings → 账户).
// The picture the app kept (account_avatar.rs) shows at once, also offline;
// then each fresh session user (`avatar_url` of /api/desktop/oauth/me, read
// at start, on sign-in, when the card or the account page opens) brings it
// to the avatar the website has. A change here is uploaded with the device key
// and becomes the website's avatar too (gateway DA-12).
import { t } from '$lib/i18n';
import { GatewayError, monoizeAvatarCached, monoizeAvatarSync, monoizeAvatarUpload, type MonoizeUser } from '$lib/protocol';
import { AVATAR_SIDE, AVATAR_UPLOAD_MAX_BYTES, avatarErrorKey, avatarFileProblem, centeredSquare, retryMinutes } from './accountAvatar';

/** AV-63: the picked image cut to its centred square and drawn at 256 × 256 as
 *  WebP. A WebView that cannot encode WebP (WebKit) gives PNG, which the gateway
 *  takes as well. */
export async function prepareAvatar(file: Blob): Promise<Blob> {
	const bitmap = await createImageBitmap(file);
	try {
		const { x, y, side } = centeredSquare(bitmap.width, bitmap.height);
		const canvas = document.createElement('canvas');
		canvas.width = AVATAR_SIDE;
		canvas.height = AVATAR_SIDE;
		const context = canvas.getContext('2d');
		if (!context) throw new Error('canvas unavailable');
		context.imageSmoothingQuality = 'high';
		context.drawImage(bitmap, x, y, side, side, 0, 0, AVATAR_SIDE, AVATAR_SIDE);
		const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.9));
		if (!blob) throw new Error('avatar encoding failed');
		return blob;
	} finally {
		bitmap.close();
	}
}

async function base64Of(blob: Blob): Promise<string> {
	const bytes = new Uint8Array(await blob.arrayBuffer());
	let binary = '';
	for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(binary);
}

/** What a failed change says: the app's own check, or the gateway's reason. */
function refusalText(error: unknown): string {
	if (!(error instanceof GatewayError)) return String(error instanceof Error ? error.message : error);
	const key = avatarErrorKey(error.code);
	if (key === 'settings.avatar.rateLimited') return t(key, { minutes: retryMinutes(error.param) });
	if (key) return t(key);
	// A gateway without DA-12 has no such route.
	if (error.status === 404 || error.status === 405) return t('settings.avatar.unavailable');
	if (error.status == null) return t('settings.avatar.offline');
	return error.message;
}

class AccountAvatar {
	/** The account's picture (a data URL); null shows the name's initial. */
	src = $state<string | null>(null);
	/** A change is being uploaded. */
	busy = $state(false);
	/** The gateway address `src` is the picture of; undefined before any is known. */
	#url: string | null | undefined = undefined;
	/** Bumped by every newer answer, so an older one never overwrites it. */
	#generation = 0;

	/** The kept picture, before the gateway answers (start, offline). */
	async restore(): Promise<void> {
		const generation = this.#generation;
		const cached = await monoizeAvatarCached().catch(() => null);
		if (!cached || generation !== this.#generation) return;
		this.src = cached.data_url;
		this.#url = cached.url;
	}

	/** Follows the avatar a fresh session user names. A user without
	 *  `avatar_url` (an older gateway, the sign-in answer) changes nothing. */
	async sync(user: MonoizeUser | null | undefined): Promise<void> {
		const url = user?.avatar_url;
		if (url === undefined || url === this.#url) return;
		const generation = ++this.#generation;
		try {
			const src = await monoizeAvatarSync(url);
			if (generation !== this.#generation) return;
			this.src = src;
			this.#url = url;
		} catch {
			// Offline or refused: what shows stays, and the next session read tries again.
		}
	}

	/** Signed out: the initial again (the app deletes the kept picture). */
	clear(): void {
		this.#generation++;
		this.src = null;
		this.#url = undefined;
	}

	/** Makes `file` the account's avatar: checked and cut as the website does,
	 *  shown at once, uploaded; the previous picture comes back on a failure.
	 *  Answers what went wrong, or '' when it is done. */
	async change(file: File, prepare: (file: Blob) => Promise<Blob> = prepareAvatar): Promise<string> {
		const problem = avatarFileProblem(file);
		if (problem) return t(avatarErrorKey(problem)!);
		this.busy = true;
		try {
			let blob: Blob;
			try {
				blob = await prepare(file);
			} catch {
				return t('settings.avatar.readFailed');
			}
			if (blob.size > AVATAR_UPLOAD_MAX_BYTES) return t('settings.avatar.tooLarge');
			const image = await base64Of(blob);
			const before = { src: this.src, url: this.#url };
			const generation = ++this.#generation;
			this.src = `data:${blob.type || 'image/png'};base64,${image}`;
			try {
				const result = await monoizeAvatarUpload(image);
				if (generation === this.#generation) {
					this.src = result.data_url;
					this.#url = result.user?.avatar_url ?? null;
				}
				return '';
			} catch (error) {
				if (generation === this.#generation) {
					this.src = before.src;
					this.#url = before.url;
				}
				return refusalText(error);
			}
		} finally {
			this.busy = false;
		}
	}
}

export const accountAvatar = new AccountAvatar();
