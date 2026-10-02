import {
	autocompletion,
	type Completion,
	type CompletionContext,
	type CompletionResult
} from '@codemirror/autocomplete';
import { globalCompletion, localCompletionSource } from '@codemirror/lang-python';
import { hoverTooltip, type EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import type { CodeLanguage } from '#lib/workspace/model.js';
import { docsHitAt } from './docs-hover';
import { symbolAt, definitionOf, type PythonSymbol, type SymbolKind } from './symbols';

const kindLabel: Record<SymbolKind, string> = {
	function: 'Funktion',
	class: 'Klasse',
	variable: 'Variable',
	parameter: 'Parameter',
	property: 'Attribut',
	import: 'Import'
};

function scopedCompletions(context: CompletionContext): CompletionResult | null {
	const result = localCompletionSource(context);
	if (!result) return null;
	return {
		...result,
		options: result.options.map((option) => withScheme(option, context))
	};
}

function withScheme(option: Completion, context: CompletionContext): Completion {
	const hit = definitionOf(context.state, option.label, context.pos);
	if (!hit || hit.name !== option.label) return option;
	return {
		...option,
		detail: kindLabel[hit.kind],
		info: hit.doc ? `${hit.scheme}\n\n${hit.doc}` : hit.scheme
	};
}

function codeHover(
	view: EditorView,
	pos: number,
	side: -1 | 1,
	language: CodeLanguage,
	onOpenDocs?: (lessonId: string) => void
) {
	const symbol = language === 'python' ? symbolAt(view.state, pos, side) : null;
	const docs = docsHitAt(view.state, pos, side, language);
	if (!symbol && !docs) return null;
	return {
		pos: symbol?.from ?? docs?.from ?? pos,
		end: symbol?.to ?? docs?.to ?? pos,
		above: true,
		create() {
			const dom = document.createElement('div');
			dom.className = 'cm-python-hover';
			if (symbol) appendSymbol(dom, symbol);
			if (docs) appendDocsLink(dom, docs.lesson.id, onOpenDocs);
			return { dom };
		}
	};
}

function appendSymbol(dom: HTMLElement, hit: PythonSymbol) {
	const kind = document.createElement('div');
	kind.className = 'cm-python-hover-kind';
	kind.textContent = kindLabel[hit.kind];
	const scheme = document.createElement('pre');
	scheme.className = 'cm-python-hover-scheme';
	scheme.textContent = hit.scheme;
	dom.append(kind, scheme);
	if (hit.doc) {
		const doc = document.createElement('div');
		doc.className = 'cm-python-hover-doc';
		doc.textContent = hit.doc;
		dom.append(doc);
	}
}

function appendDocsLink(
	dom: HTMLElement,
	lessonId: string,
	onOpenDocs?: (lessonId: string) => void
) {
	const link = document.createElement('button');
	link.type = 'button';
	link.className = 'cm-docs-link';
	const label = document.createElement('span');
	label.textContent = 'Doku';
	link.append(label);
	link.insertAdjacentHTML(
		'beforeend',
		'<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>'
	);
	link.addEventListener('mousedown', (event) => {
		event.preventDefault();
		onOpenDocs?.(lessonId);
	});
	link.addEventListener('click', (event) => {
		event.preventDefault();
		onOpenDocs?.(lessonId);
	});
	dom.append(link);
}

export function docsHover(
	language: CodeLanguage,
	onOpenDocs?: (lessonId: string) => void
): Extension {
	return hoverTooltip((view, pos, side) => codeHover(view, pos, side, language, onOpenDocs), {
		hideOnChange: true
	});
}

export function languageAssist(
	language: CodeLanguage,
	onOpenDocs?: (lessonId: string) => void
): Extension[] {
	const hover = docsHover(language, onOpenDocs);
	if (language === 'python') {
		return [autocompletion({ override: [scopedCompletions, globalCompletion] }), hover];
	}
	return [autocompletion(), hover];
}
