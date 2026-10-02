import { python } from '@codemirror/lang-python';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { CodeLanguage } from '#lib/workspace/model.js';
import { languageAssist } from './assist';

const LABELS: Record<CodeLanguage, string> = {
	python: 'Python-Code',
	html: 'HTML-Code',
	javascript: 'JavaScript-Code',
	css: 'CSS-Code',
	json: 'JSON-Code',
	xml: 'XML-Code',
	markdown: 'Markdown',
	text: 'Text'
};

function withChrome(
	grammar: Extension[],
	language: CodeLanguage,
	assist: Extension[]
): Extension[] {
	return [
		...grammar,
		...assist,
		EditorView.contentAttributes.of({
			spellcheck: 'false',
			autocorrect: 'off',
			autocapitalize: 'off',
			autocomplete: 'off',
			writingsuggestions: 'false',
			'aria-label': LABELS[language]
		})
	];
}

export function fallbackLanguageExtensions(
	language: CodeLanguage,
	onOpenDocs: (lessonId: string) => void
): Extension[] {
	return withChrome([], language, languageAssist(language, onOpenDocs));
}

export function syncLanguageExtensions(
	language: CodeLanguage,
	onOpenDocs: (lessonId: string) => void
): Extension[] | null {
	if (language !== 'python' && language !== 'text') return null;
	return withChrome(
		language === 'python' ? [python()] : [],
		language,
		languageAssist(language, onOpenDocs)
	);
}

export async function loadLanguageExtensions(
	language: CodeLanguage,
	onOpenDocs: (lessonId: string) => void
): Promise<Extension[]> {
	const immediate = syncLanguageExtensions(language, onOpenDocs);
	if (immediate) return immediate;
	const grammar = await loadGrammar(language);
	if (language === 'css' || language === 'markdown') {
		return withChrome(grammar, language, languageAssist(language, onOpenDocs));
	}
	const { webAssist } = await import('./assist-web');
	return withChrome(grammar, language, await webAssist(language, onOpenDocs));
}

async function loadGrammar(language: CodeLanguage): Promise<Extension[]> {
	switch (language) {
		case 'html': {
			const { html } = await import('@codemirror/lang-html');
			return [html({ selfClosingTags: true })];
		}
		case 'javascript': {
			const { javascript } = await import('@codemirror/lang-javascript');
			return [javascript()];
		}
		case 'css': {
			const { css } = await import('@codemirror/lang-css');
			return [css()];
		}
		case 'json': {
			const { json } = await import('@codemirror/lang-json');
			return [json()];
		}
		case 'xml': {
			const { xml } = await import('@codemirror/lang-xml');
			return [xml()];
		}
		case 'markdown': {
			const { markdown } = await import('@codemirror/lang-markdown');
			return [markdown()];
		}
		default:
			return [];
	}
}
