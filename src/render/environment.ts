/**
 * The environment map a browser-lane shot renders under: the Poly Haven
 * HDRI the lighting preset maps to (src/assets/catalogue.ts) when the
 * assets command has installed it under the data directory, served by the
 * harness under /assets/. A missing file is not an error: the three lane
 * falls back to its built-in room environment and says so in its report,
 * and the still shows the difference.
 */
import { hdriForLighting } from '../assets/catalogue.ts';
import { isInstalled } from '../assets/fetch.ts';
import { AssetLedger, assetLedgerPath } from '../net/asset-ledger.ts';
import type { Shot } from '../shared/contracts/shot-spec.ts';
import { assetsUrlPrefix } from '../shared/harness/protocol.ts';
import type { EnvironmentRef } from '../shared/harness/protocol.ts';

/** The resolution the browser lanes load; 2k is for Blender. */
export const browserHdriResolution = '1k';

/** The URL the harness serves a catalogue file under: its path relative to the data directory, with the leading assets/ folder mapped to the assets prefix. */
export function assetUrl(file: string): string {
  return `${assetsUrlPrefix}${file.replace(/^assets\//, '')}`;
}

/** The environment of a shot: the preset's HDRI when it is installed, null otherwise. */
export function resolveEnvironment(shot: Shot, dataDir: string): EnvironmentRef | null {
  const entry = hdriForLighting(shot.lighting.preset, browserHdriResolution);
  const ledger = new AssetLedger(assetLedgerPath(dataDir));
  ledger.load();
  if (!isInstalled(entry, dataDir, ledger)) return null;
  return { id: entry.id, url: assetUrl(entry.file), kelvin: entry.kelvin };
}
