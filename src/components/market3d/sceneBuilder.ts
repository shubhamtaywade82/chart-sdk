import * as THREE from "three";
import { Candle3D, CandleMeshItem, CandleAnimItem, ChartBuildResult, DynamicSpriteChip, ChartMetrics } from "./types";
import { formatPrice, formatAxisTime, calculateNiceTicks } from "./dataService";
import { createDepthWallGroup } from "./depthWallBuilder";

export const COLOR_BULL = 0x00e0a4;
export const COLOR_BEAR = 0xff4f6e;
export const COLOR_FLOOR = 0x090e1a;
export const COLOR_GRID_MAIN = 0x1c2a48;
export const COLOR_GRID_SUB = 0x101a30;
export const COLOR_WALL = 0x070c17;
export const COLOR_GRID_LINE = 0x1d2b4a;
export const COLOR_RIBBON = 0x7c6bff;

export const BASE_Y = 5;
export const TOP_Y = 52;
export const VOL_HEIGHT = 9;

export function makeDynamicSpriteChip(scale = 0.05): DynamicSpriteChip {
  const canvas = document.createElement("canvas");
  canvas.width = 230;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(canvas.width * scale, canvas.height * scale, 1);

  const update = (text: string, isBull: boolean) => {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = isBull ? "rgba(6,46,37,.95)" : "rgba(64,15,30,.95)";
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(1, 1, canvas.width - 2, canvas.height - 2, 14) : ctx.rect(1, 1, canvas.width - 2, canvas.height - 2);
    ctx.fill();
    ctx.strokeStyle = isBull ? "rgba(0,224,164,.4)" : "rgba(255,79,110,.4)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.font = '700 38px "JetBrains Mono", monospace';
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillStyle = isBull ? "#5ff2c8" : "#ff92a6";
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 2);
    texture.needsUpdate = true;
  };

  return { sprite, update };
}

export function createTextSprite(
  text: string,
  opts: { font?: string; color?: string; bg?: string | null; scale?: number } = {}
): THREE.Sprite {
  const { font = '600 38px "JetBrains Mono", monospace', color = "#8aa0c8", scale = 0.045 } = opts;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.Sprite();

  ctx.font = font;
  const textWidth = ctx.measureText(text).width;
  const padX = 16;
  canvas.width = Math.ceil(textWidth + padX * 2);
  canvas.height = 64;

  ctx.font = font;
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.fillText(text, padX, canvas.height / 2 + 1);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(canvas.width * scale, canvas.height * scale, 1);
  return sprite;
}

export function disposeThreeHierarchy(root: THREE.Object3D, unitBox: THREE.BufferGeometry, hitMat: THREE.Material): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh || (obj as THREE.Sprite).isSprite || (obj as THREE.Line).isLine) {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((m) => {
        if (!m) return;
        if ("map" in m && m.map) (m.map as THREE.Texture).dispose();
        if (m !== hitMat) m.dispose();
      });
      if (mesh.geometry && mesh.geometry !== unitBox) mesh.geometry.dispose();
    }
  });
}

