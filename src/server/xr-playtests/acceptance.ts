import type { Playtests } from '../playtests.js';
/** Manual acceptance remains in the human checklist, never an issue or queue item. */
export function registerXrAcceptance(store: Playtests, actor: string) {
  const common = { category: 'XR-Testbegleitung', source: 'https://github.com/AgentSystemLabs/agent-office/pull/348', modes: ['Allgemein'], playStyles: [] };
  for (const test of [
    { title: 'XR-Begleitung: Moduswechsel, Hinweise und Verbindungsabbruch',
      steps: 'Development-Build mit dem PC-Helfer koppeln. RIFT Solo starten, danach RB und Koop öffnen. Hinweise ausblenden/einblenden, pausieren/fortsetzen. Headset absetzen, Verbindung kurz trennen, erneut verbinden und beenden.',
      expected: 'Nur passende Tests sind aktiv. Keine automatischen Eingaben oder Häkchen. Absetzen/Verbindungsverlust stoppt die Auswertung; Hinweise verschwinden nach Helferabbruch. Beenden entfernt die Hinweise.' },
    { title: 'XR-Begleitung: Zwei Headsets und Fehlerbelege',
      playStyles: ['local-coop', 'online-coop'],
      steps: 'Zwei Headsets mit gleichem Development-Build und Host/Gast derselben Koop-Gruppe koppeln. Ein Gerät trennen und wieder verbinden. Fehler im Headset markieren, Screenshot anfordern und im Office eine Beschreibung an den Issue-Agent senden.',
      expected: 'Geräte und Builds bleiben getrennt zugeordnet; keine Koop-Bestätigung bei fehlendem Partner. Fehler enthält passende Belege; die Issue-Queue bleibt unverändert. Sichtprüfung und tatsächliches Testbestehen selbst dokumentieren.' },
  ]) store.add({ ...common, ...test }, actor);
}
