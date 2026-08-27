# Smart Zoom

Languages: [English](../readme.md) | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

<p align="center">
  <img src="images/icon.png" alt="Smart Zoom 图标" width="220" />
</p>

<p align="center">
  <strong>多显示器工作时，让每块屏幕都有合适的窗口缩放。</strong>
</p>

<p align="center">
  Smart Zoom 会根据 VS Code（或 Cursor 等兼容编辑器）窗口当前所在的显示器，自动应用对应缩放；各个窗口彼此独立，互不影响。
</p>

<p align="center">
  <a href="https://buymeacoffee.com/tericky" target="_blank" rel="noopener noreferrer">
    <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="60" width="217">
  </a>
</p>

<p align="center">
  <a href="#demo">演示</a> ·
  <a href="#功能亮点">功能亮点</a> ·
  <a href="#开始使用">开始使用</a> ·
  <a href="#命令">命令</a> ·
  <a href="#设置">设置</a> ·
  <a href="#支持本项目">支持本项目</a>
</p>

## Demo

<p align="center">
  <img src="images/demo.gif" alt="Smart Zoom 演示" width="900" />
</p>

## 功能亮点

<table>
  <tr>
    <td width="33%">
      <strong>按显示器记住缩放</strong><br />
      通过 Display ID 为每块显示器保存偏好的缩放级别。
    </td>
    <td width="33%">
      <strong>窗口互不影响</strong><br />
      只调整当前窗口的缩放，其他窗口保持不变（需启用 <code>window.zoomPerWindow</code>）。
    </td>
    <td width="33%">
      <strong>拖过去就切换</strong><br />
      窗口换到另一块显示器时，自动应用该显示器已保存的缩放。
    </td>
  </tr>
</table>

此外还提供状态栏快捷菜单、可学习的显示器配置，并支持 macOS、Windows 与 Linux（X11）。

## 系统要求

> **请先确认：** `"window.zoomPerWindow": true`（VS Code 默认开启）。Smart Zoom 按单个窗口应用缩放；若关闭该选项，会提示警告且无法正常工作。

- VS Code `^1.85.0`，或 Cursor 等兼容编辑器

| 平台             | 支持情况                                                 |
| ---------------- | -------------------------------------------------------- |
| macOS            | 完整支持；若检测不稳定，可能需要“屏幕录制”权限           |
| Windows          | 完整支持                                                 |
| Linux（X11）     | 完整支持                                                 |
| Linux（Wayland） | 有限制：无法自动识别显示器（详见 [已知限制](#已知限制)） |

## 开始使用

1. 从 Marketplace 安装 **Smart Zoom**，或安装 VSIX 扩展包。
2. 在设置中确认 `"window.zoomPerWindow"` 为 `true`。
3. 将窗口移到第一块显示器，点击状态栏上的 Smart Zoom，选好缩放级别。
4. 再移到第二块显示器，设成另一个缩放。
5. 在两块显示器之间拖动窗口，缩放应会跟着切换。

也可以按 `F1` 打开命令面板，运行 **Smart Zoom: Status Menu**。

## 命令

| 命令                                                           | 说明                                                                                     |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `Smart Zoom: Enable`                                           | 开启自动缩放                                                                             |
| `Smart Zoom: Disable`                                          | 关闭自动缩放                                                                             |
| `Smart Zoom: Detect Current Display`                           | 检测当前窗口所在显示器并显示状态                                                         |
| `Smart Zoom: Status Menu` / `Configure Current Display (Menu)` | 打开菜单：调整缩放、检测、清除配置或开关功能                                             |
| `Smart Zoom: Zoom In Current Display`                          | 将当前显示器放大一档，并记住设置                                                         |
| `Smart Zoom: Zoom Out Current Display`                         | 将当前显示器缩小一档，并记住设置                                                         |
| `Smart Zoom: Show Status`                                      | 显示当前显示器信息，并打开“输出”日志                                                     |
| `Smart Zoom: Clear All Learned Settings`                       | 清除所有已学习的显示器配置与规则，并将当前窗口设回缩放级别 0（100%），不会再写入新的配置 |

## 设置

平时使用大多点击状态栏菜单即可。高级选项位于设置中的 **Smart Zoom**：

| 设置项                   | 默认值 | 说明                                                                                                      |
| ------------------------ | ------ | --------------------------------------------------------------------------------------------------------- |
| `smartZoom.enabled`      | `true` | 是否启用 Smart Zoom                                                                                       |
| `smartZoom.pollInterval` | `500`  | 无法使用 watch 模式时（例如 Windows／Linux 轮询），每隔多少毫秒检查窗口位于哪块显示器。数值越大越省 CPU。 |
| `smartZoom.defaultZoom`  | `0`    | 找不到对应配置或规则时的默认缩放（`0` 约等于 100%）                                                       |

此处的缩放级别为 VS Code 的整数窗口缩放（大约每档 ±20%：`0` → 100%、`1` → 120%、`-1` → 83%……）。

<details>
<summary><strong>高级设置与缩放判定方式</strong></summary>

<br />

| 设置项                      | 默认值 | 说明                                                                       |
| --------------------------- | ------ | -------------------------------------------------------------------------- |
| `smartZoom.stabilityChecks` | `2`    | 应用显示器变更前，需连续几次检测结果一致（避免卡在两块屏幕交界时缩放跳动） |
| `smartZoom.displayProfiles` | `{}`   | 按显示器记住的配置（通常由界面自动写入）                                   |
| `smartZoom.zoomRules`       | `[]`   | 按分辨率与 scale factor 匹配的规则（通常由界面自动写入）                   |

窗口稳定落在某块显示器后，缩放按以下优先级决定：

1. 该显示器 Display ID 已保存的 **display profile**
2. 否则，匹配宽×高×scale factor 的 **zoom rule**
3. 再否则，使用 **`smartZoom.defaultZoom`**

</details>

## 已知限制

- **仅支持整数缩放** — 受公开编辑器 API 限制，无法提供精确的小数 per-window zoom。
- **Wayland** — 无法自动检测显示器；会提示一次警告，并保持当前缩放不变。
- **不会用全局 `window.zoomLevel` 作为单个窗口的状态** — 只调整焦点窗口，其他窗口不受影响。
- **macOS 权限** — 若持续检测失败，请在系统设置中为编辑器开启“屏幕录制”，然后重新加载窗口再试。

## 支持本项目

如果 Smart Zoom 对你有帮助，欢迎请我喝杯咖啡：

<p align="center">
  <a href="https://buymeacoffee.com/tericky" target="_blank" rel="noopener noreferrer">
    <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="60" width="217">
  </a>
</p>

<p align="center">
  问题反馈与功能建议：<a href="https://github.com/tericky/vscode-smart-zoom/issues">GitHub Issues</a>
</p>

## 许可证

[Apache-2.0](../LICENSE)
