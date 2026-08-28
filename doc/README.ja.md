# Smart Zoom

Languages: [English](../readme.md) | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=tericky.smart-zoom">
    <img src="https://vsmarketplacebadges.dev/version-short/tericky.smart-zoom.svg" alt="Marketplace バージョン" />
  </a>
  <a href="https://marketplace.visualstudio.com/items?itemName=tericky.smart-zoom">
    <img src="https://vsmarketplacebadges.dev/installs-short/tericky.smart-zoom.svg" alt="Marketplace インストール数" />
  </a>
  <a href="https://marketplace.visualstudio.com/items?itemName=tericky.smart-zoom">
    <img src="https://vsmarketplacebadges.dev/rating-short/tericky.smart-zoom.svg" alt="Marketplace 評価" />
  </a>
</p>

<p align="center">
  <img src="images/icon.png" alt="Smart Zoom アイコン" width="220" />
</p>

<p align="center">
  <strong>マルチモニター作業でも、ディスプレイごとにちょうどよいウィンドウのズームを。</strong>
</p>

<p align="center">
  Smart Zoom は、VS Code（や Cursor などの互換エディター）のウィンドウが今どのディスプレイにあるかに合わせて、ズームを自動で切り替えます。ウィンドウごとに独立しているので、ほかのウィンドウには影響しません。
</p>

<p align="center">
  <a href="https://buymeacoffee.com/tericky" target="_blank" rel="noopener noreferrer">
    <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="60" width="217">
  </a>
</p>

<p align="center">
  <a href="#demo">デモ</a> ·
  <a href="#主な機能">主な機能</a> ·
  <a href="#使い方">使い方</a> ·
  <a href="#コマンド">コマンド</a> ·
  <a href="#設定">設定</a> ·
  <a href="#サポート">サポート</a>
</p>

## Demo

<p align="center">
  <img src="images/demo.gif" alt="Smart Zoom デモ" width="900" />
</p>

## 主な機能

<table>
  <tr>
    <td width="33%">
      <strong>ディスプレイごとに記憶</strong><br />
      Display ID 単位で、好みのズームレベルを保存します。
    </td>
    <td width="33%">
      <strong>ウィンドウは独立</strong><br />
      今のウィンドウだけズームが変わり、ほかは据え置きです（<code>window.zoomPerWindow</code> が必要）。
    </td>
    <td width="33%">
      <strong>移すだけで切替</strong><br />
      別ディスプレイへドラッグすると、その画面用のズームへ自動で変わります。
    </td>
  </tr>
</table>

ステータスバーのメニュー、学習済みプロファイル、macOS / Windows / Linux（X11）対応も含まれます。

## 動作環境

> **先に確認：** `"window.zoomPerWindow": true`（VS Code では既定でオン）。Smart Zoom はウィンドウ単位でズームを適用します。オフだと警告が出て、正しく動きません。

- VS Code `^1.85.0`、または Cursor などの互換エディター

