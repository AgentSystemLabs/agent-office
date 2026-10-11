# Dev-APK bauen und herunterladen

Im Office: **☰ → Dev-APK**. Der Eintrag lässt sich oben anheften. Er gehört zum gesamten Projekt, nicht zu einem einzelnen Playtest. Der Tester braucht zuhause kein Unity.

## Ablauf

1. Ein freigeschalteter Nutzer drückt **Dev-APK bauen**. Der Server startet `Tools/Build-Quest.ps1 -Development` auf dem Build-PC.
2. Läuft bereits ein Unity-Build oder Test, wartet der Auftrag auf denselben globalen Build-Platz. Status und Protokoll sind sichtbar. Ein zweiter Office-Build wird währenddessen abgelehnt.
3. Der konfigurierte Branch wird frisch abgerufen und auf einen Commit festgelegt. Der gemeinsame Arbeitscheckout wird weder zurückgesetzt noch umgeschaltet. Gebaut wird im vorbereiteten Build-Ordner.
4. Erst nach erfolgreichem Build, vollständiger Kopie und SHA-256-Berechnung wird der Download veröffentlicht. Ein Fehlschlag lässt die letzte erfolgreiche APK unverändert.
5. **APK herunterladen** lädt genau die angezeigte Version. **Download-Link kopieren** liefert einen dauerhaften Link auf die neueste erfolgreiche APK. Der Empfänger benötigt seinen Office-Login.

Der eigene Hintergrundprozess läuft auch bei geschlossenem Browser oder Office-Neustart weiter. Stirbt er, wird der Auftrag als unterbrochen angezeigt. Ein möglicherweise noch laufendes Unity wird nicht beendet; der nächste Build wartet weiterhin auf den gemeinsamen Mutex.

## Einrichtung auf dem Windows-Build-PC

Im Office-Datenordner (`<Office-Home>/.agent-office`, passend zu `--home`) die Datei `dev-apk.json` anlegen. Die Konfiguration wird bei jedem Aufruf neu gelesen und ausschließlich auf dem Server bearbeitet. Browser können keine Befehle, Ordner oder Branches vorgeben.

```json
{
  "projects": [{
    "repo": "KajoVanBuyten/zombie-reality-breach",
    "sourceDir": "E:/source/Unity/zombie-reality-breach",
    "buildDir": "E:/source/Unity/zrb-build",
    "ref": "origin/main",
    "apkName": "ZombieRealityBreach-dev.apk",
    "launcher": "C:/Users/gp/KaMaStudios/tools/unity-hidden.ps1",
    "builders": []
  }]
}
```

Voraussetzungen: Node, Git, Windows PowerShell, Unity/Android und der funktionierende ZRB-Build-Ablauf inklusive `Tools/BuildLock.ps1`. `sourceDir` ist ein vertrauenswürdiger Projektcheckout mit den erforderlichen Assets; `buildDir` ist ausschließlich ein wegwerfbarer Build-Checkout, niemals ein Arbeitscheckout. Der Office-Prozess muss Zugriff darauf haben. Der vorhandene Build-Ablauf kopiert seine Ausgabe nach `sourceDir/Builds/Quest`; die Download-Kopie wird noch unter demselben Build-Mutex erstellt.

Admins und Nutzer des gemeinsamen Office-Passworts dürfen Builds starten. Für weitere Co-Devs deren **Office-Konto-ID** in `builders` eintragen. Alle angemeldeten Office-Nutzer dürfen herunterladen. Keine Issues oder Worker/Queue-Einträge werden erzeugt.

Der Branch ist in der Oberfläche sichtbar. Für XR-Playtest-Werkzeuge muss der gewählte Stand den Spiel-PR #361 enthalten. Ein Development-Build fügt keine noch nicht integrierten Änderungen hinzu.

## Tunnel und Downloads

Die APK liegt unter derselben Office-Adresse: beispielsweise `https://studios.zombierealitybreach.com/api/dev-apk/download?floor=<Etagen-ID>`. Der vorhandene HTTPS-/SSH-Tunnel transportiert den authentifizierten HTTP-Download. Kein zusätzlicher Port oder lokaler `agent-office tunnel`-Helfer ist nötig.

GET/HEAD, Dateigröße, ETag, Range und If-Range ermöglichen fortsetzbare Downloads. Dateien werden gestreamt. Versionierte Links bleiben während neuer Builds unverändert; If-Range verhindert beim Fortsetzen des „neueste“-Links das Vermischen verschiedener Versionen.

Der Proxy muss Cookies und Range-Header weiterleiten, die API darf nicht öffentlich gecacht werden. `X-Accel-Buffering: no` wird gesendet. Bei nginx gegebenenfalls `proxy_buffering off` und ausreichend langen `proxy_read_timeout` für den Download-Pfad konfigurieren. `client_max_body_size` begrenzt Uploads, nicht diese Downloads. Build-PC und Tunnel müssen online bleiben.

## Installation beim Tester

APK auf dem eigenen PC speichern, Quest-Entwicklermodus aktivieren, USB-Debugging freigeben und mit **Meta Quest Developer Hub** oder `adb install -r <Datei.apk>` installieren. Unity ist nicht nötig. Der Quest-Browser installiert eine heruntergeladene APK nicht automatisch.

Bei anderer Signatur als der Store-Version kann Android das Update ablehnen. Nicht automatisch deinstallieren: Lokale Spieldaten könnten verloren gehen.

Meta verlangt auch für Alpha/Beta/RC die Release-Verpackungsregeln. Für unsere debuggable Dev-APK nutzen wir Sideloading; signierte Release-Builds können über Meta-Testkanäle verteilt werden. Quellen: [Release-Kanäle](https://developers.meta.com/horizon/resources/publish-release-channels/) und [Manifest-Regeln](https://developers.meta.com/horizon/resources/publish-mobile-manifest/).

## Speicherung und Prüfung

Unter `<Office-Datenordner>/dev-apk/` liegen Aufträge, Protokolle und APKs. Die letzten drei erfolgreichen APKs bleiben erhalten. Ältere APK-Dateien werden nach erfolgreicher Veröffentlichung entfernt; Metadaten und Logs bleiben bestehen. Partielle oder fehlgeschlagene Builds ersetzen niemals den neuesten erfolgreichen Download.

Prüfung: `npm run typecheck`, `npm test`, `npm run build`; gezielt `node --import tsx --test tests/dev-apk.test.ts tests/size.test.ts`; Browser-Abnahme `node --import tsx tests/dev-apk-browser.mjs`. HTTP-/Browser-Tests mit Testdateien sind getrennt von echten Unity-Builds, öffentlichen Tunnel-Downloads und Headset-Installation zu berichten.
