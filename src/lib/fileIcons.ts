// The icon of a file by its kind (attachments.ts `fileKind`): the chips of a
// sent message's files (SentFiles.svelte) and the tab that previews one
// (preview/FilePreview.svelte).
import FileIcon from 'phosphor-svelte/lib/FileIcon';
import FileTextIcon from 'phosphor-svelte/lib/FileTextIcon';
import FileCodeIcon from 'phosphor-svelte/lib/FileCodeIcon';
import FilePdfIcon from 'phosphor-svelte/lib/FilePdfIcon';
import FileImageIcon from 'phosphor-svelte/lib/FileImageIcon';
import FileXlsIcon from 'phosphor-svelte/lib/FileXlsIcon';
import FileDocIcon from 'phosphor-svelte/lib/FileDocIcon';
import FilePptIcon from 'phosphor-svelte/lib/FilePptIcon';
import FileZipIcon from 'phosphor-svelte/lib/FileZipIcon';
import FileAudioIcon from 'phosphor-svelte/lib/FileAudioIcon';
import FileVideoIcon from 'phosphor-svelte/lib/FileVideoIcon';
import FolderIcon from 'phosphor-svelte/lib/FolderIcon';
import type { FileKind } from './attachments';

export const FILE_ICONS: Record<FileKind, typeof FileIcon> = {
	folder: FolderIcon,
	code: FileCodeIcon,
	text: FileTextIcon,
	pdf: FilePdfIcon,
	image: FileImageIcon,
	table: FileXlsIcon,
	doc: FileDocIcon,
	slides: FilePptIcon,
	archive: FileZipIcon,
	audio: FileAudioIcon,
	video: FileVideoIcon,
	file: FileIcon
};
