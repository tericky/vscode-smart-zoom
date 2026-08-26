# Linux X11 Native Helper

This C++17 program implements the Linux helper described by `../README.md`.
Source code lives in `native/linux-x11`, while the packaged executable must be
built at:

```text
native/linux/smart-zoom-helper
```

The `linux` path is required by `src/helper/helperLocator.ts`; it intentionally
differs from the source directory name.

## Requirements

- Linux with an X11 desktop session
- CMake 3.16 or later
- `pkg-config`
- A C++17 compiler
- Xlib, XRandR, and Xinerama development packages

On Debian or Ubuntu:

```sh
sudo apt-get install build-essential cmake pkg-config \
  libx11-dev libxrandr-dev libxinerama-dev
```

On Fedora:

```sh
sudo dnf install gcc-c++ cmake pkgconf-pkg-config \
  libX11-devel libXrandr-devel libXinerama-devel
```

## Build and package

From the repository root:

```sh
./native/linux-x11/build.sh
```

The script performs a release build and copies the executable to
`native/linux/smart-zoom-helper` with executable permissions. No placeholder
binary is checked in; produce the packaged binary on Linux.

## Implementation notes

The helper reads the supplied extension-host PID's parent chain from `/proc`.
It obtains top-level windows from the EWMH `_NET_CLIENT_LIST_STACKING`
property, with `XQueryTree` as a fallback, and matches them by `_NET_WM_PID`.
A case-insensitive `titleHint` match is preferred. The active eligible window,
process proximity, and stacking order provide the fallback ranking.

Monitor geometry is obtained from XRandR 1.5. The window center determines the
selected monitor. When XRandR monitor discovery is unavailable, the helper
falls back to Xinerama screen geometry. An EDID hash is used as the display ID
when XRandR exposes EDID data; otherwise the XRandR output name is used.

`scaleFactor` uses the X server's `Xft.dpi / 96`, then `GDK_SCALE`, and
otherwise defaults to `1`. X11 generally exposes one desktop-wide DPI setting,
so mixed per-monitor scaling must be verified against the target desktop
environment.

## Wayland degradation

When `XDG_SESSION_TYPE=wayland` or `WAYLAND_DISPLAY` is set, the helper consumes
and validates the request, then exits successfully after writing:

```json
{ "ok": false, "error": "wayland_unsupported" }
```

It does not attempt to query XWayland because global native Wayland window
coordinates are not reliably available. The extension keeps the current zoom;
`NativeHelperError.nativeError` exposes the stable `wayland_unsupported` code.

## Protocol checks

On Wayland:

```sh
printf '{"op":"getCurrentWindowDisplay","pid":%d}\n' "$$" |
  XDG_SESSION_TYPE=wayland ./native/linux/smart-zoom-helper
```

On X11, replace the PID with a running VS Code extension-host PID:

```sh
printf '{"op":"getCurrentWindowDisplay","pid":12345}\n' |
  ./native/linux/smart-zoom-helper
```

The process writes exactly one JSON response line. See `../README.md` for the
request, success, and stable error response shapes.

## Manual X11 verification

1. Build and package the helper on Linux.
2. Open two VS Code windows under X11 and obtain each extension-host PID.
3. Query each PID and confirm that the corresponding top-level window is used.
4. Move a window fully onto each monitor and confirm its display bounds.
5. Straddle two monitors and confirm the display containing the window center
   is returned.
6. Repeat with maximized and fullscreen windows.
7. Disconnect and reconnect each monitor and confirm the EDID-derived ID stays
   stable where the monitor exposes EDID.
8. Verify `scaleFactor` against the desktop's configured Xft DPI or GDK scale.

This verification requires a Linux X11 session and cannot be performed by the
macOS build host.
