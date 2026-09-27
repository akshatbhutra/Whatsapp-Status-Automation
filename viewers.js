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
    
    let statusIndex = 1;
    let hasNext = true;

    while (hasNext) {
      console.log(`\n--- Checking Status #${statusIndex} ---`);
      
      // Allow a brief moment for the status UI and view count to fully render
      await page.waitForTimeout(1500);

      const viewsBtn = page.locator('button[aria-label="See viewers"]').first();

      if (await viewsBtn.isVisible().catch(() => false)) {
        await viewsBtn.click();
        
        const popupModal = page.locator('div[data-testid="confirm-popup"]');
        
        // Wait to see if the modal successfully opens
        const modalAppeared = await popupModal.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);

        if (modalAppeared) {
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
            console.log(`Status #${statusIndex} Viewed By (${viewersArray.length} people):`);
            viewersArray.forEach((name, index) => {
              console.log(`  ${index + 1}. ${name}`);
            });
          } else {
            console.log(`Status #${statusIndex} has 0 views.`);
          }

          // Close the popup so the player resumes and we can click "Next status"
          const closeBtn = popupModal.locator('button[aria-label="Close"]').first();
          if (await closeBtn.isVisible().catch(() => false)) {
            await closeBtn.click();
          } else {
            await page.keyboard.press('Escape'); 
          }
          
          // Wait for the modal to completely disappear before moving on
          await popupModal.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
        } else {
          console.log(`Status #${statusIndex} has 0 views (Popup did not open).`);
        }
      } else {
        console.log(`Status #${statusIndex} has 0 views (Button not visible).`);
      }

      // Check for the "Next status" arrow button using the precise aria-label
      const nextBtn = page.locator('button[aria-label="Next status"]').first();
      
      if (await nextBtn.isVisible().catch(() => false)) {
        await nextBtn.click();
        statusIndex++;
      } else {
        console.log('\n=====================================');
        console.log('No more statuses to check.');
        hasNext = false;
      }
    }

  } catch (error) {
    console.error('An error occurred during execution:', error);
  } finally {
    await context.close();
  }
}

getStatusViewers();