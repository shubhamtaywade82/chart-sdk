import React from "react";
import { TradeItem } from "./types";
import { formatPrice, formatQty, formatClock } from "./dataService";

interface TimeAndSalesPanelProps {
  trades: TradeItem[];
  isOpen: boolean;
}

export function TimeAndSalesPanel({ trades, isOpen }: TimeAndSalesPanelProps) {
  if (!isOpen) return null;

  return (
    <div className="m3-panel m3-panel-tape">
      <div className="m3-panel-head">
        <span className="m3-panel-title">TIME &amp; SALES</span>
        <span style={{ fontSize: 9, color: "rgba(196,181,253,0.8)" }}>aggTrade</span>
      </div>

      <div className="m3-panel-col-head">
        <span>TIME</span><span className="right">PRICE</span><span className="right">AMT</span>
      </div>

      <div className="m3-tape-list">
        {trades.slice(0, 24).map((t, idx) => {
          const isBig = t.usd > 6000;
          const bigClass = isBig ? (t.isSell ? "big-sell" : "big-buy") : "";
          return (
            <div key={idx} className={`m3-tape-row ${bigClass}`}>
              <span className="m3-tape-time">{formatClock(t.time)}</span>
              <span className={`m3-tape-price ${t.isSell ? "sell" : "buy"}`}>
                {formatPrice(t.price)}
              </span>
              <span className={`m3-tape-qty ${isBig ? "big" : ""}`}>
                {formatQty(t.qty)}{isBig ? " ⚡" : ""}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
