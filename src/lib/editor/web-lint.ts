import { parse as parseJavaScript, type Node } from 'acorn';
import { lexer, parse as parseCss, walk as walkCss } from 'css-tree';
import type { RuffDiagnostic } from '#lib/runner/protocol.js';
import { codeLanguage } from '#lib/workspace/model.js';

type Position = { row: number; column: number };

const GLOBALS = new Set(
	`AggregateError Array ArrayBuffer Atomics BigInt BigInt64Array BigUint64Array Boolean DataView Date Error EvalError FinalizationRegistry Float32Array Float64Array Function Infinity Int16Array Int32Array Int8Array Intl JSON Map Math NaN Number Object Promise Proxy RangeError ReferenceError Reflect RegExp Set SharedArrayBuffer String Symbol SyntaxError TypeError URIError Uint16Array Uint32Array Uint8Array Uint8ClampedArray WeakMap WeakRef WeakSet decodeURI decodeURIComponent encodeURI encodeURIComponent escape eval isFinite isNaN parseFloat parseInt unescape undefined globalThis
window document console navigator location history localStorage sessionStorage fetch alert confirm prompt setTimeout setInterval clearTimeout clearInterval requestAnimationFrame cancelAnimationFrame queueMicrotask structuredClone atob btoa crypto performance
URL URLSearchParams FormData Headers Request Response AbortController AbortSignal Event CustomEvent HTMLElement Node Element Document Window TextEncoder TextDecoder Blob File FileReader MutationObserver IntersectionObserver ResizeObserver DOMParser XMLSerializer getComputedStyle matchMedia open close print parent top self frames screen origin
Audio AudioContext Image ImageData Option Worker MessageChannel WebSocket XMLHttpRequest queueMicrotask reportError`
		.split(/\s+/u)
		.filter(Boolean)
);

const VOID_TAGS = new Set(
	'area base br col embed hr img input link meta param source track wbr'.split(' ')
);
const OPTIONAL_CLOSE = new Set(
	'html head body p li dt dd td th tr thead tbody tfoot option colgroup caption rt rp'.split(' ')
);

type Binding = {
	name: string;
	used: boolean;
	report: boolean;
	row: number;
	column: number;
	endColumn: number;
};

type Scope = {
	kind: 'function' | 'block';
	bindings: Map<string, Binding>;
	parent: Scope | null;
	children: Scope[];
};

type Reference = {
	name: string;
	scope: Scope;
	row: number;
	column: number;
	endColumn: number;
};

type WalkNode = Node & Record<string, unknown>;

export function lintWeb(filename: string, source: string): RuffDiagnostic[] {
	if (!source.trim()) return [];
	switch (codeLanguage(filename)) {
		case 'html':
			return lintHtml(source);
		case 'javascript':
			return lintJavaScript(source, source, 0, 'script');
		case 'css':
			return lintCss(source, source, 0, 'stylesheet');
		case 'json':
			return lintJson(source);
		case 'xml':
			return lintXml(source);
		case 'markdown':
			return lintMarkdown(source);
		default:
			return [];
	}
}

function issue(code: string, message: string, start: Position, end: Position): RuffDiagnostic {
	const endColumn = end.row === start.row ? Math.max(end.column, start.column + 1) : end.column;
	return {
		code,
		message,
		start_location: { row: start.row, column: start.column },
		end_location: { row: end.row, column: endColumn }
	};
}

function locate(source: string, index: number): Position {
	let row = 1;
	let column = 1;
	const end = Math.min(Math.max(index, 0), source.length);
	for (let cursor = 0; cursor < end; cursor += 1) {
		if (source[cursor] === '\n') {
			row += 1;
			column = 1;
		} else {
			column += 1;
		}
	}
	return { row, column };
}

/** `column` is 0-based within the fragment line. */
function place(full: string, baseIndex: number, line: number, zeroColumn: number): Position {
	const origin = locate(full, baseIndex);
	if (line <= 1) return { row: origin.row, column: origin.column + zeroColumn };
	return { row: origin.row + line - 1, column: zeroColumn + 1 };
}

