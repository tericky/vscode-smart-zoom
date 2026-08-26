# Native Helper Contract

The extension talks to a long-lived native helper process. The client starts the
platform helper once, then writes one JSON request per line to stdin and reads
JSON responses per line from stdout. Closing stdin ends the helper.

One-shot usage (manual testing) still works: write a single line and close stdin.

## Packaged Paths

Helpers are resolved relative to the extension root:

- macOS: `native/darwin/smart-zoom-helper`
- Windows: `native/win32/smart-zoom-helper.exe`
- Linux: `native/linux/smart-zoom-helper`

Source trees intentionally use different names (`native/macos`,
`native/windows`, `native/linux-x11`) from the packaged paths above.

## Request

```json
{
  "op": "getCurrentWindowDisplay",
  "pid": 12345,
  "titleHint": "README.md",
  "requestId": "optional-correlation-id"
}
```

Fields:

- `op`: `getCurrentWindowDisplay`, `watch`, or `unwatch`.
- `pid`: process id of the requesting VS Code extension host (required for
  detection ops; not required for `unwatch`).
- `titleHint` (optional): best-effort active editor or workspace text expected
  in the VS Code window title. Matching is case-insensitive.
- `intervalMs` (optional, `watch` only): helper-side check interval hint
  (macOS default ~200 ms).
- `requestId` (optional but recommended): echoed on the matching response so
  the TypeScript client can correlate replies.

## Operations

### `getCurrentWindowDisplay`

One-shot detection. Returns a success or error response for the request.

### `watch` (macOS)

Starts helper-side monitoring. The helper:

1. Immediately emits one success snapshot for the current display.
2. Emits another success line only when the detected display id changes
   (internal check loop + display reconfiguration callbacks).

Windows and Linux currently reply `{ "ok": false, "error": "unsupported_operation" }`.
The extension then falls back to polling `getCurrentWindowDisplay`.

### `unwatch`

Stops watch mode. Success acknowledgment:

```json
{ "ok": true, "event": "unwatched", "requestId": "..." }
```

## Success Response

```json
{
  "ok": true,
  "requestId": "optional-correlation-id",
  "data": {
    "window": { "x": 2500, "y": 100, "width": 1600, "height": 1000 },
    "display": {
      "id": "123456789",
      "name": "DELL U2720Q",
      "x": 1920,
      "y": 0,
      "width": 3840,
      "height": 2160,
      "scaleFactor": 2
    }
  }
}
```

The helper must identify the VS Code window for the requesting process and
return the display containing that window's center point. Among eligible
windows in the PID's parent process family, a case-insensitive title match is
preferred. The frontmost or highest Z-order eligible window remains the
fallback when the hint is absent or does not match.

## Packaging Requirement

Before packaging a VSIX, build and verify the native helper on every target
platform. In particular, the Windows helper must exist at
`native/win32/smart-zoom-helper.exe` and the Linux helper at
`native/linux/smart-zoom-helper`. Do not package placeholders or binaries built
for a different operating system.

## Error Response

```json
{ "ok": false, "error": "wayland_unsupported", "requestId": "optional-correlation-id" }
```

The `error` field must be a stable machine-readable string. The extension keeps
the current zoom and must not crash when the helper reports an error.

## Exit Codes

Helpers must stay running for the JSON-line session and exit `0` when stdin
closes, including after emitting application-level errors such as
`{ "ok": false, "error": "wayland_unsupported" }`.

Do **not** use a non-zero process exit code to signal `{ ok: false }` payloads.
The TypeScript client treats non-zero exit as `HelperProcessError` and will not
parse a trailing error JSON line as `NativeHelperError`.

## Timing

Helpers should answer each request quickly. On macOS the extension prefers
`watch` push updates. Elsewhere (or when `watch` is unsupported) the TypeScript
client polls about every 500 ms by default. On repeated detection failures the
monitor backs off (up to 10s) and only logs when the error message changes, to
avoid log spam and wasted CPU.
