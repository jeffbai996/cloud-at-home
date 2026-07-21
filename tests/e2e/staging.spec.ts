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
    await expect(page.locator(".app-switcher-trigger svg")).toHaveClass(/cloud-cloud-mark/);
    await expect(page.locator(".app-switcher-trigger")).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    expect(parseFloat(await page.locator(".cloud-cloud-mark").evaluate((element) => getComputedStyle(element).width))).toBeGreaterThanOrEqual(24);
    const switcherCenter = await page.locator(".app-switcher-trigger").evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return bounds.left + bounds.width / 2;
    });
    expect(switcherCenter).toBeGreaterThan((await page.viewportSize())!.width / 2);
    await expect(page.locator(".dropdown-label")).toHaveText("SERVICES");
    await expect(page.getByRole("menuitem", { name: "Video" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Drive" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Local AI" })).toBeVisible();
    const extraService = page.locator(".app-switcher-item").filter({ has: page.locator(".app-glyph-extra") });
    await expect(extraService).toBeVisible();
    await expect(extraService).toHaveText(/^[a-z]+-[a-z]+$/);
    await expect(page.getByRole("menuitem", { name: "Video" })).toHaveAttribute("href", "http://127.0.0.1:8090");
    await expect(page.getByRole("menuitem", { name: "Drive" })).toHaveAttribute("href", "http://127.0.0.1:8082");
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

test("Video keeps the theme toggle inside the phone header", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 900 });
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

  await expect(page.locator(".media-favorites-nav > span")).toBeHidden();
  for (const control of [page.getByRole("button", { name: "Sign out" }), page.getByRole("button", { name: /Switch to .* theme/ })]) {
    const bounds = await control.boundingBox();
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(820);
  }
  await page.setViewportSize({ width: 540, height: 900 });
  await expect(page.locator(".brand > span:last-child")).toBeVisible();
  const compactHeaderWidth = await page.locator(".topbar").evaluate((element) => element.scrollWidth);
  expect(compactHeaderWidth).toBeLessThanOrEqual(540);
  await page.setViewportSize({ width: 390, height: 844 });

  await expect(page.locator(".brand")).toHaveCSS("font-size", "17px");
  const searchTrigger = page.getByRole("button", { name: "Search", exact: true });
  await expect(searchTrigger.locator('svg[viewBox="0 0 16 16"]')).toHaveCount(1);
  await searchTrigger.click();
  await expect(page.getByRole("searchbox", { name: "Search Video" })).toBeFocused();
  await expect(page.locator(".media-search")).toHaveCSS("opacity", "1");
  await page.keyboard.press("Escape");
  await expect(page.locator(".media-search")).toHaveCSS("opacity", "0");
  await expect(page.getByRole("button", { name: "Cinema mode" })).toBeVisible();
  await expect(page.locator(".topbar-signout")).toBeHidden();
  await page.getByRole("button", { name: "Open Video menu" }).click();
  await expect(page.locator(".cloud-media-menu-popover").getByRole("button", { name: "Sign out" })).toBeVisible();
  await page.getByRole("button", { name: "Close Video menu" }).click();
  const bounds = await page.getByRole("button", { name: /Switch to .* theme/ }).evaluate((element) => element.getBoundingClientRect());
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(390);
  expect(bounds.width).toBeGreaterThanOrEqual(34);
  await page.locator(".app > main").evaluate((element) => { element.style.minHeight = "2200px"; });
  await page.evaluate(() => window.scrollTo(0, 220));
  await expect(page.locator(".app-media")).toHaveClass(/app-header-auto-hidden/);
  await page.evaluate(() => window.scrollTo(0, 80));
  await expect(page.locator(".app-media")).not.toHaveClass(/app-header-auto-hidden/);
});

