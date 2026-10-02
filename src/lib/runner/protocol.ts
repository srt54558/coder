export type RunnerStatus = 'loading' | 'ready' | 'running' | 'error';

export const PYTHON_INPUT_MAX_BYTES = 64 * 1024;
export const PYTHON_INPUT_HEADER_BYTES = Int32Array.BYTES_PER_ELEMENT * 2;

export type PythonWorkerMessage =
	| { type: 'status'; status: RunnerStatus; version?: string }
	| { type: 'output'; id: number; stream: 'stdout' | 'stderr'; text: string }
	| { type: 'input'; id: number; buffer: SharedArrayBuffer }
	| { type: 'result'; id: number; stdout: string; stderr: string; durationMs: number }
	| { type: 'error'; id: number; error: string; durationMs: number }
	| { type: 'fatal'; error: string };

export interface RuffDiagnostic {
	code: string | null;
	message: string;
	start_location: { row: number; column: number };
	end_location: { row: number; column: number };
}

/** Syntax and language errors. Other codes stay warnings, matching Ruff's F-rules. */
export function isDiagnosticError(code: string | null): boolean {
	if (!code || code.startsWith('E9') || code === 'Syntax') return true;
	return (
		code === 'JS' ||
		code === 'CSS' ||
		code === 'HTML' ||
		code === 'JSON' ||
		code === 'XML' ||
		code === 'MD'
	);
}

export type RuffWorkerMessage =
	| { type: 'ready'; version: string }
	| { type: 'diagnostics'; id: number; diagnostics: RuffDiagnostic[] }
	| { type: 'error'; id: number; error: string };
