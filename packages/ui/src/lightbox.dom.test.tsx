// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { Lightbox, type LightboxItem } from "./lightbox";

const items: LightboxItem[] = [
  { name: "IMG_0001.HEIC", kind: "image", previewUrl: "/p/big", fullUrl: "/p/raw" },
];

describe("lightbox stacking", () => {
  it("renders into <body>, not inside its host's stacking context", () => {
    // Rendered inline, the lightbox sits inside `.app > main` (z-index 1)
    // while the topbar is z-index 50 — so its header bar (close, download,
    // Show in Drive) painted UNDERNEATH the topbar and was invisible, with
    // only the absolutely-positioned arrows showing. Found in Photos
    // 2026-07-28 by screenshot; no helper unit test could see it.
    const host = document.createElement("div");
    host.style.zIndex = "1";
    host.style.position = "relative";
    document.body.appendChild(host);

    act(() => {
      createRoot(host).render(
        <Lightbox items={items} index={0} onClose={() => {}} onNavigate={() => {}} />,
      );
    });

    const box = document.querySelector(".lightbox");
    expect(box).not.toBeNull();
    expect(host.contains(box)).toBe(false);
    expect(box!.parentElement).toBe(document.body);
    // the header bar and its controls must actually be in the tree
    expect(document.querySelector(".lightbox-bar")).not.toBeNull();
    expect(document.querySelector(".lightbox-name")!.textContent).toBe("IMG_0001.HEIC");
    expect(document.querySelector(".lightbox-actions a[download]")).not.toBeNull();
  });
});
