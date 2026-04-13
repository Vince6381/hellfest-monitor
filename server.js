const https = require('https');
const http = require('http');

// ─── CONFIG ────────────────────────────────────────────────────────────────
const REDDIT_URL   = 'https://www.reddit.com/r/Hellfest/new.json?limit=1&raw_json=1';
const INTERVAL_MS  = 5_000;          // 30 secondes
const NTFY_TOPIC   = process.env.NTFY_TOPIC || 'hellfest-monitor-CHANGEME';
const PORT         = process.env.PORT || 3000;

// ─── STATE ─────────────────────────────────────────────────────────────────
let previousPostId   = null;
let previousPostTitle = null;
let lastChecked      = null;
let checkCount       = 0;
let changeCount      = 0;
let lastError        = null;
const recentLogs     = [];

// ─── HELPERS ───────────────────────────────────────────────────────────────
function log(msg, isChange = false) {
  const ts  = new Date().toISOString();
  const entry = { ts, msg, isChange };
  recentLogs.unshift(entry);
  if (recentLogs.length > 100) recentLogs.pop();
  console.log(`[${ts}] ${msg}`);
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', Accept: 'application/json' } }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10_000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function sendNtfy(title, message, url) {
  return new Promise((resolve) => {
    const body    = Buffer.from(message);
    const headers = {
      'Content-Type'  : 'text/plain',
      'Title'         : encodeURIComponent(title),
      'Priority'      : 'urgent',
      'Tags'          : 'rotating_light,ticket',
      'Content-Length': body.length,
    };
    if (url) headers['Click'] = url;

    const req = https.request(
      { hostname: 'ntfy.sh', path: `/${NTFY_TOPIC}`, method: 'POST', headers },
      res => { res.resume(); resolve(res.statusCode); }
    );
    req.on('error', e => { console.error('Ntfy error:', e.message); resolve(null); });
    req.write(body);
    req.end();
  });
}

// ─── MAIN POLLING LOGIC ────────────────────────────────────────────────────
async function check() {
  try {
    const data = await fetchJson(REDDIT_URL);
    const post = data?.data?.children?.[0]?.data;
    if (!post) throw new Error('No post returned');

    const { id, title, author, permalink } = post;
    lastChecked = new Date().toISOString();
    checkCount++;
    lastError = null;

    if (previousPostId === null) {
      previousPostId    = id;
      previousPostTitle = title;
      log(`Baseline: "${title.slice(0, 80)}"`);
    } else if (id !== previousPostId) {
      changeCount++;
      const postUrl = 'https://www.reddit.com' + permalink;
      log(`CHANGE DETECTED → "${title.slice(0, 80)}"`, true);

      // Notification push via ntfy
      await sendNtfy(
        '🔥 Hellfest Reddit — nouveau post !',
        `"${title.slice(0, 120)}" par u/${author}`,
        postUrl
      );

      previousPostId    = id;
      previousPostTitle = title;
    } else {
      log(`No change — "${title.slice(0, 60)}"`);
    }
  } catch (e) {
    lastError = e.message;
    log(`Error: ${e.message}`);
  }
}

