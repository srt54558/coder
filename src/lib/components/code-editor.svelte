<script lang="ts">
	import { onMount } from 'svelte';
	import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
	import { bracketMatching, indentOnInput, indentUnit } from '@codemirror/language';
	import { lintGutter, setDiagnostics } from '@codemirror/lint';
	import {
		defaultKeymap,
		history,
		historyKeymap,
		indentWithTab,
		redo,
		redoDepth,
		undo,
		undoDepth
	} from '@codemirror/commands';
	import { Annotation, Compartment, EditorState, Prec } from '@codemirror/state';
	import {
		activateHover,
		drawSelection,
		EditorView,
		highlightActiveLine,
		highlightActiveLineGutter,
		keymap,
		lineNumbers
	} from '@codemirror/view';
	import { applyDocChanges } from '#lib/editor/doc-changes.js';
	import { diagnosticsForDocument, positionToOffset } from '#lib/editor/diagnostics.js';
	import {
		fallbackLanguageExtensions,
		loadLanguageExtensions,
		syncLanguageExtensions
	} from '#lib/editor/language.js';
	import { themeExtensions } from '#lib/editor/themes.js';
	import type { RuffDiagnostic } from '#lib/runner/protocol.js';
	import type { AppTheme } from '#lib/theme.js';
	import type { CodeLanguage } from '#lib/workspace/model.js';
	import type * as Y from 'yjs';
	import { yCollab } from 'y-codemirror.next';

	let {
		fileId,
		value,
		sharedText = null,
		language = 'python',
		diagnostics,
		theme,
		visible = true,
		wrapLines = false,
		onchange,
		onhistory,
		onopendocs
	}: {
		fileId: string;
		value: string;
		sharedText?: Y.Text | null;
		language?: CodeLanguage;
		diagnostics: RuffDiagnostic[];
		theme: AppTheme;
		visible?: boolean;
		wrapLines?: boolean;
		onchange: (value: string) => void;
		onhistory?: (state: { canUndo: boolean; canRedo: boolean }) => void;
		onopendocs?: (lessonId: string) => void;
	} = $props();

	const docsOpener = { open: (lessonId: string) => onopendocs?.(lessonId) };

	const externalChange = Annotation.define<boolean>();
	const themeCompartment = new Compartment();
	const wrapCompartment = new Compartment();
	const languageCompartment = new Compartment();
	let host = $state<HTMLDivElement | null>(null);
	let ready = $state(false);
	let view: EditorView | undefined;
	let loadedFileId = '';
	let loadedSharedText: Y.Text | null = null;
	let wasVisible = false;
	let emitted = '';

	function reportHistory(state: EditorState) {
		onhistory?.({
			canUndo: undoDepth(state) > 0,
			canRedo: redoDepth(state) > 0
		});
	}

	function emitDoc(next: string) {
		emitted = next;
		if (next !== value) onchange(next);
	}

	function languageNow(current: CodeLanguage) {
		return (
			syncLanguageExtensions(current, (lessonId) => docsOpener.open(lessonId)) ??
			fallbackLanguageExtensions(current, (lessonId) => docsOpener.open(lessonId))
		);
	}

	function createState(doc: string) {
		emitted = doc;
		return EditorState.create({
			doc: sharedText?.toString() ?? doc,
			extensions: [
				lineNumbers(),
				highlightActiveLineGutter(),
				highlightActiveLine(),
				drawSelection(),
				history(),
				indentUnit.of('    '),
				EditorState.tabSize.of(4),
				...(sharedText ? [yCollab(sharedText, null, { undoManager: false })] : []),
				indentOnInput(),
				bracketMatching(),
				closeBrackets(),
				languageCompartment.of(languageNow(language)),
				Prec.highest(
					keymap.of([
						{ key: 'Mod-Enter', run: () => true },
						{ key: 'Ctrl-Enter', run: () => true }
					])
				),
				keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
				lintGutter(),
				themeCompartment.of(themeExtensions(theme)),
				wrapCompartment.of(wrapLines ? EditorView.lineWrapping : []),
				EditorView.updateListener.of((update) => {
					if (
						update.docChanged &&
						!sharedText &&
						!update.transactions.some((transaction) => transaction.annotation(externalChange))
					) {
						const patches: { from: number; to: number; insert: string }[] = [];
						update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
							patches.push({ from: fromA, to: toA, insert: inserted.toString() });
						});
						emitDoc(applyDocChanges(emitted, patches));
					}
					if (update.docChanged || update.transactions.length > 0) reportHistory(update.state);
				})
			]
		});
	}

	function applyExternalDocument(next: string) {
		if (!view) return;
		const current = view.state.doc.toString();
		if (current === next) return;
		let from = 0;
		while (from < current.length && from < next.length && current[from] === next[from]) from += 1;
		let currentEnd = current.length;
		let nextEnd = next.length;
		while (currentEnd > from && nextEnd > from && current[currentEnd - 1] === next[nextEnd - 1]) {
			currentEnd -= 1;
			nextEnd -= 1;
		}
		view.dispatch({
			changes: { from, to: currentEnd, insert: next.slice(from, nextEnd) },
			annotations: externalChange.of(true)
		});
	}

	export function undoEdit() {
		if (!view) return;
		undo(view);
		view.focus();
	}

	export function redoEdit() {
		if (!view) return;
		redo(view);
		view.focus();
	}

	export function focusEditor() {
		view?.focus();
	}

	export function reveal(row: number, column: number) {
		if (!view) return;
		const lineNumber = Math.min(Math.max(row, 1), view.state.doc.lines);
		const line = view.state.doc.line(lineNumber);
		const pos = Math.min(line.to, line.from + Math.max(0, column - 1));
		view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
		view.focus();
	}

	export function showDiagnostic(row: number, column: number, endRow: number, endColumn: number) {
		if (!view) return;
		const doc = view.state.doc.toString();
		const from = positionToOffset(doc, row, column);
		let to = positionToOffset(doc, endRow, endColumn);
		if (to <= from) to = Math.min(doc.length, from + 1);
		view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
		activateHover(view, from, 1, {
			until: (transaction) => transaction.docChanged || transaction.isUserEvent('select')
		});
		view.focus();
	}

	onMount(() => {
		const parent = host;
		if (!parent) return;
		loadedFileId = fileId;
		loadedSharedText = sharedText;
		view = new EditorView({
			parent,
			state: createState(value)
		});
		reportHistory(view.state);
		ready = true;
		return () => {
			ready = false;
			view?.destroy();
			view = undefined;
		};
	});

	$effect(() => {
		if (!ready || !view) return;
		const id = fileId;
		const next = value;
		const nextSharedText = sharedText;
		if (id !== loadedFileId || nextSharedText !== loadedSharedText) {
			loadedFileId = id;
			loadedSharedText = nextSharedText;
			view.setState(createState(next));
			reportHistory(view.state);
			return;
		}
		if (emitted === next || view.state.doc.toString() === next) {
			emitted = next;
			return;
		}
		applyExternalDocument(next);
		emitted = next;
	});

	$effect(() => {
		if (!ready || !view) return;
		const source = value;
		const mapped = diagnosticsForDocument(source, diagnostics);
		if (emitted !== source) return;
		view.dispatch(setDiagnostics(view.state, mapped));
	});

	$effect(() => {
		if (!ready || !view) return;
		view.dispatch({ effects: themeCompartment.reconfigure(themeExtensions(theme)) });
	});

	$effect(() => {
		docsOpener.open = (lessonId) => onopendocs?.(lessonId);
	});

	$effect(() => {
		if (!ready || !view) return;
		const current = language;
		const currentView = view;
		let cancelled = false;
		const immediate = syncLanguageExtensions(current, (lessonId) => docsOpener.open(lessonId));
		if (immediate) {
			currentView.dispatch({ effects: languageCompartment.reconfigure(immediate) });
			return;
		}
		void loadLanguageExtensions(current, (lessonId) => docsOpener.open(lessonId)).then(
			(extensions) => {
				if (cancelled || view !== currentView) return;
				currentView.dispatch({ effects: languageCompartment.reconfigure(extensions) });
			}
		);
		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		if (!ready || !view) return;
		view.dispatch({
			effects: wrapCompartment.reconfigure(wrapLines ? EditorView.lineWrapping : [])
		});
	});

	$effect(() => {
		if (!ready || !view) return;
		if (!visible) {
			wasVisible = false;
			return;
		}
		view.requestMeasure();
		const narrow = window.matchMedia('(max-width: 899px)').matches;
		if (!wasVisible && !narrow) view.focus();
		wasVisible = true;
	});
</script>

<div class="code-host" bind:this={host}></div>

<style>
	.code-host {
		height: 100%;
		min-height: 0;
		overflow: hidden;
	}
	.code-host :global(.cm-editor) {
		height: 100%;
		max-height: 100%;
		overflow: hidden;
	}
	.code-host :global(.cm-scroller) {
		overflow: auto;
	}
</style>
