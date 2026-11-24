'use client';

/**
 * File → Back up everything / Restore from backup: one file with every client, the custom stencils, your templates,
 * Version History and your price book, so the whole workspace can be kept safe or moved to another computer.
 */
import { downloadBlob } from './export';
import { getPref, setPref } from './prefs';
import { snapshotVersions, useDiagram, type StoredVersions } from '@/store/useDiagramStore';
import type { Project, StencilDef } from './types';
import type { Template } from './templates';

export interface BackupFile {
  format: 'rackdraw-backup';
  version: 1;
  createdAt: number;
  projects: Record<string, Project>;
  customStencils: Record<string, StencilDef>;
  templates: Record<string, Template>;
  versions?: StoredVersions;
  prefs?: { priceBook?: Record<string, number>; favorites?: string[] };
}

export async function downloadBackup() {
  const s = useDiagram.getState();
  await s.loadVersions();
  const b: BackupFile = {
    format: 'rackdraw-backup',
    version: 1,
    createdAt: Date.now(),
    projects: s.projects,
    customStencils: s.customStencils,
    templates: s.templates,
    versions: snapshotVersions(),
    prefs: { priceBook: getPref('priceBook'), favorites: getPref('favorites') },
  };
  const day = new Date().toISOString().slice(0, 10);
  downloadBlob(`rackdraw-backup-${day}.json`, new Blob([JSON.stringify(b)], { type: 'application/json' }));
  return Object.keys(b.projects).length;
}

export async function readBackup(file: File): Promise<BackupFile> {
  let j: unknown;
  try {
    j = JSON.parse(await file.text());
  } catch {
    throw new Error('That file is not a RackDraw backup (it could not be read).');
  }
  const b = j as BackupFile;
  if (b?.format !== 'rackdraw-backup') throw new Error('That file is not a RackDraw backup. To open one client, use File → Open.');
  if (b.version > 1) throw new Error('This backup was made by a newer version of RackDraw. Update RackDraw, then restore it.');
  if (!b.projects || typeof b.projects !== 'object') throw new Error('This backup has no clients in it.');
  return b;
}

/** Adds everything in the backup; clients already here are kept, and a client with the same id comes in as a copy. */
export async function restoreBackup(b: BackupFile) {
  await useDiagram.getState().loadVersions();
  const result = useDiagram.getState().restoreBackup(b);
  if (b.prefs?.priceBook && typeof b.prefs.priceBook === 'object') {
    const prices = Object.fromEntries(Object.entries(b.prefs.priceBook).filter(([, v]) => typeof v === 'number' && Number.isFinite(v) && v >= 0));
    setPref('priceBook', { ...prices, ...getPref('priceBook') });
  }
  if (Array.isArray(b.prefs?.favorites)) setPref('favorites', [...new Set([...getPref('favorites'), ...b.prefs.favorites.filter((x): x is string => typeof x === 'string')])]);
  return result;
}
