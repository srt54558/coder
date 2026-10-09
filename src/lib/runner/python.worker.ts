/// <reference lib="webworker" />

import { clipText } from './limits';
import { presentPythonError } from './python-error';
import {
	PYTHON_INPUT_HEADER_BYTES,
	PYTHON_INPUT_MAX_BYTES,
	type PythonWorkerMessage
} from './protocol';
import { PYODIDE_BASE } from './pyodide-runtime';
import { diffProjectFiles, isSafeProjectPath } from './project-files';

interface PyodideRuntime {
	loadPackagesFromImports(code: string): Promise<void>;
	runPython(code: string): unknown;
	runPythonAsync(
		code: string,
		options?: { globals?: unknown; filename?: string }
	): Promise<unknown>;
	setStdout(options: { batched: (text: string) => void }): void;
	setStderr(options: { batched: (text: string) => void }): void;
	setStdin(options: { stdin: () => string; isatty?: boolean }): void;
	globals: PyGlobals;
}

interface PyGlobals {
	get(name: string): (...args: unknown[]) => PyProxy;
	set(name: string, value: unknown): void;
}

interface PyProxy {
	set(key: string, value: unknown): void;
	destroy(): void;
}

type LoadPyodide = (options: { indexURL: string }) => Promise<PyodideRuntime>;

function send(message: PythonWorkerMessage) {
	self.postMessage(message);
}

send({ type: 'status', status: 'loading' });

const runtimePromise = (async () => {
	const pyodideModule = (await import(/* @vite-ignore */ `${PYODIDE_BASE}pyodide.mjs`)) as {
		loadPyodide: LoadPyodide;
	};
	const runtime = await pyodideModule.loadPyodide({ indexURL: PYODIDE_BASE });
	const version = String(runtime.runPython('import sys; sys.version.split()[0]'));
	send({ type: 'status', status: 'ready', version });
	return runtime;
})().catch((error: unknown) => {
	send({ type: 'fatal', error: error instanceof Error ? error.message : String(error) });
	throw error;
});

const MOUNT_PROJECT = `
import json, os, sys
root = "/workspace"
os.makedirs(root, exist_ok=True)
writes = json.loads(__project_writes)
deletes = json.loads(__project_deletes)
for path in deletes:
    full = os.path.join(root, *str(path).split("/"))
    if os.path.isfile(full):
        os.remove(full)
for path, content in writes.items():
    parts = str(path).split("/")
    if not parts or any(part in ("", ".", "..") for part in parts):
        continue
    folder = root
    for part in parts[:-1]:
        folder = os.path.join(folder, part)
        os.makedirs(folder, exist_ok=True)
    with open(os.path.join(root, *parts), "w", encoding="utf-8") as handle:
        handle.write(content)
entry = str(__project_entry or "")
script_dir = os.path.dirname(os.path.join(root, entry)) or root
if not os.path.isdir(script_dir):
    script_dir = root
os.chdir(script_dir)
sys.path[:] = [item for item in sys.path if not (isinstance(item, str) and (item == root or item.startswith(root + "/")))]
sys.path.insert(0, script_dir)
for name in list(sys.modules):
    module = sys.modules.get(name)
    module_file = getattr(module, "__file__", None)
    if isinstance(module_file, str) and (module_file == root or module_file.startswith(root + "/")):
        del sys.modules[name]
del __project_writes
del __project_deletes
del __project_entry
`;

const mounted = new Map<string, string>();
let activeOutputLine: number | undefined;

