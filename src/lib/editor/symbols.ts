import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { SyntaxNode, Tree } from '@lezer/common';

export type SymbolKind = 'function' | 'class' | 'variable' | 'parameter' | 'property' | 'import';

export type PythonSymbol = {
	name: string;
	kind: SymbolKind;
	scheme: string;
	doc: string;
	from: number;
	to: number;
};

type StoredSymbol = {
	name: string;
	kind: SymbolKind;
	scheme: string;
	doc: string;
	nameFrom: number;
	scopeFrom: number;
	scopeTo: number;
};

const cache = new WeakMap<Tree, StoredSymbol[]>();
const skipNodes = new Set(['String', 'FormatString', 'Comment']);

export function symbolAt(state: EditorState, pos: number, side: -1 | 1 = -1): PythonSymbol | null {
	let node = syntaxTree(state).resolveInner(pos, side);
	if (node.name !== 'VariableName' && node.name !== 'PropertyName') {
		const parent = node.parent;
		if (
			parent &&
			(parent.name === 'VariableName' || parent.name === 'PropertyName') &&
			parent.from <= pos &&
			pos <= parent.to
		) {
			node = parent;
		} else {
			return null;
		}
	}
	for (let cursor: SyntaxNode | null = node; cursor; cursor = cursor.parent) {
		if (skipNodes.has(cursor.name)) return null;
	}
	const hit = lookup(
		symbolsFor(state),
		state.sliceDoc(node.from, node.to),
		node.from,
		node.name === 'PropertyName'
	);
	if (!hit) return null;
	return {
		name: hit.name,
		kind: hit.kind,
		scheme: hit.scheme,
		doc: hit.doc,
		from: node.from,
		to: node.to
	};
}

export function definitionOf(state: EditorState, name: string, pos: number): PythonSymbol | null {
	const hit = lookup(symbolsFor(state), name, pos, false);
	if (!hit) return null;
	return {
		name: hit.name,
		kind: hit.kind,
		scheme: hit.scheme,
		doc: hit.doc,
		from: hit.nameFrom,
		to: hit.nameFrom + hit.name.length
	};
}

function symbolsFor(state: EditorState): StoredSymbol[] {
	const tree = syntaxTree(state);
	const cached = cache.get(tree);
	if (cached) return cached;
	const symbols = collect(state, tree);
	cache.set(tree, symbols);
	return symbols;
}

function lookup(
	symbols: StoredSymbol[],
	name: string,
	pos: number,
	property: boolean
): StoredSymbol | null {
	const named = symbols.filter(
		(symbol) =>
			symbol.name === name &&
			(property
				? symbol.kind === 'property' || symbol.kind === 'function'
				: symbol.kind !== 'property')
	);
	const visible = named.filter((symbol) => symbol.scopeFrom <= pos && pos <= symbol.scopeTo);
	const pool = visible.length > 0 ? visible : property ? named : [];
	if (pool.length === 0) return null;
	const smallest = Math.min(...pool.map((symbol) => symbol.scopeTo - symbol.scopeFrom));
	const sameScope = pool.filter((symbol) => symbol.scopeTo - symbol.scopeFrom === smallest);
	const before = sameScope.filter((symbol) => symbol.nameFrom <= pos);
	return before.length > 0 ? before[before.length - 1] : sameScope[0];
}

function collect(state: EditorState, tree: Tree): StoredSymbol[] {
	const symbols: StoredSymbol[] = [];
	const scopes: SyntaxNode[] = [tree.topNode];

	const define = (nameNode: SyntaxNode, kind: SymbolKind, scheme: string, doc = '') => {
		const scope = scopes[scopes.length - 1];
		symbols.push({
			name: state.sliceDoc(nameNode.from, nameNode.to),
			kind,
			scheme,
			doc,
			nameFrom: nameNode.from,
			scopeFrom: scope.from,
			scopeTo: scope.to
		});
	};

	const walk = (node: SyntaxNode) => {
		if (node.name === 'FunctionDefinition' || node.name === 'ClassDefinition') {
			const nameNode = node.getChild('VariableName');
			if (nameNode) {
				define(
					nameNode,
					node.name === 'FunctionDefinition' ? 'function' : 'class',
					headText(state, node),
					docstring(state, node)
				);
			}
			scopes.push(node);
			const params = node.getChild('ParamList');
			if (params) defineParams(state, params, define);
			const body = node.getChild('Body');
			if (body) walkChildren(body);
			scopes.pop();
			return;
		}
		if (node.name === 'AssignStatement') {
			defineAssign(state, node, define);
			walkChildren(node);
			return;
		}
		if (node.name === 'ForStatement') {
			defineFor(state, node, define);
			const body = node.getChild('Body');
			if (body) walkChildren(body);
			return;
		}
		if (node.name === 'ImportStatement') {
			defineImport(state, node, define);
			return;
		}
		walkChildren(node);
	};

	const walkChildren = (node: SyntaxNode) => {
		for (let child = node.firstChild; child; child = child.nextSibling) walk(child);
	};

	walk(tree.topNode);
	return symbols;
}

