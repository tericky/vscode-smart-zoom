import * as path from 'node:path';
import type * as vscode from 'vscode';

export type SupportedHelperPlatform = 'darwin' | 'win32' | 'linux';

const helperRelativePaths: Record<SupportedHelperPlatform, string[]> = {
  darwin: ['native', 'darwin', 'smart-zoom-helper'],
  win32: ['native', 'win32', 'smart-zoom-helper.exe'],
  linux: ['native', 'linux', 'smart-zoom-helper']
};

export class UnsupportedHelperPlatformError extends Error {
  public readonly platform: NodeJS.Platform;

  public constructor(platform: NodeJS.Platform) {
    super(`Unsupported native helper platform: ${platform}`);
    this.name = 'UnsupportedHelperPlatformError';
    this.platform = platform;
  }
}

export function getHelperRelativePath(platform: NodeJS.Platform = process.platform): string {
  if (!isSupportedHelperPlatform(platform)) {
    throw new UnsupportedHelperPlatformError(platform);
  }

  return path.join(...helperRelativePaths[platform]);
}

export function getHelperPath(
  context: Pick<vscode.ExtensionContext, 'asAbsolutePath'>,
  platform: NodeJS.Platform = process.platform
): string {
  return context.asAbsolutePath(getHelperRelativePath(platform));
}

function isSupportedHelperPlatform(platform: NodeJS.Platform): platform is SupportedHelperPlatform {
  return platform === 'darwin' || platform === 'win32' || platform === 'linux';
}
