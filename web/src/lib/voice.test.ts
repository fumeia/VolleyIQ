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
});
