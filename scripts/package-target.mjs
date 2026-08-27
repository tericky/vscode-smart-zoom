#!/usr/bin/env node
/**
 * Package a platform-specific VSIX that includes only that OS helper.
 *
 * Usage: node scripts/package-target.mjs <vsce-target>
 * Example: node scripts/package-target.mjs darwin-arm64
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = process.argv[2];

const targetToIgnoreFamily = {
  'darwin-arm64': 'darwin',
  'darwin-x64': 'darwin',
  'win32-x64': 'win32',
  'win32-arm64': 'win32',
  'linux-x64': 'linux',
  'linux-arm64': 'linux',
  'linux-armhf': 'linux'
};

const helperRelativeByFamily = {
  darwin: path.join('native', 'darwin', 'smart-zoom-helper'),
  win32: path.join('native', 'win32', 'smart-zoom-helper.exe'),
  linux: path.join('native', 'linux', 'smart-zoom-helper')
};

if (!target || !(target in targetToIgnoreFamily)) {
  console.error(
    `Usage: node scripts/package-target.mjs <target>\nSupported: ${Object.keys(targetToIgnoreFamily).join(', ')}`
  );
  process.exit(1);
}

const family = targetToIgnoreFamily[target];
const helperPath = helperRelativeByFamily[family];
const ignoreFile = `.vscodeignore.${family}`;
const root = path.resolve(__dirname, '..');

if (!existsSync(path.join(root, helperPath))) {
  console.error(`Missing helper binary: ${helperPath}`);
  console.error('Build it on the matching OS before packaging this target.');
  process.exit(1);
}

if (!existsSync(path.join(root, ignoreFile))) {
  console.error(`Missing ignore file: ${ignoreFile}`);
  process.exit(1);
}

const compile = spawnSync('npm', ['run', 'compile'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32'
});
if (compile.status !== 0) {
  process.exit(compile.status ?? 1);
}

const pack = spawnSync(
  'npx',
  [
    '--yes',
    '@vscode/vsce',
    'package',
    '--no-dependencies',
    '--target',
    target,
    '--ignoreFile',
    ignoreFile
  ],
  {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  }
);

process.exit(pack.status ?? 1);
