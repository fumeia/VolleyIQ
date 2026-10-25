// Checks the AI backend configured in .env, without printing the key:
//   docker compose -p volleyiq exec app node src/ai-check.js
// Lists the models the key may use, then sends one tiny text request and one tiny
// image request to the configured model (a fraction of a cent).
import { aiComplete, aiConfig, gatewayRoot } from './ai.js';

const cfg = aiConfig(process.env);
if (!cfg) {
  console.log('No AI backend set. Add LITELLM_BASE_URL, LITELLM_API_KEY and LITELLM_MODEL to .env, then recreate the container.');
  process.exit(1);
}
console.log(`Backend: ${cfg.kind === 'openai' ? `OpenAI-compatible at ${cfg.baseUrl}` : 'Anthropic API'}`);
console.log(`Model:   ${cfg.model}`);
console.log(`Key:     ${cfg.apiKey.slice(0, 3)}… (${cfg.apiKey.length} characters)`);

if (cfg.kind === 'openai') {
  try {
    const res = await fetch(`${gatewayRoot(cfg.baseUrl)}/v1/models`, { headers: { Authorization: `Bearer ${cfg.apiKey}` } });
    const body = await res.text();
    if (!res.ok) console.log(`\nModel list: HTTP ${res.status} ${body.replace(/\s+/g, ' ').slice(0, 300)}`);
    else {
      const ids = (JSON.parse(body).data ?? []).map((m) => m.id).sort();
      console.log(`\nModels this key can use (${ids.length}):\n  ${ids.join('\n  ')}`);
      if (ids.length && !ids.includes(cfg.model)) console.log(`\n! LITELLM_MODEL "${cfg.model}" is not in this list: copy one of the names above exactly.`);
    }
  } catch (e) {
    console.log(`\nModel list: cannot reach the gateway (${e.cause?.code ?? e.message}). Is it only reachable from the university network?`);
  }
}

const tryIt = async (label, opts) => {
  const t0 = Date.now();
  try {
    const text = await aiComplete(cfg, { system: 'You are a test.', maxTokens: 20, ...opts });
    console.log(`${label}: OK in ${Date.now() - t0} ms, reply "${text.trim().slice(0, 60)}"`);
  } catch (e) {
    console.log(`${label}: FAILED, ${e.message}`);
  }
};
console.log('');
await tryIt('Text request  (coach summary)', { text: 'Reply with the word OK.' });
// A 32x32 white PNG: checks that the model accepts images.
const png = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKElEQVR42u3NQQEAAAQEMPTvfErw2wqsk9SnqWcCgUAgEAgEAoHgygLH8QM9BsqtpQAAAABJRU5ErkJggg==';
await tryIt('Image request (match sheet)', { text: 'What colour is this image? One word.', images: [{ media_type: 'image/png', data: png }] });
