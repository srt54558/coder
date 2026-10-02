import { isDiagnosticError, type RuffDiagnostic } from '#lib/runner/protocol.js';

const FRAME = /^ {2}File "([^"]+)", line (\d+)/;

export type ConsoleSegment = {
	text: string;
	line: number | null;
	column: number | null;
	endColumn: number | null;
};

/** Split a traceback so frames in `filename` can be tied to a linter problem. */
export function consoleSegments(stderr: string, filename: string): ConsoleSegment[] {
	const lines = stderr.replaceAll('\r\n', '\n').split('\n');
	const segments: ConsoleSegment[] = [];
	let pending: string[] = [];

	const flushText = () => {
		if (pending.length === 0) return;
		segments.push({ text: pending.join('\n'), line: null, column: null, endColumn: null });
		pending = [];
	};

	for (let index = 0; index < lines.length; index += 1) {
		const frame = FRAME.exec(lines[index]);
		if (!frame || frame[1] !== filename) {
			pending.push(lines[index]);
			continue;
		}

		flushText();
		const start = index;
		const line = Number(frame[2]);
		index += 1;
		while (index < lines.length && lines[index].startsWith(' ') && !FRAME.test(lines[index])) {
			index += 1;
		}
		if (index < lines.length && !lines.slice(index).some((line) => FRAME.test(line))) {
			index = lines.length;
		}
		const block = lines.slice(start, index);
		const caret = caretColumns(block);
		segments.push({
			text: block.join('\n'),
			line,
			column: caret?.column ?? null,
			endColumn: caret?.endColumn ?? null
		});
		index -= 1;
	}

	flushText();
	return segments.map((segment, index) =>
		index === 0 ? segment : { ...segment, text: `\n${segment.text}` }
	);
}

function caretColumns(block: string[]): { column: number; endColumn: number } | null {
	const caret = block.find((line) => /^ +\^+$/.test(line));
	if (!caret) return null;
	const start = caret.indexOf('^');
	const end = caret.lastIndexOf('^');
	// Tracebacks indent the source line by four spaces.
	const prefix = 4;
	return {
		column: Math.max(1, start - prefix + 1),
		endColumn: Math.max(2, end - prefix + 2)
	};
}

function isError(diagnostic: RuffDiagnostic): boolean {
	return isDiagnosticError(diagnostic.code);
}

function covers(
	diagnostic: RuffDiagnostic,
	line: number,
	column: number | null,
	endColumn: number | null
): boolean {
	const start = diagnostic.start_location;
	const end = diagnostic.end_location;
	if (line < start.row || line > end.row) return false;
	if (column === null || endColumn === null) return true;
	if (start.row < line && end.row > line) return true;
	const startColumn = start.row === line ? start.column : 1;
	const stopColumn = end.row === line ? end.column : Number.MAX_SAFE_INTEGER;
	return column < stopColumn && endColumn > startColumn;
}

function span(diagnostic: RuffDiagnostic): number {
	const start = diagnostic.start_location;
	const end = diagnostic.end_location;
	return end.row - start.row || Math.max(0, end.column - start.column);
}

/** The linter problem a console frame should open, when one exists on that line. */
export function matchProblem(
	diagnostics: readonly RuffDiagnostic[],
	line: number,
	column: number | null,
	endColumn: number | null
): RuffDiagnostic | null {
	const onLine = diagnostics.filter((diagnostic) => covers(diagnostic, line, null, null));
	if (onLine.length === 0) return null;
	const precise =
		column === null
			? onLine
			: onLine.filter((diagnostic) => covers(diagnostic, line, column, endColumn));
	const pool = precise.length > 0 ? precise : onLine;
	return [...pool].sort((a, b) => Number(isError(b)) - Number(isError(a)) || span(a) - span(b))[0];
}
