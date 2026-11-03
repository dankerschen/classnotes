/* Klassennotizen: kleiner Cloudflare-Worker (Gratis-Tarif reicht). Zwei Aufgaben:

   1) CORS-Proxy für LuxASR.
      Browser dürfen eine Antwort von luxasr.uni.lu nur lesen, wenn der Server das für die Seite
      (hier: github.io) erlaubt (CORS). Der Worker reicht die Anfragen 1:1 weiter und ergänzt die
      CORS-Header. Er speichert und protokolliert dabei nichts.

   2) Cloud-Backup (optional, /backup...).
      Die App lädt ihre Daten bereits im Browser VERSCHLÜSSELT (AES-GCM, Passwort nur in der App) hoch.
      Der Worker legt den unlesbaren Text in Workers KV ab: "latest" und je Tag eine Kopie, die nach
      8 Tagen automatisch verfällt. Zugriff nur mit dem geheimen Token (Header X-Backup-Token).

   Einrichtung: siehe README.md. Nötig für das Cloud-Backup:
     - KV-Bindung mit dem Namen   BACKUPS       (Worker -> Settings -> Bindings -> KV namespace)
     - Secret/Variable            BACKUP_TOKEN  (langer Zufallstext, derselbe wie in der App)
   Erlaubt sind nur Anfragen von DEFAULT_ORIGIN bzw. der Variable ALLOWED_ORIGIN (mehrere durch Komma). */

const UPSTREAM = "https://luxasr.uni.lu";
// Erlaubte Seite(n), falls die Variable ALLOWED_ORIGIN nicht gesetzt ist (mehrere durch Komma trennen).
const DEFAULT_ORIGIN = "https://dankerschen.github.io";
const MAX_BYTES = 25 * 1024 * 1024;          // Audio
const MAX_BACKUP_BYTES = 5 * 1024 * 1024;    // Cloud-Backup (verschlüsselte Daten)
const DAY_TTL = 8 * 24 * 3600;               // Tageskopien verfallen nach 8 Tagen
// Erlaubt sind nur diese Aufrufe an LuxASR.
const ROUTES = [
  { method: "POST", path: /^\/asr2$/ },
  { method: "GET", path: /^\/v3\/asr\/jobs\/[\w-]+$/ },
  { method: "GET", path: /^\/v3\/asr\/jobs\/[\w-]+\/result$/ },
];

function safeEqual(a, b) { // Vergleich ohne frühen Abbruch
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}

export default {
  async fetch(request, env) {
    const allowed = String(env.ALLOWED_ORIGIN || DEFAULT_ORIGIN).split(",").map(s => s.trim().replace(/\/+$/, "")).filter(Boolean);
    const origin = request.headers.get("Origin") || "";
    const reply = (body, status, extra = {}) => new Response(body, { status, headers: { "Vary": "Origin", ...extra } });

    if (!allowed.length) return reply("ALLOWED_ORIGIN ist nicht gesetzt.", 500);
    if (!allowed.includes(origin)) return reply("Origin nicht erlaubt.", 403);
    const cors = { "Access-Control-Allow-Origin": origin };

    if (request.method === "OPTIONS") {
      return reply(null, 204, {
        ...cors,
        "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Filename, X-Backup-Token",
        "Access-Control-Max-Age": "86400",
      });
    }

    const url = new URL(request.url);
    if (url.pathname === "/backup" || url.pathname.startsWith("/backup/")) return backup(request, env, url, cors, reply);

    if (!ROUTES.some(r => r.method === request.method && r.path.test(url.pathname))) return reply("Nicht erlaubt.", 404, cors);
    if (Number(request.headers.get("Content-Length") || 0) > MAX_BYTES) return reply("Datei zu groß.", 413, cors);

    const headers = new Headers();
    for (const h of ["Content-Type", "X-Filename", "Accept"]) { const v = request.headers.get(h); if (v) headers.set(h, v); }

    let up;
    try {
      up = await fetch(UPSTREAM + url.pathname + url.search, {
        method: request.method, headers, body: request.method === "POST" ? request.body : undefined,
      });
    } catch (e) { return reply("LuxASR nicht erreichbar.", 502, cors); }

    const out = new Headers(cors);
    out.set("Vary", "Origin");
    const ct = up.headers.get("Content-Type"); if (ct) out.set("Content-Type", ct);
    return new Response(up.body, { status: up.status, headers: out });
  },
};

/* ---------- Cloud-Backup ---------- */
async function backup(request, env, url, cors, reply) {
  const json = (obj, status = 200) => reply(JSON.stringify(obj), status, { ...cors, "Content-Type": "application/json" });
  if (!env.BACKUPS || !env.BACKUP_TOKEN) return reply("Cloud-Backup ist im Worker noch nicht eingerichtet (KV-Bindung BACKUPS und BACKUP_TOKEN).", 501, cors);
  if (!safeEqual(request.headers.get("X-Backup-Token") || "", String(env.BACKUP_TOKEN))) return reply("Token falsch.", 401, cors);

  const p = url.pathname.replace(/\/+$/, "");
  if (request.method === "GET" && p === "/backup/status") {
    const latest = await env.BACKUPS.getWithMetadata("latest");
    const days = (await env.BACKUPS.list({ prefix: "day:" })).keys.map(k => k.name.slice(4)).sort();
    return json({ ok: true, latest: latest.value ? (latest.metadata && latest.metadata.at) || true : null, days });
  }
  if (request.method === "GET" && p === "/backup") {
    const day = url.searchParams.get("day");
    if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) return reply("Ungültiger Tag.", 400, cors);
    const v = await env.BACKUPS.get(day ? "day:" + day : "latest");
    return v === null ? reply("Kein Backup.", 404, cors) : reply(v, 200, { ...cors, "Content-Type": "text/plain" });
  }
  if (request.method === "PUT" && p === "/backup") {
    if (Number(request.headers.get("Content-Length") || 0) > MAX_BACKUP_BYTES) return reply("Backup zu groß.", 413, cors);
    const body = await request.text();
    if (body.length > MAX_BACKUP_BYTES) return reply("Backup zu groß.", 413, cors);
    let o; try { o = JSON.parse(body); } catch (e) { return reply("Kein gültiges Backup.", 400, cors); }
    if (!o || o.v !== 1 || !o.ct || !o.iv || !o.salt) return reply("Kein gültiges Backup.", 400, cors);
    const at = new Date().toISOString();
    await env.BACKUPS.put("latest", body, { metadata: { at } });
    await env.BACKUPS.put("day:" + at.slice(0, 10), body, { expirationTtl: DAY_TTL });
    return json({ ok: true, at });
  }
  return reply("Nicht erlaubt.", 404, cors);
}
