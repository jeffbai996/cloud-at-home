// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

import { paintRollingTime } from "./rollingTime";

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement("span");
  document.body.replaceChildren(host);
});

describe("paintRollingTime", () => {
  it("builds one cell per character with digit/mark classes", () => {
    paintRollingTime(host, "1:23:45");
    expect(host.children).toHaveLength(7);
    expect(host.querySelectorAll(".time-wheel-digit")).toHaveLength(5);
    expect(host.querySelectorAll(".time-wheel-mark")).toHaveLength(2);
    expect(host.getAttribute("aria-label")).toBe("1:23:45");
  });

  it("rolls only the digits that changed", () => {
    paintRollingTime(host, "0:09");
    paintRollingTime(host, "0:19");
    const cells = [...host.querySelectorAll(".time-wheel-digit")];
    expect(cells[1].classList.contains("rolling")).toBe(true);
    expect(cells[1].querySelector(".time-wheel-old")?.textContent).toBe("0");
    expect(cells[1].querySelector(".time-wheel-new")?.textContent).toBe("1");
    expect(cells[0].classList.contains("rolling")).toBe(false);
    expect(cells[2].classList.contains("rolling")).toBe(false);
  });

  it("grows right-aligned so reused digits still roll (59:59 -> 1:00:00)", () => {
    paintRollingTime(host, "59:59");
    paintRollingTime(host, "1:00:00");
    expect(host.children).toHaveLength(7);
    expect(host.getAttribute("aria-label")).toBe("1:00:00");
  });

  it("settles the roll markup back to a single face", () => {
    vi.useFakeTimers();
    try {
      paintRollingTime(host, "0:00");
      paintRollingTime(host, "0:01");
      vi.advanceTimersByTime(400);
      const seconds = [...host.querySelectorAll(".time-wheel-digit")].at(-1)!;
      expect(seconds.classList.contains("rolling")).toBe(false);
      expect(seconds.querySelector(".time-wheel-face")?.textContent).toBe("1");
    } finally {
      vi.useRealTimers();
    }
  });
});
