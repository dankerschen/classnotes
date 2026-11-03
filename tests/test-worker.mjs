import worker from "../proxy/worker.js";
const env = { ALLOWED_ORIGIN: "https://dan.github.io, https://other.example/" };
let calls = [];
globalThis.fetch = async (url, init) => { calls.push({ url, init }); 
  if (String(url).includes("/asr2")) return new Response(JSON.stringify({ job_id: "abc-1" }), { status: 202, headers: { "Content-Type": "application/json", "Set-Cookie": "x=1" } });
  return new Response("Hallo Welt", { status: 200, headers: { "Content-Type": "text/plain" } }); };
const req = (m, p, o = {}, body) => new Request("https://proxy.example.workers.dev" + p, { method: m, headers: o, body });
let ok = 0, bad = 0; const t = (name, c) => { console.log(c ? "PASS" : "FAIL", name); c ? ok++ : bad++; };

let r = await worker.fetch(req("OPTIONS", "/asr2?language=lb", { Origin: "https://dan.github.io", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type,x-filename" }), env);
t("preflight 204", r.status === 204);
t("preflight allow-origin", r.headers.get("Access-Control-Allow-Origin") === "https://dan.github.io");
t("preflight allow-headers", /x-filename/i.test(r.headers.get("Access-Control-Allow-Headers")) && /content-type/i.test(r.headers.get("Access-Control-Allow-Headers")));
t("preflight no upstream call", calls.length === 0);

r = await worker.fetch(req("POST", "/asr2?language=lb&outfmt=text&prompt=Anna%2C%20Ben", { Origin: "https://dan.github.io", "Content-Type": "audio/webm", "X-Filename": "n.webm", Cookie: "secret=1" }, new Uint8Array([1,2,3,4])), env);
t("POST status passthrough 202", r.status === 202);
t("POST json body", (await r.json()).job_id === "abc-1");
t("POST allow-origin", r.headers.get("Access-Control-Allow-Origin") === "https://dan.github.io");
t("POST no set-cookie leak", !r.headers.get("Set-Cookie"));
const c = calls[0];
t("upstream url+query", c.url === "https://luxasr.uni.lu/asr2?language=lb&outfmt=text&prompt=Anna%2C%20Ben");
t("upstream headers forwarded", c.init.headers.get("Content-Type") === "audio/webm" && c.init.headers.get("X-Filename") === "n.webm");
t("upstream no cookie/origin", !c.init.headers.get("Cookie") && !c.init.headers.get("Origin"));

r = await worker.fetch(req("GET", "/v3/asr/jobs/abc-1/result", { Origin: "https://other.example" }), env);
t("second origin (trailing slash tolerated) GET result", r.status === 200 && (await r.text()) === "Hallo Welt");
r = await worker.fetch(req("GET", "/v3/asr/jobs/abc-1", { Origin: "https://dan.github.io" }), env);
t("GET job status", r.status === 200);

r = await worker.fetch(req("GET", "/v3/asr/jobs/abc-1", { Origin: "https://evil.example" }), env);
t("foreign origin 403", r.status === 403 && !r.headers.get("Access-Control-Allow-Origin"));
r = await worker.fetch(req("GET", "/v3/asr/jobs/abc-1"), env);
t("no origin 403", r.status === 403);
r = await worker.fetch(req("GET", "/admin", { Origin: "https://dan.github.io" }), env);
t("other path 404", r.status === 404);
r = await worker.fetch(req("DELETE", "/v3/asr/jobs/abc-1", { Origin: "https://dan.github.io" }), env);
t("other method 404", r.status === 404);
r = await worker.fetch(req("POST", "/asr2", { Origin: "https://dan.github.io", "Content-Length": String(30 * 1024 * 1024) }, new Uint8Array(4)), env);
t("too large 413", r.status === 413);
r = await worker.fetch(req("GET", "/v3/asr/jobs/abc-1", { Origin: "https://dankerschen.github.io" }), {});
t("no variable: default origin dankerschen.github.io works", r.status === 200);
r = await worker.fetch(req("GET", "/v3/asr/jobs/abc-1", { Origin: "https://dan.github.io" }), {});
t("no variable: other origin 403", r.status === 403);
globalThis.fetch = async () => { throw new Error("down"); };
r = await worker.fetch(req("GET", "/v3/asr/jobs/abc-1", { Origin: "https://dan.github.io" }), env);
t("upstream down 502 with CORS", r.status === 502 && r.headers.get("Access-Control-Allow-Origin") === "https://dan.github.io");

// ---- Cloud-Backup (fake KV) ----
class FakeKV { constructor() { this.m = new Map(); this.puts = []; }
  async get(k) { const e = this.m.get(k); return e ? e.v : null; }
  async getWithMetadata(k) { const e = this.m.get(k); return { value: e ? e.v : null, metadata: e ? e.meta : null }; }
  async put(k, v, o = {}) { this.puts.push({ k, ttl: o.expirationTtl }); this.m.set(k, { v, meta: o.metadata }); }
  async list({ prefix = "" } = {}) { return { keys: [...this.m.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }; } }
const kv = new FakeKV(); const benv = { BACKUPS: kv, BACKUP_TOKEN: "geheimer-token-123" };
const O = { Origin: "https://dankerschen.github.io" };
const blob = JSON.stringify({ v: 1, kdf: "PBKDF2-SHA256", iter: 1, salt: "AA==", iv: "AA==", ct: "ZZZZ" });
globalThis.fetch = async () => { throw new Error("backup must not call LuxASR"); };
r = await worker.fetch(req("OPTIONS", "/backup", { ...O, "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "x-backup-token,content-type" }), benv);
t("backup preflight allows PUT + X-Backup-Token", r.status === 204 && /PUT/.test(r.headers.get("Access-Control-Allow-Methods")) && /x-backup-token/i.test(r.headers.get("Access-Control-Allow-Headers")));
r = await worker.fetch(req("PUT", "/backup", O, blob), {}); t("no KV binding -> 501 with CORS", r.status === 501 && r.headers.get("Access-Control-Allow-Origin") === O.Origin);
r = await worker.fetch(req("PUT", "/backup", O, blob), benv); t("no token -> 401", r.status === 401);
r = await worker.fetch(req("PUT", "/backup", { ...O, "X-Backup-Token": "geheimer-token-124" }, blob), benv); t("wrong token -> 401", r.status === 401);
r = await worker.fetch(req("PUT", "/backup", { ...O, "X-Backup-Token": "x" }, blob), benv); t("short token -> 401", r.status === 401);
r = await worker.fetch(req("GET", "/backup/status", { ...O, "X-Backup-Token": benv.BACKUP_TOKEN }), benv);
let js = await r.json(); t("status empty: latest null, no days", r.status === 200 && js.latest === null && js.days.length === 0);
r = await worker.fetch(req("GET", "/backup", { ...O, "X-Backup-Token": benv.BACKUP_TOKEN }), benv); t("GET before any backup -> 404", r.status === 404);
const H = { ...O, "X-Backup-Token": benv.BACKUP_TOKEN, "Content-Type": "text/plain" };
r = await worker.fetch(req("PUT", "/backup", H, "kein json"), benv); t("invalid body -> 400", r.status === 400);
r = await worker.fetch(req("PUT", "/backup", H, JSON.stringify({ hello: 1 })), benv); t("json without v/ct -> 400", r.status === 400);
r = await worker.fetch(req("PUT", "/backup", H, blob), benv); js = await r.json();
t("PUT ok, returns timestamp", r.status === 200 && js.ok && /^\d{4}-/.test(js.at));
t("stored latest + day key with 8-day TTL", kv.puts.length === 2 && kv.puts.some(p => p.k === "latest") && kv.puts.some(p => /^day:\d{4}-\d{2}-\d{2}$/.test(p.k) && p.ttl === 8 * 24 * 3600));
r = await worker.fetch(req("GET", "/backup", H), benv); t("GET latest returns same blob", r.status === 200 && (await r.text()) === blob && r.headers.get("Access-Control-Allow-Origin") === O.Origin);
const day = new Date().toISOString().slice(0, 10);
r = await worker.fetch(req("GET", "/backup?day=" + day, H), benv); t("GET ?day= returns day copy", r.status === 200 && (await r.text()) === blob);
r = await worker.fetch(req("GET", "/backup?day=../x", H), benv); t("bad day -> 400", r.status === 400);
r = await worker.fetch(req("GET", "/backup/status", H), benv); js = await r.json(); t("status lists the day and latest", js.days.includes(day) && /^\d{4}-/.test(js.latest));
r = await worker.fetch(req("PUT", "/backup", { ...H, "Content-Length": String(6 * 1024 * 1024) }, blob), benv); t("backup too large -> 413", r.status === 413);
r = await worker.fetch(req("PUT", "/backup", { Origin: "https://evil.example", "X-Backup-Token": benv.BACKUP_TOKEN }, blob), benv); t("backup from foreign origin -> 403", r.status === 403);
r = await worker.fetch(req("DELETE", "/backup", H), benv); t("DELETE not allowed", r.status === 404);
r = await worker.fetch(req("GET", "/backupx", H), benv); t("/backupx is not a backup route (-> proxy 404)", r.status === 404);

console.log(ok + " passed, " + bad + " failed"); process.exit(bad ? 1 : 0);
