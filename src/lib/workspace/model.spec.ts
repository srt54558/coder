import { describe, expect, it } from 'vitest';
import {
	applyWelcomeChoice,
	contentSignature,
	createFile,
	createFolder,
	createInitialWorkspace,
	closeFile,
	deleteFile,
	deleteFolder,
	folderPath,
	folderRows,
	hasUnsavedChanges,
	importFiles,
	isHtmlFile,
	isPythonFile,
	moveFileToFolder,
	newFileNameError,
	normalizeFileName,
	projectFilePath,
	renameFile,
	ROOT_FOLDER_ID,
	sanitizeWorkspace,
	structureSignature,
	uniqueName,
	updateFileContent
} from './model';

describe('workspace model', () => {
	it('normalizes paths and creates unique file names', () => {
		expect(normalizeFileName('  src/test.py ')).toBe('src-test.py');
		expect(uniqueName(['test.py', 'test (2).py'], 'test.py')).toBe('test (3).py');
		expect(uniqueName(['Main.py'], 'main.py')).toBe('main (2).py');
		expect(isPythonFile('MAIN.PY')).toBe(true);
		expect(isHtmlFile('Seite.HTML')).toBe(true);
		expect(isHtmlFile('seite.htm')).toBe(true);
		expect(isHtmlFile('main.py')).toBe(false);
	});

	it('builds a stable folder path without looping through malformed parents', () => {
		expect(
			folderPath(
				[
					{ id: 'root', name: 'Projekt', parentId: null },
					{ id: 'src', name: 'src', parentId: 'root' }
				],
				'src'
			)
		).toBe('Projekt/src');
	});

	it('keeps the opening file empty until the welcome choice', () => {
		const initial = createInitialWorkspace();
		expect(initial.welcomed).toBe(false);
		expect(initial.files[0]?.content).toBe('');
		const ready = applyWelcomeChoice(initial, 'html');
		expect(ready.welcomed).toBe(true);
		expect(ready.files).toHaveLength(1);
		expect(ready.files[0]?.name).toBe('seite.html');
		expect(ready.files[0]?.content).toContain('<h1>Hallo</h1>');
		const manual = createFile(ready, ROOT_FOLDER_ID, 'andere.html');
		expect(manual.files.find((file) => file.name === 'andere.html')?.content).toBe('');
		const kept = applyWelcomeChoice(
			{ ...initial, files: [{ ...initial.files[0], content: 'schon da' }] },
			'python'
		);
		expect(kept.files[0]?.content).toBe('schon da');
		expect(kept.welcomed).toBe(true);
	});

	it('treats a saved workspace without the flag as already welcomed', () => {
		const saved = createInitialWorkspace('print(1)');
		const stored = { ...saved, welcomed: undefined } as unknown as typeof saved;
		expect(sanitizeWorkspace(stored).welcomed).toBe(true);
		expect(sanitizeWorkspace({ ...saved, welcomed: false }).welcomed).toBe(false);
	});

	it('allows closing the last editor tab without deleting the file', () => {
		const initial = createInitialWorkspace('print(1)');
		const closed = closeFile(initial, initial.files[0].id);
		expect(closed.files).toHaveLength(1);
		expect(closed.openFileIds).toEqual([]);
		expect(closed.activeFileId).toBe('');
		const withExtra = createFile(initial, ROOT_FOLDER_ID, 'zwei.py');
		const second = withExtra.files.find((file) => file.name === 'zwei.py');
		expect(closeFile(withExtra, second?.id ?? '').openFileIds).toEqual([initial.files[0].id]);
		expect(sanitizeWorkspace({ ...closed, openFileIds: [], activeFileId: '' }).openFileIds).toEqual(
			[]
		);
	});

	it('keeps folders on the left model and files inside the selected folder', () => {
		const initial = createInitialWorkspace('print(1)');
		const withFolder = createFolder(initial, ROOT_FOLDER_ID, 'src');
		const folder = withFolder.folders.find((item) => item.name === 'src');
		expect(folderRows(withFolder.folders).map((row) => `${row.depth}:${row.folder.name}`)).toEqual([
			'0:Projekt',
			'1:src'
		]);
		const withFile = createFile(withFolder, folder?.id ?? '', 'hi.py');
		expect(withFile.files.find((file) => file.name === 'hi.py')?.folderId).toBe(folder?.id);
		expect(withFile.activeFileId).toBe(withFile.files.find((file) => file.name === 'hi.py')?.id);
		expect(
			createFile(initial, ROOT_FOLDER_ID, 'main.py')
				.files.map((file) => file.name)
				.sort()
		).toEqual(['main (2).py', 'main.py']);
		const beside = createFolder(initial, null, 'Übungen');
		expect(folderRows(beside.folders).map((row) => `${row.depth}:${row.folder.name}`)).toEqual([
			'0:Projekt',
			'0:Übungen'
		]);
		const extra = beside.folders.find((item) => item.name === 'Übungen');
		const extraFile = createFile(beside, extra?.id ?? '', 'aufgabe.py', 'print(2)');
		const aufgabe = extraFile.files.find((file) => file.name === 'aufgabe.py');
		expect(aufgabe ? projectFilePath(extraFile, aufgabe) : '').toBe('Übungen/aufgabe.py');
		expect(createFolder(initial, 'missing', 'src')).toBe(initial);
		const moved = moveFileToFolder(
			withFile,
			withFile.files.find((file) => file.name === 'hi.py')?.id ?? '',
			ROOT_FOLDER_ID
		);
		expect(moved.files.find((file) => file.name === 'hi.py')?.folderId).toBe(ROOT_FOLDER_ID);
	});

	it('refuses to delete the root folder or the last file and tracks unsaved edits', () => {
		const initial = createInitialWorkspace('print(1)');
		expect(deleteFolder(initial, ROOT_FOLDER_ID)).toBe(initial);
		expect(deleteFile(initial, initial.files[0].id)).toBe(initial);
		const saved = contentSignature(initial);
		const edited = updateFileContent(initial, initial.files[0].id, 'print(2)');
		expect(hasUnsavedChanges(edited, saved)).toBe(true);
		expect(hasUnsavedChanges(initial, saved)).toBe(false);
		const contents = Object.fromEntries(initial.files.map((file) => [file.id, file.content]));
		const structure = structureSignature(initial);
		expect(hasUnsavedChanges(edited, structure, contents)).toBe(true);
		expect(hasUnsavedChanges(initial, structure, contents)).toBe(false);
		expect(updateFileContent(initial, initial.files[0].id, 'print(1)')).toBe(initial);
	});

	it('imports files into the selected folder and keeps both copies when names collide', () => {
		const initial = createInitialWorkspace('print(1)');
		const next = importFiles(initial, ROOT_FOLDER_ID, [
			{ name: 'hi.py', content: 'print(2)' },
			{ name: 'hi.py', content: 'print(3)' }
		]);
		expect(next.files.map((file) => file.name).sort()).toEqual(['hi (2).py', 'hi.py', 'main.py']);
		expect(next.files.find((file) => file.name === 'hi.py')?.content).toBe('print(2)');
		expect(next.files.find((file) => file.name === 'hi (2).py')?.content).toBe('print(3)');
		expect(next.activeFileId).toBe(next.files.find((file) => file.name === 'hi (2).py')?.id);
		expect(importFiles(initial, 'missing', [{ name: 'a.py', content: '' }])).toBe(initial);
	});

	it('requires a supported extension and keeps project paths relative to the root', () => {
		const initial = createInitialWorkspace('print(1)');
		expect(newFileNameError('seite')).toBe('Der Name braucht eine Endung.');
		expect(newFileNameError('seite.exe')).toBe('Dieses Format wird nicht unterstützt.');
		expect(newFileNameError('seite.html')).toBeNull();
		expect(newFileNameError('MAIN.PY')).toBeNull();
		expect(createFile(initial, ROOT_FOLDER_ID, 'ohne')).toBe(initial);
		expect(createFile(initial, ROOT_FOLDER_ID, 'bild.png')).toBe(initial);
		expect(renameFile(initial, initial.files[0].id, 'seite.exe')).toBe(initial);
		const withText = createFile(initial, ROOT_FOLDER_ID, 'notiz.txt', 'hallo');
		expect(withText.files.find((file) => file.name === 'notiz.txt')?.content).toBe('hallo');
		const imported = importFiles(initial, ROOT_FOLDER_ID, [
			{ name: 'ok.txt', content: 'hallo' },
			{ name: 'bild.png', content: 'nein' }
		]);
		expect(imported.files.map((file) => file.name).sort()).toEqual(['main.py', 'ok.txt']);
		const withFolder = createFolder(initial, ROOT_FOLDER_ID, 'css');
		const folder = withFolder.folders.find((item) => item.name === 'css');
		const withStyle = createFile(withFolder, folder?.id ?? '', 'style.css', 'h1{}');
		const style = withStyle.files.find((file) => file.name === 'style.css');
		const main = withStyle.files.find((file) => file.name === 'main.py');
		expect(style ? projectFilePath(withStyle, style) : '').toBe('css/style.css');
		expect(main ? projectFilePath(withStyle, main) : '').toBe('main.py');
	});
});
