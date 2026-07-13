import { expect, test } from "@playwright/test";

const apps = [
  { name: "Cloud", url: "http://127.0.0.1:8082" },
  { name: "Video", url: "http://127.0.0.1:8090" },
];

for (const app of apps) {
  test(`${app.name} renders a stable entry surface`, async ({ page }) => {
    await page.goto(app.url);
    if (app.name === "Cloud") {
      await expect(page.getByRole("heading", { name: "Sign in to Cloud" })).toBeVisible();
      await expect(page.getByLabel("Username")).toBeVisible();
      await expect(page.getByLabel("Password")).toBeVisible();
    } else {
      await expect(page.getByRole("searchbox", { name: "Search Video" })).toBeVisible();
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
    await expect(page.getByRole("menuitem", { name: "Video" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Cloud" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Local AI" })).toBeVisible();
    const extraService = page.locator(".app-switcher-item").filter({ has: page.locator(".app-glyph-extra") });
    await expect(extraService).toBeVisible();
    await expect(extraService).toHaveText(/^[a-z]+-[a-z]+$/);
    await expect(page.getByRole("menuitem", { name: "Video" })).toHaveAttribute("href", "http://127.0.0.1:8090");
    await expect(page.getByRole("menuitem", { name: "Cloud" })).toHaveAttribute("href", "http://127.0.0.1:8082");
    await expect(extraService).toHaveAttribute("href", "/api/navigation/extra-service/open");
    if (app.name === "Video") {
      await expect(page.locator(".app-glyph-media")).toHaveCSS("background-color", "rgb(255, 138, 31)");
      await expect(page.locator(".dropdown-check")).toHaveCSS("color", "rgb(255, 138, 31)");
    }
  });
}

test("Video keeps search visible without hover", async ({ page }) => {
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
  const search = page.getByRole("searchbox", { name: "Search Video" });
  await expect(search).toBeVisible();
  const width = await search.evaluate((element) => element.getBoundingClientRect().width);
  expect(width).toBeGreaterThan(150);
});

test("Video refresh uses a neutral boot frame without the legacy F badge", async ({ page }) => {
  await page.route("**/api/auth/media/session", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authenticated: true, user: { id: "user-1", name: "alice" }, csrf: "example" }) });
  });
  await page.route("**/api/media/proxy/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: route.request().url().includes("Latest") ? "[]" : JSON.stringify({ Items: [] }) }));

  await page.goto("http://127.0.0.1:8090");
  await expect(page.getByLabel("Loading Video")).toBeVisible();
  await expect(page.locator(".boot-logo")).toHaveCount(0);
  await expect(page.getByRole("searchbox", { name: "Search Video" })).toBeVisible();
});

