import type {
  ISeriesPrimitive,
  SeriesAttachedParameter,
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
  Time,
} from "lightweight-charts";

export type SmcOverlayDrawFn = (ctx: CanvasRenderingContext2D, width: number, height: number) => void;

class SmcOverlayPaneRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly getDrawFn: () => SmcOverlayDrawFn | null) {}

  draw(target: Parameters<IPrimitivePaneRenderer["draw"]>[0]) {
    const drawFn = this.getDrawFn();
    if (!drawFn) return;
    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      drawFn(context, mediaSize.width, mediaSize.height);
    });
  }
}

class SmcOverlayPaneView implements IPrimitivePaneView {
  private readonly _renderer: SmcOverlayPaneRenderer;

  constructor(getDrawFn: () => SmcOverlayDrawFn | null) {
    this._renderer = new SmcOverlayPaneRenderer(getDrawFn);
  }

  renderer() {
    return this._renderer;
  }
}

/**
 * Renders the SMC/ICT box, zone and marker overlays as a native chart
 * primitive instead of a separately positioned <canvas>. The chart calls
 * this on every internal repaint (pan/zoom/resize), so callers only need
 * requestUpdate() when data changes outside of those events.
 *
 * The actual drawing logic lives in TradingViewChart (it closes over many
 * component refs) and is supplied via setDrawFn.
 */
export class SmcOverlayPrimitive implements ISeriesPrimitive<Time> {
  private _drawFn: SmcOverlayDrawFn | null = null;
  private _requestUpdate: (() => void) | null = null;
  private readonly _paneViews: IPrimitivePaneView[];

  constructor() {
    this._paneViews = [new SmcOverlayPaneView(() => this._drawFn)];
  }

  setDrawFn(fn: SmcOverlayDrawFn) {
    this._drawFn = fn;
  }

  requestUpdate() {
    this._requestUpdate?.();
  }

  attached(param: SeriesAttachedParameter<Time>) {
    this._requestUpdate = param.requestUpdate;
  }

  detached() {
    this._requestUpdate = null;
  }

  updateAllViews() {}

  paneViews() {
    return this._paneViews;
  }
}
