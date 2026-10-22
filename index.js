import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SESSION_DIR = path.resolve(__dirname, 'whatsapp_session');

// ==========================================
// SOURCES: each entry = one YouTube channel post -> one WhatsApp status
// ==========================================
const SOURCES = [
  {
    name: 'Salasar Balaji',
    url: 'https://www.youtube.com/@salasarofficial/posts',
    imagePath: path.resolve(__dirname, 'salasar_photo.jpg'),
    // Post must contain all of these strings AND today's date (day, Hindi month, year)
    requiredTexts: ['आज के दिव्य श्रृंगार दर्शन - सालासर बालाजी'],
    matchToday: 'date-in-text',
  },
  {
    name: 'Shri Shyam Darshan',
    url: 'https://www.youtube.com/@ShriShyamDarshan/posts',
    imagePath: path.resolve(__dirname, 'shyam_photo.jpg'),
    // These posts carry no date in the text, so we match the text lines and
    // make sure the post was published today using YouTube's "x hours ago" label.
    requiredTexts: ['हारे का सहारा', 'बाबा श्याम हमारा', 'जय श्री श्याम जी'],
    matchToday: 'relative-time',
  },
];

const MAX_POSTS_TO_CHECK = 5;

// ==========================================
// Helpers
// ==========================================

// Today's date in IST with Hindi month names
function getTodayHindiDate() {
  const today = new Date();
  const tz = 'Asia/Kolkata';

  const day = new Intl.DateTimeFormat('en-IN', { timeZone: tz, day: 'numeric' }).format(today);
  const year = new Intl.DateTimeFormat('en-IN', { timeZone: tz, year: 'numeric' }).format(today);
  const monthIndex =
    parseInt(new Intl.DateTimeFormat('en-IN', { timeZone: tz, month: 'numeric' }).format(today), 10) - 1;
  const hindiMonths = [
    'जनवरी', 'फरवरी', 'मार्च', 'अप्रैल', 'मई', 'जून',
    'जुलाई', 'अगस्त', 'सितम्बर', 'अक्टूबर', 'नवम्बर', 'दिसम्बर',
  ];

  return { day, month: hindiMonths[monthIndex], year };
}

const normalize = (s) => s.replace(/\s+/g, ' ').trim();

// "5 hours ago", "30 minutes ago", "Just now", "5 घंटे पहले" => today.
// "1 day ago", "2 weeks ago", "1 दिन पहले" => not today.
function isPostedToday(relativeTime) {
  const t = normalize(relativeTime || '').toLowerCase();
  if (!t) return false;
  const olderPattern = /(day|week|month|year|दिन|सप्ताह|हफ्ते|महीन|माह|साल|वर्ष)/i;
  return !olderPattern.test(t);
}

// Ask YouTube for a larger version of the image (default thumbs are small)
function upscaleYouTubeImage(src) {
  return src.replace(/=s\d+(-[a-z0-9-]+)?(?=$|\?)/i, '=s1080');
}

// ==========================================
// STEP 1: Scrape one source, return true if image saved
// ==========================================
async function scrapeSource(page, source, todayDate) {
  const { day, month, year } = todayDate;
  console.log(`\n[${source.name}] Searching for today's post (${day} ${month} ${year})...`);

  await page.goto(source.url);

  try {
    await page.waitForSelector('ytd-backstage-post-thread-renderer', { timeout: 30000 });
  } catch {
    console.log(`[${source.name}] No community posts loaded.`);
    return false;
  }

  const posts = page.locator('ytd-backstage-post-thread-renderer');
  const postCount = await posts.count();

  for (let i = 0; i < Math.min(postCount, MAX_POSTS_TO_CHECK); i++) {
    const post = posts.nth(i);
    const text = normalize(await post.locator('#content-text').innerText().catch(() => ''));

    // Static text match
    const hasAllTexts = source.requiredTexts.every((t) => text.includes(normalize(t)));
    if (!hasAllTexts) continue;

    // "Is this today's post?" check
    if (source.matchToday === 'date-in-text') {
      if (!(text.includes(day) && text.includes(month) && text.includes(year))) continue;
    } else if (source.matchToday === 'relative-time') {
      const timeText = await post
        .locator('#published-time-text')
        .first()
        .innerText()
        .catch(() => '');
      if (!isPostedToday(timeText)) {
        console.log(`[${source.name}] Matching text found but it is old ("${timeText.trim()}"). Skipping.`);
        continue;
      }
    }

    console.log(`[${source.name}] Matching post found! Extracting image...`);

    // Scroll to trigger YouTube's lazy-loading
    await post.scrollIntoViewIfNeeded();
    await page.waitForTimeout(2000);

    const imgEl = post.locator('ytd-backstage-image-renderer img').first();
    const imgSrc = await imgEl.getAttribute('src').catch(() => null);

    if (imgSrc) {
      console.log(`[${source.name}] Downloading image...`);
      const response = await fetch(upscaleYouTubeImage(imgSrc));
      const buffer = await response.arrayBuffer();
      fs.writeFileSync(source.imagePath, Buffer.from(buffer));
      console.log(`[${source.name}] Image saved successfully!`);
      return true;
    }
  }

  console.log(`[${source.name}] No matching post found for today.`);
  return false;
}

