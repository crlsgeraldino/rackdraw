'use client';

import { PX_PER_IN } from './pageSetup';
import { usePref, type Prefs } from './prefs';
import type { Page } from './types';

/** Measurement units for rulers, Size & Position and the status bar (Visio: Page Setup → measurement units). */
export type Units = 'in' | 'cm' | 'px';

/** The units in use: the preference, or for "Automatic", centimetres on A-size paper and inches otherwise. */
export function unitsFor(pref: Prefs['units'], page?: Page): Units {
  if (pref !== 'auto') return pref;
  return page?.setup?.paper === 'a4' || page?.setup?.paper === 'a3' ? 'cm' : 'in';
}

export const pxPerUnit = (u: Units) => (u === 'in' ? PX_PER_IN : u === 'cm' ? PX_PER_IN / 2.54 : 1);
export const toUnits = (px: number, u: Units) => px / pxPerUnit(u);
export const fromUnits = (v: number, u: Units) => v * pxPerUnit(u);
/** A length for display: "1.25 in", "3.2 cm" or "120". */
export const fmtLen = (px: number, u: Units) => (u === 'px' ? `${Math.round(px)}` : `${toUnits(px, u).toFixed(u === 'in' ? 2 : 1)} ${u}`);
/** A number for an input box, in the units (no unit name). */
export const fmtNum = (px: number, u: Units) => (u === 'px' ? `${Math.round(px)}` : `${+toUnits(px, u).toFixed(u === 'in' ? 2 : 1)}`);

export function useUnits(page?: Page): Units {
  return unitsFor(usePref('units'), page);
}
