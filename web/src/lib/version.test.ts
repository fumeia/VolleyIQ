import { describe, expect, it } from 'vitest';
import { compareVersions } from './version';

describe('app versions', () => {
  it('orders releases, test builds and the old numbering', () => {
    expect(compareVersions('1.0.1', '1.0.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0.1', '1.0.1-dev.86')).toBeGreaterThan(0);
    expect(compareVersions('1.0.1-dev.90', '1.0.1-dev.86')).toBeGreaterThan(0);
    expect(compareVersions('1.0.1-dev.86', '1.0.0')).toBeGreaterThan(0);
    expect(compareVersions('0.85', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('v1.2.0', '1.2.0')).toBe(0);
  });
});
