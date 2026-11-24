import { image } from "./assets.js";
import {
  TILE_W,
  TILE_H,
  HALF_W,
  HALF_H,
  PLAYER_SCALE,
  FOOT_Y,
  SPRITE_ROW,
  isoX,
  isoY,
  screenToWorld,
  clamp,
  hash2,
} from "./iso.js";

const TERRAIN_ROW = [0, 2, 3, 4, 5];
const GRASS_TOP = 0;
const FOREST_CODE = 4;
const FLOWER_COLORS = [
  ["249, 242, 217", "242, 210, 125"],
  ["247, 216, 131", "255, 242, 194"],
  ["176, 198, 238", "227, 237, 255"],
  ["232, 178, 186", "255, 231, 226"],
];

function phaseOf(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000 * Math.PI * 2;
}

function easeOut(t) {
  return 1 - Math.pow(1 - t, 3);
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
    this.dpr = 1;
    this.viewW = 1;
    this.viewH = 1;
    this.time = 0;
    this.terrain = null;
    this.world = null;
    this.zoom = 1;
    this.cam = { x: 0, y: 0 };
    this._glows = new Map();
    this.shadowSprite = this._makeShadow();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(280, Math.round(rect.width || window.innerWidth));
    const h = Math.max(240, Math.round(rect.height || window.innerHeight));
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
    if (this.viewW !== w || this.viewH !== h || this.dpr !== dpr) {
      this.viewW = w;
      this.viewH = h;
      this.dpr = dpr;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    return { w, h };
  }

  _makeShadow() {
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 64;
    const g = c.getContext("2d");
    g.save();
    g.translate(64, 32);
    g.scale(1, 0.5);
    const grad = g.createRadialGradient(0, 0, 1, 0, 0, 60);
    grad.addColorStop(0, "rgba(0, 0, 0, 0.6)");
    grad.addColorStop(0.55, "rgba(0, 0, 0, 0.32)");
    grad.addColorStop(1, "rgba(0, 0, 0, 0)");
    g.fillStyle = grad;
    g.beginPath();
    g.arc(0, 0, 60, 0, Math.PI * 2);
    g.fill();
    g.restore();
    return c;
  }

  _prepare(world) {
    if (this.world === world) return;
    this.world = world;
    this.terrain = world.terrain.map((row) => {
      const arr = new Uint8Array(row.length);
      for (let i = 0; i < row.length; i++) arr[i] = row.charCodeAt(i) - 48;
      return arr;
    });
  }

  _sx(x, y) {
    return (isoX(x, y) - this.cam.x) * this.zoom + this.viewW / 2;
  }

  _sy(x, y) {
    return (isoY(x, y) - this.cam.y) * this.zoom + this.viewH / 2;
  }

  _onScreen(x, y, margin = 180) {
    return x > -margin && x < this.viewW + margin && y > -margin && y < this.viewH + margin;
  }

  _shadow(x, y, rx, ry, alpha = 0.45) {
    if (rx <= 0 || ry <= 0) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(this.shadowSprite, x - rx, y - ry, rx * 2, ry * 2);
    ctx.restore();
  }

  _glowSprite(color) {
    let c = this._glows.get(color);
    if (c) return c;
    c = document.createElement("canvas");
    c.width = 128;
    c.height = 128;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(64, 64, 1, 64, 64, 63);
    grad.addColorStop(0, `rgba(${color}, 0.9)`);
    grad.addColorStop(0.24, `rgba(${color}, 0.42)`);
    grad.addColorStop(0.6, `rgba(${color}, 0.1)`);
    grad.addColorStop(1, `rgba(${color}, 0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    this._glows.set(color, c);
    return c;
  }

  _glow(x, y, radius, color, alpha = 1) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = alpha;
    ctx.drawImage(this._glowSprite(color), x - radius, y - radius, radius * 2, radius * 2);
    ctx.restore();
  }

  draw(game) {
    const ctx = this.ctx;
    this._prepare(game.world);
    this.time = game.time;
    this.zoom = game.camera.zoom;

    let shakeX = 0;
    let shakeY = 0;
    if (game.shake > 0) {
      const s = game.shake * game.shake;
      shakeX = Math.sin(this.time * 83) * 9 * s;
      shakeY = Math.cos(this.time * 67) * 5 * s;
    }
    this.cam.x = game.camera.x + shakeX;
    this.cam.y = game.camera.y + shakeY;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    const bg = ctx.createLinearGradient(0, 0, 0, this.viewH);
    bg.addColorStop(0, "#0a160f");
    bg.addColorStop(0.55, "#08110c");
    bg.addColorStop(1, "#050b08");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, this.viewW, this.viewH);

    const range = this._groundRange();
    this._drawGround(range);
    this._drawGroundDetails(range);
    this._drawGroundMarks(game);
    this._drawWorldObjects(game);
    game.particles.draw(ctx, this.cam, this.zoom, this.viewW, this.viewH);
    this._drawLights(game);
    this._drawObjective(game);
  }

  _groundRange() {
    const corners = [
      screenToWorld(0, 0, this.cam, this.zoom, this.viewW, this.viewH),
      screenToWorld(this.viewW, 0, this.cam, this.zoom, this.viewW, this.viewH),
      screenToWorld(0, this.viewH, this.cam, this.zoom, this.viewW, this.viewH),
      screenToWorld(this.viewW, this.viewH, this.cam, this.zoom, this.viewW, this.viewH),
    ];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of corners) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    const x0 = Math.max(-20, Math.floor(minX) - 3);
    const y0 = Math.max(-20, Math.floor(minY) - 3);
    const x1 = Math.min(this.world.width + 19, Math.ceil(maxX) + 3);
    const y1 = Math.min(this.world.height + 19, Math.ceil(maxY) + 3);
    return { x0, y0, x1, y1 };
  }

  _tileAt(x, y) {
    if (x < 0 || y < 0 || x >= this.world.width || y >= this.world.height) return FOREST_CODE;
    return this.terrain[y][x];
  }

  _drawGround({ x0, y0, x1, y1 }) {
    const ctx = this.ctx;
    const atlas = image("groundAtlas");
    if (!atlas) return;
    const z = this.zoom;
    const seed = this.world.seed || 1;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const code = this._tileAt(x, y);
        const h = hash2(x, y, code * 37 + (seed & 0xffff));
        let row = TERRAIN_ROW[code] || 5;
        if (code === GRASS_TOP) row = h > 0.45 ? 0 : 1;
        const col = Math.floor(hash2(y, x, code + 19) * 8);
        const sx = this._sx(x, y);
        const sy = this._sy(x, y);
        if (!this._onScreen(sx, sy, 90)) continue;
        ctx.drawImage(
          atlas,
          col * TILE_W,
          row * TILE_H,
          TILE_W,
          TILE_H,
          sx - HALF_W * z,
          sy - HALF_H * z,
          TILE_W * z,
          TILE_H * z
        );
      }
    }
  }

  _drawGroundDetails({ x0, y0, x1, y1 }) {
    const ctx = this.ctx;
    const z = this.zoom;
    ctx.save();
    ctx.lineCap = "round";
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const code = this._tileAt(x, y);
        const h = hash2(x, y, 7919);
        if (h < 0.62) continue;
        if (code !== GRASS_TOP && code !== FOREST_CODE) {
          if (h > 0.9) {
            const sx = this._sx(x, y);
            const sy = this._sy(x, y);
            if (!this._onScreen(sx, sy, 40)) continue;
            ctx.fillStyle = code === 2 ? "rgba(185, 187, 171, 0.26)" : "rgba(100, 86, 62, 0.24)";
            ctx.beginPath();
            ctx.arc(sx + (hash2(x, y, 41) - 0.5) * 42 * z, sy + (hash2(x, y, 42) - 0.5) * 18 * z, 1.3 * z, 0, Math.PI * 2);
            ctx.fill();
          }
          continue;
        }
        const sx = this._sx(x, y);
        const sy = this._sy(x, y);
        if (!this._onScreen(sx, sy, 40)) continue;
        const u = (hash2(x, y, 101) - 0.5) * 0.68;
        const v = (hash2(x, y, 103) - 0.5) * 0.68;
        const px = sx + (u - v) * HALF_W * z;
        const py = sy + (u + v) * HALF_H * z;
        const blades = 2 + Math.floor(hash2(x, y, 107) * 3);
        for (let i = 0; i < blades; i++) {
          const a = hash2(x * 9 + i, y * 7, 109);
          const bx = px + (a - 0.5) * 18 * z;
          const by = py + (hash2(x, y + i, 113) - 0.5) * 8 * z;
          const bh = (3 + a * 4.5) * z;
          ctx.strokeStyle = code === FOREST_CODE
            ? `rgba(${68 + a * 16}, ${86 + a * 22}, ${46 + a * 10}, 0.34)`
            : `rgba(${76 + a * 30}, ${109 + a * 32}, ${49 + a * 10}, 0.32)`;
          ctx.lineWidth = Math.max(0.7, 0.9 * z);
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.quadraticCurveTo(bx + (a - 0.5) * 3 * z, by - bh * 0.55, bx + (a - 0.5) * 5 * z, by - bh);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  _drawGroundMarks(game) {
    const ctx = this.ctx;
    const z = this.zoom;
    const target = game.target;
    if (target) {
      const sx = this._sx(target.x, target.y);
      const sy = this._sy(target.x, target.y);
      ctx.save();
      ctx.strokeStyle = `rgba(244, 211, 146, ${0.35 + Math.sin(this.time * 2.4) * 0.11})`;
      ctx.lineWidth = Math.max(1, 1.3 * z);
      ctx.setLineDash([5 * z, 7 * z]);
      ctx.lineDashOffset = -this.time * 13 * z;
      ctx.beginPath();
      ctx.ellipse(sx, sy, 34 * z, 17 * z, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    const marker = game.moveMarker;
    if (marker && marker.life > 0) {
      const t = 1 - marker.life / marker.max;
      const sx = this._sx(marker.x, marker.y);
      const sy = this._sy(marker.x, marker.y);
      const r = (18 + t * 16) * z;
      ctx.save();
      ctx.strokeStyle = `rgba(244, 211, 146, ${0.42 * (1 - t)})`;
      ctx.lineWidth = Math.max(1, 1.5 * z);
      ctx.beginPath();
      ctx.ellipse(sx, sy, r, r * 0.48, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  _drawWorldObjects(game) {
    const items = [];
    for (const b of game.world.buildings) {
      items.push({ kind: "building", depth: b.x + b.y + 0.25, data: b });
    }
    for (const p of game.world.props) {
      items.push({ kind: "prop", depth: p.x + p.y + (p.kind === "pond" ? -0.05 : 0), data: p });
    }
    const brazier = game.world.interactables.find((i) => i.kind === "brazier");
    if (brazier) items.push({ kind: "brazier", depth: brazier.x + brazier.y + 0.1, data: brazier });
    for (const w of game.world.wisps) {
      if (!game.collected.has(w.id)) items.push({ kind: "wisp", depth: w.x + w.y + 0.15, data: w });
    }
    items.push({ kind: "player", depth: game.player.x + game.player.y + 0.05, data: game.player });

    items.sort((a, b) => a.depth - b.depth);
    for (const item of items) {
      if (item.kind === "building") this._drawBuilding(item.data);
      else if (item.kind === "prop") this._drawProp(item.data);
      else if (item.kind === "brazier") this._drawBrazier(item.data, game.beaconLit);
      else if (item.kind === "wisp") this._drawWisp(item.data, game);
      else if (item.kind === "player") this._drawPlayer(game);
    }
  }

  _drawProp(p) {
    switch (p.kind) {
      case "pond":
        this._drawPond(p);
        break;
      case "tree":
        this._drawTree(p);
        break;
      case "bush":
        this._drawBush(p);
        break;
      case "rock":
        this._drawRock(p);
        break;
      case "reeds":
        this._drawReeds(p);
        break;
      case "flowers":
        this._drawFlowers(p);
        break;
      case "mushroom":
        this._drawMushroom(p);
        break;
      default:
        break;
    }
  }

  _drawTree(p) {
    const img = image(p.art);
    if (!img) return;
    const z = this.zoom;
    const s = (p.scale || 1.3) * z;
    const sx = this._sx(p.x, p.y);
    const sy = this._sy(p.x, p.y) + 3 * z;
    const w = img.width * s;
    const h = img.height * s;
    if (!this._onScreen(sx, sy - h * 0.5, w * 0.8 + 80)) return;
    this._shadow(sx, sy + 1 * z, Math.min(w * 0.34, 132 * z), Math.min(w * 0.14, 54 * z), 0.5);
    const phase = hash2(Math.round(p.x * 13), Math.round(p.y * 17), 7) * Math.PI * 2;
    const sway = Math.sin(this.time * 0.52 + phase) * 0.0065;
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(sway);
    if (p.flip) ctx.scale(-1, 1);
    ctx.drawImage(img, -w / 2, -h, w, h);
    ctx.restore();
  }

  _drawBush(p) {
    const img = image(p.art);
    if (!img) return;
    const z = this.zoom;
    const s = (p.scale || 1.2) * z;
    const sx = this._sx(p.x, p.y);
    const sy = this._sy(p.x, p.y) + 2 * z;
    const w = img.width * s;
    const h = img.height * s;
    if (!this._onScreen(sx, sy - h * 0.4, w * 0.6 + 30)) return;
    this._shadow(sx, sy, w * 0.42, w * 0.17, 0.42);
    const phase = hash2(Math.round(p.x * 21), Math.round(p.y * 11), 3) * Math.PI * 2;
    const sway = Math.sin(this.time * 0.7 + phase) * 0.009;
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(sway);
    if (p.flip) ctx.scale(-1, 1);
    ctx.drawImage(img, -w / 2, -h, w, h);
    ctx.restore();
  }

  _drawRock(p) {
    const z = this.zoom;
    const sx = this._sx(p.x, p.y);
    const sy = this._sy(p.x, p.y);
    if (!this._onScreen(sx, sy, 50)) return;
    const s = (p.scale || 1) * z;
    const seed = hash2(Math.round(p.x * 10), Math.round(p.y * 10), 5);
    this._shadow(sx, sy + 1 * z, 23 * s, 10 * s, 0.4);
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(s, s);
    const rocks = seed > 0.55 ? 2 : 1;
    for (let i = 0; i < rocks; i++) {
      const ox = i === 0 ? 0 : 13 + seed * 8;
      const oy = i === 0 ? -7 : -3;
      const rw = i === 0 ? 17 : 9;
      const rh = i === 0 ? 13 : 7;
      ctx.fillStyle = i === 0 ? "#596258" : "#4a5148";
      ctx.beginPath();
      ctx.moveTo(ox - rw, oy + 2);
      ctx.lineTo(ox - rw * 0.62, oy - rh * 0.72);
      ctx.lineTo(ox + rw * 0.15, oy - rh);
      ctx.lineTo(ox + rw * 0.82, oy - rh * 0.36);
      ctx.lineTo(ox + rw, oy + 2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(170, 178, 153, 0.33)";
      ctx.beginPath();
      ctx.ellipse(ox - rw * 0.24, oy - rh * 0.52, rw * 0.45, rh * 0.22, -0.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(17, 26, 17, 0.25)";
      ctx.beginPath();
      ctx.ellipse(ox + rw * 0.26, oy + 1, rw * 0.55, rh * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  _drawReeds(p) {
    const z = this.zoom;
    const sx = this._sx(p.x, p.y);
    const sy = this._sy(p.x, p.y);
    if (!this._onScreen(sx, sy, 50)) return;
    const s = (p.scale || 1) * z;
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(s, s);
    ctx.lineCap = "round";
    for (let i = 0; i < 7; i++) {
      const h1 = hash2(Math.round(p.x * 17), Math.round(p.y * 17), i + 3);
      const x = (h1 - 0.5) * 26;
      const h = 17 + h1 * 22;
      const lean = (hash2(i, Math.round(p.y * 5), 8) - 0.5) * 12;
      ctx.strokeStyle = i % 2 ? "rgba(89, 119, 65, 0.82)" : "rgba(108, 134, 76, 0.82)";
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(x, 2);
      ctx.quadraticCurveTo(x + lean * 0.3, -h * 0.55, x + lean, -h);
      ctx.stroke();
      if (i % 3 === 0) {
        ctx.fillStyle = "#8a6c3e";
        ctx.beginPath();
        ctx.ellipse(x + lean, -h, 1.9, 4.5, -0.25, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  _drawFlowers(p) {
    const z = this.zoom;
    const sx = this._sx(p.x, p.y);
    const sy = this._sy(p.x, p.y);
    if (!this._onScreen(sx, sy, 25)) return;
    const ctx = this.ctx;
    const s = (p.scale || 0.9) * z;
    const colors = FLOWER_COLORS[(p.variant || 0) % FLOWER_COLORS.length];
    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(s, s);
    for (let i = 0; i < 5; i++) {
      const a = hash2(Math.round(p.x * 31) + i, Math.round(p.y * 23), 13);
      const b = hash2(i, Math.round(p.x * 5) + Math.round(p.y * 7), 17);
      const fx = (a - 0.5) * 24;
      const fy = (b - 0.5) * 10;
      const h = 5 + a * 7;
      ctx.strokeStyle = "rgba(70, 105, 52, 0.8)";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(fx + (a - 0.5) * 2, fy - h);
      ctx.stroke();
      const px = fx + (a - 0.5) * 2;
      const py = fy - h;
      ctx.fillStyle = `rgba(${colors[0]}, 0.92)`;
      for (let petal = 0; petal < 5; petal++) {
        const ang = (petal / 5) * Math.PI * 2 + a * 2;
        ctx.beginPath();
        ctx.arc(px + Math.cos(ang) * 1.7, py + Math.sin(ang) * 1.2, 1.25, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = `rgba(${colors[1]}, 0.95)`;
      ctx.beginPath();
      ctx.arc(px, py, 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  _drawMushroom(p) {
    const z = this.zoom;
    const sx = this._sx(p.x, p.y);
    const sy = this._sy(p.x, p.y);
    if (!this._onScreen(sx, sy, 25)) return;
    const s = (p.scale || 1) * z;
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(s, s);
    for (let i = 0; i < 3; i++) {
      const a = hash2(Math.round(p.x * 7) + i, Math.round(p.y * 9), 11);
      const x = (a - 0.5) * 12;
      const y = (hash2(i, Math.round(p.x * 3), 9) - 0.5) * 5;
      const h = 4 + a * 5;
      ctx.strokeStyle = "rgba(204, 192, 158, 0.92)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - h);
      ctx.stroke();
      ctx.fillStyle = i === 1 ? "#b36d3f" : "#8f4a32";
      ctx.beginPath();
      ctx.ellipse(x, y - h, 2.6, 1.55, 0, Math.PI, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(240, 216, 171, 0.55)";
      ctx.beginPath();
      ctx.arc(x - 0.8, y - h - 0.1, 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  _drawPond(p) {
    const img = image("pond");
    if (!img) return;
    const z = this.zoom;
    const sx = this._sx(p.x, p.y);
    const sy = this._sy(p.x, p.y);
    const s = (p.scale || 1.9) * z;
    const w = img.width * s;
    const h = img.height * s;
    if (!this._onScreen(sx, sy, w * 0.6 + 60)) return;
    const ctx = this.ctx;
    ctx.drawImage(img, sx - w / 2, sy - h / 2 + 3 * z, w, h);

    ctx.save();
    ctx.translate(sx, sy + 4 * z);
    ctx.beginPath();
    ctx.ellipse(0, 0, w * 0.38, h * 0.34, 0, 0, Math.PI * 2);
    ctx.clip();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 7; i++) {
      const drift = (this.time * (0.018 + i * 0.002) + i * 0.17) % 1;
      const x = (-0.34 + drift * 0.68) * w;
      const y = (hash2(i, 7, 11) - 0.5) * h * 0.44 + Math.sin(this.time * 0.8 + i) * 3 * z;
      const len = (24 + hash2(i, 3, 9) * 52) * z;
      ctx.strokeStyle = `rgba(178, 205, 177, ${0.05 + (i % 3) * 0.025})`;
      ctx.lineWidth = (0.7 + (i % 2) * 0.5) * z;
      ctx.beginPath();
      ctx.moveTo(x - len * 0.5, y);
      ctx.quadraticCurveTo(x, y - 2 * z, x + len * 0.5, y);
      ctx.stroke();
    }
    ctx.restore();

    // Lily pads gather at the quieter edges of the water.
    ctx.save();
    ctx.translate(sx, sy + 5 * z);
    for (let i = 0; i < 4; i++) {
      const a = hash2(i, 31, 3);
      const bx = (hash2(i, 17, 5) - 0.5) * w * 0.52;
      const by = (hash2(i, 29, 7) - 0.5) * h * 0.36;
      const r = (6 + a * 4) * z;
      ctx.fillStyle = i % 2 ? "rgba(50, 91, 49, 0.85)" : "rgba(63, 104, 55, 0.82)";
      ctx.beginPath();
      ctx.ellipse(bx, by, r, r * 0.52, a * 2, 0.28, Math.PI * 2);
      ctx.lineTo(bx, by);
      ctx.fill();
      ctx.strokeStyle = "rgba(135, 158, 106, 0.28)";
      ctx.lineWidth = 0.7 * z;
      ctx.stroke();
    }
    ctx.restore();

    // Dragonflies stitching bright lines above the reeds.
    for (let i = 0; i < 2; i++) {
      const t = this.time * (0.42 + i * 0.11) + i * 2.2;
      const dx = Math.cos(t) * w * 0.26;
      const dy = Math.sin(t * 1.7) * h * 0.18 - 26 * z;
      const px = sx + dx;
      const py = sy + dy;
      const wing = (3.6 + Math.sin(this.time * 18 + i) * 1.1) * z;
      ctx.strokeStyle = i === 0 ? "rgba(176, 223, 213, 0.42)" : "rgba(216, 203, 138, 0.34)";
      ctx.lineWidth = 0.9 * z;
      ctx.beginPath();
      ctx.moveTo(px - 3 * z, py);
      ctx.lineTo(px + 3 * z, py);
      ctx.moveTo(px - 1.6 * z, py);
      ctx.lineTo(px - 4.5 * z, py - wing);
      ctx.moveTo(px + 1.6 * z, py);
      ctx.lineTo(px + 4.5 * z, py - wing);
      ctx.stroke();
    }
  }

  _drawBuilding(b) {
    const img = image(b.art);
    if (!img) return;
    const z = this.zoom;
    const sx = this._sx(b.x, b.y);
    const sy = this._sy(b.x, b.y);
    const w = img.width * b.scale * z;
    const h = img.height * b.scale * z;
    const baseY = sy + ((b.w + b.h) * HALF_H) / 2 - 5 * z;
    const left = sx - w / 2;
    const top = baseY - h;
    if (!this._onScreen(sx, top + h * 0.5, w * 0.75 + 100)) return;
    this._shadow(sx, sy + 16 * z, w * 0.45, h * 0.17, 0.38);
    const ctx = this.ctx;
    ctx.drawImage(img, left, top, w, h);
    this._drawSmoke(b, left, top, w, h);
  }

  _drawSmoke(b, left, top, w, h) {
    if (b.art === "blacksmith" && this.time % 1 > 0.5) return;
    const ctx = this.ctx;
    const z = this.zoom;
    const x = left + w * 0.24;
    const y = top + h * 0.055;
    ctx.save();
    for (let i = 0; i < 4; i++) {
      const t = (this.time * 0.065 + i * 0.24 + b.x * 0.03) % 1;
      const drift = Math.sin(this.time * 0.55 + i * 1.7) * 9 * z;
      const px = x + drift + t * 7 * z;
      const py = y - t * 54 * z;
      const r = (3.5 + t * 8) * z;
      const alpha = Math.sin(t * Math.PI) * 0.095;
      ctx.fillStyle = `rgba(217, 218, 202, ${alpha})`;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  _drawBrazier(interactable, lit) {
    const z = this.zoom;
    const sx = this._sx(interactable.x, interactable.y);
    const sy = this._sy(interactable.x, interactable.y);
    if (!this._onScreen(sx, sy, 110)) return;
    const ctx = this.ctx;
    this._shadow(sx, sy + 2 * z, 40 * z, 17 * z, 0.5);
    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(z, z);

    // Stone ring.
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2;
      const px = Math.cos(a) * 32;
      const py = Math.sin(a) * 13 + 1;
      const rw = 7.2 + (i % 3);
      const rh = 4.6;
      ctx.fillStyle = i % 2 ? "#686b60" : "#797a69";
      ctx.beginPath();
      ctx.ellipse(px, py, rw, rh, a * 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(184, 177, 144, 0.22)";
      ctx.beginPath();
      ctx.ellipse(px - 1, py - 1.6, rw * 0.55, rh * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Iron legs and bowl.
    ctx.strokeStyle = "#2d2f2a";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    for (const dx of [-19, 0, 19]) {
      ctx.beginPath();
      ctx.moveTo(dx * 0.65, -29);
      ctx.lineTo(dx, -4);
      ctx.stroke();
    }
    ctx.fillStyle = "#343731";
    ctx.beginPath();
    ctx.ellipse(0, -30, 26, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#161916";
    ctx.beginPath();
    ctx.ellipse(0, -31, 20, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#87836e";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(0, -30, 26, 10, 0, 0, Math.PI * 2);
    ctx.stroke();

    if (lit) {
      const flick = Math.sin(this.time * 13) * 3 + Math.sin(this.time * 23.7) * 1.6;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = "rgba(255, 124, 41, 0.24)";
      ctx.beginPath();
      ctx.ellipse(0, -24, 30 + flick, 18, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      const flame = (ox, oy, size, color) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(ox, oy + 4);
        ctx.bezierCurveTo(ox - size * 0.7, oy - size * 0.2, ox - size * 0.25, oy - size, ox + flick * 0.25, oy - size * 1.3);
        ctx.bezierCurveTo(ox + size * 0.55, oy - size * 0.55, ox + size * 0.72, oy - size * 0.1, ox, oy + 4);
        ctx.fill();
      };
      flame(0, -36, 18, "rgba(232, 96, 28, 0.92)");
      flame(-2, -36, 12, "rgba(255, 159, 48, 0.95)");
      flame(2, -35, 7, "rgba(255, 228, 148, 0.96)");
      ctx.fillStyle = "rgba(255, 244, 192, 0.95)";
      ctx.beginPath();
      ctx.ellipse(0, -34, 4.5, 6 + flick * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = "rgba(126, 124, 110, 0.85)";
      ctx.beginPath();
      ctx.ellipse(0, -31.5, 14, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(183, 185, 170, 0.12)";
      ctx.lineWidth = 1.6;
      for (let i = 0; i < 2; i++) {
        const t = this.time * 0.22 + i * 1.9;
        const px = Math.sin(t) * 5;
        ctx.beginPath();
        ctx.moveTo(px, -38);
        ctx.bezierCurveTo(px - 5, -50, px + 7, -54, px + 1, -68);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  _drawWisp(w, game) {
    const z = this.zoom;
    const sx = this._sx(w.x, w.y);
    const sy = this._sy(w.x, w.y);
    if (!this._onScreen(sx, sy, 90)) return;
    const phase = phaseOf(w.id);
    const bob = Math.sin(this.time * 1.8 + phase) * 6 * z;
    const px = sx + Math.sin(this.time * 0.7 + phase) * 4 * z;
    const py = sy - 44 * z + bob;
    const ctx = this.ctx;
    const pulse = 0.82 + Math.sin(this.time * 2.7 + phase) * 0.18;

    ctx.save();
    ctx.strokeStyle = "rgba(255, 216, 139, 0.16)";
    ctx.lineWidth = 1 * z;
    ctx.beginPath();
    ctx.ellipse(sx, sy, 18 * z, 8 * z, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    this._glow(px, py, 35 * z * pulse, "255, 166, 76", 0.75);
    this._glow(px, py, 13 * z, "255, 228, 156", 0.9);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = "rgba(255, 239, 188, 0.98)";
    ctx.beginPath();
    ctx.arc(px, py, 3.2 * z, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 3; i++) {
      const t = this.time * (0.9 + i * 0.2) + phase + i * 2.1;
      const orbit = (8 + i * 2.3) * z;
      const ox = px + Math.cos(t) * orbit;
      const oy = py + Math.sin(t * 1.35) * orbit * 0.52;
      ctx.fillStyle = `rgba(255, ${188 + i * 18}, ${108 + i * 20}, ${0.72 - i * 0.14})`;
      ctx.beginPath();
      ctx.arc(ox, oy, (1.4 - i * 0.17) * z, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  _drawPlayer(game) {
    const img = image("player");
    if (!img) return;
    const p = game.player;
    const z = this.zoom;
    const sx = this._sx(p.x, p.y);
    const sy = this._sy(p.x, p.y);
    const s = PLAYER_SCALE * z;
    const w = 128 * s;
    const h = 128 * s;
    const moving = p.moving;
    let far = false;
    if (!this._onScreen(sx, sy - h * 0.45, w * 0.7 + 50)) far = true;
    if (far) return;

    this._shadow(sx, sy + 2 * z, 23 * z, 10 * z, 0.5);

    let frame;
    if (p.gather > 0) {
      frame = 12 + Math.floor(this.time * 12) % 4;
    } else if (moving) {
      frame = 4 + Math.floor(p.walkTime * 11) % 8;
    } else {
      frame = Math.floor(p.idleTime * 2.4) % 4;
    }
    const row = SPRITE_ROW[clamp(p.dir | 0, 0, 7)];
    const bob = moving ? Math.sin(p.walkTime * 22) * 1.1 * z : Math.sin(this.time * 1.8 + 1.2) * 0.35 * z;
    const ctx = this.ctx;
    ctx.save();
    ctx.drawImage(
      img,
      frame * 128,
      row * 128,
      128,
      128,
      sx - w / 2,
      sy - FOOT_Y * s + bob,
      w,
      h
    );
    ctx.restore();
  }

  _drawLights(game) {
    const ctx = this.ctx;
    const z = this.zoom;
    const brazier = game.world.interactables.find((i) => i.kind === "brazier");
    if (brazier && game.beaconLit) {
      const sx = this._sx(brazier.x, brazier.y);
      const sy = this._sy(brazier.x, brazier.y) - 26 * z;
      const pulse = 1 + Math.sin(this.time * 3.7) * 0.035;
      this._glow(sx, sy, 150 * z * pulse, "255, 148, 52", 0.43);
      this._glow(sx, sy, 72 * z, "255, 203, 106", 0.32);
    }
    // A cool, low mist that gathers beyond the village paths.
    const grad = ctx.createLinearGradient(0, this.viewH * 0.55, 0, this.viewH);
    grad.addColorStop(0, "rgba(72, 115, 88, 0)");
    grad.addColorStop(1, "rgba(31, 68, 48, 0.075)");
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = grad;
    ctx.fillRect(0, this.viewH * 0.55, this.viewW, this.viewH * 0.45);
    ctx.restore();
  }

  _drawObjective(game) {
    if (game.beaconLit) return;
    if (game.collected.size < (game.world.wispTotal || 5)) return;
    const brazier = game.world.interactables.find((i) => i.kind === "brazier");
    if (!brazier) return;
    const z = this.zoom;
    const sx = this._sx(brazier.x, brazier.y);
    const sy = this._sy(brazier.x, brazier.y);
    const bob = Math.sin(this.time * 2.2) * 5 * z;
    const py = sy - 102 * z + bob;
    const ctx = this.ctx;
    this._glow(sx, py, 42 * z, "255, 191, 92", 0.48);
    ctx.save();
    ctx.translate(sx, py);
    ctx.rotate(Math.PI / 4 + Math.sin(this.time * 0.8) * 0.05);
    ctx.strokeStyle = "rgba(255, 226, 164, 0.9)";
    ctx.fillStyle = "rgba(255, 190, 82, 0.24)";
    ctx.lineWidth = Math.max(1, 1.2 * z);
    const r = 7 * z;
    ctx.beginPath();
    ctx.rect(-r, -r, r * 2, r * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    this._glow(sx, py, 8 * z, "255, 237, 185", 0.9);
    const t = 1 - easeOut(clamp((game.time % 2.6) / 2.6, 0, 1));
    ctx.save();
    ctx.strokeStyle = `rgba(255, 210, 130, ${t * 0.24})`;
    ctx.lineWidth = 1 * z;
    ctx.beginPath();
    ctx.ellipse(sx, sy, (30 + (1 - t) * 34) * z, (15 + (1 - t) * 17) * z, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}
