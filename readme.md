# Smart Zoom

Languages: [English](./readme.md) | [繁體中文](doc/README.zh-TW.md) | [简体中文](doc/README.zh-CN.md) | [日本語](doc/README.ja.md)

<p align="center">
  <img src="doc/images/icon.png" alt="Smart Zoom icon" width="220" />
</p>

<p align="center">
  <strong>Per-display window zoom that follows your multi-monitor workflow.</strong>
</p>

<p align="center">
  Automatically apply the right zoom for the display your VS Code (or compatible) window is on — independently for every window.
</p>

<p align="center">
  <a href="https://buymeacoffee.com/tericky" target="_blank" rel="noopener noreferrer">
    <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="60" width="217">
  </a>
</p>

<p align="center">
  <a href="#demo">Demo</a> ·
  <a href="#features">Features</a> ·
  <a href="#getting-started">Getting Started</a> ·
  <a href="#commands">Commands</a> ·
  <a href="#settings">Settings</a> ·
  <a href="#support">Support</a>
</p>

## Demo

<p align="center">
  <img src="doc/images/demo.gif" alt="Smart Zoom demo" width="900" />
</p>

## Features

<table>
  <tr>
    <td width="33%">
      <strong>Per-display zoom</strong><br />
      Remember a preferred zoom for each monitor by display ID.
    </td>
    <td width="33%">
      <strong>Per-window isolation</strong><br />
      Changing zoom in one window does not affect others (requires <code>window.zoomPerWindow</code>).
    </td>
    <td width="33%">
      <strong>Automatic switching</strong><br />
      Move a window to another display and Smart Zoom applies that display’s saved zoom.
    </td>
  </tr>
</table>

Also included: status bar menu, learned display profiles, and support for macOS, Windows, and Linux (X11).

## Requirements

> **Required:** `"window.zoomPerWindow": true` (VS Code default). Smart Zoom applies zoom per window and will warn if this setting is disabled.

- VS Code `^1.85.0` (or a compatible editor such as Cursor)

| Platform        | Support                                                                                            |
| --------------- | -------------------------------------------------------------------------------------------------- |
| macOS           | Full — Screen Recording permission may be required for reliable window detection                   |
| Windows         | Full                                                                                               |
| Linux (X11)     | Full                                                                                               |
| Linux (Wayland) | Limited — automatic display detection is unavailable (see [Known Limitations](#known-limitations)) |

## Getting Started

1. Install **Smart Zoom** from the marketplace (or install a VSIX).
2. Confirm `"window.zoomPerWindow": true` in your settings.
3. Move a window onto a display, then click **Smart Zoom** in the status bar and choose a zoom level.
4. Move the same window to another display and set a different zoom.
5. Drag the window between those displays — Smart Zoom should switch zoom automatically.

You can also open the Command Palette and run **Smart Zoom: Status Menu**.

## Commands

| Command                                                        | Description                                                                                                                    |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `Smart Zoom: Enable`                                           | Turn automatic zoom on                                                                                                         |
| `Smart Zoom: Disable`                                          | Turn automatic zoom off                                                                                                        |
| `Smart Zoom: Detect Current Display`                           | Detect the display under the current window and show status                                                                    |
| `Smart Zoom: Status Menu` / `Configure Current Display (Menu)` | Open the status menu — pick zoom, detect, clear, or toggle                                                                     |
| `Smart Zoom: Zoom In Current Display`                          | Increase zoom for the current display and save it                                                                              |
| `Smart Zoom: Zoom Out Current Display`                         | Decrease zoom for the current display and save it                                                                              |
| `Smart Zoom: Show Status`                                      | Show current display details and open the output log                                                                           |
| `Smart Zoom: Clear All Learned Settings`                       | Remove saved display profiles and zoom rules, then apply zoom level 0 (100%) to the current window without re-saving a profile |

## Settings

Most users only need the status bar menu. These settings are available under **Smart Zoom**:

| Setting                  | Default | Description                                                                         |
| ------------------------ | ------- | ----------------------------------------------------------------------------------- |
| `smartZoom.enabled`      | `true`  | Enable or disable Smart Zoom                                                        |
| `smartZoom.pollInterval` | `500`   | How often (ms) to check which display the window is on when watch mode is unavailable (for example Windows / Linux polling). Higher values use less CPU. |
| `smartZoom.defaultZoom`  | `0`     | Zoom level used when no profile or rule matches (`0` ≈ 100%)                        |

Zoom levels are VS Code integer window zoom levels (approximately ±20% steps: `0` → 100%, `1` → 120%, `-1` → 83%, …).

<details>
<summary><strong>Advanced settings &amp; zoom resolution</strong></summary>

<br />

| Setting                     | Default | Description                                                                                                       |
| --------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------- |
| `smartZoom.stabilityChecks` | `2`     | Consecutive stable readings required before applying a display change (reduces flicker while straddling monitors) |
| `smartZoom.displayProfiles` | `{}`    | Learned per-display profiles (usually managed by the UI)                                                          |
| `smartZoom.zoomRules`       | `[]`    | Optional rules keyed by resolution + scale factor (usually managed by the UI)                                     |

When a window settles on a display, Smart Zoom picks a zoom in this order:

1. **Display profile** for that display’s ID (if one was saved)
2. Else a matching **zoom rule** for width × height × scale factor
3. Else **`smartZoom.defaultZoom`**

</details>

## Known Limitations

- **Integer zoom only** — Smart Zoom uses whole zoom levels. Exact fractional per-window zoom is limited by public editor APIs.
- **Wayland** — automatic display detection is unsupported; Smart Zoom shows a one-time warning and keeps the current zoom.
- **Does not use global `window.zoomLevel` as per-window state** — zoom is applied to the focused window so other windows stay unchanged.
- **macOS permissions** — if detection fails, grant Screen Recording access to your editor and reload the window.

## Support

Enjoying Smart Zoom? Buy me a coffee:

<p align="center">
  <a href="https://buymeacoffee.com/tericky" target="_blank" rel="noopener noreferrer">
    <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="60" width="217">
  </a>
</p>

<p align="center">
  Bug reports and feature requests: <a href="https://github.com/tericky/vscode-smart-zoom/issues">GitHub Issues</a>
</p>

## License

[Apache-2.0](LICENSE)
