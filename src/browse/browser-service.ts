import { chromium, BrowserContext, Page } from 'playwright';
import path from 'node:path';
import pino from 'pino';

const log = pino({ name: 'browser-service' });

const USER_DATA_DIR = path.resolve(process.cwd(), 'data/browser-profile');

let context: BrowserContext | null = null;
let page: Page | null = null;

async function launchContext(): Promise<BrowserContext> {
  log.info('Launching persistent browser...');
  const ctx = await chromium.launchPersistentContext(USER_DATA_DIR, {
    channel: 'chrome',
    headless: false,
    viewport: { width: 1280, height: 800 },
    args: ['--start-maximized', '--disable-blink-features=AutomationControlled'],
  });
  const pages = ctx.pages();
  if (pages.length > 0) {
    page = pages[0];
  }
  return ctx;
}

export async function getContext(): Promise<BrowserContext> {
  // Check if existing context is still alive
  if (context) {
    try {
      // Quick health check — if browser was closed this throws
      context.pages();
    } catch {
      log.warn('Browser context dead, relaunching...');
      context = null;
      page = null;
    }
  }
  if (!context) {
    context = await launchContext();
  }
  return context;
}

export async function restartBrowser(): Promise<void> {
  await closeBrowser();
  context = await launchContext();
  log.info('Browser restarted');
}

export async function getPage(): Promise<Page> {
  const ctx = await getContext();
  if (!page || page.isClosed()) {
    page = await ctx.newPage();
  }
  return page;
}

export async function navigate(url: string): Promise<{ title: string; url: string }> {
  const p = await getPage();
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  return { title: await p.title(), url: p.url() };
}

export async function snapshot(): Promise<string> {
  const p = await getPage();
  const title = await p.title();
  const url = p.url();
  // Get page text content as a lightweight snapshot
  const text = await p.evaluate(() => {
    const elements: string[] = [];
    document.querySelectorAll('a, button, input, select, textarea, h1, h2, h3, h4, label').forEach(el => {
      const tag = el.tagName.toLowerCase();
      const text = (el as HTMLElement).innerText?.trim().slice(0, 100);
      const href = (el as HTMLAnchorElement).href || '';
      const type = (el as HTMLInputElement).type || '';
      const name = (el as HTMLInputElement).name || (el as HTMLElement).id || '';
      const placeholder = (el as HTMLInputElement).placeholder || '';
      if (text || name || placeholder) {
        let desc = `[${tag}`;
        if (type) desc += ` type=${type}`;
        if (name) desc += ` name="${name}"`;
        if (placeholder) desc += ` placeholder="${placeholder}"`;
        desc += `]`;
        if (text) desc += ` ${text}`;
        if (href && tag === 'a') desc += ` -> ${href}`;
        elements.push(desc);
      }
    });
    return elements.join('\n');
  });
  return `Page: ${title}\nURL: ${url}\n\nElements:\n${text}`.slice(0, 6000);
}

export async function screenshot(): Promise<string> {
  const p = await getPage();
  const buffer = await p.screenshot({ type: 'png' });
  return buffer.toString('base64');
}

