const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = process.argv[2], out = process.argv[3];
const types = { '.html':'text/html', '.js':'text/javascript', '.png':'image/png', '.svg':'image/svg+xml', '.webmanifest':'application/manifest+json' };
const srv = http.createServer((q, r) => {
  const f = path.join(root, decodeURIComponent(q.url.split('?')[0]));
  const file = fs.existsSync(f) && fs.statSync(f).isDirectory() ? path.join(f, 'index.html') : f;
  if (!fs.existsSync(file)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }); r.end(fs.readFileSync(file));
}).listen(8125, async () => {
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const names = ['Anna Becker','Ben Weber','Clara Schmit','David Thill','Emma Klein','Felix Muller','Greta Hoffmann','Hugo Reuter','Ida Wagner','Jonas Back'];
  const now = Date.now(), day = 86400000;
  const seed = { year: '2026/27', classes: [
    { id: 'c1', name: '6A', general: { id: 'general', name: 'Allgemeng', notes: [] }, students: names.map((n, i) => ({ id: 's' + i, name: n, notes: i === 1 ? [
      { id: 'n1', ts: now - 1 * day, text: 'Huet haut beim Basketball-Dribbling grouss Fortschrëtter gemaach an déi aner an der Grupp motivéiert.' },
      { id: 'n2', ts: now - 6 * day, text: 'Huet beim Schwammen gefeelt, Entschëllegung vum Dokter ofginn.' },
      { id: 'n3', ts: now + 5 * day, text: 'Nächst Woch Zeegnisnott Ausdauerlaf androen.' } ] : [] })) },
    { id: 'c2', name: '6B', general: { id: 'general', name: 'Allgemeng', notes: [{ id: 'g1', ts: now - 2 * day, text: 'Sporthal Freides zou.' }] }, students: [{ id: 'x1', name: 'Lea Frisch', notes: [] }] } ] };
  for (const scheme of ['light', 'dark']) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme, permissions: ['microphone'] });
    await ctx.route('https://luxasr.uni.lu/**', async route => {
      const u = route.request().url(); const h = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Content-Type': 'application/json' };
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: h });
      if (u.includes('/asr2')) return route.fulfill({ status: 202, headers: h, body: JSON.stringify({ job_id: 'j1' }) });
      if (u.endsWith('/result')) return route.fulfill({ status: 200, headers: { ...h, 'Content-Type': 'text/plain' }, body: 'Ben huet haut beim Staffettelaf als Éischten d’Zillinn iwwerlaf an duerno deenen aneren beim Opraumen gehollef.' });
      globalThis.polls = (globalThis.polls || 0) + 1;
      return route.fulfill({ status: 200, headers: h, body: JSON.stringify({ status: globalThis.polls > 3 ? 'completed' : 'processing' }) });
    });
    const p = await ctx.newPage(); const shot = n => p.screenshot({ path: `${out}/s-${scheme}-${n}.png` });
    await p.goto('http://localhost:8125/klassennotizen/'); await p.waitForSelector('#newClasses'); await shot('01-welcome');
    await p.evaluate(s => { localStorage.setItem('sportnotizen.v1', JSON.stringify(s)); localStorage.setItem('sportnotizen.meta', JSON.stringify({ lastBackup: Date.now() - 3 * 86400000, changes: 3 })); }, seed);
    await p.reload(); await p.waitForSelector('.item'); await p.waitForTimeout(300); await shot('02-home');
    await p.click('.item >> text=6A'); await p.waitForSelector('#slist'); await p.waitForTimeout(200); await shot('03-class');
    await p.evaluate(() => window.scrollTo(0, 420)); await p.waitForTimeout(250); await shot('03b-class-scrolled');
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.click('#slist >> text=Anna Becker'); await p.waitForSelector('.empty'); await p.waitForTimeout(200); await shot('04-student-empty');
    await p.click('#backBtn'); await p.click('#slist >> text=Ben Weber'); await p.waitForSelector('.note'); await p.waitForTimeout(200); await shot('05-student-notes');
    await p.click('.note >> nth=0 >> [data-more]'); await p.waitForTimeout(450); await shot('06-actionsheet'); await p.click('[data-cancel]');
    await p.click('#recBtn'); await p.waitForTimeout(2800); await shot('07-recording');
    await p.click('#recBtn'); await p.waitForTimeout(900); await shot('08-sheet-busy');
    await p.waitForFunction(() => /Kontrolléieren/.test(document.querySelector('#status').textContent), null, { timeout: 20000 }); await p.waitForTimeout(300); await shot('09-sheet-result');
    await p.click('#discard'); await p.waitForTimeout(300); await shot('09b-discard-confirm'); 
    const a = await p.$('.actionbtn.destructive'); if (a) await a.click(); await p.waitForTimeout(400);
    await p.click('#typeBtn'); await p.fill('#draft', 'Kurze getippte Notiz'); await p.waitForTimeout(450); await shot('10-sheet-typing'); await p.click('#discard');
    const a2 = await p.$('.actionbtn.destructive'); if (a2) await a2.click(); await p.waitForTimeout(400);
    await p.click('#backBtn'); await p.click('#edit'); await p.waitForSelector('#names'); await p.waitForTimeout(200); await shot('11-edit');
    await p.click('#backBtn'); await p.click('#backBtn'); await p.click('#menuBtn'); await p.waitForSelector('#year'); await p.waitForTimeout(200); await shot('12-settings');
    await p.evaluate(() => window.scrollTo(0, 700)); await p.waitForTimeout(250); await shot('12b-settings-scrolled');
    await p.evaluate(() => window.scrollTo(0, 99999)); await p.waitForTimeout(250); await shot('12c-settings-bottom');
    await ctx.close();
  }
  await b.close(); srv.close();
});
