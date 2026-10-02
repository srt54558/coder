import type { Diagnostic } from '@codemirror/lint';
import { isDiagnosticError, type RuffDiagnostic } from '#lib/runner/protocol.js';

function lineStarts(doc: string): number[] {
	const starts = [0];
	for (let index = 0; index < doc.length; index += 1) {
		if (doc.charCodeAt(index) === 10) starts.push(index + 1);
	}
	return starts;
}

export function positionToOffset(
	doc: string,
	row: number,
	column: number,
	starts: readonly number[] = lineStarts(doc)
): number {
	const lineIndex = Math.min(Math.max(row, 1), Math.max(starts.length, 1)) - 1;
	const from = starts[lineIndex] ?? 0;
	const to = starts[lineIndex + 1] ?? doc.length + 1;
	const lineLength = Math.max(0, to - from - 1);
	return Math.min(doc.length, from + Math.min(Math.max(column, 1) - 1, lineLength));
}

export function diagnosticsForDocument(
	doc: string,
	items: readonly RuffDiagnostic[]
): Diagnostic[] {
	const starts = lineStarts(doc);
	return items.map((item) => {
		const fromStart = positionToOffset(
			doc,
			item.start_location.row,
			item.start_location.column,
			starts
		);
		let from = fromStart;
		const lineEnd = positionToOffset(doc, item.start_location.row, Number.MAX_SAFE_INTEGER, starts);
		let to = positionToOffset(doc, item.end_location.row, item.end_location.column, starts);
		if (to > lineEnd) to = lineEnd;
		if (to <= from) {
			if (from >= doc.length && from > 0) from -= 1;
			to = Math.min(doc.length, from + 1);
		}
		const severity = isDiagnosticError(item.code) ? 'error' : 'warning';
		return {
			from,
			to,
			severity,
			message: item.message
		};
	});
}
