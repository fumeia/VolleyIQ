import { PassGrades } from './PassGrades';
import type { TourStep } from './Tour';

/** The guided tours of the public links in German (Swiss spelling: ss, no ß). */

const sections: TourStep = {
  target: '[data-tour="sections"]',
  title: 'Statistik nach Thema',
  text: (
    <ul>
      <li><b>Übersicht</b>: Side-out und Break-Point in %, Satz für Satz, was gut lief und woran wir arbeiten</li>
      <li><b>Rotationen</b>: wie jede Rotation im Aufschlag und in der Annahme abschneidet</li>
      <li><b>Angriff</b>, <b>Aufschlag &amp; Annahme</b>, <b>Zuspiel</b>, <b>Abwehr</b>: Effizienz, Schlagrichtungen, Annahmequalität, wer wen anspielt</li>
      <li><b>Fehler</b>: wie Punkte verschenkt wurden und wie der Gegner gepunktet hat</li>
      <li><b>Spielerinnen und Spieler</b>, <b>Tabellen</b>, <b>Feldkarten</b>: Zahlen pro Person, und wo der Ball gespielt wurde</li>
    </ul>
  ),
};
const passes: TourStep = {
  title: 'So wird die Annahme bewertet',
  text: (
    <>
      <p>Jede Annahme bekommt 0 bis 3, je nachdem wohin sie ging, unsere Hälfte von hinter der Grundlinie gesehen:</p>
      <PassGrades />
    </>
  ),
};
const tone: TourStep = {
  target: '[data-tour="tone"]',
  title: 'Grün ▲ und Rot ▼',
  text: <>Gute Werte sind grün ▲, schwache rot ▼, und nur wenn es genug Versuche gibt, um es zu beurteilen. Tippe auf diese Zeile, um zu lesen, wie es entschieden wird.</>,
};

export function teamTourDe(team: string): TourStep[] {
  return [
    {
      title: team,
      text: (
        <>
          <p>Die Spiele und Resultate des Teams, und Statistiken aus den Matchvideos, Ballkontakt für Ballkontakt erfasst: jeder Aufschlag, jede Annahme, jedes Zuspiel, jeder Angriff, Block und jede Abwehr, wer ihn gespielt hat und wohin der Ball ging.</p>
          <p>Ein kurzer Rundgang in 6 Schritten.</p>
        </>
      ),
    },
    {
      target: '[data-tour="tabs"]',
      title: 'Fünf Ansichten',
      text: (
        <ul>
          <li><b>Übersicht</b>: Spiele, Resultate und die Saison auf einen Blick</li>
          <li><b>Statistik</b>: die Zahlen der Saison oder eines Spiels</li>
          <li><b>Verlauf</b>: wie sie sich von Spiel zu Spiel entwickeln</li>
          <li><b>Spieler</b>: eine Seite für jede Spielerin und jeden Spieler</li>
          <li><b>Videos</b>: die Ballkontakte selbst anschauen</li>
        </ul>
      ),
    },
    {
      target: '[data-tour="games"]',
      title: 'Spiele und Videos',
      text: <>Kommende Spiele und Resultate. Tippe auf ein Spiel für die Halle, das Video und, sobald erfasst, die Statistik. Du kennst ein Video eines Spiels? Schick den Link dort; er erscheint, sobald das Team ihn geprüft hat.</>,
    },
    {
      target: '[data-tour="tab-players"]',
      title: 'Eine Seite pro Person',
      text: <>Unter <b>Spieler</b> auf einen Namen tippen: Stärken, Fehler, Übungstipps (dort einschalten), Grafiken pro Element und wie es sich über die Spiele verändert hat. Die Adresse dieser Seite lässt sich einzeln verschicken.</>,
    },
    {
      target: '[data-tour="tab-replays"]',
      title: 'Jeden Ballkontakt anschauen',
      text: (
        <>
          <p>Jeder erfasste Ballkontakt als kurzer Clip, gefiltert nach Person, Element und Satz, einzeln oder alle hintereinander.</p>
          <p>Ein Kontakt falsch erfasst, oder einer fehlt (z. B. ein Block ohne Berührung)? <b>Korrekturen vorschlagen</b> einschalten und senden.</p>
        </>
      ),
    },
    {
      title: 'Das war der Rundgang',
      text: <>Die Taste <b>? Anleitung</b> in der Ecke bringt ihn jederzeit zurück. Der Statistik-Tab hat einen eigenen kurzen Rundgang.</>,
    },
  ];
}

export function statsTourDe(): TourStep[] {
  return [
    {
      target: '[data-tour="match-picker"]',
      title: 'Saison oder ein Spiel',
      text: <>Statistik und Verlauf zeigen zuerst alle Spiele zusammen. Hier ein Spiel wählen, um nur dieses zu sehen.</>,
    },
    sections,
    passes,
    tone,
    {
      title: 'Das war der Rundgang',
      text: <>Die Taste <b>? Anleitung</b> in der Ecke bringt ihn jederzeit zurück.</>,
    },
  ];
}

export function playerTourDe(name: string): TourStep[] {
  return [
    {
      title: `Seite von ${name}`,
      text: <>Aus den eigenen erfassten Ballkontakten von {name} in allen Spielen. Ein kurzer Blick in 6 Schritten.</>,
    },
    {
      target: '[data-tour="learn"]',
      title: 'Stärken und Fehler',
      text: <>Was in den Zahlen auffällt, gut und schlecht, jeweils mit den Zahlen dahinter.</>,
    },
    {
      target: '[data-tour="tips"]',
      title: 'Übungstipps',
      text: <><b>Übungstipps zeigen</b> einschalten für Übungen, die zu diesen Zahlen passen. Es sind vorbereitete Vorschläge, ausgewählt anhand der erfassten Ballkontakte, keine persönliche Beurteilung.</>,
    },
    {
      target: '.player-charts',
      title: 'Grafiken',
      text: <>Weiter unten: die Grafiken zu Angriff, Aufschlag &amp; Annahme und Feld nur für diese Person, und der Verlauf Spiel für Spiel.</>,
    },
    {
      target: '[data-tour="tabs"]',
      title: 'Das ganze Team',
      text: <>Diese Tabs öffnen die Statistik des Teams, den Verlauf, die anderen Spielerinnen und Spieler und <b>Videos</b>, wo du deine eigenen Ballkontakte als Clips anschauen kannst.</>,
    },
    {
      title: 'Das war der Rundgang',
      text: <>Die Taste <b>? Anleitung</b> in der Ecke bringt ihn jederzeit zurück.</>,
    },
  ];
}

export function matchTourDe(title: string): TourStep[] {
  return [
    {
      title,
      text: <>Die Statistik dieses Spiels, aus dem Video Ballkontakt für Ballkontakt erfasst. Ein kurzer Blick in 5 Schritten.</>,
    },
    {
      target: '[data-tour="tabs"]',
      title: 'Statistik und Berichtsbilder',
      text: <><b>Statistik</b> hat alle Zahlen; <b>Berichtsbilder</b> hat ein paar Bilder, bereit zum Versenden im Chat.</>,
    },
    sections,
    passes,
    {
      title: 'Das war der Rundgang',
      text: <>Die Taste <b>? Anleitung</b> in der Ecke bringt ihn jederzeit zurück.</>,
    },
  ];
}
