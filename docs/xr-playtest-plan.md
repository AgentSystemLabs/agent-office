# XR Operator und automatische Playtest-Begleitung

Stand: 11.10.2026. Abgestimmter Plan; Umsetzung begonnen.

## Ziel und Bedienung

Eine Begleitung pro Spielsession. Der Start erfolgt oben in der gesamten Playtest-Checkliste über „Headset-Testbegleitung starten“. Der Tester wählt ein oder zwei Headsets und ihre Rollen. Es wird kein einzelner Test als Voraussetzung ausgewählt.

Das Spiel meldet Modus, Spielweise, Phase und Build. Der Begleiter lädt alle passenden Tests, passt sie bei Kontextwechseln an und beobachtet mehrere Tests gleichzeitig. Beispiel: RIFT → Solo → laufende Runde aktiviert RIFT- und allgemeine Tests für Solo in dieser Phase. Beim Wechsel zu RB oder Koop wird die Auswahl neu berechnet. Ergebnisse bereits beobachteter Tests bleiben erhalten.

Im Headset erscheinen ausblendbare Hinweise, Fortschritt und die Aktionen Fehler melden, Pause und Beenden. Gezielte Handlungen können vorgeschlagen werden; der Tester spielt frei.

## Verbindliche Regeln

- Begleiten ist die Voreinstellung: keine simulierten Controller-Eingaben und keine Veränderungen am Spielzustand.
- Automatisch durchführen und Testbedingungen vorbereiten sind getrennte, ausdrücklich gestartete Betriebsarten. Jeder Eingriff wird im Testlauf protokolliert.
- Testauswahl beruht auf strukturierten Voraussetzungen und echtem Spielzustand, niemals auf einer Stichwortsuche im Beschreibungstext.
- Fehlende oder widersprüchliche Klassifizierung wird als ungeklärt angezeigt. Beispielsweise ist „bei RIFT nicht“ keine RIFT-Zuordnung.
- Technische Beobachtungen, manuelle Bestätigung und nicht durchgeführte Tests bleiben unterscheidbar. Fehlende Fehlerlogs beweisen kein Bestehen.
- Ergebnisse gehören zu Testrevision, Build, Geräten, Sitzung und Zeitraum. Ein früheres Bestehen gilt nicht automatisch für einen neuen Build.
- Ausschließlich der Nutzer entscheidet über Queue und Worker-Zuweisungen. Testbegleitung reiht keine Issues ein.
- Bestehende Notizen und Testergebnisse bleiben erhalten. Manuelle Prüfungen bleiben in der Playtest-Checkliste.

## Architektur

1. Unity-Development-Build: Meta XR Operator plus eigene ZRB-Werkzeuge und ein sitzungsübergreifender Diagnosepuffer.
2. Lokaler PC-Helfer: erkennt freigegebene Headsets, verbindet ADB/MCP, verwaltet getrennte Anschlüsse je Gerät und führt die Verbindung auch für das öffentlich erreichbare Office aus.
3. Office-Modul: verwaltet Testläufe, Bedingungen, Beobachtungen, Ergebnisse und Belege. Die UI hängt an den bestehenden Registries.
4. Testbegleiter: liest ausschließlich die für den Testlauf freigegebenen Werkzeuge und wertet strukturierte Ereignisse aus.

Die Verbindung wird authentifiziert und an die ausgewählten Geräte gebunden. Veraltete Telemetrie oder ein abgesetztes Headset pausieren die Auswertung. Nach Wiederverbindung werden Build und Sitzung erneut geprüft; Messlücken werden nicht als erfolgreiche Tests interpretiert. Der Operator ist experimentell; Werkzeugverfügbarkeit wird beim Verbinden geprüft.

## Werkzeuge

| Bereich | Inhalt |
|---|---|
| Kontext | Build-ID, Protokollversion, Modus, Spielweise, Phase, Szene, Host/Gast, Fokus und Tracking |
| Menüs | sichtbare Panels, verfügbare Aktionen, Cash, Freischaltungen, Übergänge |
| Waffen/Hände | Eingabe, Tracking, Besitz, Halten/Loslassen samt Ursache, Griff- und Waffenpose |
| Koop | korrelierte Ereignisse beider Geräte, Besitz, Geld, Schaden, Netzwerkzustand, räumliche Ausrichtung |
| Rendering | tatsächliche Foveation, Render Scale, Auflösung und UI-Zustand |
| Belege | Ereignispuffer vor/nach Fehlermeldung, Logs, Screenshot, optionale Performance-Aufzeichnung |
| Testvorbereitung | definierte Waffe, Geld, Gegner oder Welle; nur im aktiv gewählten Automatikmodus |

