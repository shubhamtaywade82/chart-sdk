import React from "react";
import type { OrderBookState } from "../../../server/binance/engine/types";
import { formatPrice, formatQty } from "../market3d/dataService";

interface OrderBookLadderProps {
  book: OrderBookState | null;
  livePrice: number | null;
  rows?: number;
}

export function OrderBookLadder({ book, livePrice, rows = 12 }: OrderBookLadderProps) {
  if (!book) {
    return (
      <div className="m2-ladder">
        <div className="m2-panel-head"><span className="m2-panel-title">ORDER BOOK</span></div>
      </div>
    );
  }

  const asks = book.asks.slice(0, rows);
  const bids = book.bids.slice(0, rows);

  let cumAsk = 0;
  let maxCum = 0;
  const askRows = asks
    .map((l) => {
      cumAsk += l.qty;
      maxCum = Math.max(maxCum, cumAsk);
      return { price: l.price, qty: l.qty, cum: cumAsk };
    })
    .reverse();

  let cumBid = 0;
  const bidRows = bids.map((l) => {
    cumBid += l.qty;
    maxCum = Math.max(maxCum, cumBid);
    return { price: l.price, qty: l.qty, cum: cumBid };
  });

  const bestBid = bids[0]?.price ?? 0;
  const bestAsk = asks[0]?.price ?? 0;
  const mid = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : livePrice || 0;
  const spread = bestBid && bestAsk ? bestAsk - bestBid : 0;
  const spreadBps = mid > 0 ? (spread / mid) * 1e4 : 0;

  return (
    <div className="m2-ladder">
      <div className="m2-panel-head">
        <span className="m2-panel-title">ORDER BOOK</span>
        <span style={{ fontSize: 9, color: "rgba(94,234,212,0.8)" }}>depth20@100ms</span>
      </div>
      <div className="m2-ladder-col-head">
        <span>PRICE</span><span className="right">SIZE</span><span className="right">TOTAL</span>
      </div>

      <div className="m2-ladder-rows">
        {askRows.map((r, i) => {
          const w = maxCum > 0 ? ((r.cum / maxCum) * 100).toFixed(1) : "0";
          return (
            <div key={`a${i}`} className="m2-ladder-row">
              <div className="m2-ladder-row-fill ask" style={{ width: `${w}%` }} />
              <span className="m2-ladder-row-price ask">{formatPrice(r.price)}</span>
              <span className="m2-ladder-row-qty">{formatQty(r.qty)}</span>
              <span className="m2-ladder-row-cum">{formatQty(r.cum)}</span>
            </div>
          );
        })}
      </div>

      <div className="m2-ladder-mid">
        <span className="m2-ladder-mid-price">{mid ? formatPrice(mid) : "—"}</span>
        <span className="m2-ladder-mid-spread">SPREAD {spread.toFixed(3)} · {spreadBps.toFixed(1)}bp</span>
      </div>

      <div className="m2-ladder-rows">
        {bidRows.map((r, i) => {
          const w = maxCum > 0 ? ((r.cum / maxCum) * 100).toFixed(1) : "0";
          return (
            <div key={`b${i}`} className="m2-ladder-row">
              <div className="m2-ladder-row-fill bid" style={{ width: `${w}%` }} />
              <span className="m2-ladder-row-price bid">{formatPrice(r.price)}</span>
              <span className="m2-ladder-row-qty">{formatQty(r.qty)}</span>
              <span className="m2-ladder-row-cum">{formatQty(r.cum)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
