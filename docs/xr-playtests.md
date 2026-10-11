# Headset-Testbegleitung

Die Begleitung wird **oben in der gesamten Playtest-Checkliste** gestartet. Sie gehört zur Spielsession und beobachtet alle passenden Tests gleichzeitig. Modus, Solo/Koop und Spielphase kommen aus dem laufenden Spiel. Der Filter einer einzelnen Karte oder der gerade sichtbare Checklisten-Tab beschränkt den Testlauf nicht.

## Einrichtung

- Auf dem PC: Node 20+, Android Platform Tools (`adb` im Suchpfad; alternativ Umgebungsvariable `ADB` mit dem vollständigen Pfad).
- Auf der Quest: Entwicklermodus, freigegebenes USB-Debugging und ein Development-Build mit Meta XR Operator und den ZRB-Playtest-Werkzeugen. Die normale Store-Version enthält diese Werkzeuge nicht.
- Der lokale Helfer gehört zum Office-Paket (`office-xr`). Beim Start aus einem Git-Checkout zuerst `npm ci` und `npm run build`; statt `office-xr` kann `node <Office-Verzeichnis>/bin/office-xr.js` verwendet werden. Keine öffentliche Headset-Adresse nötig.
- Für Zombie Reality Breach muss der Spiel-PR [#361](https://github.com/KajoVanBuyten/zombie-reality-breach/pull/361) enthalten sein. Der Office-PR alleine instrumentiert keine bereits installierte APK.

## Nutzung

1. Playtest-Checkliste → **Headset-Testbegleitung** → **Headset-Testbegleitung starten**.
2. Angezeigten Befehl auf dem PC mit den angeschlossenen Headsets ausführen. Den Kopplungscode aus der Oberfläche in den Helfer eingeben. Er wird nicht als Kommandozeilenargument oder in der URL gespeichert.
3. Ein oder zwei Headsets wählen und **Mit ausgewählten Headsets begleiten** drücken. Unautorisierte/offline Geräte und fehlende Operator-Werkzeuge werden ausdrücklich gemeldet.
4. Spielen. Passende Tests werden automatisch aktiv. Im Headset wechseln die ausblendbaren Hinweise durch die Schritte. Host/Gast, Modus und Build werden angezeigt.
5. Bei einem Fehler im Headset **Fehler** drücken. Im Office sind dazu Beobachtungen markiert. Beim betreffenden Test **Fehler melden** öffnen, die Pflichtbeschreibung eingeben und an den Issue-Agent senden. Es wird keine Arbeit eingereiht.
6. **Pause**, **Fortsetzen** oder **Beenden** steuern den Lauf. Schließen des Office-Fensters beendet die Begleitung nicht. ✕ und Esc geben die Office-Steuerung zurück. Strg+C beendet den PC-Helfer; Headset-Hinweise verschwinden spätestens nach acht Sekunden.

Nach einem PC-Neustart **PC neu koppeln** verwenden. Dabei wird der alte Code widerrufen. Pro Benutzer und Etage ist nur ein offener Lauf erlaubt. Ein neuer Build benötigt einen neuen Lauf; frühere Belege werden nicht als Nachweis für den neuen Build übernommen.

## Beobachtung und Testbedingungen

Standardmäßig werden nur Spielzustand und Diagnosewerte gelesen. Ein Test kann unter **Voraussetzungen und technisches Kriterium** auf Phasen, Rolle und zwei Geräte begrenzt werden. Ein expliziter Vergleich eines Messwerts mit einem erwarteten Wert liefert „technisches Kriterium erfüllt“ oder „Abweichung“. Ohne verfügbaren Messwert bleibt die Beurteilung manuell. Änderungen am Test machen seine alte Kriterienzuordnung ungültig, bis sie erneut geprüft und gespeichert wird.

Zweigeräte-Prüfungen verlangen aktuelle Daten, Host/Gast, denselben Build, Modus, Spielweise und dieselbe Spielgruppe. Ein fehlendes oder abgesetztes Headset kann kein erfülltes Koop-Kriterium erzeugen.

**Screenshot** ist eine einzelne, vom Tester ausgelöste Aufnahme des gewählten Geräts. Geschützte Inhalte oder fehlende Gerätefreigaben können die Aufnahme verhindern oder einen schwarzen Frame liefern; dies ist kein Testbestehen. Es gibt keine Hintergrundaufnahme.

**Testvorbereitung** ist ein bewusst gewählter Eingriff: bis zu 120 Reserve-Patronen zur gehaltenen Pistole hinzufügen, ausschließlich in einer fokussierten Solo-Sitzung. Die Aktion wird protokolliert und bei Netzwerk-Wiederholungen nicht doppelt ausgeführt. Geld/Spielstände, Gegner, Wellen und Controller werden nicht verändert. Weitere sichere Vorbereitungen können über denselben begrenzten Werkzeugvertrag ergänzt werden.

## Ergebnisse

Beim ersten Start werden zwei offene manuelle Abnahmeszenarien für die XR-Begleitung in diese Playtest-Checkliste übernommen. Wiederholte Starts erzeugen keine Duplikate und setzen keine bestehenden Ergebnisse zurück.

- Laufindex: `<Projekt>/.agent-office/xr-sessions.json`; Sitzungszustand und Beobachtungen separat unter `.agent-office/xr-runs/`. Heartbeats schreiben keine alten Testläufe oder unveränderten Belege neu.
- Screenshots: `<Projekt>/.agent-office/xr-evidence/<Lauf-ID>/<Aktions-ID>.png`.
- Gespeichert werden Gerät, Build, App-Sitzung, Test-ID/Revision, Empfangszeit, Kontext, Messwerte und die letzten Geräteereignisse.
- **Belege exportieren** lädt den Lauf als JSON; Screenshots sind separat öffnbar und werden in Fehlerberichten referenziert. Der Issue-Agent kann sie aus dem Projektordner lesen.
- Bestehende Häkchen, Notizen und manuelle Ergebnisse werden niemals automatisch überschrieben. Ein Messwertvergleich bestätigt nicht den gesamten Test.
- Bis zu 100 Läufe, 1500 Beobachtungen pro Lauf und 30 Geräteaktionen pro Lauf werden gehalten. Für Langzeitarchive exportieren; Screenshots liegen separat im Projektordner.

## Verbindung und Erweiterung

Der Helfer kontaktiert das Office über HTTPS (HTTP nur auf Loopback). Ein zufälliger, widerrufbarer Token berechtigt ausschließlich zum jeweiligen Testlauf. Auf dem PC wird pro ausgewähltem Headset eine ADB-Weiterleitung von einem freien Loopback-Port auf Geräteport 8720 eingerichtet und beim Beenden entfernt. SSE/MCP entdeckt die Werkzeuge vor dem Polling und verbindet bei Abbruch erneut.

Werkzeuge: `ZRB_PlaytestSnapshot`, `ZRB_PlaytestOverlay`; nur nach ausdrücklichem Vorbereitungsauftrag `ZRB_PlaytestPrepare`. Keine beliebigen Shell-, MCP- oder Controller-Aufträge vom Server. Screenshot und Vorbereitung sind zeitlich begrenzt; nicht bestätigte Aktionen werden als solche angezeigt.

HTTP-Registry: `xr-sessions.ts`; Logik: `server/xr-playtests`; UI: `client/ui/xr-playtests`; Integration über die Checklisten-Toolbar-Registry. Die Vorschau-API bleibt für Tests verfügbar, stellt aber keine bestätigte Headset-Telemetrie dar.

## Prüfung

`npm run typecheck`, `npm test`, `npm run build`; gezielt `node --import tsx --test tests/xr-*.test.ts`. Browser-Abnahme: `node --import tsx tests/xr-session-browser.mjs` (Chrome-Pfad optional über `XR_TEST_BROWSER`, Screenshots über `XR_SCREENSHOT_DIR`). Sie prüft echten HTTP-Sitzungsablauf und UI mit simulierten Gerätedaten; sie ersetzt keine Quest-Validierung.
