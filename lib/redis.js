// Kleiner Upstash-REST-Client. Vercel setzt die Variablen, sobald die
// Upstash-Redis-Datenbank mit dem Projekt verbunden ist.
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

// Eigener Bereich in der Datenbank, damit sich nichts mit anderen Projekten mischt.
const P = 'kochbuch:';

async function redis(cmd) {
  if (!URL_ || !TOKEN) throw new Error('Keine Datenbank verbunden');
  const r = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

async function pipeline(cmds) {
  if (!cmds.length) return [];
  const r = await fetch(URL_.replace(/\/$/, '') + '/pipeline', {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds),
  });
  const j = await r.json();
  if (!Array.isArray(j)) throw new Error(j.error || 'Pipeline fehlgeschlagen');
  return j.map(x => { if (x.error) throw new Error(x.error); return x.result; });
}

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

async function sessionOf(req) {
  const sid = parseCookies(req).kb_session;
  if (!sid || !/^[a-f0-9]{64}$/.test(sid)) return null;
  const email = await redis(['GET', P + 'session:' + sid]);
  return email ? { sid, email } : null;
}

function readBody(req) {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  return b || {};
}

module.exports = { redis, pipeline, P, parseCookies, sessionOf, readBody, configured: !!(URL_ && TOKEN) };
