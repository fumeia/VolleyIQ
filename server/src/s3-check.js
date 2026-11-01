// Checks the video storage from the server: writes a tiny test object into the bucket,
// gets a streaming link for it, reads it back through that link and deletes it.
// The keys are never printed.  Run: docker compose exec app node src/s3-check.js
import { deleteObject, presign, request, s3Config } from './s3.js';

const cfg = s3Config(process.env);
if (!cfg) {
  console.log('Not set up: S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY and S3_SECRET_KEY are needed in .env.');
  process.exit(1);
}
console.log(`Bucket "${cfg.bucket}" at ${cfg.host} (region ${cfg.region})`);
const key = `check/volleyiq-check-${Date.now()}.txt`;
try {
  await request(cfg, 'PUT', key, { body: 'VolleyIQ storage check' });
  console.log('✓ write');
  const res = await fetch(presign(cfg, 'GET', key, { expires: 300 }));
  const text = await res.text();
  if (!res.ok || text !== 'VolleyIQ storage check') throw new Error(`streaming link answered ${res.status}`);
  console.log('✓ streaming link');
  await deleteObject(cfg, key);
  console.log('✓ delete');
  console.log('Video storage works.');
} catch (e) {
  console.log(`✗ ${e.message}`);
  console.log('Check the endpoint (https://hel1.your-objectstorage.com), the bucket name and both keys in .env.');
  process.exit(1);
}
