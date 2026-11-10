// Login per Passwort.
//   POST   /api/auth  { password }  -> prüft das Passwort, setzt das Sitzungs-Cookie
//   GET    /api/auth                -> { loggedIn }
//   DELETE /api/auth                -> abmelden
//
// Umgebungsvariable:
//   APP_PASSWORD   das Kochbuch-Passwort (in Vercel unter Settings → Environment Variables)
const crypto = require('crypto');
const { redis, P, sessionOf, readBody, configured } = require('../lib/redis.js');

const SESSION_DAYS = 180;
const MAX_TRIES = 10;          // Fehlversuche pro Gerät/Netz …
const TRY_WINDOW = 15 * 60;    // … innerhalb von 15 Minuten

function samePassword(given, expected) {
  // Konstante Laufzeit, damit sich das Passwort nicht über Zeitmessung erraten lässt.
  const a = crypto.createHash('sha256').update(String(given)).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unbekannt').split(',')[0].trim();
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!configured) { res.status(500).json({ error: 'Keine Datenbank verbunden' }); return; }

  try {
    if (req.method === 'POST') {
      const expected = process.env.APP_PASSWORD;
      if (!expected) { res.status(500).json({ error: 'Es ist noch kein Passwort eingerichtet (APP_PASSWORD fehlt).' }); return; }

      const ipKey = P + 'tries:' + crypto.createHash('sha256').update(clientIp(req)).digest('hex').slice(0, 32);
      const tries = Number(await redis(['GET', ipKey]) || 0);
      if (tries >= MAX_TRIES) { res.status(429).json({ error: 'Zu viele Versuche. Bitte in 15 Minuten nochmal.' }); return; }

      const { password } = readBody(req);
      if (!password || !samePassword(password, expected)) {
        await redis(['INCR', ipKey]);
        await redis(['EXPIRE', ipKey, String(TRY_WINDOW)]);
        res.status(401).json({ error: 'Das Passwort stimmt nicht.' });
        return;
      }

      await redis(['DEL', ipKey]);
      const sid = crypto.randomBytes(32).toString('hex');
      await redis(['SET', P + 'session:' + sid, 'owner', 'EX', String(SESSION_DAYS * 86400)]);
      res.setHeader('Set-Cookie', `kb_session=${sid}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`);
      res.status(200).json({ ok: true });
      return;
    }

    if (req.method === 'DELETE') {
      const s = await sessionOf(req);
      if (s) await redis(['DEL', P + 'session:' + s.sid]);
      res.setHeader('Set-Cookie', 'kb_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
      res.status(200).json({ ok: true });
      return;
    }

    const s = await sessionOf(req);
    res.status(200).json({ loggedIn: !!s });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
