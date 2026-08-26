import type * as Vscode from 'vscode';
import type { AutoZoomConfig, DisplayProfile, ZoomRule } from './types';
import type { DisplayIdentity } from '../display/types';
import { buildResolutionKey } from '../display/resolutionKey';

const CONFIG_SECTION = 'autoZoom';
const DEFAULT_ENABLED = true;
const DEFAULT_POLL_INTERVAL = 150;
const DEFAULT_STABILITY_CHECKS = 2;
const DEFAULT_ZOOM = 0;

type WorkspaceConfiguration = Vscode.WorkspaceConfiguration;

function getWorkspaceConfiguration(): WorkspaceConfiguration {
  const vscode = require('vscode') as typeof Vscode;
  return vscode.workspace.getConfiguration(CONFIG_SECTION);
}

function getConfigurationTarget(): Vscode.ConfigurationTarget {
  const vscode = require('vscode') as typeof Vscode;
  return vscode.ConfigurationTarget.Global;
}

function roundZoom(zoom: number): number {
  return Math.round(zoom);
}

function requireDisplayId(display: DisplayIdentity): string {
  if (!display.displayId) {
    throw new Error('displayId is required to save display configuration');
  }

  return display.displayId;
}

function toDisplayProfile(display: DisplayIdentity, zoom: number): DisplayProfile {
  return {
    ...(display.name ? { name: display.name } : {}),
    width: display.width,
    height: display.height,
    scaleFactor: display.scaleFactor,
    zoom
  };
}

function toZoomRule(display: DisplayIdentity, zoom: number): ZoomRule {
  return {
    width: display.width,
    height: display.height,
    scaleFactor: display.scaleFactor,
    zoom
  };
}

export function upsertZoomRule(
  zoomRules: readonly ZoomRule[],
  display: DisplayIdentity,
  zoom: number
): ZoomRule[] {
  const roundedZoom = roundZoom(zoom);
  const displayResolutionKey = buildResolutionKey(
    display.width,
    display.height,
    display.scaleFactor
  );
  const nextRule = toZoomRule(display, roundedZoom);
  let updatedExistingRule = false;

  const nextRules = zoomRules.map((rule) => {
    const ruleResolutionKey = buildResolutionKey(rule.width, rule.height, rule.scaleFactor);

    if (ruleResolutionKey !== displayResolutionKey) {
      return rule;
    }

    updatedExistingRule = true;
    return nextRule;
  });

  return updatedExistingRule ? nextRules : [...nextRules, nextRule];
}

export function learnDisplayConfiguration(
  config: AutoZoomConfig,
  display: DisplayIdentity,
  zoom: number
): AutoZoomConfig {
  const displayId = requireDisplayId(display);
  const roundedZoom = roundZoom(zoom);

  return {
    ...config,
    defaultZoom: DEFAULT_ZOOM,
    displayProfiles: {
      ...config.displayProfiles,
      [displayId]: toDisplayProfile(display, roundedZoom)
    },
    zoomRules: upsertZoomRule(config.zoomRules, display, roundedZoom)
  };
}

export function getAutoZoomConfig(): AutoZoomConfig {
  const configuration = getWorkspaceConfiguration();

  return {
    enabled: configuration.get('enabled', DEFAULT_ENABLED),
    pollInterval: configuration.get('pollInterval', DEFAULT_POLL_INTERVAL),
    stabilityChecks: configuration.get('stabilityChecks', DEFAULT_STABILITY_CHECKS),
    defaultZoom: DEFAULT_ZOOM,
    displayProfiles: configuration.get('displayProfiles', {}),
    zoomRules: configuration.get('zoomRules', [])
  };
}

export async function saveDisplayConfiguration(
  display: DisplayIdentity,
  zoom: number
): Promise<void> {
  const configuration = getWorkspaceConfiguration();
  const nextConfig = learnDisplayConfiguration(getAutoZoomConfig(), display, zoom);
  const target = getConfigurationTarget();

  await configuration.update('displayProfiles', nextConfig.displayProfiles, target);
  await configuration.update('zoomRules', nextConfig.zoomRules, target);
}
