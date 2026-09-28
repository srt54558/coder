import { expect, test, type Page } from '@playwright/test';
import { encodeCode, IMPORT_PARAM } from '../src/lib/runner/share';

const LABELS: Record<string, string> = {
	py: 'Python-Code',
	html: 'HTML-Code',
	htm: 'HTML-Code',
	js: 'JavaScript-Code',
	css: 'CSS-Code',
	json: 'JSON-Code',
	xml: 'XML-Code',
	md: 'Markdown',
	txt: 'Text'
};

test.beforeEach(async ({ page }) => {
	page.on('dialog', (dialog) => void dialog.accept());
});

async function finishWelcome(page: Page, language?: string) {
	const dialog = page.getByRole('dialog', { name: 'Willkommen' });
	await expect(dialog).toBeVisible();
	if (language) await dialog.getByRole('radio', { name: language, exact: true }).check();
	await dialog.getByRole('button', { name: 'Loslegen' }).click();
	await expect(dialog).toBeHidden();
}

async function openCoder(page: Page) {
	await page.goto('/');
	await expect(page).toHaveTitle('K+ Coder');
	await finishWelcome(page);
	await expect(page.getByRole('tab', { name: 'main.py' })).toBeVisible();
	await expect(page.locator('.cm-content')).toBeVisible();
}

async function createFile(page: Page, name: string) {
	await page.getByRole('button', { name: 'Neue Datei' }).click();
	const dialog = page.getByRole('dialog', { name: 'Neue Datei' });
	await expect(dialog).toBeVisible();
	await dialog.getByRole('textbox', { name: 'Name' }).fill(name);
	await dialog.getByRole('button', { name: 'Anlegen' }).click();
	await expect(dialog).toBeHidden();
	const extension = name.split('.').pop() ?? '';
	await expect(page.locator('.cm-content')).toHaveAttribute(
		'aria-label',
		LABELS[extension] ?? 'Text'
	);
}

async function setEditor(page: Page, text: string) {
	const editor = page.locator('.cm-content');
	const lines = text.split('\n');
	await editor.click();
	await page.evaluate((value) => {
		const el = document.querySelector('.cm-content');
		if (!(el instanceof HTMLElement)) throw new Error('Kein Editor');
		el.focus();
		const selection = document.getSelection();
		if (!selection) throw new Error('Keine Auswahl');
		const range = document.createRange();
		range.selectNodeContents(el);
		selection.removeAllRanges();
		selection.addRange(range);
		if (!value) document.execCommand('delete');
		else document.execCommand('insertText', false, value);
	}, lines[0] ?? '');
	if (lines[0]) await expect(editor).toContainText(lines[0].slice(0, 40));
	for (let index = 1; index < lines.length; index += 1) {
		await page.keyboard.press('Enter');
		if (lines[index]) await page.keyboard.insertText(lines[index]);
	}
	await expect(page.locator('.cm-line')).toHaveCount(lines.length);
}

async function refreshPreview(page: Page) {
	await page.getByRole('button', { name: 'Vorschau neu laden' }).click();
}

async function showProblems(page: Page) {
	const toggle = page.getByRole('button', { name: /^Probleme/u });
	if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
	await expect(toggle).toHaveAttribute('aria-pressed', 'true');
}

async function expectBubble(page: Page, text: RegExp) {
	await expect(
		page.locator('.cm-diagnostic, .cm-diagnostic-message').filter({ hasText: text }).first()
	).toBeVisible();
}

async function expectCompletion(page: Page, name: RegExp) {
	const list = page.getByRole('listbox', { name: 'Completions' });
	try {
		await expect(list).toBeVisible({ timeout: 2_000 });
	} catch {
		await page.keyboard.press('Control+Space');
		await expect(list).toBeVisible();
	}
	await expect(list.getByRole('option', { name }).first()).toBeVisible();
}

test('welcome chooses the design and writes example code only into the first file', async ({
	page
}) => {
	await page.goto('/');
	const dialog = page.getByRole('dialog', { name: 'Willkommen' });
	await expect(dialog).toBeVisible();
	await dialog.getByRole('button', { name: 'Rosa' }).click();
	await dialog.getByRole('radio', { name: 'HTML', exact: true }).check();
	await dialog.getByRole('button', { name: 'Loslegen' }).click();
	await expect(dialog).toBeHidden();
	await expect(page.locator('html')).toHaveClass(/theme-pink/);
	await expect(page.getByRole('tab', { name: 'seite.html' })).toBeVisible();
	await expect(page.locator('.cm-content')).toContainText('Hallo');

	await createFile(page, 'leer.html');
	await expect(page.locator('.cm-content')).toHaveText('');
});

