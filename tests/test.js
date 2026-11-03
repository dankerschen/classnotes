const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = process.argv[2];
const types = { '.html':'text/html', '.js':'text/javascript', '.png':'image/png', '.svg':'image/svg+xml', '.webmanifest':'application/manifest+json' };
const srv = http.createServer((q, r) => {
  const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); 
  const file = fs.existsSync(f) && fs.statSync(f).isDirectory() ? path.join(f, 'index.html') : f;
  if (!fs.existsSync(file)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }); r.end(fs.readFileSync(file));
}).listen(8123, async () => {
  const log = (k, v) => console.log((v === true ? 'PASS ' : v === false ? 'FAIL ' : '     ') + k + (typeof v === 'string' ? ': ' + v : ''));
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 800 }, permissions: ['microphone'], acceptDownloads: true });
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', e => errors.push(e.message)); p.on('console', m => m.type() === 'error' && errors.push(m.text()));
  // mock LuxASR
  let posted = null;
  await ctx.route('https://luxasr.uni.lu/**', async route => {
    const u = route.request().url(); const h = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Content-Type': 'application/json' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: h });
    if (u.includes('/asr2')) { posted = { url: u, ct: route.request().headers()['content-type'], size: route.request().postDataBuffer().length }; return route.fulfill({ status: 200, headers: h, body: JSON.stringify({ job_id: 'j1' }) }); }
    if (u.endsWith('/result')) return route.fulfill({ status: 200, headers: { ...h, 'Content-Type': 'text/plain' }, body: 'Tim hat heute super mitgemacht.' });
    return route.fulfill({ status: 200, headers: h, body: JSON.stringify({ status: 'completed' }) });
  });
  await p.goto('http://localhost:8123/klassennotizen/');
  await p.waitForSelector('#newClasses');
  log('first start shows add-class screen', (await p.$$('.item')).length === 0 && /Leet deng éischt Klass un/.test(await p.textContent('#view')));
  log('no default class names in source', !/Yasmine|Linda/.test(await p.content()));
  await p.click('#createClasses'); log('empty input rejected', !!(await p.$('#newClasses')));
  await p.reload(); await p.waitForSelector('#newClasses'); log('still welcome after reload (nothing saved)', true);
  await p.fill('#newClasses', 'Lena\n6B\nLena'); await p.click('#createClasses'); await p.waitForSelector('.item');
  log('classes created, duplicates removed', (await p.$$('.item')).length === 2);
  await p.reload(); await p.waitForSelector('.item'); log('home (not welcome) after reload', (await p.$$('.item')).length === 2);
  // backup card
  log('banner shows unsaved changes', /1 Ännerung nach net gesécher/.test(await p.textContent('.backupcard')) && /nach ni/.test(await p.textContent('.backupcard')));
  await p.evaluate(() => { navigator.canShare = () => true; navigator.share = () => Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' })); });
  await p.click('#doBackup'); await p.waitForTimeout(300);
  log('cancelled share sheet keeps it unsaved', await p.evaluate(() => document.querySelector('.backupcard').classList.contains('dirty')));
  await p.evaluate(() => { navigator.canShare = () => true; window.__shared = null; navigator.share = d => { window.__shared = d.files[0].name; return Promise.resolve(); }; });
  await p.click('#doBackup'); await p.waitForTimeout(300);
  log('share sheet used with .json file', /^Klassennotizen_Backup_.*\.json$/.test(await p.evaluate(() => window.__shared)));
  log('banner flips to "Alles gesécher"', /Alles gesécher/.test(await p.textContent('.backupcard')) && /grad elo/.test(await p.textContent('.backupcard')));
  await p.evaluate(() => { delete navigator.canShare; delete navigator.share; });
  await p.reload(); await p.waitForSelector('.backupcard');
  log('backup state survives reload', /Alles gesécher/.test(await p.textContent('.backupcard')));
  log('manifest linked & parses', await p.evaluate(async () => { const m = await (await fetch(document.querySelector('link[rel=manifest]').href)).json(); return m.icons.length === 3 && m.start_url === './'; }));
  // service worker
  await p.evaluate(() => navigator.serviceWorker.ready);
  await p.waitForTimeout(800);
  log('service worker controls page', await p.evaluate(() => !!navigator.serviceWorker.controller));
  // type a note
  await p.click('.item >> text=Lena'); await p.waitForSelector('#slist');
  await p.click('#edit'); await p.fill('#names', 'Anna\nBen\nClara'); await p.click('#saveNames'); await p.waitForSelector('#slist .item');
  log('students saved', (await p.$$('#slist .item')).length === 3);
  await p.click('#slist >> text=Ben'); await p.click('#typeBtn'); await p.fill('#draft', 'Getypte Notiz');
  const today = await p.evaluate(() => { const d = new Date(), z = n => String(n).padStart(2, '0'); return z(d.getDate()) + '/' + z(d.getMonth() + 1) + '/' + d.getFullYear(); });
  log('date field shows TT/MM/JJJJ (today)', (await p.textContent('#editor .datetext')) === today);
  await p.click('#editor [data-shift="7"]');
  const nextWeek = await p.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 7); const z = n => String(n).padStart(2, '0'); return z(d.getDate()) + '/' + z(d.getMonth() + 1) + '/' + d.getFullYear(); });
  log('+1 Woch updates the shown date', (await p.textContent('#editor .datetext')) === nextWeek);
  await p.click('#editor [data-shift="-1"]'); await p.click('#editor [data-shift="-1"]'); await p.click('#editor [data-shift="-1"]'); await p.click('#editor [data-shift="-1"]'); await p.click('#editor [data-shift="-1"]'); await p.click('#editor [data-shift="-1"]'); await p.click('#editor [data-shift="-1"]');
  log('date field shows TT/MM/JJJJ after -7 days', (await p.textContent('#editor .datetext')) === await p.evaluate(() => { const d = new Date(); const z = n => String(n).padStart(2, '0'); return z(d.getDate()) + '/' + z(d.getMonth() + 1) + '/' + d.getFullYear(); }));
  await p.fill('#ndate', '2026-11-03'); log('picker value 2026-11-03 -> 03/11/2026', (await p.textContent('#editor .datetext')) === '03/11/2026');
  await p.click('#saveNote');
  await p.waitForSelector('.note'); log('typed note saved', (await p.textContent('.note .text')) === 'Getypte Notiz');
  log('note list date is 03/11/2026', (await p.textContent('.note .notedate')).trim() === '03/11/2026');
  // voice flow
  await p.click('#recBtn'); await p.waitForTimeout(2600); await p.click('#recBtn', { force: true });
  await p.waitForFunction(() => /Kontrolléieren|Feeler/.test(document.querySelector('#status').textContent), null, { timeout: 15000 });
  log('voice -> transcription in editor', (await p.inputValue('#draft')) === 'Tim hat heute super mitgemacht.');
  log('audio POSTed with content-type', !!posted && /^audio\//.test(posted.ct) && posted.size > 2000 ? true : false);
  log('post url', posted && posted.url.slice(0, 90));
  await p.click('#saveNote'); await p.waitForTimeout(200);
  log('2 notes now', (await p.$$('.note')).length === 2);
  // persistence + offline reload
  await ctx.setOffline(true);
  await p.reload(); await p.waitForSelector('#recBtn');
  log('offline reload works', true);
  await p.click('#backBtn'); await p.click('#slist >> text=Ben'); await p.waitForSelector('.note');
  log('data persisted after reload', (await p.$$('.note')).length === 2);
  await ctx.setOffline(false);
  // backup download
  await p.click('#backBtn'); await p.click('#backBtn'); await p.click('#menuBtn');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#backup')]);
  const txt = fs.readFileSync(await dl.path(), 'utf8'); const j = JSON.parse(txt);
  log('backup download valid JSON', j.classes[0].students.length === 3 && dl.suggestedFilename().startsWith('Klassennotizen_Backup_'));
  // CSV export
  await p.click('#backBtn'); await p.click('.item >> text=Lena'); 
  const [dl2] = await Promise.all([p.waitForEvent('download'), p.click('#exp')]);
  const csv = fs.readFileSync(await dl2.path(), 'utf8');
  log('csv export', csv.startsWith('﻿"Klass";"Schüler"') && csv.includes('Getypte Notiz') && csv.includes('"03/11/2026"'));
  await p.screenshot({ path: process.argv[3] + '/shot-class.png' });
  await p.click('#menuBtn'); await p.screenshot({ path: process.argv[3] + '/shot-settings.png' });
  // fresh context: restore backup from welcome screen
  const ctx2 = await b.newContext(); const p2 = await ctx2.newPage();
  await p2.goto('http://localhost:8123/klassennotizen/'); await p2.waitForSelector('#restoreFirst');
  const [fc] = await Promise.all([p2.waitForEvent('filechooser'), p2.click('#restoreFirst')]);
  await fc.setFiles({ name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(txt) });
  await p2.waitForSelector('.item');
  log('restore from welcome screen (no confirm needed)', (await p2.$$('.item')).length === 2);
  await p2.screenshot({ path: process.argv[3] + '/shot-restored.png' });
  log('restore marks data as backed up', /Alles gesécher/.test(await p2.textContent('.backupcard')));
  await p2.evaluate(() => { navigator.canShare = () => true; navigator.share = () => Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' })); });
  p2.on('dialog', d => d.accept());
  await p2.click('#menuBtn'); await p2.click('#newYear'); await p2.waitForTimeout(400);
  log('new school year aborts when backup cancelled', /Backup ofgebrach/.test(await p2.textContent('#toast')));
  await p2.click('#backBtn'); await p2.waitForSelector('.item');
  await p2.click('.item >> text=Lena'); await p2.waitForSelector('#slist'); log('...and data is still there', (await p2.$$('#slist .item')).length === 3);
  await p2.screenshot({ path: process.argv[3] + '/shot-class2.png' });
  const ctx3 = await b.newContext({ viewport: { width: 390, height: 800 } }); const p3 = await ctx3.newPage();
  await p3.goto('http://localhost:8123/klassennotizen/'); await p3.waitForSelector('#newClasses');
  await p3.screenshot({ path: process.argv[3] + '/shot-welcome.png' });
  log('no page/console errors', errors.length === 0); if (errors.length) console.log(errors);

  // ---- Luxembourgish UI, locale, server setting, connection test, error messages ----
  const ctx4 = await b.newContext({ viewport: { width: 390, height: 800 }, permissions: ['microphone'] }); const p4 = await ctx4.newPage();
  let mode = 'cors-block', hits = [], proxyDown = false;
  await ctx4.route('https://luxasr.uni.lu/**', route => { hits.push('direct'); return mode === 'ok' ? route.fulfill({ status: 422, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }, body: '{}' }) : route.abort('failed'); });
  await ctx4.route('https://proxy.example.workers.dev/**', route => { hits.push('proxy'); if (proxyDown) return route.abort('internetdisconnected'); const h = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Content-Type': 'application/json' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: h });
    if (route.request().url().includes('/asr2')) return route.fulfill({ status: 200, headers: h, body: JSON.stringify({ job_id: 'p1' }) });
    if (route.request().url().endsWith('/result')) return route.fulfill({ status: 200, headers: { ...h, 'Content-Type': 'text/plain' }, body: 'Via Proxy.' });
    return route.fulfill({ status: 200, headers: h, body: JSON.stringify({ status: 'completed' }) }); });
  await p4.goto('http://localhost:8123/klassennotizen/'); await p4.waitForSelector('#newClasses');
  const html4 = await p4.content();
  log('html lang=lb, title Klassennotizen', /<html lang="lb"/.test(html4) && (await p4.title()) === 'Klassennotizen');
  log('no "Sportnotizen" shown anywhere', !/Sportnotizen/.test(await p4.evaluate(() => document.body.innerText + document.title)));
  log('manifest is Klassennotizen/lb', await p4.evaluate(async () => { const m = await (await fetch(document.querySelector('link[rel=manifest]').href)).json(); return m.name === 'Klassennotizen' && m.lang === 'lb'; }));
  await p4.fill('#newClasses', '6A'); await p4.click('#createClasses'); await p4.waitForSelector('.item');
  const de = /\b(Willkommen|Einstellungen|Speichern|Abbrechen|Zurück|Schuljahr|Notizen exportieren|Backup erstellen|wiederherstellen|noch nicht|Klasse anlegen)\b/;
  const seen = [];
  for (const h of ['#/', '#/c/' + await p4.evaluate(() => JSON.parse(localStorage.getItem('sportnotizen.v1')).classes[0].id), '#/settings']) { await p4.evaluate(x => { location.hash = x; }, h); await p4.waitForTimeout(250); seen.push(await p4.evaluate(() => document.body.innerText)); }
  log('no German UI words on home/class/settings', !seen.some(s => de.test(s)));
  log('settings page in Luxembourgish', /Astellungen/.test(seen[2]) && /Sproocherkennung/.test(seen[2]) && /Verbindung testen/.test(seen[2]));
  log('date locale resolved', await p4.evaluate(() => /^(lb|de)/.test(LOC)));
  // connection test: blocked (CORS-like failure)
  await p4.click('#testApi'); await p4.waitForFunction(() => /net erreechbar|Internetverbindung/.test(document.querySelector('#testRes').textContent));
  log('connection test reports failure in Luxembourgish', /CORS/.test(await p4.textContent('#testRes')));
  mode = 'ok'; await p4.click('#testApi'); await p4.waitForFunction(() => /erreechbar ✓/.test(document.querySelector('#testRes').textContent));
  log('connection test: any HTTP answer = reachable', true);
  // custom server address
  await p4.fill('#apiUrl', 'http://insecure.example'); await p4.dispatchEvent('#apiUrl', 'change');
  log('non-https address rejected', /https:\/\//.test(await p4.textContent('#toast')) && (await p4.evaluate(() => localStorage.getItem('klassennotizen.api'))) === null);
  await p4.fill('#apiUrl', 'https://proxy.example.workers.dev/'); await p4.dispatchEvent('#apiUrl', 'change');
  log('proxy address stored without trailing slash', (await p4.evaluate(() => localStorage.getItem('klassennotizen.api'))) === 'https://proxy.example.workers.dev');
  // transcription error path (direct blocked) then via proxy after reload
  await p4.evaluate(() => document.activeElement && document.activeElement.blur()); await p4.waitForTimeout(100); await p4.evaluate(() => localStorage.removeItem('klassennotizen.api'));
  await p4.evaluate(() => { location.hash = '#/'; }); await p4.reload(); await p4.waitForSelector('.item'); mode = 'cors-block';
  await p4.click('.item'); await p4.waitForSelector('#slist'); await p4.click('[data-s="general"]'); await p4.waitForSelector('#recBtn');
  await p4.click('#recBtn'); await p4.waitForTimeout(2300); await p4.click('#recBtn', { force: true });
  try { await p4.waitForFunction(() => /net erreechbar|Feeler/.test(document.querySelector('#status').textContent), null, { timeout: 15000 }); } catch (e) { console.log('DBG', await p4.evaluate(() => JSON.stringify({ s: document.querySelector('#status').textContent, h: document.querySelector('#hint').textContent, url: location.hash, ed: document.querySelector('#editor').className }))); await p4.screenshot({ path: process.argv[3] + '/dbg2.png' }); throw e; }
  log('transcription failure message explains CORS/Internet', /CORS/.test(await p4.textContent('#status')) && /Astellungen/.test(await p4.textContent('#status')));
  log('retry button + typing still possible', !(await p4.$eval('#retry', e => e.classList.contains('hidden'))) && !(await p4.$eval('#draft', e => e.disabled)));
  await p4.screenshot({ path: process.argv[3] + '/shot-error.png' });
  await p4.evaluate(() => { localStorage.setItem('klassennotizen.api', 'https://proxy.example.workers.dev'); });
  hits = []; await p4.evaluate(() => { location.hash = '#/'; }); await p4.reload(); await p4.waitForSelector('.item'); await p4.click('.item'); await p4.waitForSelector('#slist'); await p4.click('[data-s="general"]'); await p4.waitForSelector('#recBtn');
  await p4.click('#recBtn'); await p4.waitForTimeout(2300); await p4.click('#recBtn', { force: true });
  await p4.waitForFunction(() => /Kontrolléieren|net erreechbar|Feeler/.test(document.querySelector('#status').textContent), null, { timeout: 15000 });
  log('with proxy address: transcript arrives, no direct call', (await p4.inputValue('#draft')) === 'Via Proxy.' && !hits.includes('direct') && hits.includes('proxy'));
  await ctx4.setOffline(true); proxyDown = true;
  await p4.click('#saveNote'); await p4.waitForTimeout(150);
  await p4.click('#recBtn'); await p4.waitForTimeout(2300); await p4.click('#recBtn', { force: true });
  try { await p4.waitForFunction(() => /Internetverbindung|net erreechbar|Feeler/.test(document.querySelector('#status').textContent), null, { timeout: 15000 }); } catch (e) { console.log('DBG', await p4.evaluate(() => JSON.stringify({ s: document.querySelector('#status').textContent, h: document.querySelector('#hint').textContent, ed: document.querySelector('#editor').className, rec: document.querySelector('#recBtn').className, dis: document.querySelector('#recBtn').disabled, on: navigator.onLine }))); throw e; }
  log('offline message', /Keng Internetverbindung/.test(await p4.textContent('#status')));
  await b.close(); srv.close();
});
