import { expect, test } from "@playwright/test";

const apps = [
  { name: "Cloud Files", url: "http://127.0.0.1:8082" },
  { name: "Cloud Media", url: "http://127.0.0.1:8090" },
];

for (const app of apps) {
  test(`${app.name} renders a stable entry surface`, async ({ page }) => {
    await page.goto(app.url);
    if (app.name === "Cloud Files") {
      await expect(page.getByRole("heading", { name: "Sign in to Cloud Files" })).toBeVisible();
      await expect(page.getByLabel("Username")).toBeVisible();
      await expect(page.getByLabel("Password")).toBeVisible();
    } else {
      await expect(page.getByRole("searchbox", { name: "Search Cloud Media" })).toBeVisible();
      await expect(page.getByLabel("Username")).toHaveCount(0);
      await expect(page.getByLabel("Password")).toHaveCount(0);
    }
    await expect(page.locator("body")).toHaveCSS("overflow-x", "hidden");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test(`${app.name} switches and persists OLED mode`, async ({ page, context }) => {
    await page.goto(app.url);
    await page.getByRole("button", { name: "Switch to oled theme" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "oled");
    await expect(page.locator(".app")).toHaveCSS("background-image", /noir-wallpaper/);
    expect((await context.cookies()).some((cookie) => cookie.name === "cloud-home_theme" && cookie.value === "oled")).toBe(true);
  });

  test(`${app.name} services menu exposes every surface`, async ({ page }) => {
    await page.goto(app.url);
    await page.getByRole("button", { name: "Switch app" }).click();
    await expect(page.locator(".app-switcher-trigger svg")).toHaveClass(/cloud-home-cloud-mark/);
    await expect(page.locator(".app-switcher-trigger")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    const switcherCenter = await page.locator(".app-switcher-trigger").evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return bounds.left + bounds.width / 2;
    });
    expect(switcherCenter).toBeGreaterThan((await page.viewportSize())!.width / 2);
    await expect(page.locator(".dropdown-label")).toHaveText("SERVICES");
    await expect(page.getByRole("menuitem", { name: "Cloud Media" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Cloud Files" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Local AI" })).toBeVisible();
    const extraService = page.locator(".app-switcher-item").filter({ has: page.locator(".app-glyph-extra") });
    await expect(extraService).toBeVisible();
    await expect(extraService).toHaveText(/^[a-z]+-[a-z]+$/);
    await expect(page.getByRole("menuitem", { name: "Cloud Media" })).toHaveAttribute("href", "http://127.0.0.1:8090");
    await expect(page.getByRole("menuitem", { name: "Cloud Files" })).toHaveAttribute("href", "http://127.0.0.1:8082");
    await expect(extraService).toHaveAttribute("href", "/api/navigation/extra-service/open");
    if (app.name === "Cloud Media") {
      await expect(page.locator(".app-glyph-media")).toHaveCSS("background-color", "rgb(255, 138, 31)");
      await expect(page.locator(".dropdown-check")).toHaveCSS("color", "rgb(255, 138, 31)");
    }
  });
}

test("Cloud Media keeps search visible without hover", async ({ page }) => {
  await page.route("**/api/auth/media/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ authenticated: true, user: { id: "user-1", name: "alice" }, csrf: "example" }),
  }));
  await page.route("**/api/media/proxy/**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: route.request().url().includes("Latest") ? "[]" : JSON.stringify({ Items: [] }),
  }));
  await page.goto("http://127.0.0.1:8090");
  const search = page.getByRole("searchbox", { name: "Search Cloud Media" });
  await expect(search).toBeVisible();
  const width = await search.evaluate((element) => element.getBoundingClientRect().width);
  expect(width).toBeGreaterThan(150);
});

test("Cloud Media refresh uses a neutral boot frame without the legacy F badge", async ({ page }) => {
  await page.route("**/api/auth/media/session", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authenticated: true, user: { id: "user-1", name: "alice" }, csrf: "example" }) });
  });
  await page.route("**/api/media/proxy/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: route.request().url().includes("Latest") ? "[]" : JSON.stringify({ Items: [] }) }));

  await page.goto("http://127.0.0.1:8090");
  await expect(page.getByLabel("Loading Cloud Media")).toBeVisible();
  await expect(page.locator(".boot-logo")).toHaveCount(0);
  await expect(page.getByRole("searchbox", { name: "Search Cloud Media" })).toBeVisible();
});

