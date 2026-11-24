import { isoX, isoY } from "./iso.js";

function rnd(min, max) {
  return min + Math.random() * (max - min);
}

export class ParticleSystem {
  constructor() {
    this.items = [];
    this.max = 420;
  }

  add(p) {
    if (this.items.length >= this.max) this.items.shift();
    this.items.push(p);
  }

  dust(x, y, count = 4, strength = 1) {
    for (let i = 0; i < count; i++) {
      this.add({
        kind: "dust",
        x: x + rnd(-0.18, 0.18),
        y: y + rnd(-0.18, 0.18),
        z: rnd(0, 3),
        vx: rnd(-0.22, 0.22) * strength,
        vy: rnd(-0.22, 0.22) * strength,
        vz: rnd(2, 7),
        gravity: -5,
        drag: 1.8,
        life: 0,
        max: rnd(0.45, 0.8),
        size: rnd(1.4, 3.2) * strength,
        color: "150, 143, 112",
        add: false,
        alpha: 0.28,
      });
    }
  }

  burst(x, y, count = 18, palette = "gold") {
    const colors = palette === "green" ? ["160, 220, 120", "210, 240, 160", "110, 180, 90"] : ["255, 208, 132", "255, 173, 74", "255, 238, 184"];
    for (let i = 0; i < count; i++) {
      const angle = rnd(0, Math.PI * 2);
      const speed = rnd(0.25, 1.35);
      this.add({
        kind: "spark",
        x,
        y,
        z: rnd(18, 36),
        vx: Math.cos(angle) * speed * 0.6,
        vy: Math.sin(angle) * speed * 0.25,
        vz: rnd(8, 45),
        gravity: -20,
        drag: 1.1,
        life: 0,
        max: rnd(0.6, 1.4),
        size: rnd(1.3, 3.7),
        color: colors[Math.floor(Math.random() * colors.length)],
        add: true,
        alpha: 0.9,
      });
    }
    for (let i = 0; i < 3; i++) {
      this.add({
        kind: "ring",
        x,
        y,
        z: 20,
        vx: 0,
        vy: 0,
        vz: 0,
        gravity: 0,
        life: 0,
        max: 0.7 + i * 0.12,
        size: 6 + i * 2,
        color: "255, 218, 151",
        add: true,
        alpha: 0.5,
      });
    }
  }

  embers(x, y, count = 3, spread = 0.55) {
    for (let i = 0; i < count; i++) {
      this.add({
        kind: "ember",
        x: x + rnd(-spread, spread),
        y: y + rnd(-spread, spread),
        z: rnd(16, 45),
        vx: rnd(-0.1, 0.1),
        vy: rnd(-0.1, 0.1),
        vz: rnd(12, 28),
        gravity: 3,
        drag: 0.25,
        life: 0,
        max: rnd(1.6, 3.6),
        size: rnd(1.0, 2.4),
        color: Math.random() < 0.5 ? "255, 154, 59" : "255, 206, 120",
        add: true,
        alpha: 0.9,
        wobble: rnd(1.2, 3.2),
        phase: rnd(0, Math.PI * 2),
      });
    }
  }

  leaf(x, y) {
    this.add({
      kind: "leaf",
      x,
      y,
      z: rnd(55, 110),
      vx: rnd(-0.2, 0.35),
      vy: rnd(-0.05, 0.2),
      vz: rnd(-8, -3),
      gravity: 4,
      drag: 0.4,
      life: 0,
      max: rnd(3.5, 6),
      size: rnd(1.6, 2.8),
      color: Math.random() < 0.5 ? "103, 145, 72" : "150, 154, 79",
      add: false,
      alpha: 0.5,
      wobble: rnd(1.6, 3.4),
      phase: rnd(0, Math.PI * 2),
    });
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i];
      p.life += dt;
      if (p.life >= p.max) {
        this.items.splice(i, 1);
        continue;
      }
      const drag = Math.exp(-p.drag * dt);
      p.vx *= drag;
      p.vy *= drag;
      p.vz -= p.gravity * dt;
      if (p.kind === "ember" || p.kind === "leaf") {
        p.x += (p.vx + Math.sin(p.life * p.wobble + p.phase) * 0.06) * dt;
        p.y += (p.vy + Math.cos(p.life * p.wobble * 0.7 + p.phase) * 0.04) * dt;
      } else {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      p.z += p.vz * dt;
      if (p.z < 0) {
        p.z = 0;
        p.vz *= -0.18;
      }
    }
  }

  draw(ctx, cam, zoom, viewW, viewH) {
    const scale = Math.min(2, zoom);
    for (const p of this.items) {
      const sx = (isoX(p.x, p.y) - cam.x) * zoom + viewW / 2;
      const sy = (isoY(p.x, p.y) - cam.y) * zoom + viewH / 2 - p.z * zoom;
      if (sx < -40 || sx > viewW + 40 || sy < -60 || sy > viewH + 40) continue;
      const t = p.life / p.max;
      const fade = t < 0.12 ? t / 0.12 : 1 - (t - 0.12) / 0.88;
      const alpha = Math.max(0, p.alpha * fade);
      if (p.kind === "ring") {
        ctx.globalCompositeOperation = "lighter";
        ctx.strokeStyle = `rgba(${p.color}, ${alpha * 0.55})`;
        ctx.lineWidth = 1.2 * zoom;
        ctx.beginPath();
        ctx.ellipse(sx, sy, (p.size + t * 32) * scale, (p.size + t * 32) * scale * 0.45, 0, 0, Math.PI * 2);
        ctx.stroke();
        continue;
      }
      if (p.add) ctx.globalCompositeOperation = "lighter";
      else ctx.globalCompositeOperation = "source-over";
      if (p.kind === "spark" || p.kind === "ember") {
        const s = p.size * scale * (1 - t * 0.3);
        ctx.fillStyle = `rgba(${p.color}, ${alpha * 0.23})`;
        ctx.beginPath();
        ctx.arc(sx, sy, s * 2.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(${p.color}, ${alpha})`;
        ctx.beginPath();
        ctx.arc(sx, sy, s, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === "leaf") {
        ctx.fillStyle = `rgba(${p.color}, ${alpha})`;
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(p.life * 1.4 + p.phase);
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size * scale, p.size * scale * 0.45, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else {
        ctx.fillStyle = `rgba(${p.color}, ${alpha})`;
        ctx.beginPath();
        ctx.arc(sx, sy, p.size * scale, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = "source-over";
  }
}