function defineParams(
	state: EditorState,
	params: SyntaxNode,
	define: (nameNode: SyntaxNode, kind: SymbolKind, scheme: string) => void
) {
	for (let child = params.firstChild; child; child = child.nextSibling) {
		if (child.name !== 'VariableName') continue;
		define(child, 'parameter', paramScheme(state, child));
	}
}

function defineAssign(
	state: EditorState,
	node: SyntaxNode,
	define: (nameNode: SyntaxNode, kind: SymbolKind, scheme: string) => void
) {
	const scheme = headText(state, node);
	let pending: { node: SyntaxNode; kind: SymbolKind }[] = [];
	const flush = () => {
		for (const target of pending) define(target.node, target.kind, scheme);
		pending = [];
	};
	for (let child = node.firstChild; child; child = child.nextSibling) {
		if (child.name === 'VariableName') pending.push({ node: child, kind: 'variable' });
		else if (child.name === 'MemberExpression') {
			const property = child.getChild('PropertyName');
			if (property) pending.push({ node: property, kind: 'property' });
		} else if (child.name === 'AssignOp') flush();
		else if (child.name !== ',' && child.name !== 'TypeDef') break;
	}
}

function defineFor(
	state: EditorState,
	node: SyntaxNode,
	define: (nameNode: SyntaxNode, kind: SymbolKind, scheme: string) => void
) {
	const scheme = headText(state, node);
	for (let child = node.firstChild; child && child.name !== 'in'; child = child.nextSibling) {
		if (child.name === 'VariableName') define(child, 'variable', scheme);
	}
}

function defineImport(
	state: EditorState,
	node: SyntaxNode,
	define: (nameNode: SyntaxNode, kind: SymbolKind, scheme: string) => void
) {
	const scheme = headText(state, node);
	let afterImport = false;
	let pending: SyntaxNode | null = null;
	for (let child = node.firstChild; child; child = child.nextSibling) {
		if (child.name === 'import') {
			afterImport = true;
			continue;
		}
		if (!afterImport || (child.name !== 'VariableName' && child.name !== 'as')) continue;
		if (child.name === 'VariableName') {
			pending = child;
			continue;
		}
		const alias = child.nextSibling;
		if (alias?.name === 'VariableName') {
			define(alias, 'import', scheme);
			pending = null;
			child = alias;
		}
	}
	if (pending) define(pending, 'import', scheme);
}

function paramScheme(state: EditorState, nameNode: SyntaxNode): string {
	let from = nameNode.from;
	const previous = nameNode.prevSibling;
	if (previous && (previous.name === '*' || previous.name === '**')) from = previous.from;
	let to = nameNode.to;
	for (
		let sibling = nameNode.nextSibling;
		sibling && sibling.name !== ',' && sibling.name !== ')' && sibling.name !== '/';
		sibling = sibling.nextSibling
	) {
		to = sibling.to;
	}
	return collapse(state.sliceDoc(from, to));
}

function headText(state: EditorState, node: SyntaxNode): string {
	const body = node.getChild('Body');
	return collapse(state.sliceDoc(node.from, body ? body.from : node.to));
}

function docstring(state: EditorState, node: SyntaxNode): string {
	const body = node.getChild('Body');
	if (!body) return '';
	let child = body.firstChild;
	while (child && (child.name === ':' || child.name === 'Comment')) child = child.nextSibling;
	const text = child?.name === 'ExpressionStatement' ? child.getChild('String') : null;
	if (!text) return '';
	return unquote(state.sliceDoc(text.from, text.to)).slice(0, 500);
}

function collapse(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}

function unquote(value: string): string {
	if (
		(value.startsWith('"""') || value.startsWith("'''")) &&
		value.length >= 6 &&
		value.slice(0, 3) === value.slice(-3)
	) {
		return value
			.slice(3, -3)
			.replace(/^\r?\n/, '')
			.trim();
	}
	if (
		(value.startsWith('"') || value.startsWith("'")) &&
		value.length >= 2 &&
		value[0] === value.at(-1)
	) {
		return value.slice(1, -1);
	}
	return value.trim();
}
