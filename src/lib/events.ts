/**
 * Commands the ribbon sends to parts of the window that own the state for them (the canvas owns the Find bar,
 * the Shapes window owns its import dialogs). Plain DOM events keep those components independent.
 */
export const FIND_EVENT = 'netcraft:find';
export const PALETTE_EVENT = 'netcraft:palette';

export type PaletteAction = 'import-image' | 'import-visio' | 'import-library' | 'export-all';

export const openFind = (replace = false) => window.dispatchEvent(new CustomEvent(FIND_EVENT, { detail: { replace } }));
export const paletteAction = (action: PaletteAction) => window.dispatchEvent(new CustomEvent(PALETTE_EVENT, { detail: action }));

/** F2 (Visio: edit text): the item id whose text to edit in place. */
export const EDIT_TEXT_EVENT = 'netcraft:edit-text';
/** Right-click → Save selection as picture: detail is 'png' or 'svg'. */
export const SAVE_SELECTION_EVENT = 'netcraft:save-selection';
/** F1: open the keyboard shortcuts list. */
export const SHORTCUTS_EVENT = 'netcraft:shortcuts';
/** Data → Port Map (or a device's "Port map" button): detail is the device id to show first, if any. */
export const PORT_MAP_EVENT = 'netcraft:port-map';
export const openPortMap = (nodeId?: string) => window.dispatchEvent(new CustomEvent(PORT_MAP_EVENT, { detail: nodeId }));
