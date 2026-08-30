import { describe, it, expect } from "vitest";
import { DepthBook } from "./depthSync";

function snap(lastUpdateId: number, bids: [string, string][], asks: [string, string][]) {
  return { lastUpdateId, bids, asks };
}

function evt(U: number, u: number, pu: number, bids: [string, string][] = [], asks: [string, string][] = []) {
  return { U, u, pu, bids, asks };
}

describe("DepthBook", () => {
  it("is not synced before a snapshot is loaded", () => {
    const book = new DepthBook();
    expect(book.isSynced).toBe(false);
  });

  it("loads a snapshot into sorted bid/ask state", () => {
    const book = new DepthBook();
    book.loadSnapshot(snap(100, [["10.0", "1"], ["9.0", "2"]], [["11.0", "1"], ["12.0", "2"]]));
    const state = book.getState();
    expect(state.lastUpdateId).toBe(100);
    expect(state.bids).toEqual([{ price: 10, qty: 1 }, { price: 9, qty: 2 }]); // descending
    expect(state.asks).toEqual([{ price: 11, qty: 1 }, { price: 12, qty: 2 }]); // ascending
  });

  it("drops events fully older than the snapshot", () => {
    const book = new DepthBook();
    book.loadSnapshot(snap(100, [], []));
    const result = book.applyEvent(evt(90, 99, 89));
    expect(result).toBe("dropped");
    expect(book.isSynced).toBe(false);
  });

  it("bridges the first event when U <= lastUpdateId <= u, becomes synced", () => {
    const book = new DepthBook();
    book.loadSnapshot(snap(100, [["10.0", "1"]], []));
    const result = book.applyEvent(evt(95, 105, 94, [["10.0", "1.5"]], []));
    expect(result).toBe("applied");
    expect(book.isSynced).toBe(true);
    expect(book.getState().bids).toEqual([{ price: 10, qty: 1.5 }]);
    expect(book.getState().lastUpdateId).toBe(105);
  });

  it("reports a gap when the first event does not bridge the snapshot (U too high)", () => {
    const book = new DepthBook();
    book.loadSnapshot(snap(100, [], []));
    const result = book.applyEvent(evt(101, 110, 100));
    expect(result).toBe("gap");
    expect(book.isSynced).toBe(false);
  });

  it("applies continuous events (pu matches previous u)", () => {
    const book = new DepthBook();
    book.loadSnapshot(snap(100, [["10.0", "1"]], []));
    book.applyEvent(evt(95, 105, 94, [["10.0", "2"]], []));
    const result = book.applyEvent(evt(106, 108, 105, [["10.0", "3"]], []));
    expect(result).toBe("applied");
    expect(book.getState().bids).toEqual([{ price: 10, qty: 3 }]);
  });

  it("reports a gap when pu does not match the previous u", () => {
    const book = new DepthBook();
    book.loadSnapshot(snap(100, [["10.0", "1"]], []));
    book.applyEvent(evt(95, 105, 94));
    const result = book.applyEvent(evt(107, 110, 106)); // pu=106, but previous u was 105
    expect(result).toBe("gap");
  });

  it("removes a price level when qty is 0", () => {
    const book = new DepthBook();
    book.loadSnapshot(snap(100, [["10.0", "1"], ["9.0", "2"]], []));
    book.applyEvent(evt(95, 105, 94, [["9.0", "0"]], []));
    expect(book.getState().bids).toEqual([{ price: 10, qty: 1 }]);
  });

  it("inserts a new price level not present in the snapshot", () => {
    const book = new DepthBook();
    book.loadSnapshot(snap(100, [["10.0", "1"]], []));
    book.applyEvent(evt(95, 105, 94, [["10.5", "3"]], []));
    expect(book.getState().bids).toEqual([{ price: 10.5, qty: 3 }, { price: 10, qty: 1 }]);
  });
});
