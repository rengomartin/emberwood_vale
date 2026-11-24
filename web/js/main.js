import { loadAssets } from "./assets.js";
import { fetchWorld, fetchSave, getProfile, resetSave } from "./api.js";
import { AudioEngine } from "./audio.js";
import { ParticleSystem } from "./particles.js";
import { Renderer } from "./renderer.js";
import { Game } from "./game.js";
import { UI } from "./ui.js";

const profile = getProfile();
const audio = new AudioEngine();
const particles = new ParticleSystem();
const renderer = new Renderer(document.getElementById("game"));
let game = null;
let ui = null;
let launched = false;
let lastFrame = 0;

ui = new UI({
  audio,
  onEnter: enterGame,
  onReset: async () => {
    await resetSave(profile);
    location.reload();
  },
});

async function boot() {
  renderer.resize();
  try {
    const savePromise = fetchSave(profile).catch((error) => {
      console.warn("Save could not be loaded:", error);
      return null;
    });
    const [world, save] = await Promise.all([
      fetchWorld(),
      savePromise,
      loadAssets((p) => ui.setProgress(p * 0.9)),
    ]);
    ui.setProgress(1);

    game = new Game({ world, save, audio, particles, profile });
    game.setViewport(renderer.viewW, renderer.viewH);
    ui.attachGame(game);
    ui.setReady(save);

    globalThis.emberwood = {
      ui,
      renderer,
      audio,
      get game() {
        return game;
      },
      get profile() {
        return profile;
      },
    };

    lastFrame = performance.now();
    requestAnimationFrame(frame);

    const params = new URLSearchParams(location.search);
    if (params.get("play") === "1") {
      setTimeout(() => {
        enterGame();
      }, 180);
    }
  } catch (error) {
    console.error("Could not wake the vale:", error);
    ui.setError("The vale could not be reached. Is the server running?");
  }
}

async function enterGame() {
  if (!game || launched) return;
  launched = true;
  try {
    await audio.unlock();
  } catch {
    /* Audio is a progressive enhancement; the vale works silently. */
  }
  const save = game.collected.size > 0 || game.playTime > 0;
  game.start();
  ui.revealGame();
  setTimeout(() => {
    if (game.beaconLit) {
      ui.toast("Welcome back. The beacon is still burning.", "gold");
    } else if (save) {
      ui.toast(`Welcome back — ${game.collected.size} of ${game.totalWisps} embers gathered.`);
    } else {
      ui.toast("Five embers are scattered across the vale. Listen for their light.", "gold");
    }
  }, 1000);
}

function frame(now) {
  const dt = lastFrame ? Math.min(0.05, (now - lastFrame) / 1000) : 0;
  lastFrame = now;
  if (game) {
    renderer.resize();
    game.setViewport(renderer.viewW, renderer.viewH);
    game.update(dt);
    renderer.draw(game);
    ui.tick(now);
  }
  requestAnimationFrame(frame);
}

// If the page entered without a gesture (for example ?play=1), pick audio up
// again on the first real interaction.
function resumeAudioOnGesture() {
  if (!launched) return;
  if (!audio.ctx || audio.ctx.state === "suspended") {
    audio.unlock().catch(() => {});
  }
}
window.addEventListener("pointerdown", resumeAudioOnGesture, { passive: true });
window.addEventListener("keydown", resumeAudioOnGesture);

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    game?.clearKeys();
    if (game?.started) game.save(true);
  }
});

window.addEventListener("pagehide", () => {
  if (game?.started) game.save(true);
});

boot();
