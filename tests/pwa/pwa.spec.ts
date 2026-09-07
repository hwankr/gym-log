import { expect, test } from "@playwright/test";

test("manifest, icons, installability, offline launch and reconnection", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "로그인", exact: true }),
  ).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
    )
    .toBe(true);

  const cdp = await context.newCDPSession(page);
  const { data: manifest } = await cdp.send("Page.getAppManifest");
  expect(JSON.parse(manifest)).toMatchObject({
    id: "/",
    start_url: "/",
    display: "standalone",
    lang: "ko",
  });
  const icons = JSON.parse(manifest).icons as { src: string; sizes: string }[];
  for (const icon of icons) {
    const dimensions = await page.evaluate(async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      return `${img.naturalWidth}x${img.naturalHeight}`;
    }, icon.src);
    expect(dimensions).toBe(icon.sizes);
  }
  expect(await cdp.send("Page.getInstallabilityErrors")).toEqual({
    installabilityErrors: [],
  });
  await cdp.detach();

  const cached = await page.evaluate(async () => {
    const cachesList = await Promise.all(
      (await caches.keys()).map((key) => caches.open(key)),
    );
    return (await Promise.all(cachesList.map((cache) => cache.keys())))
      .flat()
      .map((req) => new URL(req.url).pathname);
  });
  expect(cached).toContain("/index.html");
  expect(cached.some((path) => path.startsWith("/api"))).toBe(false);

  await context.setOffline(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?source=home#records");
  await expect(
    page.getByRole("heading", { name: "인터넷 연결을 기다리고 있어요" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "로그인", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      fetch("/api/auth/get-session").then(
        () => "cached",
        () => "offline",
      ),
    ),
  ).toBe("offline");
  await page.screenshot({
    path: "test-results/pwa-offline-mobile.png",
    fullPage: true,
  });
  await context.setOffline(false);
  await expect(
    page.getByRole("button", { name: "로그인", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("new worker waits for consent and preserves an offline workout draft", async ({
  page,
  context,
  request,
}) => {
  await context.addCookies([
    { name: "pwa-test-user", value: "1", url: "http://localhost:4173" },
  ]);
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect(
    page.getByRole("button", { name: "운동 기록하기", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "운동 기록하기", exact: true })
    .click();
  await page
    .getByLabel("운동 기록 이름", { exact: true })
    .fill("오프라인 초안");
  await page
    .getByRole("button", { name: "랫풀다운 추가", exact: true })
    .click();
  // A different worker byte stream exercises the real waiting/activation lifecycle.
  await request.post("/__test/update");
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.ready).update();
  });
  await expect(
    page.getByRole("button", {
      name: "업데이트",
      exact: true,
      includeHidden: true,
    }),
  ).toBeDisabled();
  await expect
    .poll(() =>
      page.evaluate(async () =>
        Boolean((await navigator.serviceWorker.ready).waiting),
      ),
    )
    .toBe(true);
  await context.setOffline(true);
  await expect(page.getByLabel("운동 기록 이름", { exact: true })).toHaveValue(
    "오프라인 초안",
  );
  await page
    .getByRole("button", { name: "운동 기록 저장", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByText("오프라인이에요.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByLabel("운동 기록 이름", { exact: true })).toHaveValue(
    "오프라인 초안",
  );
  await context.setOffline(false);
  await expect(page.getByLabel("운동 기록 이름", { exact: true })).toHaveValue(
    "오프라인 초안",
  );
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/data") &&
      response.request().method() === "PUT",
  );
  await page
    .getByRole("button", { name: "운동 기록 저장", exact: true })
    .click();
  expect((await (await saved).json()).data.workouts[0].name).toBe(
    "오프라인 초안",
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "업데이트", exact: true }),
  ).toBeEnabled();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "업데이트", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(async () =>
        Boolean((await navigator.serviceWorker.ready).waiting),
      ),
    )
    .toBe(true);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "업데이트", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "업데이트", exact: true }),
  ).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(async () =>
        Boolean((await navigator.serviceWorker.ready).waiting),
      ),
    )
    .toBe(false);
});

test("install prompt can be dismissed and offered again; installed app hides install control", async ({
  page,
}) => {
  await page.goto("/");
  const offer = () =>
    page.evaluate(() => {
      const event = new Event("beforeinstallprompt");
      Object.assign(event, {
        prompt: async () => {},
        userChoice: Promise.resolve({ outcome: "dismissed" }),
      });
      window.dispatchEvent(event);
    });
  await offer();
  await page.getByRole("button", { name: "Gym Log 앱 설치" }).click();
  await expect(
    page.getByRole("button", { name: "Gym Log 앱 설치" }),
  ).toHaveCount(0);
  await offer();
  await expect(
    page.getByRole("button", { name: "Gym Log 앱 설치" }),
  ).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
  await expect(
    page.getByRole("button", { name: "Gym Log 앱 설치" }),
  ).toHaveCount(0);
});

test("iOS installation guidance fits a mobile screen", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto("http://localhost:4173");
  await expect(
    page.getByText("브라우저의 공유 메뉴", { exact: false }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/pwa-install-mobile.png",
    fullPage: true,
  });
  await context.close();
});
