# Peanut 2 Speech

Peanut 2 Speech is a Speechify-style browser reader built around the existing local Kokoro TTS engine in **Text-to-speech**.

## Current MVP

- Chrome/Edge Manifest V3 extension
- Read the current webpage
- Read highlighted/selected text
- Right-click selected text and send it to Peanut 2 Speech
- Sentence-aware chunking for the existing 4096-character TTS limit
- Floating browser-side player in the extension side panel
- Play, pause, previous, next, stop
- Playback speed from 0.5x to 2x
- Kokoro voice and speaking-style selection
- Local-only TTS requests to `http://127.0.0.1:3000`
- Health check against the existing Text-to-speech desktop app

## Important

This repository does **not** modify or replace the existing Text-to-speech application. Peanut 2 Speech treats that app as the local speech engine.

Start the existing desktop app first, then load `extension/` as an unpacked extension in Chrome or Edge.

## Load the extension

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select the `extension` folder.
5. Open a normal webpage.
6. Click the Peanut 2 Speech extension icon.
7. Choose **Read page** or **Read selection**.

## Architecture

```
Browser page
    |
    v
Peanut 2 Speech extension
    |
    | HTTP localhost
    v
Text-to-speech desktop app
    |
    v
Kokoro-82M
    |
    v
WAV audio -> extension player
```

The extension never sends page text to a cloud TTS provider. The existing desktop app performs speech generation locally.

## Roadmap

- Better article extraction using DOM heuristics
- Sentence/paragraph follow-along highlighting
- Mini floating player
- Reading progress persistence
- PDF/web-document support
- Firefox support
- Optional system-wide selected-text hotkey
- More precise audio/text synchronization