export async function click(selector: string): Promise<string> {
  const p = await getPage();
  try {
    await p.click(selector, { timeout: 10000 });
    await p.waitForTimeout(1000);
    return `Clicked: ${selector}`;
  } catch (err) {
    return `Click failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export async function fill(selector: string, value: string): Promise<string> {
  const p = await getPage();
  try {
    await p.fill(selector, value);
    return `Filled: ${selector}`;
  } catch (err) {
    return `Fill failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export async function type(selector: string, text: string): Promise<string> {
  const p = await getPage();
  try {
    await p.type(selector, text);
    return `Typed into: ${selector}`;
  } catch (err) {
    return `Type failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export async function pressKey(key: string): Promise<string> {
  const p = await getPage();
  await p.keyboard.press(key);
  return `Pressed: ${key}`;
}

export async function getText(): Promise<string> {
  const p = await getPage();
  const text = await p.evaluate(() => document.body.innerText);
  return text.slice(0, 8000);
}

export async function getLinks(): Promise<{ text: string; href: string }[]> {
  const p = await getPage();
  return p.evaluate(() =>
    Array.from(document.querySelectorAll('a[href]'))
      .slice(0, 50)
      .map(a => ({ text: (a as HTMLAnchorElement).innerText.trim().slice(0, 100), href: (a as HTMLAnchorElement).href }))
      .filter(l => l.text)
  );
}

export async function evaluate(code: string): Promise<string> {
  const p = await getPage();
  try {
    const result = await p.evaluate(code);
    return typeof result === 'string' ? result : JSON.stringify(result);
  } catch (err) {
    return `Eval failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// Scroll the page
export async function scroll(direction: 'up' | 'down', amount?: number): Promise<string> {
  const p = await getPage();
  const px = amount || 500;
  await p.evaluate(({ dir, px }) => {
    window.scrollBy(0, dir === 'down' ? px : -px);
  }, { dir: direction, px });
  return `Scrolled ${direction} ${px}px`;
}

// Hover over an element
export async function hover(selector: string): Promise<string> {
  const p = await getPage();
  try {
    await p.hover(selector, { timeout: 10000 });
    return `Hovered: ${selector}`;
  } catch (err) {
    return `Hover failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// Select dropdown option
export async function selectOption(selector: string, value: string): Promise<string> {
  const p = await getPage();
  try {
    await p.selectOption(selector, value);
    return `Selected "${value}" in ${selector}`;
  } catch (err) {
    return `Select failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// Wait for an element to appear
export async function waitFor(selector: string, timeoutMs?: number): Promise<string> {
  const p = await getPage();
  try {
    await p.waitForSelector(selector, { timeout: timeoutMs || 10000 });
    return `Element found: ${selector}`;
  } catch {
    return `Element not found within timeout: ${selector}`;
  }
}

// Click element by visible text
export async function clickText(text: string): Promise<string> {
  const p = await getPage();
  try {
    await p.getByText(text, { exact: false }).first().click({ timeout: 10000 });
    await p.waitForTimeout(1000);
    return `Clicked element with text: "${text}"`;
  } catch (err) {
    return `Click by text failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// Go back
export async function goBack(): Promise<string> {
  const p = await getPage();
  await p.goBack({ waitUntil: 'domcontentloaded', timeout: 15000 });
  return `Navigated back to: ${p.url()}`;
}

// Go forward
export async function goForward(): Promise<string> {
  const p = await getPage();
  await p.goForward({ waitUntil: 'domcontentloaded', timeout: 15000 });
  return `Navigated forward to: ${p.url()}`;
}

// Upload a file to a file input
export async function uploadFile(selector: string, filePath: string): Promise<string> {
  const p = await getPage();
  try {
    await p.setInputFiles(selector, filePath);
    return `Uploaded file to ${selector}: ${filePath}`;
  } catch (err) {
    return `Upload failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// List open tabs
export async function listTabs(): Promise<{ index: number; title: string; url: string }[]> {
  const ctx = await getContext();
  const pages = ctx.pages();
  return Promise.all(pages.map(async (p, i) => ({
    index: i,
    title: await p.title().catch(() => ''),
    url: p.url(),
  })));
}

// Switch to a tab by index
export async function switchTab(index: number): Promise<string> {
  const ctx = await getContext();
  const pages = ctx.pages();
  if (index < 0 || index >= pages.length) return `Invalid tab index: ${index}. ${pages.length} tabs open.`;
  page = pages[index];
  await page.bringToFront();
  return `Switched to tab ${index}: ${page.url()}`;
}

// Get current page URL and title
export async function currentPage(): Promise<{ title: string; url: string }> {
  const p = await getPage();
  return { title: await p.title(), url: p.url() };
}

export async function closeBrowser(): Promise<void> {
  if (page && !page.isClosed()) await page.close().catch(() => {});
  if (context) await context.close().catch(() => {});
  page = null;
  context = null;
  log.info('Browser closed');
}
