import * as vscode from 'vscode';

import type { DisplayIdentity } from '../display/types';
import {
  buildStatusMenuItems,
  findCurrentZoomMenuItem,
  formatZoomLevelOption,
  MENU_SEPARATOR_KIND,
  type StatusMenuItem
} from './statusMenuItems';

export function showStatusMenu(options: {
  display: DisplayIdentity;
  zoom: number;
  enabled: boolean;
}): Promise<StatusMenuItem | undefined> {
  const items = buildStatusMenuItems(options);
  const currentItem = findCurrentZoomMenuItem(items, options.zoom);
  const displayName = options.display.name ?? 'Unknown display';

  return new Promise((resolve) => {
    const quickPick = vscode.window.createQuickPick<StatusMenuItem>();
    quickPick.title = `Smart Zoom · ${displayName} · ${formatZoomLevelOption(options.zoom)}`;
    quickPick.placeholder = 'Select a zoom size — current size is marked with ✓';
    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = true;
    quickPick.items = items;
    if (currentItem) {
      quickPick.activeItems = [currentItem];
    }

    let settled = false;
    const finish = (value: StatusMenuItem | undefined): void => {
      if (settled) {
        return;
      }
      settled = true;
      quickPick.dispose();
      resolve(value);
    };

    quickPick.onDidAccept(() => {
      const selected = quickPick.selectedItems[0];
      if (
        !selected ||
        selected.kind === MENU_SEPARATOR_KIND ||
        selected.action === undefined
      ) {
        return;
      }
      finish(selected);
    });
    quickPick.onDidHide(() => finish(undefined));
    quickPick.show();
  });
}