function lintJavaScript(
	full: string,
	code: string,
	baseIndex: number,
	sourceType: 'script' | 'module',
	syntaxOnly = false
): RuffDiagnostic[] {
	if (!code.trim()) return [];
	let ast: WalkNode;
	try {
		ast = parseJavaScript(code, {
			ecmaVersion: 'latest',
			sourceType,
			locations: true,
			allowReturnOutsideFunction: true,
			allowAwaitOutsideFunction: sourceType === 'module',
			allowImportExportEverywhere: false
		}) as unknown as WalkNode;
	} catch (error) {
		const located = error as { loc?: { line: number; column: number }; message?: string };
		const start = located.loc
			? place(full, baseIndex, located.loc.line, located.loc.column)
			: locate(full, baseIndex);
		const message = (located.message ?? 'Syntaxfehler').replace(/\s*\(\d+:\d+\)$/u, '');
		return [issue('JS', message, start, start)];
	}
	if (syntaxOnly) return [];

	const root = createScope(null, 'function');
	root.bindings.set('arguments', unusedBinding('arguments', { row: 1, column: 1 }, false));
	const references: Reference[] = [];
	hoist(ast.body as WalkNode[], root);
	for (const statement of (ast.body as WalkNode[]) ?? []) walk(statement, root, references);
	const at = (row: number, column: number) => place(full, baseIndex, row, column - 1);
	const issues: RuffDiagnostic[] = [];
	for (const reference of references) {
		const binding = resolve(reference.scope, reference.name);
		if (binding) binding.used = true;
		else if (!GLOBALS.has(reference.name)) {
			const start = at(reference.row, reference.column);
			issues.push(
				issue('JS', `„${reference.name}“ ist nicht definiert.`, start, {
					row: start.row,
					column: start.column + (reference.endColumn - reference.column)
				})
			);
		}
	}
	collectUnused(root, issues, at);
	return issues;
}

function unusedBinding(
	name: string,
	start: Position,
	report: boolean,
	endColumn = start.column + name.length
): Binding {
	return { name, used: false, report, row: start.row, column: start.column, endColumn };
}

function createScope(parent: Scope | null, kind: Scope['kind']): Scope {
	const scope = { kind, bindings: new Map<string, Binding>(), parent, children: [] as Scope[] };
	parent?.children.push(scope);
	return scope;
}

function nearestFunction(scope: Scope): Scope {
	let current = scope;
	while (current.kind === 'block' && current.parent) current = current.parent;
	return current;
}

function declareName(
	scope: Scope,
	name: string,
	loc: AcornLoc | null | undefined,
	report: boolean
) {
	if (scope.bindings.has(name)) return;
	const start = loc ? { row: loc.start.line, column: loc.start.column + 1 } : { row: 1, column: 1 };
	const endColumn = loc ? loc.end.column + 1 : start.column + name.length;
	scope.bindings.set(name, unusedBinding(name, start, report, endColumn));
}

function resolve(scope: Scope, name: string): Binding | null {
	for (let current: Scope | null = scope; current; current = current.parent) {
		const binding = current.bindings.get(name);
		if (binding) return binding;
	}
	return null;
}

function collectUnused(
	scope: Scope,
	issues: RuffDiagnostic[],
	at: (row: number, column: number) => Position
) {
	for (const binding of scope.bindings.values()) {
		if (!binding.report || binding.used || binding.name.startsWith('_')) continue;
		const start = at(binding.row, binding.column);
		issues.push(
			issue('Hinweis', `„${binding.name}“ wird nicht verwendet.`, start, {
				row: start.row,
				column: start.column + (binding.endColumn - binding.column)
			})
		);
	}
	for (const child of scope.children) collectUnused(child, issues, at);
}

type AcornLoc = { start: { line: number; column: number }; end: { line: number; column: number } };

function nodeLoc(node: WalkNode): AcornLoc | null {
	return (node.loc as AcornLoc | null | undefined) ?? null;
}

function hoist(statements: WalkNode[], scope: Scope) {
	for (const statement of statements) {
		if (!statement) continue;
		if (statement.type === 'FunctionDeclaration' && statement.id) {
			const id = statement.id as WalkNode;
			declareName(nearestFunction(scope), String(id.name), nodeLoc(id), true);
		}
		if (statement.type === 'VariableDeclaration' && statement.kind === 'var') {
			for (const declarator of (statement.declarations as WalkNode[]) ?? []) {
				collectDeclared(declarator.id as WalkNode, nearestFunction(scope));
			}
		}
	}
}

