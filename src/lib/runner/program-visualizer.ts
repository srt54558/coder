export type ProgramBlockKind =
	| 'condition'
	| 'loop'
	| 'definition'
	| 'output'
	| 'input'
	| 'assignment'
	| 'return'
	| 'import'
	| 'comment'
	| 'control'
	| 'statement';

export interface ProgramBlock {
	line: number;
	indent: number;
	kind: ProgramBlockKind;
	label: string;
	source: string;
}

const LABELS: Record<ProgramBlockKind, string> = {
	condition: 'Bedingung',
	loop: 'Schleife',
	definition: 'Definition',
	output: 'Ausgabe',
	input: 'Eingabe',
	assignment: 'Wert setzen',
	return: 'Rückgabe',
	import: 'Import',
	comment: 'Kommentar',
	control: 'Steuerung',
	statement: 'Anweisung'
};

function classify(source: string): ProgramBlockKind {
	const code = source.trim();
	if (code.startsWith('#')) return 'comment';
	if (/^(if|elif|else|match|case)\b/u.test(code)) return 'condition';
	if (/^(for|while)\b/u.test(code)) return 'loop';
	if (/^(async\s+)?(def|class)\b/u.test(code)) return 'definition';
	if (/^(from\s+\S+\s+import|import)\b/u.test(code)) return 'import';
	if (/^(return|yield|raise)\b/u.test(code)) return 'return';
	if (/^(break|continue|pass)\b/u.test(code)) return 'control';
	if (/^(print|display)\s*\(/u.test(code)) return 'output';
	if (/\binput\s*\(/u.test(code)) return 'input';
	if (/^[\w.\[\]]+\s*(?::=|\+=|-=|\*=|\/=|\/\/=|%=|=)/u.test(code)) {
		return 'assignment';
	}
	return 'statement';
}

/** Create a live, indentation-aware block view from Python source, including incomplete edits. */
export function programBlocks(source: string): ProgramBlock[] {
	return source.split(/\r?\n/u).flatMap((line, index) => {
		if (!line.trim()) return [];
		const whitespace = line.match(/^[\t ]*/u)?.[0] ?? '';
		const indent = [...whitespace].reduce(
			(depth, character) => depth + (character === '\t' ? 4 : 1),
			0
		);
		const kind = classify(line);
		return [{ line: index + 1, indent, kind, label: LABELS[kind], source: line.trim() }];
	});
}