| プラットフォーム | 対応状況                                                                  |
| ---------------- | ------------------------------------------------------------------------- |
| macOS            | 完全対応。検出が不安定なときは「画面収録」権限が必要になることがあります  |
| Windows          | 完全対応                                                                  |
| Linux（X11）     | 完全対応                                                                  |
| Linux（Wayland） | 制限あり。ディスプレイの自動検出はできません（[既知の制限](#既知の制限)） |

## 使い方

1. Marketplace から **Smart Zoom** を入れるか、VSIX をインストールします。
2. 設定で `"window.zoomPerWindow"` が `true` になっているか確認します。
3. ウィンドウを 1 台目のディスプレイへ移し、ステータスバーの Smart Zoom からズームを選びます。
4. 2 台目へ移して、別のズームを設定します。
5. ディスプレイ間でドラッグすると、ズームがついて切り替わります。

`F1`／コマンドパレットから **Smart Zoom: Status Menu** を実行しても同じ操作ができます。

## コマンド

| コマンド                                                       | 説明                                                                                                                             |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `Smart Zoom: Enable`                                           | 自動ズームをオン                                                                                                                 |
| `Smart Zoom: Disable`                                          | 自動ズームをオフ                                                                                                                 |
| `Smart Zoom: Detect Current Display`                           | 今のウィンドウがあるディスプレイを検出し、状態を表示                                                                             |
| `Smart Zoom: Status Menu` / `Configure Current Display (Menu)` | メニューを開く（ズーム変更・検出・クリア・オン／オフ）                                                                           |
| `Smart Zoom: Zoom In Current Display`                          | 今のディスプレイを一段大きくし、設定を保存                                                                                       |
| `Smart Zoom: Zoom Out Current Display`                         | 今のディスプレイを一段小さくし、設定を保存                                                                                       |
| `Smart Zoom: Show Status`                                      | ディスプレイ情報を表示し、出力ログを開く                                                                                         |
| `Smart Zoom: Clear All Learned Settings`                       | 学習済みのプロファイルとルールをすべて削除し、今のウィンドウをズームレベル 0（100%）に戻す（新しいプロファイルは書き込みません） |

## 設定

普段はステータスバーのメニューだけで足ります。細かい項目は設定の **Smart Zoom** にあります。

| 設定                     | 既定   | 説明                                                                                                                              |
| ------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `smartZoom.enabled`      | `true` | Smart Zoom のオン／オフ                                                                                                           |
| `smartZoom.pollInterval` | `500`  | watch が使えないとき（例: Windows / Linux のポーリング）に、何ミリ秒ごとにディスプレイを確認するか。大きいほど CPU に優しいです。 |
| `smartZoom.defaultZoom`  | `0`    | プロファイルもルールも無いときのフォールバック（`0` はおよそ 100%）                                                               |

ここでのズームレベルは VS Code の整数ウィンドウズームです（だいたい ±20% 刻み: `0` → 100%、`1` → 120%、`-1` → 83% …）。

<details>
<summary><strong>詳細設定とズームの決まり方</strong></summary>

<br />

| 設定                        | 既定 | 説明                                                                                   |
| --------------------------- | ---- | -------------------------------------------------------------------------------------- |
| `smartZoom.stabilityChecks` | `2`  | ディスプレイ変更を確定する前に、何回連続で同じ結果が必要か（境界付近でのチラつき防止） |
| `smartZoom.displayProfiles` | `{}` | ディスプレイごとの学習結果（通常は UI が書き込みます）                                 |
| `smartZoom.zoomRules`       | `[]` | 解像度と scale factor で照合するルール（通常は UI が書き込みます）                     |

ウィンドウがディスプレイに落ち着いたあと、次の優先順位でズームを決めます。

1. その Display ID の **display profile**（保存済みなら）
2. なければ、幅×高さ×scale factor に合う **zoom rule**
3. どちらも無ければ **`smartZoom.defaultZoom`**

</details>

## 既知の制限

- **整数ズームのみ** — 公開されているエディター API の都合で、小数の per-window zoom には対応していません。
- **Wayland** — ディスプレイの自動検出はできません。警告を一度出し、今のズームを維持します。
- **グローバルな `window.zoomLevel` を「このウィンドウ」の状態には使いません** — フォーカス中のウィンドウだけ変え、ほかはそのままです。
- **macOS の権限** — 検出に失敗し続けるときは、システム設定でエディターの「画面収録」を許可してから、ウィンドウを再読み込みしてください。

## サポート

Smart Zoom が役に立ったら、コーヒーをおごってもらえると嬉しいです：

<p align="center">
  <a href="https://buymeacoffee.com/tericky" target="_blank" rel="noopener noreferrer">
    <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="60" width="217">
  </a>
</p>

<p align="center">
  不具合報告・機能要望: <a href="https://github.com/tericky/vscode-smart-zoom/issues">GitHub Issues</a>
</p>

## ライセンス

[Apache-2.0](../LICENSE)
