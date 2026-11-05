# Klassennotizen (web app)

Voice or text notes per student, in Luxembourgish. Static web app, no build step. Installable on Android/iOS ("Add to Home Screen") and works offline after the first visit.

## Publish on GitHub Pages
1. Create a repository (e.g. `klassennotizen`), upload all files in this folder to the root of the `main` branch.
2. Settings -> Pages -> Source: "Deploy from a branch", branch `main`, folder `/ (root)`.
3. Open `https://<your-user>.github.io/klassennotizen/` (HTTPS is required for the microphone).

If you replace an older "Sportnotizen" deployment under the same address, the data stays (same storage key) and the old offline cache is cleared on the first start.

## Moving your data from the old app
In the old app: Settings -> "Backup erstellen". In this app: Astellungen -> "Backup restauréieren". Backup files from the old app load unchanged.

## Updating
After changing any file, bump `VERSION` in `sw.js` so installed copies pick up the new version.

## Transcription (LuxASR) and the browser
The Android app sent audio through a native HTTP plugin, which ignores CORS. A web page cannot: the browser only lets the page read the answer if luxasr.uni.lu allows that origin. If it does not, recordings fail with "De Server ass vun dësem Browser aus net erreechbar".

1. Open Astellungen -> Sproocherkennung -> **Verbindung testen**. It sends an empty request (no audio) with the same headers as a real recording. "Server erreechbar ✓" means direct access works and nothing else is needed.
2. If it fails, either ask LuxASR to allow your `https://<your-user>.github.io` origin, or run the small proxy below.

### Proxy (Cloudflare Worker, free)
`proxy/worker.js` forwards the three calls the app needs to LuxASR and adds the CORS headers. It only answers requests from the origin(s) you list, forwards nothing else and stores or logs nothing.

1. Free account at cloudflare.com (e-mail only, no card). Workers & Pages -> Create -> Worker -> Deploy, then "Edit code", replace everything with the content of `proxy/worker.js`, Deploy.
2. The allowed page is set at the top of the file (`DEFAULT_ORIGIN`, currently `https://dankerschen.github.io`). To use another address without editing the code, add a variable `ALLOWED_ORIGIN` (origin only, no path) under Settings -> Variables and Secrets and deploy again.
3. In the app: Astellungen -> Sproocherkennung -> paste the worker address (`https://<name>.<account>.workers.dev`), then "Verbindung testen".

Privacy: with the proxy, the audio and the student names (used as a spelling hint) pass through Cloudflare on their way to LuxASR. The worker does not keep them, but it is one more company in the chain. Check this with your school's data-protection rules, or prefer the direct route if LuxASR allows it.

### Cloud backup (automatic, encrypted)
A web app cannot run when it is closed and iOS Safari cannot write to a folder, so "automatic" means: while the app is open it uploads a backup to your own Worker 30 s after the last change and when you leave the app. The data is encrypted in the browser (AES-GCM, key from your passphrase via PBKDF2-SHA256, 200 000 rounds); Cloudflare only stores unreadable text in Workers KV: `latest` plus one copy per day that expires after 8 days. A forgotten passphrase cannot be recovered.

One-time setup (the Worker code must be the current `proxy/worker.js`):
1. Dashboard -> Workers & Pages -> KV: create a namespace (e.g. `klassennotizen-backup`).
2. Worker -> Settings -> Bindings -> Add -> KV namespace: variable name `BACKUPS`, pick that namespace.
3. Worker -> Settings -> Variables and Secrets -> Add a secret `BACKUP_TOKEN` with a long random text. Deploy.
4. App -> Astellungen -> Cloud-Backup: enter the same token, a passphrase (8+ characters, twice), "Cloud-Backup aschalten". The app checks the connection, uploads and reads the backup back to verify it.
5. New device: enter worker address (Sproocherkennung), token and passphrase, then "Aus der Cloud restauréieren" (latest or one of the last 7 days).

Safeguards: an empty database is never uploaded; enabling is refused if a backup with another passphrase already exists; restoring does not write back to the cloud; failed uploads keep the data marked as unsaved and are retried (next change, app hidden, back online). With several devices the last one that saves wins. Free-plan KV allows 1,000 writes/day (each upload uses 2) and 25 MiB per value.

`proxy/worker.js` is tested against a mocked LuxASR (preflight, allowed/foreign origin, routes, size limit, upstream down); it has not been run against the real server.

## Credits
Klassennotizen was originally created by co-teacher Jeff Decker, who obtained permission to use the LuxASR transcription service (University of Luxembourg). Dan Kerschen developed it further with the help of AI. More projects: https://kerschen.lu/projects/

## Notes
- Notes are stored in the browser's localStorage on each device; they never go to GitHub.
- Voice notes are sent to LuxASR (luxasr.uni.lu), whose docs ask integrators to get permission first.
- The home screen shows how many changes are not yet backed up; "Fäerdeg - Backup maachen" opens the phone's share sheet (Files, OneDrive, mail). A web app cannot run code when it is closed, so the backup has to be started by tapping this button.
- First start (no classes) shows a "Wëllkomm" screen to add classes, which also offers restoring a backup.
- Dates use the Luxembourgish locale when the browser has it (otherwise German).
- Design: iOS-style (large collapsing titles, grouped lists, glass bars and dock, bottom sheets, Voice-Memos-style recorder with live waveform), follows the system light/dark mode, text size (Dynamic Type on iOS), reduced motion and reduced transparency settings.
- Icons: Noun Project "Notepad" (app icon) and microphone (empty state on the note page), royalty-free license, no attribution required.
