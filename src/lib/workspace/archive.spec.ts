import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseWorkspaceArchive, WORKSPACE_ARCHIVE_NAME, workspaceExport } from './archive';
import {
	createFile,
	createFolder,
	createInitialWorkspace,
	ROOT_FOLDER_ID,
	updateFileContent
} from './model';

const python = spawnSync('python3', ['--version'], { encoding: 'utf8' });
const hasPython = python.status === 0;

function sampleWorkspace() {
	let snapshot = createInitialWorkspace('print("Grüße")');
	snapshot = createFolder(snapshot, ROOT_FOLDER_ID, 'src');
	snapshot = createFolder(snapshot, ROOT_FOLDER_ID, 'leer');
	const src = snapshot.folders.find((folder) => folder.name === 'src');
	snapshot = createFile(snapshot, src?.id ?? '', 'hallo.py');
	const hallo = snapshot.files.find((file) => file.name === 'hallo.py');
	snapshot = updateFileContent(snapshot, hallo?.id ?? '', 'print(1)\n');
	snapshot = createFile(snapshot, ROOT_FOLDER_ID, 'escape.py');
	snapshot = {
		...snapshot,
		files: snapshot.files.map((file) =>
			file.name === 'escape.py' ? { ...file, name: '../escape.py' } : file
		)
	};
	snapshot = createFile(snapshot, ROOT_FOLDER_ID, WORKSPACE_ARCHIVE_NAME);
	const marked = snapshot.files.find((file) => file.name === 'main.py');
	return updateFileContent(
		snapshot,
		marked?.id ?? '',
		'print("Grüße")\n# BEGIN KPLUS_WORKSPACE_V1\n'
	);
}

describe('workspace archive', () => {
	it('round-trips the workspace through a compressed python file', async () => {
		const snapshot = sampleWorkspace();
		const exported = await workspaceExport(snapshot);
		expect(exported.startsWith('#!/usr/bin/env python3\n')).toBe(true);
		expect(exported).toContain('import gzip');
		expect(await parseWorkspaceArchive(exported)).toEqual(snapshot);
		expect(await parseWorkspaceArchive('print("hi")\n')).toBeNull();
		expect(
			await parseWorkspaceArchive(exported.replaceAll('# END KPLUS_WORKSPACE_V1', '# END OTHER'))
		).toBeNull();
	});

	it('still reads an uncompressed archive from an older download', async () => {
		const snapshot = createInitialWorkspace('print("alt")');
		const encoded = Buffer.from(
			JSON.stringify({ application: 'python.k-plus.one', workspace: snapshot }),
			'utf8'
		).toString('base64');
		const source = `# BEGIN KPLUS_WORKSPACE_V1\n# ${encoded}\n# END KPLUS_WORKSPACE_V1\n`;
		expect(await parseWorkspaceArchive(source)).toEqual(snapshot);
	});

	it.skipIf(!hasPython)('writes the project beside the script only after y', async () => {
		const root = mkdtempSync(join(tmpdir(), 'kplus-archive-'));
		try {
			const script = join(root, WORKSPACE_ARCHIVE_NAME);
			writeFileSync(script, await workspaceExport(sampleWorkspace()));
			writeFileSync(join(root, 'keep.txt'), 'bleiben');
			const compiled = spawnSync('python3', ['-m', 'py_compile', script], { encoding: 'utf8' });
			expect(compiled.status, compiled.stderr).toBe(0);

			const quiet = spawnSync('python3', [script], { encoding: 'utf8' });
			expect(quiet.status).toBe(0);
			expect(quiet.stdout).toContain('Im Terminal ausführen und mit y bestätigen.');
			expect(existsSync(join(root, 'main.py'))).toBe(false);

			const declined = runOnTerminal(script, 'n\n');
			expect(declined.status, declined.output).toBe(0);
			expect(declined.output).toContain('Abgebrochen.');
			expect(existsSync(join(root, 'main.py'))).toBe(false);

			const accepted = runOnTerminal(script, 'y\n');
			expect(accepted.status, accepted.output).toBe(0);
			expect(accepted.output).toContain('Mit y anlegen:');
			expect(readFileSync(join(root, 'main.py'), 'utf8')).toBe(
				'print("Grüße")\n# BEGIN KPLUS_WORKSPACE_V1\n'
			);
			expect(readFileSync(join(root, 'src', 'hallo.py'), 'utf8')).toBe('print(1)\n');
			expect(existsSync(join(root, 'leer'))).toBe(true);
			expect(existsSync(join(root, 'Projekt'))).toBe(false);
			expect(existsSync(join(root, 'escape.py'))).toBe(false);
			expect(existsSync(join(tmpdir(), 'escape.py'))).toBe(false);
			expect(readFileSync(join(root, 'keep.txt'), 'utf8')).toBe('bleiben');
			expect(readFileSync(script, 'utf8')).toContain('# END KPLUS_WORKSPACE_V1');
			expect(accepted.output).toContain('Übersprungen:');
		} finally {
			rmSync(root, { recursive: true, force: true });
			rmSync(join(tmpdir(), 'escape.py'), { force: true });
		}
	});
});

function runOnTerminal(script: string, key: string): { status: number; output: string } {
	const result = spawnSync('python3', ['-c', TERMINAL_DRIVER, script, key], { encoding: 'utf8' });
	return { status: result.status ?? 1, output: `${result.stdout}${result.stderr}` };
}

const TERMINAL_DRIVER = `
import os, select, sys
script, key = sys.argv[1], sys.argv[2].encode()
master, slave = os.openpty()
pid = os.fork()
if pid == 0:
    os.setsid()
    os.dup2(slave, 0)
    os.dup2(slave, 1)
    os.dup2(slave, 2)
    os.close(master)
    os.execvp("python3", ["python3", script])
os.close(slave)
output = b""
while b"Mit y anlegen:" not in output:
    ready, _, _ = select.select([master], [], [], 5)
    if not ready:
        sys.stderr.buffer.write(output)
        raise SystemExit(2)
    chunk = os.read(master, 4096)
    if not chunk:
        break
    output += chunk
os.write(master, key)
while True:
    ready, _, _ = select.select([master], [], [], 5)
    if not ready:
        break
    try:
        chunk = os.read(master, 4096)
    except OSError:
        break
    if not chunk:
        break
    output += chunk
_, status = os.waitpid(pid, 0)
sys.stdout.buffer.write(output)
raise SystemExit(os.waitstatus_to_exitcode(status))
`;
