import type { RuffDiagnostic } from '#lib/runner/protocol.js';

export function lineExcerpt(
	doc: string,
	diagnostic: Pick<RuffDiagnostic, 'start_location' | 'end_location'>
): { line: string; mark: string } {
	const lines = doc.split('\n');
	const row = Math.min(Math.max(diagnostic.start_location.row, 1), Math.max(lines.length, 1));
	const line = lines[row - 1] ?? '';
	if (diagnostic.end_location.row !== diagnostic.start_location.row) return { line, mark: '' };
	const start = Math.max(0, Math.min(line.length, diagnostic.start_location.column - 1));
	const end = Math.max(start + 1, Math.min(line.length, diagnostic.end_location.column - 1));
	const width = Math.max(1, end - start);
	return { line, mark: `${' '.repeat(start)}${'^'.repeat(width)}` };
}
