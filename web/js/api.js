const PROFILE_KEY = "emberwood.profile.v1";

function randomProfile() {
  const bytes = new Uint8Array(12);
  if (globalThis.crypto?.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  const tail = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `wanderer_${tail}`;
}

export function getProfile() {
  try {
    let profile = localStorage.getItem(PROFILE_KEY);
    if (!profile || !/^[a-zA-Z0-9_-]{8,64}$/.test(profile)) {
      profile = randomProfile();
      localStorage.setItem(PROFILE_KEY, profile);
    }
    return profile;
  } catch {
    return randomProfile();
  }
}

async function request(url, options = {}, timeout = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok) {
      let detail = "";
      try {
        const body = await res.json();
        detail = body.error || "";
      } catch {
        /* ignore */
      }
      throw new Error(detail || `Request failed (${res.status})`);
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchWorld() {
  const res = await request("/api/world", { headers: { Accept: "application/json" } });
  return res.json();
}

export async function fetchSave(profile) {
  const res = await request(`/api/save?profile=${encodeURIComponent(profile)}`, {
    headers: { Accept: "application/json" },
  });
  const data = await res.json();
  return data.save || null;
}

export async function saveProgress(profile, state, { keepalive = false } = {}) {
  const payload = {
    profile,
    x: state.x,
    y: state.y,
    dir: state.dir,
    collected: state.collected,
    beaconLit: state.beaconLit,
    playTime: state.playTime,
  };
  const res = await request(
    "/api/save",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive,
    },
    keepalive ? 5000 : 15000
  );
  if (keepalive) return null;
  const data = await res.json();
  return data.save || null;
}

export async function resetSave(profile) {
  await request(`/api/save?profile=${encodeURIComponent(profile)}`, { method: "DELETE" });
}
