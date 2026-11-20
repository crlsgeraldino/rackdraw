'use client';

import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { DEFAULT_LIBRARY } from './libraries';
import { IconArt, PanelArt } from './stencils';
import type { StencilDef } from './types';

const uid = () => Math.random().toString(36).slice(2, 10);

/**
 * Makes an editable copy of a built-in shape (like Visio's Edit Master on a built-in master): its drawing becomes
 * an SVG image, its ports carry over with the same ids (so cables stay plugged in), and it goes to "My stencils".
 */
export function editableCopy(stencil: StencilDef): StencilDef {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-30000px;top:0;';
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() =>
      root.render(
        stencil.style === 'icon'
          ? createElement(IconArt, { id: stencil.id, size: stencil.width })
          : createElement(PanelArt, { stencil, portStates: {}, width: stencil.width, height: stencil.height }),
      ),
    );
    const svg = host.querySelector('svg');
    if (!svg) throw new Error('Could not draw this shape.');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('width', String(stencil.width));
    svg.setAttribute('height', String(stencil.height));
    const markup = new XMLSerializer().serializeToString(svg);
    return {
      ...stencil,
      id: `custom-${uid()}`,
      name: stencil.name,
      custom: true,
      library: DEFAULT_LIBRARY,
      style: 'image',
      image: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`,
      // Icons are drawn at 1:1; panels keep their scale.
      scale: stencil.style === 'icon' ? 1 : stencil.scale,
      ports: stencil.ports.map((p) => ({ ...p })),
    };
  } finally {
    root.unmount();
    host.remove();
  }
}