test('shows dependency versions and does not mark a valid html file', async ({ page }) => {
	await page.goto('/');
	const welcome = page.getByRole('dialog', { name: 'Willkommen' });
	await welcome.getByRole('radio', { name: 'HTML', exact: true }).check();
	await welcome.getByRole('button', { name: 'Loslegen' }).click();
	await expect(welcome).toBeHidden();
	await expect(page.getByRole('tab', { name: 'seite.html' })).toBeVisible();

	await page.getByRole('button', { name: 'Einstellungen' }).click();
	await page.getByRole('button', { name: 'Versionen' }).click();
	const versions = page.getByRole('dialog', { name: 'Versionen' });
	await expect(versions.getByText('Python', { exact: true })).toBeVisible();
	await expect(versions.getByText('pyodide')).toHaveCount(0);
	await expect(versions.getByText('svelte')).toHaveCount(0);
	await expect(versions.getByRole('heading', { name: 'Abhängigkeiten' })).toHaveCount(0);
	await expect(versions.getByRole('heading', { name: 'Entwicklung' })).toHaveCount(0);
	await page.keyboard.press('Escape');
	await expect(versions).toBeHidden();
	await expect(page.locator('.toolbar')).not.toContainText(/Python \d/u);

	await page.reload();
	await expect(page.locator('.cm-content')).toContainText('<!DOCTYPE html>');
	await page.waitForTimeout(3000);
	await expect(page.locator('.cm-lint-marker')).toHaveCount(0);

	await setEditor(page, '<div>\n<p>Hallo</p>\n');
	await expect(page.locator('.cm-lint-marker')).toHaveCount(1);
	await expect(page.locator('.cm-lintRange-error')).toHaveText('<div');
});

test('opens the docs routes as a popup on the editor', async ({ page }) => {
	await page.goto('/docs');
	await finishWelcome(page);
	for (const path of ['/docs', '/docs/web', '/docs/python']) {
		if (path !== '/docs') await page.goto(path);
		const docs = page.getByRole('dialog', { name: 'Doku' });
		await expect(docs).toBeVisible();
		await expect(page).toHaveURL(/\/$/u);
		await expect(docs.getByRole('heading', { name: 'Ausgabe' })).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(docs).toBeHidden();
	}
});

test('names the product K+ Coder and checks new file names', async ({ page }) => {
	await openCoder(page);
	await page.getByRole('button', { name: 'Doku' }).click();
	const docs = page.getByRole('dialog', { name: 'Doku' });
	await expect(docs).toBeVisible();
	await expect(page).not.toHaveURL(/\/docs/u);
	await expect(docs.getByRole('heading', { name: 'Ausgabe' })).toBeVisible();
	await expect(docs.getByRole('button', { name: 'Themen' })).toHaveCount(0);
	await docs
		.getByRole('navigation', { name: 'Inhalt' })
		.getByRole('button', { name: 'Kommentare' })
		.click();
	await expect(page).toHaveURL(/\/$/u);
	await page.keyboard.press('Escape');
	await expect(docs).toBeHidden();
	await expect(page.getByRole('tab', { name: 'main.py' })).toBeVisible();

	await page.getByRole('button', { name: 'Neue Datei' }).click();
	const dialog = page.getByRole('dialog', { name: 'Neue Datei' });
	await dialog.getByRole('button', { name: 'Anlegen' }).click();
	await expect(dialog.getByRole('alert')).toHaveText('Gib einen Namen ein.');
	await dialog.getByRole('textbox', { name: 'Name' }).fill('seite');
	await dialog.getByRole('button', { name: 'Anlegen' }).click();
	await expect(dialog.getByRole('alert')).toHaveText('Der Name braucht eine Endung.');
	await dialog.getByRole('textbox', { name: 'Name' }).fill('bild.png');
	await dialog.getByRole('button', { name: 'Anlegen' }).click();
	await expect(dialog.getByRole('alert')).toHaveText('Dieses Format wird nicht unterstützt.');
	await dialog.getByRole('button', { name: 'Abbrechen' }).click();
	await expect(dialog).toBeHidden();
});

