import { useEffect, useRef, useCallback } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { Candle3D, CandleMeshItem, CandleAnimItem, Timeframe3D, ParticleItem, DepthWallGroup, ChartMetrics } from "./types";
import { build3DChartScene, COLOR_BULL, COLOR_BEAR } from "./sceneBuilder";
import { createParticlePool, emitTradeParticle, stepParticles } from "./particleSystem";
import { updateDepthWallBars } from "./depthWallBuilder";
import { initializeWebGLScene } from "./webglSetup";
import { formatPrice } from "./dataService";

interface UseThreeSceneParams {
  wrapRef: React.RefObject<HTMLDivElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  autoOrbit: boolean;
  enableBloom: boolean;
  showVolume: boolean;
  showDepth: boolean;
  showFlow: boolean;
  onHoverChange: (index: number | null) => void;
  onFatalError: () => void;
}

export function useThreeScene({
  wrapRef,
  canvasRef,
  autoOrbit,
  enableBloom,
  showVolume,
  showDepth,
  showFlow,
  onHoverChange,
  onFatalError,
}: UseThreeSceneParams) {
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const composerRef = useRef<EffectComposer | null>(null);
  const startTimeRef = useRef(performance.now());
  const lastTimeRef = useRef(performance.now());

  const rootGroupRef = useRef<THREE.Group | null>(null);
  const volGroupRef = useRef<THREE.Group | null>(null);
  const depthWallRef = useRef<DepthWallGroup | null>(null);
  const metricsRef = useRef<ChartMetrics | null>(null);
  const candleObjsRef = useRef<CandleMeshItem[]>([]);
  const hitMeshesRef = useRef<THREE.Mesh[]>([]);
  const animsRef = useRef<CandleAnimItem[]>([]);
  const unitBoxRef = useRef<THREE.BoxGeometry | null>(null);
  const hitMatRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const lastLightRef = useRef<THREE.PointLight | null>(null);
  const hoveredIndexRef = useRef<number | null>(null);

  const particlesRef = useRef<ParticleItem[]>([]);
  const homeCamRef = useRef<THREE.Vector3 | null>(null);
  const homeTargetRef = useRef<THREE.Vector3 | null>(null);
  const goalCamRef = useRef<THREE.Vector3 | null>(null);
  const goalTargetRef = useRef<THREE.Vector3 | null>(null);
  const animStateRef = useRef({ animating: false, revealStart: 0 });
  const pointerRef = useRef({ x: 0, y: 0, active: false, isDown: false, downPos: [0, 0] as [number, number] });
  const raycasterRef = useRef(new THREE.Raycaster());

  const updateVolBars = (a: { vBuy: THREE.Mesh; vSell: THREE.Mesh; vH: number; buyFrac: number }) => {
    const buyH = a.vH * a.buyFrac, sellH = a.vH - buyH;
    a.vBuy.scale.y = Math.max(buyH, 0.001); a.vBuy.position.y = buyH / 2;
    a.vSell.scale.y = Math.max(sellH, 0.001); a.vSell.position.y = buyH + sellH / 2;
  };

  const updatePointerRaycast = () => {
    const p = pointerRef.current;
    if (!p.active || p.isDown || !hitMeshesRef.current.length || !cameraRef.current) {
      if (hoveredIndexRef.current !== null) {
        const prev = candleObjsRef.current[hoveredIndexRef.current];
        if (prev) prev.mat.emissiveIntensity = 0.32;
        hoveredIndexRef.current = null;
        onHoverChange(null);
      }
      return;
    }
    const ndc = new THREE.Vector2(p.x, p.y);
    raycasterRef.current.setFromCamera(ndc, cameraRef.current);
    const hits = raycasterRef.current.intersectObjects(hitMeshesRef.current, false);
    const hitIdx = hits.length > 0 ? (hits[0].object.userData.i as number) : -1;

    if (hitIdx !== hoveredIndexRef.current) {
      if (hoveredIndexRef.current !== null && candleObjsRef.current[hoveredIndexRef.current]) {
        candleObjsRef.current[hoveredIndexRef.current].mat.emissiveIntensity = 0.32;
      }
      if (hitIdx >= 0 && candleObjsRef.current[hitIdx]) {
        candleObjsRef.current[hitIdx].mat.emissiveIntensity = 1.0;
        hoveredIndexRef.current = hitIdx;
        onHoverChange(hitIdx);
      } else {
        hoveredIndexRef.current = null;
        onHoverChange(null);
      }
    }
  };

  const updateAnimations = (t: number) => {
    if (!animStateRef.current.animating) return;
    const elapsed = t - animStateRef.current.revealStart;
    let isDone = true;
    for (const a of animsRef.current) {
      let k = Math.max(0, Math.min(1, (elapsed - a.delay) / 0.7));
      k = 1 - Math.pow(1 - k, 3);
      if (k < 1) isDone = false;
      a.body.scale.y = Math.max(a.bH * k, 0.001); a.body.position.y = a.bLow + (a.bH * k) / 2;
      a.wick.scale.y = Math.max(a.wH * k, 0.001); a.wick.position.y = a.lY + (a.wH * k) / 2;
      updateVolBars({ vBuy: a.vBuy, vSell: a.vSell, vH: a.vH * k, buyFrac: a.buyFrac });
    }
    if (isDone) animStateRef.current.animating = false;
  };

  const renderFrame = () => {
    const now = performance.now();
    const dt = Math.min((now - lastTimeRef.current) / 1000, 0.05);
    lastTimeRef.current = now;
    const t = (now - startTimeRef.current) / 1000;

    if (controlsRef.current) controlsRef.current.update();
    if (goalTargetRef.current && controlsRef.current) {
      controlsRef.current.target.lerp(goalTargetRef.current, 0.08);
      if (controlsRef.current.target.distanceTo(goalTargetRef.current) < 0.05) goalTargetRef.current = null;
    }
    if (goalCamRef.current && cameraRef.current) {
      cameraRef.current.position.lerp(goalCamRef.current, 0.08);
      if (cameraRef.current.position.distanceTo(goalCamRef.current) < 0.05) goalCamRef.current = null;
    }
    updateAnimations(t);
    stepParticles(particlesRef.current, dt);
    if (lastLightRef.current) lastLightRef.current.intensity = 0.45 + 0.28 * Math.sin(t * 2.6);
    updatePointerRaycast();
    if (enableBloom && composerRef.current) {
      composerRef.current.render();
    } else if (rendererRef.current && sceneRef.current && cameraRef.current) {
      rendererRef.current.render(sceneRef.current, cameraRef.current);
    }
  };

  const spawnTradeParticle = useCallback((price: number, isBuy: boolean, usd: number) => {
    const m = metricsRef.current;
    if (m && showFlow) emitTradeParticle(particlesRef.current, m, price, isBuy, usd);
  }, [showFlow]);

  const updateDepthWall = useCallback((bids: Array<[string, string]>, asks: Array<[string, string]>) => {
    const m = metricsRef.current, dw = depthWallRef.current;
    if (m && dw) updateDepthWallBars(dw, m, bids, asks);
  }, []);

  const updateLastCandle = useCallback((k: Candle3D) => {
    const m = metricsRef.current;
    if (!m) return;
    const lastIdx = m.count - 1, o = candleObjsRef.current[lastIdx], a = animsRef.current[lastIdx];
    if (!o || !a) return;
    const oY = m.py(k.o), cY = m.py(k.c), hY = m.py(k.h), lY = m.py(k.l), isBull = k.c >= k.o;
    a.bLow = Math.min(oY, cY); a.bH = Math.max(Math.abs(cY - oY), 0.28); a.lY = lY; a.wH = hY - lY;
    o.mat.color.setHex(isBull ? COLOR_BULL : COLOR_BEAR); o.mat.emissive.setHex(isBull ? COLOR_BULL : COLOR_BEAR);
    a.body.scale.y = a.bH; a.body.position.y = a.bLow + a.bH / 2;
    a.wick.scale.y = a.wH; a.wick.position.y = a.lY + a.wH / 2;
    if (k.v > m.maxVol) m.maxVol = k.v;
    a.vH = m.maxVol ? (k.v / m.maxVol) * m.volHeight : 0;
    a.buyFrac = k.v > 0 ? Math.min(1, Math.max(0, (k.bv ?? k.v / 2) / k.v)) : 0.5;
    updateVolBars(a);
    const rp = m.ribbon.geometry.attributes.position; rp.setY(lastIdx, cY); rp.needsUpdate = true;
    const bp = m.beamLine.geometry.attributes.position; bp.setY(0, cY); bp.setY(1, cY); bp.needsUpdate = true;
    m.beamLine.computeLineDistances();
    (m.beamLine.material as THREE.LineDashedMaterial).color.setHex(isBull ? COLOR_BULL : COLOR_BEAR);
    m.chip.sprite.position.y = cY; m.chip.update(formatPrice(k.c), isBull);
    if (lastLightRef.current) {
      lastLightRef.current.position.set(o.x, cY + 3, 3);
      lastLightRef.current.color.setHex(isBull ? COLOR_BULL : COLOR_BEAR);
    }
    o.mid = (hY + lY) / 2;
  }, []);

  const resetCamera = useCallback(() => {
    if (homeCamRef.current && homeTargetRef.current) {
      goalCamRef.current = homeCamRef.current.clone(); goalTargetRef.current = homeTargetRef.current.clone();
    }
  }, []);

  const rebuildChart = useCallback((data: Candle3D[], tf: Timeframe3D, animate: boolean, reframe: boolean) => {
    if (!sceneRef.current || !unitBoxRef.current || !hitMatRef.current) return;
    const build = build3DChartScene(sceneRef.current, data, tf, unitBoxRef.current, hitMatRef.current, rootGroupRef.current);
    rootGroupRef.current = build.rootGroup; volGroupRef.current = build.volGroup; volGroupRef.current.visible = showVolume;
    depthWallRef.current = build.depthWall; depthWallRef.current.group.visible = showDepth;
    metricsRef.current = build.metrics; candleObjsRef.current = build.candleObjs;
    hitMeshesRef.current = build.hitMeshes; animsRef.current = build.anims;
    homeCamRef.current = build.homeCam; homeTargetRef.current = build.homeTarget;
    if (reframe && cameraRef.current && controlsRef.current) {
      cameraRef.current.position.copy(build.homeCam); controlsRef.current.target.copy(build.homeTarget);
    }
    if (animate) {
      const nowSeconds = (performance.now() - startTimeRef.current) / 1000;
      animStateRef.current = { animating: true, revealStart: nowSeconds };
    } else {
      for (const a of build.anims) {
        a.body.scale.y = a.bH; a.body.position.y = a.bLow + a.bH / 2;
        a.wick.scale.y = a.wH; a.wick.position.y = a.lY + a.wH / 2;
        updateVolBars(a);
      }
    }
  }, [showVolume, showDepth]);

  useEffect(() => {
    if (!canvasRef.current || !wrapRef.current) return;
    try {
      const gl = initializeWebGLScene(canvasRef.current, wrapRef.current, autoOrbit);
      rendererRef.current = gl.renderer; sceneRef.current = gl.scene; cameraRef.current = gl.camera;
      controlsRef.current = gl.controls; composerRef.current = gl.composer; lastLightRef.current = gl.lastLight;
      unitBoxRef.current = gl.unitBox; hitMatRef.current = gl.hitMat;
      gl.controls.addEventListener("start", () => { goalCamRef.current = null; goalTargetRef.current = null; });
      particlesRef.current = createParticlePool(gl.scene);
      let frameId: number;
      const animateLoop = () => { frameId = requestAnimationFrame(animateLoop); renderFrame(); };
      animateLoop();
      const handleResize = () => {
        if (!wrapRef.current || !rendererRef.current || !cameraRef.current || !composerRef.current) return;
        const rw = wrapRef.current.clientWidth, rh = wrapRef.current.clientHeight;
        rendererRef.current.setSize(rw, rh, false); cameraRef.current.aspect = rw / rh;
        cameraRef.current.updateProjectionMatrix(); composerRef.current.setSize(rw, rh);
      };
      window.addEventListener("resize", handleResize);
      return () => { cancelAnimationFrame(frameId); window.removeEventListener("resize", handleResize); gl.renderer.dispose(); };
    } catch { onFatalError(); }
  }, []);

  useEffect(() => { if (controlsRef.current) controlsRef.current.autoRotate = autoOrbit; }, [autoOrbit]);
  useEffect(() => { if (volGroupRef.current) volGroupRef.current.visible = showVolume; }, [showVolume]);
  useEffect(() => { if (depthWallRef.current) depthWallRef.current.group.visible = showDepth; }, [showDepth]);

  return {
    pointerRef, goalTargetRef, metricsRef, candleObjsRef, resetCamera, rebuildChart, updateLastCandle, updateDepthWall, spawnTradeParticle,
  };
}
