/**
 * Compares app versions: 1.2.0, 1.2.1-dev.86 (a test build on the way to 1.2.1) and the
 * old test numbering 0.85. A release is newer than its own test builds.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre] = v.replace(/^v/, '').split('-', 2);
    const nums = core.split('.').map((x) => Number(x) || 0);
    while (nums.length < 3) nums.push(0);
    const preNum = pre ? Number(pre.match(/(\d+)$/)?.[1] ?? 0) : null;
    return { nums, preNum };
  };
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] - y.nums[i];
  if (x.preNum == null && y.preNum == null) return 0;
  if (x.preNum == null) return 1;
  if (y.preNum == null) return -1;
  return x.preNum - y.preNum;
}
