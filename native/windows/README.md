# Windows Native Helper

This C++ program implements the Windows helper described by `../README.md`.
Source code lives in `native/windows`, while the packaged executable must be
built at:

```text
native/win32/smart-zoom-helper.exe
```

The `win32` path is required by `src/helper/helperLocator.ts`; it intentionally
differs from the source directory name.

## Requirements

- Windows 10 version 1607 or later
- Visual Studio 2022 Build Tools with the Desktop development with C++ workload
- CMake 3.20 or later on `PATH`

## Build and package

From a Developer Command Prompt at the repository root:

```bat
native\windows\build.bat
```

The script configures a 64-bit MSVC release build and copies the result to
`native\win32\smart-zoom-helper.exe`. Pass another Visual Studio generator
architecture, such as `ARM64`, as the first argument when needed:

```bat
native\windows\build.bat ARM64
```

No executable is checked in until it has been produced and verified on Windows.

## Implementation notes

The helper enables per-monitor DPI awareness before reading window geometry. It
walks the supplied extension-host PID's parent process chain, enumerates
top-level windows in Z order, and prefers a case-insensitive `titleHint` match.
The foreground eligible window is the fallback. The window center is mapped
with `MonitorFromPoint`.

Display scale is the effective monitor DPI divided by 96. The display identity
comes from the monitor's Plug and Play device interface returned by
`EnumDisplayDevicesW(..., EDD_GET_DEVICE_INTERFACE_NAME)`. This DeviceID contains
the EDID-derived vendor/product identifier and monitor instance, so the returned
ID is not the transient GDI name such as `\\.\DISPLAY1`.

## Protocol check

In PowerShell, replace the PID with a running VS Code extension-host PID:

```powershell
'{"op":"getCurrentWindowDisplay","pid":12345}' |
  .\native\win32\smart-zoom-helper.exe
```

The process writes exactly one JSON response line. See `../README.md` for the
request, success, and stable error response shapes.

## Mixed-DPI manual verification

1. Configure three monitors to 100%, 150%, and 200% scaling.
2. Restart VS Code so all processes inherit the current DPI environment.
3. Move the VS Code window fully onto each monitor and run the protocol check.
4. Confirm `scaleFactor` is respectively `1`, `1.5`, and `2`.
5. Confirm `window` and `display` coordinates match physical desktop pixels.
6. Straddle two monitors and confirm the display containing the window center
   is returned.
7. Disconnect and reconnect each monitor and confirm its returned `display.id`
   remains the same.

This verification must be run on Windows hardware; it cannot be performed by
the macOS build host.
