import { chromium } from 'playwright';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Same session folder as the other scripts so you stay logged in to WhatsApp Web
const SESSION_DIR = path.resolve(__dirname, 'whatsapp_session');

// ==========================================
// Helpers
// ==========================================
function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    })
  );
}

const normalize = (s) => (s || '').replace(/\s+/g, ' ').trim();

// Matches "online", "typing...", "last seen today at 10:30 pm", "last seen yesterday at ..."
const PRESENCE_REGEX = /(^online$|typing|recording|last seen)/i;

// ==========================================
// Search for a contact and open the chat
// ==========================================
async function openContactChat(page, contactName) {
  // 1) Find the search box:
  //    <input role="textbox" aria-label="Search or start a new chat" data-tab="3" placeholder="Search or start a new chat">
  const searchBox = page
    .locator(
      'input[aria-label="Search or start a new chat"], input[placeholder="Search or start a new chat"], input[role="textbox"][data-tab="3"]'
    )
    .first();

  await searchBox.waitFor({ state: 'visible', timeout: 20000 });

  // 2) Type the contact name into it
  await searchBox.click();
  await searchBox.fill(''); // clear any previous search
  await searchBox.type(contactName, { delay: 60 });
  await page.waitForTimeout(2500);

  // 3) Continue: pick the matching result below

  // Each search result: <div data-testid="cell-frame-container"> ... 
  //   <div data-testid="cell-frame-title"><span title="Navita Bhutra">...</span></div>
  const results = page.locator('[data-testid="cell-frame-container"]');
  const count = await results.count();
  const wanted = normalize(contactName).toLowerCase();

  let exactMatch = null;
  const similarNames = [];

  for (let i = 0; i < count; i++) {
    const result = results.nth(i);
    const nameEl = result.locator('[data-testid="cell-frame-title"] span[title]').first();

    // The visible text is split into highlight spans, so use the title attribute (full name)
    const name = normalize(
      (await nameEl.getAttribute('title').catch(() => '')) ||
        (await nameEl.innerText().catch(() => ''))
    );
    if (!name) continue;

    if (name.toLowerCase() === wanted) {
      exactMatch = result; // exact name match -> click this one
      break;
    }
    similarNames.push(name);
  }

  if (!exactMatch) {
    if (similarNames.length) {
      console.log(`No exact match for "${contactName}". Similar results: ${similarNames.join(', ')}`);
    }
    return false;
  }

  // Click the exact-match result (opens the chat)
  await exactMatch.click();
  await page.waitForTimeout(1500);
  return true;
}

// ==========================================
// Read the "online" / "last seen" text from the chat header
// ==========================================
async function readPresence(page, timeoutMs = 10000) {
  // Header: <div data-testid="conversation-info-header"> ... chat-title span ... </div>
  const header = page.locator('[data-testid="conversation-info-header"]').first();
  await header.waitFor({ state: 'visible', timeout: 15000 });

  const nameEl = header.locator('[data-testid="conversation-info-header-chat-title"]').first();
  const deadline = Date.now() + timeoutMs;
  let name = '';

  // Presence loads a moment after the chat opens, so poll for it
  while (Date.now() < deadline) {
    name = normalize(await nameEl.innerText().catch(() => ''));

    // Layout A: presence is a dedicated span, e.g.
    //   <span data-testid="selectable-text" title="online">online</span>
    const presenceSpans = page.locator(
      '[data-testid="conversation-info-header"] span[data-testid="selectable-text"], #main header span[data-testid="selectable-text"]'
    );
    const spanCount = await presenceSpans.count();
    for (let i = 0; i < spanCount; i++) {
      const span = presenceSpans.nth(i);
      const text = normalize(
        (await span.getAttribute('title').catch(() => '')) ||
          (await span.innerText().catch(() => ''))
      );
      if (text && PRESENCE_REGEX.test(text)) return { name, presence: text };
    }

    // Layout B: the header's full text = name + (optional) "online" / "last seen ..." line
    const raw = await header.innerText().catch(() => '');
    const lines = raw
      .split('\n')
      .map(normalize)
      .filter(Boolean);

    const presence = lines.find((line) => PRESENCE_REGEX.test(line));
    if (presence) return { name, presence };

    await page.waitForTimeout(1000);
  }

  return { name, presence: null };
}

// ==========================================
// MAIN
// ==========================================
async function lookup(page, contactName) {
  try {
    const opened = await openContactChat(page, contactName);

    if (!opened) {
      console.log(`No contact found matching "${contactName}".`);
      return;
    }

    const { name, presence } = await readPresence(page);

    if (presence) {
      console.log(`${name || contactName}: ${presence}`);
    } else {
      console.log(
        `${name || contactName}: last seen / online status is not available ` +
          '(the contact may have hidden it in their privacy settings).'
      );
    }
  } catch (err) {
    console.error(`Could not read status for "${contactName}":`, err.message);
  }

  // Clear the search so the next lookup starts clean
  await page.keyboard.press('Escape').catch(() => {});
}

async function main() {
  // 1) Take the input FIRST (before WhatsApp Web is opened)
  let contactName = '';
  while (!contactName) {
    contactName = await ask('Enter contact name (or type "exit" to quit): ');
  }
  if (contactName.toLowerCase() === 'exit') return;

  // 2) Then launch the browser and open WhatsApp Web
  console.log('\nLaunching browser session...');
  const context = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    args: ['--start-maximized'],
  });

  const page = await context.newPage();

  try {
    console.log('Opening WhatsApp Web...');
    await page.goto('https://web.whatsapp.com');
    await page.waitForSelector('div[id="app"]', { timeout: 90000 });
    await page.waitForTimeout(4000);

    // 3) Look up the contact entered earlier
    await lookup(page, contactName);

    // 4) Optionally keep going with more contacts while the browser is open
    while (true) {
      const next = await ask('\nEnter another contact name (or press Enter / type "exit" to quit): ');
      if (!next || next.toLowerCase() === 'exit') break;
      await lookup(page, next);
    }
  } catch (error) {
    console.error('An error occurred during execution:', error);
  } finally {
    await context.close();
  }
}

main();