import { chmod, constants } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Ensure the packaged native helper is executable and clear macOS quarantine
 * attributes that can delay or block first launches after Install from VSIX.
 */
export async function prepareHelperBinary(helperPath: string): Promise<void> {
  try {
    await chmod(helperPath, constants.S_IRUSR | constants.S_IWUSR | constants.S_IXUSR | constants.S_IRGRP | constants.S_IXGRP | constants.S_IROTH | constants.S_IXOTH);
  } catch {
    // Best effort only — missing helper is handled by spawn errors later.
  }

  if (process.platform !== 'darwin') {
    return;
  }

  try {
    await execFileAsync('xattr', ['-dr', 'com.apple.quarantine', helperPath], {
      timeout: 2000
    });
  } catch {
    // Quarantine may already be absent; ignore.
  }
}
