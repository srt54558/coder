# K+ Coder

Python, HTML, CSS und JavaScript direkt im Browser schreiben: [coder.k-plus.one](https://coder.k-plus.one).

Die Seite ist eine statische Website. Cloudflare liefert nur Dateien aus und führt kein Worker-Skript aus. Python läuft im Browser des Besuchers, nicht auf einem Server.

## Was die Seite kann

- Python, HTML, CSS, JavaScript, JSON, XML, Markdown und Text schreiben
- Python im Browser ausführen und mit Ruff prüfen
- HTML, CSS und JavaScript prüfen, auch Skript und Stil in einer HTML-Datei
- Dateien und Ordner anlegen; offene Tabs, Inhalte und der Ungespeichert-Stand bleiben im Browser erhalten, sind aber kein Ersatz für wwschool
- optional mit demselben wwschool-Zugang Dateien in `coder-kplus` in der persönlichen Dateiablage ablegen; der Explorer zeigt diesen Ordner, Speichern öffnet einen Speichern-unter-Dialog
- den gesamten Workspace als `coder-workspace.py` herunterladen; der Import ersetzt den geöffneten Workspace nach einer Rückfrage
- live gemeinsam arbeiten: Sechs-Wörter-Code, bis zu 16 Teilnehmende, Ende-zu-Ende-verschlüsselte Dateinamen, Ordner, Tabs und Inhalte; Beitreten öffnet einen eigenen Tab nur für die Sitzung, der lokale Editorstand bleibt getrennt
- einen Dateiinhalt als Link teilen; ein geöffneter geteilter Stand bleibt ungespeichert, bis du speicherst oder die Datei herunterlädst
- beim Schließen eines ungespeicherten Editor-Tabs nachfragen; das Schließen des Browser-Tabs warnt nicht, weil der Editorstand lokal liegt

`Cmd/Strg + Enter` führt den Code aus. `Cmd/Strg + S` öffnet Speichern, oder die wwschool-Anmeldung, wenn du nicht angemeldet bist. Ein Datei-Download gilt für diese Datei als gespeichert.

## Cloudflare

`wrangler.jsonc` hat kein `main` und kein Asset-Binding. Damit ist das Projekt assets-only: der Asset-Router beantwortet die Anfragen, inklusive der SPA-Rückfallseite auf `index.html`. Solche Anfragen sind statische Assets. Bei Cloudflare sind sie kostenlos und unbegrenzt und zählen nicht gegen das Request-Limit eines Worker-Skripts.

Ein eigenes Worker-Skript würde Anfragen abrechenbar machen. Deshalb bleibt die Konfiguration ohne `main`.

`python.k-plus.one` zeigt die Seite nicht mehr. `redirect/` ist ein eigener Worker, der dort nur mit 301 auf dieselbe Adresse unter `coder.k-plus.one` antwortet. Die Seite selbst bleibt ohne Worker-Skript.

Die Python-Laufzeit (Pyodide 314.0.7, inklusive Standardbibliothek) liegt unter `/pyodide/` und wird mit der Seite ausgeliefert. Ruff ebenfalls. Beides ist ein Abruf derselben Website, kein Aufruf eines Cloudflare-Workers. Python-Code wird im Browser ausgeführt. Offene Tabs und ihr Stand liegen in IndexedDB in diesem Browser; das ist der Editorstand, kein Abgleich mit wwschool. Bei wwschool-Anmeldung legt der Browser den Ordner `coder-kplus` in der persönlichen Dateiablage an und lädt einzelne Dateien per WebDAV hoch; die Zugangsdaten werden bei „Angemeldet bleiben“ verschlüsselt im lokalen IndexedDB-Speicher gehalten, sonst nur für die aktuelle Sitzung.

wwschool erzeugt bei jedem Upload eine neue Datei. Gleicher Name wird eine weitere Kopie. Löschen geht nur in der wwschool-App oder im Web.

Die Zusammenarbeit nutzt einen WebSocket-Relay auf `server`. Die Sitzungskennung wird als SHA-256-Hash aus dem Sechs-Wörter-Code abgeleitet; OPAQUE schützt die Anmeldung. Workspace-Daten werden im Browser mit AES-GCM verschlüsselt, bevor sie den Relay erreichen. Er hält aktive Sitzungen nur im Arbeitsspeicher. Er sieht Sitzungs- und Verbindungsmetadaten wie Teilnehmende und Datenmenge, aber weder den Code im Klartext noch Workspace-Klartext. Jede teilnehmende Person mit dem Code kann den Workspace lesen und bearbeiten.

Im Browser fehlen normale Prozesse und native Threads. Ein Lauf endet nach 15 Sekunden oder beim Stopp; der Python-Worker wird danach neu aufgebaut.

## Teilen

Der Teilen-Button erzeugt eine URL in dieser Form:

```text
https://coder.k-plus.one/?import#<lz-komprimierter-code>
```

Der Query-Parameter ist nur das Import-Kennzeichen. Der komprimierte Code steht im Fragment hinter `#` und geht damit nicht an den Webserver. Ab 8.000 Zeichen in der URL wird stattdessen die Datei heruntergeladen. Der Inhalt ist komprimiert, aber nicht verschlüsselt.

## Lokal starten

```sh
npm install
npm run dev
```

Prüfen und bauen:

```sh
npm run check
npm run lint
npm test
npm run test:e2e
npm run build
npx wrangler deploy
npx wrangler deploy -c redirect/wrangler.jsonc
```

`npm run build` schreibt die statische Seite nach `build/`. `npx wrangler deploy` veröffentlicht genau dieses Verzeichnis.

## Lizenz

[MIT](LICENSE). Jede Person darf den Code kopieren, ändern, zusammenführen und weitergeben, auch in eigenen Projekten. Erhalten bleiben müssen der Urheberhinweis und dieser Lizenztext.