test("Video card hover stays inside the horizontal rail", async ({ page }) => {
  const item = { Id: "item-1", Name: "Example movie", Type: "Movie", ProductionYear: 2024, RunTimeTicks: 36_000_000_000, OfficialRating: "CA-14A", CommunityRating: 8.5, CriticRating: 73, Genres: ["Drama", "Comedy", "Science Fiction", "Adventure"], Studios: [{ Name: "Example Pictures" }], ProductionLocations: ["United States of America"], ProviderIds: { Imdb: "tt1375666", RottenTomatoes: "m/example_movie" }, UserData: { PlaybackPositionTicks: 6_000_000_000, PlayedPercentage: 16.7, Played: false } };
  const items = Array.from({ length: 10 }, (_, index) => ({ ...item, Id: `item-${index}`, Name: `Example movie ${index + 1}` }));
  const series = { ...item, Id: "series-1", Name: "Example series", Type: "Series" };
  let removedHistoryItem = "";
  await page.route("**/api/auth/media/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ authenticated: true, user: { id: "user-1", name: "alice" }, csrf: "example" }),
  }));
  await page.route("**/api/media/proxy/**", (route) => {
    const url = route.request().url();
    if (route.request().method() === "DELETE" && url.includes("UserPlayedItems/")) {
      removedHistoryItem = decodeURIComponent(url.match(/UserPlayedItems\/([^?]+)/)?.[1] ?? "");
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    }
    const body = url.includes("Latest")
      ? JSON.stringify(items)
      : JSON.stringify({ Items: url.includes("IncludeItemTypes=Movie") ? items : url.includes("IncludeItemTypes=Series") ? [series] : [] });
    return route.fulfill({ status: 200, contentType: "application/json", body });
  });
  await page.goto("http://127.0.0.1:8090");

  const railHeadingSize = (await page.viewportSize())!.width >= 1000 ? "27px" : "20px";
  await expect(page.getByRole("heading", { name: "TV Series" })).toHaveCSS("font-size", railHeadingSize);
  await expect(page.getByRole("heading", { name: "Movies" })).toHaveCSS("font-size", railHeadingSize);
  await expect(page.getByRole("heading", { name: "Recently added" })).toHaveCSS("font-size", railHeadingSize);
  for (const id of ["recently-added", "movies"]) {
    const section = page.locator(`#${id} .rail-scroll`);
    await expect.poll(() => section.evaluate((element) => element.scrollLeft)).toBe(0);
    const expectedRailInset = Math.min(58, Math.max(18, (await page.viewportSize())!.width * .04));
    expect((await section.locator(".media-card").first().boundingBox())!.x).toBeGreaterThanOrEqual(expectedRailInset - 1);
  }

  const rail = page.locator(".rail-scroll").first();
  const card = rail.locator(".media-card").first();
  const poster = card.locator(".poster");
  const posterImage = poster.locator("img");
  await expect(poster).toHaveCSS("border-bottom-width", "0px");
  await expect(poster).toHaveCSS("overflow", "hidden");
  const [posterBox, posterImageBox] = await Promise.all([poster.boundingBox(), posterImage.boundingBox()]);
  expect(posterImageBox!.y).toBeLessThan(posterBox!.y);
  expect(posterImageBox!.y + posterImageBox!.height).toBeGreaterThan(posterBox!.y + posterBox!.height);
  await card.hover();
  await page.waitForTimeout(250);
  const [railBounds, cardBounds] = await Promise.all([rail.boundingBox(), card.boundingBox()]);
  expect(railBounds).not.toBeNull();
  expect(cardBounds).not.toBeNull();
  expect(cardBounds!.y).toBeGreaterThanOrEqual(railBounds!.y);
  await card.click();
  const [detailsBounds, copyBounds, titleBounds, synopsisBounds, factsBounds] = await Promise.all([
    page.locator(".details-card").boundingBox(),
    page.locator(".details-copy").boundingBox(),
    page.locator(".details-copy h1").boundingBox(),
    page.locator(".details-copy > p").boundingBox(),
    page.locator(".details-facts").boundingBox(),
  ]);
  const wideViewport = (await page.viewportSize())!.width >= 1000;
  if (wideViewport) expect(copyBounds!.width).toBeGreaterThan(synopsisBounds!.width + 70);
  expect(synopsisBounds!.width).toBeLessThanOrEqual(721);
  if (wideViewport) expect(factsBounds!.width).toBeGreaterThan(synopsisBounds!.width + 70);
  expect(detailsBounds!.x + detailsBounds!.width - (titleBounds!.x + titleBounds!.width)).toBeGreaterThanOrEqual(40);
  await expect(page.locator(".details-facts")).toHaveCSS("flex-wrap", "nowrap");
  await expect(page.locator(".details-facts .details-category-genre")).toHaveCount(2);
  await expect(page.locator(".details-facts .rating-badge-ca").first()).toHaveCSS("font-weight", "700");
  await expect(page.locator(".details-facts .critic-rating")).toContainText("73%");
  await expect(page.locator(".details-facts .critic-rating")).toHaveCSS("font-weight", "550");
  await expect(page.locator(".details-facts .critic-rating > svg")).toHaveCount(1);
  await expect(page.locator(".details-facts .community-rating")).toHaveCSS("font-weight", "550");
  await expect(page.locator(".details-facts .details-category").first()).toHaveCSS("font-weight", "500");
  await expect(page.locator(".details-facts .details-category-context")).toHaveCount(1);
  await expect(page.locator(".details-facts .country-pill")).toHaveAccessibleName("Production country: United States of America");
  await expect(page.locator(".details-facts .country-pill svg.country-flag")).toHaveCount(1);
  await expect(page.locator(".details-facts .rating-badge-ca").first()).toHaveClass(/rating-badge-triangle/);
  await expect(page.locator(".details-facts .rating-badge-ca").first()).toHaveClass(/rating-badge-yellow/);
  await page.locator(".details-facts .rating-badge-ca").first().hover();
  const classificationCard = page.locator(".rating-card");
  await expect(classificationCard).toBeVisible();
  await classificationCard.hover();
  await page.waitForTimeout(300);
  await expect(classificationCard).toBeVisible();
  await page.locator(".details-copy h1").hover();
  await expect.poll(() => classificationCard.evaluate((element) => getComputedStyle(element).opacity)).toBe("0");
  await expect(page.getByRole("button", { name: "Add to favorites" })).toHaveCSS("font-weight", "550");
  await expect(page.getByRole("button", { name: "Create a list" })).toHaveCSS("font-weight", "550");
  await expect(page.getByRole("button", { name: "Remove from history" })).toHaveCSS("font-weight", "550");
  await expect(page.getByRole("button", { name: "Add to favorites" })).toHaveCSS("min-height", "39px");
  await expect(page.getByRole("button", { name: "Create a list" }).locator("svg")).toHaveClass(/lucide-list-plus/);
  await expect(page.getByRole("button", { name: "Create a list" })).toHaveCSS("gap", "6px");
  if (!await page.evaluate(() => matchMedia("(hover: none)").matches)) {
    const favorite = page.getByRole("button", { name: "Add to favorites" });
    expect((await favorite.boundingBox())!.width).toBeLessThanOrEqual(40);
    await favorite.hover();
    await expect.poll(async () => (await favorite.boundingBox())!.width).toBeGreaterThan(100);
    const country = page.locator(".country-pill");
    expect((await country.boundingBox())!.width).toBeLessThanOrEqual(33);
    await country.hover();
    await expect.poll(async () => (await country.boundingBox())!.width).toBeGreaterThan(120);
  }
  await page.locator(".details-facts .community-rating").hover();
  const imdbTooltip = page.getByRole("tooltip").filter({ hasText: "IMDb" });
  expect(await imdbTooltip.evaluate((element) => getComputedStyle(element).opacity)).toBe("0");
  await page.waitForTimeout(900);
  expect(await imdbTooltip.evaluate((element) => getComputedStyle(element).opacity)).toBe("0");
  await expect(imdbTooltip).toBeVisible();
  await expect(imdbTooltip.locator("strong")).toHaveCSS("font-size", "17px");
  await expect(imdbTooltip.locator(".score-denominator")).toHaveText("/10");
  await expect(imdbTooltip.locator(".score-denominator")).toHaveCSS("font-size", "10px");
  await expect(imdbTooltip.getByRole("link", { name: "View title on Internet Movie Database" })).toHaveAttribute("href", "https://www.imdb.com/title/tt1375666/");
  await page.locator(".details-facts .critic-rating").hover();
  const tomatoTooltip = page.getByRole("tooltip").filter({ hasText: "Tomatometer" });
  await expect(tomatoTooltip).toBeVisible();
  await expect(tomatoTooltip.locator("strong")).toHaveCSS("font-size", "17px");
  await expect(tomatoTooltip.getByRole("link", { name: "View title on Rotten Tomatoes" })).toHaveAttribute("href", "https://www.rottentomatoes.com/m/example_movie");
  await page.setViewportSize({ width: 390, height: 844 });
  const closeDetails = page.getByRole("button", { name: "Close details" });
  await expect(closeDetails).toBeHidden();
  await expect(page.locator(".details-facts .details-category-genre").first()).toBeHidden();
  await expect(page.locator(".details-facts .details-category-studio")).toBeVisible();
  await expect(page.locator(".details-facts .country-pill")).toBeVisible();
  await expect(page.locator(".details-category-studio .details-category-label")).toHaveCSS("text-overflow", "ellipsis");
  await expect(page.locator(".country-pill-label")).toHaveCSS("text-overflow", "ellipsis");
  expect((await page.locator(".details-facts").boundingBox())!.height).toBeLessThanOrEqual(39);
  await page.getByRole("button", { name: "Remove from history" }).click();
  await expect.poll(() => removedHistoryItem).toBe("item-0");
  await expect(page.getByRole("button", { name: "Remove from history" })).toHaveCount(0);
  await page.locator(".brand").click();
  await expect(page.locator(".details-card")).toHaveCount(0);
});

