# APK aus dem Office auf die Quest installieren

**☰ → APK → Auf Quest installieren** verbindet den Browser mit der Quest am eigenen Rechner. Auch wenn das Office bei einem Kollegen läuft, wird das lokal angeschlossene Headset verwendet. Unity, ein Office-Server oder ein Tunnel-Helfer sind beim Tester nicht erforderlich.

## Ablauf

1. Office in Chrome oder Edge auf dem Rechner öffnen, über HTTPS oder bei lokalem Betrieb über localhost. Im Office anmelden.
2. Quest-Entwicklermodus aktivieren, das eingeschaltete Headset mit einem USB-Datenkabel anschließen. Unter Windows kann der Meta-ADB-Treiber erforderlich sein.
3. **Quest verbinden** drücken, das Gerät im Browser auswählen und **USB-Debugging zulassen** im Headset bestätigen. Diese Freigaben sind notwendig; die Website kann sie nicht automatisch erteilen.
4. Oben **Dev-APK** oder **Store-APK** wählen und den passenden Installationsbutton drücken. Es wird genau der angezeigte erfolgreiche Build übertragen. Alternativ **APK-Datei auswählen** und danach **Ausgewählte APK installieren** drücken.
5. Während Übertragung, Prüfung und Installation USB verbunden lassen. Erst nach Androids Erfolgsbestätigung wird **Spiel starten** freigegeben.

Für die neueste Office-APK ist kein vorheriger Download nötig. Der vorhandene HTTPS-Tunnel transportiert die APK zum Browser; USB führt vom Rechner des Testers zu dessen Quest. Der Office-Server erhält keine ADB-Verbindung zum entfernten Headset. Der ADB-Verbindungsschlüssel bleibt im Browserprofil auf diesem Rechner.

## Fehler und Abbruch

- Firefox und Safari bieten den benötigten WebUSB-Zugriff nicht. Bei fehlender Unterstützung bleibt der Download nutzbar und die Installation deaktiviert.
- Bei belegter USB-Verbindung SideQuest, Meta Quest Developer Hub und andere ADB-Verbindungen schließen. Ein im Hintergrund laufender ADB-Server muss gegebenenfalls ebenfalls beendet werden. Treiber und Datenkabel prüfen.
- Bei unterschiedlicher App-Signatur bleibt die vorhandene Installation erhalten. Eine passend signierte APK verwenden. Die Funktion deinstalliert keine App und löscht keine Spieldaten, um einen Signaturkonflikt zu umgehen.
- Versions-Downgrades werden nicht erzwungen. Speicherfehler, fehlende Anmeldung, unterbrochene Downloads und abgezogene Kabel erscheinen als Fehler, ohne Startfreigabe.
- **Abbrechen**, **✕** oder **Esc** bricht den laufenden Vorgang ab. ✕ und Esc schließen das Fenster unmittelbar und geben die Maussteuerung zurück. Falls Android bereits mit der Installation begonnen hat, kann es diese trotzdem abschließen: den App-Stand im Headset prüfen.
- **Trennen** gibt die USB-Verbindung frei. Beim Schließen wird nach dem Abbruch die Verbindung ebenfalls geschlossen. Erneutes Öffnen erfordert erneutes Verbinden.

## Umfang und technische Grenzen

Unterstützt werden einzelne APK-Dateien bis knapp 4 GiB mit binärem Android-Manifest, kein ZIP64 und keine APKS-/Split-Pakete. Paketname und Startaktivität werden aus APK und Gerät ermittelt; es ist kein Paketname fest einprogrammiert. Manifest und ZIP-Verzeichnis werden begrenzt gelesen, die APK selbst in kleinen Blöcken übertragen.

Office-Dateien werden ausschließlich über die authentifizierte Download-Route derselben Office-Adresse mit fester Build-ID geladen. Nach der Übertragung wird deren SHA-256 auf dem Gerät geprüft. Bei lokal ausgewählten Dateien gibt es keine unabhängige Office-Prüfsumme; Android prüft die APK bei der Installation. Die temporäre Datei hat pro Versuch einen eigenen Namen und wird anschließend nach Möglichkeit entfernt. Es wird kein beliebiger ADB-Befehlseingang bereitgestellt.

Ein Reverse Proxy darf WebUSB nicht durch `Permissions-Policy: usb=()` verbieten. Für die APK gelten dieselben Range-/Download-Voraussetzungen wie beim [APK-Download](dev-apk.md).

## Prüfung

`npm run typecheck`, `npm test`, `npm run build`. Gezielte Regressionen: `node --import tsx --test tests/quest-install.test.ts`. Browser-Abnahme: `node --import tsx tests/quest-install-browser.mjs`.

Die Browser-Abnahme verwendet die echte Oberfläche, APK-Auswertung und Installationssteuerung mit simuliertem USB-Gerät. Sie prüft Auswahl, Benutzerinteraktion, Fortschritt, Startfreigabe, Fehler, Abbruch und Schließen. Ein echter Quest-Installationslauf und die USB-/Treiberkombination des entfernten Testers sind gesonderte Hardware-Prüfungen.
