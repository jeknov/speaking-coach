# Speaking Coach

A web app for daily speaking practice and progress tracking: a Today tab with the day's drills,
plus Progress, Skills and Badges tabs. It runs in any modern browser (Chrome on Android, Safari or
Chrome on macOS) with nothing to install, and can be added to the home screen.

- **Code**: this repository (public, served by GitHub Pages).
- **Data**: the private repository `jeknov/speaking-coach-data`. The app reads and writes it through
  the GitHub API with a fine-grained personal access token stored only on each device.

## How it works

- Every action is written as a new event file (`events/<date>/*.json`), so two devices never conflict.
  Writes that fail offline wait in IndexedDB and upload later.
- Recordings are analysed in the browser (`js/audio.js`): pitch, pauses, volume, voice clarity, and an
  optional Whisper transcription (transformers.js) for pace, fillers and reading accuracy.
- A nightly job (`tools/nightly.py` in the data repository) rebuilds `state/state.json` from the full
  event history. The Progress, Skills and Badges tabs draw from that file plus today's live events.
- A morning job writes `plan/<date>.json`, the day's tasks.

## Files

`index.html`, `css/app.css`, `js/app.js` (routing, settings), `js/store.js` (GitHub sync and offline
queue), `js/today.js` (Today tab and drill runners), `js/progress.js` (Progress, Skills, Badges),
`js/audio.js` (recording and analysis), `js/art.js` (badge art; images in `img/badges/`), `js/vendor/d3.js`, `sample/` (made-up
Week 10 data for the sample preview).
