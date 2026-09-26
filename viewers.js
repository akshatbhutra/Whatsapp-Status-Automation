import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SESSION_DIR = path.resolve(__dirname, 'whatsapp_session');

async function getStatusViewers() {
  console.log('Launching browser session...');
  const context = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    args: ['--start-maximized']
  });

  const page = await context.newPage();

  try {
    console.log('Opening WhatsApp Web...');
    await page.goto('https://web.whatsapp.com');

    console.log('Waiting for WhatsApp Web to load...');
    await page.waitForSelector('div[id="app"]', { timeout: 90000 });
    await page.waitForTimeout(3000);

    console.log('Opening Status tab...');
    const statusTab = page.locator('button[aria-label="Status"], div[aria-label="Status"], span[data-icon="status-v3"]').first();
    await statusTab.click();
    await page.waitForTimeout(2000);

    console.log('Clicking "My status" to open the fullscreen player...');
    const myStatusBtn = page.getByText('My status').first();
    await myStatusBtn.click();
    
    await page.waitForTimeout(2000);

    console.log('Looking for the "See viewers" button...');
    const viewsBtn = page.locator('button[aria-label="See viewers"]').first();

    if (await viewsBtn.isVisible().catch(() => false)) {
      await viewsBtn.click();
    } else {
      console.log('No viewers button found. You currently have 0 views on your status.');
      await context.close();
      return;
    }

    console.log('Waiting for the viewer popup to appear...');
    // 1. Target the specific modal container
    const popupModal = page.locator('div[data-testid="confirm-popup"]');
    await popupModal.waitFor({ state: 'visible', timeout: 10000 });

    console.log('Extracting viewer names from the popup...');
    // 2. Scope the name search STRICTLY inside the popup container
    const nameElements = popupModal.locator('div[data-testid="cell-frame-title"] span');
    
    const count = await nameElements.count();
    const viewers = new Set(); 

    for (let i = 0; i < count; i++) {
      const name = await nameElements.nth(i).innerText();
      if (name) {
        viewers.add(name.trim());
      }
    }

    const viewersArray = Array.from(viewers);

    if (viewersArray.length > 0) {
      console.log(`\n=== Status Viewed By (${viewersArray.length} people) ===`);
      viewersArray.forEach((name, index) => {
        console.log(`${index + 1}. ${name}`);
      });
      console.log('=====================================\n');
    } else {
      console.log('The viewer list was opened, but no names could be extracted.');
    }

  } catch (error) {
    console.error('An error occurred during execution:', error);
  } finally {
    await context.close();
  }
}

getStatusViewers();