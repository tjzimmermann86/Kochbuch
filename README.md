# 🍲 Kochbuch

Persönliches Kochbuch als Handy-App: Rezepte mit Portionsrechner, Einkaufszettel, Vorratsschrank mit MHD und Kommentaren. Läuft auf Vercel, lässt sich auf den Homescreen legen und funktioniert auch offline.

## Aufbau

| Teil | Wo |
| --- | --- |
| App (HTML/CSS/JS, kein Build-Schritt) | `index.html`, `style.css`, `app.js` |
| Offline-Speicher & Homescreen-App | `sw.js`, `manifest.webmanifest`, `icons/` |
| Rezepte | `data/recipes.json` |
| Startdaten für Vorrat und Einkaufszettel (einmalig importiert) | `data/seed.json` |
| Login per Passwort | `api/auth.js` |
| Vorrat, Einkaufszettel, Kommentare, ausgeblendete Rezepte | `api/data.js` → Upstash Redis (Schlüssel beginnen mit `kochbuch:`) |

Rezepte sind ohne Anmeldung sichtbar. Alles Persönliche liegt hinter dem Login.

## Einrichtung auf Vercel

1. **Projekt anlegen:** Vercel → *Add New… → Project* → dieses Repo importieren → *Deploy*. Keine Build-Einstellungen nötig.
2. **Datenbank verbinden:** Im neuen Projekt → *Storage* → die bestehende **Upstash-for-Redis**-Datenbank (die von garage-games) auswählen → *Connect Project*. Vercel setzt `KV_REST_API_URL` und `KV_REST_API_TOKEN` automatisch. Die Daten des Kochbuchs liegen getrennt unter `kochbuch:…`.
3. **Passwort festlegen** (Projekt → *Settings → Environment Variables*): `APP_PASSWORD` mit deinem Kochbuch-Passwort anlegen, für Production und Preview, gern als *Sensitive*.
4. **Neu deployen** (*Deployments → … → Redeploy*), damit die Variable greift.
5. **Deployment-Schutz:** Unter *Settings → Deployment Protection* die Vercel-Authentifizierung auf „Only Preview Deployments“ stellen, sonst verlangt die Hauptadresse einen Vercel-Login.
6. **Aufs Handy:** Adresse im Browser öffnen → *Teilen → Zum Home-Bildschirm* (iPhone) bzw. *⋮ → App installieren* (Android).

## Rezepte hinzufügen

Rezepte stehen in `data/recipes.json`. Ein Eintrag sieht so aus:

```json
{
  "id": "kuerbis-orangen-suppe",
  "type": "Kochen",
  "emoji": "🥣",
  "title": "Kürbis-Orangen-Suppe mit Ingwer",
  "description": "Kurzbeschreibung",
  "category": "Suppe",
  "mains": ["Kürbis"],
  "servings": 4,
  "time": 60,
  "equipment": ["Großer Topf", "Pürierstab"],
  "ingredients": [{ "group": "optional", "name": "Kürbis", "amount": 750, "unit": "g" }],
  "steps": [{ "title": "Köcheln", "minutes": 20, "text": "…" }],
  "notes": "Tipps & Varianten",
  "added": "2026-11-10T09:15:00+01:00"
}
```

- `type`: `Kochen`, `Backen` oder `Grundrezepte`
- `category` beim Kochen: Pfannengericht, Ofengericht, Topfgericht, Suppe, Salat
- Emojis beim Backen: 🧁 Kleingebäck, 🎂 Kuchen/Torte, 🍞 Brot
- Kuchen: `"hideServings": true` (keine Stückzahl), Vorräte wie Öl oder Dressing: `"hideServings": true` und `"yield": "ca. 300 ml"`
- Mengenbereiche: `"amount": 2, "amountMax": 3`
- Bei den Geräten nur Töpfe, Pfannen, Formen und besondere Geräte, keine Grundausstattung und keine Klammerzusätze

Nach dem Push deployt Vercel automatisch. „Rezept löschen“ in der App blendet ein Rezept nur für dich aus; endgültig entfernen geht hier in der Datei.
