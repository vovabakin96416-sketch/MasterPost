import { describe, expect, it } from "vitest";
import {
  LAST_CAMPAIGN_WEEK,
  shouldWarnContentEnding,
} from "../src/core/analytics/contentEnding";

describe("shouldWarnContentEnding", () => {
  it("true только на последней (4-й) неделе плана", () => {
    expect(shouldWarnContentEnding(4)).toBe(true);
  });

  it("false на неделях 1–3", () => {
    expect(shouldWarnContentEnding(1)).toBe(false);
    expect(shouldWarnContentEnding(2)).toBe(false);
    expect(shouldWarnContentEnding(3)).toBe(false);
  });

  it("false на граничных/некорректных значениях", () => {
    expect(shouldWarnContentEnding(0)).toBe(false);
    expect(shouldWarnContentEnding(5)).toBe(false);
    expect(shouldWarnContentEnding(-1)).toBe(false);
  });

  it("LAST_CAMPAIGN_WEEK = 4", () => {
    expect(LAST_CAMPAIGN_WEEK).toBe(4);
    expect(shouldWarnContentEnding(LAST_CAMPAIGN_WEEK)).toBe(true);
  });
});