test("Video keeps 14A and 18A labels in the Canadian badge typeface", async ({ page }) => {
  const videoUrl = process.env.MEDIA_E2E_URL ?? "http://127.0.0.1:8090";
  const items = ["14A", "18A"].map((rating) => ({
    Id: `rating-${rating}`,
    Name: `Rating ${rating}`,
    Type: "Movie",
    OfficialRating: `CA-${rating}`,
  }));
  await page.route("**/api/auth/media/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ authenticated: true, user: { id: "user-1", name: "alice" }, csrf: "example" }),
  }));
  await page.route("**/api/media/proxy/**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: route.request().url().includes("Latest") ? JSON.stringify(items) : JSON.stringify({ Items: items }),
  }));
  await page.goto(videoUrl);

  for (const rating of ["14A", "18A"]) {
    await page.locator(".media-card").filter({ hasText: `Rating ${rating}` }).first().locator(".poster-open").click({ position: { x: 10, y: 10 } });
    const badge = page.locator(".details-facts > .rating-classification > .rating-badge-ca").first();
    await expect(badge).toContainText(rating);
    // PRODUCT CONTRACT: do not update this expectation unless the user
    // explicitly changes the 14A/18A typography requirement.
    await expect(badge).toHaveCSS("font-family", /DM Sans/);
    const [badgeBounds, contentBounds] = await Promise.all([
      badge.boundingBox(),
      badge.locator(".rating-badge-content").boundingBox(),
    ]);
    expect(contentBounds!.x).toBeGreaterThanOrEqual(badgeBounds!.x - 1);
    expect(contentBounds!.x + contentBounds!.width).toBeLessThanOrEqual(badgeBounds!.x + badgeBounds!.width + 1);
    await page.locator(".brand").click();
    await expect(page.locator(".details-card")).toHaveCount(0);
  }
});

test("Video contains top overscroll above its navigation", async ({ page }) => {
  const videoUrl = process.env.MEDIA_E2E_URL ?? "http://127.0.0.1:8090";
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
  await page.goto(videoUrl);

  const topbar = page.locator(".app-media .topbar");
  await expect(topbar).toHaveCSS("padding-top", "9px");
  await expect.poll(() => topbar.evaluate((element) => element.getBoundingClientRect().top)).toBe(0);
  await expect(page.locator("html")).toHaveCSS("overscroll-behavior-y", "none");
  await expect(page.locator("body")).toHaveCSS("overscroll-behavior-y", "none");
});

test("Video keeps the top of movie artwork visible in wide details cards", async ({ page }) => {
  const item = { Id: "movie-art-1", Name: "Example movie", Type: "Movie", ProductionYear: 2024, RunTimeTicks: 36_000_000_000, ImageTags: { Primary: "poster-1" }, BackdropImageTags: ["backdrop-1"] };
  await page.route("**/api/auth/media/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ authenticated: true, user: { id: "user-1", name: "alice" }, csrf: "example" }),
  }));
  await page.route("**/api/media/proxy/**", (route) => {
    const body = route.request().url().includes("Latest") ? JSON.stringify([item]) : JSON.stringify({ Items: [item] });
    return route.fulfill({ status: 200, contentType: "application/json", body });
  });
  await page.goto("http://127.0.0.1:8090");
  await page.locator(".media-card .poster-open").first().click({ position: { x: 10, y: 10 } });
  await expect(page.locator(".details-art-image")).toHaveCSS("object-position", "50% 24%");
});