test("Cloud Media header is scaled, orange, and exposes app navigation", async ({ page }) => {
  const item = { Id: "item-1", Name: "Example movie", Type: "Movie", Overview: "A sharp modern description.", RunTimeTicks: 36_000_000_000 };
  await page.route("**/api/auth/media/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ authenticated: true, user: { id: "user-1", name: "alice" }, csrf: "example" }),
  }));
  await page.route("**/api/media/proxy/**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: route.request().url().includes("Latest") ? JSON.stringify([item]) : JSON.stringify({ Items: [] }),
  }));
  await page.goto("http://127.0.0.1:8090");

  const headerHeight = await page.locator(".topbar").evaluate((element) => element.getBoundingClientRect().height);
  expect(headerHeight).toBeGreaterThanOrEqual(68);
  expect(await page.locator(".brand").evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(23);
  await expect(page.locator(".brand-mark-media")).toHaveCSS("background-color", "rgb(255, 138, 31)");
  await expect(page.locator(".brand-mark-media svg")).toHaveClass(/lucide-clapperboard/);
  await expect(page.getByRole("searchbox", { name: "Search Cloud Media" })).toHaveAttribute("placeholder", "search...");
  await expect(page.locator(".hero .eyebrow")).toHaveText("Now watching");
  await expect(page.locator(".hero .eyebrow")).toHaveCSS("text-transform", "none");
  await expect(page.locator(".hero p")).toHaveCSS("font-family", /Plus Jakarta Sans/);
  await expect(page.locator(".hero p")).toHaveCSS("font-size", "14px");
  await expect(page.locator(".hero")).toHaveAttribute("style", /Images\/Primary/);
  await expect(page.getByRole("button", { name: "Play" })).toHaveCSS("border-radius", "999px");
  await expect(page.getByRole("button", { name: "More info" })).toHaveCSS("border-radius", "999px");

  await page.getByRole("button", { name: "Open Cloud Media menu" }).click();
  for (const name of ["Home", "Continue watching", "Recently added", "Movies", "Shows"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  }
  for (const name of ["Search library", "Surprise me", "Refresh home", "Open Jellyfin"]) {
    await expect(page.getByRole(name === "Open Jellyfin" ? "link" : "button", { name, exact: true })).toBeVisible();
  }
  await expect(page.locator(".cloud-media-menu-popover kbd")).toHaveCount(0);
  const menuButtonCenter = await page.getByRole("button", { name: "Close Cloud Media menu" }).evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return bounds.left + bounds.width / 2;
  });
  expect(menuButtonCenter).toBeGreaterThan((await page.viewportSize())!.width / 2);
  expect(await page.locator(".cloud-media-menu-trigger").evaluate((element) => element.getBoundingClientRect().width)).toBeLessThanOrEqual(34);
  expect(await page.locator(".cloud-media-menu-popover").evaluate((element) => element.getBoundingClientRect().width)).toBeLessThanOrEqual(230);
  await page.getByRole("button", { name: "Search library" }).click();
  await expect(page.getByRole("searchbox", { name: "Search Cloud Media" })).toBeFocused();
});

test("Cloud Media series modal loads episodes and plays the next episode", async ({ page }) => {
  const series = {
    Id: "series-1",
    Name: "Billions",
    Type: "Series",
    ProductionYear: 2016,
    Overview: "Power politics in New York high finance.",
    RunTimeTicks: 1,
  };
  const episodes = [
    { Id: "episode-1", Name: "Pilot", Type: "Episode", ParentIndexNumber: 1, IndexNumber: 1, RunTimeTicks: 3_420_000_000, Overview: "Chuck begins his investigation.", UserData: { Played: false } },
    { Id: "episode-2", Name: "Naming Rights", Type: "Episode", ParentIndexNumber: 1, IndexNumber: 2, RunTimeTicks: 3_360_000_000, Overview: "Axe makes his next move.", UserData: { Played: false } },
  ];

  await page.route("**/api/auth/media/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ authenticated: true, user: { id: "user-1", name: "alice" }, csrf: "example" }),
  }));
  await page.route("**/api/media/proxy/**", (route) => {
    const url = route.request().url();
    if (url.includes("Shows/series-1/Episodes")) return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ Items: episodes }),
    });
    if (url.includes("PlaybackInfo")) return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ PlaySessionId: "play-1", MediaSources: [{ Id: "source-1", SupportsDirectPlay: true, SupportsTranscoding: true, MediaStreams: [] }] }),
    });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: url.includes("IncludeItemTypes=Series") ? JSON.stringify({ Items: [series] }) : url.includes("Latest") ? "[]" : JSON.stringify({ Items: [] }),
    });
  });
  await page.route("**/api/media/tickets", (route) => route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ticket: "example" }) }));

  await page.goto("http://127.0.0.1:8090");
  await page.getByRole("button", { name: /Billions/ }).click();

  await expect(page.getByRole("heading", { name: "Season 1" })).toBeVisible();
  await expect(page.getByRole("button", { name: /S1 E1.*Pilot/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /S1 E2.*Naming Rights/ })).toBeVisible();
  await expect(page.locator(".details-card")).not.toContainText("0 min");
  await expect(page.locator(".details-copy > p")).toHaveCSS("font-size", "13px");
  const playNext = page.getByRole("button", { name: "Play next" });
  await expect(playNext).toHaveCSS("border-radius", "999px");
  await expect(playNext).toHaveCSS("font-size", "14.5px");
  await playNext.click();
  await expect(page.locator(".player-top strong")).toHaveText("Pilot");
});