// ==========================================
// STEP 2: Post one image to WhatsApp Status
// ==========================================
async function postImageToWhatsAppStatus(page, imagePath, label) {
  console.log(`\n[${label}] Opening WhatsApp Web...`);
  await page.goto('https://web.whatsapp.com');

  console.log(`[${label}] Waiting for WhatsApp Web to load...`);
  await page.waitForSelector('div[id="app"]', { timeout: 90000 });
  await page.waitForTimeout(3000);

  console.log(`[${label}] Opening Status tab...`);
  const statusTab = page
    .locator('button[aria-label="Status"], div[aria-label="Status"], span[data-icon="status-v3"]')
    .first();
  await statusTab.click();
  await page.waitForTimeout(2000);

  const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 10000 }).catch(() => null);

  console.log(`[${label}] Clicking "Photo and video"...`);
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
    console.log(`[${label}] Attaching photo via FileChooser...`);
    await fileChooser.setFiles(imagePath);
  } else {
    console.log(`[${label}] Attaching photo via input selector...`);
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.waitFor({ state: 'attached', timeout: 15000 });
    await fileInput.setInputFiles(imagePath);
  }

  console.log(`[${label}] Waiting for image preview to render...`);
  const captionBox = page.locator('div[contenteditable="true"]').last();
  await captionBox.waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForTimeout(1000);

  console.log(`[${label}] Posting status via Enter key...`);
  await captionBox.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);

  if (await captionBox.isVisible().catch(() => false)) {
    console.log(`[${label}] Enter key did not send. Using structural DOM fallback click...`);
    const allButtons = page.locator('div[role="button"]');
    const count = await allButtons.count();
    if (count > 0) {
      await allButtons.nth(count - 1).click({ force: true });
    }
  }

  // Give WhatsApp time to upload before navigating away
  await page.waitForTimeout(6000);
  console.log(`[${label}] Status updated successfully!`);
}

// ==========================================
// MAIN
// ==========================================
async function postWhatsAppStatus() {
  console.log('Launching browser session...');
  const context = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    args: ['--start-maximized'],
  });

  const page = await context.newPage();
  const savedSources = [];

  try {
    // ---- Step 1: scrape every source ----
    const todayDate = getTodayHindiDate();

    for (const source of SOURCES) {
      try {
        const found = await scrapeSource(page, source, todayDate);
        if (found) savedSources.push(source);
      } catch (err) {
        console.error(`[${source.name}] Scrape failed:`, err);
      }
    }

    if (savedSources.length === 0) {
      console.log('Report: No matching posts found for any source today. Exiting script.');
      return;
    }

    // ---- Step 2: post each image as its own status ----
    for (const source of savedSources) {
      try {
        await postImageToWhatsAppStatus(page, source.imagePath, source.name);
      } catch (err) {
        console.error(`[${source.name}] Failed to post status:`, err);
      }
    }

    console.log('\nAll done!');
  } catch (error) {
    console.error('An error occurred during execution:', error);
  } finally {
    // Clean up images so they're fresh for tomorrow
    for (const source of SOURCES) {
      if (fs.existsSync(source.imagePath)) {
        fs.unlinkSync(source.imagePath);
      }
    }
    await context.close();
  }
}

postWhatsAppStatus();