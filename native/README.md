# Native Helper Contract

The extension talks to a long-lived native helper process. The client starts the
platform helper once, then writes one JSON request per line to stdin and reads
one JSON response per line from stdout. Closing stdin ends the helper.

One-shot usage (manual testing) still works: write a single line and close stdin.

## Packaged Paths

Helpers are resolved relative to the extension root:

- macOS: `native/darwin/smart-zoom-helper`
- Windows: `native/win32/smart-zoom-helper.exe`
- Linux: `native/linux/smart-zoom-helper`

## Request

```json
{ "op": "getCurrentWindowDisplay", "pid": 12345, "titleHint": "README.md" }
```

Fields:

- `op`: currently only `getCurrentWindowDisplay`.
- `pid`: process id of the requesting VS Code extension host.
- `titleHint` (optional): best-effort active editor or workspace text expected
  in the VS Code window title. Matching is case-insensitive.

## Success Response

```json
{
  "ok": true,
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
{ "ok": false, "error": "wayland_unsupported" }
```

The `error` field must be a stable machine-readable string. The extension keeps
the current zoom and must not crash when the helper reports an error.

## Timing

Helpers should answer each request quickly. The TypeScript client keeps one
helper process alive and polls about every 500 ms by default. On repeated
detection failures the monitor backs off (up to 10s) and only logs when the
error message changes, to avoid log spam and wasted CPU.
