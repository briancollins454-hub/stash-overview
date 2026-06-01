#!/usr/bin/env node
import path from "node:path";
import { chromium } from "playwright";

const adminUrl = process.argv[2];
const csvPathArg = process.argv[3];

if (!adminUrl || !csvPathArg) {
  console.error("Usage: node scripts/mizuno-teamwear/import-shopify-csv.mjs <shopify-admin-url> <csv-path>");
  process.exit(1);
}

const csvPath = path.resolve(process.cwd(), csvPathArg);
const profileDir = path.resolve(process.cwd(), "scripts/mizuno-teamwear/.shopify-profile");

const clickFirstVisible = async (page, candidates, timeoutMs = 6000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const locator of candidates) {
      try {
        const count = await locator.count();
        if (!count) continue;
        const first = locator.first();
        if (await first.isVisible()) {
          await first.click();
          return true;
        }
      } catch {
        // Try next candidate.
      }
    }
    await page.waitForTimeout(250);
  }
  return false;
};

const main = async () => {
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: "chrome",
    headless: false,
    viewport: { width: 1500, height: 950 },
  });
  const page = context.pages()[0] || (await context.newPage());

  await page.goto(adminUrl, { waitUntil: "domcontentloaded" });
  console.log("If prompted, complete Shopify login/2FA in the opened Chrome window. Waiting 60 seconds...");
  await page.waitForTimeout(60000);

  const currentUrl = page.url();
  if (/login|identity|challenge|oauth/i.test(currentUrl)) {
    throw new Error(`Shopify login not completed. Current URL: ${currentUrl}`);
  }

  // Go to products page.
  await page.goto(`${adminUrl}/products`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);

  // Open Import modal.
  const importClicked = await clickFirstVisible(page, [
    page.getByRole("button", { name: /^import$/i }),
    page.getByRole("button", { name: /import/i }),
    page.locator("button:has-text('Import')"),
    page.getByRole("link", { name: /import/i }),
  ]);

  if (!importClicked) {
    // Try overflow menu route.
    const moreActionsClicked = await clickFirstVisible(page, [
      page.getByRole("button", { name: /more actions/i }),
      page.locator("button:has-text('More actions')"),
      page.locator("button[aria-label*='More actions']"),
    ]);
    if (moreActionsClicked) {
      await page.waitForTimeout(500);
      const menuImportClicked = await clickFirstVisible(page, [
        page.getByRole("menuitem", { name: /import/i }),
        page.getByRole("button", { name: /import/i }),
        page.locator("[role='menuitem']:has-text('Import')"),
        page.locator("button:has-text('Import')"),
      ]);
      if (!menuImportClicked) {
        throw new Error("Could not find Import option under More actions.");
      }
    } else {
      throw new Error("Could not find Import button on Shopify products page.");
    }
  }

  await page.waitForTimeout(700);

  // First file chooser can be button or input.
  const chooseButton = page.getByRole("button", { name: /add file|choose file|upload file|select file/i }).first();
  if (await chooseButton.isVisible().catch(() => false)) {
    const chooserPromise = page.waitForEvent("filechooser", { timeout: 15000 });
    await chooseButton.click();
    const chooser = await chooserPromise;
    await chooser.setFiles(csvPath);
  } else {
    const fileInput = page.locator("input[type='file']").first();
    await fileInput.setInputFiles(csvPath);
  }

  await page.waitForTimeout(800);

  // Continue/Upload step.
  const continueClicked = await clickFirstVisible(page, [
    page.getByRole("button", { name: /upload and continue/i }),
    page.getByRole("button", { name: /preview products/i }),
    page.getByRole("button", { name: /^continue$/i }),
    page.locator("button:has-text('Continue')"),
  ], 15000);
  if (!continueClicked) {
    throw new Error("Could not click continue/preview after file selection.");
  }
  await page.waitForTimeout(1000);

  // Confirm import.
  const confirmClicked = await clickFirstVisible(page, [
    page.getByRole("button", { name: /^import products$/i }),
    page.getByRole("button", { name: /^import$/i }),
    page.locator("button:has-text('Import products')"),
    page.locator("button:has-text('Import')"),
  ], 20000);
  if (!confirmClicked) {
    throw new Error("Could not confirm final import action.");
  }

  await page.waitForTimeout(2000);
  console.log("Import submitted. Monitor Shopify import progress in admin.");
  await context.close();
};

main().catch((err) => {
  console.error("Shopify import failed:", err);
  process.exit(1);
});

