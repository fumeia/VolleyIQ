// A trained model for the touch detection, from the tagged matches.
//
// The phone keeps every sound peak of a run with measurements of it (see Detection.candidates in
// the app): when, how far it stands out, how fast it fades, its height, how sharply it rises,
// how wide it is, how tonal, the band's level against the surroundings, and the energy before and
// after. Here each peak gets a label from the tags:
// - a touch: the peak a tagged touch belongs to (the strongest one right at it, after shifting
//   the match's tags by their typical delay: tag times are when the coach tapped, minus a lead);
// - not a touch: every peak in the dead time between rallies (no ball is played there);
// - unknown: the other peaks in rallies (the other team's touches are real but not tagged).
// A logistic regression learns from the labelled peaks, with the peak's rhythm around it (time to
// the peaks before and after, how many there are, how loud it is against its neighbours). It is
// tested on parts of the matches it did not learn from, and the app only gets it when it finds
// more touches for less noise than the threshold rule.
import { DEFAULTS, matchData, tune, MIN_TOUCHES } from './tuning.js';

export const N_FEATURES = 13;
const WINDOW = 0.5;
const NOISE_COST = 0.5;
const CLAIM = 0.6;

const ln = Math.log;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * The model's inputs for every peak of a run (sorted by time). Keep in step with
 * SoundModel.features in the app: both must compute exactly this.
 */
export function features(peaks) {
  const n = peaks.length;
  const lz = peaks.map((p) => ln(Math.max(p[1], 1)));
  const sum = [0];
  for (let i = 0; i < n; i++) sum.push(sum[i] + lz[i]);
  const out = new Array(n);
  let a3 = 0, b3 = 0, a10 = 0, b10 = 0;
  for (let i = 0; i < n; i++) {
    const p = peaks[i], t = p[0];
    while (peaks[a3][0] < t - 3) a3++;
    if (b3 < i) b3 = i;
    while (b3 + 1 < n && peaks[b3 + 1][0] <= t + 3) b3++;
    while (peaks[a10][0] < t - 10) a10++;
    if (b10 < i) b10 = i;
    while (b10 + 1 < n && peaks[b10 + 1][0] <= t + 10) b10++;
    const prev = i > 0 ? Math.min(t - peaks[i - 1][0], 3) : 3;
    const next = i + 1 < n ? Math.min(peaks[i + 1][0] - t, 3) : 3;
    out[i] = [
      lz[i],
      Math.min(p[2], 3),
      ln(1 + Math.max(p[3], 0)),
      clamp(ln(Math.max(p[4], 0.01)), -5, 5),
      Math.min(p[5], 30) / 10,
      clamp(ln(Math.max(p[6], 0.01)), -5, 5),
      clamp(p[7], -40, 40) / 10,
      Math.min(p[8], 5),
      Math.min(p[9], 5),
      prev,
      next,
      (b3 - a3) / 10,
      lz[i] - (sum[b10 + 1] - sum[a10]) / (b10 - a10 + 1),
    ];
  }
  return out;
}

