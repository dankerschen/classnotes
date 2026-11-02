# Sportnotizen (web app)

Static web app, no build step. Installable on Android/iOS ("Add to Home Screen") and works offline after the first visit.

## Publish on GitHub Pages
1. Create a repository (e.g. `sportnotizen`), upload all files in this folder to the root of the `main` branch.
2. Settings -> Pages -> Source: "Deploy from a branch", branch `main`, folder `/ (root)`.
3. Open `https://<your-user>.github.io/sportnotizen/` (HTTPS is required for the microphone).

## Moving your data from the APK
In the old app: Settings -> "Backup erstellen". In the web app: Settings -> "Backup wiederherstellen".

## Updating
After changing any file, bump `VERSION` in `sw.js` so installed copies pick up the new version.

## Notes
- Notes are stored in the browser's localStorage on each device; they never go to GitHub.
- Voice notes are sent to LuxASR (luxasr.uni.lu), whose docs ask integrators to get permission first. In a browser the server must also allow cross-origin requests (CORS); the APK bypassed this natively. Test one recording after deploying.
- The home screen shows how many changes are not yet backed up; "Fertig – Backup erstellen" opens the phone's share sheet (Files, OneDrive, mail). A web app cannot run code when it is closed, so the backup has to be started by tapping this button.
- First start (no classes) shows an "add class" screen, which also offers restoring a backup.
- Design: iOS-style (large collapsing titles, grouped lists, glass bars and dock, bottom sheets, Voice-Memos-style recorder with live waveform), follows the system light/dark mode, text size (Dynamic Type on iOS), reduced motion and reduced transparency settings.
- Icons: Noun Project "Notepad" (app icon) and microphone (empty state on the note page), royalty-free license, no attribution required.
