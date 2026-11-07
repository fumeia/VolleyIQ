/** German texts of the public link (Swiss spelling: ss, no ß). Keys are the English texts. */
export const DE: Record<string, string> = {
  // tabs, header, general
  'Overview': 'Übersicht', 'Stats': 'Statistik', 'Trends': 'Verlauf', 'Players': 'Spieler', 'Replays': 'Videos', 'All games': 'Alle Spiele',
  'Report images': 'Berichtsbilder', '1 match': '1 Spiel', '{n} matches': '{n} Spiele', 'Copy link': 'Link kopieren',
  'This link is invalid or was revoked.': 'Dieser Link ist ungültig oder wurde zurückgezogen.',
  'This report link is invalid or was revoked.': 'Dieser Bericht-Link ist ungültig oder wurde zurückgezogen.',
  'All players': 'Alle Spieler', '{n} touches': '{n} Ballkontakte', 'All matches ({n})': 'Alle Spiele ({n})',
  'Show practice tips': 'Übungstipps zeigen', 'Failed': 'Fehlgeschlagen', 'All': 'Alle', 'or': 'oder', 'of': 'von',
  'Guide': 'Anleitung', 'A short tour of this page': 'Ein kurzer Rundgang durch diese Seite', 'Skip tour': 'Rundgang überspringen',
  'Back': 'Zurück', 'Next': 'Weiter', 'Done': 'Fertig', 'Show me': 'Zeig es mir',

  // overview
  'Next game': 'Nächstes Spiel', 'at {team}': 'auswärts bei {team}', 'vs {team}': 'gegen {team}', 'Games': 'Spiele',
  '{n} with video': '{n} mit Video', 'Nothing here yet.': 'Noch nichts hier.', 'Season': 'Saison', 'won': 'gewonnen', 'lost': 'verloren',
  'W': 'S', 'L': 'N', 'From the tagged matches': 'Aus den erfassten Spielen', 'Side-out': 'Side-out', 'Break point': 'Break-Point',
  'Attack eff.': 'Angriff Eff.', 'Pass avg': 'Annahme-Schnitt', 'Serve eff.': 'Aufschlag Eff.', 'Transition': 'Transition', '+/−': '+/−',
  '{n} attacks': '{n} Angriffe', '{n} passes': '{n} Annahmen', 'All stats': 'Ganze Statistik', 'Leaders': 'Beste',
  'Points': 'Punkte', 'Kills': 'Angriffspunkte', 'Aces': 'Asse', 'Blocks': 'Blockpunkte', 'Tagged matches': 'Erfasste Spiele',
  'Date': 'Datum', 'Result': 'Resultat', 'League': 'Liga', 'Hall': 'Halle', 'cancelled': 'abgesagt',
  'Stats of this game': 'Statistik dieses Spiels',
  'Thanks, the video was sent. It shows here once the team has checked it.': 'Danke, das Video wurde gesendet. Es erscheint hier, sobald das Team es geprüft hat.',
  'Know a better video of this game?': 'Ein besseres Video dieses Spiels bekannt?', 'Know a video of this game? Send the link': 'Ein Video dieses Spiels bekannt? Link senden',
  'Video link': 'Video-Link', 'Your shirt number': 'Deine Trikotnummer', 'Note (optional)': 'Notiz (freiwillig)', 'Sending…': 'Wird gesendet…', 'Send': 'Senden',

  'vs': 'gg.', '{a}/{b} on their serve': '{a}/{b} bei ihrem Aufschlag', '{a}/{b} on our serve': '{a}/{b} bei unserem Aufschlag',
  '1 ace': '1 Ass', '{n} aces': '{n} Asse', '1 error': '1 Fehler', '{n} errors': '{n} Fehler', '1 point': '1 Punkt', '{n} points': '{n} Punkte', 'kills from {n} digs': 'Punkte aus {n} Abwehren',

  'Live': 'Live', 'Final': 'Schluss', 'updated just now': 'gerade aktualisiert', 'updated {n} min ago': 'vor {n} Min. aktualisiert', 'Us': 'Wir',

  // schedule table
  'Upcoming': 'Kommende', 'Results': 'Resultate', 'No more games scheduled.': 'Keine weiteren Spiele angesetzt.', 'No games played yet.': 'Noch keine Spiele gespielt.',
  'Game': 'Spiel', 'Time': 'Zeit', 'Sets': 'Sätze', 'tagged': 'erfasst', 'video': 'Video', 'Show all {n}': 'Alle {n} zeigen',

  // replays
  'Team': 'Team', 'No tagged touches with video times yet.': 'Noch keine erfassten Ballkontakte mit Videozeit.', 'Loading the match video…': 'Das Matchvideo wird geladen…',
  'Choose your copy of the match video': 'Deine Kopie des Matchvideos wählen', 'The team video could not be loaded.': 'Das Teamvideo konnte nicht geladen werden.',
  'It plays here on your device and is not uploaded.': 'Es läuft hier auf deinem Gerät und wird nicht hochgeladen.',
  'The video file used for tagging is called': 'Die Videodatei für das Erfassen heisst', 'Your copy': 'Deine Kopie', 'change': 'ändern',
  'back to the team video': 'zurück zum Teamvideo', 'Download the video': 'Video herunterladen', 'original': 'Original', 'Video not playing?': 'Video läuft nicht?', 'Try the smaller 480p version': 'Die kleinere 480p-Version versuchen',
  'use your own copy instead': 'stattdessen die eigene Kopie verwenden', 'Use your own copy instead': 'Stattdessen die eigene Kopie verwenden',
  'Playlists': 'Playlists', 'All touches': 'Alle Ballkontakte', 'All sets': 'Alle Sätze', 'Set {n}': 'Satz {n}', 'Errors': 'Fehler',
  'Play all {n}': 'Alle {n} abspielen', 'Short clips': 'Kurze Clips', 'Long clips': 'Lange Clips', 'Suggest corrections': 'Korrekturen vorschlagen',
  'Missing touch? Add one at the current video time': 'Ballkontakt fehlt? Hier bei der aktuellen Videozeit hinzufügen',
  'Sent: a new touch at {t}.': 'Gesendet: ein neuer Ballkontakt bei {t}.', 'Sent: your correction.': 'Gesendet: deine Korrektur.',
  'sent': 'gesendet', 'edit': 'ändern', 'No touches match these filters.': 'Keine Ballkontakte für diese Filter.',
  'Slow-mo': 'Zeitlupe', 'Slow motion': 'Zeitlupe', 'Back to normal speed': 'Zurück zur normalen Geschwindigkeit', 'frame': 'Bild',
  'One frame back': 'Ein Bild zurück', 'One frame forward': 'Ein Bild vorwärts',

  'private': 'privat', 'Your own playlists: your shirt number': 'Eigene Playlists: deine Trikotnummer', 'Name of the playlist': 'Name der Playlist',
  'Show it to the whole team? (Cancel = only for you)': 'Für das ganze Team sichtbar? (Abbrechen = nur für dich)', 'New playlist': 'Neue Playlist',
  'Add clips to': 'Clips hinzufügen zu', 'Public · make private': 'Öffentlich · privat machen', 'Private · make public': 'Privat · öffentlich machen',
  'New name': 'Neuer Name', 'Rename': 'Umbenennen', 'Delete the playlist?': 'Playlist löschen?', 'Delete': 'Löschen', 'Add to {name}': 'Zu {name} hinzufügen',
  'in it': 'drin', 'add': 'hinzu', 'Remove from the playlist': 'Aus der Playlist entfernen', 'remove': 'entfernen',

  // correction sheet
  'Who': 'Wer', 'What': 'Was', 'Where': 'Wo', 'Could not send': 'Konnte nicht senden', 'New touch': 'Neuer Ballkontakt', 'Edit': 'Ändern',
  'Who played it?': 'Wer hat ihn gespielt?', 'Pass grade (3 = perfect)': 'Annahme-Note (3 = perfekt)', 'as the camera sees it': 'so wie die Kamera es sieht',
  'Keep': 'Behalten', 'Keep tagged spot': 'Erfasste Stelle behalten', 'Skip': 'Überspringen', 'Player': 'Spieler', 'Action': 'Aktion',
  'Court spot': 'Stelle im Feld', 'set': 'gesetzt', 'changed': 'geändert', 'required': 'nötig', 'Pick who played it': 'Wählen, wer ihn gespielt hat',
  'Nothing changed yet': 'Noch nichts geändert', 'Enter your shirt number': 'Deine Trikotnummer eingeben',
  'Checked in the app before it changes anything.': 'Wird in der App geprüft, bevor sich etwas ändert.',

  // actions and their prompts
  'Serve': 'Aufschlag', 'Pass': 'Annahme', 'Set': 'Zuspiel', 'Attack': 'Angriff', 'Block': 'Block', 'Defence': 'Abwehr',
  'Attack Error': 'Angriffsfehler', 'Serve Error': 'Aufschlagfehler', 'Dig Error': 'Abwehrfehler', 'Attack Blocked': 'Angriff geblockt',
  'Block Error': 'Blockfehler', 'Dig': 'Abwehr', 'Free Ball': 'Freeball', 'Block Touch': 'Blockberührung', 'Block, no touch': 'Block ohne Berührung',
  'Kill': 'Angriffspunkt', 'Serve Ace': 'Ass', 'Block Point': 'Blockpunkt', 'Bump set': 'Bagger-Zuspiel', 'Bump set error': 'Fehler Bagger-Zuspiel',
  'Set Error': 'Zuspielfehler', 'Receive': 'Annahme', 'Opponent Error': 'Fehler Gegner', 'Opponent Point': 'Punkt Gegner',
  'Att Err': 'Ang.-Fehler', 'Srv Err': 'Aufschl.-Fehler', 'Dig Err': 'Abw.-Fehler', 'Blocked': 'Geblockt', 'Blk Err': 'Blockfehler', 'Free': 'Freeball',
  'Blk Touch': 'Blockberührung', 'Blk none': 'Block ohne', 'Ace': 'Ass', 'Blk Pt': 'Blockpunkt', 'Bump err': 'Bagger-Fehler', 'Set Err': 'Zusp.-Fehler',
  'Rec': 'Annahme', 'Opp Err': 'Fehler Geg.', 'Opp Pt': 'Punkt Geg.',
  'Where?': 'Wo?', 'Where along the net was the block?': 'Wo am Netz war der Block?', 'Where was it received?': 'Wo wurde angenommen?',
  'Where was the attack hit from?': 'Von wo wurde angegriffen?', 'Where was the dig?': 'Wo war die Abwehr?', 'Where was the free ball played?': 'Wo wurde der Freeball gespielt?',
  'Where was the serve hit from?': 'Von wo wurde aufgeschlagen?', 'Where was the set made?': 'Wo wurde zugespielt?', 'Where along the net?': 'Wo am Netz?',
  'Where did it go (out / net)?': 'Wohin ging er (Aus / Netz)?', 'Where did it go?': 'Wohin ging er?', 'Where did it land?': 'Wo landete er?',
  'Where did the ball go?': 'Wohin ging der Ball?', 'Where did the pass go?': 'Wohin ging die Annahme?', 'Where did the set go?': 'Wohin ging das Zuspiel?',
  'Where was it blocked?': 'Wo wurde er geblockt?',

  // roles
  'Outside Hitter': 'Aussenangriff', 'Opposite': 'Diagonal', 'Middle Blocker': 'Mittelblock', 'Setter': 'Zuspiel', 'Libero': 'Libero',
  'Defensive Specialist': 'Abwehrspezialist',

  // stats topics and notes
  'Rotations': 'Rotationen', 'Serve & pass': 'Aufschlag & Annahme', 'Setting': 'Zuspiel', 'Tables': 'Tabellen', 'Court maps': 'Feldkarten',
  'How green ▲ / red ▼ are decided': 'Wie Grün ▲ / Rot ▼ entschieden wird', 'What went well': 'Was gut lief', 'To work on': 'Woran arbeiten',
  'No confirmed tags yet. Start tagging to see stats.': 'Noch keine bestätigten Ballkontakte.',
  'Green ▲ / red ▼ compare with fixed club-level benchmarks, not with teammates: e.g. attack or serve efficiency above / below 0, ace % ≥ 10%, serve errors ≤ 10% good and ≥ 20% bad, pass average ≥ 2.1 good and < 1.6 bad. Greyed numbers come from too few attempts (usually under 5) to judge.':
    'Grün ▲ / Rot ▼ vergleichen mit festen Richtwerten für Vereinsniveau, nicht mit Teamkollegen: z. B. Angriffs- oder Aufschlageffizienz über / unter 0, Ass-Quote ≥ 10 %, Aufschlagfehler ≤ 10 % gut und ≥ 20 % schlecht, Annahme-Schnitt ≥ 2,1 gut und < 1,6 schlecht. Graue Zahlen beruhen auf zu wenigen Versuchen (meist unter 5).',
  'NET': 'NETZ', "within 1.5 m of the setter's spot": 'bis 1,5 m vom Zuspielort', 'within 3 m': 'bis 3 m',
  'elsewhere, the set is harder (an overpass too)': 'anderswo, das Zuspiel ist schwieriger (auch ein Ball direkt hinüber)', 'out of play, or aced': 'nicht spielbar, oder Ass',

  // all games
  'Women': 'Frauen', 'Men': 'Männer', 'Mixed': 'Mixed', 'All of Switzerland': 'Ganze Schweiz', 'whole season': 'ganze Saison',
  'results': 'Resultate', 'upcoming': 'kommende', 'videos to check': 'Videos zu prüfen', 'with video': 'mit Video', 'Filters': 'Filter',
  'Region': 'Region', 'Period': 'Zeitraum', 'Week': 'Woche', 'Dates': 'Daten', 'Pick a region first': 'Zuerst eine Region wählen',
  'This week': 'Diese Woche', 'From – to': 'Von – bis', 'at most a month without a region': 'höchstens ein Monat ohne Region',
  'Last 7 days': 'Letzte 7 Tage', 'Last 30 days': 'Letzte 30 Tage', 'Teams': 'Teams', 'All leagues': 'Alle Ligen', 'Search': 'Suche',
  'Team, hall or town': 'Team, Halle oder Ort', 'Videos': 'Videos', 'To check': 'Zu prüfen', 'With video': 'Mit Video',
  'Reading Swiss Volley…': 'Swiss Volley wird gelesen…', '1 game': '1 Spiel', '{n} games': '{n} Spiele', 'Show more ({n} left)': 'Mehr zeigen (noch {n})',
  'No games for these filters.': 'Keine Spiele für diese Filter.', 'Video': 'Video', 'Not played yet.': 'Noch nicht gespielt.',
};