/** Labels for one match's peaks (1 touch, 0 not a touch, -1 unknown) and its tags shifted onto the sound. */
export function labelMatch(events, peaks) {
  const md = matchData(events, peaks);
  if (!md || md.peaks.length < 10) return null;
  const ps = md.peaks;
  // The tags' typical delay against the sound: the shift that puts the most tags right on a
  // strong peak (a nearest-peak guess can pick the touch before, rallies have a steady rhythm).
  const strong = ps.filter((p) => p[1] >= 5).map((p) => p[0]);
  const near = (t, tol) => {
    let lo = 0, hi = strong.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (strong[mid] < t - tol) lo = mid + 1; else hi = mid; }
    return lo < strong.length && strong[lo] <= t + tol;
  };
  let offset = 0, bestHits = -1;
  for (let d = -1.5; d <= 1.5001; d += 0.05) {
    const hits = md.touches.reduce((a, t) => a + (near(t + d, 0.1) ? 1 : 0), 0);
    // A tie goes to the smaller shift.
    if (hits > bestHits || (hits === bestHits && Math.abs(d) < Math.abs(offset))) { bestHits = hits; offset = Math.round(d * 100) / 100; }
  }
  if (bestHits < 10) offset = 0;
  const touches = md.touches.map((t) => t + offset);
  const labels = new Array(ps.length).fill(-1);
  let j = 0;
  for (const t of touches) {
    while (j < ps.length && ps[j][0] < t - CLAIM) j++;
    let best = -1;
    for (let k = j; k < ps.length && ps[k][0] <= t + CLAIM; k++) {
      if (labels[k] === 1) continue;
      if (best < 0 || ps[k][1] > ps[best][1]) best = k;
    }
    if (best >= 0) labels[best] = 1;
  }
  for (let k = 0; k < ps.length; k++) {
    if (labels[k] === 1) continue;
    if (md.dead.some(([a, b]) => ps[k][0] >= a && ps[k][0] <= b)) labels[k] = 0;
  }
  return { peaks: ps, x: features(ps), labels, touches, dead: md.dead, offset };
}

const sigmoid = (z) => 1 / (1 + Math.exp(-z));

/** Logistic regression on standardised inputs, both classes weighted equally, a little L2. */
export function fit(rows, ys, { iters = 400, lr = 0.5, l2 = 1e-3 } = {}) {
  const d = rows[0].length, n = rows.length;
  const mean = new Array(d).fill(0), std = new Array(d).fill(0);
  for (const r of rows) for (let k = 0; k < d; k++) mean[k] += r[k] / n;
  for (const r of rows) for (let k = 0; k < d; k++) std[k] += (r[k] - mean[k]) ** 2 / n;
  // A column that never changes (or only by rounding) is left as it is.
  for (let k = 0; k < d; k++) { const sd = Math.sqrt(std[k]); std[k] = sd > 1e-6 ? sd : 1; }
  const xs = rows.map((r) => r.map((v, k) => (v - mean[k]) / std[k]));
  const pos = ys.filter((y) => y === 1).length, neg = n - pos;
  const wPos = n / (2 * Math.max(pos, 1)), wNeg = n / (2 * Math.max(neg, 1));
  const w = new Array(d).fill(0);
  let b = 0;
  for (let it = 0; it < iters; it++) {
    const g = new Array(d).fill(0);
    let gb = 0;
    for (let i = 0; i < n; i++) {
      let z = b;
      for (let k = 0; k < d; k++) z += w[k] * xs[i][k];
      const err = (sigmoid(z) - ys[i]) * (ys[i] === 1 ? wPos : wNeg);
      for (let k = 0; k < d; k++) g[k] += err * xs[i][k];
      gb += err;
    }
    for (let k = 0; k < d; k++) w[k] -= lr * (g[k] / n + l2 * w[k]);
    b -= lr * (gb / n);
  }
  return { mean, std, w, b };
}

export function predict(m, row) {
  let z = m.b;
  for (let k = 0; k < row.length; k++) z += m.w[k] * ((row[k] - m.mean[k]) / m.std[k]);
  return sigmoid(z);
}

/** found / noise of the peaks kept, against the (shifted) touches and the dead time. */
function score(matches, keep) {
  let truth = 0, found = 0, noise = 0, deadSec = 0;
  matches.forEach((m, mi) => {
    const kept = m.peaks.filter((_, k) => keep(mi, k)).map((p) => p[0]);
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
  });
  return { truth, found, recall: truth ? found / truth : 0, noise, noisePerMin: deadSec ? noise / (deadSec / 60) : 0, score: found - NOISE_COST * noise };
}

const FOLDS = 4;
/** Which test part a peak belongs to: the whole match with 3+ matches, else a quarter of its match. */
function foldOf(matches, mi, k) {
  if (matches.length >= 3) return mi % FOLDS;
  const ps = matches[mi].peaks;
  const lo = ps[0][0], hi = ps[ps.length - 1][0];
  return Math.min(FOLDS - 1, Math.floor(((ps[k][0] - lo) / Math.max(hi - lo, 1e-9)) * FOLDS));
}

