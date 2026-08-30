import React, { useEffect, useRef } from "react";
import { Candle3D } from "../market3d/types";
import { DepthSnapshot, drawFrame } from "./canvasRenderer";

interface CandleCanvasProps {
  data: Candle3D[];
  depthHistoryRef: React.MutableRefObject<DepthSnapshot[]>;
  showHeatmap: boolean;
  showVolume: boolean;
}

export function CandleCanvas({ data, depthHistoryRef, showHeatmap, showVolume }: CandleCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hoverRef = useRef<{ x: number; y: number } | null>(null);
  const dataRef = useRef(data);
  const flagsRef = useRef({ showHeatmap, showVolume });

  dataRef.current = data;
  flagsRef.current = { showHeatmap, showVolume };

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = wrap.clientWidth * dpr;
      canvas.height = wrap.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const loop = () => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      drawFrame(ctx, w, h, {
        candles: dataRef.current,
        depthHistory: depthHistoryRef.current,
        showHeatmap: flagsRef.current.showHeatmap,
        showVolume: flagsRef.current.showVolume,
        hover: hoverRef.current,
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [depthHistoryRef]);

  const handleMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    hoverRef.current = { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  return (
    <div ref={wrapRef} className="m2-chart-wrap">
      <canvas
        ref={canvasRef}
        onMouseMove={handleMove}
        onMouseLeave={() => { hoverRef.current = null; }}
      />
    </div>
  );
}