test("Cloud Media surfaces an authenticated Jellyfin failure", async ({ page }) => {
  await page.route("**/api/auth/media/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ authenticated: true, user: { id: "user-1", name: "alice" }, csrf: "example" }),
  }));
  await page.route("**/api/media/proxy/**", (route) => route.fulfill({
    status: 502,
    contentType: "application/json",
    body: JSON.stringify({ error: "Jellyfin is unavailable" }),
  }));
  await page.goto("http://127.0.0.1:8090");
  await expect(page.getByRole("heading", { name: "Couldn’t load Cloud Media" })).toBeVisible();
  await expect(page.getByText("Jellyfin is unavailable")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
});

test("Cloud Media player shows a streaming-style time preview", async ({ page }) => {
  const item = { Id: "item-1", Name: "Example movie", Type: "Movie", RunTimeTicks: 36_000_000_000 };
  await page.route("**/api/auth/media/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ authenticated: true, user: { id: "user-1", name: "alice" }, csrf: "example" }),
  }));
  await page.route("**/api/media/tickets", (route) => route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ticket: "example" }) }));
  await page.route("**/api/media/stream/**", (route) => route.fulfill({ status: 206, contentType: "video/mp4", body: "" }));
  await page.route("**/api/media/proxy/**", (route) => {
    const url = route.request().url();
    if (url.includes("/Subtitles/")) return route.fulfill({
      status: 200,
      contentType: "text/vtt",
      body: "WEBVTT\n\n00:00:00.000 --> 00:10:00.000\nFirst cue\n",
    });
    if (url.includes("PlaybackInfo")) return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ PlaySessionId: "play-1", MediaSources: [{ Id: "source-1", SupportsDirectPlay: true, SupportsTranscoding: true, MediaStreams: [{ Index: 0, Type: "Subtitle", Codec: "subrip" }] }] }),
    });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: url.includes("Latest") ? JSON.stringify([item]) : JSON.stringify({ Items: [] }),
    });
  });
  await page.goto("http://127.0.0.1:8090");
  await page.getByRole("button", { name: "Play" }).click();
  const seek = page.getByRole("slider", { name: "Seek video" });
  await seek.hover({ position: { x: 100, y: 8 } });
  await expect(page.locator(".seek-preview")).toBeVisible();
  await expect(page.locator(".seek-preview strong")).toHaveText(/\d+:\d{2}/);
  await expect(page.locator(".seek-thumbnail")).toHaveCount(0);
  await page.getByRole("button", { name: "Subtitle settings" }).click();
  await page.getByLabel("Subtitle track").selectOption("0");
  await expect.poll(() => page.locator("video track").evaluate((track: HTMLTrackElement) => track.track.cues?.length ?? 0)).toBe(1);
  await page.getByRole("button", { name: "Done" }).click();
  await page.locator("video").evaluate((video) => {
    const textTrack = video.querySelector("track")!.track;
    Object.defineProperty(textTrack, "activeCues", { configurable: true, value: textTrack.cues });
    video.dispatchEvent(new Event("timeupdate"));
  });
  await expect(page.locator(".subtitle-layer")).toHaveText("First cue");
  await page.locator(".player-shell").evaluate((shell) => {
    Object.defineProperty(shell, "requestFullscreen", {
      configurable: true,
      value: () => { shell.setAttribute("data-fullscreen-requested", "true"); return Promise.resolve(); },
    });
  });
  await page.getByRole("button", { name: "Enter fullscreen" }).click();
  await expect(page.locator(".player-shell")).toHaveAttribute("data-fullscreen-requested", "true");
  await expect(page.locator(".player-shell > .subtitle-layer")).toHaveText("First cue");
  await page.locator("video").evaluate((video) => {
    const textTrack = video.querySelector("track")!.track;
    Object.defineProperty(textTrack, "activeCues", { configurable: true, value: null });
    video.dispatchEvent(new Event("timeupdate"));
  });
  await expect(page.locator(".subtitle-layer")).toHaveCount(0);
});