test("Video score pills stay legible and open tooltips into the details card", async ({ page }) => {
  const item = {
    Id: "movie-score-1",
    Name: "Example movie",
    Type: "Movie",
    ProductionYear: 2024,
    PremiereDate: "2024-07-12T00:00:00.000Z",
    OfficialRating: "R",
    CommunityRating: 8.5,
    CriticRating: 73,
    ProductionLocations: ["United States of America", "Canada"],
    Studios: [{ Name: "Example Pictures" }],
    ProviderIds: { Imdb: "tt1375666", RottenTomatoes: "m/example_movie" },
  };
  await page.route("**/api/auth/media/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ authenticated: true, user: { id: "user-1", name: "alice" }, csrf: "example" }),
  }));
  await page.route("**/api/media/proxy/**", (route) => {
    const body = route.request().url().includes("Latest") ? JSON.stringify([item]) : JSON.stringify({ Items: [item] });
    return route.fulfill({ status: 200, contentType: "application/json", body });
  });
  await page.goto("http://127.0.0.1:8090");
  await page.locator(".media-card .poster-open").first().click({ position: { x: 10, y: 10 } });

  await expect.poll(async () => page.locator(".details-copy h1").evaluate((element) => parseFloat(getComputedStyle(element).letterSpacing) / parseFloat(getComputedStyle(element).fontSize))).toBeCloseTo(-.035, 3);

  const imdb = page.locator(".details-facts .community-rating");
  const tomato = page.locator(".details-facts .critic-rating");
  await expect(imdb).toHaveCSS("font-size", "11px");
  await expect(tomato).toHaveCSS("font-size", "11px");

  await imdb.focus();
  const tooltip = page.getByRole("tooltip").filter({ hasText: "IMDb" });
  await expect(tooltip).toBeVisible();
  const [pillBounds, tooltipBounds, detailsBounds] = await Promise.all([
    imdb.boundingBox(),
    tooltip.boundingBox(),
    page.locator(".details-card").boundingBox(),
  ]);
  expect(tooltipBounds!.x).toBeGreaterThanOrEqual(pillBounds!.x - 1);
  expect(tooltipBounds!.x).toBeGreaterThanOrEqual(detailsBounds!.x);
  expect(tooltipBounds!.x + tooltipBounds!.width).toBeLessThanOrEqual(detailsBounds!.x + detailsBounds!.width);

  await tomato.focus();
  await expect(page.getByRole("link", { name: "View title on Rotten Tomatoes" })).toHaveAttribute("href", "https://www.rottentomatoes.com/m/example_movie");

  const rating = page.locator(".rating-classification > .rating-badge");
  const ratingTransform = await rating.evaluate((element) => getComputedStyle(element).transform);
  await rating.hover();
  await expect.poll(() => rating.evaluate((element) => getComputedStyle(element).transform)).toBe(ratingTransform);

  const country = page.locator(".country-pill");
  await expect(country.locator(".country-pill-label")).toHaveText("United States");
  await expect(country.locator(".country-flag")).toHaveAttribute("src", "/flags/us.svg");
  const countryWidth = await country.evaluate((element) => getComputedStyle(element).width);
  await country.hover();
  await expect(country).toHaveCSS("width", countryWidth);
  const production = page.getByRole("tooltip").filter({ hasText: "Production details" });
  await expect(production).toContainText("United States · Canada");
  await expect(production).toContainText("Example Pictures");
  await expect(production).toContainText("July 12, 2024");
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
  expect(headerHeight).toBeGreaterThanOrEqual(62);
  expect(headerHeight).toBeLessThanOrEqual(66);
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
  await expect(page.getByRole("button", { name: "More info" })).toHaveCSS("font-size", "11.5px");
  await expect(page.getByRole("button", { name: "More info" })).toHaveCSS("min-height", "39px");
  expect((await page.getByRole("button", { name: "More info" }).boundingBox())!.height).toBeLessThan((await page.getByRole("button", { name: "Resume" }).boundingBox())!.height);
  await expect(page.getByRole("button", { name: /^Favorites/ })).toBeVisible();

  await page.getByRole("button", { name: "Open Video menu" }).click();
  for (const name of ["Search library", "Favorites", "Continue watching", "Recently added", "Movies", "Shows", "Surprise me", "Refresh home", "Clear watch history"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
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
  await expect.poll(() => page.locator(".topbar").evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(62);
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

test("Video starts front-page play commands after delayed media setup", async ({ page }) => {
  const videoUrl = process.env.MEDIA_E2E_URL ?? "http://127.0.0.1:8090";
  const item = { Id: "autoplay-item", Name: "Autoplay contract", Type: "Movie", ProductionYear: 2026, RunTimeTicks: 36_000_000_000 };
  await page.addInitScript(() => {
    Object.defineProperty(window, "__videoPlayAttempts", { value: 0, writable: true });
    HTMLMediaElement.prototype.play = function play() {
      const state = window as Window & { __videoPlayAttempts: number };
      state.__videoPlayAttempts += 1;
      if (state.__videoPlayAttempts === 1) {
        return Promise.reject(new DOMException("Media setup interrupted playback", "AbortError"));
      }
      this.dispatchEvent(new Event("play"));
      if (state.__videoPlayAttempts === 2) {
        // WebKit can accept play(), then pause again while the ticketed source
        // and resume seek settle. A play event alone is not a successful start.
        this.dispatchEvent(new Event("pause"));
        return Promise.resolve();
      }
      this.dispatchEvent(new Event("playing"));
      return Promise.resolve();
    };
  });
  await page.route("**/api/auth/media/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ authenticated: true, user: { id: "user-1", name: "alice" }, csrf: "example" }),
  }));
  await page.route("**/api/media/proxy/**", (route) => {
    const url = route.request().url();
    if (url.includes("PlaybackInfo")) return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ PlaySessionId: "play-1", MediaSources: [{ Id: "source-1", SupportsDirectPlay: true, SupportsTranscoding: true, MediaStreams: [] }] }),
    });
    const body = url.includes("Latest") ? JSON.stringify([item]) : url.includes("IncludeItemTypes=Movie") ? JSON.stringify({ Items: [item] }) : JSON.stringify({ Items: [] });
    return route.fulfill({ status: 200, contentType: "application/json", body });
  });
  await page.route("**/api/media/tickets", (route) => route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ticket: "example" }) }));
  await page.route("**/api/media/stream/**", (route) => route.fulfill({ status: 200, contentType: "video/mp4", body: "" }));

  await page.goto(videoUrl);
  await page.getByRole("button", { name: "Play Autoplay contract" }).first().evaluate((button: HTMLButtonElement) => button.click());
  const video = page.locator("video");
  await expect.poll(() => video.evaluate((element) => element.src)).not.toBe("");
  await video.evaluate((element) => element.dispatchEvent(new Event("loadedmetadata")));
  await expect.poll(() => page.evaluate(() => (window as Window & { __videoPlayAttempts: number }).__videoPlayAttempts)).toBe(1);
  await video.evaluate((element) => element.dispatchEvent(new Event("canplay")));
  await expect.poll(() => page.evaluate(() => (window as Window & { __videoPlayAttempts: number }).__videoPlayAttempts)).toBeGreaterThanOrEqual(3);
  await expect(page.getByRole("button", { name: "Pause" }).first()).toBeVisible();
});

