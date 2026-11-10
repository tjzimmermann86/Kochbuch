// Persönliche Daten des Kochbuchs: Vorrat, Einkaufszettel, Kommentare, ausgeblendete Rezepte.
//   GET  /api/data                     -> { pantry, shopping, comments, hidden }
//   POST /api/data  { ops: [...] }     -> Änderungen anwenden
//        op = { c: "pantry"|"shopping"|"comments"|"hidden", a: "set"|"del", id, v }
// Nur mit gültiger Sitzung (siehe api/auth.js).
const { redis, pipeline, P, sessionOf, readBody, configured } = require('../lib/redis.js');
const seed = require('../data/seed.json');

const COLLECTIONS = ['pantry', 'shopping', 'comments', 'hidden'];
const ID = /^[A-Za-z0-9_.:-]{1,120}$/;
const key = c => P + 'c:' + c;

function toObj(flat) {
  const out = {};
  for (let i = 0; i < (flat || []).length; i += 2) {
    try { out[flat[i]] = JSON.parse(flat[i + 1]); } catch { /* kaputten Eintrag überspringen */ }
  }
  return out;
}

async function seedOnce() {
  const first = await redis(['SET', P + 'seeded', new Date().toISOString(), 'NX']);
  if (!first) return;
  const cmds = [];
  for (const c of ['pantry', 'shopping']) {
    for (const [id, v] of Object.entries(seed[c] || {})) cmds.push(['HSET', key(c), id, JSON.stringify(v)]);
  }
  await pipeline(cmds);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!configured) { res.status(500).json({ error: 'Keine Datenbank verbunden' }); return; }
  try {
    const s = await sessionOf(req);
    if (!s) { res.status(401).json({ error: 'Nicht angemeldet' }); return; }

    if (req.method === 'GET') {
      await seedOnce();
      const rows = await pipeline(COLLECTIONS.map(c => ['HGETALL', key(c)]));
      const out = {};
      COLLECTIONS.forEach((c, i) => { out[c] = toObj(rows[i]); });
      res.status(200).json(out);
      return;
    }

    if (req.method === 'POST') {
      const ops = readBody(req).ops;
      if (!Array.isArray(ops) || ops.length > 200) { res.status(400).json({ error: 'Ungültige Änderungen' }); return; }
      const cmds = [];
      for (const op of ops) {
        if (!op || !COLLECTIONS.includes(op.c) || !ID.test(String(op.id || ''))) continue;
        if (op.a === 'del') cmds.push(['HDEL', key(op.c), op.id]);
        else if (op.a === 'set' && op.v && typeof op.v === 'object') {
          const json = JSON.stringify(op.v);
          if (json.length <= 20000) cmds.push(['HSET', key(op.c), op.id, json]);
        }
      }
      await pipeline(cmds);
      res.status(200).json({ ok: true, applied: cmds.length });
      return;
    }

    res.status(405).json({ error: 'Methode nicht erlaubt' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
