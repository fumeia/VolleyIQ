// Learning the detector's thresholds from tagged matches.
//
// The phone hears a ball contact as a sharp sound peak: a peak counts when its score (how far
// it stands out from the sound around it) is above a threshold, and its energy fades fast
// enough (music, crowd and speech stay loud). A run keeps every peak, also the ones below the
// threshold, so other thresholds can be tried here against the touches tagged by hand:
// - found: tagged touches with a counted peak within half a second;
// - noise: counted peaks in the dead time between rallies (after a point, before the next
//   serve), where no ball is played.
// The best pair is the one that finds the most touches for the least noise. The app uses it on
// its next run, so every tagged set makes the next detection better.

export const DEFAULTS = { threshold: 8, sustainMax: 0.6 };
const THRESHOLDS = [4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 10, 11, 12, 14];
const SUSTAINS = [0.4, 0.5, 0.6, 0.7, 0.8, 1.0];
const WINDOW = 0.5;
/** A noise peak costs this much of a found touch: missing a touch is worse than an extra peak. */
const NOISE_COST = 0.5;
/** Learn only from enough tagged touches (about four sets). */
export const MIN_TOUCHES = 150;

const NOT_TOUCHES = new Set(['opp_point', 'opp_error', 'block_miss', 'gap_us', 'gap_them']);
// Actions that end a rally (for the dead time after them).
const ENDS = new Set(['kill', 'ace', 'block_point', 'attack_error', 'serve_error', 'dig_error', 'block_error', 'attack_blocked',
  'assist_error', 'set_error', 'opp_point', 'opp_error']);

/** One match's data: tagged touch times, dead-time stretches and the run's peaks. */
export function matchData(events, peaks) {
  const tagged = events.filter((e) => e.status === 'confirmed' && e.t != null).sort((a, b) => a.t - b.t);
  if (!tagged.length || !peaks?.length) return null;
  const lo = peaks[0][0], hi = peaks[peaks.length - 1][0];
  const touches = tagged.filter((e) => !NOT_TOUCHES.has(e.action) && e.t >= lo - 1 && e.t <= hi + 1).map((e) => e.t);
  // After a rally ends: from 4 s later until 10 s before the next tag (the serve, and the
  // ball bounced before it, come just before).
  const dead = [];
  for (let i = 0; i < tagged.length - 1; i++) {
    const e = tagged[i];
    if (!ENDS.has(e.action) && !(e.action === 'receive' && e.value === 0)) continue;
    const a = e.t + 4, b = tagged[i + 1].t - 10;
    if (b - a >= 3) dead.push([a, b]);
  }
  // Only the tagged stretch counts (one set tagged to test a run over the whole video).
  const first = tagged[0].t - 5, last = tagged[tagged.length - 1].t + 5;
  return { touches, dead, peaks: peaks.filter((p) => p[0] >= first && p[0] <= last) };
}

/** How a pair of thresholds does on the matches. */
export function evaluate(data, threshold, sustainMax) {
  let truth = 0, found = 0, noise = 0, deadSec = 0;
  for (const m of data) {
    const kept = m.peaks.filter((p) => p[1] >= threshold && p[2] <= sustainMax).map((p) => p[0]);
    let j = 0;
    for (const t of m.touches) {
      truth++;
      while (j < kept.length && kept[j] < t - WINDOW) j++;
      if (j < kept.length && kept[j] <= t + WINDOW) found++;
    }
    for (const [a, b] of m.dead) {
      deadSec += b - a;
      for (const t of kept) if (t >= a && t <= b) noise++;
    }
  }
  return { threshold, sustainMax, truth, found, recall: truth ? found / truth : 0, noise, noisePerMin: deadSec ? noise / (deadSec / 60) : 0, score: found - NOISE_COST * noise };
}

/** The best thresholds for the matches, next to how the defaults do on them. */
export function tune(data) {
  const usable = data.filter(Boolean);
  const baseline = evaluate(usable, DEFAULTS.threshold, DEFAULTS.sustainMax);
  if (baseline.truth < MIN_TOUCHES) return { ready: false, touches: baseline.truth, matches: usable.length, baseline };
  let best = baseline;
  for (const t of THRESHOLDS) for (const s of SUSTAINS) {
    const r = evaluate(usable, t, s);
    if (r.score > best.score + 1e-9) best = r;
  }
  return { ready: true, touches: baseline.truth, matches: usable.length, baseline, best };
}

/** From the database: the newest run with peaks of every match that has tagged touches. */
export function tuneFromDb(db) {
  const runs = db.prepare(`SELECT r.match_id, r.candidates FROM detection_runs r
    WHERE r.candidates IS NOT NULL AND r.id = (SELECT MAX(id) FROM detection_runs x WHERE x.match_id = r.match_id AND x.candidates IS NOT NULL)`).all();
  const data = runs.map((r) => matchData(
    db.prepare("SELECT t, action, value, status FROM events WHERE match_id = ? AND status = 'confirmed'").all(r.match_id),
    JSON.parse(r.candidates).sort((a, b) => a[0] - b[0]),
  ));
  return tune(data);
}
