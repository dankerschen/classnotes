# Klassennotizen: handover for Claude Code

Read this first, then `README.md` (user-facing setup). Last updated 2026-11-03.

## What this is
A static, installable web app (PWA, no build step, no framework, no third-party scripts) for a teacher in Luxembourg (Dan, sixth grade). He records or types notes **per student** and **per class** ("classnotes", say *classnotes*, never *sportnotes*). Voice is transcribed in Luxembourgish by LuxASR (University of Luxembourg). Hosted on GitHub Pages at `https://dankerschen.github.io/<repo>/`. It replaces an Android APK (Capacitor) called "Sportnotizen".

User context: no Mac, no Apple developer account, uses Comet (WebKit) on iOS, does not want to email third parties if there is another way. He writes Luxembourgish or English; reply in the language he used last. He already has LuxASR's permission to use their server. The app was originally created by co-teacher Jeff Decker, who asked LuxASR for that permission; keep this credit (settings, "Iwwer d’App", and README "Credits").

## Files
- `index.html`: the whole app (HTML, CSS, JS in one file, ~85 KB). **This is the source of truth** (it used to be generated from a template; that step is gone, edit it directly).
- `sw.js`: service worker (caches the app shell only, same-origin GET). **Bump `VERSION` on every release** so installed copies update.
- `manifest.webmanifest`, `icon*.png`, `icon.svg`, `apple-touch-icon.png`: PWA bits. Icons come from Noun Project (user has a Pro account, royalty-free licence, no attribution needed): notepad = app icon, microphone drawing = empty state of the note page (inline `<symbol id="mic-art">`).
- `proxy/worker.js`: Cloudflare Worker with two jobs: CORS proxy to LuxASR and the encrypted cloud-backup endpoints.
- `tests/`: Playwright and node tests (see below).
- Everything in the repo root is published by Pages, including `tests/` and `proxy/`. There are no secrets in the repo and there must never be any.

## UI language and wording (keep consistent)
- All UI text is **Luxembourgish**. Dates are always `TT/MM/JJJJ` (`fmtDate`); `LOC` (lb-LU, fallback de-LU) only formats times.
- Spelling the user chose: **„läscht“** (not „lescht“), **„de Backup“ / „de Cloud-Backup“** (masculine), „Klassennotizen“, „Astellungen“, „Sproocherkennung“. The user corrected the cloud-backup footnote himself; his wording is in the file, do not paraphrase it.
- Native pickers (date input, keyboard) follow the device language; the app hides the native date text behind a `TT/MM/JJJJ` label (`.datebox`).

## Data and storage (localStorage, per device)
- `sportnotizen.v1`: `{ year, classes: [{ id, name, general: {id:"general", name, notes[]}, students: [{id, name, notes: [{id, ts, text}]}] }] }`. The key keeps the old name on purpose so data from the old app and from backup files still loads.
- `sportnotizen.meta`: `{ lastBackup, changes, cloudAt, cloudDirty, cloudErr }`. `changes` counts edits since the last **file** backup; `cloudDirty` since the last cloud upload.
- `klassennotizen.api`: optional server address (the Worker URL). Empty means direct to `https://luxasr.uni.lu`.
- `klassennotizen.cloud`: `{ on, token, pass }` (token and passphrase are stored on the device so uploads can run unattended).
- No default class names. With no classes the app starts on the "Wëllkomm" screen (add classes or restore a backup).
- Routing is hash based: `#/`, `#/c/<id>`, `#/c/<id>/s/<sid>`, `#/c/<id>/edit`, `#/settings`.

