import { describe, expect, it } from "vitest";
import { main as checkInternalLinks } from "../scripts/check-internal-links.mjs";

describe("internal link check", () => {
  it("has no broken internal links or image references", () => {
    const report = checkInternalLinks();
    expect(report.brokenLinks).toEqual([]);
    expect(report.brokenImages).toEqual([]);
  });
});
