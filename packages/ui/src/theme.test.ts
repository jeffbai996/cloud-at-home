import { describe, expect, it } from "vitest";

import { readTheme, serviceHref, serviceUrl, writeTheme } from "./theme";

describe("theme preference", () => {
  it("defaults to noir and only accepts known values", () => {
    expect(readTheme("")) .toBe("noir");
    expect(readTheme("cloud-home_theme=oled")).toBe("oled");
    expect(readTheme("cloud-home_theme=beige")).toBe("noir");
  });

  it("writes a cross-port hostname cookie", () => {
    expect(writeTheme("oled", false)).toContain("cloud-home_theme=oled");
    expect(writeTheme("oled", false)).toContain("SameSite=Lax");
    expect(writeTheme("oled", true)).toContain("Secure");
  });

  it("builds service links for the browser host instead of localhost", () => {
    expect(serviceUrl("server.example", 8090, 8453, false)).toBe("http://server.example:8090");
    expect(serviceUrl("100.64.0.8", 8082, 8454, false)).toBe("http://100.64.0.8:8082");
    expect(serviceUrl("server.example", 8090, 8453, true)).toBe("https://server.example:8453");
  });

  it("adds tailnet-only service mount paths without breaking local links", () => {
    expect(serviceHref("server.example", 8765, 8444, false, "/search")).toBe("http://server.example:8765");
    expect(serviceHref("server.example", 8765, 8444, true, "/search")).toBe("https://server.example:8444/search");
  });
});