test("Video keyboard shortcuts preserve deliberate playback intent", async ({ page }) => {
  const videoUrl = process.env.MEDIA_E2E_URL ?? "http://127.0.0.1:8090";
  const item = { Id: "keyboard-item", Name: "Keyboard contract", Type: "Movie", ProductionYear: 2026, RunTimeTicks: 1_000_000_000 };
  await page.addInitScript(() => {
    const state = { paused: true, playAttempts: 0 };
    Object.defineProperty(window, "__videoKeyboardState", { value: state });
    Object.defineProperty(HTMLMediaElement.prototype, "paused", { configurable: true, get: () => state.paused });
    HTMLMediaElement.prototype.play = function play() {
      state.paused = false;
      state.playAttempts += 1;
      this.dispatchEvent(new Event("play"));
      if (state.playAttempts > 1) this.dispatchEvent(new Event("playing"));
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function pause() {
      state.paused = true;
      this.dispatchEvent(new Event("pause"));
    };
  });
  await page.route("**/api/auth/media/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ authenticated: true, user: { id: "user-1", name: "alice" }, csrf: "example" }),
  }));
  await page.route("**/api/media/proxy/**", (route) => {
    const url = route.request().url();
    if (url.includes("PlaybackInfo")) return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ PlaySessionId: "play-1", MediaSources: [{ Id: "source-1", SupportsDirectPlay: true, SupportsTranscoding: true, MediaStreams: [] }] }),
    });
    const body = url.includes("Latest") ? JSON.stringify([item]) : url.includes("IncludeItemTypes=Movie") ? JSON.stringify({ Items: [item] }) : JSON.stringify({ Items: [] });
    return route.fulfill({ status: 200, contentType: "application/json", body });
  });
  await page.route("**/api/media/tickets", (route) => route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ticket: "example" }) }));
  await page.route("**/api/media/stream/**", (route) => route.fulfill({ status: 200, contentType: "video/mp4", body: "" }));

  await page.goto(videoUrl);
  await page.getByRole("button", { name: "Play Keyboard contract" }).first().evaluate((button: HTMLButtonElement) => button.click());
  const video = page.locator("video");
  await expect.poll(() => video.evaluate((element) => element.src)).not.toBe("");
  await video.evaluate((element) => {
    Object.defineProperty(element, "currentTime", { configurable: true, value: 40, writable: true });
    Object.defineProperty(element, "duration", { configurable: true, value: 100 });
    element.dispatchEvent(new Event("loadedmetadata"));
  });
  const keyboardState = () => page.evaluate(() => (window as Window & { __videoKeyboardState: { paused: boolean; playAttempts: number } }).__videoKeyboardState);
  await expect.poll(async () => (await keyboardState()).playAttempts).toBe(1);

  // Space during startup is a deliberate pause, not WebKit's setup-time
  // play -> pause race. The recovery loop must leave it paused.
  await page.keyboard.press("Space");
  await expect.poll(async () => (await keyboardState()).paused).toBe(true);
  await page.waitForTimeout(100);
  expect((await keyboardState()).playAttempts).toBe(1);
  await page.keyboard.press("KeyK");
  await expect.poll(async () => (await keyboardState()).paused).toBe(false);
  await expect(page.getByRole("button", { name: "Pause" }).first()).toBeVisible();

  await page.keyboard.press("ArrowRight");
  await expect.poll(() => video.evaluate((element) => element.currentTime)).toBe(50);
  await page.getByRole("slider", { name: "Seek video" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => video.evaluate((element) => element.currentTime)).toBe(60);
  await page.keyboard.press("Space");
  await expect.poll(async () => (await keyboardState()).paused).toBe(true);
  await page.keyboard.press("Space");
  await expect.poll(async () => (await keyboardState()).paused).toBe(false);
  await page.keyboard.press("KeyJ");
  await expect.poll(() => video.evaluate((element) => element.currentTime)).toBe(50);
  await page.keyboard.press("5");
  await expect.poll(() => video.evaluate((element) => element.currentTime)).toBe(50);
  await page.keyboard.press("KeyM");
  await expect.poll(() => video.evaluate((element) => element.muted)).toBe(true);
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => video.evaluate((element) => element.volume)).toBeCloseTo(.95, 5);
  await page.keyboard.press("ArrowUp");
  await expect.poll(() => video.evaluate((element) => element.volume)).toBeCloseTo(1, 5);
  await page.keyboard.press("KeyF");
  await expect.poll(() => page.locator(".player-shell").evaluate((shell) => document.fullscreenElement === shell || shell.classList.contains("player-viewport-fullscreen") || shell.getAttribute("data-fullscreen-requested") === "true")).toBe(true);
});