test('lints script and style in html, jumps to the problem, and links the preview error', async ({
	page
}) => {
	await openCoder(page);
	await createFile(page, 'seite.html');
	await setEditor(
		page,
		`<h1>Hallo</h1>
<script>
console.log(missing);
</script>
<style>
h1 { colour: red; }
</style>`
	);

	await showProblems(page);
	await expect(page.getByRole('button', { name: /Zeile 3/u })).toContainText('nicht definiert');
	await expect(page.getByRole('button', { name: /Zeile 6/u })).toContainText('colour');
	await page.getByRole('button', { name: /Unbekannte CSS-Eigenschaft/u }).click();
	await expectBubble(page, /colour/u);

	await refreshPreview(page);
	await page.getByRole('button', { name: 'Konsole einblenden' }).click();
	await expect(page.locator('.console-err-text')).toContainText(/missing/u);
	await page.getByRole('button', { name: 'Wo?' }).click();
	await expectBubble(page, /nicht definiert/u);
});

test('completes and lints javascript, css, json, xml, markdown, and text', async ({ page }) => {
	await openCoder(page);

	await createFile(page, 'seite.html');
	await setEditor(page, '');
	await page.locator('.cm-content').click();
	await page.keyboard.type('p');
	const completions = page.getByRole('listbox', { name: 'Completions' });
	await expect(completions).toBeVisible();
	await completions.getByRole('option', { name: '<p></p>' }).click();
	await expect(page.locator('.cm-content')).toContainText('<p></p>');
	await setEditor(page, '<');
	await page.locator('.cm-content').click();
	await page.keyboard.type('di');
	await expectCompletion(page, /^div\b/u);

	await createFile(page, 'app.js');
	await setEditor(page, 'const quiet = 1;\nconsole.log(missing);\n');
	await showProblems(page);
	await expect(page.getByRole('button', { name: /nicht definiert/u })).toBeVisible();
	await expect(page.getByRole('button', { name: /nicht verwendet/u })).toBeVisible();
	await page.getByRole('button', { name: /nicht definiert/u }).click();
	await expectBubble(page, /missing/u);
	await setEditor(page, '');
	await page.locator('.cm-content').click();
	await page.keyboard.type('cons');
	await expectCompletion(page, /^console\b/u);

	await createFile(page, 'style.css');
	await setEditor(page, 'h1 { colour: red; }');
	await showProblems(page);
	await expect(page.getByRole('button', { name: /Unbekannte CSS-Eigenschaft/u })).toBeVisible();
	await page.getByRole('button', { name: /^Probleme/u }).click();
	await setEditor(page, 'h1 { ');
	await page.keyboard.type('col');
	await expectCompletion(page, /^color\b/u);

	await createFile(page, 'daten.json');
	await setEditor(page, '{ "a": }');
	await showProblems(page);
	await expect(page.getByRole('button', { name: /JSON ist hier ungültig/u })).toBeVisible();
	await page.getByRole('button', { name: /^Probleme/u }).click();
	await setEditor(page, '');
	await page.keyboard.type('tru');
	await expectCompletion(page, /^true\b/u);

	await createFile(page, 'note.xml');
	await setEditor(page, '<a></b>');
	await showProblems(page);
	await expect(page.getByRole('button', { name: /passt nicht/u })).toBeVisible();
	await page.getByRole('button', { name: /^Probleme/u }).click();
	await setEditor(page, '<');
	await page.keyboard.type('it');
	await expectCompletion(page, /^item\b/u);

	await createFile(page, 'note.md');
	await setEditor(page, '```js\nconsole.log(1)\n');
	await showProblems(page);
	await expect(page.getByRole('button', { name: /Codeblock/u })).toBeVisible();

	await createFile(page, 'notiz.txt');
	await setEditor(page, 'nur text');
	await showProblems(page);
	await expect(page.getByText('Keine Probleme')).toBeVisible();
});

