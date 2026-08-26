# macOS Native Helper

This Swift package implements the macOS helper described by
`../README.md`. Source code lives in `native/macos`, while the packaged
executable must be built at:

```text
native/darwin/smart-zoom-helper
```

The `darwin` path is required by `src/helper/helperLocator.ts`; it intentionally
differs from the source directory name.

## Build

From the repository root:

```sh
./native/macos/build.sh
```

The script performs a universal arm64/x86_64 release build and copies the
executable to the packaged path with executable permissions.

## Test

```sh
cd native/macos
swift test
```

To exercise the JSON-line protocol from an integrated terminal:

```sh
printf '{"op":"getCurrentWindowDisplay","pid":%d}\n' "$$" \
  | native/darwin/smart-zoom-helper
```

The helper walks from the supplied process to its parent application process
and selects an eligible top-level window. A case-insensitive `titleHint` match
is preferred, with the frontmost window as fallback. The window center is
mapped to an active Core Graphics display. Display IDs are Core Graphics
display UUIDs, not transient display indexes.

Depending on the macOS privacy configuration, the host editor may need Screen
Recording permission to inspect window metadata.

## Manual GUI verification

1. Open Code or Cursor with the extension host running.
2. Run the protocol example with the extension host PID.
3. Confirm the returned window and display while dragging the window between
   displays.
4. Repeat with a maximized window and a native fullscreen window.
5. Disconnect and reconnect a display, then verify that the helper returns the
   UUID of the display currently containing the window center.
