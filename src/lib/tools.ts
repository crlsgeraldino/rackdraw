/** Home → Tools drawing mode (Visio's Line and Pencil tools); null = the pointer tool. */
import { create } from 'zustand';

export type DrawTool = 'line' | 'pencil';

export const useTool = create<{ tool: DrawTool | null }>(() => ({ tool: null }));

export const setTool = (tool: DrawTool | null) => useTool.setState({ tool });