test("Video scales episode titles down and omits synopsis on iPhone", async ({ page }) => {
  const series = { Id: "series-mobile", Name: "Example series", Type: "Series", ProductionYear: 2024, RunTimeTicks: 1 };
  const episodes = [{ Id: "episode-mobile", Name: "A Deliberately Long Episode Title", Type: "Episode", SeriesId: "series-mobile", SeriesName: "Example series", ParentIndexNumber: 1, IndexNumber: 1, RunTimeTicks: 3_420_000_000, Overview: "This synopsis is intentionally omitted from the compact phone card." }];
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/auth/media/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ authenticated: true, user: { id: "user-1", name: "alice" }, csrf: "example" }),
  }));
  await page.route("**/api/media/proxy/**", (route) => {
    const url = route.request().url();
    const body = url.includes("Shows/series-mobile/Episodes")
      ? JSON.stringify({ Items: episodes })
      : url.includes("IncludeItemTypes=Series") ? JSON.stringify({ Items: [series] }) : url.includes("Latest") ? "[]" : JSON.stringify({ Items: [] });
    return route.fulfill({ status: 200, contentType: "application/json", body });
  });
  await page.goto("http://127.0.0.1:8090");
  await page.locator(".media-card .poster-open").first().click({ position: { x: 10, y: 10 } });
  await expect(page.locator(".episode-copy strong")).toHaveCSS("font-size", "13px");
  await expect(page.locator(".episode-copy small")).toBeHidden();
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

test("Video keeps touch fullscreen inside the app without racing into picture in picture", async ({ page }, testInfo) => {
  const videoUrl = process.env.MEDIA_E2E_URL ?? "http://127.0.0.1:8090";
  const item = { Id: "item-1", Name: "Example movie", Type: "Movie", ProductionYear: 2024, RunTimeTicks: 36_000_000_000 };
  if (testInfo.project.name === "ipad") {
    await page.addInitScript(() => {
      const nativeMatchMedia = window.matchMedia.bind(window);
      Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: 0 });
      Object.defineProperty(navigator, "userAgent", {
        configurable: true,
        value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Safari/605.1.15 Brave",
      });
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: (query: string) => query === "(pointer: coarse)" ? nativeMatchMedia("(max-width: 0px)") : nativeMatchMedia(query),
      });
    });
  }
  await page.route("**/api/auth/media/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ authenticated: true, user: { id: "user-1", name: "alice" }, csrf: "example" }),
  }));
  await page.route("**/api/media/tickets", (route) => route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ticket: "example" }) }));
  await page.route("**/api/media/stream/**", (route) => route.fulfill({ status: 206, contentType: "video/mp4", body: "" }));
  await page.route("**/api/media/proxy/**", (route) => {
    const url = route.request().url();
    if (url.includes("PlaybackInfo")) return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ PlaySessionId: "play-1", MediaSources: [{ Id: "source-1", SupportsDirectPlay: true, SupportsTranscoding: true, MediaStreams: [] }] }),
    });
    if (url.includes("Sessions/Playing")) return route.fulfill({ status: 204, body: "" });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: url.includes("Latest") ? JSON.stringify([item]) : JSON.stringify({ Items: [] }),
    });
  });
  await page.goto(videoUrl);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.locator(".player-shell")).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value(this: HTMLElement) { this.setAttribute("data-standard-fullscreen-requested", "true"); return Promise.resolve(); },
    });
    Object.defineProperty(HTMLElement.prototype, "webkitRequestFullscreen", {
      configurable: true,
      value(this: HTMLElement) { this.setAttribute("data-legacy-fullscreen-requested", "true"); },
    });
  });
  await page.locator("video").evaluate((video) => {
    Object.defineProperty(video, "webkitEnterFullscreen", {
      configurable: true,
      value: () => video.setAttribute("data-native-fullscreen-requested", "true"),
    });
    Object.defineProperty(video, "webkitSupportsPresentationMode", {
      configurable: true,
      value: (mode: string) => mode === "picture-in-picture",
    });
    Object.defineProperty(video, "webkitSetPresentationMode", {
      configurable: true,
      value: (mode: string) => video.setAttribute("data-presentation-mode-requested", mode),
    });
  });
  // PRODUCT CONTRACT: Apple touch fullscreen must remain inside Video and
  // must never race into PiP or video.webkitEnterFullscreen().
  await page.getByRole("button", { name: "Enter fullscreen" }).evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.locator("video")).not.toHaveAttribute("data-presentation-mode-requested");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(page.locator("video")).not.toHaveAttribute("data-native-fullscreen-requested", "true");
  await expect(page.locator("video")).not.toHaveAttribute("data-presentation-mode-requested");

  if (testInfo.project.name === "ipad") {
    // Modern iPadOS supports unprefixed element fullscreen. Brave must use that
    // real shell path while never touching the legacy WebKit API, which can
    // silently promote the child video into Apple's native player.
    await expect(page.locator(".player-shell")).toHaveAttribute("data-standard-fullscreen-requested", "true");
    await expect(page.locator(".player-shell")).not.toHaveAttribute("data-legacy-fullscreen-requested", "true");
    await expect(page.locator(".player-shell")).not.toHaveClass(/player-viewport-fullscreen/);
    await page.getByRole("button", { name: "Exit fullscreen" }).click();
    await page.evaluate(() => {
      Object.defineProperty(HTMLElement.prototype, "requestFullscreen", { configurable: true, value: undefined });
      Object.defineProperty(HTMLElement.prototype, "webkitRequestFullscreen", { configurable: true, value: undefined });
    });
    await page.getByRole("button", { name: "Enter fullscreen" }).click();
    await expect(page.locator(".player-shell")).toHaveClass(/player-viewport-fullscreen/);
    await expect(page.locator("video")).not.toHaveAttribute("data-native-fullscreen-requested", "true");
    await expect(page.locator("video")).not.toHaveAttribute("data-presentation-mode-requested", "picture-in-picture");
  } else {
    await expect(page.locator(".player-shell")).toHaveAttribute("data-standard-fullscreen-requested", "true");
  }
});

