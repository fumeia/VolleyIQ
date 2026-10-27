import { describe, expect, it } from 'vitest';
import { anonymousExport } from './anonymize';

describe('training export', () => {
  it('keeps shirt numbers, roles and tags, and no names, teams, opponents or dates', () => {
    const out = anonymousExport({
      team: { id: 1, name: 'Secret Team', coach: 'Coach Name' },
      players: [{ id: 5, team_id: 1, name: 'Jane Doe', number: 7, role: 'OH', active: 1 }],
      matches: [{ id: 3, team_id: 1, label: 'vs Rivals', opponent: 'Rivals', played_on: '2026-10-20', mode: 'video', video_type: 'local', video_ref: 'jane_match.mp4', share_token: 'tok', calibration: null, lineups: null, sheet: null }],
      events: [{ id: 9, match_id: 3, player_id: 5, jersey: null, action: 'kill', value: null, zone: 4, x: 1, y: 15, t: 12.5, set_no: 1, source: 'manual', status: 'confirmed', confidence: null, client_id: 'c1' }],
    } as never);
    const text = JSON.stringify(out);
    for (const secret of ['Secret Team', 'Coach Name', 'Jane', 'Rivals', '2026-10-20', 'jane_match', 'tok', 'c1']) expect(text).not.toContain(secret);
    expect(out.players).toEqual([{ id: 5, number: 7, role: 'OH' }]);
    expect(out.events[0]).toMatchObject({ jersey: 7, action: 'kill', t: 12.5 });
    expect(out.matches[0].label).toBe('Match 1');
  });
});
