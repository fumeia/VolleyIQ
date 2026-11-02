import fs from 'node:fs';
import { STATE } from './setup';

export default async function teardown() {
  if (!fs.existsSync(STATE)) return;
  const s = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  try { process.kill(-s.pid); } catch { try { process.kill(s.pid); } catch { /* already gone */ } }
  fs.rmSync(s.dataDir, { recursive: true, force: true });
  fs.rmSync(STATE, { force: true });
}