/**
 * Trains and tests the model on the labelled matches: { ready, model, cv, rule, ... }. [matches]
 * come from labelMatch; only runs whose peaks have all the measurements can be used.
 */
export function trainModel(matches) {
  const ms = matches.filter((m) => m && m.peaks[0]?.length >= 10);
  const pos = ms.reduce((a, m) => a + m.labels.filter((l) => l === 1).length, 0);
  const neg = ms.reduce((a, m) => a + m.labels.filter((l) => l === 0).length, 0);
  const base = { matches: ms.length, touches: ms.reduce((a, m) => a + m.touches.length, 0), positives: pos, negatives: neg };
  if (pos < MIN_TOUCHES || neg < 30) return { ready: false, ...base };
  // Out-of-fold chances for every peak.
  const oof = ms.map((m) => new Array(m.peaks.length).fill(0));
  for (let f = 0; f < FOLDS; f++) {
    const rows = [], ys = [];
    ms.forEach((m, mi) => m.labels.forEach((l, k) => { if (l >= 0 && foldOf(ms, mi, k) !== f) { rows.push(m.x[k]); ys.push(l); } }));
    if (ys.filter((y) => y === 1).length < 20 || ys.filter((y) => y === 0).length < 10) continue;
    const mdl = fit(rows, ys);
    ms.forEach((m, mi) => m.peaks.forEach((_, k) => { if (foldOf(ms, mi, k) === f) oof[mi][k] = predict(mdl, m.x[k]); }));
  }
  let best = null;
  for (let c = 0.05; c <= 0.951; c += 0.025) {
    const r = { cut: Math.round(c * 1000) / 1000, ...score(ms, (mi, k) => oof[mi][k] >= c) };
    // Equally good cuts: the one nearest the middle (less on the edge of what was seen).
    if (!best || r.score > best.score || (r.score === best.score && Math.abs(r.cut - 0.5) < Math.abs(best.cut - 0.5))) best = r;
  }
  // The threshold rule on the same (shifted) touches, at its own best settings.
  const ruleData = ms.map((m) => ({ touches: m.touches, dead: m.dead, peaks: m.peaks }));
  const tuned = tune(ruleData);
  const rp = tuned.ready ? tuned.best : tuned.baseline;
  const rule = { threshold: rp.threshold, sustainMax: rp.sustainMax, ...score(ms, (mi, k) => ms[mi].peaks[k][1] >= rp.threshold && ms[mi].peaks[k][2] <= rp.sustainMax) };
  const rows = [], ys = [];
  for (const m of ms) m.labels.forEach((l, k) => { if (l >= 0) { rows.push(m.x[k]); ys.push(l); } });
  const final = fit(rows, ys);
  const model = { version: 1, features: N_FEATURES, mean: final.mean.map(r6), std: final.std.map(r6), w: final.w.map(r6), b: r6(final.b), cut: best.cut };
  return { ready: true, ...base, model, cv: best, rule, better: best.score > rule.score, offsets: ms.map((m) => Math.round(m.offset * 100) / 100) };
}
const r6 = (v) => Math.round(v * 1e6) / 1e6;

/** From the database: the newest run with measured peaks of every match with tagged touches. */
export function trainFromDb(db) {
  const runs = db.prepare(`SELECT r.match_id, r.candidates FROM detection_runs r
    WHERE r.candidates IS NOT NULL AND r.id = (SELECT MAX(id) FROM detection_runs x WHERE x.match_id = r.match_id AND x.candidates IS NOT NULL)`).all();
  const matches = runs.map((r) => {
    const peaks = JSON.parse(r.candidates).sort((a, b) => a[0] - b[0]);
    if (!peaks.length || peaks[0].length < 10) return null;
    return labelMatch(db.prepare("SELECT t, action, value, status FROM events WHERE match_id = ? AND status = 'confirmed'").all(r.match_id), peaks);
  });
  return trainModel(matches);
}

export { DEFAULTS };
