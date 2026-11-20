/**
 * Commands the ribbon sends to parts of the window that own the state for them (the canvas owns the Find bar,
 * the Shapes window owns its import dialogs). Plain DOM events keep those components independent.
 */
export const FIND_EVENT = 'netcraft:find';
export const PALETTE_EVENT = 'netcraft:palette';

export type PaletteAction = 'import-image' | 'import-visio' | 'import-library' | 'export-all';

export const openFind = (replace = false) => window.dispatchEvent(new CustomEvent(FIND_EVENT, { detail: { replace } }));
export const paletteAction = (action: PaletteAction) => window.dispatchEvent(new CustomEvent(PALETTE_EVENT, { detail: action }));
