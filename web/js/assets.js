const MANIFEST = {
  groundAtlas: "/assets/img/ground-atlas.png",
  player: "/assets/img/player.png",
  pond: "/assets/img/pond.png",
  cottage_a: "/assets/img/cottage_a.png",
  cottage_b: "/assets/img/cottage_b.png",
  cottage_c: "/assets/img/cottage_c.png",
  blacksmith: "/assets/img/blacksmith.png",
  tree_oak_wide: "/assets/img/tree_oak_wide.png",
  tree_airy: "/assets/img/tree_airy.png",
  tree_tall: "/assets/img/tree_tall.png",
  tree_silver: "/assets/img/tree_silver.png",
  tree_gold: "/assets/img/tree_gold.png",
  tree_bare: "/assets/img/tree_bare.png",
  tree_autumn: "/assets/img/tree_autumn.png",
  tree_round: "/assets/img/tree_round.png",
  tree_broad: "/assets/img/tree_broad.png",
  tree_pine: "/assets/img/tree_pine.png",
  tree_pine2: "/assets/img/tree_pine2.png",
  tree_blue: "/assets/img/tree_blue.png",
  bush_green: "/assets/img/bush_green.png",
  bush_small: "/assets/img/bush_small.png",
  bush_leafy: "/assets/img/bush_leafy.png",
  bush_bright: "/assets/img/bush_bright.png",
  bush_brown: "/assets/img/bush_brown.png",
  bush_blue: "/assets/img/bush_blue.png",
};

export const images = new Map();

function loadOne(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      const finish = () => resolve(img);
      if (typeof img.decode === "function") {
        img.decode().then(finish, finish);
      } else {
        finish();
      }
    };
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

export async function loadAssets(onProgress = () => {}) {
  const entries = Object.entries(MANIFEST);
  let done = 0;
  await Promise.all(
    entries.map(async ([key, src]) => {
      const img = await loadOne(src);
      images.set(key, img);
      done += 1;
      onProgress(done / entries.length, key);
    })
  );
  return images;
}

export function image(key) {
  return images.get(key);
}

export const assetCount = Object.keys(MANIFEST).length;