Eigene Unity-Werkzeuge werden einmal pro XR-Sitzung registriert. Ihre Aufrufe bleiben kurz; umfangreiche Auswertung erfolgt auf dem PC, damit die Begleitung das Rendering möglichst wenig beeinflusst.

## Datenmodell

- Voraussetzungen pro Test: explizite Modi, Spielweisen, Phasen, erforderliche Fähigkeiten und gegebenenfalls Host/Gast bzw. zwei Headsets.
- Leere Spielweisen bedeuten ausdrücklich alle; fehlende Angaben müssen vor automatischer Auswahl geklärt werden.
- Lauf: ID, gewählte Geräte, Builds, Start/Ende, Betriebsart und Verbindungslücken.
- Beobachtung: Test-ID und Revision, Gerät, Zeit, Kontext, technisches Kriterium und Beleg.
- Ergebnis: nicht beobachtet, technisch bestätigt, Fehler beobachtet, manuelle Bestätigung ausstehend oder vom Tester bestätigt.
- Die erste Implementierung stellt eine Vorschau bereit. Von einem Browser übermittelter Kontext ist keine bestätigte Headset-Telemetrie.

## Umsetzungsschritte

1. **Auswahlkern und Plan:** eigenständiges Modul mit typisierten Voraussetzungen, zeitlich gültigem Kontext und nachvollziehbaren Ausschlussgründen; authentifizierte Vorschau-API; Regressionstests.
2. **Quest-Verbindung:** SDK/Operator im tatsächlichen APK prüfen; lokaler Helfer, Geräteauswahl, Build-Prüfung und Wiederverbindung implementieren.
3. **Unity-Diagnose:** Kontextwerkzeug, Ereignispuffer sowie Waffen/Hand-, Koop- und Rendering-Daten ergänzen. Änderungen in eigenem Spiel-PR und serialisierte Unity-Prüfung.
4. **Session-UI:** globaler Start oben in der Checkliste, Status und Fortschritt; kleine ausblendbare In-Headset-Anzeige. Kein Startzwang auf Testkarten.
5. **Ergebnisse und Fehler:** Testläufe dauerhaft speichern; vorhandene Fehler-Melden-Funktion um Belege ergänzen, anschließend Übergabe an den Issue-Agent ohne Queue-Aktion.
6. **Breitere Abdeckung:** Tests einzeln mit nachweisbaren technischen Kriterien versehen. Automatische Bedienung erst als zusätzliche Betriebsart hinzufügen.

## Prüfung und Abnahme

- Auswahl: Modus-/Spielweise-/Phasenwechsel; allgemeine Tests; fehlende Klassifizierung; stale/offline/focus-lost; zwei Geräte; falscher Build; alte Ergebnisse.
- Transport: Gerätewechsel, Verbindungsabbruch, doppelte/veraltete Ereignisse, wiederholter Start ohne doppelte Läufe.
- Office: typecheck, Tests und Build; bei UI-Änderungen Headless-Screenshots einschließlich kleinem Bildschirm und Schließen per X/Esc.
- Unity: offizieller serialisierter Build-/Testablauf, danach echte Headset-Validierung als offene Checklisten-Einträge.
- Erste Hardware-Abnahme: RIFT Solo → Koop → RB; richtige Tests aktiv, keinerlei Eingabeübernahme, korrekte Belege beim gemeldeten Fehler.
- Zweite Hardware-Abnahme: zwei Headsets, passende Builds, Host/Gast-Zuordnung und zeitlich zuordenbare Ereignisse.

## Quellen

- [Meta XR Operator auf Quest](https://developers.meta.com/vr/documentation/unity/meta-xr-operator/quest/)
- [Eigene Operator-Werkzeuge](https://developers.meta.com/vr/documentation/unity/meta-xr-operator/custom-tools/)

## Umsetzungsstand

- Plan erstellt.
- Office-Sitzung, globaler Einstieg, lokale ADB/MCP-Brücke, automatische Auswahl, persistente Beobachtungen, Kriterieneditor, Screenshots und Fehlerübergabe sind implementiert.
- Spielwerkzeuge und ausblendbare Headset-Hinweise stehen im separaten Spiel-PR #361. Sie gehören in einen Development-Build.
- Als ausdrücklich ausgelöste Testvorbereitung ist das begrenzte Auffüllen von Reserve-Munition implementiert. Beliebige Controllersteuerung, Änderungen an Geld/Spielständen und automatische Wellen-/Gegner-Manipulationen sind keine freigegebenen Begleitwerkzeuge.
- Automatisierte Prüfungen und Hardware-Abnahme werden getrennt berichtet. Die implementierte Verbindung ist kein Beleg, dass ein Headset-Playtest bestanden wurde.
- Bedienung und Einrichtung: [XR-Playtests](xr-playtests.md).