test('previews markdown and leaves json, xml, text, and css in the editor', async ({ page }) => {
	await openCoder(page);
	await createFile(page, 'notiz.md');
	await setEditor(page, '# Titel\n\nEin Satz.');
	await refreshPreview(page);
	const frame = page.frameLocator('iframe[title="Vorschau"]');
	await expect(frame.getByRole('heading', { name: 'Titel' })).toBeVisible();
	await expect(frame.getByText('Ein Satz.')).toBeVisible();
	await setEditor(page, '# Andere\n\nNeu.');
	await page.waitForTimeout(400);
	await expect(frame.getByRole('heading', { name: 'Titel' })).toBeVisible();
	await refreshPreview(page);
	await expect(frame.getByRole('heading', { name: 'Andere' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Vorschau neu laden' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Konsole einblenden' })).toHaveCount(0);

	for (const name of ['daten.json', 'daten.xml', 'notiz.txt', 'style.css']) {
		await createFile(page, name);
		await expect(page.locator('iframe[title="Vorschau"]')).toHaveCount(0);
		await expect(page.getByRole('heading', { name: 'Ausgabe' })).toHaveCount(0);
		await expect(page.getByRole('heading', { name: 'Vorschau' })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Ausführen' })).toBeDisabled();
	}
});

test('attributes a preview log to the script it came from', async ({ page }) => {
	await openCoder(page);
	await createFile(page, 'app.js');
	await setEditor(page, 'console.log("von-js");\nmissing();\n');
	await createFile(page, 'seite.html');
	await setEditor(page, '<h1>Seite</h1>\n<script src="app.js"></script>');
	await refreshPreview(page);
	await page.getByRole('button', { name: 'Konsole einblenden' }).click();
	await expect(page.locator('.console-out').filter({ hasText: 'von-js' })).toBeVisible();
	await expect(page.locator('.console-title').filter({ hasText: 'app.js:1' })).toBeVisible();
	await page
		.locator('.console-block')
		.filter({ hasText: 'missing' })
		.getByRole('button', { name: 'Wo?' })
		.click();
	await expect(page.getByRole('tab', { name: 'app.js', selected: true })).toBeVisible();
	await expect(page.locator('.cm-activeLine')).toContainText('missing');
});

test('runs a javascript file on its own', async ({ page }) => {
	await openCoder(page);
	await createFile(page, 'seite.html');
	await setEditor(page, '<h1>Seite</h1>\n<script src="app.js"></script>');
	await refreshPreview(page);
	await expect(
		page.frameLocator('iframe[title="Vorschau"]').getByRole('heading', { name: 'Seite' })
	).toBeVisible();

	await createFile(page, 'app.js');
	await setEditor(page, 'console.log("allein");');
	await expect(page.locator('iframe[title="Vorschau"]')).toHaveCount(0);
	await expect(page.getByRole('heading', { name: 'Ausgabe' })).toBeVisible();
	await page.getByRole('button', { name: 'Ausführen' }).click();
	await expect(page.locator('.console-out').last()).toContainText('allein');
});

test('explains each file type in the docs', async ({ page }) => {
	await openCoder(page);
	await createFile(page, 'seite.html');
	await createFile(page, 'style.css');
	await createFile(page, 'app.js');
	await createFile(page, 'daten.json');
	await createFile(page, 'note.xml');
	await createFile(page, 'note.md');
	await createFile(page, 'notiz.txt');

	const cases = [
		{ file: 'main.py', lesson: 'Ausgabe' },
		{ file: 'seite.html', lesson: 'Gerüst' },
		{ file: 'style.css', lesson: 'CSS-Datei' },
		{ file: 'app.js', lesson: 'JavaScript-Datei' },
		{ file: 'daten.json', lesson: 'Objekt' },
		{ file: 'note.xml', lesson: 'Element' },
		{ file: 'note.md', lesson: 'Überschrift' },
		{ file: 'notiz.txt', lesson: 'Nur Text' }
	];
	for (const item of cases) {
		await page.getByRole('tab', { name: item.file }).click();
		await page.getByRole('button', { name: 'Doku' }).click();
		const docs = page.getByRole('dialog', { name: 'Doku' });
		await expect(docs.getByRole('heading', { name: item.lesson, exact: true })).toBeVisible();
		await expect(docs.getByText('Wähle ein Thema.')).toHaveCount(0);
		await page.keyboard.press('Escape');
		await expect(docs).toBeHidden();
	}

	await page.getByRole('tab', { name: 'daten.json' }).click();
	await page.getByRole('button', { name: 'Doku' }).click();
	const docs = page.getByRole('dialog', { name: 'Doku' });
	await expect(docs.frameLocator('#json-objekt iframe').getByText('"name": "Ada"')).toBeVisible();
	await page.keyboard.press('Escape');
	await page.getByRole('tab', { name: 'note.md' }).click();
	await page.getByRole('button', { name: 'Doku' }).click();
	await expect(
		docs.frameLocator('#md-ueberschrift iframe').getByRole('heading', { name: 'Tagebuch' })
	).toBeVisible();
	await page.keyboard.press('Escape');
	await page.getByRole('tab', { name: 'notiz.txt' }).click();
	await page.getByRole('button', { name: 'Doku' }).click();
	await expect(
		docs.frameLocator('#txt-nur iframe').getByText('... es ist nur text :D')
	).toBeVisible();
	await docs
		.getByRole('navigation', { name: 'Inhalt' })
		.getByRole('button', { name: 'Nur Text' })
		.click();
	await expect(page).not.toHaveURL(/\/docs|#/u);
});

test('keeps each html file’s preview console separate', async ({ page }) => {
	await openCoder(page);
	await createFile(page, 'a.html');
	await setEditor(page, '<script>console.log("von-a")</script>');
	await refreshPreview(page);
	await page.getByRole('button', { name: 'Konsole einblenden' }).click();
	await expect(page.locator('.console-out').last()).toContainText('von-a');

	await createFile(page, 'b.html');
	await setEditor(page, '<script>console.log("von-b")</script>');
	await refreshPreview(page);
	await page.getByRole('button', { name: 'Konsole einblenden' }).click();
	await expect(page.locator('.console-out').last()).toContainText('von-b');
	await expect(page.locator('.console-log')).not.toContainText('von-a');

	await page.getByRole('tab', { name: 'a.html' }).click();
	await expect(page.locator('.console-out').last()).toContainText('von-a');
	await expect(page.locator('.console-log')).not.toContainText('von-b');
});

test('keeps each python file’s output separate', async ({ page }) => {
	test.setTimeout(120_000);
	await openCoder(page);
	await setEditor(page, 'print("eins")\n');
	const run = page.getByRole('button', { name: 'Ausführen' });
	await expect(run).toBeEnabled({ timeout: 90_000 });
	await run.click();
	await expect(page.locator('.console-out').last()).toContainText('eins', { timeout: 90_000 });

	await createFile(page, 'zweite.py');
	await setEditor(page, 'print("zwei")\n');
	await expect(run).toBeEnabled();
	await run.click();
	await expect(page.locator('.console-out').last()).toContainText('zwei');
	await expect(page.locator('.console-log')).not.toContainText('eins');

	await page.getByRole('tab', { name: 'main.py' }).click();
	await expect(page.locator('.console-out').last()).toContainText('eins');
	await expect(page.locator('.console-log')).not.toContainText('zwei');
	await page.getByRole('button', { name: 'Ausgabe löschen' }).click();
	await expect(page.getByText('Keine Ausgabe')).toBeVisible();

	await page.getByRole('tab', { name: 'zweite.py' }).click();
	await expect(page.locator('.console-out').last()).toContainText('zwei');
});

test('keeps python problems, the hover, and the console link', async ({ page }) => {
	test.setTimeout(120_000);
	await openCoder(page);
	await setEditor(page, 'print(missing)\n');
	await showProblems(page);
	await expect(page.locator('.problem-row').first()).toBeVisible({ timeout: 30_000 });
	await expect(page.locator('.problem-row').first()).not.toContainText(/F\d{3}/u);
	await page.locator('.problem-row').first().click();
	await expect(page.locator('.cm-tooltip').first()).toBeVisible();

	const run = page.getByRole('button', { name: 'Ausführen' });
	await expect(run).toBeEnabled({ timeout: 90_000 });
	await run.click();
	await expect(page.getByRole('button', { name: 'Wo?' })).toBeVisible({ timeout: 90_000 });
	await page.getByRole('button', { name: 'Wo?' }).click();
	await expect(page.locator('.cm-tooltip').first()).toBeVisible();
});

test('opens the matching docs section from a hover link', async ({ page }) => {
	await openCoder(page);
	await setEditor(page, 'def hallo():\n    return 1\n');
	await page.locator('.cm-line').first().getByText('def', { exact: true }).hover();
	const docsLink = page.locator('.cm-docs-link');
	await expect(docsLink).toBeVisible();
	await expect(docsLink).toHaveText('Doku');
	await docsLink.click();
	const docs = page.getByRole('dialog', { name: 'Doku' });
	await expect(docs).toBeVisible();
	await expect(docs.locator('#funktionen')).toHaveClass(/focused/);
	await expect(docs.getByRole('heading', { name: 'Funktionen', exact: true })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(docs).toBeHidden();

	await createFile(page, 'seite.html');
	await setEditor(page, '<p>Hallo</p>');
	await page.locator('.cm-line').first().getByText('p', { exact: true }).first().hover();
	await expect(docsLink).toBeVisible();
	await docsLink.click();
	await expect(docs).toBeVisible();
	await expect(docs.locator('#html-text')).toHaveClass(/focused/);
	await expect(
		docs.getByRole('heading', { name: 'Überschrift und Text', exact: true })
	).toBeVisible();
});

test('asks for wwschool login from files, then stays local for this session', async ({ page }) => {
	await openCoder(page);
	await page.getByRole('button', { name: 'Dateien' }).click();

	const login = page.getByRole('dialog', { name: 'Bei wwschool anmelden' });
	await expect(login).toBeVisible();
	await expect(
		login.getByText('Dein Workspace bleibt lokal gespeichert und wird mit wwschool abgeglichen.')
	).toBeVisible();
	await expect(login.getByLabel('E-Mail-Adresse')).toHaveValue('kri.avramovic@stg-segeberg.de');
	const password = login.getByLabel('Passwort');
	await expect(password).toHaveAttribute('type', 'password');
	await password.fill('feldtest');
	await expect(password).toHaveValue('feldtest');
	await expect(login.getByLabel('Angemeldet bleiben')).toBeChecked();
	await expect(login.getByRole('button', { name: 'Anmelden', exact: true })).toBeVisible();
	await login.getByRole('button', { name: 'Lokal weiterarbeiten' }).click();

	const files = page.getByRole('dialog', { name: 'Dateien' });
	await expect(login).toBeHidden();
	await expect(files).toBeVisible();
	await expect(files.getByText('Nur lokal', { exact: true })).toBeVisible();
	await expect(files.getByRole('button', { name: 'Mit wwschool verbinden' })).toHaveCount(0);
	await expect(files.getByRole('button', { name: 'Lokal', exact: true })).toHaveCount(0);
	await page.keyboard.press('Escape');
	await expect(files).toBeHidden();

	await page.getByRole('button', { name: 'Dateien' }).click();
	await expect(login).toBeHidden();
	await expect(files).toBeVisible();
	await page.keyboard.press('Escape');

	await page.getByRole('button', { name: 'Einstellungen' }).click();
	await page.getByRole('button', { name: 'Bei wwschool anmelden' }).click();
	await expect(login).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(login).toBeHidden();
});

test('opens shared code unsaved and saves it through the files manager', async ({ page }) => {
	await openCoder(page);
	await page.goto(`/?${IMPORT_PARAM}#${encodeCode('print("geteilt")')}`);
	await expect(page.getByRole('tab', { name: /geteilt\.py/u })).toBeVisible();
	await expect(page.getByText('Nicht gespeichert', { exact: true })).toBeVisible();
	await expect(page.locator('.cm-content')).toContainText('print("geteilt")');
	await page.getByRole('button', { name: 'Geteilte Datei speichern' }).click();
	const login = page.getByRole('dialog', { name: 'Bei wwschool anmelden' });
	await expect(login).toBeVisible();
	await login.getByRole('button', { name: 'Lokal weiterarbeiten' }).click();
	const files = page.getByRole('dialog', { name: 'Dateien' });
	await expect(files).toBeVisible();
	await expect(files.getByText('Ordner wählen, dann hier speichern.')).toBeVisible();
	await files.getByRole('button', { name: 'Hier speichern' }).click();
	await expect(files).toBeHidden();
	await expect(page.getByRole('tab', { name: 'geteilt.py', exact: true })).toBeVisible();
	await expect(page.getByText('Nicht gespeichert', { exact: true })).toHaveCount(0);
	await expect(page.locator('.cm-content')).toContainText('print("geteilt")');
});
