import React from "react";
import { DepthData } from "./types";
import { formatPrice, formatQty } from "./dataService";

interface OrderBookPanelProps {
  depth: DepthData | null;
  livePrice: number | null;
  isOpen: boolean;
}

export function OrderBookPanel({ depth, livePrice, isOpen }: OrderBookPanelProps) {
  if (!isOpen || !depth) return null;

  const N = 9;
  const asks = depth.asks.slice(0, N);
  const bids = depth.bids.slice(0, N);

  let cumAsk = 0;
  let maxCum = 0;
  const askRows = asks
    .map(([p, q]) => {
      cumAsk += Number(q);
      maxCum = Math.max(maxCum, cumAsk);
      return { price: Number(p), qty: Number(q), cum: cumAsk };
    })
    .reverse();

  let cumBid = 0;
  const bidRows = bids.map(([p, q]) => {
    cumBid += Number(q);
    maxCum = Math.max(maxCum, cumBid);
    return { price: Number(p), qty: Number(q), cum: cumBid };
  });

  const bestBid = bids[0] ? Number(bids[0][0]) : 0;
  const bestAsk = asks[0] ? Number(asks[0][0]) : 0;
  const mid = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : livePrice || 0;
  const spread = bestBid && bestAsk ? bestAsk - bestBid : 0;
  const spreadBps = mid > 0 ? (spread / mid) * 1e4 : 0;

  return (
    <div className="m3-panel m3-panel-book">
      <div className="m3-panel-head">
        <span className="m3-panel-title">ORDER BOOK</span>
        <span style={{ fontSize: 9, color: "rgba(94,234,212,0.8)" }}>depth20@100ms</span>
      </div>

      <div className="m3-panel-col-head">
        <span>PRICE</span><span className="right">SIZE</span><span className="right">TOTAL</span>
      </div>

      <div className="m3-book-rows">
        {askRows.map((r, i) => {
          const w = maxCum > 0 ? ((r.cum / maxCum) * 100).toFixed(1) : "0";
          return (
            <div key={i} className="m3-book-row">
              <div className="m3-book-row-fill ask" style={{ width: `${w}%` }} />
              <span className="m3-book-row-price ask">{formatPrice(r.price)}</span>
              <span className="m3-book-row-qty">{formatQty(r.qty)}</span>
              <span className="m3-book-row-cum">{formatQty(r.cum)}</span>
            </div>
          );
        })}
      </div>

      <div className="m3-book-mid">
        <span className="m3-book-mid-price">{mid ? formatPrice(mid) : "—"}</span>
        <span className="m3-book-mid-spread">
          SPREAD {spread.toFixed(3)} · {spreadBps.toFixed(1)}bp
        </span>
      </div>

      <div className="m3-book-rows" style={{ paddingBottom: 6 }}>
        {bidRows.map((r, i) => {
          const w = maxCum > 0 ? ((r.cum / maxCum) * 100).toFixed(1) : "0";
          return (
            <div key={i} className="m3-book-row">
              <div className="m3-book-row-fill bid" style={{ width: `${w}%` }} />
              <span className="m3-book-row-price bid">{formatPrice(r.price)}</span>
              <span className="m3-book-row-qty">{formatQty(r.qty)}</span>
              <span className="m3-book-row-cum">{formatQty(r.cum)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
