const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = process.argv[2];
const types = { '.html':'text/html', '.js':'text/javascript', '.png':'image/png', '.svg':'image/svg+xml', '.webmanifest':'application/manifest+json' };
const srv = http.createServer((q, r) => {
  const f = path.join(root, decodeURIComponent(q.url.split('?')[0]));
  const file = fs.existsSync(f) && fs.statSync(f).isDirectory() ? path.join(f, 'index.html') : f;
  if (!fs.existsSync(file)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }); r.end(fs.readFileSync(file));
}).listen(8127, async () => {
  let ok = 0, bad = 0; const log = (k, v) => { console.log((v ? 'PASS ' : 'FAIL ') + k); v ? ok++ : bad++; };
  const b = await chromium.launch();
  const APP = 'http://localhost:8127/klassennotizen/';
  const W = 'https://proxy.example.workers.dev';
  // in-memory "Worker + KV"
  const kv = { latest: null, at: null, days: {}, puts: 0 }; let down = false; const TOKEN = 'tok-123456';
  const mock = async ctx => ctx.route(W + '/**', route => {
    const req = route.request(), u = new URL(req.url()), h = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
    if (down) return route.abort('failed');
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: h });
    if (req.headers()['x-backup-token'] !== TOKEN) return route.fulfill({ status: 401, headers: h, body: 'Token falsch.' });
    if (u.pathname === '/backup/status') return route.fulfill({ status: 200, headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, latest: kv.at, days: Object.keys(kv.days).sort() }) });
    if (u.pathname === '/backup' && req.method() === 'PUT') { kv.latest = req.postData(); kv.at = new Date().toISOString(); kv.days[kv.at.slice(0, 10)] = kv.latest; kv.puts++; return route.fulfill({ status: 200, headers: h, body: '{"ok":true}' }); }
    if (u.pathname === '/backup') { const d = u.searchParams.get('day'); const v = d ? kv.days[d] : kv.latest; return v ? route.fulfill({ status: 200, headers: { ...h, 'Content-Type': 'text/plain' }, body: v }) : route.fulfill({ status: 404, headers: h, body: 'Kein Backup.' }); }
    return route.fulfill({ status: 404, headers: h });
  });
  const seed = { year: '2026/27', classes: [{ id: 'c1', name: '6A', general: { id: 'general', name: 'Allgemeng', notes: [] }, students: [{ id: 's1', name: 'Anna Becker', notes: [{ id: 'n1', ts: Date.now(), text: 'Geheime Notiz ueber Anna' }] }] }] };
  const open = async (ctx, data) => { const p = await ctx.newPage(); p.on('dialog', d => d.accept()); await p.goto(APP); await p.waitForSelector('#view *');
    await p.evaluate(([s, w]) => { if (s) localStorage.setItem('sportnotizen.v1', JSON.stringify(s)); localStorage.setItem('klassennotizen.api', w); }, [data, W]); await p.reload(); await p.waitForSelector('#view *'); await p.evaluate(() => { CLOUD_DELAY = 300; }); return p; };
  const settings = async p => { await p.evaluate(() => { location.hash = '#/settings'; }); await p.waitForSelector('#cloudToken'); };

  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }); await mock(ctx);
  const p = await open(ctx, seed); await settings(p);
  log('settings shows cloud section in Luxembourgish', /Cloud-Backup \(automatesch\)/.test(await p.textContent('#view')) && !!(await p.$('#cloudOn')));
  await p.evaluate(() => document.querySelector('#cloudToken').scrollIntoView({ block: 'start' })); await p.evaluate(() => window.scrollBy(0, -90)); await p.waitForTimeout(250); await p.screenshot({ path: process.argv[3] + '/cl-1-off.png' });
  await p.fill('#cloudToken', TOKEN); await p.fill('#cloudPass', 'kurz'); await p.fill('#cloudPass2', 'kurz'); await p.click('#cloudOn');
  log('short password rejected', /mindestens 8/.test(await p.textContent('#cloudRes')) && kv.puts === 0);
  await p.fill('#cloudPass', 'Geheimes-Passwuert-1'); await p.fill('#cloudPass2', 'Geheimes-Passwuert-2'); await p.click('#cloudOn');
  log('password mismatch rejected', /net gläich/.test(await p.textContent('#cloudRes')) && kv.puts === 0);
  await p.fill('#cloudToken', 'falsch'); await p.fill('#cloudPass2', 'Geheimes-Passwuert-1'); await p.click('#cloudOn'); await p.waitForFunction(() => /Token/.test(document.querySelector('#cloudRes').textContent));
  log('wrong token shown, cloud stays off', /Token ass falsch/.test(await p.textContent('#cloudRes')) && !(await p.evaluate(() => cloud.on)));
  await p.fill('#cloudToken', TOKEN); await p.click('#cloudOn'); await p.waitForSelector('#cloudNow', { timeout: 15000 });
  log('enable: verified round trip, uploaded once', kv.puts === 1 && (await p.evaluate(() => cloud.on)));
  const blob = JSON.parse(kv.latest);
  log('uploaded blob is AES-GCM/PBKDF2 and has no plaintext', blob.v === 1 && blob.iter >= 100000 && blob.salt && blob.iv && !/Anna|Becker|6A|Geheime|Notiz/.test(kv.latest));
  log('blob decrypts only with the passphrase (via page)', await p.evaluate(async b => { try { await decryptBackup(b, 'falsch-falsch'); return false; } catch (e) { return /Falscht Passwuert/.test(e.message); } }, kv.latest));
  await p.evaluate(() => document.querySelector('#cloudToken').scrollIntoView({ block: 'start' })); await p.evaluate(() => window.scrollBy(0, -90)); await p.waitForTimeout(250); await p.screenshot({ path: process.argv[3] + '/cl-2-on.png' });
  log('settings now shows state + off button', !!(await p.$('#cloudOff')) && /Alles gesécher/.test(await p.textContent('#cloudState')));
  // change -> debounced upload
  await p.evaluate(() => { location.hash = '#/c/c1/edit'; }); await p.waitForSelector('#names'); await p.fill('#names', 'Anna Becker\nZoe Muller'); const before = kv.puts; await p.click('#saveNames');
  log('a change schedules an upload', await p.evaluate(() => cloudTimer !== 0));
  await p.waitForFunction(() => !cloudTimer && !meta.cloudDirty, null, { timeout: 8000 });
  log('debounced upload happened', kv.puts === before + 1);
  await p.evaluate(() => { location.hash = '#/'; }); await p.waitForSelector('.backupcard');
  await p.waitForTimeout(300); await p.screenshot({ path: process.argv[3] + '/cl-3-home.png' });
  log('home shows cloud status', /Cloud: /.test(await p.textContent('.backupcard')));
  // offline -> error kept, retry later
  down = true; await p.evaluate(() => { location.hash = '#/c/c1/edit'; }); await p.waitForSelector('#names'); await p.fill('#names', 'Anna Becker\nZoe Muller\nLuc Thill'); await p.click('#saveNames');
  await p.waitForFunction(() => meta.cloudErr, null, { timeout: 8000 });
  log('failed upload keeps data dirty and shows error', (await p.evaluate(() => meta.cloudDirty)) && /Cloud: ⚠/.test(await p.evaluate(() => { location.hash = '#/'; return new Promise(r => setTimeout(() => r(document.querySelector('.backupcard').textContent), 200)); })));
  const putsBefore = kv.puts; down = false; await p.evaluate(() => uploadCloud()); 
  log('retry after outage uploads and clears error', kv.puts === putsBefore + 1 && !(await p.evaluate(() => meta.cloudDirty)) && !(await p.evaluate(() => meta.cloudErr)));
  // wrong token later
  await p.evaluate(() => { cloud.token = 'alt'; meta.cloudDirty = true; return uploadCloud(); });
  log('rotated/wrong token reported', /Token ass falsch/.test(await p.evaluate(() => meta.cloudErr)));
  await p.evaluate(() => { cloud.token = 'tok-123456'; meta.cloudErr = ''; });
  // never upload an empty database
  const ctxE = await b.newContext(); await mock(ctxE); const pe = await open(ctxE, null);
  const pb = kv.puts; await pe.evaluate(([t]) => { cloud = { on: true, token: t, pass: 'Geheimes-Passwuert-1' }; meta.cloudDirty = true; return uploadCloud(); }, [TOKEN]);
  log('empty database is never uploaded', kv.puts === pb);
  // enabling with a different passphrase must not clobber an existing backup
  await pe.evaluate(() => { cloud = { on: false, token: '', pass: '' }; }); await settings(pe); await pe.fill('#cloudToken', TOKEN); await pe.fill('#cloudPass', 'Ganz-anert-Passwuert'); await pe.fill('#cloudPass2', 'Ganz-anert-Passwuert'); await pe.click('#cloudOn');
  await pe.waitForFunction(() => /schonn e Cloud-Backup/.test(document.querySelector('#cloudRes').textContent), null, { timeout: 10000 });
  log('existing backup + other passphrase -> refused, not overwritten', kv.puts === pb && !(await pe.evaluate(() => cloud.on)));
  // restore on a "new device"
  await pe.evaluate(() => { cloud = { on: false, token: '', pass: '' }; }); await settings(pe);
  await pe.fill('#cloudToken', TOKEN); await pe.fill('#cloudPass', 'Falsches-Passwuert'); await pe.click('#cloudRestore'); await pe.waitForSelector('.actionbtn[data-i]'); await pe.click('.actionbtn[data-i="0"]');
  await pe.waitForFunction(() => /Falscht Passwuert/.test(document.querySelector('#cloudRes').textContent), null, { timeout: 10000 });
  log('restore with wrong passphrase: clear error, data untouched', (await pe.evaluate(() => db.classes.length)) === 0);
  await pe.fill('#cloudPass', 'Geheimes-Passwuert-1'); await pe.click('#cloudRestore'); await pe.waitForSelector('.actionbtn[data-i]');
  log('restore sheet lists latest + day copies', (await pe.$$('.actionbtn[data-i]')).length >= 2 && /Neisten/.test(await pe.textContent('.actionbtn[data-i="0"]')));
  await pe.click('.actionbtn[data-i="0"]'); await pe.waitForSelector('.item', { timeout: 10000 });
  const restored = await pe.evaluate(() => db);
  log('restored on new device: class, 3 students, note intact', restored.classes[0].name === '6A' && restored.classes[0].students.length === 3 && restored.classes[0].students[0].notes[0].text === 'Geheime Notiz ueber Anna');
  const pc = kv.puts; await pe.waitForTimeout(900);
  log('restore does not write back to the cloud', kv.puts === pc && !(await pe.evaluate(() => meta.cloudDirty)));
  await pe.screenshot({ path: process.argv[3] + '/cloud-home.png' });
  await settings(pe); await pe.screenshot({ path: process.argv[3] + '/cloud-settings.png' });
  await b.close(); srv.close(); console.log(ok + ' passed, ' + bad + ' failed'); process.exit(bad ? 1 : 0);
});
