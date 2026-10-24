import { describe, expect, it } from 'vitest';
import { apply, evaluate, flatPoints, LANDMARKS, solveHomography, type CalPoint } from './calibration';

// A plausible camera: perspective view from behind the near baseline (court -> image).
const camera = solveHomography(
  [{ x: 0, y: 0 }, { x: 9, y: 0 }, { x: 9, y: 18 }, { x: 0, y: 18 }],
  [{ x: -0.3, y: 1.4 }, { x: 1.3, y: 1.4 }, { x: 0.75, y: 0.25 }, { x: 0.25, y: 0.25 }],
)!;

const tap = (id: string): CalPoint => {
  const l = LANDMARKS.find((x) => x.id === id)!;
  const p = apply(camera, l);
  return { id, u: p.x, v: p.y, x: l.x, y: l.y };
};

describe('calibration from landmarks', () => {
  it('works without any visible corner (net + near 3 m line)', () => {
    const pts = ['netL', 'netR', 'attNL', 'attNR'].map(tap);
    const r = evaluate(pts);
    expect(r.ok).toBe(true);
    // The fitted mapping places the (off-screen) near corners where the camera has them.
    const corner = apply(r.courtToImage!, { x: 0, y: 0 });
    expect(corner.x).toBeCloseTo(-0.3, 4);
    expect(corner.y).toBeCloseTo(1.4, 4);
  });

  it('uses extra points (least squares) and catches a mislabelled tap', () => {
    const pts = ['netL', 'netR', 'attNL', 'attNR', 'attFL', 'attFR'].map(tap);
    expect(evaluate(pts).ok).toBe(true);
    const wrong = [...pts.slice(0, 5), { ...pts[5], u: pts[5].u - 0.2 }];
    expect(evaluate(wrong).ok).toBe(false);
  });

  it('rejects too few or collinear points', () => {
    expect(evaluate(['netL', 'netR', 'attNL'].map(tap)).ok).toBe(false);
    expect(evaluate(['netL', 'attNL', 'nearL', 'attFL'].map(tap)).ok).toBe(false); // all on the left sideline
  });

  it('flattens new and legacy calibrations for the app', () => {
    expect(flatPoints({ ourHalf: 'near', points: [tap('netL')] })).toHaveLength(4);
    expect(flatPoints({ ourHalf: 'near', points: [], corners: [[0, 1], [1, 1], [1, 0], [0, 0]] }).slice(8, 12)).toEqual([1, 0, 9, 18]);
  });
});
