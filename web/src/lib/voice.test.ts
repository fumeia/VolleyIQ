import { describe, expect, it } from 'vitest';
import { numberWord, parseVoice } from './voice';

const tags = (text: string) =>
  parseVoice(text).map((c) => (c.kind === 'tag' ? `${c.jersey ?? '-'}:${c.action}${c.value != null ? `=${c.value}` : ''}` : c.kind));

describe('voice tagging', () => {
  it('reads numbers as digits and words', () => {
    expect([numberWord('7'), numberWord('seven'), numberWord('sieben'), numberWord('zwölf'), numberWord('einundzwanzig'), numberWord('twenty-one')]).toEqual([7, 7, 7, 12, 21, 21]);
  });

  it('English: a rally in one breath', () => {
    expect(tags('seven pass two, one set, five kill')).toEqual(['7:receive=2', '1:set', '5:kill']);
    expect(tags('7 pass 3 1 set 12 attack error')).toEqual(['7:receive=3', '1:set', '12:attack_error']);
    expect(tags('nine serve error')).toEqual(['9:serve_error']);
    expect(tags('17 receive error')).toEqual(['17:receive=0']);
    expect(tags('12 block point')).toEqual(['12:block_point']);
  });

  it('German', () => {
    expect(tags('sieben Annahme zwei, eins Zuspiel, fünf Punkt')).toEqual(['7:receive=2', '1:set', '5:kill']);
    expect(tags('12 Aufschlagfehler')).toEqual(['12:serve_error']);
    expect(tags('neun Angriff Fehler')).toEqual(['9:attack_error']);
    expect(tags('17 Annahme 1 9 Abwehr')).toEqual(['17:receive=1', '9:dig']);
    expect(tags('5 Ass')).toEqual(['5:ace']);
  });

  it('rally ends and undo', () => {
    expect(tags('our point')).toEqual(['won']);
    expect(tags('their point')).toEqual(['lost']);
    expect(tags('Punkt für uns')).toEqual(['won']);
    expect(tags('Punkt für den Gegner')).toEqual(['lost']);
    expect(tags('Punkt Gegner')).toEqual(['lost']);
    expect(tags('undo')).toEqual(['undo']);
    expect(tags('zurück')).toEqual(['undo']);
  });

  it('a pass grade is not taken for a player who acts next', () => {
    // "7 pass, 1 set": 1 is the setter, not the grade.
    expect(tags('7 pass 1 set 5 attack')).toEqual(['7:receive', '1:set', '5:attack']);
  });

  it('full sentences', () => {
    expect(tags('Number seven makes a good pass, then one sets and five scores')).toEqual(['7:receive=2', '1:set', '5:kill']);
    expect(tags('seven passes perfectly')).toEqual(['7:receive=3']);
    expect(tags('seven pass to')).toEqual(['7:receive=2']);
    expect(tags('a bad pass by twelve, nine attacks out')).toEqual(['12:receive=1', '9:attack_error']);
    expect(tags('Sieben nimmt den Ball schlecht an, eins stellt, fünf greift an')).toEqual(['7:receive=1', '1:set', '5:attack']);
    expect(tags('Zwölf schlägt auf ins Aus')).toEqual(['12:serve_error']);
    expect(tags('Neun schlägt den Ball ins Netz')).toEqual(['9:attack_error']);
    expect(tags('eine gute Annahme von sieben')).toEqual(['7:receive=2']);
    expect(tags('Sieben mit einer perfekten Annahme')).toEqual(['7:receive=3']);
  });

  it('recycle off the block', () => {
    expect(tags('five recycle')).toEqual(['5:attack=3']);
    expect(tags('9 attack recycled')).toEqual(['9:attack=3']);
    expect(tags('Neun Recycle')).toEqual(['9:attack=3']);
  });
  it('tips and feints', () => {
    expect(tags('five tip kill')).toEqual(['5:kill=1']);
    expect(tags('seven feints, out')).toEqual(['7:attack_error=1']);
    expect(tags('9 attack tip')).toEqual(['9:attack=1']);
    expect(tags('12 tip blocked')).toEqual(['12:attack_blocked=1']);
    expect(tags('Fünf Finte Punkt')).toEqual(['5:kill=1']);
    expect(tags('neun legt den Ball, Punkt')).toEqual(['9:kill=1']);
    expect(tags('7 pass 2, 1 set, 5 tip, our point')).toEqual(['7:receive=2', '1:set', '5:attack=1', 'won']);
    // A hit stays a hit, and "attack … kill" is one kill.
    expect(tags('five attack kill')).toEqual(['5:kill']);
  });

  it('off the block', () => {
    expect(tags('five off the block')).toEqual(['5:kill=2']);
    expect(tags('9 attack off the block')).toEqual(['9:kill=2']);
    expect(tags('twelve tool')).toEqual(['12:kill=2']);
    expect(tags('5 attack block out')).toEqual(['5:kill=2']);
    expect(tags('Fünf Angriff vom Block')).toEqual(['5:kill=2']);
    expect(tags('neun Blockaus')).toEqual(['9:kill=2']);
    expect(tags('7 off the block in play')).toEqual(['7:attack=2']);
    // Our own block that went out stays a block error.
    expect(tags('12 block out')).toEqual(['12:block_error']);
  });

  it('words that sound alike', () => {
    expect(tags('seven past two one set five kil')).toEqual(['7:receive=2', '1:set', '5:kill']);
    // "five" written as a time: the number stays, the rest of the phrase was not heard.
    expect(tags('seven past two one set 5:00')).toEqual(['7:receive=2', '1:set']);
    expect(tags('nine attic out')).toEqual(['9:attack_error']);
    expect(tags('twelve receve perfect')).toEqual(['12:receive=3']);
    expect(tags('four serwe error')).toEqual(['4:serve_error']);
    expect(tags('Sieben Anname zwei')).toEqual(['7:receive=2']);
  });
});

