// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

// The session probe is the only thing these tests vary; everything else is
// stubbed so the render is decided purely by whether a session exists.
const ensurePhotosSession = vi.fn();
const listPhotos = vi.fn();
const listAlbums = vi.fn();
const createAlbum = vi.fn();
const organizePhotos = vi.fn();

vi.mock("./api", () => ({
  PHOTOS_ROOT: "photos",
  ensurePhotosSession: (...args: unknown[]) => ensurePhotosSession(...args),
  listPhotos: (...args: unknown[]) => listPhotos(...args),
  listAlbums: (...args: unknown[]) => listAlbums(...args),
  createAlbum: (...args: unknown[]) => createAlbum(...args),
  organizePhotos: (...args: unknown[]) => organizePhotos(...args),
  albumCover: () => Promise.resolve(null),
  browseDrive: () => Promise.resolve([]),
  getSession: () => Promise.resolve(null),
  login: () => Promise.reject(new Error("not used")),
  loginPhotos: () => Promise.resolve({}),
  logoutPhotos: () => Promise.resolve(),
  importFromDrive: () => Promise.resolve({ done: 0, failed: [] }),
  isIngestibleMedia: () => true,
  uploadToAlbum: () => Promise.resolve({ done: 0, failed: [] }),
  setSessionLostHandler: () => undefined,
  thumbUrl: () => "", previewUrl: () => "", fullUrl: () => "",
  monthGroups: () => [],
}));

async function render() {
  const host = document.createElement("div");
  document.body.append(host);
  const { default: App } = await import("./App");
  await act(async () => { createRoot(host).render(<App />); });
  await act(async () => { await Promise.resolve(); });
  return host;
}

describe("photos auth gate", () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = "";
    listPhotos.mockResolvedValue([]);
    listAlbums.mockResolvedValue([]);
  });

  it("asks for a sign-in when there is no session yet", async () => {
    // Regression: the gate used to be reachable only by clicking sign-out, so
    // a first visit with no session rendered the empty gallery plus a bare
    // "authentication required" string from the failed listing.
    ensurePhotosSession.mockResolvedValue(false);
    const host = await render();
    expect(host.querySelector(".login-stage")).not.toBeNull();
    expect(listPhotos).not.toHaveBeenCalled();
  });

  it("loads the library when a session is already live", async () => {
    ensurePhotosSession.mockResolvedValue(true);
    const host = await render();
    expect(host.querySelector(".login-stage")).toBeNull();
    expect(listPhotos).toHaveBeenCalled();
  });
});
