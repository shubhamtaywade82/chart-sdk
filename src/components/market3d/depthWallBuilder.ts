import * as THREE from "three";
import { DepthWallGroup, ChartMetrics } from "./types";

const COLOR_BULL = 0x00e0a4;
const COLOR_BEAR = 0xff4f6e;

export function createDepthWallGroup(xEdge: number, topY: number, baseY: number, unitBox: THREE.BoxGeometry): DepthWallGroup {
  const group = new THREE.Group();
  group.position.x = xEdge;

  const membrane = new THREE.Mesh(
    new THREE.PlaneGeometry(36, topY + 10),
    new THREE.MeshBasicMaterial({ color: 0x0b1424, transparent: true, opacity: 0.3, side: THREE.DoubleSide })
  );
  membrane.rotation.y = Math.PI / 2;
  membrane.position.y = (topY + baseY) / 2;
  group.add(membrane);

  const wallGlow = new THREE.Mesh(
    unitBox,
    new THREE.MeshStandardMaterial({ color: 0x0a1a2f, emissive: 0x3b82f6, emissiveIntensity: 0.35 })
  );
  wallGlow.scale.set(0.14, topY + 10, 0.14);
  group.add(wallGlow);

  const createBars = (hex: number, opacity: number) => {
    const arr: THREE.Mesh[] = [];
    const mat = new THREE.MeshStandardMaterial({
      color: hex,
      emissive: hex,
      emissiveIntensity: 0.4,
      transparent: true,
      opacity,
      roughness: 0.4,
    });
    for (let i = 0; i < 20; i++) {
      const bar = new THREE.Mesh(unitBox, mat);
      bar.visible = false;
      bar.scale.set(0.55, 0.55, 0.01);
      group.add(bar);
      arr.push(bar);
    }
    return arr;
  };

  const bidBars = createBars(COLOR_BULL, 0.5);
  const askBars = createBars(COLOR_BEAR, 0.45);
  return { group, bidBars, askBars };
}

export function updateDepthWallBars(
  depthWall: DepthWallGroup,
  metrics: ChartMetrics,
  bids: Array<[string, string]>,
  asks: Array<[string, string]>
): void {
  let maxQ = 0;
  for (const [, q] of bids) maxQ = Math.max(maxQ, Number(q));
  for (const [, q] of asks) maxQ = Math.max(maxQ, Number(q));
  if (!maxQ) return;

  const paint = (bars: THREE.Mesh[], levels: Array<[string, string]>, dir: number) => {
    for (let i = 0; i < 20; i++) {
      const bar = bars[i];
      const lv = levels[i];
      if (!lv) { bar.visible = false; continue; }
      const p = Number(lv[0]), q = Number(lv[1]), y = metrics.py(p);
      if (y < metrics.baseY - 3 || y > metrics.topY + 3) { bar.visible = false; continue; }
      bar.visible = true;
      const len = 0.6 + Math.pow(q / maxQ, 0.6) * 15;
      bar.scale.z = len;
      bar.position.set(0, y, (dir * len) / 2);
    }
  };

  paint(depthWall.bidBars, bids, 1);
  paint(depthWall.askBars, asks, -1);
}