test("Video treats a session service failure as an outage, not a logout", async ({ page }) => {
  await page.route("**/api/auth/media/session", (route) => route.fulfill({
    status: 502,
    contentType: "application/json",
    body: JSON.stringify({ error: "Jellyfin is unavailable" }),
  }));

  await page.goto("http://127.0.0.1:8090");
  await expect(page.getByRole("heading", { name: "Video is temporarily unavailable" })).toBeVisible();
  await expect(page.getByText("502: Jellyfin is unavailable")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sign in to Video" })).toHaveCount(0);
});

test("Video header is scaled, orange, and exposes app navigation", async ({ page }) => {
  const item = { Id: "item-1", Name: "Example movie", Type: "Movie", Overview: "A sharp modern description.", RunTimeTicks: 36_000_000_000, UserData: { PlaybackPositionTicks: 6_000_000_000, PlayedPercentage: 16.7, Played: false } };
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
  await expect(page.getByRole("searchbox", { name: "Search Video" })).toHaveAttribute("placeholder", "search...");
  await expect(page.locator(".hero .eyebrow")).toHaveText("NOW WATCHING");
  await expect(page.locator(".hero .eyebrow")).toHaveCSS("text-transform", "uppercase");
  await expect(page.locator(".hero p")).toHaveCSS("font-family", /Plus Jakarta Sans/);
  await expect(page.locator(".hero p")).toHaveCSS("font-size", "14px");
  await expect(page.locator(".hero")).toHaveAttribute("style", /Images\/Primary/);
  await expect(page.getByRole("button", { name: "Resume" })).toHaveCSS("border-radius", "999px");
  await expect(page.getByRole("button", { name: "Play from beginning" })).toHaveCSS("border-radius", "999px");
  await expect(page.getByRole("button", { name: "More info" })).toHaveCSS("border-radius", "999px");
  await expect(page.getByRole("button", { name: /My List/ })).toBeVisible();

  await page.getByRole("button", { name: "Open Video menu" }).click();
  for (const name of ["Home", "Continue watching", "Recently added", "Movies", "Shows"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  }
  for (const name of ["Search library", "My List", "Surprise me", "Refresh home", "Cinema mode", "Open Jellyfin"]) {
    await expect(page.getByRole(name === "Open Jellyfin" ? "link" : "button", { name, exact: true })).toBeVisible();
  }
  await expect(page.locator(".cloud-media-menu-popover kbd")).toHaveCount(0);
  const menuButtonCenter = await page.getByRole("button", { name: "Close Video menu" }).evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return bounds.left + bounds.width / 2;
  });
  expect(menuButtonCenter).toBeGreaterThan((await page.viewportSize())!.width / 2);
  expect(await page.locator(".cloud-media-menu-trigger").evaluate((element) => element.getBoundingClientRect().width)).toBeLessThanOrEqual(34);
  expect(await page.locator(".cloud-media-menu-popover").evaluate((element) => element.getBoundingClientRect().width)).toBeLessThanOrEqual(230);
  await page.getByRole("button", { name: "Cinema mode" }).click();
  await expect(page.locator(".topbar")).toHaveCSS("height", "0px");
  await page.mouse.move(4, 4);
  await expect.poll(() => page.locator(".topbar").evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(68);
  await page.getByRole("button", { name: "Open Video menu" }).click();
  await page.getByRole("button", { name: "Search library" }).click();
  await expect(page.getByRole("searchbox", { name: "Search Video" })).toBeFocused();
});

test("Video series modal loads episodes and plays the next episode", async ({ page }) => {
  const series = {
    Id: "series-1",
    Name: "Billions",
    Type: "Series",
    ProductionYear: 2016,
    EndDate: "2023-10-29T00:00:00Z",
    Overview: "Power politics in New York high finance.",
    RunTimeTicks: 1,
  };
  const episodes = [
    { Id: "episode-1", Name: "Pilot", Type: "Episode", SeriesId: "series-1", SeriesName: "Billions", ParentIndexNumber: 1, IndexNumber: 1, RunTimeTicks: 3_420_000_000, Overview: "Chuck begins his investigation.", UserData: { Played: false, PlaybackPositionTicks: 1_710_000_000, PlayedPercentage: 50 } },
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
  await page.evaluate(() => window.scrollTo(0, 120));
  const scrollBeforeModal = await page.evaluate(() => window.scrollY);
  const billionsCard = page.getByRole("button", { name: /Billions/ });
  await expect(billionsCard.locator(":scope > strong")).toHaveCSS("font-size", "14.5px");
  await expect(billionsCard.locator(":scope > span")).toHaveCSS("font-size", "11.75px");
  await billionsCard.click();

  await expect.poll(() => page.evaluate(() => document.body.style.position)).toBe("fixed");
  await page.locator(".details-card").evaluate((element) => { element.scrollTop = 200; });
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBeforeModal);

  await expect(page.getByRole("heading", { name: "Season 1" })).toBeVisible();
  await expect(page.getByRole("button", { name: /S1 E1.*Pilot/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /S1 E2.*Naming Rights/ })).toBeVisible();
  await expect(page.locator(".details-card")).not.toContainText("0 min");
  await expect(page.locator(".details-copy > p")).toHaveCSS("font-size", "13px");
  await expect(page.locator(".details-copy .eyebrow")).toHaveCSS("font-family", /Plus Jakarta Sans/);
  await expect(page.locator(".details-progress")).toContainText("50% watched");
  const resume = page.getByRole("button", { name: "Resume" });
  await expect(resume).toHaveCSS("border-radius", "999px");
  await expect(resume).toHaveCSS("font-size", "14.5px");
  await page.getByRole("button", { name: "Add to My List" }).click();
  await expect(page.getByRole("button", { name: "Remove from My List" })).toBeVisible();
  await expect(page.getByRole("button", { name: /My List.*1/ })).toBeVisible();
  await page.getByRole("button", { name: "Play from beginning" }).click();
  await expect.poll(() => page.evaluate(() => document.body.style.position)).toBe("");
  await expect(page.locator(".player-top strong")).toHaveText("Billions");
  await expect(page.locator(".player-top strong")).toHaveCSS("font-family", /Plus Jakarta Sans/);
  await expect(page.locator(".player-title-line small")).toHaveText("2016 – 2023");
  await expect(page.locator(".player-top > div > span")).toHaveText("Pilot");
  await expect(page.locator(".timecode")).toContainText("0:00 /");
  await expect(page.getByRole("button", { name: /Back to .* episodes/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Choose episode" }).click();
  await expect(page.getByRole("heading", { name: "Billions episodes" })).toBeVisible();
  await expect(page.getByRole("button", { name: /S1 E1.*Pilot.*Now playing/ })).toBeVisible();
  await page.locator(".player-episode-picker").getByRole("button", { name: /S1 E2.*Naming Rights/ }).click();
  await expect(page.locator(".player-top > div > span").last()).toHaveText("Naming Rights");
});

test("Video surfaces an authenticated Jellyfin failure", async ({ page }) => {
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
  await expect(page.getByRole("heading", { name: "Couldn’t load Video" })).toBeVisible();
  await expect(page.getByText("Jellyfin is unavailable")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
});

test("Video player shows a streaming-style time preview", async ({ page }) => {
  const item = { Id: "item-1", Name: "Example movie", Type: "Movie", ProductionYear: 2024, RunTimeTicks: 36_000_000_000 };
  let stoppedPosition = 0;
  const playbackEvents: string[] = [];
  await page.route("**/api/auth/media/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ authenticated: true, user: { id: "user-1", name: "alice" }, csrf: "example" }),
  }));
  await page.route("**/api/media/tickets", (route) => route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ticket: "example" }) }));
  await page.route("**/api/media/stream/**", (route) => route.fulfill({ status: 206, contentType: "video/mp4", body: "" }));
  await page.route("**/api/media/proxy/**", (route) => {
    const url = route.request().url();
    if (url.includes("Sessions/Playing/Stopped")) {
      playbackEvents.push("stop");
      stoppedPosition = Number(route.request().postDataJSON().PositionTicks ?? 0);
      return route.fulfill({ status: 204, body: "" });
    }
    if (url.endsWith("Sessions/Playing")) {
      playbackEvents.push("start");
      return new Promise((resolve) => setTimeout(() => resolve(route.fulfill({ status: 204, body: "" })), 100));
    }
    if (url.includes("Sessions/Playing/Progress")) {
      playbackEvents.push("progress");
      return route.fulfill({ status: 204, body: "" });
    }
    if (url.includes("/Subtitles/")) return route.fulfill({
      status: 200,
      contentType: "text/vtt",
      body: "WEBVTT\n\n00:00:00.000 --> 00:10:00.000\nFirst cue\n",
    });
    if (url.includes("PlaybackInfo")) return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ PlaySessionId: "play-1", MediaSources: [{ Id: "source-1", SupportsDirectPlay: true, SupportsTranscoding: true, MediaStreams: [{ Index: 0, Type: "Subtitle", Codec: "subrip", Language: "eng", DisplayTitle: "English - SUBRIP - External" }] }] }),
    });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: url.includes("Latest") ? JSON.stringify([item]) : JSON.stringify({ Items: [] }),
    });
  });
  await page.goto("http://127.0.0.1:8090");
  const favoritesAction = page.getByRole("button", { name: /^Favorites/ });
  const searchAction = page.getByRole("searchbox", { name: "Search Video" });
  const homeAction = page.getByRole("button", { name: "Home" });
  const cinemaAction = page.getByRole("button", { name: "Cinema mode" });
  const servicesAction = page.getByRole("button", { name: "Switch app" });
  await expect(favoritesAction).toHaveCSS("font-weight", "600");
  const actionOrder = await Promise.all([favoritesAction, searchAction, homeAction, cinemaAction, servicesAction].map(async (locator) => (await locator.boundingBox())!.x));
  expect(actionOrder).toEqual([...actionOrder].sort((left, right) => left - right));
  await expect(page.locator(".brand")).toHaveAttribute("href", "/");
  await page.getByRole("button", { name: "Play" }).click();
  await expect(page.locator(".player-title-line strong")).toHaveText("Example movie");
  const [mainLayer, headerLayer] = await Promise.all([
    page.locator(".app > main").evaluate((element) => Number(getComputedStyle(element).zIndex)),
    page.locator(".topbar").evaluate((element) => Number(getComputedStyle(element).zIndex)),
  ]);
  expect(mainLayer).toBeGreaterThan(headerLayer);
  await expect(page.locator(".player-title-line strong")).toHaveCSS("font-family", /Plus Jakarta Sans/);
  await expect(page.locator(".player-title-line small")).toHaveText("2024");
  expect(parseFloat(await page.locator(".player-title-line strong").evaluate((element) => getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(20);
  const seek = page.getByRole("slider", { name: "Seek video" });
  await seek.hover({ position: { x: 100, y: 8 } });
  await expect(page.locator(".seek-preview")).toBeVisible();
  await expect(page.locator(".seek-preview strong")).toHaveText(/\d+:\d{2}/);
  await expect(page.locator(".seek-thumbnail")).toHaveCount(0);
  await page.getByRole("button", { name: "Subtitle settings" }).click();
  await expect(page.getByLabel("Subtitle track").locator("option").nth(1)).toHaveText("English");
  await expect(page.getByText("Background opacity — 72%", { exact: true })).toBeVisible();
  await page.getByLabel("Subtitle track").selectOption("0");
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("cloud-media-playback") ?? "{}").subtitleLanguage)).toBe("eng");
  await expect(page.locator("video track")).toHaveAttribute("label", "English");
  await expect(page.locator("video track")).toHaveAttribute("srclang", "en");
  await expect(page.locator("video track")).toHaveAttribute("default", "");
  await expect.poll(() => page.locator("video track").evaluate((track: HTMLTrackElement) => track.track.cues?.length ?? 0)).toBe(1);
  await page.getByRole("button", { name: "Done" }).click();
  await page.locator("video").evaluate((video) => {
    const textTrack = video.querySelector("track")!.track;
    Object.defineProperty(textTrack, "activeCues", { configurable: true, value: textTrack.cues });
    video.dispatchEvent(new Event("timeupdate"));
  });
  await expect(page.locator(".subtitle-layer")).toHaveText("First cue");
  const subtitleEpoch = await page.locator(".subtitle-layer").getAttribute("data-render-epoch");
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await expect.poll(() => page.locator(".subtitle-layer").getAttribute("data-render-epoch")).not.toBe(subtitleEpoch);
  await expect(page.locator(".subtitle-layer")).toHaveText("First cue");
  await page.locator("video").evaluate((video) => video.dispatchEvent(new Event("webkitbeginfullscreen")));
  await expect.poll(() => page.locator("video track").evaluate((track: HTMLTrackElement) => track.track.mode)).toBe("showing");
  await expect(page.locator(".subtitle-layer")).toHaveCount(0);
  await page.locator("video").evaluate((video) => video.dispatchEvent(new Event("webkitendfullscreen")));
  await expect.poll(() => page.locator("video track").evaluate((track: HTMLTrackElement) => track.track.mode)).toBe("hidden");
  await expect(page.locator(".subtitle-layer")).toHaveText("First cue");
  await page.locator("video").evaluate((video) => {
    document.body.dataset.originalUserAgent = navigator.userAgent;
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X)" });
    Object.defineProperty(video, "webkitEnterFullscreen", {
      configurable: true,
      value: () => {
        document.body.dataset.customSubtitleAtNativeEntry = String(Boolean(document.querySelector(".subtitle-layer")));
        document.body.dataset.nativeSubtitleModeAtEntry = video.querySelector("track")?.track.mode ?? "missing";
      },
    });
  });
  await page.getByRole("button", { name: "Enter fullscreen" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-custom-subtitle-at-native-entry", "false");
  await expect(page.locator("body")).toHaveAttribute("data-native-subtitle-mode-at-entry", "showing");
  await page.locator("video").evaluate((video) => {
    video.dispatchEvent(new Event("webkitendfullscreen"));
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: document.body.dataset.originalUserAgent });
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
  await page.locator("video").evaluate((video) => {
    Object.defineProperty(video, "currentTime", { configurable: true, value: 47.25, writable: true });
    video.dispatchEvent(new Event("timeupdate"));
  });
  await page.getByRole("button", { name: "Close player" }).click();
  await expect.poll(() => stoppedPosition).toBe(472_500_000);
  expect(playbackEvents.at(-1)).toBe("stop");
});

