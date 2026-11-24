import { screenToWorld } from "./iso.js";

const $ = (id) => document.getElementById(id);

const TERRAIN_MINI = ["#48663b", "#92734f", "#7b8277", "#b6a371", "#202f1c"];

function formatTime(seconds) {
  const mins = Math.floor((seconds || 0) / 60);
  if (mins < 1) return "less than a minute";
  if (mins === 1) return "1 minute";
  return `${mins} minutes`;
}

function visible(el) {
  return el && !el.classList.contains("is-hidden");
}

export class UI {
  constructor({ audio, onEnter, onReset }) {
    this.audio = audio;
    this.onEnter = onEnter;
    this.onReset = onReset;
    this.game = null;
    this.world = null;
    this.enterError = false;
    this.enterPending = false;
    this.dialogState = null;
    this.creditsOrigin = "title";
    this.helpOrigin = "game";
    this.lastMinimap = 0;
    this.lastFocus = null;
    this.pointers = new Map();
    this.pinch = null;
    this.joyPointer = null;
    this.prevWisps = -1;

    this.app = $("app");
    this.canvas = $("game");
    this.hud = $("hud");
    this.titleScreen = $("titleScreen");
    this.enterBtn = $("enterBtn");
    this.enterLabel = $("enterLabel");
    this.loadStatus = $("loadStatus");
    this.saveStatus = $("saveStatus");
    this.titleCredits = $("titleCredits");
    this.soundBtn = $("soundBtn");
    this.helpBtn = $("helpBtn");
    this.fullscreenBtn = $("fullscreenBtn");
    this.menuBtn = $("menuBtn");
    this.quest = $("quest");
    this.questTitle = $("questTitle");
    this.questText = $("questText");
    this.wispTrack = Array.from($("wispTrack").children);
    this.wispCount = $("wispCount");
    this.locationTime = document.querySelector(".location-time");
    this.minimap = $("minimap");
    this.zoomOut = $("zoomOut");
    this.zoomIn = $("zoomIn");
    this.controlsHint = $("controlsHint");
    this.interactPrompt = $("interactPrompt");
    this.promptText = $("promptText");
    this.toastStack = $("toastStack");
    this.joystick = $("joystick");
    this.joystickKnob = $("joystickKnob");
    this.actionBtn = $("actionBtn");

    this.dialogLayer = $("dialogLayer");
    this.dialogKicker = $("dialogKicker");
    this.dialogTitle = $("dialogTitle");
    this.dialogText = $("dialogText");
    this.dialogClose = $("dialogClose");
    this.dialogCancel = $("dialogCancel");

    this.menuLayer = $("menuLayer");
    this.resumeBtn = $("resumeBtn");
    this.menuHelpBtn = $("menuHelpBtn");
    this.menuCreditsBtn = $("menuCreditsBtn");
    this.resetBtn = $("resetBtn");
    this.menuPlace = $("menuPlace");
    this.menuTime = $("menuTime");

    this.creditsLayer = $("creditsLayer");
    this.creditsClose = $("creditsClose");
    this.endingLayer = $("endingLayer");
    this.endingTime = $("endingTime");
    this.keepExploring = $("keepExploring");
    this.endingMenu = $("endingMenu");
    this.helpLayer = $("helpLayer");
    this.helpClose = $("helpClose");
    this.loadingVeil = $("loadingVeil");

    this._bind();
    this.setSoundState(audio.enabled);
    this.actionBtn.classList.add("dim");
    if (!document.fullscreenEnabled) this.fullscreenBtn.classList.add("is-hidden");
  }

  attachGame(game) {
    this.game = game;
    this.world = game.world;
    game.events.hud = (g) => this.updateHUD(g);
    game.events.prompt = (label) => this.setPrompt(label);
    game.events.toast = (text, kind) => this.toast(text, kind);
    game.events.dialog = (dialog) => this.showDialog(dialog);
    game.events.ending = (playTime) => this.showEnding(playTime);
    game.events.error = (message) => this.toast(message);
    game.events.saved = () => {
      if (this.saveStatus && !this.game.started) this.saveStatus.textContent = "Progress saved";
    };
    this.updateHUD(game);
  }

