import { saveProgress } from "./api.js";
import {
  isoX,
  isoY,
  screenToWorld,
  screenVectorToWorld,
  expSmooth,
  clamp,
  dist2,
} from "./iso.js";

const PLAYER_RADIUS = 0.22;
const WALK_SPEED = 3.15;
const RUN_SPEED = 5.15;
const ARRIVE_EPS = 0.07;
const SAVE_INTERVAL = 18;

function directionIndex(ix, iy) {
  let index = Math.round(Math.atan2(iy, ix) / (Math.PI / 4));
  index = ((index % 8) + 8) % 8;
  return index;
}

class MinHeap {
  constructor() {
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  push(value, priority) {
    const a = this.items;
    a.push({ value, priority });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].priority <= a[i].priority) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }

  pop() {
    const a = this.items;
    if (a.length === 0) return null;
    const root = a[0];
    const last = a.pop();
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let best = i;
        if (l < a.length && a[l].priority < a[best].priority) best = l;
        if (r < a.length && a[r].priority < a[best].priority) best = r;
        if (best === i) break;
        [a[best], a[i]] = [a[i], a[best]];
        i = best;
      }
    }
    return root;
  }
}

export class Game {
  constructor({ world, save, audio, particles, profile }) {
    this.world = world;
    this.audio = audio;
    this.particles = particles;
    this.profile = profile;
    this.started = false;
    this.pauseReasons = new Set();
    this.time = 0;
    this.playTime = Number.isFinite(save?.playTime) ? Math.max(0, save.playTime) : 0;
    this.viewW = 1;
    this.viewH = 1;
    this.autoZoom = true;
    this.terrain = world.terrain.map((row) => {
      const arr = new Uint8Array(row.length);
      for (let i = 0; i < row.length; i++) arr[i] = row.charCodeAt(i) - 48;
      return arr;
    });
    this.blocked = world.blocked.map((row) => {
      const arr = new Uint8Array(row.length);
      for (let i = 0; i < row.length; i++) arr[i] = row.charCodeAt(i) === 49 ? 1 : 0;
      return arr;
    });
    this.totalWisps = world.wispTotal || world.wisps.length;
    const valid = new Set(world.wisps.map((w) => w.id));
    this.collected = new Set((save?.collected || []).filter((id) => valid.has(id)));
    this.beaconLit = Boolean(save?.beaconLit) && this.collected.size >= this.totalWisps;
    const spawn = world.spawn || { x: 32, y: 32 };
    const sx = Number.isFinite(save?.x) ? save.x : spawn.x;
    const sy = Number.isFinite(save?.y) ? save.y : spawn.y;
    const dir = Number.isFinite(save?.dir) ? clamp(save.dir | 0, 0, 7) : clamp(world.spawnDir | 0, 0, 7);
    const startX = this.canStand(sx, sy) ? sx : spawn.x;
    const startY = this.canStand(sx, sy) ? sy : spawn.y;
    this.player = {
      x: startX,
      y: startY,
      dir,
      moving: false,
      walkTime: 0,
      idleTime: 0,
      gather: 0,
    };

    const camX = isoX(startX, startY);
    const camY = isoY(startX, startY) - 30;
    this.camera = {
      x: camX,
      y: camY,
      zoom: 1,
      targetZoom: 1,
      initialized: false,
    };
    this.target = null;
    this.path = null;
    this.moveMarker = null;
    this.keys = new Set();
    this.joystick = { x: 0, y: 0 };
    this.lastPrompt = undefined;
    this.lastFootstep = 0;
    this.shake = 0;
    this.endingTimer = -1;
    this.endingShown = false;
    this.celebration = 0;
    this.ambientTimer = 0.4;
    this.wispParticleTimer = 0;
    this.brazierParticleTimer = 0;
    this.crackleTimer = 1.5;
    this.saveTimer = 0;
    this.saveDirty = false;
    this.saving = false;
    this.saveAgain = false;
    this.events = {
      hud: () => {},
      prompt: () => {},
      toast: () => {},
      dialog: () => {},
      ending: () => {},
      saved: () => {},
      error: () => {},
    };
  }

