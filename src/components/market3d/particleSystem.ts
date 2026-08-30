import * as THREE from "three";
import { ParticleItem, ChartMetrics } from "./types";

const COLOR_BULL = 0x00e0a4;
const COLOR_BEAR = 0xff4f6e;

export function createParticlePool(scene: THREE.Scene): ParticleItem[] {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const grd = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    grd.addColorStop(0, "rgba(255,255,255,1)");
    grd.addColorStop(0.4, "rgba(255,255,255,.55)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 64, 64);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const group = new THREE.Group();
  scene.add(group);

  const particles: ParticleItem[] = [];
  for (let i = 0; i < 70; i++) {
    const m = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const sp = new THREE.Sprite(m);
    sp.visible = false;
    group.add(sp);
    particles.push({ sp, m, life: 0, max: 1, vx: 0, vy: 0, vz: 0, base: 1 });
  }
  return particles;
}

export function emitTradeParticle(
  particles: ParticleItem[],
  metrics: ChartMetrics,
  price: number,
  isBuy: boolean,
  usd: number
): void {
  const y = metrics.py(price);
  if (y < metrics.baseY - 4 || y > metrics.topY + 4) return;
  const p = particles.find((q) => q.life <= 0);
  if (!p) return;

  p.life = p.max = 0.85 + Math.random() * 0.5;
  p.sp.position.set(metrics.xPos[metrics.count - 1], y, 0.6);
  const kick = 0.9 + Math.min(3, Math.sqrt(usd) / 45);
  p.vx = (Math.random() - 0.5) * 2.4;
  p.vy = (isBuy ? 1 : -1) * kick * 2.4;
  p.vz = (Math.random() - 0.5) * 3 + 1.2;
  p.base = 0.55 + Math.min(1.8, Math.sqrt(usd) / 70);
  p.m.color.setHex(isBuy ? COLOR_BULL : COLOR_BEAR);
  p.sp.visible = true;
}

export function stepParticles(particles: ParticleItem[], dt: number): void {
  for (const p of particles) {
    if (p.life <= 0) continue;
    p.life -= dt;
    const k = Math.max(0, p.life / p.max);
    p.sp.position.x += p.vx * dt;
    p.sp.position.y += p.vy * dt;
    p.sp.position.z += p.vz * dt;
    p.vy *= 0.965;
    p.vx *= 0.96;
    p.vz *= 0.96;
    p.m.opacity = k * 0.95;
    const s = p.base * (1 + (1 - k) * 0.8);
    p.sp.scale.set(s, s, 1);
    if (p.life <= 0) p.sp.visible = false;
  }
}
