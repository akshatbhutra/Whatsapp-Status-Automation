import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IMAGE_PATH = path.resolve(__dirname, 'god_photo.jpg');
const SESSION_DIR = path.resolve(__dirname, 'whatsapp_session');

// Helper to get today's date in IST with Hindi month names
function getTodayHindiDate() {
  const today = new Date();
  
  // Format day, month, and year in Asia/Kolkata timezone
  const formatter = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata' });
  const day = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric' }).format(today);
  const year = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', year: 'numeric' }).format(today);
  
  // Get month index (0-11)
  const monthIndex = parseInt(new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', month: 'numeric' }).format(today), 10) - 1;
  const hindiMonths = ["जनवरी", "फरवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितम्बर", "अक्टूबर", "नवम्बर", "दिसम्बर"];
  
  return { day, month: hindiMonths[monthIndex], year };
}

async function postWhatsAppStatus() {
  console.log('Launching browser session...');
  const context = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    args: ['--start-maximized']
  });

  const page = await context.newPage();

  try {
    // ==========================================
    // STEP 1: Scrape YouTube for Today's Image
    // ==========================================
    const { day, month, year } = getTodayHindiDate();
    const targetText = 'आज के दिव्य श्रृंगार दर्शन - सालासर बालाजी';
    
    console.log(`Searching YouTube for: "${targetText}" on ${day} ${month} ${year}`);
    await page.goto('https://www.youtube.com/@salasarofficial/posts');
    
    // Wait for the community posts to load
    await page.waitForSelector('ytd-backstage-post-thread-renderer', { timeout: 30000 });
    
    const posts = page.locator('ytd-backstage-post-thread-renderer');
    const postCount = await posts.count();
    let foundImage = false;

    // Iterate through the latest 5 posts to find today's match
    for (let i = 0; i < Math.min(postCount, 5); i++) {
      const post = posts.nth(i);
      const textElement = post.locator('#content-text');
      const text = await textElement.innerText();

      // Check if the post text contains both the static string and all date components
      if (text.includes(targetText) && text.includes(day) && text.includes(month) && text.includes(year)) {
        console.log('Matching post found! Extracting image...');
        
        // Scroll to the post to trigger YouTube's lazy-loading for images
        await post.scrollIntoViewIfNeeded();
        await page.waitForTimeout(2000); 

        const imgEl = post.locator('ytd-backstage-image-renderer img').first();
        const imgSrc = await imgEl.getAttribute('src');

        if (imgSrc) {
          console.log('Downloading image...');
          const response = await fetch(imgSrc);
          const buffer = await response.arrayBuffer();
          fs.writeFileSync(IMAGE_PATH, Buffer.from(buffer));
          foundImage = true;
          console.log('Image saved successfully!');
          break;
        }
      }
    }

    if (!foundImage) {
      console.log(`Report: No matching post found for today (${day} ${month} ${year}). Exiting script.`);
      await context.close();
      process.exit(0);
    }

    // ==========================================
    // STEP 2: Post to WhatsApp Status
    // ==========================================
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
    const captionBox = page.locator('div[contenteditable="true"]').last();
    await captionBox.waitFor({ state: 'visible', timeout: 20000 });
    await page.waitForTimeout(1000);

    console.log('Posting status via Enter key...');
    await captionBox.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);

    if (await captionBox.isVisible().catch(() => false)) {
      console.log('Enter key did not send. Using structural DOM fallback click...');
      const allButtons = page.locator('div[role="button"]');
      const count = await allButtons.count();
      if (count > 0) {
        await allButtons.nth(count - 1).click({ force: true });
      }
    }

    console.log('Status updated successfully!');
    await page.waitForTimeout(6000);

  } catch (error) {
    console.error('An error occurred during execution:', error);
  } finally {
    // Optional: Clean up the image file after posting so it's fresh for tomorrow
    if (fs.existsSync(IMAGE_PATH)) {
      fs.unlinkSync(IMAGE_PATH);
    }
    await context.close();
  }
}

postWhatsAppStatus();