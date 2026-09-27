import { BinanceClient } from "@nemesis-oss/binance-sdk";

/** Shared client for public USDⓈ-M market data — no API key needed for these endpoints. */
export const binanceClient = new BinanceClient();
