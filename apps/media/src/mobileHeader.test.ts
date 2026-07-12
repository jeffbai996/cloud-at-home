import { describe, expect, it } from "vitest";

import { mobileHeaderScrollIntent } from "./mobileHeader";

describe("mobile header scroll intent", () => {
  it("shows near the top and when scrolling up", () => {
    expect(mobileHeaderScrollIntent(120, 40)).toBe("show");
    expect(mobileHeaderScrollIntent(240, 224)).toBe("show");
  });

  it("hides on a deliberate downward scroll", () => {
    expect(mobileHeaderScrollIntent(100, 116)).toBe("hide");
  });

  it("ignores tiny scroll jitter", () => {
    expect(mobileHeaderScrollIntent(100, 106)).toBeNull();
    expect(mobileHeaderScrollIntent(100, 94)).toBeNull();
  });
});