self.onmessage = async (
	event: MessageEvent<{
		type: 'run';
		id: number;
		code: string;
		filename?: string;
		files?: { path: string; content: string }[];
		traceOutput?: boolean;
	}>
) => {
	if (event.data.type !== 'run') return;

	const { id, code, filename = '', files = [], traceOutput = false } = event.data;
	const startedAt = performance.now();
	let stdout = '';
	let stderr = '';
	let globals: PyProxy | undefined;

	try {
		const runtime = await runtimePromise;
		send({ type: 'status', status: 'running' });
		runtime.setStdout({
			batched: (text) => {
				const chunk = `${text}\n`;
				stdout = clipText(stdout + chunk);
				send({
					type: 'output',
					id,
					stream: 'stdout',
					text: chunk,
					...(activeOutputLine === undefined ? {} : { line: activeOutputLine })
				});
			}
		});
		runtime.setStderr({
			batched: (text) => {
				const chunk = `${text}\n`;
				stderr = clipText(stderr + chunk);
				send({ type: 'output', id, stream: 'stderr', text: chunk });
			}
		});
		runtime.setStdin({
			isatty: true,
			stdin: () => {
				if (typeof SharedArrayBuffer === 'undefined') {
					throw new Error('Interaktive Eingabe ist in diesem Browser nicht verfügbar.');
				}
				const buffer = new SharedArrayBuffer(PYTHON_INPUT_HEADER_BYTES + PYTHON_INPUT_MAX_BYTES);
				const header = new Int32Array(buffer, 0, 2);
				send({ type: 'input', id, buffer });
				Atomics.wait(header, 0, 0);
				const length = Atomics.load(header, 1);
				return new TextDecoder().decode(
					new Uint8Array(buffer, PYTHON_INPUT_HEADER_BYTES, length).slice()
				);
			}
		});
		await runtime.loadPackagesFromImports(code);
		const next = Object.fromEntries(
			files.filter((file) => isSafeProjectPath(file.path)).map((file) => [file.path, file.content])
		);
		const { writes, deletes } = diffProjectFiles(mounted, next);
		mounted.clear();
		for (const [path, content] of Object.entries(next)) mounted.set(path, content);
		runtime.globals.set('__project_writes', JSON.stringify(writes));
		runtime.globals.set('__project_deletes', JSON.stringify(deletes));
		runtime.globals.set('__project_entry', filename);
		await runtime.runPythonAsync(MOUNT_PROJECT);

		const makeDict = runtime.globals.get('dict');
		globals = makeDict();
		globals.set('__name__', '__main__');
		if (filename && isSafeProjectPath(filename)) globals.set('__file__', `/workspace/${filename}`);
		globals.set('__kplus_emit_input_prompt', (prompt: string) => {
			if (!prompt) return;
			stdout = clipText(stdout + prompt);
			send({ type: 'output', id, stream: 'stdout', text: prompt });
		});
		await runtime.runPythonAsync(
			`import builtins as __kplus_builtins
def input(prompt=''):
    if prompt is not None:
        __kplus_emit_input_prompt(str(prompt))
    return __kplus_builtins.input()
`,
			{ globals }
		);
		if (traceOutput) {
			globals.set('_kplus_source', code);
			globals.set('_kplus_filename', filename ? `/workspace/${filename}` : '<exec>');
			globals.set('_kplus_enter_output_line', (line: number) => {
				const previous = activeOutputLine;
				activeOutputLine = line;
				return previous ?? 0;
			});
			globals.set('_kplus_leave_output_line', (previous: number) => {
				activeOutputLine = previous || undefined;
			});
			await runtime.runPythonAsync(
				`import ast as _kplus_ast
class _KplusPrintTrace(_kplus_ast.NodeTransformer):
    def visit_Call(self, node):
        node = self.generic_visit(node)
        if isinstance(node.func, _kplus_ast.Name) and node.func.id == 'print':
            return _kplus_ast.copy_location(_kplus_ast.Call(
                func=_kplus_ast.Name(id='_kplus_traced_print', ctx=_kplus_ast.Load()),
                args=[_kplus_ast.Constant(node.lineno), node.func, *node.args],
                keywords=node.keywords,
            ), node)
        return node

def _kplus_traced_print(line, printer, *args, **kwargs):
    previous = _kplus_enter_output_line(line)
    try:
        return printer(*args, **kwargs)
    finally:
        _kplus_leave_output_line(previous)

_kplus_tree = _kplus_ast.parse(_kplus_source, filename=_kplus_filename, mode='exec')
_kplus_tree = _KplusPrintTrace().visit(_kplus_tree)
_kplus_ast.fix_missing_locations(_kplus_tree)
exec(compile(_kplus_tree, _kplus_filename, 'exec'), globals())
`,
				{ globals }
			);
		} else {
			await runtime.runPythonAsync(code, filename ? { globals, filename } : { globals });
		}

		send({
			type: 'result',
			id,
			stdout: stdout.trimEnd(),
			stderr: stderr.trimEnd(),
			durationMs: performance.now() - startedAt
		});
	} catch (error: unknown) {
		send({
			type: 'error',
			id,
			error: presentPythonError(error instanceof Error ? error.message : String(error), filename),
			durationMs: performance.now() - startedAt
		});
	} finally {
		activeOutputLine = undefined;
		globals?.destroy();
		send({ type: 'status', status: 'ready' });
	}
};

export {};
