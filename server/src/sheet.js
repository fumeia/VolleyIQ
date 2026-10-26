// The match flow read off the official match sheet, kept with a match: which sheet
// team is ours, the set scores, and per set the starting six, substitutions, service
// rounds and time-outs (jersey numbers and scores only, no names).

const int = (v, lo = 0, hi = 99) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
const list = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);

function half(h) {
  return {
    start: list(h?.start, 6).map((n) => int(n)),
    subs: list(h?.subs, 12).map((x) => ({ col: int(x?.col, 1, 6), in: int(x?.in), own: int(x?.own, 0, 60), opp: int(x?.opp, 0, 60) })).filter((x) => x.col != null),
    rounds: list(h?.rounds, 10).map((row) => list(row, 6).map((c) => (c === 'X' || c === 'x' ? 'X' : int(c, 0, 60)))),
    timeouts: list(h?.timeouts, 4).map((x) => ({ own: int(x?.own, 0, 60), opp: int(x?.opp, 0, 60) })),
  };
}

/** A clean copy of a sheet sent by the app, or null when it is not one. */
export function cleanSheet(s) {
  if (!s || typeof s !== 'object' || !['A', 'B'].includes(s.ourTeam)) return null;
  return {
    ourTeam: s.ourTeam,
    sets: list(s.sets, 5).map((x) => ({ a: int(x?.a, 0, 60), b: int(x?.b, 0, 60) })).filter((x) => x.a != null && x.b != null),
    flow: list(s.flow, 5).map((f) => ({
      set: int(f?.set, 1, 5),
      firstServe: ['A', 'B'].includes(f?.firstServe) ? f.firstServe : null,
      A: half(f?.A),
      B: half(f?.B),
    })).filter((f) => f.set != null),
  };
}
