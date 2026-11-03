/* Klassennotizen: kleiner CORS-Proxy für LuxASR (Cloudflare Worker, Gratis-Tarif reicht).

   Warum? Browser dürfen eine Antwort von luxasr.uni.lu nur lesen, wenn der Server das für die
   Seite (hier: github.io) erlaubt (CORS). Die Android-App umging das nativ, eine Web-App kann es nicht.
   Der Worker nimmt die Anfragen der App an, reicht sie 1:1 an LuxASR weiter und schickt die Antwort
   mit den nötigen CORS-Headern zurück. Er speichert und protokolliert nichts.

   Einrichtung: siehe README.md ("Proxy"). Einzige Einstellung (Worker -> Settings -> Variables):
     ALLOWED_ORIGIN = https://DEIN-NAME.github.io     (mehrere durch Komma trennen)
   Nur Anfragen von dieser Adresse werden beantwortet, damit niemand sonst den Proxy mitbenutzt. */

const UPSTREAM = "https://luxasr.uni.lu";
const MAX_BYTES = 25 * 1024 * 1024;
// Erlaubt sind nur die drei Aufrufe, die die App braucht.
const ROUTES = [
  { method: "POST", path: /^\/asr2$/ },
  { method: "GET", path: /^\/v3\/asr\/jobs\/[\w-]+$/ },
  { method: "GET", path: /^\/v3\/asr\/jobs\/[\w-]+\/result$/ },
];

export default {
  async fetch(request, env) {
    const allowed = String(env.ALLOWED_ORIGIN || "").split(",").map(s => s.trim().replace(/\/+$/, "")).filter(Boolean);
    const origin = request.headers.get("Origin") || "";
    const reply = (body, status, extra = {}) => new Response(body, { status, headers: { "Vary": "Origin", ...extra } });

    if (!allowed.length) return reply("ALLOWED_ORIGIN ist nicht gesetzt.", 500);
    if (!allowed.includes(origin)) return reply("Origin nicht erlaubt.", 403);
    const cors = { "Access-Control-Allow-Origin": origin };

    if (request.method === "OPTIONS") {
      return reply(null, 204, {
        ...cors,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Filename",
        "Access-Control-Max-Age": "86400",
      });
    }

    const url = new URL(request.url);
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