test("Video player shows a streaming-style time preview", async ({ page }, testInfo) => {
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
  await page.route("**/api/media/subtitles/**", (route) => route.fulfill({
    status: 200,
    contentType: "text/vtt",
    body: "WEBVTT\n\n00:00:00.000 --> 00:10:00.000\nFirst cue\n",
  }));
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
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.locator(".player-title-line strong")).toHaveText("Example movie");
  await expect(page.locator("video track")).toHaveCount(1);
  await expect(page.locator("video track")).toHaveAttribute("src", "/api/media/subtitles/item-1/source-1/0.vtt");
  const [mainLayer, headerLayer] = await Promise.all([
    page.locator(".app > main").evaluate((element) => Number(getComputedStyle(element).zIndex)),
    page.locator(".topbar").evaluate((element) => Number(getComputedStyle(element).zIndex)),
  ]);
  expect(mainLayer).toBeGreaterThan(headerLayer);
  await expect(page.locator(".player-title-line strong")).toHaveCSS("font-family", /Plus Jakarta Sans/);
  await expect(page.locator(".player-title-line small")).toHaveText("2024");
  await expect(page.locator(".player-title-line small")).toHaveCSS("font-weight", "550");
  expect(parseFloat(await page.locator(".player-title-line strong").evaluate((element) => getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(20);
  await expect.poll(async () => page.locator(".player-title-line strong").evaluate((element) => parseFloat(getComputedStyle(element).letterSpacing) / parseFloat(getComputedStyle(element).fontSize))).toBeCloseTo(-.03, 3);
  const pauseTitleSpacing = await page.locator(".player-shell").evaluate((shell) => {
    const copy = document.createElement("div");
    copy.className = "pause-cinema-copy";
    const heading = document.createElement("h1");
    heading.textContent = "Example movie";
    copy.appendChild(heading);
    shell.appendChild(copy);
    const ratio = parseFloat(getComputedStyle(heading).letterSpacing) / parseFloat(getComputedStyle(heading).fontSize);
    copy.remove();
    return ratio;
  });
  expect(pauseTitleSpacing).toBeCloseTo(-.045, 3);
  await page.setViewportSize({ width: 390, height: 844 });
  const pauseSynopsisOverflow = await page.locator(".player-shell").evaluate((shell) => {
    const copy = document.createElement("div");
    copy.className = "pause-cinema-copy";
    copy.innerHTML = `<h1>Example movie</h1><p>${"A complete synopsis should remain visible when the viewport has room. ".repeat(8)}</p>`;
    shell.appendChild(copy);
    const paragraph = copy.querySelector("p")!;
    const result = {
      lineClamp: getComputedStyle(paragraph).webkitLineClamp,
      synopsisFullyVisible: paragraph.scrollHeight === paragraph.clientHeight,
      copyFitsViewport: copy.getBoundingClientRect().bottom <= window.innerHeight,
    };
    copy.remove();
    return result;
  });
  expect(pauseSynopsisOverflow.lineClamp).toBe("none");
  expect(pauseSynopsisOverflow.synopsisFullyVisible).toBe(true);
  expect(pauseSynopsisOverflow.copyFitsViewport).toBe(true);
  // Text's line box sits optically lower than the X glyph; keep their
  // geometric centers close while allowing that intentional optical lift.
  await expect.poll(async () => {
    const [closeBounds, titleBounds] = await Promise.all([
      page.getByRole("button", { name: "Close player" }).boundingBox(),
      page.locator(".player-title-line").boundingBox(),
    ]);
    return Math.abs((closeBounds!.y + closeBounds!.height / 2) - (titleBounds!.y + titleBounds!.height / 2));
  }).toBeLessThanOrEqual(6);
  await expect(page.locator(".timecode > span").first()).toBeVisible();
  await expect(page.locator(".timecode-total")).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.locator(".timecode-total")).toBeVisible();
  if (testInfo.project.name !== "ipad") {
    const centerTransport = page.locator(".player-center");
    await page.mouse.move(1100, 100);
    await expect(centerTransport).toHaveCount(0);
    await page.mouse.move(640, 360);
    await expect(centerTransport).toBeVisible();
    await expect(page.getByRole("button", { name: "Rewind 10 seconds" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Forward 10 seconds" })).toBeVisible();
    const centerPlay = page.locator(".play-main");
    await expect(centerPlay.locator(".lucide-play")).toBeVisible();
    await page.locator("video").dispatchEvent("play");
    await expect(centerPlay.locator(".lucide-pause")).toBeVisible();
    await expect(centerTransport).toBeVisible();
    await page.locator("video").dispatchEvent("pause");
    await expect(centerPlay.locator(".lucide-play")).toBeVisible();
    await page.mouse.move(1100, 100);
    await expect(centerTransport).toHaveCount(0);
  }
  const seek = page.getByRole("slider", { name: "Seek video" });
  await seek.hover({ position: { x: 100, y: 8 } });
  if (testInfo.project.name === "ipad") {
    await expect(page.locator(".seek-preview")).toHaveCount(0);
    await expect(seek).toHaveCSS("cursor", "default");
  } else {
    await expect(page.locator(".seek-preview")).toBeVisible();
    await expect(page.locator(".seek-preview strong")).toHaveText(/\d+:\d{2}/);
  }
  await expect(page.locator(".seek-thumbnail")).toHaveCount(0);
  await page.getByRole("button", { name: "Subtitle settings" }).click();
  await expect(page.locator("header.settings-heading")).toContainText("Caption appearance");
  await expect(page.locator(".settings-intro")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Text", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Position & background" })).toBeVisible();
  await expect(page.getByLabel("Subtitle track").locator("option").nth(1)).toHaveText("English");
  await expect(page.getByText("Text size 85%", { exact: true })).toBeVisible();
  await expect(page.getByText("Background opacity 50%", { exact: true })).toBeVisible();
  const lineHeight = page.locator("label", { hasText: "Line height" });
  await expect(lineHeight.locator('input[type="range"]')).toHaveAttribute("min", "1.45");
  await expect(lineHeight.locator('input[type="range"]')).toHaveAttribute("step", "0.01");
  await expect(lineHeight.locator("b")).toHaveText("1.52");
  const verticalOffset = page.locator("label", { hasText: "Vertical offset" });
  await expect(verticalOffset.locator('input[type="range"]')).toHaveAttribute("min", "0");
  await expect(verticalOffset.locator("b")).toHaveText("12%");
  await verticalOffset.locator('input[type="range"]').fill("25");
  await expect(verticalOffset.locator("b")).toHaveText("25%");
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(verticalOffset.locator("b")).toHaveText("8%");
  await verticalOffset.locator('input[type="range"]').fill("10");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(verticalOffset.locator("b")).toHaveText("25%");
  const subtitleSelect = page.getByLabel("Subtitle track");
  expect(await subtitleSelect.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(61.5);
  await expect(subtitleSelect).toHaveCSS("font-size", "16px");
  const subtitleModal = page.locator(".modal-card", { has: page.getByRole("heading", { name: "Subtitles" }) });
  expect(await subtitleModal.evaluate((element) => element.scrollHeight <= element.clientHeight)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByLabel("Subtitle track").selectOption("");
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
  await page.evaluate(() => {
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value(this: HTMLElement) { this.setAttribute("data-fullscreen-requested", "true"); return Promise.resolve(); },
    });
  });
  await page.locator("video").evaluate((video) => {
    Object.defineProperty(video, "webkitEnterFullscreen", {
      configurable: true,
      value: () => video.setAttribute("data-native-fullscreen-requested", "true"),
    });
  });
  await page.locator(".player-shell").evaluate((shell) => shell.removeAttribute("data-fullscreen-requested"));
  await page.getByRole("button", { name: "Enter fullscreen" }).click();
  await expect(page.locator("video")).not.toHaveAttribute("data-native-fullscreen-requested", "true");
  await expect(page.locator(".player-shell > .subtitle-layer")).toHaveText("First cue");
  if (testInfo.project.name === "ipad") {
    await expect(page.locator(".player-shell")).toHaveClass(/player-viewport-fullscreen/);
    await page.getByRole("button", { name: "Exit fullscreen" }).click();
  } else {
    await expect(page.locator(".player-shell")).toHaveAttribute("data-fullscreen-requested", "true");
  }
  await page.evaluate(() => {
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", { configurable: true, value: undefined });
    Object.defineProperty(HTMLElement.prototype, "webkitRequestFullscreen", { configurable: true, value: undefined });
  });
  await page.locator("video").evaluate((video) => {
    Object.defineProperty(video, "webkitEnterFullscreen", {
      configurable: true,
      value: () => {
        document.body.dataset.customSubtitleAtNativeEntry = String(Boolean(document.querySelector(".subtitle-layer")));
        document.body.dataset.nativeSubtitleModeAtEntry = video.querySelector("track")?.track.mode ?? "missing";
      },
    });
  });
  if (testInfo.project.name === "ipad") {
    await page.getByRole("button", { name: "Enter fullscreen" }).click();
    await expect(page.locator(".player-shell")).toHaveClass(/player-viewport-fullscreen/);
    await expect(page.locator("body")).not.toHaveAttribute("data-custom-subtitle-at-native-entry", "false");
    await expect(page.locator(".player-shell > .subtitle-layer")).toHaveText("First cue");
  } else {
    await page.getByRole("button", { name: "Enter fullscreen" }).click();
    await expect(page.locator("body")).toHaveAttribute("data-custom-subtitle-at-native-entry", "false");
    await expect(page.locator("body")).toHaveAttribute("data-native-subtitle-mode-at-entry", "showing");
    await page.locator("video").evaluate((video) => video.dispatchEvent(new Event("webkitendfullscreen")));
  }
  await expect(page.locator(".subtitle-layer")).toHaveText("First cue");
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
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => page.locator("video").evaluate((video) => video.currentTime)).toBe(57.25);
  await page.keyboard.press("j");
  await expect.poll(() => page.locator("video").evaluate((video) => video.currentTime)).toBe(47.25);
  await page.getByRole("button", { name: "Playback settings" }).click();
  await expect(page.locator("header.settings-heading")).toContainText("Playback settings");
  await expect(page.getByRole("heading", { name: "Playback", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Picture", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Audio", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Diagnostics", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Stats for nerds/ }).click();
  await expect(page.locator(".stats-panel")).toContainText("Playback");
  await expect(page.locator(".stats-panel")).toContainText("Media state");
  await page.getByRole("button", { name: "Done" }).click();
  await page.locator("video").evaluate((video) => {
    Object.defineProperty(video, "paused", { configurable: true, get: () => false });
    Object.defineProperty(video, "pause", { configurable: true, value: () => { video.dataset.spacebarAction = "paused"; } });
  });
  await page.keyboard.press("Space");
  await expect(page.locator("video")).toHaveAttribute("data-spacebar-action", "paused");
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
