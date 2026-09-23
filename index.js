import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IMAGE_PATH = path.resolve(__dirname, 'god_photo.jpg');
const SESSION_DIR = path.resolve(__dirname, 'whatsapp_session');

async function postWhatsAppStatus() {
  if (!fs.existsSync(IMAGE_PATH)) {
    console.error(`Error: File not found at ${IMAGE_PATH}`);
    process.exit(1);
  }

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

    const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 10000 }).catch(() => null);

    console.log('Clicking "Photo and video"...');
    const photoVideoBtn = page.getByText('Photo and video').first();
    const plusIconBtn = page.locator('span[data-icon="plus"]').first();

    if (await photoVideoBtn.isVisible().catch(() => false)) {
      await photoVideoBtn.click();
    } else if (await plusIconBtn.isVisible().catch(() => false)) {
      await plusIconBtn.click();
    } else {
      await page.getByText('My status').first().click();
    }

    const fileChooser = await fileChooserPromise;
    if (fileChooser) {
      console.log('Attaching photo via FileChooser...');
      await fileChooser.setFiles(IMAGE_PATH);
    } else {
      console.log('Attaching photo via input selector...');
      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.waitFor({ state: 'attached', timeout: 15000 });
      await fileInput.setInputFiles(IMAGE_PATH);
    }

    console.log('Waiting for image preview to render...');
    
    // Target the "Add a caption" text box to ensure the preview is fully loaded
    const captionBox = page.locator('div[contenteditable="true"]').last();
    await captionBox.waitFor({ state: 'visible', timeout: 20000 });
    await page.waitForTimeout(1000); // Brief pause to ensure animations finish

    console.log('Posting status via Enter key...');
    
    // Method 1: Focus the caption box and hit Enter
    await captionBox.focus();
    await page.keyboard.press('Enter');
    
    await page.waitForTimeout(2000);

    // Verify if the Enter key worked by checking if the text box disappeared
    if (await captionBox.isVisible().catch(() => false)) {
      console.log('Enter key did not send. Using structural DOM fallback click...');
      
      // Method 2 (Fallback): The green send button is consistently the very last role="button" in the DOM
      const allButtons = page.locator('div[role="button"]');
      const count = await allButtons.count();
      if (count > 0) {
        await allButtons.nth(count - 1).click({ force: true });
      }
    }

    console.log('Status updated successfully!');
    
    // Wait a few seconds for the upload network request to finish before closing
    await page.waitForTimeout(6000);

  } catch (error) {
    console.error('An error occurred during execution:', error);
  } finally {
    await context.close();
  }
}

postWhatsAppStatus();