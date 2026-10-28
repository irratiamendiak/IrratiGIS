import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const requested = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    const path = resolve(root, "." + requested);
    if (path !== root && !path.startsWith(root + sep)) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    const body = await readFile(path);
    res.writeHead(200, { "content-type": mime[extname(path)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("Not found");
  }
});

let browser;
try {
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(4173, "127.0.0.1", resolveListen);
  });
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));

  await page.goto("http://127.0.0.1:4173/", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForFunction(() => window.L && document.querySelector("#map")?._leaflet_id,
    null, { timeout: 45000 });
  assert.ok(await page.locator("#map .leaflet-control-container").count(),
    "Leaflet map controls should initialize");
  assert.ok(await page.locator("#map").evaluate(el => el.clientHeight >= 400),
    "Map should have a usable visible height");

  const oacelLabel = page.locator(".leaflet-control-layers-overlays label")
    .filter({ hasText: "Suteen bilakaera (simulazioa)" });
  await oacelLabel.waitFor({ state: "visible", timeout: 15000 });
  const checkbox = oacelLabel.locator('input[type="checkbox"]');
  await checkbox.check({ force: true });
  await page.locator(".fs-panel").waitFor({ state: "visible", timeout: 5000 });
  await assertPanelControls(page);
  await checkbox.uncheck({ force: true });
  await page.waitForFunction(() => {
    const panel = document.querySelector(".fs-panel");
    return panel && getComputedStyle(panel).display === "none";
  }, null, { timeout: 5000 });

  assert.deepEqual(pageErrors, [], "Page must not throw uncaught JavaScript errors");
  console.log("Browser OACEL smoke checks passed: map initialized; OACEL panel opened, controls rendered, and panel closed.");
} finally {
  if (browser) await browser.close();
  await new Promise(resolveClose => server.close(resolveClose));
}

async function assertPanelControls(page) {
  for (const selector of [".fs-set", ".fs-team", ".fs-export", ".fs-clr", ".fs-elapsed"]) {
    assert.equal(await page.locator(".fs-panel " + selector).count(), 1,
      "Expected OACEL panel control: " + selector);
  }
}