  get paused() {
    return !this.started || this.pauseReasons.size > 0;
  }

  start() {
    this.started = true;
    this.pauseReasons.clear();
    this._updateTarget();
    this._emitPrompt();
    this.events.hud(this);
  }

  pause(reason) {
    if (!reason) return;
    this.pauseReasons.add(reason);
    this.keys.clear();
    this.joystick.x = 0;
    this.joystick.y = 0;
    this._emitPrompt();
  }

  resume(reason) {
    if (reason) this.pauseReasons.delete(reason);
    else this.pauseReasons.clear();
    this._updateTarget();
    this._emitPrompt();
  }

  setViewport(w, h) {
    this.viewW = w;
    this.viewH = h;
    if (!this.camera.initialized) {
      this.camera.initialized = true;
      this.camera.x = isoX(this.player.x, this.player.y);
      this.camera.y = isoY(this.player.x, this.player.y) - 30;
      this.camera.zoom = this._defaultZoom(w, h);
      this.camera.targetZoom = this.camera.zoom;
      return;
    }
    if (this.autoZoom) {
      this.camera.targetZoom = this._defaultZoom(w, h);
    }
  }

  _defaultZoom(w, h) {
    if (w < 480) return 0.68;
    if (w < 760) return 0.76;
    if (w < 1020) return 0.88;
    if (h < 600) return 0.82;
    return 1.04;
  }

  zoomBy(delta) {
    this.autoZoom = false;
    this.camera.targetZoom = clamp(this.camera.targetZoom + delta, 0.58, 1.58);
  }

  zoomTo(value) {
    this.autoZoom = false;
    this.camera.targetZoom = clamp(value, 0.58, 1.58);
  }

  setKey(code, down) {
    if (down) {
      this.keys.add(code);
      if (this.path) this.path = null;
      this.moveMarker = null;
    } else {
      this.keys.delete(code);
    }
  }

  clearKeys() {
    this.keys.clear();
  }

  setJoystick(x, y) {
    this.joystick.x = clamp(x, -1, 1);
    this.joystick.y = clamp(y, -1, 1);
    if (Math.hypot(x, y) > 0.15) {
      this.path = null;
      this.moveMarker = null;
    }
  }

  canStand(x, y) {
    if (!this._walkableAt(x, y)) return false;
    const r = PLAYER_RADIUS;
    const probes = [
      [0, 0],
      [-r, 0],
      [r, 0],
      [0, -r],
      [0, r],
      [-r * 0.7, -r * 0.7],
      [r * 0.7, -r * 0.7],
      [-r * 0.7, r * 0.7],
      [r * 0.7, r * 0.7],
    ];
    for (const [dx, dy] of probes) {
      if (!this._walkableAt(x + dx, y + dy)) return false;
    }
    return true;
  }

  _walkableAt(x, y) {
    const tx = Math.floor(x + 0.5);
    const ty = Math.floor(y + 0.5);
    if (tx < 0 || ty < 0 || tx >= this.world.width || ty >= this.world.height) return false;
    return this.blocked[ty][tx] === 0;
  }

