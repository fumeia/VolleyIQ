import { ATTACK_CODES, TIP, type ActionCode } from './actions';

/**
 * Spoken tags. A phrase is a shirt number and what that player did, several in a row:
 * "seven pass two, one set, five kill" / "sieben Annahme zwei, eins Zuspiel, fünf Punkt".
 * Also the rally's end without a player ("our point", "their point" / "Punkt für uns",
 * "Punkt Gegner") and "undo" / "zurück". Speech engines mostly write numbers as digits;
 * number words work too. Words that mean nothing here are skipped.
 */

export type VoiceCommand =
  | { kind: 'tag'; jersey: number | null; action: ActionCode; value: number | null; heard: string }
  | { kind: 'won'; heard: string }
  | { kind: 'lost'; heard: string }
  | { kind: 'undo'; heard: string };

const NUM_EN = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const NUM_DE = ['null', 'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn', 'elf', 'zwölf', 'dreizehn', 'vierzehn', 'fünfzehn', 'sechzehn', 'siebzehn', 'achtzehn', 'neunzehn', 'zwanzig'];
const UNITS_DE = ['', 'ein', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun'];
const TENS_EN: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const TENS_DE: Record<string, number> = { zwanzig: 20, dreissig: 30, dreißig: 30, vierzig: 40, fünfzig: 50, sechzig: 60, siebzig: 70, achtzig: 80, neunzig: 90 };

/** A number from digits or a number word (English or German, up to 99), else null. */
export function numberWord(w: string): number | null {
  if (/^\d{1,2}$/.test(w)) return Number(w);
  const en = NUM_EN.indexOf(w);
  if (en >= 0) return en;
  const de = NUM_DE.indexOf(w);
  if (de >= 0) return de;
  // Not "ein" / "eine": in a sentence that is "a" ("eine Annahme"); players are "eins".
  if (w === 'one') return 1;
  if (w === 'zwo') return 2;
  if (TENS_EN[w]) return TENS_EN[w];
  const enCompound = w.match(/^(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)-?(one|two|three|four|five|six|seven|eight|nine)$/);
  if (enCompound) return TENS_EN[enCompound[1]] + NUM_EN.indexOf(enCompound[2]);
  if (TENS_DE[w]) return TENS_DE[w];
  // German: "einundzwanzig" = 1 + 20
  const deCompound = w.match(/^(ein|zwei|drei|vier|fünf|sechs|sieben|acht|neun)und(zwanzig|dreissig|dreißig|vierzig|fünfzig|sechzig|siebzig|achtzig|neunzig)$/);
  if (deCompound) return UNITS_DE.indexOf(deCompound[1]) + TENS_DE[deCompound[2]];
  return null;
}

/** Action words (lower case, both languages) and the action they mean. */
const WORDS: [string[], ActionCode][] = [
  [['kill', 'kills', 'killed', 'scores', 'scored', 'punkt', 'point', 'winner', 'smash', 'verwandelt', 'versenkt'], 'kill'],
  [['attack', 'attacks', 'attacked', 'hit', 'hits', 'spike', 'spikes', 'spiked', 'angriff', 'schlag', 'angreifen', 'greift', 'angegriffen', 'smasht'], 'attack'],
  [['ace', 'aces', 'ass', 'asse'], 'ace'],
  [['serve', 'serves', 'served', 'serving', 'service', 'aufschlag', 'aufschläge', 'serviert'], 'serve'],
  [['pass', 'passes', 'passed', 'receive', 'receives', 'received', 'reception', 'annahme', 'nimmt', 'angenommen', 'empfang'], 'receive'],
  [['set', 'sets', 'setting', 'zuspiel', 'stellt', 'zugespielt', 'spielt'], 'set'],
  [['dig', 'digs', 'dug', 'defence', 'defense', 'abwehr', 'verteidigung', 'verteidigt', 'wehrt', 'abgewehrt'], 'dig'],
  [['block', 'blocks', 'blocked', 'blockt', 'blockiert'], 'block_touch'],
  [['freeball', 'free'], 'freeball'],
  [['bagger', 'bump'], 'assist'],
];
/** A pass grade word, with German endings ("perfekten", "schlechte"). */
function gradeOf(w: string): number | null {
  if (GRADE_WORDS[w] != null) return GRADE_WORDS[w];
  if (/^perfekt(e|er|en|es|em)?$/.test(w)) return 3;
  if (/^gut(e|er|en|es|em)?$/.test(w)) return 2;
  if (/^(schlecht|schwach)(e|er|en|es|em)?$/.test(w)) return 1;
  return null;
}

/** Pass grades said as words, before or after the pass ("good pass", "Annahme schlecht"). */
const GRADE_WORDS: Record<string, number> = {
  perfect: 3, perfectly: 3, perfekt: 3, perfekte: 3, perfekter: 3, excellent: 3,
  good: 2, well: 2, gut: 2, gute: 2, guter: 2, guten: 2, okay: 2, ok: 2,
  bad: 1, poor: 1, poorly: 1, badly: 1, schlecht: 1, schlechte: 1, schlechter: 1, schwach: 1, schwache: 1,
};
const ERROR_WORDS = ['error', 'fault', 'out', 'net', 'fehler', 'aus', 'netz', 'falsch'];
const ERROR_OF: Partial<Record<ActionCode, ActionCode>> = {
  attack: 'attack_error', kill: 'attack_error', serve: 'serve_error', ace: 'serve_error', set: 'set_error', assist: 'assist_error',
  dig: 'dig_error', block_touch: 'block_error', block_point: 'block_error',
};
const POINT_WORDS = ['point', 'punkt'];
/** A tip or feint: a soft placed attack ("5 tip kill", "Finte Punkt", "neun legt den Ball"). */
const TIP_WORDS = ['tip', 'tips', 'tipped', 'tipping', 'feint', 'feints', 'feinted', 'dink', 'dinks', 'finte', 'finten', 'lob', 'lobt', 'legt', 'gelegt', 'leger'];

function actionOf(w: string): ActionCode | null {
  for (const [list, a] of WORDS) if (list.includes(w)) return a;
  // German compounds: Angriffsfehler, Aufschlagfehler, Annahmefehler, Blockpunkt …
  if (/^angriffs?fehler$/.test(w)) return 'attack_error';
  if (/^aufschlag(s)?fehler$/.test(w)) return 'serve_error';
  if (/^zuspiel(s)?fehler$/.test(w)) return 'set_error';
  if (/^abwehrfehler$/.test(w)) return 'dig_error';
  if (/^blockfehler$/.test(w)) return 'block_error';
  if (/^blockpunkt$/.test(w)) return 'block_point';
  return null;
}

/** Splits a transcript into words: lower case, punctuation off, "#7" and "7er" become 7. */
export function words(text: string): string[] {
  return text.toLowerCase()
    .replace(/[#.,;:!?"'()]/g, ' ')
    .replace(/(\d+)(er|te|th|st|nd|rd)\b/g, '$1')
    .split(/\s+/).filter(Boolean);
}

/**
 * The commands in a transcript, in order. A number is a shirt number, except right after a pass,
 * where 0-3 is the pass grade.
 */
export function parseVoice(text: string): VoiceCommand[] {
  const w = words(text);
  const out: VoiceCommand[] = [];
  let jersey: number | null = null;
  let cur: Extract<VoiceCommand, { kind: 'tag' }> | null = null;
  let pendingGrade: number | null = null;

  for (let i = 0; i < w.length; i++) {
    const x = w[i], next = w[i + 1];
    // Rally end and undo.
    if (['undo', 'zurück', 'rückgängig', 'löschen', 'delete'].includes(x)) { out.push({ kind: 'undo', heard: x }); cur = null; jersey = null; continue; }
    const ours = (x === 'our' || x === 'we' || x === 'unser' || x === 'wir') && next && (POINT_WORDS.includes(next) || next === 'won' || next === 'gewonnen' || next === 'scored');
    const theirs = (x === 'their' || x === 'they' || x === 'gegner' || x === 'die') && next && (POINT_WORDS.includes(next) || next === 'won' || next === 'scored');
    if (ours) { out.push({ kind: 'won', heard: `${x} ${next}` }); i++; cur = null; jersey = null; continue; }
    if (theirs) { out.push({ kind: 'lost', heard: `${x} ${next}` }); i++; cur = null; jersey = null; continue; }
    if (POINT_WORDS.includes(x) && (next === 'für' || next === 'for') && w[i + 2]) {
      const who = w[i + 2];
      if (['uns', 'us'].includes(who)) { out.push({ kind: 'won', heard: `${x} ${next} ${who}` }); i += 2; cur = null; jersey = null; continue; }
      if (['sie', 'them', 'gegner', 'den'].includes(who)) { out.push({ kind: 'lost', heard: `${x} ${next} ${who}` }); i += 2 + (who === 'den' && w[i + 3] === 'gegner' ? 1 : 0); cur = null; jersey = null; continue; }
    }
    if (x === 'punkt' && next === 'gegner') { out.push({ kind: 'lost', heard: 'punkt gegner' }); i++; cur = null; jersey = null; continue; }

    // Speech engines write a spoken "two" after a pass as "to" or "too".
    const open = cur as Extract<VoiceCommand, { kind: 'tag' }> | null;
    const n: number | null = (x === 'to' || x === 'too') && open?.action === 'receive' && open.value == null ? 2 : numberWord(x);
    if (n != null) {
      // A pass grade (0-3) right after a pass, unless a player who goes on to do something ("7 pass, 1 set").
      if (cur?.action === 'receive' && cur.value == null && n <= 3 && !(next && actionOf(next))) { cur.value = n; cur.heard += ` ${x}`; continue; }
      jersey = n;
      cur = null;
      pendingGrade = null;
      continue;
    }
    if (ERROR_WORDS.includes(x)) {
      if (cur) {
        if (cur.action === 'receive') { cur.value = 0; cur.heard += ` ${x}`; continue; }
        const err = ERROR_OF[cur.action];
        if (err) { cur.action = err; cur.heard += ` ${x}`; }
        continue;
      }
      continue;
    }
    if (x === 'point' || x === 'punkt') {
      // "block point" / "Block Punkt": the block made the point.
      if (cur?.action === 'block_touch') { cur.action = 'block_point'; cur.heard += ` ${x}`; continue; }
      if (cur?.action === 'attack') { cur.action = 'kill'; cur.heard += ` ${x}`; continue; }
    }
    const isAttack = (c: typeof cur) => !!c && ATTACK_CODES.includes(c.action);
    if (TIP_WORDS.includes(x)) {
      if (isAttack(cur) && cur!.jersey === jersey) { cur!.value = TIP; cur!.heard += ` ${x}`; continue; }
      cur = { kind: 'tag', jersey, action: 'attack', value: TIP, heard: jersey != null ? `${jersey} ${x}` : x };
      out.push(cur);
      continue;
    }
    // An attack that was blocked ("5 attack blocked", "Finte geblockt"), not a block of ours.
    if ((x === 'blocked' || x === 'geblockt') && isAttack(cur)) { cur!.action = 'attack_blocked'; cur!.heard += ` ${x}`; continue; }
    // "schlägt auf" is a serve, "schlägt" alone an attack.
    let a = actionOf(x);
    if (x === 'schlägt') { a = next === 'auf' ? 'serve' : 'attack'; if (next === 'auf') i++; }
    if (a) {
      if (x === 'free' && next === 'ball') i++;
      // The same touch said twice ("passes … a good pass"): keep one.
      if (cur && cur.action === a && cur.jersey === jersey) continue;
      // "tip kill" / "attack … kill": the attack scored.
      if (a === 'kill' && cur?.action === 'attack' && cur.jersey === jersey) { cur.action = 'kill'; cur.heard += ` ${x}`; continue; }
      cur = { kind: 'tag', jersey, action: a, value: a === 'receive' ? pendingGrade : null, heard: jersey != null ? `${jersey} ${x}` : x };
      pendingGrade = null;
      out.push(cur);
      continue;
    }
    const grade = gradeOf(x);
    if (grade != null) {
      if (cur?.action === 'receive') { cur.value = grade; cur.heard += ` ${x}`; } else pendingGrade = grade;
      continue;
    }
    // "a pass by seven" / "Annahme von sieben": the player after the touch.
    if ((x === 'by' || x === 'from' || x === 'von') && cur && cur.jersey == null && next != null && numberWord(next) != null) {
      cur.jersey = numberWord(next); cur.heard = `${cur.jersey} ${cur.heard}`; i++;
      continue;
    }
  }
  return out;
}
