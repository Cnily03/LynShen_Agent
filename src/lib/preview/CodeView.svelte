<script lang="ts">
	// A text file in a read-only code view: the editor's CodeMirror with its
	// theme and languages (src/lib/editor), line numbers, folding and search
	// (⌘F / Ctrl+F), no editing. CodeMirror draws only the lines in view and
	// parses in the background, so a file of megabytes does not hold the
	// window up (long lines are cut before they get here: kinds.ts).
	import { onDestroy, untrack } from 'svelte';
	import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, drawSelection } from '@codemirror/view';
	import { EditorState, Compartment } from '@codemirror/state';
	import { foldGutter, foldKeymap } from '@codemirror/language';
	import { defaultKeymap } from '@codemirror/commands';
	import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
	import { themeState } from '$lib/theme.svelte';
	import { languageFor } from '$lib/editor/language';
	import { editorTheme } from '$lib/editor/cmTheme';

	/** `name` picks the language (`x.json` for formatted JSON). */
	let { text, name }: { text: string; name: string } = $props();

	let host = $state<HTMLElement | null>(null);
	let view: EditorView | null = null;
	const lang = new Compartment();
	const theme = new Compartment();

	function stateOf(doc: string) {
		return EditorState.create({
			doc,
			extensions: [
				lineNumbers(),
				foldGutter(),
				highlightActiveLineGutter(),
				drawSelection(),
				highlightSelectionMatches(),
				EditorState.readOnly.of(true),
				keymap.of([...searchKeymap, ...foldKeymap, ...defaultKeymap]),
				lang.of([]),
				theme.of(editorTheme(themeState.value === 'dark'))
			]
		});
	}

	$effect(() => {
		const h = host;
		const doc = text;
		const file = name;
		if (!h) return;
		untrack(() => {
			if (!view) view = new EditorView({ parent: h, state: stateOf(doc) });
			// The same text read again keeps its place.
			else if (view.state.doc.toString() !== doc) view.setState(stateOf(doc));
			else return;
			const v = view;
			void languageFor(file).then(({ support }) => {
				if (view === v && support) v.dispatch({ effects: lang.reconfigure(support) });
			});
		});
	});

	$effect(() => {
		const dark = themeState.value === 'dark';
		untrack(() => view?.dispatch({ effects: theme.reconfigure(editorTheme(dark)) }));
	});

	onDestroy(() => {
		view?.destroy();
		view = null;
	});
</script>

<div class="code" bind:this={host}></div>

<style>
	.code {
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}
	.code :global(.cm-editor) {
		height: 100%;
	}
</style>
