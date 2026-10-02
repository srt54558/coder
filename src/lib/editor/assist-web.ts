import {
	autocompletion,
	completeFromList,
	snippet,
	type CompletionContext,
	type CompletionResult
} from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import type { Extension } from '@codemirror/state';
import type { CodeLanguage } from '#lib/workspace/model.js';
import { docsHover } from './assist';

const BROWSER_GLOBALS =
	'window document console navigator location history localStorage sessionStorage fetch alert confirm prompt setTimeout setInterval clearTimeout clearInterval requestAnimationFrame cancelAnimationFrame queueMicrotask structuredClone atob btoa crypto performance URL URLSearchParams FormData Headers Request Response AbortController AbortSignal Event CustomEvent JSON Math Object Array String Number Boolean Promise Map Set Date Error'.split(
		/\s+/u
	);

const HTML_TAGS =
	'a abbr address article aside audio b bdi bdo blockquote body br button canvas caption cite code col colgroup data datalist dd del details dfn dialog div dl dt em embed fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 head header hgroup hr html i iframe img input ins kbd label legend li link main map mark menu meta meter nav noscript object ol optgroup option output p picture pre progress q rp rt ruby s samp script search section select slot small source span strong style sub summary sup table tbody td template textarea tfoot th thead time title tr track u ul var video wbr'.split(
		' '
	);
const VOID_TAGS = new Set(
	'area base br col embed hr img input link meta param source track wbr'.split(' ')
);

function insideNestedLanguage(context: CompletionContext): boolean {
	let node: SyntaxNode | null = syntaxTree(context.state).resolveInner(context.pos, -1);
	while (node) {
		if (node.name === 'Script' || node.name === 'StyleSheet' || node.name === 'Style') return true;
		if (
			node.name === 'AttributeName' ||
			node.name === 'AttributeValue' ||
			node.name === 'UnquotedAttributeValue' ||
			node.name === 'Is'
		) {
			return true;
		}
		node = node.parent;
	}
	return false;
}

export function htmlTagSnippets(context: CompletionContext): CompletionResult | null {
	if (insideNestedLanguage(context)) return null;
	const word = context.matchBefore(/<?\/?[A-Za-z][\w:-]*/u);
	if (!word || (word.from === word.to && !context.explicit)) return null;
	if (word.text.startsWith('</') || word.text.startsWith('/')) return null;
	const prefix = word.text.replace(/^</u, '').toLowerCase();
	if (!prefix) return null;
	const tags = HTML_TAGS.filter((tag) => tag.startsWith(prefix)).sort((a, b) => {
		if (a === prefix) return -1;
		if (b === prefix) return 1;
		return a.length - b.length;
	});
	if (!tags.length) return null;
	return {
		from: word.from,
		filter: false,
		validFor: /^<?\/?[A-Za-z][\w:-]*$/u,
		options: tags.map((tag) => ({
			label: VOID_TAGS.has(tag) ? `<${tag}>` : `<${tag}></${tag}>`,
			type: 'type',
			boost: tag === prefix ? 99 : 0,
			apply: VOID_TAGS.has(tag) ? `<${tag}>` : snippet(`<${tag}>\${}</${tag}>`)
		}))
	};
}

async function browserCompletions(): Promise<Extension> {
	const { javascriptLanguage } = await import('@codemirror/lang-javascript');
	return javascriptLanguage.data.of({
		autocomplete: completeFromList(BROWSER_GLOBALS.map((label) => ({ label, type: 'variable' })))
	});
}

export async function webAssist(
	language: CodeLanguage,
	onOpenDocs?: (lessonId: string) => void
): Promise<Extension[]> {
	const extra: Extension[] = [autocompletion(), docsHover(language, onOpenDocs)];
	if (language === 'javascript' || language === 'html') extra.push(await browserCompletions());
	if (language === 'html') {
		const { htmlLanguage } = await import('@codemirror/lang-html');
		extra.push(htmlLanguage.data.of({ autocomplete: htmlTagSnippets }));
	}
	if (language === 'json') {
		const { jsonLanguage } = await import('@codemirror/lang-json');
		extra.push(
			jsonLanguage.data.of({
				autocomplete: completeFromList([
					{ label: 'true', type: 'constant' },
					{ label: 'false', type: 'constant' },
					{ label: 'null', type: 'constant' }
				])
			})
		);
	}
	if (language === 'xml') {
		const { xmlLanguage } = await import('@codemirror/lang-xml');
		extra.push(
			xmlLanguage.data.of({
				autocomplete(context: CompletionContext): CompletionResult | null {
					const word = context.matchBefore(/<\/?[\w:.-]*/u);
					if (!word || (word.from === word.to && !context.explicit)) return null;
					if (!word.text.startsWith('<')) return null;
					const names = ['xml', 'item', 'name', 'value', 'entry'];
					return {
						from: word.from + (word.text.startsWith('</') ? 2 : 1),
						options: names.map((label) => ({ label, type: 'type' }))
					};
				}
			})
		);
	}
	return extra;
}