function collectDeclared(node: WalkNode | null, scope: Scope) {
	if (!node) return;
	if (node.type === 'Identifier') declareName(scope, String(node.name), nodeLoc(node), true);
	else if (node.type === 'AssignmentPattern') collectDeclared(node.left as WalkNode, scope);
	else if (node.type === 'RestElement') collectDeclared(node.argument as WalkNode, scope);
	else if (node.type === 'ObjectPattern') {
		for (const property of (node.properties as WalkNode[]) ?? []) {
			if (property.type === 'RestElement') collectDeclared(property.argument as WalkNode, scope);
			else if (property.type === 'Property') collectDeclared(property.value as WalkNode, scope);
		}
	} else if (node.type === 'ArrayPattern') {
		for (const element of (node.elements as Array<WalkNode | null>) ?? [])
			collectDeclared(element, scope);
	}
}

function walk(
	node: WalkNode | null,
	scope: Scope,
	references: Reference[],
	mode: 'ref' | 'declare' = 'ref'
) {
	if (!node || typeof node.type !== 'string') return;
	if (mode === 'declare') {
		if (node.type === 'Identifier') {
			declareName(scope, String(node.name), nodeLoc(node), true);
			return;
		}
		if (node.type === 'AssignmentPattern') {
			walk(node.left as WalkNode, scope, references, 'declare');
			walk(node.right as WalkNode, scope, references, 'ref');
			return;
		}
		if (
			node.type === 'ObjectPattern' ||
			node.type === 'ArrayPattern' ||
			node.type === 'RestElement'
		) {
			collectDeclared(node, scope);
			return;
		}
	}

	switch (node.type) {
		case 'Program':
		case 'BlockStatement': {
			const inner = node.type === 'Program' ? scope : createScope(scope, 'block');
			const body = (node.body as WalkNode[]) ?? [];
			if (node.type === 'BlockStatement') hoist(body, inner);
			for (const statement of body) walk(statement, inner, references);
			return;
		}
		case 'FunctionDeclaration':
		case 'FunctionExpression':
		case 'ArrowFunctionExpression': {
			const inner = createScope(scope, 'function');
			if (node.type !== 'ArrowFunctionExpression') {
				inner.bindings.set('arguments', unusedBinding('arguments', { row: 1, column: 1 }, false));
			}
			if (node.id)
				declareName(inner, String((node.id as WalkNode).name), nodeLoc(node.id as WalkNode), false);
			for (const param of (node.params as WalkNode[]) ?? [])
				walk(param, inner, references, 'declare');
			markDeclared(inner, false);
			walk(node.body as WalkNode, inner, references);
			return;
		}
		case 'VariableDeclaration': {
			const target = node.kind === 'var' ? nearestFunction(scope) : scope;
			for (const declarator of (node.declarations as WalkNode[]) ?? [])
				walk(declarator, target, references);
			return;
		}
		case 'VariableDeclarator':
			walk(node.id as WalkNode, scope, references, 'declare');
			walk(node.init as WalkNode, scope, references);
			return;
		case 'Identifier':
			references.push(reference(node, scope));
			return;
		case 'MemberExpression':
			walk(node.object as WalkNode, scope, references);
			if (node.computed) walk(node.property as WalkNode, scope, references);
			return;
		case 'Property':
			if (node.computed) walk(node.key as WalkNode, scope, references);
			walk(node.value as WalkNode, scope, references);
			return;
		case 'MethodDefinition':
		case 'PropertyDefinition':
			if (node.computed) walk(node.key as WalkNode, scope, references);
			walk(node.value as WalkNode, scope, references);
			return;
		case 'ClassDeclaration':
		case 'ClassExpression': {
			if (node.type === 'ClassDeclaration' && node.id) {
				declareName(scope, String((node.id as WalkNode).name), nodeLoc(node.id as WalkNode), true);
			}
			const inner = createScope(scope, 'block');
			if (node.id)
				declareName(inner, String((node.id as WalkNode).name), nodeLoc(node.id as WalkNode), false);
			walk(node.superClass as WalkNode, scope, references);
			walk(node.body as WalkNode, inner, references);
			return;
		}
		case 'ImportDeclaration':
			for (const specifier of (node.specifiers as WalkNode[]) ?? []) {
				const local = specifier.local as WalkNode;
				declareName(scope, String(local.name), nodeLoc(local), true);
			}
			return;
		case 'ExportNamedDeclaration':
			if (node.declaration) walk(node.declaration as WalkNode, scope, references);
			else {
				for (const specifier of (node.specifiers as WalkNode[]) ?? []) {
					walk(specifier.local as WalkNode, scope, references);
				}
			}
			return;
		case 'ExportDefaultDeclaration':
			walk(node.declaration as WalkNode, scope, references);
			return;
		case 'CatchClause': {
			const inner = createScope(scope, 'block');
			if (node.param) walk(node.param as WalkNode, inner, references, 'declare');
			markDeclared(inner, false);
			walk(node.body as WalkNode, inner, references);
			return;
		}
		case 'ForStatement':
		case 'ForInStatement':
		case 'ForOfStatement': {
			const inner = createScope(scope, 'block');
			walk(node.init as WalkNode, inner, references);
			walk(node.left as WalkNode, inner, references);
			walk(node.right as WalkNode, inner, references);
			walk(node.test as WalkNode, inner, references);
			walk(node.update as WalkNode, inner, references);
			walk(node.body as WalkNode, inner, references);
			return;
		}
		case 'LabeledStatement':
			walk(node.body as WalkNode, scope, references);
			return;
		case 'BreakStatement':
		case 'ContinueStatement':
		case 'MetaProperty':
			return;
		case 'UnaryExpression':
			if (
				node.operator === 'typeof' &&
				(node.argument as WalkNode | undefined)?.type === 'Identifier'
			)
				return;
			walk(node.argument as WalkNode, scope, references);
			return;
		default:
			for (const value of Object.values(node)) walkValue(value, scope, references);
	}
}

