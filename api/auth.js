// Login per E-Mail-Link.
//   POST   /api/auth            {email}      -> schickt einen Anmeldelink (nur an erlaubte Adressen)
//   GET    /api/auth?token=...               -> Bestätigungsseite mit "Anmelden"-Knopf
//   POST   /api/auth?token=...               -> löst den Link ein, setzt das Sitzungs-Cookie
//   GET    /api/auth                         -> { loggedIn, email }
//   DELETE /api/auth                         -> abmelden
//
// Umgebungsvariablen:
//   ALLOWED_EMAILS   kommagetrennte Liste der Adressen, die sich anmelden dürfen
//   RESEND_API_KEY   API-Key von resend.com zum Versenden der Mail
//   MAIL_FROM        optional, Absender (Standard: Kochbuch <onboarding@resend.dev>)
const crypto = require('crypto');
const { redis, P, sessionOf, readBody, configured } = require('../lib/redis.js');

const SESSION_DAYS = 180;
const allowed = () => String(process.env.ALLOWED_EMAILS || '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

function origin(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}`;
}

function page(res, title, body, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.5 system-ui,sans-serif;background:#f7f4fb;color:#2d2b3d;padding:24px}
@media(prefers-color-scheme:dark){body{background:#1d1b26;color:#ece8f4}}
main{max-width:360px;text-align:center}h1{font-size:1.4rem}
button{font:inherit;font-weight:600;border:0;border-radius:12px;padding:14px 22px;background:#b8e0cc;color:#1f3b2e;width:100%;cursor:pointer}
a{color:inherit}</style></head><body><main>${body}</main></body></html>`);
}

async function sendMail(to, link) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY fehlt');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.MAIL_FROM || 'Kochbuch <onboarding@resend.dev>',
      to: [to],
      subject: 'Dein Anmeldelink fürs Kochbuch',
      html: `<p>Hallo!</p><p>Tippe auf den Link, um dich im Kochbuch anzumelden. Er gilt 15 Minuten.</p>
<p><a href="${link}" style="display:inline-block;padding:12px 20px;background:#b8e0cc;color:#1f3b2e;border-radius:10px;text-decoration:none;font-weight:600">Im Kochbuch anmelden</a></p>
<p style="color:#6e6a82;font-size:13px">Falls du das nicht angefordert hast, kannst du die Mail ignorieren.</p>`,
    }),
  });
  if (!r.ok) throw new Error('Mailversand fehlgeschlagen: ' + (await r.text()).slice(0, 200));
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!configured) { res.status(500).json({ error: 'Keine Datenbank verbunden' }); return; }
  const url = new URL(req.url, 'http://x');
  const token = url.searchParams.get('token');

  try {
    // Link aus der Mail: erst eine Bestätigungsseite zeigen, damit Mail-Programme,
    // die Links vorab öffnen, den Link nicht verbrauchen.
    if (req.method === 'GET' && token) {
      if (!/^[a-f0-9]{64}$/.test(token)) return page(res, 'Link ungültig', `<h1>Link ungültig</h1><p><a href="/">Zurück zum Kochbuch</a></p>`, 400);
      return page(res, 'Anmelden', `<h1>🍲 Kochbuch</h1><p>Hier tippen, um dich auf diesem Gerät anzumelden.</p>
<form method="post" action="/api/auth?token=${token}"><button type="submit">Anmelden</button></form>`);
    }

    if (req.method === 'POST' && token) {
      if (!/^[a-f0-9]{64}$/.test(token)) return page(res, 'Link ungültig', `<h1>Link ungültig</h1>`, 400);
      const email = await redis(['GETDEL', P + 'login:' + token]);
      if (!email) return page(res, 'Link abgelaufen', `<h1>Link abgelaufen</h1><p>Der Link wurde schon benutzt oder ist älter als 15 Minuten.</p><p><a href="/">Neuen Link anfordern</a></p>`, 400);
      const sid = crypto.randomBytes(32).toString('hex');
      await redis(['SET', P + 'session:' + sid, email, 'EX', String(SESSION_DAYS * 86400)]);
      res.setHeader('Set-Cookie', `kb_session=${sid}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`);
      res.statusCode = 303;
      res.setHeader('Location', '/');
      res.end();
      return;
    }

    if (req.method === 'POST') {
      const email = String(readBody(req).email || '').trim().toLowerCase();
      if (!email || !email.includes('@')) { res.status(400).json({ error: 'Bitte eine E-Mail-Adresse eingeben.' }); return; }
      // Antwort ist für erlaubte und nicht erlaubte Adressen gleich.
      if (allowed().includes(email)) {
        const fresh = await redis(['SET', P + 'mailrl:' + email, '1', 'NX', 'EX', '60']);
        if (fresh) {
          const t = crypto.randomBytes(32).toString('hex');
          await redis(['SET', P + 'login:' + t, email, 'EX', '900']);
          await sendMail(email, `${origin(req)}/api/auth?token=${t}`);
        }
      }
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
    res.status(200).json({ loggedIn: !!s, email: s ? s.email : null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
