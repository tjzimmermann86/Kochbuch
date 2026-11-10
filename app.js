/* Kochbuch – App-Logik.
   Rezepte kommen aus /data/recipes.json (im Repo gepflegt).
   Vorrat, Einkaufszettel, Kommentare und ausgeblendete Rezepte liegen nach dem Login in Redis
   und werden zusätzlich auf dem Handy zwischengespeichert, damit alles auch offline funktioniert. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  /* ---------- Zustand ---------- */
  const KINDS = ["Kochen", "Backen", "Grundrezepte"];
  let recipes = store.get("kb-recipes", []);
  let data = store.get("kb-data", { pantry: {}, shopping: {}, comments: {}, hidden: {} });
  let queue = store.get("kb-queue", []);
  let auth = store.get("kb-auth", { loggedIn: false, email: null });
  const ui = {
    tab: "rezepte", current: null, kind: store.get("kb-kind", "Kochen"), filter: "Alle", main: "Alle", query: "",
    servings: null, cookStage: false, msg: "", draft: "", rating: 0, confirm: null, delStage: 0, clearStage: false,
    loginErr: "", editPantry: null,
  };
  if (!KINDS.includes(ui.kind)) ui.kind = "Kochen";
  const kindOf = (r) => KINDS.includes(r.type) ? r.type : "Kochen";
  const visibleRecipes = () => recipes.filter(r => !data.hidden[r.id]);

  /* ---------- Synchronisation ---------- */
  function applyOp(o) {
    const col = data[o.c] || (data[o.c] = {});
    if (o.a === "del") delete col[o.id]; else col[o.id] = o.v;
  }
  function op(c, a, id, v) {
    const o = { c, a, id, v };
    applyOp(o);
    queue.push(o);
    store.set("kb-data", data); store.set("kb-queue", queue);
    flush();
  }
  let flushing = false;
  async function flush() {
    if (flushing || !auth.loggedIn || !queue.length) return syncLabel();
    if (!navigator.onLine) return syncLabel();
    flushing = true; syncLabel();
    const batch = queue.slice(0, 150);
    try {
      const r = await fetch("/api/data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ops: batch }), credentials: "same-origin" });
      if (r.status === 401) { setAuth(false); return; }
      if (!r.ok) throw new Error();
      queue = queue.slice(batch.length);
      store.set("kb-queue", queue);
    } catch { /* später erneut */ }
    flushing = false; syncLabel();
    if (queue.length && navigator.onLine) setTimeout(flush, 3000);
  }
  async function pull() {
    if (!auth.loggedIn || !navigator.onLine) return;
    try {
      const r = await fetch("/api/data", { credentials: "same-origin" });
      if (r.status === 401) { setAuth(false); return; }
      if (!r.ok) return;
      data = await r.json();
      for (const k of ["pantry", "shopping", "comments", "hidden"]) data[k] = data[k] || {};
      queue.forEach(applyOp);
      store.set("kb-data", data);
      render();
    } catch {}
  }
  function syncLabel() {
    const s = $("sync");
    if (!auth.loggedIn) s.textContent = "";
    else if (!navigator.onLine) s.textContent = queue.length ? "offline · wird gesendet" : "offline";
    else s.textContent = queue.length ? "speichert …" : "";
  }
  function setAuth(on, email) {
    auth = { loggedIn: on, email: on ? email : null };
    store.set("kb-auth", auth);
    syncLabel(); render();
  }
  async function checkAuth() {
    try {
      const r = await fetch("/api/auth", { credentials: "same-origin" });
      const j = await r.json();
      setAuth(!!j.loggedIn, j.email);
      if (j.loggedIn) { await flush(); await pull(); }
    } catch { /* offline: letzten Stand behalten */ }
  }
  async function loadRecipes() {
    try {
      const r = await fetch("/data/recipes.json", { cache: "no-cache" });
      if (r.ok) { recipes = await r.json(); store.set("kb-recipes", recipes); render(); }
    } catch {}
  }

  /* ---------- Mengen ---------- */
  const UNITS = { g: "g", kg: "kg", ml: "ml", l: "l", tl: "TL", el: "EL", prise: "Prise", tsp: "TL", tbsp: "EL", pinch: "Prise" };
  function fmtAmount(a, unit) {
    if (a == null || a === "") return "";
    let v = Number(a);
    if (!isFinite(v)) return esc(a);
    const u = (unit || "").toLowerCase();
    if (u === "g" && v >= 1000) { v /= 1000; unit = "kg"; }
    if (u === "ml" && v >= 1000) { v /= 1000; unit = "l"; }
    const fr = { 0.25: "¼", 0.5: "½", 0.75: "¾", 0.33: "⅓", 0.67: "⅔" };
    const whole = Math.floor(v), rest = Math.round((v - whole) * 100) / 100;
    let s;
    if (["g", "ml"].includes(u) && v >= 10) s = String(Math.round(v / 5) * 5);
    else if (rest === 0) s = String(whole);
    else if (fr[rest] && v < 10) s = (whole ? whole + " " : "") + fr[rest];
    else s = (Math.round(v * 10) / 10).toLocaleString("de-DE");
    const label = unit ? (UNITS[unit.toLowerCase()] || unit) : "";
    return s + (label ? " " + label : "");
  }
  const fmtMin = (m) => !m ? "" : m >= 60 ? `${Math.floor(m / 60)} Std ${m % 60 ? (m % 60) + " Min" : ""}`.trim() : `${m} Min`;

  const ADJ = /\b(frische?r?|getrocknete?|gemahlene?r?|ger(ö|oe)stete?|gehackte?|weiche?|zimmerwarme?|geschmolzene?|lauwarme?s?|fein|grob|kalte?)\b/g;
  const translit = (s) => s.replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");
  const cleanName = (n) => String(n || "").split(/[,(–]/)[0].replace(/\s+/g, " ").trim();
  const keyOf = (n) => translit(cleanName(n).toLowerCase().replace(ADJ, "")).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const stem = (k) => k.replace(/(en|er|n|e|s)$/, "");
  const sameItem = (a, b) => { const ka = keyOf(a), kb = keyOf(b); return !!ka && (ka === kb || stem(ka) === stem(kb)); };
  const CONV = { g: ["g", 1], kg: ["g", 1000], ml: ["g", 1], l: ["g", 1000], el: ["el", 1], tl: ["el", 1 / 3], "": ["stk", 1], stk: ["stk", 1], "stück": ["stk", 1] };
  const baseOf = (unit) => CONV[String(unit || "").toLowerCase().replace(/\.$/, "")] || [String(unit || "").toLowerCase(), 1];
  const toBase = (v, unit) => { const [u, f] = baseOf(unit); return { u, v: v * f }; };
  const fromBase = (v, unit) => v / baseOf(unit)[1];
  const round = (v) => Math.round(v * 100) / 100;
  const pantryList = () => Object.entries(data.pantry).map(([id, p]) => ({ id, ...p }));
  const shopList = () => Object.entries(data.shopping).map(([id, s]) => ({ id, ...s }));
  const findPantry = (name) => pantryList().find(p => sameItem(p.name, name));
  const skipForShopping = (i) => /optional|zum |für die /i.test(i.name || "");
  const docId = (name, unit) => (keyOf(name) || "item") + "_" + (baseOf(unit)[0].replace(/[^a-z0-9]/g, "") || "x");

  function daysLeft(best) {
    if (!best) return null;
    const t = new Date(); t.setHours(0, 0, 0, 0);
    return Math.round((new Date(best + "T00:00:00") - t) / 86400000);
  }
  function bestChip(best) {
    const d = daysLeft(best);
    if (d == null) return "";
    if (d < 0) return `<span class="mhd bad">abgelaufen</span>`;
    if (d === 0) return `<span class="mhd warn">heute</span>`;
    if (d <= 3) return `<span class="mhd warn">noch ${d} ${d === 1 ? "Tag" : "Tage"}</span>`;
    return `<span class="mhd ok">bis ${new Date(best + "T00:00:00").toLocaleDateString("de-DE", { day: "numeric", month: "short" })}</span>`;
  }

  function planFor(r, f) {
    const missing = [], have = [];
    for (const i of r.ingredients || []) {
      if (skipForShopping(i)) continue;
      const p = findPantry(i.name);
      const amt = i.amountMax ?? i.amount;
      if (amt == null) { (p ? have : missing).push({ i }); continue; }
      const need = toBase(amt * f, i.unit);
      if (!p) { missing.push({ i, base: need }); continue; }
      if (p.amount == null || p.amount === "") { have.push({ i, p }); continue; }
      const got = toBase(Number(p.amount), p.unit);
      if (got.u !== need.u) { have.push({ i, p }); continue; }
      if (got.v >= need.v - 1e-6) have.push({ i, p });
      else missing.push({ i, base: { u: need.u, v: need.v - got.v } });
    }
    return { missing, have };
  }
  function addToShopping(r, f) {
    const { missing, have } = planFor(r, f);
    const touched = new Set();
    for (const m of missing) {
      const name = cleanName(m.i.name);
      const id = docId(name, m.i.unit);
      const ex = data.shopping[id];
      const v = ex ? { ...ex } : { name, unit: m.i.unit || "", amount: null, recipes: [], checked: false, created: new Date().toISOString() };
      if (m.base) v.amount = round((Number(v.amount) || 0) + fromBase(m.base.v, v.unit));
      if (!v.recipes.includes(r.title)) v.recipes = [...v.recipes, r.title];
      v.checked = false;
      op("shopping", "set", id, v);
      touched.add(id);
    }
    return { added: touched.size, have: have.length };
  }
  function cookPlan(r, f) {
    const out = [];
    for (const i of r.ingredients || []) {
      if (i.amount == null) continue;
      const p = findPantry(i.name);
      if (!p || p.amount == null || p.amount === "") continue;
      const need = toBase(i.amount * f, i.unit), got = toBase(Number(p.amount), p.unit);
      if (got.u !== need.u) continue;
      out.push({ p, rest: round(fromBase(got.v - need.v, p.unit)) });
    }
    return out;
  }
  function addToPantry(name, amount, unit, best) {
    const ex = findPantry(name);
    const amt = amount === "" || amount == null ? null : Number(amount);
    if (ex) {
      const v = { ...data.pantry[ex.id], updated: new Date().toISOString() };
      if (amt != null) {
        if (ex.amount != null && ex.amount !== "" && baseOf(ex.unit)[0] === baseOf(unit)[0]) v.amount = round(Number(ex.amount) + fromBase(toBase(amt, unit).v, ex.unit));
        else { v.amount = amt; v.unit = unit; }
      }
      if (best) v.best = best;
      op("pantry", "set", ex.id, v);
    } else {
      op("pantry", "set", rid(), { name: cleanName(name), amount: amt, unit: unit || "", best: best || "", updated: new Date().toISOString() });
    }
  }

  /* ---------- Darstellung ---------- */
  const UNIT_OPTS = ["", "g", "kg", "ml", "l", "Stück", "EL", "TL", "Pck.", "Dose", "Bund", "Prise"];
  const unitSelect = (attr, val) => `<select ${attr} aria-label="Einheit">${UNIT_OPTS.map(u => `<option value="${esc(u)}"${u === (val || "") ? " selected" : ""}>${u || "—"}</option>`).join("")}${val && !UNIT_OPTS.includes(val) ? `<option selected>${esc(val)}</option>` : ""}</select>`;

  function loginCard(what) {
    return `<form class="login" id="login"><h2>🔒 Anmelden</h2><p>${what} ist nur für dich. Gib einmal dein Kochbuch-Passwort ein, dann bleibt dieses Gerät angemeldet.</p>
      <input class="field" id="login-pw" type="password" autocomplete="current-password" placeholder="Passwort" required>
      <button class="btn" type="submit">Anmelden</button>
      ${ui.loginErr ? `<p style="color:var(--danger)">${esc(ui.loginErr)}</p>` : ""}</form>`;
  }


  function renderList() {
    const all = visibleRecipes();
    const ofKind = all.filter(r => kindOf(r) === ui.kind);
    const mains = [...new Set(ofKind.flatMap(r => r.mains || []))].sort((a, b) => a.localeCompare(b, "de"));
    const cats = [...new Set(ofKind.map(r => r.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "de"));
    if (ui.main !== "Alle" && !mains.includes(ui.main)) ui.main = "Alle";
    if (ui.filter !== "Alle" && !cats.includes(ui.filter)) ui.filter = "Alle";
    const q = ui.query.trim().toLowerCase();
    const list = ofKind
      .filter(r => ui.filter === "Alle" || r.category === ui.filter)
      .filter(r => ui.main === "Alle" || (r.mains || []).includes(ui.main))
      .filter(r => !q || [r.title, r.description, r.category, ...(r.tags || []), ...(r.ingredients || []).map(i => i.name)].join(" ").toLowerCase().includes(q))
      .sort((a, b) => String(b.added || "").localeCompare(String(a.added || "")));
    const chipRow = (label, items, attr, cur) => `<div class="chiprow"><span class="chiplabel">${label}</span>${["Alle", ...items].map(c => `<button type="button" class="chip" ${attr}="${esc(c)}" aria-pressed="${c === cur}">${esc(c)}</button>`).join("")}</div>`;
    return `
      <input class="search" id="q" type="search" placeholder="Rezept oder Zutat suchen …" value="${esc(ui.query)}" aria-label="Suchen">
      ${mains.length > 1 ? chipRow("Hauptzutat", mains, "data-main", ui.main) : ""}
      ${cats.length > 1 ? chipRow("Kategorie", cats, "data-cat", ui.filter) : ""}
      <ul class="list">${list.map(r => `
        <li><a href="#r-${esc(r.id)}"><span class="e" aria-hidden="true">${esc(r.emoji || "🍽️")}</span>
          <span><span class="t">${esc(r.title)}</span><span class="m">${esc([r.category, fmtMin(r.time), r.servings && !r.hideServings ? r.servings + " " + (r.servingsLabel || "Portionen") : ""].filter(Boolean).join(" · "))}</span></span></a></li>`).join("")}
      </ul>
      ${!ofKind.length ? `<p class="empty">Noch keine Rezepte hier.</p>` : !list.length ? `<p class="empty">Nichts passt zu „${esc(ui.query)}“.</p>` : ""}`;
  }

  function delMarkup() {
    if (ui.delStage === 1) return `<span>Rezept ausblenden?</span><button type="button" class="link" data-act="del-cancel">Abbrechen</button><button type="button" class="link" data-act="del-next">Ja, weiter</button>`;
    if (ui.delStage === 2) return `<span>Wirklich? Es verschwindet aus deiner Liste.</span><button type="button" class="link" data-act="del-cancel">Abbrechen</button><button type="button" class="link danger" data-act="del-final">Endgültig ausblenden</button>`;
    return `<button type="button" class="link" data-act="del">Rezept löschen</button>`;
  }

  function renderDetail(r) {
    const base = Number(r.servings) || 1;
    if (ui.servings == null) ui.servings = base;
    const f = ui.servings / base;
    const plan = planFor(r, f);
    const haveSet = new Set(plan.have.map(h => h.i));
    let lastGroup = null;
    const ing = (r.ingredients || []).map((i, n) => `${i.group && i.group !== lastGroup ? `<li class="grp">${esc(lastGroup = i.group)}</li>` : ""}
      <li><label><input class="chk" type="checkbox" id="ing-${n}"><span class="amt">${i.amountMax != null ? fmtAmount(i.amount * f, null) + "–" + fmtAmount(i.amountMax * f, i.unit) : fmtAmount(i.amount != null ? i.amount * f : null, i.unit)}</span><span>${esc(i.name)}${auth.loggedIn && haveSet.has(i) ? ` <span class="have">zuhause</span>` : ""}</span></label></li>`).join("");
    const steps = (r.steps || []).map(s => `<li><div><span class="st">${esc(s.title || "")}</span>${s.minutes ? `<span class="time">${esc(s.minutes)} Min</span>` : ""}<p>${esc(s.text)}</p></div></li>`).join("");
    const cookWord = { Backen: "Gebacken", Grundrezepte: "Zubereitet" }[kindOf(r)] || "Gekocht";
    const cook = ui.cookStage ? cookPlan(r, f) : [];
    const comments = Object.entries(data.comments).map(([id, c]) => ({ id, ...c })).filter(c => c.recipe === r.id).sort((a, b) => String(b.created).localeCompare(String(a.created)));
    const added = r.added ? new Date(r.added).toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" }) : "";
    return `
      <div class="eyebrow">${esc(r.category || "Rezept")}</div>
      <h2 class="rtitle">${r.emoji ? esc(r.emoji) + " " : ""}${esc(r.title)}</h2>
      ${r.description ? `<p class="lede">${esc(r.description)}</p>` : ""}
      <div class="meta">
        <div class="facts">
          ${r.hideServings ? "" : `<div class="stepper"><button type="button" data-act="minus" aria-label="Weniger">−</button><span>${ui.servings} ${r.servingsLabel || (ui.servings === 1 ? "Portion" : "Portionen")}</span><button type="button" data-act="plus" aria-label="Mehr">+</button></div>`}
          ${r.time ? `<span class="fact">Zeit <b>${esc(fmtMin(r.time))}</b></span>` : ""}
          ${r.oven ? `<span class="fact">Ofen <b>${esc(r.oven)}</b></span>` : ""}
          ${r.yield ? `<span class="fact">Ergibt <b>${esc(r.yield)}</b></span>` : ""}
        </div>
        ${(r.equipment || []).length ? `<div class="gear" aria-label="Küchengeräte">${r.equipment.map(e => `<span>${esc(e)}</span>`).join("")}</div>` : ""}
      </div>
      ${auth.loggedIn ? `<div class="kitchen">
        <button type="button" class="btn" data-act="to-shop">🛒 Einkaufszettel${plan.missing.length ? ` (${plan.missing.length})` : ""}</button>
        ${ui.cookStage ? "" : `<button type="button" class="btn ghost" data-act="cook">✓ ${cookWord}</button>`}
        ${ui.cookStage ? `<div class="cookbox"><p>${cook.length ? "Vom Vorrat abziehen: " + cook.map(c => esc(c.p.name) + (c.rest <= 0 ? " (aufgebraucht)" : " → " + fmtAmount(c.rest, c.p.unit))).join(", ") : "Im Vorrat ist nichts mit passender Menge, es wird nichts abgezogen."}</p>
          <button type="button" class="btn ghost" data-act="cook-cancel">Abbrechen</button><button type="button" class="btn" data-act="cook-final">Bestätigen</button></div>` : ""}
        <p class="msg">${esc(ui.msg)}</p>
      </div>` : ""}
      <h3>Zutaten</h3><ul class="ing">${ing}</ul>
      <h3>Zubereitung</h3><ol class="steps">${steps}</ol>
      ${r.notes ? `<div class="notes"><h3>Tipps &amp; Varianten</h3><p>${esc(r.notes)}</p></div>` : ""}
      <h3>Kommentare</h3>
      ${auth.loggedIn ? `<form class="cform" id="cform">
        <div class="stars">${[1, 2, 3, 4, 5].map(n => `<button type="button" class="star" data-star="${n}" aria-pressed="${n <= ui.rating}" aria-label="${n} von 5 Sternen">★</button>`).join("")}<span class="hint">${ui.rating ? ui.rating + " von 5" : "Bewertung (optional)"}</span></div>
        <textarea id="ctext" rows="3" placeholder="Wie war's? Was ist dir aufgefallen?">${esc(ui.draft)}</textarea>
        <button class="btn" type="submit">Kommentar speichern</button></form>` : `<p class="empty" style="text-align:left;padding:0">Zum Kommentieren unter Einkauf oder Vorrat anmelden.</p>`}
      <ul class="clist">${comments.map(c => `<li><div class="chead"><span>${esc(new Date(c.created).toLocaleDateString("de-DE", { day: "numeric", month: "short", year: "numeric" }))}</span>
        ${c.rating ? `<span class="cstars">${"★".repeat(c.rating)}<span class="off">${"★".repeat(5 - c.rating)}</span></span>` : ""}
        ${ui.confirm === c.id ? `<button type="button" class="link" data-act="c-cancel">Abbrechen</button><button type="button" class="link danger" data-cdel="${esc(c.id)}">Endgültig löschen</button>` : `<button type="button" class="link" data-cask="${esc(c.id)}">Löschen</button>`}
        </div><p>${esc(c.text)}</p></li>`).join("")}</ul>
      <div class="foot"><span>${added ? "Eingetragen am " + esc(added) : ""}</span>${auth.loggedIn ? `<span>${delMarkup()}</span>` : ""}</div>`;
  }

  function renderShop() {
    if (!auth.loggedIn) return `${loginCard("Dein Einkaufszettel")}`;
    const items = shopList().sort((a, b) => (a.checked - b.checked) || a.name.localeCompare(b.name, "de"));
    const checked = items.filter(s => s.checked).length;
    return `
      
      <form class="addrow" id="shop-add">
        <input id="sa-name" placeholder="Was fehlt noch?" aria-label="Artikel" required autocomplete="off">
        <input id="sa-amt" type="number" step="any" min="0" inputmode="decimal" placeholder="Menge" aria-label="Menge">
        ${unitSelect('id="sa-unit"', "")}
        <button class="btn" type="submit">Hinzufügen</button>
      </form>
      <ul class="shoplist">${items.map(s => `
        <li class="${s.checked ? "done" : ""}"><label><input class="chk" type="checkbox" data-shop="${esc(s.id)}" ${s.checked ? "checked" : ""}>
          <span class="amt">${s.amount != null ? fmtAmount(s.amount, s.unit) : ""}</span>
          <span class="nm">${esc(s.name)}${(s.recipes || []).length ? `<small>${esc(s.recipes.join(", "))}</small>` : ""}</span></label></li>`).join("")}
      </ul>
      ${!items.length ? `<p class="empty">Der Einkaufszettel ist leer.</p>` : ""}
      ${checked ? `<div class="actions"><button type="button" class="btn" data-act="to-pantry">${checked} gekaufte in den Vorrat</button><button type="button" class="btn ghost" data-act="remove-checked">Gekaufte entfernen</button></div>` : ""}
      ${items.length ? `<div class="foot"><span></span><span>${ui.clearStage ? `Ganzen Zettel leeren? <button type="button" class="link" data-act="clear-cancel">Abbrechen</button> <button type="button" class="link danger" data-act="clear-final">Leeren</button>` : `<button type="button" class="link" data-act="clear">Zettel leeren</button>`}</span></div>` : ""}
      <p class="msg">${esc(ui.msg)}</p>`;
  }

  function renderPantry() {
    if (!auth.loggedIn) return `${loginCard("Dein Vorrat")}`;
    const items = pantryList().sort((a, b) => {
      const da = daysLeft(a.best), dbb = daysLeft(b.best);
      if (da != null && dbb != null) return da - dbb;
      if (da != null) return -1; if (dbb != null) return 1;
      return a.name.localeCompare(b.name, "de");
    });
    const bad = items.filter(p => (daysLeft(p.best) ?? 99) < 0).length;
    const soon = items.filter(p => { const d = daysLeft(p.best); return d != null && d >= 0 && d <= 3; }).length;
    return `
      
      <p class="lede">${bad || soon ? [bad ? `${bad} abgelaufen` : "", soon ? `${soon} bald fällig` : ""].filter(Boolean).join(" · ") : "Ohne Menge gilt eine Zutat als vorhanden – gut für Salz, Gewürze und Öl."}</p>
      <form class="addrow" id="pan-add">
        <input id="pa-name" placeholder="Zutat, z. B. Mehl" aria-label="Zutat" required autocomplete="off">
        <input id="pa-amt" type="number" step="any" min="0" inputmode="decimal" placeholder="Menge" aria-label="Menge">
        ${unitSelect('id="pa-unit"', "")}
        <input id="pa-best" class="wide" type="date" aria-label="Mindesthaltbarkeitsdatum">
        <button class="btn" type="submit">Speichern</button>
      </form>
      <ul class="pantrylist">${items.map(p => {
        const open = ui.editPantry === p.id;
        return `<li class="${open ? "open" : ""}">
          <button type="button" class="prow" data-pedit="${esc(p.id)}" aria-expanded="${open}">
            <span class="nm">${esc(p.name)}</span>
            <span class="pq">${p.amount != null && p.amount !== "" ? fmtAmount(p.amount, p.unit) : "da"}</span>
            ${bestChip(p.best)}
          </button>
          ${open ? `<div class="pedit">
            <input type="number" step="any" min="0" inputmode="decimal" value="${p.amount ?? ""}" data-pamt="${esc(p.id)}" placeholder="Menge" aria-label="Menge ${esc(p.name)}">
            ${unitSelect(`data-punit="${esc(p.id)}"`, p.unit)}
            <input type="date" value="${esc(p.best || "")}" data-pbest="${esc(p.id)}" aria-label="MHD ${esc(p.name)}">
            <span class="pdel">${ui.confirm === p.id ? `<button type="button" class="link" data-act="p-cancel">Abbrechen</button><button type="button" class="link danger" data-pdel="${esc(p.id)}">Löschen</button>` : `<button type="button" class="link" data-pask="${esc(p.id)}">Entfernen</button>`}</span>
          </div>` : ""}
        </li>`; }).join("")}
      </ul>
      ${!items.length ? `<p class="empty">Noch nichts im Vorrat.</p>` : ""}
      <p class="msg">${esc(ui.msg)}</p>
      <div class="foot"><span></span><button type="button" class="link" data-act="logout">Abmelden</button></div>`;
  }

  function badges() {
    const open = shopList().filter(s => !s.checked).length;
    $("b-shop").textContent = auth.loggedIn && open ? open : "";
    const warn = pantryList().filter(p => { const d = daysLeft(p.best); return d != null && d <= 3; }).length;
    $("b-pantry").textContent = auth.loggedIn && warn ? warn : "";
    document.querySelectorAll(".tabbar a").forEach(a => a.setAttribute("aria-current", String(a.dataset.tab === ui.tab)));
  }

  function render() {
    const r = ui.current ? visibleRecipes().find(x => x.id === ui.current) : null;
    $("back").hidden = !r;
    $("title").textContent = r ? "Kochbuch" : ({ einkauf: "Einkaufszettel", vorrat: "Vorrat" }[ui.tab] || "Kochbuch");
    const active = document.activeElement;
    const keepFocus = active && active.id && ["q", "ctext", "sa-name", "pa-name"].includes(active.id) ? active.id : null;
    const onList = !r && ui.tab === "rezepte";
    const seg = `<div class="seg${!r && ui.tab !== "rezepte" ? " in-tool" : ""}" role="group" aria-label="Rezeptart">${KINDS.map(k => `<button type="button" data-kind="${k}" aria-pressed="${onList && k === ui.kind}">${k}</button>`).join("")}</div>`;
    $("view").innerHTML = seg + (r ? renderDetail(r) : ui.tab === "einkauf" ? renderShop() : ui.tab === "vorrat" ? renderPantry() : renderList());
    if (keepFocus && $(keepFocus)) { const el = $(keepFocus); el.focus(); try { el.setSelectionRange(el.value.length, el.value.length); } catch {} }
    badges(); syncLabel();
  }

  /* ---------- Navigation ---------- */
  function route() {
    const h = location.hash.replace(/^#/, "");
    const id = h.startsWith("r-") ? h.slice(2) : null;
    const tab = h === "einkauf" || h === "vorrat" ? h : "rezepte";
    if (tab !== ui.tab || id !== ui.current) {
      Object.assign(ui, { msg: "", confirm: null, clearStage: false, cookStage: false, delStage: 0 });
      if (id !== ui.current) Object.assign(ui, { servings: null, draft: "", rating: 0 });
    }
    ui.tab = tab; ui.current = id;
    render();
    window.scrollTo({ top: 0 });
  }
  $("back").addEventListener("click", () => { if (history.length > 1) history.back(); else location.hash = ""; });

  /* ---------- Eingaben ---------- */
  const V = $("view");
  V.addEventListener("input", e => {
    if (e.target.id === "q") { ui.query = e.target.value; render(); }
    if (e.target.id === "ctext") ui.draft = e.target.value;
  });
  V.addEventListener("change", e => {
    const el = e.target, d = el.dataset;
    if (d.shop) { const s = data.shopping[d.shop]; if (s) op("shopping", "set", d.shop, { ...s, checked: el.checked }); render(); }
    if (d.pamt) { const p = data.pantry[d.pamt]; if (p) op("pantry", "set", d.pamt, { ...p, amount: el.value === "" ? null : Number(el.value), updated: new Date().toISOString() }); }
    if (d.punit) { const p = data.pantry[d.punit]; if (p) op("pantry", "set", d.punit, { ...p, unit: el.value, updated: new Date().toISOString() }); }
    if (d.pbest !== undefined) { const p = data.pantry[d.pbest]; if (p) { op("pantry", "set", d.pbest, { ...p, best: el.value || "", updated: new Date().toISOString() }); render(); } }
  });
  V.addEventListener("submit", async e => {
    e.preventDefault();
    const f = e.target;
    if (f.id === "login") {
      const password = $("login-pw").value;
      const btn = f.querySelector("button"); btn.disabled = true; ui.loginErr = "";
      try {
        const r = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }), credentials: "same-origin" });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || "Anmeldung fehlgeschlagen.");
        setAuth(true, null);
        await flush(); await pull();
      } catch (err) { ui.loginErr = navigator.onLine ? err.message : "Du bist offline."; render(); }
    }
    if (f.id === "shop-add") {
      const name = $("sa-name").value.trim(), amt = $("sa-amt").value, unit = $("sa-unit").value;
      if (!name) return;
      const id = docId(name, unit), ex = data.shopping[id];
      op("shopping", "set", id, {
        name: ex ? ex.name : cleanName(name), unit, recipes: ex?.recipes || [], checked: false, created: ex?.created || new Date().toISOString(),
        amount: amt === "" ? (ex ? ex.amount : null) : round((Number(ex?.amount) || 0) + Number(amt)),
      });
      ui.msg = ""; render(); $("sa-name").focus();
    }
    if (f.id === "pan-add") {
      const name = $("pa-name").value.trim();
      if (!name) return;
      addToPantry(name, $("pa-amt").value, $("pa-unit").value, $("pa-best").value);
      ui.msg = `${cleanName(name)} gespeichert.`; render(); $("pa-name").focus();
    }
    if (f.id === "cform") {
      const text = ui.draft.trim();
      if (!text && !ui.rating) return;
      const v = { recipe: ui.current, text, created: new Date().toISOString() };
      if (ui.rating) v.rating = ui.rating;
      op("comments", "set", rid(), v);
      ui.draft = ""; ui.rating = 0; render();
    }
  });
  V.addEventListener("click", e => {
    const t = e.target.closest("button"); if (!t) return;
    const d = t.dataset, act = d.act;
    const r = ui.current ? recipes.find(x => x.id === ui.current) : null;
    const factor = r ? ui.servings / (Number(r.servings) || 1) : 1;
    if (d.kind) {
      if (d.kind !== ui.kind) { ui.kind = d.kind; ui.filter = "Alle"; ui.main = "Alle"; store.set("kb-kind", ui.kind); }
      if (ui.current || ui.tab !== "rezepte") { location.hash = ""; return; }
      return render();
    }
    if (d.main) { ui.main = d.main; return render(); }
    if (d.cat) { ui.filter = d.cat; return render(); }
    if (d.star) { const n = Number(d.star); ui.rating = ui.rating === n ? 0 : n; return render(); }
    if (d.cask) { ui.confirm = d.cask; return render(); }
    if (d.cdel) { op("comments", "del", d.cdel); ui.confirm = null; return render(); }
    if (d.pedit) { ui.editPantry = ui.editPantry === d.pedit ? null : d.pedit; ui.confirm = null; return render(); }
    if (d.pask) { ui.confirm = d.pask; return render(); }
    if (d.pdel) { op("pantry", "del", d.pdel); ui.confirm = null; return render(); }
    switch (act) {
      case "minus": if (ui.servings > 1) ui.servings--; break;
      case "plus": if (ui.servings < 48) ui.servings++; break;
      case "to-shop": { const { added, have } = addToShopping(r, factor); ui.msg = added ? `${added} ${added === 1 ? "Zutat" : "Zutaten"} auf dem Einkaufszettel${have ? `, ${have} schon zuhause` : ""}.` : "Alles schon zuhause."; break; }
      case "cook": ui.cookStage = true; ui.msg = ""; break;
      case "cook-cancel": ui.cookStage = false; break;
      case "cook-final": {
        const plan = cookPlan(r, factor);
        plan.forEach(({ p, rest }) => rest <= 0 ? op("pantry", "del", p.id) : op("pantry", "set", p.id, { ...data.pantry[p.id], amount: rest, updated: new Date().toISOString() }));
        ui.cookStage = false; ui.msg = plan.length ? `Vorrat aktualisiert (${plan.length}).` : "Nichts abgezogen."; break;
      }
      case "c-cancel": case "p-cancel": ui.confirm = null; break;
      case "del": ui.delStage = 1; break;
      case "del-next": ui.delStage = 2; break;
      case "del-cancel": ui.delStage = 0; break;
      case "del-final": op("hidden", "set", r.id, { at: new Date().toISOString() }); ui.delStage = 0; location.hash = ""; return;
      case "to-pantry": {
        const bought = shopList().filter(s => s.checked);
        bought.forEach(s => { addToPantry(s.name, s.amount, s.unit, ""); op("shopping", "del", s.id); });
        ui.msg = `${bought.length} im Vorrat. Trag dort gern noch das MHD ein.`; break;
      }
      case "remove-checked": shopList().filter(s => s.checked).forEach(s => op("shopping", "del", s.id)); break;
      case "clear": ui.clearStage = true; break;
      case "clear-cancel": ui.clearStage = false; break;
      case "clear-final": shopList().forEach(s => op("shopping", "del", s.id)); ui.clearStage = false; break;
      case "logout": fetch("/api/auth", { method: "DELETE" }).finally(() => { queue = []; data = { pantry: {}, shopping: {}, comments: {}, hidden: {} }; store.set("kb-queue", queue); store.set("kb-data", data); setAuth(false); }); return;
      default: return;
    }
    render();
  });

  /* ---------- Farbschema ---------- */
  const themeBtn = $("theme");
  const isDark = () => { const t = document.documentElement.getAttribute("data-theme"); return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches; };
  const savedTheme = store.get("kb-theme", null);
  if (savedTheme === "dark" || savedTheme === "light") document.documentElement.setAttribute("data-theme", savedTheme);
  const syncTheme = () => {
    themeBtn.setAttribute("aria-pressed", String(isDark()));
    document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute("content", isDark() ? "#1c1816" : "#f7f4fb"));
  };
  themeBtn.addEventListener("click", () => { const next = isDark() ? "light" : "dark"; document.documentElement.setAttribute("data-theme", next); store.set("kb-theme", next); syncTheme(); });
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", syncTheme);
  syncTheme();

  /* ---------- Start ---------- */
  window.addEventListener("hashchange", route);
  window.addEventListener("online", () => { flush(); pull(); });
  window.addEventListener("offline", syncLabel);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { flush(); pull(); } });
  route();
  loadRecipes();
  checkAuth();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
})();