  _blockedTile(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= this.world.width || ty >= this.world.height) return true;
    return this.blocked[ty][tx] !== 0;
  }

  update(dt) {
    const step = Math.min(dt, 0.05);
    this.time += step;
    this.particles.update(step);
    this.shake = Math.max(0, this.shake - step * 2.1);

    if (this.moveMarker) {
      this.moveMarker.life -= step;
      if (this.moveMarker.life <= 0) this.moveMarker = null;
    }

    if (this.started && !this.paused) {
      this.playTime += step;
      this._updatePlayer(step);
      this._checkWisps();
      this._updateTarget();
      this._emitPrompt();
      this._updateAmbient(step);
      this._updateSaveTimer(step);
      this._updateEnding(step);
    } else {
      this.player.moving = false;
      this._updateAmbient(step * 0.5, true);
    }

    this._updateCamera(step);
  }

  _moveInput() {
    const k = this.keys;
    let ix = 0;
    let iy = 0;
    if (k.has("KeyA") || k.has("ArrowLeft")) ix -= 1;
    if (k.has("KeyD") || k.has("ArrowRight")) ix += 1;
    if (k.has("KeyW") || k.has("ArrowUp")) iy -= 1;
    if (k.has("KeyS") || k.has("ArrowDown")) iy += 1;
    ix += this.joystick.x;
    iy += this.joystick.y;
    const len = Math.hypot(ix, iy);
    if (len < 0.1) return { x: 0, y: 0, strength: 0 };
    if (len > 1) {
      ix /= len;
      iy /= len;
    }
    const run = k.has("ShiftLeft") || k.has("ShiftRight") || len > 0.94;
    return { x: ix, y: iy, strength: Math.min(1, len), run };
  }

  _updatePlayer(dt) {
    const p = this.player;
    if (p.gather > 0) {
      p.gather -= dt;
      p.moving = false;
      p.idleTime += dt;
      return;
    }

    const input = this._moveInput();
    if (input.strength > 0.1) {
      if (this.path) this.path = null;
      this._walkInScreenDirection(input.x, input.y, input.strength, input.run, dt);
      return;
    }
    if (this.path && this.path.length > 0) {
      this._followPath(dt);
      return;
    }
    p.moving = false;
    p.idleTime += dt;
    p.walkTime = 0;
    this._checkPlayerTile();
  }

  _walkInScreenDirection(ix, iy, strength, running, dt) {
    const dir = screenVectorToWorld(ix, iy);
    if (dir.x === 0 && dir.y === 0) return;
    const p = this.player;
    p.dir = directionIndex(ix, iy);
    const speed = (running ? RUN_SPEED : WALK_SPEED) * (0.55 + 0.45 * strength);
    const moved = this._movePlayer(dir.x * speed * dt, dir.y * speed * dt);
    if (moved > 0.0004) {
      p.moving = true;
      p.walkTime += dt;
      p.idleTime = 0;
      this._movementAudio(dt, running);
    } else {
      p.moving = false;
      p.idleTime += dt;
    }
  }

  _followPath(dt) {
    const p = this.player;
    let wp = this.path[0];
    while (wp && dist2(p.x, p.y, wp.x, wp.y) < ARRIVE_EPS * ARRIVE_EPS) {
      this.path.shift();
      wp = this.path[0];
    }
    if (!wp) {
      this.path = null;
      p.moving = false;
      return;
    }
    const dx = wp.x - p.x;
    const dy = wp.y - p.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-5) return;
    p.dir = directionIndex(dx - dy, (dx + dy) * 0.5);
    const step = Math.min(len, WALK_SPEED * dt);
    const moved = this._movePlayer((dx / len) * step, (dy / len) * step);
    if (moved < step * 0.2) {
      this.path = null;
      this.player.moving = false;
      return;
    }
    p.moving = true;
    p.walkTime += dt;
    p.idleTime = 0;
    this._movementAudio(dt, false);
  }

  _movePlayer(dx, dy) {
    const p = this.player;
    const startX = p.x;
    const startY = p.y;
    const dist = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(dist / 0.09));
    const sx = dx / steps;
    const sy = dy / steps;
    for (let i = 0; i < steps; i++) {
      if (this.canStand(p.x + sx, p.y)) p.x += sx;
      else if (Math.abs(sx) > 0.0001) this.path = null;
      if (this.canStand(p.x, p.y + sy)) p.y += sy;
      else if (Math.abs(sy) > 0.0001) this.path = null;
    }
    return Math.hypot(p.x - startX, p.y - startY);
  }

  _checkPlayerTile() {
    if (!this.canStand(this.player.x, this.player.y)) {
      this.player.x = this.world.spawn.x;
      this.player.y = this.world.spawn.y;
    }
  }

  _movementAudio(dt, running) {
    const p = this.player;
    if (p.walkTime - this.lastFootstep > (running ? 0.23 : 0.34)) {
      this.lastFootstep = p.walkTime;
      this.audio.footstep(running);
      if (Math.random() < 0.62) {
        this.particles.dust(p.x, p.y, running ? 5 : 3, running ? 1.2 : 0.85);
      }
    }
    this.saveDirty = true;
  }

  _checkWisps() {
    for (const w of this.world.wisps) {
      if (this.collected.has(w.id)) continue;
      if (dist2(this.player.x, this.player.y, w.x, w.y) > 1.32 * 1.32) continue;
      this.collected.add(w.id);
      const index = this.collected.size - 1;
      this.audio.chime(index);
      this.particles.burst(w.x, w.y, 30, "gold");
      this.particles.embers(w.x, w.y, 12, 0.55);
      this.saveDirty = true;
      this.events.hud(this);
      if (this.collected.size >= this.totalWisps) {
        this.events.toast("All five embers are gathered. Return to the cold brazier.", "gold");
        this.audio.chime(4);
      } else {
        this.events.toast(`Ember wisp gathered — ${this.collected.size} of ${this.totalWisps}.`);
      }
    }
  }

  _findTarget() {
    let best = null;
    let bestD = Infinity;
    for (const item of this.world.interactables) {
      const d = dist2(this.player.x, this.player.y, item.x, item.y);
      const reach = Math.max(1.2, item.r || 2.2);
      if (d <= reach * reach && d < bestD) {
        best = item;
        bestD = d;
      }
    }
    return best;
  }

  _updateTarget() {
    if (this.paused) {
      this.target = null;
      return;
    }
    this.target = this._findTarget();
  }

  _promptLabel(target) {
    if (!target) return "";
    if (target.kind === "brazier") {
      if (this.beaconLit) return "Examine the burning beacon";
      if (this.collected.size >= this.totalWisps) return "Kindle the beacon";
      return "Examine the cold brazier";
    }
    return `Examine ${target.name}`;
  }

  _emitPrompt() {
    const label = this.target ? this._promptLabel(this.target) : "";
    if (label === this.lastPrompt) return;
    this.lastPrompt = label;
    this.events.prompt(label, this.target);
  }

  interact() {
    if (!this.started || this.paused) return;
    this._updateTarget();
    const target = this.target;
    if (!target) {
      this.audio.ui();
      return;
    }
    this.player.gather = 0.7;
    this._faceToward(target.x, target.y);
    this.audio.ui();
    if (target.kind === "brazier" && this.collected.size >= this.totalWisps && !this.beaconLit) {
      this.lightBeacon();
      return;
    }
    let text = target.text;
    if (target.kind === "brazier") {
      if (this.beaconLit) {
        text = "Warmth rolls across the square. The flame is small but steady, and the vale feels awake again.";
      } else {
        text += ` ${this.collected.size} of ${this.totalWisps} ember wisps have found their way back.`;
      }
    }
    const kicker = target.kind === "building" ? "A door in the vale"
      : target.kind === "pond" ? "Still water"
        : target.kind === "tree" ? "An old landmark"
          : "The heart of the village";
    this.events.dialog({ kicker, title: target.name, text });
  }

  _faceToward(x, y) {
    const dx = x - this.player.x;
    const dy = y - this.player.y;
    if (Math.abs(dx) + Math.abs(dy) < 1e-5) return;
    this.player.dir = directionIndex(dx - dy, (dx + dy) * 0.5);
  }

  lightBeacon() {
    if (this.beaconLit) return;
    const brazier = this.world.interactables.find((i) => i.kind === "brazier");
    this.beaconLit = true;
    this.shake = 1;
    this.celebration = 4.2;
    this.endingTimer = 3.1;
    this.saveDirty = true;
    this.audio.beacon();
    if (brazier) {
      this.particles.burst(brazier.x, brazier.y, 65, "gold");
      this.particles.embers(brazier.x, brazier.y, 20, 0.5);
    }
    this.events.hud(this);
    this.events.toast("The beacon catches. Ember light spills across the square.", "gold");
    this._save(false);
  }

  _updateAmbient(dt, quiet = false) {
    this.ambientTimer -= dt;
    this.wispParticleTimer -= dt;
    this.brazierParticleTimer -= dt;
    this.crackleTimer -= dt;

    if (this.ambientTimer <= 0) {
      this.ambientTimer = 0.45 + Math.random() * 0.7;
      if (!quiet && Math.random() < 0.72) {
        const trees = this.world.props.filter((p) => p.kind === "tree");
        for (let attempt = 0; attempt < 5; attempt++) {
          const t = trees[Math.floor(Math.random() * trees.length)];
          if (!t) break;
          if (dist2(t.x, t.y, this.player.x, this.player.y) < 18 * 18) {
            this.particles.leaf(t.x, t.y);
            break;
          }
        }
      }
    }

    if (this.wispParticleTimer <= 0) {
      this.wispParticleTimer = 0.34;
      for (const w of this.world.wisps) {
        if (this.collected.has(w.id)) continue;
        if (dist2(w.x, w.y, this.player.x, this.player.y) < 16 * 16 && Math.random() < 0.8) {
          this.particles.embers(w.x, w.y, 1, 0.18);
        }
      }
    }

    const brazier = this.world.interactables.find((i) => i.kind === "brazier");
    if (brazier) {
      const near = dist2(brazier.x, brazier.y, this.player.x, this.player.y) < 9 * 9;
      if (this.beaconLit && this.brazierParticleTimer <= 0) {
        this.brazierParticleTimer = 0.07;
        const n = near ? 3 : 1;
        this.particles.embers(brazier.x, brazier.y, n, 0.28);
        if (near) this.particles.embers(brazier.x, brazier.y, 1, 0.9);
      }
      if (this.beaconLit && near && this.crackleTimer <= 0) {
        this.crackleTimer = 0.35 + Math.random() * 0.8;
        this.audio.crackle();
      }
    }

    if (this.celebration > 0) {
      this.celebration -= dt;
      if (Math.random() < dt * 18 && brazier) {
        this.particles.embers(brazier.x, brazier.y, 4, 0.7);
      }
    }
  }

  _updateSaveTimer(dt) {
    this.saveTimer += dt;
    if (this.saveTimer >= SAVE_INTERVAL || (this.saveDirty && this.saveTimer >= 3.2)) {
      this.saveTimer = 0;
      if (this.saveDirty) this._save(false);
    }
  }

  async _save(keepalive = false) {
    if (!this.started) return null;
    if (this.saving) {
      this.saveAgain = true;
      return null;
    }
    this.saving = true;
    this.saveDirty = false;
    const state = {
      x: Math.round(this.player.x * 1000) / 1000,
      y: Math.round(this.player.y * 1000) / 1000,
      dir: this.player.dir,
      collected: Array.from(this.collected),
      beaconLit: this.beaconLit,
      playTime: Math.round(this.playTime * 10) / 10,
    };
    try {
      const save = await saveProgress(this.profile, state, { keepalive });
      if (!keepalive) this.events.saved(save);
      return save;
    } catch {
      this.saveDirty = true;
      if (!keepalive) this.events.error("The vale could not be saved just now.");
      return null;
    } finally {
      this.saving = false;
      if (this.saveAgain) {
        this.saveAgain = false;
        this.saveDirty = true;
      }
    }
  }

  save(keepalive = false) {
    return this._save(keepalive);
  }

  _updateEnding(dt) {
    if (this.endingTimer < 0) return;
    this.endingTimer -= dt;
    if (this.endingTimer <= 0 && !this.endingShown) {
      this.endingShown = true;
      this.endingTimer = -1;
      this.events.ending(this.playTime);
    }
  }

  _updateCamera(dt) {
    const targetX = isoX(this.player.x, this.player.y);
    const targetY = isoY(this.player.x, this.player.y) - 30;
    this.camera.zoom = expSmooth(this.camera.zoom, this.camera.targetZoom, 8, dt);
    this.camera.x = expSmooth(this.camera.x, targetX, 5.6, dt);
    this.camera.y = expSmooth(this.camera.y, targetY, 5.6, dt);
  }

  nearestWalkableTile(tx, ty, maxRadius = 5) {
    tx = Math.round(tx);
    ty = Math.round(ty);
    if (!this._blockedTile(tx, ty)) return { x: tx, y: ty };
    for (let r = 1; r <= maxRadius; r++) {
      let best = null;
      let bestD = Infinity;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx = tx + dx;
          const ny = ty + dy;
          if (this._blockedTile(nx, ny)) continue;
          const d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            best = { x: nx, y: ny };
          }
        }
      }
      if (best) return best;
    }
    return null;
  }

  requestMoveTo(px, py) {
    if (!this.started || this.paused) return;
    const worldPos = screenToWorld(px, py, this.camera, this.camera.zoom, this.viewW, this.viewH);
    const target = this.nearestWalkableTile(worldPos.x, worldPos.y, 6);
    if (!target) return;
    if (dist2(this.player.x, this.player.y, target.x, target.y) < 0.5) return;
    const path = this._findPath(target.x, target.y);
    if (!path || path.length === 0) {
      this.path = [{ x: target.x, y: target.y }];
    } else {
      this.path = this._smoothPath(path);
    }
    this.moveMarker = { x: target.x, y: target.y, life: 0.9, max: 0.9 };
    this.audio.ui();
  }

  _findPath(tx, ty) {
    const W = this.world.width;
    const H = this.world.height;
    const sx = Math.floor(this.player.x + 0.5);
    const sy = Math.floor(this.player.y + 0.5);
    if (this._blockedTile(sx, sy) || this._blockedTile(tx, ty)) return null;
    if (sx === tx && sy === ty) return [];
    const size = W * H;
    const start = sy * W + sx;
    const goal = ty * W + tx;
    const g = new Float32Array(size);
    g.fill(Infinity);
    const from = new Int32Array(size);
    from.fill(-1);
    const closed = new Uint8Array(size);
    g[start] = 0;
    const open = new MinHeap();
    const h = (x, y) => {
      const dx = Math.abs(x - tx);
      const dy = Math.abs(y - ty);
      return Math.max(dx, dy) + 0.41421356 * Math.min(dx, dy);
    };
    open.push(start, h(sx, sy));
    let guard = 0;
    while (open.size > 0 && guard++ < 16000) {
      const current = open.pop();
      if (!current) break;
      const ci = current.value;
      if (closed[ci]) continue;
      if (ci === goal) break;
      closed[ci] = 1;
      const cx = ci % W;
      const cy = (ci / W) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (this._blockedTile(nx, ny)) continue;
          if (dx !== 0 && dy !== 0) {
            if (this._blockedTile(cx + dx, cy) || this._blockedTile(cx, cy + dy)) continue;
          }
          const ni = ny * W + nx;
          if (closed[ni]) continue;
          const cost = dx !== 0 && dy !== 0 ? 1.41421356 : 1;
          const tentative = g[ci] + cost;
          if (tentative < g[ni]) {
            g[ni] = tentative;
            from[ni] = ci;
            open.push(ni, tentative + h(nx, ny));
          }
        }
      }
    }
    if (from[goal] === -1) return null;
    const raw = [];
    let node = goal;
    let guard2 = 0;
    while (node !== start && guard2++ < size) {
      raw.push({ x: node % W, y: (node / W) | 0 });
      node = from[node];
    }
    raw.reverse();
    return raw;
  }

  _smoothPath(path) {
    if (path.length <= 1) return path;
    const out = [];
    let anchorX = this.player.x;
    let anchorY = this.player.y;
    let i = 0;
    while (i < path.length) {
      let best = i;
      for (let j = path.length - 1; j > i; j--) {
        if (this._lineClear(anchorX, anchorY, path[j].x, path[j].y)) {
          best = j;
          break;
        }
      }
      out.push(path[best]);
      anchorX = path[best].x;
      anchorY = path[best].y;
      i = best + 1;
    }
    return out;
  }

  _lineClear(ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(len / 0.22));
    for (let i = 0; i <= steps; i++) {
      if (!this.canStand(ax + (dx * i) / steps, ay + (dy * i) / steps)) return false;
    }
    return true;
  }

  setPaused(paused, reason = "external") {
    if (paused) this.pause(reason);
    else this.resume(reason);
  }
}