  _bind() {
    this.enterBtn.addEventListener("click", () => this._handleEnter());
    this.titleCredits.addEventListener("click", () => this.showCredits("title"));
    this.creditsClose.addEventListener("click", () => this.hideCredits());
    this.soundBtn.addEventListener("click", () => this._toggleSound());
    this.helpBtn.addEventListener("click", () => this.showHelp("game"));
    this.fullscreenBtn.addEventListener("click", () => this._toggleFullscreen());
    this.menuBtn.addEventListener("click", () => this.openMenu());
    this.resumeBtn.addEventListener("click", () => this.closeMenu());
    this.menuHelpBtn.addEventListener("click", () => this.showHelp("menu"));
    this.menuCreditsBtn.addEventListener("click", () => this.showCredits("menu"));
    this.resetBtn.addEventListener("click", () => this._confirmReset());
    this.helpClose.addEventListener("click", () => this.hideHelp());
    this.keepExploring.addEventListener("click", () => this._closeEnding());
    this.endingMenu.addEventListener("click", () => {
      this._closeEnding();
      this.openMenu();
    });
    this.dialogClose.addEventListener("click", () => this._closeDialog(false));
    this.dialogCancel.addEventListener("click", () => this._closeDialog(true));
    this.dialogLayer.addEventListener("click", (e) => {
      if (e.target === this.dialogLayer) this._closeDialog(true);
    });
    this.zoomOut.addEventListener("click", () => this.game?.zoomBy(-0.1));
    this.zoomIn.addEventListener("click", () => this.game?.zoomBy(0.1));
    this.interactPrompt.addEventListener("click", () => this.game?.interact());
    this.actionBtn.addEventListener("click", () => this.game?.interact());

    window.addEventListener("keydown", (e) => this._onKeyDown(e));
    window.addEventListener("keyup", (e) => this._onKeyUp(e));
    window.addEventListener("blur", () => {
      this.game?.clearKeys();
      this._resetJoystick();
    });
    document.addEventListener("fullscreenchange", () => {
      this.fullscreenBtn.setAttribute("aria-label", document.fullscreenElement ? "Leave fullscreen" : "Enter fullscreen");
    });

    this._bindCanvas();
    this._bindJoystick();
  }

