import type { VEvent } from './api';
import { buildRallies } from './sequence';
import { replaySet, type MatchSheetFlow } from './sheetFlow';

/**
 * Tagged points against the match sheet, set by set: both are lists of points (who
 * served, who won). They are lined up so that as many points as possible agree (same
 * winner, and the same server where the tags know it); what is left over is a point
 * tagged too many, one missing, or one given to the wrong team.
 */

type Team = 'us' | 'them';
interface Pt { winner: Team; server: Team | null }
export interface Tagged extends Pt { t: number | null; end: VEvent }

export type Diff =
  | { kind: 'extra'; tagged: Tagged; sheetScore: { us: number; them: number } }
  | { kind: 'missing'; sheet: Pt; sheetScore: { us: number; them: number }; after: Tagged | null }
  | { kind: 'wrong'; tagged: Tagged; sheet: Pt; sheetScore: { us: number; them: number } };

export interface SetCheck {
  set: number;
  tagged: { us: number; them: number };
  sheet: { us: number; them: number };
  /** false: the sheet's rounds for this set did not add up, so only the totals are compared. */
  sheetOk: boolean;
  diffs: Diff[];
}

/** The tagged points of a set, in video order. */
export function taggedPoints(events: VEvent[], set: number): Tagged[] {
  return buildRallies(events.filter((e) => e.status === 'confirmed' && (e.set_no ?? 1) === set))
    .filter((r) => r.won != null && r.end)
    .map((r) => ({ winner: r.won ? 'us' : 'them', server: r.weServed == null ? null : r.weServed ? 'us' : 'them', t: r.end!.t, end: r.end! }));
}

/** Edit-distance alignment: 0 for a matching point, 1 for a point on one side only, 2 for a different winner. */
export function align(tags: Tagged[], sheet: Pt[]) {
  const n = tags.length, m = sheet.length;
  const same = (a: Pt, b: Pt) => a.winner === b.winner;
  // A wrong server makes a matching winner a little less likely, so alignment prefers the right spot.
  const cost = (a: Pt, b: Pt) => (same(a, b) ? (a.server && b.server && a.server !== b.server ? 0.4 : 0) : 2);
  const d: number[][] = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      d[i][j] = Math.min(d[i - 1][j - 1] + cost(tags[i - 1], sheet[j - 1]), d[i - 1][j] + 1, d[i][j - 1] + 1);
    }
  }
  const ops: ({ op: 'match' | 'sub'; i: number; j: number } | { op: 'extra'; i: number } | { op: 'missing'; j: number })[] = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && Math.abs(d[i][j] - (d[i - 1][j - 1] + cost(tags[i - 1], sheet[j - 1]))) < 1e-9) {
      ops.push({ op: same(tags[i - 1], sheet[j - 1]) ? 'match' : 'sub', i: i - 1, j: j - 1 });
      i--; j--;
    } else if (i > 0 && Math.abs(d[i][j] - (d[i - 1][j] + 1)) < 1e-9) {
      ops.push({ op: 'extra', i: i - 1 });
      i--;
    } else {
      ops.push({ op: 'missing', j: j - 1 });
      j--;
    }
  }
  return ops.reverse();
}

/** Every set that has both tags and a sheet entry. */
export function checkAgainstSheet(events: VEvent[], sheet: MatchSheetFlow): SetCheck[] {
  const us = sheet.ourTeam;
  const out: SetCheck[] = [];
  for (const f of sheet.flow) {
    const final = sheet.sets[f.set - 1];
    if (!final) continue;
    const tags = taggedPoints(events, f.set);
    if (!tags.length) continue;
    const sheetScore = { us: us === 'A' ? final.a : final.b, them: us === 'A' ? final.b : final.a };
    const tagged = { us: tags.filter((p) => p.winner === 'us').length, them: tags.filter((p) => p.winner === 'them').length };
    const { points, ok } = replaySet(f, final);
    if (!ok) { out.push({ set: f.set, tagged, sheet: sheetScore, sheetOk: false, diffs: [] }); continue; }
    const sheetPts: Pt[] = points.map((p) => ({ winner: p.winner === us ? 'us' : 'them', server: p.server === us ? 'us' : 'them' }));
    const diffs: Diff[] = [];
    // Score on the sheet just before each sheet point, to say where a difference is.
    const before = (j: number) => {
      const s = { us: 0, them: 0 };
      for (let k = 0; k < j; k++) s[sheetPts[k].winner]++;
      return s;
    };
    let lastTag: Tagged | null = null, j0 = 0;
    for (const o of align(tags, sheetPts)) {
      if (o.op === 'match') { lastTag = tags[o.i]; j0 = o.j + 1; continue; }
      if (o.op === 'extra') diffs.push({ kind: 'extra', tagged: tags[o.i], sheetScore: before(j0) });
      else if (o.op === 'missing') { diffs.push({ kind: 'missing', sheet: sheetPts[o.j], sheetScore: before(o.j), after: lastTag }); j0 = o.j + 1; }
      else { diffs.push({ kind: 'wrong', tagged: tags[o.i], sheet: sheetPts[o.j], sheetScore: before(o.j) }); lastTag = tags[o.i]; j0 = o.j + 1; }
      if (o.op === 'extra') lastTag = tags[o.i];
    }
    out.push({ set: f.set, tagged, sheet: sheetScore, sheetOk: true, diffs });
  }
  return out;
}
