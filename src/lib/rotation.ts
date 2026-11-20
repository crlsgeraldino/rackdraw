/** Geometry for turned devices: the box a w×h drawing needs when turned by `deg` degrees. */

export const normDeg = (deg: number) => ((Math.round(deg) % 360) + 360) % 360;

export function turnedBox(w: number, h: number, deg: number) {
  const t = (deg * Math.PI) / 180;
  const c = Math.abs(Math.cos(t)), s = Math.abs(Math.sin(t));
  return { w: w * c + h * s, h: w * s + h * c };
}
