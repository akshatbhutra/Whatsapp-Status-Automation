import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SESSION_DIR = path.resolve(__dirname, 'whatsapp_session');

async function getOthersStatusNames() {
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

    console.log('Expanding Viewed and Muted/Hidden update sections...');
    // Attempt to expand collapsed sections to ensure all rows are injected into the DOM
    const viewedToggle = page.getByText(/Viewed (updates|status)/i).first();
    const mutedToggle = page.getByText(/Muted (updates|status)|Hidden (updates|status)/i).first();

    if (await viewedToggle.isVisible().catch(() => false)) {
      await viewedToggle.click().catch(() => {});
    }
    if (await mutedToggle.isVisible().catch(() => false)) {
      await mutedToggle.click().catch(() => {});
    }
    
    await page.waitForTimeout(2000); // Allow DOM to render newly expanded items

    console.log('Extracting status names...');
    
    // Target strictly the rows with data-focusid="status-row-item" and extract the title span
    const nameElements = page.locator('div[data-focusid="status-row-item"] div[data-testid="cell-frame-title"] span');
    
    await nameElements.first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => null);

    const count = await nameElements.count();
    const statusNames = new Set(); 

    for (let i = 0; i < count; i++) {
      const name = await nameElements.nth(i).innerText();
      if (name) {
        const cleanName = name.trim();
        // Ignore own status entry just in case it shares the attribute
        if (cleanName !== 'My status' && cleanName !== '') {
          statusNames.add(cleanName);
        }
      }
    }

    const namesArray = Array.from(statusNames);

    if (namesArray.length > 0) {
      console.log(`\n=== People with Active Statuses (${namesArray.length}) ===`);
      namesArray.forEach((name, index) => {
        console.log(`${index + 1}. ${name}`);
      });
      console.log('===========================================\n');
    } else {
      console.log('No status names could be extracted matching the criteria.');
    }

  } catch (error) {
    console.error('An error occurred during execution:', error);
  } finally {
    await context.close();
  }
}

getOthersStatusNames();