// ─── HTTP STATUS DASHBOARD ─────────────────────────────────────────────────
// Un mini dashboard HTML pour vérifier que le serveur tourne (Render le ping aussi)
http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', lastChecked, checkCount, changeCount, lastError }));
    return;
  }

  if (req.url === '/logs') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(recentLogs));
    return;
  }

  // Dashboard HTML
  const statusColor = lastError ? '#e8401c' : '#39ff14';
  const logsHtml = recentLogs.slice(0, 30).map(l =>
    `<div class="log ${l.isChange ? 'chg' : ''}">
      <span class="ts">[${l.ts.slice(11, 19)}]</span> ${escHtml(l.msg)}
    </div>`
  ).join('');

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta http-equiv="refresh" content="15"/>
  <title>Hellfest Monitor — Status</title>
  <link href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Barlow+Condensed:wght@900&display=swap" rel="stylesheet"/>
  <style>
    :root{--bg:#0a0a0a;--surface:#111;--border:#2a2a2a;--accent:#e8401c;--green:#39ff14;--amber:#ffb400;--text:#e8e8e0;--muted:#666;--mono:'Share Tech Mono',monospace;--display:'Barlow Condensed',sans-serif}
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:var(--bg);color:var(--text);font-family:var(--mono);padding:2rem 1.5rem;min-height:100vh}
    .container{max-width:640px;margin:0 auto}
    h1{font-family:var(--display);font-size:2.4rem;font-weight:900;text-transform:uppercase;color:var(--accent);margin-bottom:.3rem}
    h1 span{color:var(--text)}
    .sub{font-size:.65rem;color:var(--muted);letter-spacing:.15em;text-transform:uppercase;margin-bottom:1.5rem}
    .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:.75rem;margin-bottom:1.5rem}
    .stat{background:var(--surface);border:1px solid var(--border);padding:.75rem 1rem}
    .stat-label{font-size:.6rem;color:var(--muted);text-transform:uppercase;letter-spacing:.15em;margin-bottom:.3rem}
    .stat-value{font-size:1.4rem;color:var(--text)}
    .stat-value.ok{color:var(--green)}
    .stat-value.err{color:var(--accent)}
    .stat-value.chg{color:var(--amber)}
    .logs{background:var(--surface);border:1px solid var(--border);padding:1rem 1.25rem}
    .log-label{font-size:.6rem;color:var(--muted);text-transform:uppercase;letter-spacing:.18em;margin-bottom:.75rem}
    .log{font-size:.7rem;line-height:1.9;color:var(--muted);border-bottom:1px solid #1c1c1c}
    .log.chg{color:var(--amber)}
    .ts{color:#333;margin-right:.5rem}
    .led{display:inline-block;width:8px;height:8px;border-radius:50%;background:${statusColor};box-shadow:0 0 6px ${statusColor};margin-right:.5rem;animation:blink 1.4s ease-in-out infinite}
    @keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
    .refresh{font-size:.6rem;color:#333;text-align:right;margin-top:.75rem;letter-spacing:.1em;text-transform:uppercase}
  </style>
</head>
<body>
<div class="container">
  <h1><span>r/</span>Hellfest <span>Monitor</span></h1>
  <div class="sub"><span class="led"></span>Server running &mdash; auto-refresh 15s</div>
  <div class="stats">
    <div class="stat">
      <div class="stat-label">Status</div>
      <div class="stat-value ${lastError ? 'err' : 'ok'}">${lastError ? 'ERROR' : 'OK'}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Checks</div>
      <div class="stat-value">${checkCount}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Changes</div>
      <div class="stat-value chg">${changeCount}</div>
    </div>
  </div>
  <div class="stat" style="margin-bottom:1rem;border:1px solid var(--border);background:var(--surface);padding:.75rem 1rem">
    <div class="stat-label">Ntfy topic</div>
    <div style="font-size:.85rem;color:var(--text);margin-top:.3rem">${escHtml(NTFY_TOPIC)}</div>
  </div>
  ${lastError ? `<div style="border:1px solid var(--accent);padding:.7rem 1rem;font-size:.75rem;color:var(--accent);margin-bottom:1rem">!! Last error: ${escHtml(lastError)}</div>` : ''}
  <div class="logs">
    <div class="log-label">Activity log (30 dernières entrées)</div>
    ${logsHtml || '<div class="log" style="text-align:center;padding:.5rem 0">No logs yet</div>'}
  </div>
  <div class="refresh">Last checked: ${lastChecked || 'never'} &mdash; Refresh auto toutes les 15s</div>
</div>
</body>
</html>`);

}).listen(PORT, () => console.log(`[Server] Listening on port ${PORT}`));

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ─── DÉMARRAGE ─────────────────────────────────────────────────────────────
log('Hellfest Monitor démarré');
check();
setInterval(check, INTERVAL_MS);
