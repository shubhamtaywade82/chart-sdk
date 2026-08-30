import * as THREE from "three";

export interface Candle3D {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  bv?: number;
}

export interface TradeItem {
  id?: number;
  time: number;
  price: number;
  qty: number;
  isSell: boolean;
  usd: number;
}

export interface DepthLevel {
  price: number;
  qty: number;
  cum: number;
}

export interface DepthData {
  bids: Array<[string, string]>;
  asks: Array<[string, string]>;
}

export interface BookTicker {
  bid: number;
  ask: number;
  spread: number;
  spreadBps: number;
}

export type WsStatus = "live" | "connecting" | "reconnecting" | "sim" | "offline";
export type Timeframe3D = "15m" | "1h" | "4h" | "1d";

export interface MarketStats {
  hi: number;
  lo: number;
  vol: number;
  chg: number;
  win: string;
}

export interface CandleMeshItem {
  mat: THREE.MeshStandardMaterial;
  x: number;
  mid: number;
  vBuy: THREE.Mesh;
  vSell: THREE.Mesh;
}

export interface CandleAnimItem {
  body: THREE.Mesh;
  wick: THREE.Mesh;
  vBuy: THREE.Mesh;
  vSell: THREE.Mesh;
  bLow: number;
  bH: number;
  lY: number;
  wH: number;
  vH: number;
  buyFrac: number;
  delay: number;
}

export interface DynamicSpriteChip {
  sprite: THREE.Sprite;
  update: (text: string, isBull: boolean) => void;
}

export interface ChartMetrics {
  min: number;
  max: number;
  baseY: number;
  topY: number;
  py: (p: number) => number;
  spacing: number;
  xPos: number[];
  count: number;
  volHeight: number;
  maxVol: number;
  xEdge: number;
  wallZ: number;
  ribbon: THREE.Line;
  beamLine: THREE.Line;
  chip: DynamicSpriteChip;
}

export interface ParticleItem {
  sp: THREE.Sprite;
  m: THREE.SpriteMaterial;
  life: number;
  max: number;
  vx: number;
  vy: number;
  vz: number;
  base: number;
}

export interface DepthWallGroup {
  group: THREE.Group;
  bidBars: THREE.Mesh[];
  askBars: THREE.Mesh[];
}

export interface ChartBuildResult {
  candleObjs: CandleMeshItem[];
  hitMeshes: THREE.Mesh[];
  anims: CandleAnimItem[];
  homeCam: THREE.Vector3;
  homeTarget: THREE.Vector3;
  rootGroup: THREE.Group;
  volGroup: THREE.Group;
  depthWall: DepthWallGroup;
  metrics: ChartMetrics;
}

export interface Market3DProps {
  symbol?: string;
  defaultTimeframe?: Timeframe3D;
  defaultCandleCount?: number;
  defaultAutoOrbit?: boolean;
  onSymbolChange?: (symbol: string) => void;
}
