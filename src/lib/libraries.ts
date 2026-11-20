import type { StencilDef } from './types';

/** Library for imported images and for stencils saved before libraries existed. */
export const DEFAULT_LIBRARY = 'My stencils';

/** The library (folder) a custom stencil belongs to. */
export const libraryOf = (s: Pick<StencilDef, 'library'>) => s.library?.trim() || DEFAULT_LIBRARY;

/** Library names compare case-insensitively, so "my stencils" merges into "My stencils". */
export const sameLibrary = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Finds an existing library spelled differently (case/spacing), else returns the name as given. */
export function resolveLibrary(name: string, existing: Iterable<string>) {
  const clean = name.trim().replace(/\s+/g, ' ') || DEFAULT_LIBRARY;
  for (const e of existing) if (sameLibrary(e, clean)) return e;
  if (sameLibrary(clean, DEFAULT_LIBRARY)) return DEFAULT_LIBRARY;
  return clean;
}

export interface StencilLibrary {
  name: string;
  stencils: StencilDef[];
}

/** Groups custom stencils into libraries, sorted by name ("My stencils" first). */
export function groupLibraries(stencils: StencilDef[]): StencilLibrary[] {
  const map = new Map<string, StencilDef[]>();
  for (const s of stencils) {
    const name = resolveLibrary(libraryOf(s), map.keys());
    map.set(name, [...(map.get(name) ?? []), s]);
  }
  return [...map.entries()]
    .map(([name, list]) => ({ name, stencils: list.sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => (a.name === DEFAULT_LIBRARY ? -1 : b.name === DEFAULT_LIBRARY ? 1 : a.name.localeCompare(b.name)));
}

// Product names that are written as one word and must not be split at their capitals.
const KEEP_WHOLE = [
  'PowerEdge', 'PowerVault', 'PowerSwitch', 'PowerStore', 'PowerScale', 'PowerConnect', 'OptiPlex', 'EqualLogic',
  'UniFi', 'EdgeRouter', 'EdgeSwitch', 'EdgeMAX', 'AirMax', 'AirFiber', 'UISP', 'NanoStation', 'NanoBeam', 'PowerBeam', 'LiteBeam',
  'ProLiant', 'ProCurve', 'StoreOnce', 'NetApp', 'FortiGate', 'FortiSwitch', 'FortiAP', 'SonicWall', 'SonicWave', 'WatchGuard',
  'NetGear', 'ReadyNAS', 'MikroTik', 'RouterBOARD', 'CloudKey', 'ThinkSystem', 'ThinkCentre', 'ThinkPad', 'TrueNAS', 'iDRAC', 'vSphere',
];

/**
 * Turns a stencil file name into a library name:
 * "Dell-PowerEdge-RackServers-Classic.vssx" → "Dell PowerEdge Rack Servers Classic".
 */
export function libraryNameFromFile(fileName: string) {
  const base = fileName
    .replace(/\.netcraft-stencils\.json$|\.netcraft\.json$/i, '')
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ');
  return base
    .split(/\s+/)
    .map((word) => {
      if (KEEP_WHOLE.some((k) => k.toLowerCase() === word.toLowerCase())) return word;
      // Split CamelCase ("RackServers" → "Rack Servers") but leave acronyms ("HPE", "R740xd") alone.
      return word.replace(/([a-z])([A-Z][a-z])/g, '$1 $2');
    })
    .join(' ')
    .trim();
}
