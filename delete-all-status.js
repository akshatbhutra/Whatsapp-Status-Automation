import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Same session folder as post_whatsapp_status.js so you stay logged in to WhatsApp Web
const SESSION_DIR = path.resolve(__dirname, 'whatsapp_session');

async function deleteAllExistingStatuses(page) {
  console.log('\n[Cleanup] Opening WhatsApp Web to delete existing statuses...');
  await page.goto('https://web.whatsapp.com');
  await page.waitForSelector('div[id="app"]', { timeout: 90000 });
  await page.waitForTimeout(3000);

  const statusTab = page
    .locator('button[aria-label="Status"], div[aria-label="Status"], span[data-icon="status-v3"]')
    .first();
  await statusTab.click();
  await page.waitForTimeout(2000);

  // Finds the three-dots button in the TOP-RIGHT corner of the status viewer.
  // Looks at every candidate menu icon and picks the one closest to the top-right.
  const findTopRightMenuBtn = async () => {
    // The three dots is an SVG whose <title> is "ic-more-vert" (wrapped in a span)
    const candidates = page.locator(
      'xpath=//span[@aria-hidden="true"][./*[local-name()="svg"][.//*[local-name()="title"][normalize-space()="ic-more-vert"]]]'
    );
    const n = await candidates.count();
    const winWidth = await page.evaluate(() => window.innerWidth);
    let best = null;
    let bestScore = -Infinity;
    for (let k = 0; k < n; k++) {
      const el = candidates.nth(k);
      if (!(await el.isVisible().catch(() => false))) continue;
      const box = await el.boundingBox().catch(() => null);
      if (!box) continue;
      // Ignore three-dots in the left Status panel (e.g. its own menu);
      // the status viewer's three dots sit in the right part of the screen.
      if (box.x < winWidth * 0.6) continue;
      // Far right (big x) and near the top (small y) scores highest
      const score = box.x - box.y * 2;
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    return best;
  };

  let deleted = 0;
  const MAX_DELETES = 30; // safety cap

  for (let i = 0; i < MAX_DELETES; i++) {
    // 1) Go to the status: open "My status" so the status viewer opens
    //    (after a delete, the viewer may already be showing the next status)
    let menuBtn = await findTopRightMenuBtn();
    if (!menuBtn) {
      const myStatus = page.getByText('My status').first();
      if (!(await myStatus.isVisible().catch(() => false))) break;
      await myStatus.click();
      await page.waitForTimeout(2000);
      menuBtn = await findTopRightMenuBtn();
    }

    // No three-dots menu means there are no statuses left
    if (!menuBtn) {
      console.log('[Cleanup] No status viewer three-dots found (no statuses left, or viewer did not open).');
      if (deleted === 0) {
        const shot = path.resolve(__dirname, 'cleanup_debug.png');
        await page.screenshot({ path: shot }).catch(() => {});
        console.log(`[Cleanup] Debug screenshot saved: ${shot}`);
      }
      break;
    }

    // 2) Click the three dots in the top-right corner
    await menuBtn.click();
    await page.waitForTimeout(800);

    // 3) In the popup, click "Delete"
    // Popup row: <div><div><span><svg><title>ic-delete</title>...</svg></span></div><div><span>Delete</span></div></div>
    const deleteRow = page
      .locator(
        'xpath=//div[./div/span/*[local-name()="svg"][.//*[local-name()="title"][normalize-space()="ic-delete"]]]'
      )
      .first();
    const deleteIcon = page
      .locator('xpath=//*[local-name()="svg"][.//*[local-name()="title"][normalize-space()="ic-delete"]]')
      .first();

    if (await deleteRow.isVisible().catch(() => false)) {
      await deleteRow.click();
    } else if (await deleteIcon.isVisible().catch(() => false)) {
      await deleteIcon.click();
    } else {
      console.log('[Cleanup] Delete option not found in popup. Stopping.');
      const shot = path.resolve(__dirname, 'cleanup_debug.png');
      await page.screenshot({ path: shot }).catch(() => {});
      console.log(`[Cleanup] Debug screenshot saved: ${shot}`);
      break;
    }
    await page.waitForTimeout(800);

    // 4) Confirmation dialog -> click the "Delete" button
    const confirmBtn = page.locator('button:has-text("Delete")').last();
    try {
      await confirmBtn.waitFor({ state: 'visible', timeout: 3000 });
      await confirmBtn.click();
    } catch {
      // No confirmation dialog appeared; the first click already deleted it
    }

    deleted++;
    console.log(`[Cleanup] Deleted status #${deleted}`);
    await page.waitForTimeout(2000);
  }

  // Close any open viewer/panel
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(1000);

  console.log(`[Cleanup] Done. Deleted ${deleted} existing status(es).`);
}

// ==========================================
// MAIN
// ==========================================
async function main() {
  console.log('Launching browser session...');
  const context = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    args: ['--start-maximized'],
  });

  const page = await context.newPage();

  try {
    await deleteAllExistingStatuses(page);
  } catch (error) {
    console.error('An error occurred while deleting statuses:', error);
  } finally {
    await context.close();
  }
}

main();