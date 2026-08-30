import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

const COLOR_BULL = 0x00e0a4;

export interface WebGLSceneContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  composer: EffectComposer;
  lastLight: THREE.PointLight;
  unitBox: THREE.BoxGeometry;
  hitMat: THREE.MeshBasicMaterial;
}

export function initializeWebGLScene(canvas: HTMLCanvasElement, wrap: HTMLDivElement, autoOrbit: boolean): WebGLSceneContext {
  const w = wrap.clientWidth || 800;
  const h = wrap.clientHeight || 600;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070d);
  scene.fog = new THREE.Fog(0x05070d, 200, 680);

  const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 1400);
  camera.position.set(0, 42, 120);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.maxPolarAngle = 1.53;
  controls.minDistance = 24;
  controls.maxDistance = 320;
  controls.autoRotate = autoOrbit;
  controls.autoRotateSpeed = 0.55;
  controls.target.set(0, 21, 0);

  scene.add(new THREE.HemisphereLight(0x3a4a6e, 0x0a0f1c, 0.95));
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(50, 90, 70);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x5566ff, 0.7);
  rim.position.set(-70, 40, -60);
  scene.add(rim);

  const lastLight = new THREE.PointLight(COLOR_BULL, 0.6, 46);
  scene.add(lastLight);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(760, 540), new THREE.MeshStandardMaterial({ color: 0x090e1a, roughness: 0.92, metalness: 0.15 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.03;
  scene.add(floor);

  const grid = new THREE.GridHelper(760, 76, 0x1c2a48, 0x101a30);
  grid.material.transparent = true;
  grid.material.opacity = 0.7;
  scene.add(grid);

  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.5, 0.55, 0.78);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  return { renderer, scene, camera, controls, composer, lastLight, unitBox, hitMat };
}
