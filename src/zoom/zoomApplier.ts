import type { ZoomApplier as WindowMonitorZoomApplier } from '../monitor/windowMonitor';
import { ZoomTracker } from './zoomTracker';

type ZoomCommand = 'workbench.action.zoomReset' | 'workbench.action.zoomIn' | 'workbench.action.zoomOut';

interface CommandsLike {
  executeCommand(command: ZoomCommand): Thenable<unknown>;
}

interface WorkspaceConfigurationLike {
  get<T>(section: string, defaultValue: T): T;
}

interface WorkspaceLike {
  getConfiguration(section: 'window'): WorkspaceConfigurationLike;
}

export interface VscodeZoomApi {
  commands: CommandsLike;
  workspace: WorkspaceLike;
}

export interface ZoomApplierLogger {
  info(message: string): void;
}

export interface CommandZoomApplierOptions {
  vscodeApi?: VscodeZoomApi;
  tracker?: ZoomTracker;
  logger?: ZoomApplierLogger;
}

const zoomResetCommand: ZoomCommand = 'workbench.action.zoomReset';
const zoomInCommand: ZoomCommand = 'workbench.action.zoomIn';
const zoomOutCommand: ZoomCommand = 'workbench.action.zoomOut';
const maxCommandSearchDepth = 64;

export class CommandZoomApplier implements WindowMonitorZoomApplier {
  public readonly tracker: ZoomTracker;
  private readonly vscodeApi: VscodeZoomApi;
  private readonly logger?: ZoomApplierLogger;

  public constructor(options: CommandZoomApplierOptions = {}) {
    this.vscodeApi = options.vscodeApi ?? loadVscodeApi();
    this.tracker = options.tracker ?? new ZoomTracker();
    this.logger = options.logger;
  }

  public async applyZoomToCurrentWindow(target: number): Promise<void> {
    if (!Number.isFinite(target)) {
      throw new Error(`Zoom target must be finite. Received: ${target}`);
    }

    const configuration = this.vscodeApi.workspace.getConfiguration('window');
    const zoomPerWindow = configuration.get<boolean>('zoomPerWindow', true);

    if (zoomPerWindow === false) {
      const message =
        'window.zoomPerWindow is false; refusing to apply zoom because VS Code would affect all windows.';
      this.logger?.info(message);
      throw new Error(message);
    }

    const resetBaseline = configuration.get<number>('zoomLevel', 0);
    const appliedZoom = Math.round(target);
    const commandSequence = buildRelativeZoomCommandSequence(resetBaseline, appliedZoom);

    if (commandSequence === undefined) {
      throw new Error(
        `Unable to build a per-window zoom command sequence from ${resetBaseline} to ${appliedZoom}.`
      );
    }

    if (appliedZoom !== target) {
      this.logger?.info(
        `Rounded requested zoom ${target} to reachable integer zoom ${appliedZoom}.`
      );
    }

    await this.vscodeApi.commands.executeCommand(zoomResetCommand);

    for (const command of commandSequence) {
      await this.vscodeApi.commands.executeCommand(command);
    }

    this.tracker.recordAppliedZoom({
      requestedZoom: target,
      appliedZoom,
      exact: appliedZoom === target,
      resetBaseline,
      commandCount: commandSequence.length
    });
  }
}

export function buildRelativeZoomCommandSequence(
  resetBaseline: number,
  targetZoom: number
): ZoomCommand[] | undefined {
  const target = Math.round(targetZoom);
  const queue: Array<{ zoom: number; commands: ZoomCommand[] }> = [
    { zoom: resetBaseline, commands: [] }
  ];
  const visited = new Set<number>([resetBaseline]);

  while (queue.length > 0) {
    const current = queue.shift();

    if (!current) {
      break;
    }

    if (current.zoom === target) {
      return current.commands;
    }

    if (current.commands.length >= maxCommandSearchDepth) {
      continue;
    }

    for (const next of getNextZoomStates(current.zoom)) {
      if (visited.has(next.zoom)) {
        continue;
      }

      visited.add(next.zoom);
      queue.push({
        zoom: next.zoom,
        commands: [...current.commands, next.command]
      });
    }
  }

  return undefined;
}

function getNextZoomStates(zoom: number): Array<{ zoom: number; command: ZoomCommand }> {
  return [
    { zoom: Math.round(zoom + 1), command: zoomInCommand },
    { zoom: Math.round(zoom - 1), command: zoomOutCommand }
  ];
}

function loadVscodeApi(): VscodeZoomApi {
  return require('vscode') as VscodeZoomApi;
}