test("Cloud Drive renders Finder-style tiles with download and drag-to-move", async ({ page }) => {
  const moves: string[] = [];
  const creations: string[] = [];
  await page.route("**/api/auth/files/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ authenticated: true, user: { id: "user-1", name: "alice" }, csrf: "example" }),
  }));
  await page.route("**/api/files/proxy/usage", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ total: 10_000, used: 2_500 }) }));
  await page.route("**/api/files/proxy/resources/**", (route) => {
    if (route.request().method() === "PATCH") moves.push(route.request().url());
    if (route.request().method() === "POST") creations.push(route.request().url());
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
  await expect(page.locator(".brand")).toContainText("Cloud Drive");
  await expect(page.locator(".brand-mark-files svg")).toBeVisible();
  expect(parseFloat(await page.locator(".brand").evaluate((element) => getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(20);
  await expect(page.locator(".file-item").filter({ hasText: "Documents" }).locator("small")).toHaveCount(0);
  await expect(page.locator(".breadcrumbs").getByRole("button", { name: "Drive", exact: true })).toBeVisible();
  await expect(page.locator(".toolbar-actions")).toHaveCSS("scrollbar-width", "none");
  await expect(page.locator(".storage-meter")).toContainText("free");
  await expect(page.locator(".file-view").getByRole("button", { name: ".secret", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Show hidden files" }).click();
  await expect(page.locator(".file-view").getByRole("button", { name: ".secret", exact: true })).toBeVisible();
  await page.locator(".file-view").getByRole("button", { name: "report.pdf", exact: true }).click();
  await expect(page.getByRole("link", { name: "Download" })).toHaveAttribute("href", "/api/files/proxy/raw/report.pdf");
  await expect(page.getByRole("button", { name: "Refresh folder" })).toBeVisible();
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Projects");
  await page.getByRole("button", { name: "New folder", exact: true }).last().click();
  await expect.poll(() => creations.length).toBe(1);
  expect(creations[0]).toContain("/resources/Projects/");
  expect(creations[0]).toContain("override=false");
  await page.locator(".file-item").filter({ hasText: "report.pdf" }).dragTo(page.locator(".file-item").filter({ hasText: "Documents" }));
  await expect.poll(() => moves.length).toBe(1);
  expect(moves[0]).toContain("action=rename");
  expect(decodeURIComponent(moves[0])).toContain("destination=/Documents/report.pdf");
});

test("Cloud Drive has a blue sign-in and functional Control Panel", async ({ page }) => {
  let loggedOut = false;
  await page.route("**/api/auth/files/session", (route) => {
    if (route.request().method() === "DELETE") { loggedOut = true; return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) }); }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authenticated: true, user: { id: "1", name: "alice" }, csrf: "example" }) });
  });
  let users = [
    { id: 1, username: "alice", scope: "/", perm: { admin: true } },
    { id: 2, username: "bob", scope: "/", perm: { admin: false } },
  ];
  const created: Record<string, unknown>[] = [];
  const removed: number[] = [];
  await page.route("**/api/files/proxy/users**", (route) => {
    const method = route.request().method();
    const match = new URL(route.request().url()).pathname.match(/\/users\/(\d+)$/);
    if (method === "POST") {
      const payload = route.request().postDataJSON(); created.push(payload); users = [...users, { id: 3, username: String(payload.username), scope: "/", perm: payload.perm }];
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(users.at(-1)) });
    }
    if (method === "DELETE" && match) { removed.push(Number(match[1])); users = users.filter((user) => user.id !== Number(match[1])); return route.fulfill({ status: 204, body: "" }); }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(users) });
  });
  await page.route("**/api/files/proxy/shares", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/api/files/proxy/settings", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ branding: { name: "" }, signup: false }) }));
  await page.route("**/api/files/proxy/usage", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ total: 10_000, used: 2_500 }) }));
  await page.route("**/api/files/proxy/resources/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ name: "/", path: "/", size: 0, isDir: true, modified: "2026-07-10T00:00:00Z", items: [] }) }));

  await page.goto("http://127.0.0.1:8082");
  await page.getByRole("button", { name: "Open Control Panel" }).click();
  await expect(page.getByRole("dialog", { name: "Control Panel" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove alice" })).toBeDisabled();
  await page.getByRole("button", { name: "Add user" }).click();
  await page.getByLabel("Username").fill("charlie");
  await page.getByLabel("Temporary password").fill("example-password");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect.poll(() => created.length).toBe(1);
  await expect(page.getByText("charlie", { exact: false })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Remove bob" }).click();
  await expect.poll(() => removed).toEqual([2]);
  await page.keyboard.press("Escape");
  await page.locator(".topbar").getByRole("button", { name: "Sign out" }).click();
  await expect.poll(() => loggedOut).toBe(true);
  await expect(page.getByRole("heading", { name: "Sign in to Cloud Drive" })).toBeVisible();
});

test("Cloud Drive sign-in uses the modern blue identity", async ({ page }) => {
  await page.route("**/api/auth/files/session", (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ authenticated: false }) }));
  await page.goto("http://127.0.0.1:8082");
  await expect(page.getByRole("heading", { name: "Sign in to Cloud Drive" })).toBeVisible();
  await expect(page.locator(".brand")).toContainText("Cloud Drive");
  await expect(page.locator(".login-orb svg")).toBeVisible();
  const orbColor = await page.locator(".login-orb").evaluate((element) => getComputedStyle(element).backgroundImage);
  expect(orbColor).toContain("32, 140, 255");
  await page.getByRole("button", { name: "Switch app" }).click();
  await expect(page.getByText("SERVICES", { exact: true })).toHaveCSS("color", "rgb(123, 123, 132)");
  await expect(page.getByText("Drive", { exact: true }).last()).toBeVisible();
});

test("Cloud opens code and PDF files in polished viewers", async ({ page }) => {
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
  await expect(page.getByRole("button", { name: "Find" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Commands" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Format" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Increase editor font" })).toBeVisible();
  await expect(page.locator(".viewer-actions").getByRole("link", { name: "Download" })).toBeVisible();
  await page.locator(".viewer-header").getByRole("button").last().click();

  await page.locator(".file-view").getByRole("button", { name: "manual.pdf", exact: true }).dblclick();
  await expect(page.locator(".pdf-frame")).toBeVisible();
  await expect(page.locator(".viewer-actions").getByRole("link", { name: "Open" })).toHaveAttribute("target", "_blank");
});

test("Cloud stays gated while Video auto-authenticates", async ({ request }) => {
  expect((await request.get("http://127.0.0.1:8082/api/auth/files/session")).status()).toBe(401);
  expect((await request.get("http://127.0.0.1:8090/api/auth/media/session")).status()).toBe(200);
});

test("Open WebUI stays on its pre-Cloud frontend", async ({ page }) => {
  await page.goto("http://127.0.0.1:3003");
  await expect(page.locator("cloud-home-switcher")).toHaveCount(0);
  expect(await page.title()).not.toBe("");
});
