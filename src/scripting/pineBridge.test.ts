import { describe, it, expect } from "vitest";
import { taEmaPine, taSmaPine } from "./pineBridge";
import { taEma, taSma } from "./taMath";

const CLOSES = [10, 11, 12, 11, 13, 15, 14, 16, 18, 17, 19, 20, 18, 21, 22];

describe("pineBridge parity with taMath", () => {
  it("taEmaPine matches taEma bar-for-bar", () => {
    const expected = taEma(CLOSES, 5);
    const actual = taEmaPine(CLOSES, 5);
    expect(actual).toHaveLength(expected.length);
    actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 10));
  });

  it("taSmaPine matches taSma bar-for-bar, including NaN warmup", () => {
    const expected = taSma(CLOSES, 5);
    const actual = taSmaPine(CLOSES, 5);
    expect(actual).toHaveLength(expected.length);
    actual.forEach((v, i) => {
      if (Number.isNaN(expected[i])) expect(v).toBeNaN();
      else expect(v).toBeCloseTo(expected[i], 10);
    });
  });
});
