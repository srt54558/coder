import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { lessonForToken } from '#lib/docs/lookup.js';
import type { Lesson } from '#lib/docs/lessons.js';
import type { CodeLanguage } from '#lib/workspace/model.js';

export type DocsHit = {
	from: number;
	to: number;
	text: string;
	lesson: Lesson;
};

const SKIP = new Set([
	'String',
	'FormatString',
	'Comment',
	'LineComment',
	'BlockComment',
	'AttributeValue',
	'UnquotedAttributeValue',
	'Text'
]);

const IDENT = /^(?:[A-Za-z_:][\w:.-]*)$/u;

export function languageAt(
	state: EditorState,
	pos: number,
	fileLanguage: CodeLanguage
): CodeLanguage {
	if (fileLanguage !== 'html') return fileLanguage;
	let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1);
	while (node) {
		if (node.name === 'Script' || node.name === 'ScriptText') return 'javascript';
		if (node.name === 'StyleSheet' || node.name === 'Style' || node.name === 'StyleText')
			return 'css';
		node = node.parent;
	}
	return 'html';
}

export function docsHitAt(
	state: EditorState,
	pos: number,
	side: -1 | 1,
	fileLanguage: CodeLanguage
): DocsHit | null {
	const token = tokenAt(state, pos, side);
	if (!token) return null;
	const language = languageAt(state, token.from, fileLanguage);
	const lesson = lessonForToken(language, token.text);
	if (!lesson) return null;
	return { ...token, lesson };
}

function tokenAt(
	state: EditorState,
	pos: number,
	side: -1 | 1
): { from: number; to: number; text: string } | null {
	const node = syntaxTree(state).resolveInner(pos, side);
	for (let cursor: SyntaxNode | null = node; cursor; cursor = cursor.parent) {
		if (SKIP.has(cursor.name)) return null;
	}
	const named = namedToken(state, node);
	if (named) return named;
	const text = state.sliceDoc(node.from, node.to);
	if (IDENT.test(text) && text.length <= 40) return { from: node.from, to: node.to, text };
	return wordAt(state, pos);
}

function namedToken(
	state: EditorState,
	node: SyntaxNode
): { from: number; to: number; text: string } | null {
	let current: SyntaxNode | null = node;
	if (
		current.name === 'OpenTag' ||
		current.name === 'CloseTag' ||
		current.name === 'SelfClosingTag' ||
		current.name === 'StartTag' ||
		current.name === 'EndTag'
	) {
		current = current.getChild('TagName') ?? current;
	}
	if (current.parent) {
		const parent = current.parent;
		if (
			parent.name === 'OpenTag' ||
			parent.name === 'CloseTag' ||
			parent.name === 'SelfClosingTag'
		) {
			const tag = parent.getChild('TagName');
			if (tag) current = tag;
		}
	}
	if (
		current.name === 'TagName' ||
		current.name === 'AttributeName' ||
		current.name === 'PropertyName' ||
		current.name === 'VariableName' ||
		current.name === 'PropertyIdentifier'
	) {
		const text = state.sliceDoc(current.from, current.to);
		if (!IDENT.test(text)) return null;
		return { from: current.from, to: current.to, text };
	}
	return null;
}

function wordAt(
	state: EditorState,
	pos: number
): { from: number; to: number; text: string } | null {
	const line = state.doc.lineAt(pos);
	const text = line.text;
	const offset = pos - line.from;
	if (offset < 0 || offset > text.length) return null;
	let start = offset;
	let end = offset;
	while (start > 0 && /[\w:-]/u.test(text[start - 1] ?? '')) start -= 1;
	while (end < text.length && /[\w:-]/u.test(text[end] ?? '')) end += 1;
	const word = text.slice(start, end);
	if (!IDENT.test(word)) return null;
	return { from: line.from + start, to: line.from + end, text: word };
}
