declare function require(id: string): unknown;

interface Disposable {
  dispose(): void;
}

interface ExtensionContext {
  subscriptions: {
    push(...items: Disposable[]): void;
  };
}

interface ConfigurationInspect<T> {
  defaultValue?: T;
  globalValue?: T;
  workspaceValue?: T;
  workspaceFolderValue?: T;
}

interface WorkspaceConfiguration {
  get<T>(section: string): T | undefined;
  inspect<T>(section: string): ConfigurationInspect<T> | undefined;
}

interface OutputChannel extends Disposable {
  appendLine(value: string): void;
  show(preserveFocus?: boolean): void;
}

interface VscodeApi {
  commands: {
    executeCommand<T = unknown>(command: string, ...rest: unknown[]): Promise<T>;
    getCommands(filterInternal?: boolean): Promise<string[]>;
    registerCommand(
      command: string,
      callback: (...args: unknown[]) => unknown
    ): Disposable;
  };
  window: {
    createOutputChannel(name: string): OutputChannel;
    showErrorMessage(message: string, ...items: string[]): Promise<string | undefined>;
    showInformationMessage(message: string, ...items: string[]): Promise<string | undefined>;
    showInputBox(options: {
      prompt: string;
      placeHolder?: string;
      validateInput?(value: string): string | undefined;
    }): Promise<string | undefined>;
    showWarningMessage(message: string, ...items: string[]): Promise<string | undefined>;
  };
  workspace: {
    getConfiguration(section?: string): WorkspaceConfiguration;
  };
}

interface Attempt {
  requested: number;
  estimatedApplied: number;
  exact: boolean;
  resetBaseline: number;
  commandCount: number;
}

const vscode = require('vscode') as VscodeApi;
const output = vscode.window.createOutputChannel('Per-Window Zoom Spike');
const MIN_ZOOM_LEVEL = -8;
const MAX_ZOOM_LEVEL = 8;
let lastAttempt: Attempt | undefined;

function parseZoom(value: string): number | undefined {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) &&
    parsed >= MIN_ZOOM_LEVEL &&
    parsed <= MAX_ZOOM_LEVEL
    ? parsed
    : undefined;
}

function getConfiguredZoom(): number {
  return vscode.workspace.getConfiguration('window').get<number>('zoomLevel') ?? 0;
}

function getZoomPerWindow(): boolean {
  return vscode.workspace.getConfiguration('window').get<boolean>('zoomPerWindow') !== false;
}

function findRelativeCommandSequence(start: number, target: number): string[] | undefined {
  const queue: Array<{ level: number; commands: string[] }> = [
    { level: start, commands: [] }
  ];
  const visited = new Set<number>([start]);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    if (current.level === target) {
      return current.commands;
    }
    if (current.commands.length >= 20) {
      continue;
    }

    const candidates = [
      {
        level: Math.round(current.level + 1),
        command: 'workbench.action.zoomIn'
      },
      {
        level: Math.round(current.level - 1),
        command: 'workbench.action.zoomOut'
      }
    ];
    for (const candidate of candidates) {
      if (!visited.has(candidate.level)) {
        visited.add(candidate.level);
        queue.push({
          level: candidate.level,
          commands: [...current.commands, candidate.command]
        });
      }
    }
  }

  return undefined;
}