function markDeclared(scope: Scope, report: boolean) {
	for (const binding of scope.bindings.values()) binding.report = report;
}

function reference(node: WalkNode, scope: Scope): Reference {
	const loc = nodeLoc(node);
	const name = String(node.name);
	return {
		name,
		scope,
		row: loc?.start.line ?? 1,
		column: (loc?.start.column ?? 0) + 1,
		endColumn: (loc?.end.column ?? name.length) + 1
	};
}

function walkValue(value: unknown, scope: Scope, references: Reference[]) {
	if (Array.isArray(value)) {
		for (const entry of value) walkValue(entry, scope, references);
		return;
	}
	if (value && typeof value === 'object' && typeof (value as WalkNode).type === 'string') {
		walk(value as WalkNode, scope, references);
	}
}

function lintCss(
	full: string,
	code: string,
	baseIndex: number,
	context: 'stylesheet' | 'declarationList'
): RuffDiagnostic[] {
	if (!code.trim()) return [];
	const issues: RuffDiagnostic[] = [];
	let ast: ReturnType<typeof parseCss> | null;
	try {
		ast = parseCss(code, {
			positions: true,
			context,
			onParseError(error) {
				const start =
					typeof error.line === 'number'
						? place(full, baseIndex, error.line, Math.max(0, (error.column ?? 1) - 1))
						: locate(full, baseIndex);
				issues.push(issue('CSS', 'CSS ist hier ungültig.', start, start));
			}
		});
	} catch (error) {
		const located = error as { line?: number; column?: number };
		const start =
			typeof located.line === 'number'
				? place(full, baseIndex, located.line, Math.max(0, (located.column ?? 1) - 1))
				: locate(full, baseIndex);
		return [issue('CSS', 'CSS ist hier ungültig.', start, start)];
	}
	if (!ast) return issues;
	walkCss(ast, (node) => {
		if (node.type !== 'Declaration' || typeof node.property !== 'string' || !node.value) return;
		if (node.property.startsWith('--') || node.property.startsWith('-')) return;
		const matched = lexer.matchProperty(node.property, node.value);
		const message = matched.error?.message ?? '';
		if (!matched.error) return;
		const raw = message.startsWith('Unknown property')
			? `Unbekannte CSS-Eigenschaft „${node.property}“.`
			: `Der Wert für „${node.property}“ passt nicht.`;
		const line = node.loc?.start.line ?? 1;
		const column = Math.max(0, (node.loc?.start.column ?? 1) - 1);
		const endColumn = Math.max(column + 1, node.loc?.end.column ?? column + node.property.length);
		const start = place(full, baseIndex, line, column);
		issues.push(
			issue(message.startsWith('Unknown property') ? 'CSS' : 'Hinweis', raw, start, {
				row: start.row,
				column: start.column + (endColumn - column)
			})
		);
	});
	return issues;
}

