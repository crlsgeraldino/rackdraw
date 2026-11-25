import { unzipSync, type Unzipped } from 'fflate';

/*
 * Unzipping files from anywhere: a few megabytes of ZIP can claim to hold gigabytes ("zip bomb") and stop the app.
 * The sizes the ZIP declares are checked before anything is decompressed — fflate never writes more than the declared
 * size, so the check also caps the memory used.
 */

export class ZipTooLargeError extends Error {
  constructor() { super('This file is too large to open (it would unpack to more than RackDraw can hold).'); }
}

export interface ZipLimits {
  /** Most bytes all chosen entries may unpack to. */
  maxTotal: number;
  /** Most bytes one entry may unpack to (default: maxTotal). */
  maxEntry?: number;
  /** Most entries in the ZIP (default 20,000). */
  maxEntries?: number;
}

/** unzipSync with size limits; `only` picks the entries to unpack (default: all). Throws ZipTooLargeError. */
export function unzipLimited(bytes: Uint8Array, limits: ZipLimits, only?: (name: string) => boolean): Unzipped {
  const maxEntry = limits.maxEntry ?? limits.maxTotal;
  const maxEntries = limits.maxEntries ?? 20_000;
  let total = 0;
  let entries = 0;
  return unzipSync(bytes, {
    filter: (f) => {
      if (++entries > maxEntries) throw new ZipTooLargeError();
      if (only && !only(f.name)) return false;
      if (f.originalSize > maxEntry) throw new ZipTooLargeError();
      total += f.originalSize;
      if (total > limits.maxTotal) throw new ZipTooLargeError();
      return true;
    },
  });
}

const MB = 1024 * 1024;
/** A client file with its pictures. */
export const RACKDRAW_LIMITS: ZipLimits = { maxTotal: 768 * MB, maxEntries: 50_000 };
/** A spreadsheet's sheets and strings. */
export const XLSX_LIMITS: ZipLimits = { maxTotal: 256 * MB };
/** One part of a Visio file (a page, a master, a picture). */
export const VISIO_PART_LIMITS: ZipLimits = { maxTotal: 256 * MB };
