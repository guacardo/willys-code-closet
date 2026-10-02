# Willy's Code Closet

Electron + SolidJS wrapper around Claude Code via the Claude Agent SDK. Tabs are Claude Code sessions;
group them, rename them, resume them across restarts. Uses your existing Claude Code login.

```
npm install
npm run dev         # the instance you're editing (renderer hot-reloads)
npm run workbench   # a built instance to work *from*; unaffected by edits until rebuilt
```

State: `~/.config/willys-code-closet/{config.json,tabs.json}`.

Layout: `src/main/sessions/` (one `TabSession` per tab wrapping an SDK `query()` in streaming-input
mode, `TabManager` for persistence), `src/renderer/` (UI), `src/shared/types.ts` (IPC contract).

Keys: ⌘T new tab · ⇧⌘T new tab in another folder · ⌘W close · ⌘[ ⌘] cycle · ⌘1-9 jump · ⌘I session
panel · ⌘J dev/git pane · Enter send · Esc cancel · y/a/n answer a permission card.

Project pane (⌘J): follows whichever git repo the agent touches (chips per repo, click to pin). Dev
runs the repo's `dev` script (or a per-repo override) in a PTY shared by every tab on that repo, and
mirrors output to `~/.config/willys-code-closet/logs/<repo>.dev.log` for the agent to read. Git runs
lazygit. ↗ opens the repo, a tool row's file, or a `path/to/file.ts:42` span in a reply in your editor
(picked in the session panel). node-pty is rebuilt for Electron on install via `@electron/rebuild`.

Voice: mic button, ⌘⇧M toggle, or hold ⌥Space to talk. Audio is captured at 16 kHz in an AudioWorklet
and sent to a local `whisper-server` (whisper.cpp) that the app starts on first use and keeps warm
(~150 ms per utterance). Binary and model are auto-detected (`brew install whisper-cpp`, or the
anvil-video checkout); a base.en model can be downloaded from the session panel. If no model is present the first dictation downloads base.en (148 MB). Transcripts land in the
composer for review, or send immediately (Settings → Voice).

Settings (gear at the bottom of the sidebar, ⌘,): editor, new-tab defaults, voice paths and behavior.

Remote API: the main process serves JSON on `127.0.0.1:7474` (`api.port` in config.json): `GET /tabs`,
`GET /tabs/:id` (event log), `GET /tabs/:id/events` (SSE), `POST /tabs/:id/{send,permission,cancel}`,
and `POST /send {tab: <id|name|folder>, text, images?}`. Expose it on your tailnet with
`tailscale serve --bg 7474`; set `api.login` to your Tailscale login to require the identity header it
adds. The iOS companion and Shortcuts intent live in
[willys-code-closet-ios](https://github.com/guacardo/willys-code-closet-ios).
