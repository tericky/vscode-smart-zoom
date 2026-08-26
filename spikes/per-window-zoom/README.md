# Per-Window Absolute Zoom (Fractional) Spike

This spike checks whether a VS Code extension can apply an absolute zoom level,
including fractional values, to the current window without writing
`window.zoomLevel`.

## How to run

1. Open this directory in VS Code / Cursor.
2. Run `npm run compile`.
3. Press `F5` to launch the Extension Development Host.
4. From the Command Palette, run:
   - `Zoom Spike: Set Current Window Zoom`
   - `Zoom Spike: Read Current Window Zoom`
5. Inspect the `Per-Window Zoom Spike` output channel.

`spike.zoom.set` first runs `workbench.action.zoomReset`, then uses
`workbench.action.zoomIn` / `workbench.action.zoomOut` to approach the nearest
reachable value. If a fractional input can only reach an integer, the command
reports the approximation and does not claim exact success.

`spike.zoom.read` only shows:

- the `window.zoomLevel` configured baseline (not the live window value)
- the estimate tracked during this extension session
- host commands whose names contain `zoom`

There is no public Extension API getter for the active window's live zoom, so
read results are explicitly marked as unreadables.

## Candidate path results

### 1. `zoomIn` / `zoomOut` / `zoomReset` + local tracker

- Per-window isolation: **conditionally feasible**. When
  `window.zoomPerWindow !== false`, zoom commands affect the active window
  only. This spike refuses to run when that setting is `false`, to avoid
  writing global settings.
- Absolute value: **approximate only**, when the reset baseline is known and
  the local tracker stays consistent.
- Fractional: **failed**. VS Code `BaseZoomAction.setZoomLevel()` applies
  `Math.round(levelOrReset)`; the first relative step lands on an integer.
- Settings writes: not written when `window.zoomPerWindow !== false`; when
  `false`, upstream updates `window.zoomLevel`, so this spike blocks that path.
- Read-back: **failed**. Public APIs cannot read the active window live zoom;
  the tracker cannot detect external changes from the user or other extensions.

### 2. Absolute zoom command / proposed API

- Public `vscode.d.ts` has no per-window zoom getter/setter.
- No zoom proposed API was found.
- `spike.zoom.read` lists zoom-related host commands for version checks.
  Known public commands are relative zoom and reset only; there is no stable
  absolute per-window command that accepts a numeric target.
- Result: **no usable path**.

### 3. `configuration.update('window.zoomLevel', …)`

- Result: **failed path; forbidden**.
- The Configuration API writes settings, not independent per-window runtime
  state.
- Upstream behavior is clear: updating `window.zoomLevel` applies that value
  to all windows. When `window.zoomPerWindow === false`, built-in zoom
  commands themselves write this setting.
- This spike does not overwrite user settings. The conclusion is confirmed from
  upstream source and multi-window test notes, without mutating `settings.json`.

## Two-window acceptance

Target:

```text
Window A = 0.5
Window B = 1.5
settings.json window.zoomLevel is not used as per-window state
```

Result: **FAILED**.

The blocker is not per-window isolation itself. With
`window.zoomPerWindow=true`, relative commands can isolate the active window.
The blocker is that public commands round to integers and there is no stable
absolute fractional setter. If the reset baseline happens to be fractional,
reset can restore that global setting value, but it cannot give A and B two
different fractional values, and repeatedly rewriting the global setting is not
allowed as a workaround.

Manual reproduction:

1. Confirm `window.zoomPerWindow=true` and record the current
   `window.zoomLevel` in `settings.json`.
2. Open two Extension Development Host windows.
3. In Window A, run `spike.zoom.set` with `0.5`.
4. In Window B, run `spike.zoom.set` with `1.5`.
5. Check Output: both report nearest reachable integer estimates, not exact
   fractional values.
6. Run `spike.zoom.read`: live zoom remains unreadable.
7. Confirm this spike did not rewrite `window.zoomLevel` in `settings.json`.

This environment cannot automate two GUI windows; the steps above remain the
manual procedure. Even without visual confirmation, upstream `Math.round`
already makes the `0.5` / `1.5` acceptance criteria impossible.

## Evidence

- VS Code `windowActions.ts`: `BaseZoomAction` chooses active/all windows from
  `window.zoomPerWindow` and applies `Math.round`.
  <https://github.com/microsoft/vscode/blob/main/src/vs/workbench/electron-browser/actions/windowActions.ts>
- Upstream per-window zoom test notes: when enabled, commands do not write
  settings and isolate the active window; updating `window.zoomLevel` changes
  all windows.
  <https://github.com/microsoft/vscode/issues/202922>
- Existing issue that built-in commands turn fractional zoom into integers:
  <https://github.com/microsoft/vscode/issues/164971>

## Conclusion

- Feasible path: with `window.zoomPerWindow=true`, built-in relative zoom
  commands can isolate the active window and apply integer zoom. This does not
  satisfy the product requirement for absolute fractional zoom.
- Infeasible paths: `zoomIn` / `zoomOut` / `zoomReset` + tracker cannot set
  arbitrary fractional values exactly; no public or proposed absolute
  per-window zoom API was found; `configuration.update('window.zoomLevel', …)`
  writes settings and affects all windows.
- Fractional zoom: **infeasible**
- Recommended ZoomApplier approach: **do not implement as if fractional zoom
  is supported**. Prefer requesting / tracking a stable active-window absolute
  zoom API upstream. Until that exists and is re-validated, `ZoomApplier`
  should report an explicit unsupported capability.
- If infeasible: prefer fallback A from spec §13.3 — block release and report
  the capability gap. Only if the product explicitly accepts it, use fallback B
  (nearest reachable integer) and clearly mark Status/Log as approximate.
  Never rewrite global `window.zoomLevel` as per-window state.

**Gate result: FAILED. Under the public Extension API there is no clear path
that simultaneously satisfies per-window isolation, absolute targeting,
fractional values, and no global settings writes.**
