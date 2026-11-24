export const TILE_W = 128;
export const TILE_H = 64;
export const HALF_W = TILE_W / 2;
export const HALF_H = TILE_H / 2;
export const PLAYER_SCALE = 1.5;
export const FOOT_Y = 111;

export const SPRITE_ROW = [4, 5, 6, 7, 0, 1, 2, 3];

export function isoX(x, y) {
  return (x - y) * HALF_W;
}

export function isoY(x, y) {
  return (x + y) * HALF_H;
}

export function tileAt(v) {
  return Math.floor(v + 0.5);
}

export function worldToScreen(x, y, cam, zoom, viewW, viewH) {
  return {
    x: (isoX(x, y) - cam.x) * zoom + viewW / 2,
    y: (isoY(x, y) - cam.y) * zoom + viewH / 2,
  };
}

export function screenToWorld(px, py, cam, zoom, viewW, viewH) {
  const sx = (px - viewW / 2) / zoom + cam.x;
  const sy = (py - viewH / 2) / zoom + cam.y;
  return {
    x: (sx / HALF_W + sy / HALF_H) / 2,
    y: (sy / HALF_H - sx / HALF_W) / 2,
  };
}

export function screenToIso(px, py, cam, zoom, viewW, viewH) {
  return {
    x: (px - viewW / 2) / zoom + cam.x,
    y: (py - viewH / 2) / zoom + cam.y,
  };
}

// Direction rows are ordered from the Flare sprite sheet:
// W, NW, N, NE, E, SE, S, SW.
export function screenVectorToRow(ix, iy) {
  const angle = Math.atan2(iy, ix);
  let index = Math.round(angle / (Math.PI / 4));
  index = ((index % 8) + 8) % 8;
  return SPRITE_ROW[index];
}

export function worldVectorToRow(dx, dy) {
  const sx = dx - dy;
  const sy = (dx + dy) * 0.5;
  if (sx === 0 && sy === 0) return 6;
  return screenVectorToRow(sx, sy);
}

export function screenVectorToWorld(ix, iy) {
  let dx = ix * 0.5 + iy;
  let dy = iy - ix * 0.5;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return { x: 0, y: 0 };
  dx /= len;
  dy /= len;
  return { x: dx, y: dy };
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function expSmooth(current, target, rate, dt) {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

export function dist2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

export function hash2(x, y, seed = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