function isJavaScriptType(attrs: string): boolean {
	const match = /\btype\s*=\s*(['"])([^'"]*)\1/iu.exec(attrs);
	if (!match) return true;
	const type = match[2].trim().toLowerCase();
	return (
		type === '' ||
		type === 'module' ||
		type === 'text/javascript' ||
		type === 'application/javascript'
	);
}

function lintHtml(source: string): RuffDiagnostic[] {
	const issues: RuffDiagnostic[] = [];
	const stack: Array<{ name: string; row: number; column: number }> = [];
	let index = 0;
	while (index < source.length) {
		if (source.startsWith('<!--', index)) {
			const end = source.indexOf('-->', index + 4);
			index = end === -1 ? source.length : end + 3;
			continue;
		}
		if (source.startsWith('<!', index) || source.startsWith('<?', index)) {
			const end = source.indexOf('>', index + 2);
			index = end === -1 ? source.length : end + 1;
			continue;
		}
		if (source[index] !== '<') {
			index += 1;
			continue;
		}
		const close = /^<\/([A-Za-z][\w:-]*)\s*>/u.exec(source.slice(index));
		if (close) {
			const name = close[1].toLowerCase();
			const at = locate(source, index);
			while (
				stack.length > 0 &&
				stack.at(-1)?.name !== name &&
				OPTIONAL_CLOSE.has(stack.at(-1)?.name ?? '')
			) {
				stack.pop();
			}
			const top = stack.at(-1);
			if (!top) {
				issues.push(
					issue('HTML', `Unerwartetes schließendes Tag </${name}>.`, at, {
						row: at.row,
						column: at.column + close[0].length
					})
				);
			} else if (top.name !== name) {
				issues.push(
					issue('HTML', `</${name}> passt nicht zu <${top.name}>.`, at, {
						row: at.row,
						column: at.column + close[0].length
					})
				);
			} else {
				stack.pop();
			}
			index += close[0].length;
			continue;
		}
		const open = /^<([A-Za-z][\w:-]*)\b([^>]*)>/u.exec(source.slice(index));
		if (!open) {
			index += 1;
			continue;
		}
		const name = open[1].toLowerCase();
		const attrs = open[2] ?? '';
		const tagEnd = index + open[0].length;
		const at = locate(source, index);
		issues.push(...lintAttributes(source, attrs, tagEnd - 1 - attrs.length));
		const selfClosing = /\/\s*$/u.test(attrs) || VOID_TAGS.has(name);
		if ((name === 'script' || name === 'style') && !selfClosing) {
			const closer = new RegExp(`</${name}\\s*>`, 'iu');
			const rest = source.slice(tagEnd);
			const found = closer.exec(rest);
			const content = found ? rest.slice(0, found.index) : rest;
			if (name === 'script' && isJavaScriptType(attrs)) {
				const sourceType = /\btype\s*=\s*(['"])module\1/iu.test(attrs) ? 'module' : 'script';
				issues.push(...lintJavaScript(source, content, tagEnd, sourceType));
			}
			if (name === 'style') issues.push(...lintCss(source, content, tagEnd, 'stylesheet'));
			if (!found) {
				stack.push({ name, row: at.row, column: at.column });
				index = source.length;
			} else {
				index = tagEnd + found.index + found[0].length;
			}
			continue;
		}
		if (!selfClosing) stack.push({ name, row: at.row, column: at.column });
		index = tagEnd;
	}
	for (const open of stack) {
		if (OPTIONAL_CLOSE.has(open.name)) continue;
		issues.push(
			issue('HTML', `<${open.name}> ist nicht geschlossen.`, open, {
				row: open.row,
				column: open.column + open.name.length + 1
			})
		);
	}
	return issues;
}

function lintAttributes(source: string, attrs: string, attrsStart: number): RuffDiagnostic[] {
	if (!attrs.trim()) return [];
	const issues: RuffDiagnostic[] = [];
	const pattern = /(?:^|\s)(on[a-z]+|style)\s*=\s*(?:"([^"]*)"|'([^']*)')/giu;
	for (const match of attrs.matchAll(pattern)) {
		const value = match[2] ?? match[3] ?? '';
		if (!value.trim() || match.index == null) continue;
		const base = attrsStart + match.index + match[0].length - value.length - 1;
		if (match[1].toLowerCase() === 'style')
			issues.push(...lintCss(source, value, base, 'declarationList'));
		else issues.push(...lintJavaScript(source, value, base, 'script', true));
	}
	return issues;
}

function jsonErrorIndex(source: string, message: string): number {
	const position = /position\s+(\d+)/iu.exec(message);
	if (position) return Number(position[1]);
	const token = /Unexpected token (?:'([^']*)'|"([^"]*)")/u.exec(message);
	const raw = token?.[1] ?? token?.[2];
	if (!raw) return 0;
	const index = source.indexOf(raw);
	return index >= 0 ? index : 0;
}

function lintJson(source: string): RuffDiagnostic[] {
	try {
		JSON.parse(source);
		return [];
	} catch (error) {
		const message = error instanceof Error ? error.message : '';
		const start = locate(source, jsonErrorIndex(source, message));
		return [issue('JSON', 'JSON ist hier ungültig.', start, start)];
	}
}

function lintXml(source: string): RuffDiagnostic[] {
	const issues: RuffDiagnostic[] = [];
	const stack: string[] = [];
	const pattern =
		/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<\/([A-Za-z_:][\w:.-]*)\s*>|<([A-Za-z_:][\w:.-]*)\b([^>]*?)(\/?)>/gu;
	let roots = 0;
	for (const match of source.matchAll(pattern)) {
		if (match[0].startsWith('<!--') || match[0].startsWith('<?') || match[0].startsWith('<!'))
			continue;
		const at = locate(source, match.index ?? 0);
		if (match[1]) {
			const name = match[1];
			const top = stack.pop();
			if (top !== name) {
				issues.push(
					issue(
						'XML',
						top
							? `</${name}> passt nicht zu <${top}>.`
							: `Unerwartetes schließendes Tag </${name}>.`,
						at,
						at
					)
				);
				return issues;
			}
			continue;
		}
		const name = match[2] ?? '';
		const attrs = match[3] ?? '';
		if (!attributesQuoted(attrs)) {
			issues.push(issue('XML', `Attribut in <${name}> braucht Anführungszeichen.`, at, at));
			return issues;
		}
		const selfClosing = Boolean(match[4]);
		if (stack.length === 0) roots += 1;
		if (!selfClosing) stack.push(name);
	}
	if (roots === 0) {
		const at = locate(source, 0);
		return [issue('XML', 'XML braucht ein Wurzelelement.', at, at)];
	}
	if (roots > 1)
		return [
			issue('XML', 'XML darf nur ein Wurzelelement haben.', locate(source, 0), locate(source, 0))
		];
	if (stack.length > 0) {
		return [
			issue('XML', `<${stack[0]}> ist nicht geschlossen.`, locate(source, 0), locate(source, 0))
		];
	}
	return issues;
}

function attributesQuoted(attrs: string): boolean {
	const pattern = /([^\s=]+)\s*=\s*([^\s>]+)/gu;
	for (const match of attrs.matchAll(pattern)) {
		const value = match[2] ?? '';
		if (!value.startsWith('"') && !value.startsWith("'")) return false;
	}
	return true;
}

function lintMarkdown(source: string): RuffDiagnostic[] {
	const lines = source.split('\n');
	let openRow = 0;
	for (let index = 0; index < lines.length; index += 1) {
		if (!/^(?:```|~~~)/u.test(lines[index] ?? '')) continue;
		openRow = openRow ? 0 : index + 1;
	}
	if (!openRow) return [];
	return [
		issue(
			'MD',
			'Der Codeblock ist nicht geschlossen.',
			{ row: openRow, column: 1 },
			{ row: openRow, column: 4 }
		)
	];
}