test("Cloud Files renders Finder-style tiles with download and drag-to-move", async ({ page }) => {
  const moves: string[] = [];
  await page.route("**/api/auth/files/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ authenticated: true, user: { id: "user-1", name: "alice" }, csrf: "example" }),
  }));
  await page.route("**/api/files/proxy/usage", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ total: 10_000, used: 2_500 }) }));
  await page.route("**/api/files/proxy/resources/**", (route) => {
    if (route.request().method() === "PATCH") moves.push(route.request().url());
    return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      name: "/",
      path: "/",
      size: 0,
      isDir: true,
      modified: "2026-07-10T00:00:00Z",
      items: [
        { name: "Documents", path: "/Documents", size: 0, isDir: true, modified: "2026-07-10T00:00:00Z" },
        { name: "report.pdf", path: "/report.pdf", size: 2048, isDir: false, modified: "2026-07-10T00:00:00Z" },
        { name: ".secret", path: "/.secret", size: 12, isDir: false, modified: "2026-07-10T00:00:00Z" },
      ],
    }),
    });
  });
  await page.goto("http://127.0.0.1:8082");
  await expect(page.locator(".file-view").getByRole("button", { name: "Documents", exact: true })).toBeVisible();
  await expect(page.locator("button button")).toHaveCount(0);
  await expect(page.locator(".brand")).toContainText("Cloud Files");
  await expect(page.locator(".storage-meter")).toContainText("free");
  await expect(page.locator(".file-view").getByRole("button", { name: ".secret", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Show hidden files" }).click();
  await expect(page.locator(".file-view").getByRole("button", { name: ".secret", exact: true })).toBeVisible();
  await page.locator(".file-view").getByRole("button", { name: "report.pdf", exact: true }).click();
  await expect(page.getByRole("link", { name: "Download" })).toHaveAttribute("href", "/api/files/proxy/raw/report.pdf");
  await page.locator(".file-item").filter({ hasText: "report.pdf" }).dragTo(page.locator(".file-item").filter({ hasText: "Documents" }));
  await expect.poll(() => moves.length).toBe(1);
  expect(moves[0]).toContain("action=rename");
  expect(decodeURIComponent(moves[0])).toContain("destination=/Documents/report.pdf");
});

test("Cloud Files opens code and PDF files in polished viewers", async ({ page }) => {
  const files = [
    { name: "notes.ts", path: "/notes.ts", size: 48, isDir: false, modified: "2026-07-10T00:00:00Z" },
    { name: "manual.pdf", path: "/manual.pdf", size: 1024, isDir: false, modified: "2026-07-10T00:00:00Z" },
  ];
  await page.route("**/api/auth/files/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ authenticated: true, user: { id: "user-1", name: "alice" }, csrf: "example" }),
  }));
  await page.route("**/api/files/proxy/usage", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ total: 10_000, used: 2_500 }) }));
  await page.route("**/api/files/proxy/resources/**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ name: "/", path: "/", size: 0, isDir: true, modified: "2026-07-10T00:00:00Z", items: files }),
  }));
  await page.route("**/api/files/proxy/raw**", (route) => route.fulfill({
    status: 200,
    contentType: route.request().url().includes("manual.pdf") ? "application/pdf" : "text/plain",
    body: route.request().url().includes("manual.pdf") ? "%PDF-1.4\n%%EOF" : "export const answer: number = 42;\n",
  }));

  await page.goto("http://127.0.0.1:8082");
  await page.locator(".file-view").getByRole("button", { name: "notes.ts", exact: true }).dblclick();
  await expect(page.locator(".monaco-editor")).toBeVisible();
  await expect(page.locator(".editor-status")).toContainText("typescript");
  await expect(page.locator(".viewer-actions").getByRole("link", { name: "Download" })).toBeVisible();
  await page.locator(".viewer-header").getByRole("button").last().click();

  await page.locator(".file-view").getByRole("button", { name: "manual.pdf", exact: true }).dblclick();
  await expect(page.locator(".pdf-frame")).toBeVisible();
  await expect(page.locator(".viewer-actions").getByRole("link", { name: "Open" })).toHaveAttribute("target", "_blank");
});

test("Cloud Files stays gated while Cloud Media auto-authenticates", async ({ request }) => {
  expect((await request.get("http://127.0.0.1:8082/api/auth/files/session")).status()).toBe(401);
  expect((await request.get("http://127.0.0.1:8090/api/auth/media/session")).status()).toBe(200);
});

test("Open WebUI stays on its pre-Cloud Files frontend", async ({ page }) => {
  await page.goto("http://127.0.0.1:3003");
  await expect(page.locator("cloud-home-switcher")).toHaveCount(0);
  expect(await page.title()).not.toBe("");
});
