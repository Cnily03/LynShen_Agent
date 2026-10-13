// The account avatar's rules, as the LynShen Console applies them
// (gateway user-avatars.spec.md AV-63, AV-66): which files the picker takes,
// the square the picture is cut to, and how a refusal reads.

/** AV-62: the types the picker offers and the app accepts. */
export const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const AVATAR_ACCEPT = AVATAR_TYPES.join(',');
/** AV-63: a picked file larger than this is refused before it is decoded. */
export const AVATAR_PICK_MAX_BYTES = 20 * 1024 * 1024;
/** AV-11: the largest processed file the gateway accepts. */
export const AVATAR_UPLOAD_MAX_BYTES = 1024 * 1024;
/** AV-14: the side of the stored picture, and of the one the app draws. */
export const AVATAR_SIDE = 256;

/** AV-63: why a picked file cannot be used, before it is decoded; null when it can. */
export function avatarFileProblem(file: { type: string; size: number }): 'unsupported' | 'tooLarge' | null {
	if (!(AVATAR_TYPES as readonly string[]).includes(file.type)) return 'unsupported';
	if (file.size > AVATAR_PICK_MAX_BYTES) return 'tooLarge';
	return null;
}

/** AV-14: the largest centred square of a `width` × `height` image. */
export function centeredSquare(width: number, height: number): { x: number; y: number; side: number } {
	const side = Math.min(width, height);
	return { x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), side };
}

/** AV-66: the seconds of `avatar_rate_limited` as whole minutes, rounded up, at least 1. */
export function retryMinutes(seconds: string | number | null | undefined): number {
	const value = Number(seconds);
	if (!Number.isFinite(value) || value <= 0) return 1;
	return Math.max(1, Math.ceil(value / 60));
}

/** The message key (under `settings.avatar`) for a refusal: the app's own checks
 *  (`unsupported`, `tooLarge`, `readFailed`) or the gateway's error code. */
export function avatarErrorKey(code: string | null | undefined): string | null {
	switch (code) {
		case 'unsupported':
		case 'avatar_unsupported_type':
			return 'settings.avatar.unsupported';
		case 'tooLarge':
			return 'settings.avatar.pickTooLarge';
		case 'readFailed':
		case 'avatar_invalid_image':
			return 'settings.avatar.readFailed';
		case 'avatar_too_large':
			return 'settings.avatar.tooLarge';
		case 'avatar_rate_limited':
			return 'settings.avatar.rateLimited';
		case 'not_signed_in':
		case 'invalid_token':
			return 'settings.avatar.signIn';
		default:
			return null;
	}
}
