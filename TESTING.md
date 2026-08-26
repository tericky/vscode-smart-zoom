# Testing and Acceptance

## Automated checks (run on every change)

```bash
npm test
npm run compile
```

macOS helper smoke test:

```bash
printf '%s\n' '{"op":"getCurrentWindowDisplay","pid":'"$$"'}' | ./native/darwin/smart-zoom-helper
```

Expect one JSON line with `"ok": true` (or a stable `"ok": false` error string).

## VSIX packaging prerequisite

Before packaging a VSIX, build and verify the Windows and Linux helpers on
their native hosts. The packaged paths must contain real target-platform
binaries:

- Windows: `native/win32/smart-zoom-helper.exe`
- Linux: `native/linux/smart-zoom-helper`

Do not add placeholder or cross-platform substitute binaries when either build
is unavailable.

## Product decisions affecting acceptance

- **Integer Zoom MVP:** Auto Zoom applies integer zoom levels only (`0`, `1`, `2`, …). Exact fractional per-window zoom is deferred (public VS Code APIs round relative zoom commands).
- **Never** write `window.zoomLevel` as per-window state. Require `window.zoomPerWindow !== false`.
- **docs/** is local-only (gitignored). Tracked sources and commit messages are English.

## AC checklist

| ID | Criterion | Status | Notes |
|---|---|---|---|
| AC-01 | Identify multiple displays | PARTIAL | macOS helper returns UUID + geometry (live smoke OK). Windows/Linux need host builds. |
| AC-02 | Independent zoom per VS Code window | MANUAL | Requires two Extension Host windows + Configure/Detect. |
| AC-03 | Zoom switch within ~0.5s after move | MANUAL | Poll 150ms × stability 2 ≈ 300ms after center crosses boundary. |
| AC-04 | Other windows unaffected | MANUAL | Depends on `zoomPerWindow=true` + relative commands. |
| AC-05 | No flicker while straddling displays | MANUAL | Stability checks should suppress A/B/A jitter. |
| AC-06 | Same resolution, different displays | MANUAL | Display ID profiles vs resolution rules. |
| AC-07 | Restart re-applies correct zoom | MANUAL | Startup apply path in `activate()`. |
| AC-08 | Hot plug does not crash | MANUAL | Helper/monitor errors keep current zoom. |
| AC-09 | Win / macOS / Linux X11 | PARTIAL | macOS binary packaged. Windows/Linux sources present; build on those hosts. |
| AC-10 | Default 100% + resolution learning | UNIT+MANUAL | Resolver/config tests cover priority/learning; Configure command wires learning. |
| AC-11 | Fractional zoom | DEFERRED | Integer MVP; see Task 0 spike. |

## Known limitations

1. Exact fractional per-window zoom is not supported by public Extension APIs.
2. Live window zoom cannot be read back from VS Code; tracker is session-local.
3. Windows `native/win32/smart-zoom-helper.exe` must be built with `native/windows/build.bat` on Windows.
4. Linux `native/linux/smart-zoom-helper` must be built with `native/linux-x11/build.sh` on an X11 system.
5. Wayland: helper returns `wayland_unsupported`; extension shows a one-time warning and does not crash.
6. macOS may require Screen Recording permission for reliable window enumeration.
7. GUI acceptance (multi-window drag, fullscreen, hot plug) still needs manual F5 verification.

## Manual F5 steps (macOS)

1. Open this repository in Cursor/VS Code.
2. `npm run compile`
3. Confirm `window.zoomPerWindow` is `true`.
4. Press F5 to launch Extension Development Host.
5. Run **Auto Zoom: Detect Current Display** and confirm status bar / message.
6. Run **Auto Zoom: Configure Current Display**, set an integer zoom, move the window across displays, and confirm auto switch.
7. Open a second window and confirm the first window’s zoom does not change when configuring the second.