  _bindCanvas() {
    const canvas = this.canvas;
    canvas.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, start: performance.now() });
      if (this.pointers.size === 2) {
        const [a, b] = Array.from(this.pointers.values());
        this.pinch = {
          distance: Math.hypot(a.x - b.x, a.y - b.y),
          zoom: this.game?.camera.zoom || 1,
        };
      }
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* pointer capture is a progressive enhancement */
      }
    });
    canvas.addEventListener("pointermove", (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX;
      p.y = e.clientY;
      if (this.pointers.size === 2 && this.pinch && this.game) {
        const [a, b] = Array.from(this.pointers.values());
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        const next = this.pinch.zoom + (distance - this.pinch.distance) * 0.0035;
        this.game.zoomTo(next);
      }
    });
    const release = (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const wasPinch = this.pointers.size > 1;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      if (wasPinch) return;
      const dist = Math.hypot(p.x - p.startX, p.y - p.startY);
      const elapsed = performance.now() - p.start;
      if (dist < 9 && elapsed < 700 && !this.game?.paused) {
        const rect = this.canvas.getBoundingClientRect();
        this.game.requestMoveTo(p.x - rect.left, p.y - rect.top);
      }
    };
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", release);
    canvas.addEventListener(
      "wheel",
      (e) => {
        if (!this.game || this.game.paused) return;
        e.preventDefault();
        this.game.zoomBy(e.deltaY > 0 ? -0.075 : 0.075);
      },
      { passive: false }
    );
  }

  _bindJoystick() {
    const start = (e) => {
      if (!this.game || this.game.paused) return;
      e.preventDefault();
      this.joyPointer = e.pointerId;
      try {
        this.joystick.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      this._moveJoystick(e);
    };
    const move = (e) => {
      if (e.pointerId !== this.joyPointer) return;
      e.preventDefault();
      this._moveJoystick(e);
    };
    const end = (e) => {
      if (e.pointerId !== this.joyPointer) return;
      this._resetJoystick();
    };
    this.joystick.addEventListener("pointerdown", start);
    this.joystick.addEventListener("pointermove", move);
    this.joystick.addEventListener("pointerup", end);
    this.joystick.addEventListener("pointercancel", end);
    this.joystick.addEventListener("lostpointercapture", end);
    window.addEventListener("pointerup", (e) => {
      if (e.pointerId === this.joyPointer) this._resetJoystick();
    });
  }

  _moveJoystick(e) {
    const rect = this.joystick.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const limit = rect.width * 0.3;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > limit) {
      dx = (dx / dist) * limit;
      dy = (dy / dist) * limit;
    }
    const nx = dx / limit;
    const ny = dy / limit;
    this.joystickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
    this.game?.setJoystick(nx, ny);
  }

  _resetJoystick() {
    this.joyPointer = null;
    this.joystickKnob.style.transform = "translate(0px, 0px)";
    this.game?.setJoystick(0, 0);
  }

  _onKeyDown(e) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target?.isContentEditable) return;
    const game = this.game;
    const escape = e.code === "Escape";
    const movement = [
      "KeyW", "KeyA", "KeyS", "KeyD",
      "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
      "ShiftLeft", "ShiftRight",
    ].includes(e.code);

    if (escape) {
      e.preventDefault();
      this._handleEscape();
      return;
    }

    if (!game || !game.started) {
      if (e.code === "Enter" || e.code === "Space") {
        if (!this.enterBtn.disabled && !visible(this.creditsLayer)) {
          e.preventDefault();
          this._handleEnter();
        }
      }
      return;
    }

    if (movement) {
      if (!game.paused && !this._overlayOpen()) {
        game.setKey(e.code, true);
        e.preventDefault();
      }
      return;
    }

    if (this._overlayOpen()) return;

    if (e.code === "KeyE" || e.code === "Enter") {
      if (!game.paused) {
        e.preventDefault();
        game.interact();
      }
      return;
    }
    if (e.code === "KeyH" || e.key === "?") {
      e.preventDefault();
      this.showHelp("game");
      return;
    }
    if (e.code === "KeyM") {
      e.preventDefault();
      this.openMenu();
    }
  }

  _onKeyUp(e) {
    if (!this.game) return;
    this.game.setKey(e.code, false);
  }

  _overlayOpen() {
    return (
      visible(this.dialogLayer) ||
      visible(this.menuLayer) ||
      visible(this.creditsLayer) ||
      visible(this.helpLayer) ||
      visible(this.endingLayer)
    );
  }

  _handleEscape() {
    if (visible(this.creditsLayer)) {
      this.hideCredits();
      return;
    }
    if (visible(this.helpLayer)) {
      this.hideHelp();
      return;
    }
    if (visible(this.dialogLayer)) {
      this._closeDialog(true);
      return;
    }
    if (visible(this.endingLayer)) {
      this._closeEnding();
      return;
    }
    if (visible(this.menuLayer)) {
      this.closeMenu();
      return;
    }
    if (this.game?.started) {
      this.openMenu();
    }
  }

  async _handleEnter() {
    if (this.enterError) {
      location.reload();
      return;
    }
    if (this.enterPending || this.enterBtn.disabled) return;
    this.enterPending = true;
    this.enterBtn.disabled = true;
    this.enterLabel.textContent = "Entering the vale…";
    try {
      await this.onEnter?.();
    } finally {
      this.enterPending = false;
      this.enterBtn.disabled = false;
    }
  }

  setProgress(progress) {
    const pct = Math.max(0, Math.min(100, Math.round(progress * 100)));
    if (!this.enterPending) this.loadStatus.textContent = `Gathering the vale · ${pct}%`;
  }

  setReady(save) {
    this.enterBtn.disabled = false;
    this.enterLabel.textContent = save ? "Continue the journey" : "Enter the vale";
    this.loadStatus.textContent = "The vale is ready.";
    if (save) {
      const n = Array.isArray(save.collected) ? save.collected.length : 0;
      const mins = Math.floor((save.playTime || 0) / 60);
      if (save.beaconLit) {
        this.saveStatus.textContent = `Beacon lit · ${mins > 0 ? `${mins} min` : "returning"} in the vale`;
      } else {
        this.saveStatus.textContent = `${n}/5 embers · ${mins > 0 ? `${mins} min` : "new wanderer"}`;
      }
    } else {
      this.saveStatus.textContent = "New journey";
    }
  }

  setError(message) {
    this.enterError = true;
    this.enterBtn.disabled = false;
    this.enterLabel.textContent = "Try again";
    this.loadStatus.textContent = message || "The vale could not be reached.";
    this.saveStatus.textContent = "Check your connection";
  }

  revealGame() {
    this.enterLabel.textContent = "Entering the vale…";
    this.titleScreen.classList.add("leaving");
    this.hud.classList.remove("is-hidden");
    this.hud.classList.add("fade-in");
    setTimeout(() => this.titleScreen.classList.add("is-hidden"), 1150);
    this.addHintFade();
  }

  addHintFade() {
    setTimeout(() => this.controlsHint?.classList.add("fade"), 18000);
  }

  updateHUD(game) {
    if (!game) return;
    const count = game.collected.size;
    const total = game.totalWisps || 5;
    this.wispCount.textContent = String(count);
    this.wispTrack.forEach((el, i) => {
      el.classList.toggle("lit", i < count);
      if (i < count && this.prevWisps >= 0 && i >= this.prevWisps) {
        el.classList.remove("pop");
        void el.offsetWidth;
        el.classList.add("pop");
      }
    });
    this.prevWisps = count;
    const ready = count >= total && !game.beaconLit;
    this.quest.classList.toggle("ready", ready);
    if (game.beaconLit) {
      this.questTitle.textContent = "The beacon burns";
      this.questText.textContent = "The vale is warm again. Wander as long as you like.";
      if (this.locationTime) this.locationTime.textContent = "The ember hour";
    } else if (ready) {
      this.questTitle.textContent = "The beacon awaits";
      this.questText.textContent = "Return to the cold brazier at the heart of the village.";
    } else {
      this.questTitle.textContent = "Kindle the Beacon";
      this.questText.textContent = "Five ember wisps have scattered across the vale. Find them.";
    }
    if (this.menuPlace) this.menuPlace.textContent = game.world.name;
  }

  setPrompt(label) {
    const has = Boolean(label);
    this.interactPrompt.classList.toggle("is-hidden", !has);
    this.actionBtn.classList.toggle("dim", !has);
    this.actionBtn.classList.toggle("ready", has);
    if (has) this.promptText.textContent = label;
  }

  toast(text, kind = "") {
    if (!text) return;
    const el = document.createElement("div");
    el.className = `toast${kind ? ` ${kind}` : ""}`;
    el.textContent = text;
    this.toastStack.appendChild(el);
    setTimeout(() => {
      el.classList.add("out");
      setTimeout(() => el.remove(), 550);
    }, 3600);
  }

  showDialog({ kicker = "Emberwood Vale", title = "", text = "", button = "Continue", cancelLabel = "", onClose, onCancel }) {
    this.dialogState = { onClose, onCancel };
    this.dialogKicker.textContent = kicker;
    this.dialogTitle.textContent = title;
    this.dialogText.textContent = text;
    this.dialogClose.textContent = button;
    this.dialogCancel.textContent = cancelLabel || "Cancel";
    this.dialogCancel.classList.toggle("is-hidden", !cancelLabel);
    this.dialogLayer.classList.remove("is-hidden");
    this.game?.pause("dialog");
    setTimeout(() => this.dialogClose.focus(), 40);
  }

  _closeDialog(cancelled) {
    if (!this.dialogState) {
      this.dialogLayer.classList.add("is-hidden");
      this.game?.resume("dialog");
      return;
    }
    const state = this.dialogState;
    this.dialogState = null;
    this.dialogLayer.classList.add("is-hidden");
    this.game?.resume("dialog");
    if (cancelled) state.onCancel?.();
    else state.onClose?.();
  }

  openMenu() {
    if (!this.game?.started) return;
    if (this._overlayOpen() && !visible(this.menuLayer)) return;
    this.menuLayer.classList.remove("is-hidden");
    this.game.pause("menu");
    this.updateMenuStats();
    setTimeout(() => this.resumeBtn.focus(), 30);
  }

  closeMenu() {
    if (!visible(this.menuLayer)) return;
    this.menuLayer.classList.add("is-hidden");
    this.game?.resume("menu");
  }

  updateMenuStats() {
    if (!this.game) return;
    this.menuTime.textContent = `${formatTime(this.game.playTime)} explored`;
    this.menuPlace.textContent = this.game.world.name;
  }

  showHelp(origin = "game") {
    if (origin === "menu" && visible(this.menuLayer)) {
      this.menuLayer.classList.add("is-hidden");
    }
    this.helpOrigin = origin;
    this.helpLayer.classList.remove("is-hidden");
    if (origin === "game") this.game?.pause("help");
    setTimeout(() => this.helpClose.focus(), 30);
  }

  hideHelp() {
    if (!visible(this.helpLayer)) return;
    this.helpLayer.classList.add("is-hidden");
    if (this.helpOrigin === "menu") {
      this.menuLayer.classList.remove("is-hidden");
      this.updateMenuStats();
      setTimeout(() => this.menuHelpBtn.focus(), 30);
    } else {
      this.game?.resume("help");
    }
  }

  showCredits(origin = "title") {
    if (origin === "menu" && visible(this.menuLayer)) {
      this.menuLayer.classList.add("is-hidden");
    }
    this.creditsOrigin = origin;
    this.creditsLayer.classList.remove("is-hidden");
    setTimeout(() => this.creditsClose.focus(), 30);
  }

  hideCredits() {
    if (!visible(this.creditsLayer)) return;
    this.creditsLayer.classList.add("is-hidden");
    if (this.creditsOrigin === "menu") {
      this.menuLayer.classList.remove("is-hidden");
      this.updateMenuStats();
      setTimeout(() => this.menuCreditsBtn.focus(), 30);
    }
  }

  _confirmReset() {
    this.lastFocus = document.activeElement;
    this.menuLayer.classList.add("is-hidden");
    this.showDialog({
      kicker: "Begin anew",
      title: "Let the vale rest?",
      text: "Your gathered embers, your place by the brazier and the time you have spent here will be forgotten. The forest will remain.",
      button: "Begin anew",
      cancelLabel: "Keep my journey",
      onClose: async () => {
        try {
          await this.onReset?.();
        } catch {
          this.toast("The old save could not be cleared.");
          this.openMenu();
        }
      },
      onCancel: () => this.openMenu(),
    });
  }

  showEnding(playTime) {
    this.endingTime.textContent = formatTime(playTime);
    this.endingLayer.classList.remove("is-hidden");
    this.game?.pause("ending");
    setTimeout(() => this.keepExploring.focus(), 50);
  }

  _closeEnding() {
    if (!visible(this.endingLayer)) return;
    this.endingLayer.classList.add("is-hidden");
    this.game?.resume("ending");
  }

  _toggleSound() {
    const enabled = this.audio.toggle();
    this.setSoundState(enabled);
  }

  setSoundState(enabled) {
    this.soundBtn.classList.toggle("sound-off", !enabled);
    this.soundBtn.setAttribute("aria-label", enabled ? "Mute sound" : "Unmute sound");
    this.soundBtn.setAttribute("title", enabled ? "Sound on" : "Sound off");
  }

  async _toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      this.toast("Fullscreen is not available in this browser.");
    }
  }

  tick(now) {
    if (!this.game || !this.world) return;
    if (now - this.lastMinimap > 95) {
      this.lastMinimap = now;
      this.drawMinimap();
    }
    if (visible(this.menuLayer)) this.updateMenuStats();
  }

  drawMinimap() {
    const game = this.game;
    const world = this.world;
    if (!game || !world) return;
    const canvas = this.minimap;
    const ctx = canvas.getContext("2d");
    const size = canvas.width;
    const scale = size / Math.max(world.width, world.height);
    ctx.clearRect(0, 0, size, size);
    for (let y = 0; y < world.height; y++) {
      const row = world.terrain[y];
      for (let x = 0; x < world.width; x++) {
        const code = row.charCodeAt(x) - 48;
        ctx.fillStyle = TERRAIN_MINI[code] || TERRAIN_MINI[0];
        ctx.fillRect(x * scale, y * scale, Math.ceil(scale), Math.ceil(scale));
      }
    }
    for (const b of world.buildings) {
      ctx.fillStyle = "rgba(26, 22, 13, 0.7)";
      const bw = Math.max(3, b.w * scale * 0.8);
      const bh = Math.max(3, b.h * scale * 0.8);
      ctx.fillRect(b.x * scale - bw / 2, b.y * scale - bh / 2, bw, bh);
      ctx.fillStyle = "#d8b06b";
      ctx.fillRect(b.x * scale - bw / 2, b.y * scale - bh / 2, bw, Math.max(1, bh * 0.26));
    }

    const view = this._viewPolygon();
    if (view) {
      ctx.fillStyle = "rgba(244, 211, 146, 0.055)";
      ctx.strokeStyle = "rgba(244, 211, 146, 0.22)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      view.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    for (const w of world.wisps) {
      if (game.collected.has(w.id)) continue;
      const pulse = 0.7 + Math.sin(game.time * 2.2 + w.x) * 0.3;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = `rgba(255, 183, 82, ${0.25 * pulse})`;
      ctx.beginPath();
      ctx.arc(w.x * scale, w.y * scale, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = "#ffd183";
      ctx.beginPath();
      ctx.arc(w.x * scale, w.y * scale, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    const brazier = world.interactables.find((i) => i.kind === "brazier");
    if (brazier) {
      ctx.fillStyle = game.beaconLit ? "#ffb458" : "rgba(220, 178, 102, 0.7)";
      ctx.beginPath();
      ctx.arc(brazier.x * scale, brazier.y * scale, game.beaconLit ? 3.3 : 2.3, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.save();
    ctx.translate(game.player.x * scale, game.player.y * scale);
    ctx.rotate((game.player.dir * Math.PI) / 4);
    ctx.fillStyle = "#f8e8c2";
    ctx.strokeStyle = "rgba(10, 20, 14, 0.9)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(5.5, 0);
    ctx.lineTo(-3.2, -3.2);
    ctx.lineTo(-1.4, 0);
    ctx.lineTo(-3.2, 3.2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  _viewPolygon() {
    if (!this.game) return null;
    const cam = this.game.camera;
    const w = this.game.viewW;
    const h = this.game.viewH;
    const scale = this.minimap.width / Math.max(this.world.width, this.world.height);
    const corners = [
      screenToWorld(0, 0, cam, cam.zoom, w, h),
      screenToWorld(w, 0, cam, cam.zoom, w, h),
      screenToWorld(w, h, cam, cam.zoom, w, h),
      screenToWorld(0, h, cam, cam.zoom, w, h),
    ];
    return corners.map((p) => ({ x: p.x * scale, y: p.y * scale }));
  }
}