## LuxASR (speech to text)
`POST {API}/asr2?language=lb&diarization=Disabled&hesitations=Hide&outfmt=text&prompt=<student names>` with the raw audio as body (`Content-Type: audio/*`, `X-Filename`), then poll `GET /v3/asr/jobs/<id>`, then `GET /v3/asr/jobs/<id>/result` (readable once; results are deleted after about 4 hours according to their docs).
**Direct browser calls fail with a CORS error** (the user's "Verbindung testen" confirmed this: luxasr.uni.lu opens in a tab, but fetch from github.io is blocked). The Android app bypassed CORS with `CapacitorHttp`. Fix in place: the Cloudflare Worker proxy; the user confirmed transcription works through it. Only if LuxASR enables CORS for the github.io origin could the proxy be dropped.
Privacy: audio and student names (used as spelling hints in `prompt`) travel through Cloudflare to LuxASR. The Worker stores and logs nothing. The user was told this trade-off.

## Cloudflare (live state)
- Account of the user. Worker name **`klassennotizen`**, created in the dashboard (no Wrangler config exists; the dashboard's "update your Wrangler config" hint can be ignored unless you move to Wrangler).
- Allowed origin: `DEFAULT_ORIGIN = https://dankerschen.github.io` baked into `worker.js` (optional variable `ALLOWED_ORIGIN` overrides it).
- KV namespace `klassennotizen-backup`, id `d91766df901d4fc196b39f56c0c8abf2`, bound as **`BACKUPS`**.
- Secret **`BACKUP_TOKEN`**: set by the user in the dashboard (its value is not in this repo; ask him). Whether it is set was **not verified**; without it `/backup` answers 501 and the app says so.
- Deploying: the Cloudflare connector in claude.ai was read-only (list/get workers, KV, D1, R2); it cannot upload code or set secrets. Cloudflare's newer API MCP server (`https://mcp.cloudflare.com/mcp`) or Wrangler could, untested. Until then the user pastes `proxy/worker.js` into the dashboard editor ("Edit code") and clicks Deploy. After changing `worker.js`, tell him to redeploy it.

## Cloud backup design (built, mocked tests green, not yet verified against the real Worker)
- Client side AES-GCM, key from passphrase via PBKDF2-SHA256 (200 000 iterations, random salt and IV per upload). Blob format `{v:1, kdf, iter, salt, iv, ct}` (base64). Cloudflare only ever sees this.
- Uploads: 30 s after the last change (`CLOUD_DELAY`), when the page is hidden/closed, when back online, 3 s after start if still dirty.
- Worker: `PUT /backup`, `GET /backup[?day=YYYY-MM-DD]`, `GET /backup/status`, header `X-Backup-Token`; keys `latest` and `day:YYYY-MM-DD` (TTL 8 days). Free KV plan: 1 000 writes per day (an upload costs 2), 25 MiB per value.
- Safeguards (all covered by tests): never upload an empty database; enabling is refused if a cloud backup already exists that the entered passphrase cannot open; restoring never writes back to the cloud; failed uploads keep `cloudDirty` and show an error; enabling does a round trip (upload, download, decrypt, compare).
- Known limits: last writer wins across devices; a forgotten passphrase cannot be recovered; the passphrase is stored in localStorage on the device.
- The separate file backup ("Fäerdeg – Backup maachen", share sheet or download) stays; a web app cannot run code when closed, so the backup is started by a tap.

## Tests (all use Playwright with Chromium and fake media; mocked LuxASR and Worker)
Serve the repo under a path called `klassennotizen`:
```
mkdir -p /tmp/serve /tmp/out && ln -sfn "$PWD" /tmp/serve/klassennotizen
node tests/test.js /tmp/serve /tmp/out         # 46 checks: first run, backup, voice flow, offline, restore, language, dates, connection test
node tests/test-cloud.js /tmp/serve /tmp/out   # 20 checks: encryption, debounce, outage, restore, safeguards (port 8127)
node tests/test-worker.mjs                     # 40 checks for proxy/worker.js with a fake KV
node tests/shots.js /tmp/serve /tmp/out        # light/dark phone screenshots (port 8125)
```
`test-cloud.js` once failed a single check in five runs and could not be reproduced (probably timing); rerun before suspecting the code. Tests read element ids, so keep these: `#backBtn #menuBtn #recBtn #typeBtn #cancelRec #hint #editor #draft #saveNote #discard #retry #ndate #status #doBackup .backupcard #slist .item #edit #exp #names #saveNames #createClasses #restoreFirst #backup #restore #expAll #newYear #testApi #apiUrl #cloudToken #cloudPass #cloudPass2 #cloudOn #cloudNow #cloudOff #cloudRestore #cloudRes`.

## Design conventions
iOS-style (Liquid Glass look): large collapsing titles, grouped inset lists, glass nav buttons and floating dock (`backdrop-filter`), bottom sheets with swipe to dismiss, action sheets, Voice-Memos style record button with live canvas waveform. Light and dark tokens, Dynamic Type (`font: -apple-system-body`), `visualViewport` for the keyboard, reduced motion/transparency/contrast respected. The AudioContext must be created synchronously inside the tap (iOS).

## Not verified on real devices
iOS/Comet behaviour (waveform, keyboard with the bottom sheet, glass blur, share sheet), and the cloud backup against the real Worker and KV. LuxASR through the proxy works (user confirmed). A first real-world test of "Cloud-Backup aschalten" is the next step.

## Release checklist
1. Edit `index.html` (and `proxy/worker.js` if needed). 2. Run the three test commands. 3. Bump `VERSION` in `sw.js`. 4. Update `README.md` if behaviour changed. 5. Commit and push; Pages redeploys. 6. If `worker.js` changed, redeploy the Worker in Cloudflare.

## Open ideas, none requested yet
Unify more wording once the user reviews the UI; `wrangler.jsonc` for CLI deploys; asking LuxASR to allow the github.io origin (the user prefers not to email them); alternative speech engines were researched (braddl, ElevenLabs, AssemblyAI, Google Chirp) but not built.
