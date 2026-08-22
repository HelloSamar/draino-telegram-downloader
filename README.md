# Draino - Telegram downloader

Download full-resolution Telegram videos straight from **web.telegram.org**.
Hover any video, click the green button that appears, and Draino streams the
full file down in parallel chunks and saves it to your Downloads folder.

![status](https://img.shields.io/badge/manifest-v3-blue) ![license](https://img.shields.io/badge/license-MIT-green)

## Features

- 🟢 Floating download button appears on hover over any video in a chat
- ⚡ Downloads in parallel chunks for speed, with automatic retry on failed chunks
- 📛 Picks up the real filename from the chat (falls back to a timestamped name)
- 📊 Live progress bar with size and percentage
- 🔒 No external servers — everything happens locally in your browser

## Install (from source)

Draino isn't on the Chrome Web Store, so it's loaded as an unpacked extension:

1. Download or clone this repository.
2. Open `chrome://extensions` (or `edge://extensions` on Edge).
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the `Draino` folder.
5. Pin the Draino icon to your toolbar if you'd like (optional).

Works in any Chromium-based browser (Chrome, Edge, Brave, etc.) that supports
Manifest V3 and the `"world": "MAIN"` content-script key (Chrome 111+).

## Usage

1. Open `https://web.telegram.org` and open a chat containing a video.
2. Hover over the video — a green download button appears in its corner.
3. **Click the video first so it starts playing/buffering.** Draino needs the
   stream URL, which Telegram only exposes once playback has started.
4. Click the green button. A progress bar appears in the bottom-right corner
   showing download progress; when it finishes, the file saves automatically.

If you see "Stream not ready," it means Telegram hasn't handed off a stream
URL yet — click the video to start it playing, then try the button again.

## How it works

- `content.js` runs in the page's isolated world. It watches for `<video>`
  elements, shows the floating button, and renders the progress-bar UI.
- `inject.js` runs in the page's **main world** (so its `fetch()` calls are
  seen by Telegram's own service worker, which is required to authorize the
  request). It splits the video into byte-range chunks, fetches them in
  parallel, reassembles them, and triggers the browser's save-file dialog
  via a synthetic download link.
- The two scripts talk to each other with `CustomEvent`s (`__draino_start`,
  `__draino_progress`, `__draino_done`) since they run in separate JS worlds.

## Permissions

Draino only requests `host_permissions` for `web.telegram.org` — it does not
ask for the `downloads` permission (saving is done via a standard `<a
download>` click, not the `chrome.downloads` API) and makes no network
requests to anywhere other than Telegram's own domain.

## Limitations

- Only works on `web.telegram.org`, not the desktop or mobile Telegram apps.
- You must start playing the video before downloading, since the stream URL
  isn't available until then.
- Very large files may take a while; Draino retries failed chunks
  automatically but does not currently support pausing/resuming a download
  across browser restarts.

## Contributing

Issues and pull requests are welcome. Please keep changes minimal and
focused, and test manually against `web.telegram.org` before submitting,
since there's no automated test suite for the DOM-scraping logic.

## License

MIT — see [LICENSE](LICENSE).

## Disclaimer

This tool only downloads content that Telegram has already sent to your own
browser to play back. You're responsible for complying with the terms of
service of Telegram and the copyright/redistribution rights of whatever you
download.