async function setCurrentWindowZoom(argument?: unknown): Promise<void> {
  let rawValue = typeof argument === 'number' ? String(argument) : undefined;
  if (rawValue === undefined) {
    rawValue = await vscode.window.showInputBox({
      prompt: 'Enter the target zoom for the current window (for example 0.5 or 1.5)',
      placeHolder: '0.5',
      validateInput: (value) =>
        parseZoom(value) === undefined
          ? `Enter a valid number between ${MIN_ZOOM_LEVEL} and ${MAX_ZOOM_LEVEL}`
          : undefined
    });
  }

  if (rawValue === undefined) {
    return;
  }

  const requested = parseZoom(rawValue);
  if (requested === undefined) {
    await vscode.window.showErrorMessage(
      `Zoom must be a valid number between ${MIN_ZOOM_LEVEL} and ${MAX_ZOOM_LEVEL}.`
    );
    return;
  }

  if (!getZoomPerWindow()) {
    const message =
      'window.zoomPerWindow is false; relative zoom commands would write window.zoomLevel and affect all windows. Refusing to run.';
    output.appendLine(`[reject] ${message}`);
    output.show(true);
    await vscode.window.showErrorMessage(message);
    return;
  }

  const resetBaseline = getConfiguredZoom();
  await vscode.commands.executeCommand('workbench.action.zoomReset');

  // VS Code Zoom In/Out applies Math.round(level ± 1), so the first relative
  // step lands on an integer. Intentionally apply the nearest reachable
  // integer to measure the capability gap.
  const estimatedApplied = requested === resetBaseline
    ? resetBaseline
    : Math.round(requested);
  const commandSequence = findRelativeCommandSequence(
    resetBaseline,
    estimatedApplied
  ) ?? [];

  for (const command of commandSequence) {
    await vscode.commands.executeCommand(command);
  }

  const simulatedCurrent =
    commandSequence.length === 0 && resetBaseline !== estimatedApplied
      ? resetBaseline
      : estimatedApplied;
  const commandCount = commandSequence.length;
  const exact = simulatedCurrent === requested;
  lastAttempt = {
    requested,
    estimatedApplied: simulatedCurrent,
    exact,
    resetBaseline,
    commandCount
  };

  const result = exact
    ? `Applied estimated value ${simulatedCurrent}.`
    : `Cannot apply ${requested} exactly; relative-command estimate is ${simulatedCurrent}.`;
  output.appendLine(
    `[set] requested=${requested}, resetBaseline=${resetBaseline}, ` +
      `estimatedApplied=${simulatedCurrent}, commandCount=${commandCount}, exact=${exact}`
  );
  output.appendLine(
    '[limit] Public Extension API cannot read back the live window zoom; the estimate only reflects this command sequence.'
  );
  output.show(true);

  if (exact && requested === resetBaseline && !Number.isInteger(requested)) {
    await vscode.window.showWarningMessage(
      `${result} This fractional value came from the global window.zoomLevel reset baseline and is not a per-window state mechanism.`
    );
  } else if (exact) {
    await vscode.window.showInformationMessage(result);
  } else {
    await vscode.window.showWarningMessage(result);
  }
}

async function readCurrentWindowZoom(): Promise<void> {
  const configuration = vscode.workspace.getConfiguration('window');
  const inspected = configuration.inspect<number>('zoomLevel');
  const zoomCommands = (await vscode.commands.getCommands(true))
    .filter((command) => /zoom/i.test(command))
    .sort();

  output.appendLine('--- read ---');
  output.appendLine(
    '[unreadable] Public VS Code Extension API does not provide a getter for the live window zoom.'
  );
  output.appendLine(`window.zoomPerWindow=${getZoomPerWindow()}`);
  output.appendLine(
    `window.zoomLevel (configured baseline, not live window)=${getConfiguredZoom()}`
  );
  output.appendLine(`window.zoomLevel inspect=${JSON.stringify(inspected)}`);
  output.appendLine(
    `lastAttempt=${lastAttempt ? JSON.stringify(lastAttempt) : 'no tracker value in this extension session'}`
  );
  output.appendLine(`zoom-related commands=${JSON.stringify(zoomCommands)}`);
  output.show(true);

  await vscode.window.showInformationMessage(
    'Live window zoom is unreadable. Configured baseline and this session tracker were written to Output "Per-Window Zoom Spike".'
  );
}

export function activate(context: ExtensionContext): void {
  output.appendLine('Per-Window Zoom Spike activated.');
  context.subscriptions.push(
    output,
    vscode.commands.registerCommand('spike.zoom.set', setCurrentWindowZoom),
    vscode.commands.registerCommand('spike.zoom.read', readCurrentWindowZoom)
  );
}

export function deactivate(): void {
  // OutputChannel is disposed via ExtensionContext.subscriptions.
}