export function build3DChartScene(
  scene: THREE.Scene,
  data: Candle3D[],
  tf: string,
  unitBox: THREE.BoxGeometry,
  hitMat: THREE.Material,
  prevGroup: THREE.Group | null
): ChartBuildResult {
  if (prevGroup) {
    scene.remove(prevGroup);
    disposeThreeHierarchy(prevGroup, unitBox, hitMat);
  }

  const rootGroup = new THREE.Group();
  scene.add(rootGroup);

  const candleObjs: CandleMeshItem[] = [];
  const hitMeshes: THREE.Mesh[] = [];
  const anims: CandleAnimItem[] = [];
  const xPos: number[] = [];
  const N = data.length;

  const spacing = THREE.MathUtils.clamp(150 / N, 0.85, 2.8);
  const cw = spacing * 0.55;
  const half = ((N - 1) / 2) * spacing;
  for (let i = 0; i < N; i++) xPos.push(i * spacing - half);

  let min = Infinity, max = -Infinity, volMax = 0;
  for (const k of data) {
    if (k.l < min) min = k.l;
    if (k.h > max) max = k.h;
    if (k.v > volMax) volMax = k.v;
  }
  const padP = (max - min) * 0.08 || max * 0.02 || 1;
  min -= padP; max += padP;

  const py = (p: number) => BASE_Y + ((p - min) / (max - min)) * (TOP_Y - BASE_Y);
  const volZ = -(cw / 2 + 4.4);
  const wallZ = volZ - 5.5;
  const labelZ = cw / 2 + 4.2;
  const xEdge = xPos[N - 1] + spacing * 2.4;

  const volGroup = new THREE.Group();
  volGroup.position.z = volZ;
  rootGroup.add(volGroup);

  const volBuyMat = new THREE.MeshStandardMaterial({
    color: 0x0a4a3c, roughness: 0.6, metalness: 0.1, emissive: COLOR_BULL, emissiveIntensity: 0.14, transparent: true, opacity: 0.9,
  });
  const volSellMat = new THREE.MeshStandardMaterial({
    color: 0x4d1b2e, roughness: 0.6, metalness: 0.1, emissive: COLOR_BEAR, emissiveIntensity: 0.1, transparent: true, opacity: 0.9,
  });

  data.forEach((k, i) => {
    const isBull = k.c >= k.o;
    const col = isBull ? COLOR_BULL : COLOR_BEAR;
    const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.32, metalness: 0.3, emissive: col, emissiveIntensity: 0.32 });
    const body = new THREE.Mesh(unitBox, mat);
    body.scale.set(cw, 0.001, cw); body.position.x = xPos[i]; body.userData.i = i;

    const wick = new THREE.Mesh(unitBox, mat);
    wick.scale.set(cw * 0.16, 0.001, cw * 0.16); wick.position.x = xPos[i]; wick.userData.i = i;
    rootGroup.add(body, wick);

    const oY = py(k.o), cY = py(k.c), hY = py(k.h), lY = py(k.l);
    const bLow = Math.min(oY, cY), bH = Math.max(Math.abs(cY - oY), 0.28), wH = hY - lY;
    const vH = volMax ? (k.v / volMax) * VOL_HEIGHT : 0;
    const buyFrac = k.v > 0 ? Math.min(1, Math.max(0, (k.bv ?? k.v / 2) / k.v)) : 0.5;

    const vBuy = new THREE.Mesh(unitBox, volBuyMat);
    vBuy.scale.set(cw, 0.001, cw); vBuy.position.x = xPos[i]; volGroup.add(vBuy);
    const vSell = new THREE.Mesh(unitBox, volSellMat);
    vSell.scale.set(cw, 0.001, cw); vSell.position.x = xPos[i]; volGroup.add(vSell);

    const hit = new THREE.Mesh(unitBox, hitMat);
    hit.scale.set(spacing * 0.95, wH + 2, spacing * 0.95); hit.position.set(xPos[i], (hY + lY) / 2, 0); hit.userData.i = i;
    rootGroup.add(hit); hitMeshes.push(hit);

    candleObjs.push({ mat, x: xPos[i], mid: (hY + lY) / 2, vBuy, vSell });
    anims.push({ body, wick, vBuy, vSell, bLow, bH, lY, wH, vH, buyFrac, delay: i * 0.012 });
  });

  const xL = xPos[0] - spacing;
  const xR = xPos[N - 1] + spacing;

  const wall = new THREE.Mesh(new THREE.PlaneGeometry(xR - xL + 44 + spacing * 6, TOP_Y + 24), new THREE.MeshStandardMaterial({ color: COLOR_WALL, roughness: 1 }));
  wall.position.set(((xEdge - xL) / 2) * 0.4, (TOP_Y - 4) / 2 + 4, wallZ - 0.6); rootGroup.add(wall);

  const ticks = calculateNiceTicks(min, max, 6);
  const pts: number[] = [];
  for (const tv of ticks) {
    if (tv < min || tv > max) continue;
    const y = py(tv); pts.push(xL, y, wallZ, xEdge + 8, y, wallZ);
    const sprite = createTextSprite(formatPrice(tv), { color: "#7e93bd" });
    sprite.position.set(xL - 7.5, y, wallZ + 1); rootGroup.add(sprite);
  }

  const timeStep = Math.max(1, Math.round(N / 8));
  for (let i = 0; i < N; i += timeStep) {
    pts.push(xPos[i], 0, wallZ, xPos[i], TOP_Y + 3, wallZ);
    const s = createTextSprite(formatAxisTime(data[i].t, tf), { color: "#64779e", font: '600 32px "JetBrains Mono", monospace', scale: 0.05 });
    s.position.set(xPos[i], 1.2, labelZ + 2); rootGroup.add(s);
  }

  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  rootGroup.add(new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: COLOR_GRID_LINE, transparent: true, opacity: 0.55 })));

  const runway = new THREE.Mesh(unitBox, new THREE.MeshStandardMaterial({ color: 0x06251f, emissive: COLOR_BULL, emissiveIntensity: 0.3, roughness: 0.5 }));
  runway.scale.set(xEdge - xL + 8, 0.12, 0.5); runway.position.set((xL + xEdge) / 2, 0.06, 0); rootGroup.add(runway);

  // Close-price ribbon
  const ribbonPos = new Float32Array(N * 3);
  data.forEach((k, i) => { ribbonPos[i * 3] = xPos[i]; ribbonPos[i * 3 + 1] = py(k.c); ribbonPos[i * 3 + 2] = cw / 2 + 0.35; });
  const rGeo = new THREE.BufferGeometry();
  rGeo.setAttribute("position", new THREE.BufferAttribute(ribbonPos, 3));
  const ribbon = new THREE.Line(rGeo, new THREE.LineBasicMaterial({ color: COLOR_RIBBON, transparent: true, opacity: 0.85 }));
  rootGroup.add(ribbon);

  // Live price beam line + chip
  const last = data[N - 1]; const lastY = py(last.c); const isLastBull = last.c >= last.o;
  const bGeo = new THREE.BufferGeometry();
  bGeo.setAttribute("position", new THREE.Float32BufferAttribute([xL, lastY, wallZ + 0.3, xEdge + 6, lastY, wallZ + 0.3], 3));
  const beamLine = new THREE.Line(bGeo, new THREE.LineDashedMaterial({ color: isLastBull ? COLOR_BULL : COLOR_BEAR, dashSize: 1.5, gapSize: 1.1, transparent: true, opacity: 0.8 }));
  beamLine.computeLineDistances(); rootGroup.add(beamLine);

  const chip = makeDynamicSpriteChip(0.05);
  chip.update(formatPrice(last.c), isLastBull); chip.sprite.position.set(xEdge + 13, lastY, wallZ + 1); rootGroup.add(chip.sprite);

  const depthWall = createDepthWallGroup(xEdge, TOP_Y, BASE_Y, unitBox);
  rootGroup.add(depthWall.group);

  const homeTarget = new THREE.Vector3(xEdge * 0.14, TOP_Y * 0.42, 0);
  const homeCam = new THREE.Vector3(xEdge * 0.3, TOP_Y * 0.82, THREE.MathUtils.clamp(half * 1.35 + 42, 80, 225));

  const metrics: ChartMetrics = {
    min, max, baseY: BASE_Y, topY: TOP_Y, py, spacing, xPos, count: N, volHeight: VOL_HEIGHT, maxVol: volMax, xEdge, wallZ, ribbon, beamLine, chip,
  };

  return { candleObjs, hitMeshes, anims, homeCam, homeTarget, rootGroup, volGroup, depthWall, metrics };
}
