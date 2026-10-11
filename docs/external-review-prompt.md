# Externe Code-Review und Übergabe an das Office

Dieser Prompt ist für Claude außerhalb des Office gedacht. Gib ihm Zugriff auf das Spiel-Repository und seine GitHub-Issues/PRs. Vorhandene Playtests und Entscheidungen zusätzlich aus dem Office exportieren beziehungsweise bereitstellen, damit auch dort keine Duplikate entstehen. Die Worker-Hook-Befehle funktionieren nur in einer autorisierten Office-Worker-Sitzung; keine internen Worker-Tokens an den externen Reviewer weitergeben.

## Kopierbarer Prompt

Prüfe den aktuellen Stand dieses Repositories gründlich und gleiche deine Befunde mit den vorhandenen Issues und Pull Requests ab. Arbeite als Reviewer: keine Implementierung, keine Merges, keine Queue-Änderungen und keine Worker starten. Änderungen anderer Personen bleiben unberührt.

1. Ermittle den tatsächlich geprüften Commit und lies die Repository-Regeln. Lade die offenen Issues inklusive Beschreibung, Labels und relevanter Kommentare sowie offene und kürzlich gemergte PRs. Prüfe bei vermeintlichen Duplikaten auch geschlossene Issues. Berücksichtige die bereitgestellten Playtest- und Entscheidungslisten. Wenn dir etwas davon fehlt, kennzeichne den Abgleich dort als unvollständig.
2. Suche zuerst konkrete Fehler, Regressionen und fehlende Anforderungen. Belege jeden Befund mit Datei/Funktion, genauer Fundstelle, Auslöser, tatsächlichem und erwartetem Verhalten sowie praktischer Auswirkung. Kennzeichne Hypothesen und ungetestete Hardware-Annahmen. Behaupte keine Quest-, Koop- oder LAN-Verifikation ohne tatsächlichen Test.
3. Ergänzungsideen separat als Vorschläge kennzeichnen. Eine Geschmackssache ist kein Bug. Beschreibe Nutzen, Umfang, Aufwand/Risiko und mögliche Abhängigkeiten. Erfinde keine Anforderung, um ein Issue zu rechtfertigen.
4. Vergleiche vor dem Anlegen jeden Befund semantisch mit bestehenden Issues/PRs. Bei gleichem Problem ein bestehendes Issue mit neuen Belegen ergänzen statt ein Duplikat anzulegen. Bereits implementierte und gemergte Lösungen nicht erneut als offene Entwicklungsarbeit melden.
5. Trenne die Ergebnisse nach Zuständigkeit:
   - **Worker-Task → GitHub-Issue:** konkrete Code-, Asset-, Build-, Dokumentations- oder automatisierte Testarbeit. Neue Bugs und eigenständige, begründete Erweiterungsvorschläge dürfen als Issues angelegt werden. Ein Issue enthält Problem/Nutzen, Belege, abgegrenzten Arbeitsumfang, technische Akzeptanzkriterien und Abhängigkeiten. Vorhandene Label-Konvention verwenden. Bloße manuelle Nachprüfung ist kein technisches Akzeptanzhindernis.
   - **Entscheidung → Entscheidungspool:** eine echte Produkt-/Design-/Prioritätsfrage an den Eigentümer. Frage, Kontext, zwei oder mehr Optionen mit Auswirkungen, Empfehlung, Kategorie, Tags und betroffene Issue-Nummern liefern. Nur dann als blockierend kennzeichnen, wenn konkrete Entwicklungsarbeit ohne Antwort tatsächlich nicht sinnvoll fortgesetzt werden kann; genau diese Arbeit und den Grund nennen. Routine-Implementierungsdetails nicht unnötig eskalieren. Eine Entscheidung niemals selbst als beantwortet markieren.
   - **Playtest → persönliche Playtest-Checkliste:** manuelle Quest-, Sicht-, Spielgefühl-, Hardware- und Mehrspielerprüfungen. Titel, Vorbereitung, konkrete Schritte, erwartetes Ergebnis, Kategorie, Modus, Spielweise und Quell-Issue/PR angeben. Offen lassen. Ein Playtest bleibt auch nach einem Merge offen, bis der Mensch den tatsächlich geprüften Build und das Ergebnis erfasst.
6. Bei gemischten Befunden den umsetzbaren Teil als Issue behalten und Entscheidung/Playtest separat mit gegenseitigen Verweisen übergeben. Ein reproduzierter Fehler aus einem Playtest bekommt ein Bug-Issue; der Test selbst bleibt in der Checkliste. Keine zusätzlichen GitHub-Issues allein als Ablage für Entscheidungen oder manuelle Tests anlegen.
7. **Ausschließlich der Eigentümer entscheidet, welche Issues wann in die Queue kommen.** Nichts einreihen, requeuen, einem Worker zuweisen oder durch Queue-/In-progress-Labels aktivieren. Keine bestehenden Prioritäten oder Bearbeitungszustände ungefragt ändern.
8. Wenn du direkten autorisierten Office-Zugriff hast, nutze dessen jeweiligen Entscheidungspool und Playtest-Checkliste. Ohne diesen Zugriff liefere zusätzlich `office-review-handoff.json` zur Übernahme durch den Issue-Agent. Behaupte nicht, diese Einträge bereits im Office erstellt zu haben. Die JSON-Datei ist eine Übergabe, kein bereits vorhandener automatischer Importer.

Format für `office-review-handoff.json`:

```json
{
  "reviewedCommit": "vollstaendiger Commit-SHA",
  "workerIssues": [{"url": "https://github.com/OWNER/REPO/issues/123", "action": "created-or-updated"}],
  "decisions": [{
    "title": "Kurzer Titel", "question": "Konkrete Frage?", "context": "Befund und Auswirkungen",
    "options": ["Option A: Auswirkung", "Option B: Auswirkung"], "recommendation": "Empfehlung mit Grund",
    "category": "Design & UX", "tags": ["menue"], "issues": [123],
    "blocking": false, "blockingReason": ""
  }],
  "playtests": [{
    "title": "Konkreter manueller Test", "setup": "Voraussetzungen und Build",
    "steps": "1. Schritt\n2. Schritt", "expected": "Beobachtbares Soll-Ergebnis",
    "category": "Menü", "modes": ["RIFT"], "playStyles": ["solo"],
    "source": "https://github.com/OWNER/REPO/issues/123"
  }]
}
```

Zulässige Entscheidungskategorien: Spielablauf, Design & UX, Technik, Assets, Release, Organisation, Sonstiges. Playtest-Modi: Allgemein, RB, RIFT, Rooftop, Safe Zone, Gas Station. Spielweisen: solo, local-coop, online-coop; leere Liste bedeutet alle. Mehrere Modi nur angeben, wenn der Test tatsächlich für sie gilt. Reality Breach/RB nicht mit RIFT verwechseln.

Abschluss: geprüften Commit, gefundene Probleme nach Schwere, angelegte/ergänzte Issues mit Links, vermiedene Duplikate, Entscheidungen, Playtests und nicht verifizierte Annahmen auflisten. Queue bleibt unverändert.

## Übergabe an den Issue-Agent

Die JSON-Datei bereitstellen und den Issue-Agent anweisen: „Gleiche diese Review-Übergabe mit den vorhandenen Issues, Entscheidungen und Playtests ab. Übernimm fehlende Entscheidungen in den Entscheidungspool und manuelle Tests als offen in die Playtest-Checkliste. Ergänze gegenseitige Links. Erstelle keine redundanten Issues, starte keine Worker und ändere die Queue nicht. Berichte anschließend die tatsächlich gespeicherten Einträge.“
