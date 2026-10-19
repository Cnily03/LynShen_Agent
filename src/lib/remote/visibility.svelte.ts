// Whether the remote page is on screen (not a locked phone, not another app
// in front), as a reactive value.

export const pageVisible = $state({ visible: typeof document === 'undefined' || document.visibilityState !== 'hidden' });

if (typeof document !== 'undefined') {
	document.addEventListener('visibilitychange', () => {
		pageVisible.visible = document.visibilityState !== 'hidden';
	});
}
