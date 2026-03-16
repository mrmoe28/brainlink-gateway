import { Router, Request, Response } from 'express';
import * as browser from './browser-service.js';
import pino from 'pino';

const log = pino({ name: 'browse-router' });

export const browseRouter: Router = Router();

// POST /api/browse — execute a browser command
browseRouter.post('/', async (req: Request, res: Response) => {
  const { action, url, selector, value, text, key, code, direction, amount, index, filePath: filePathParam } = req.body;

  if (!action) {
    res.status(400).json({ error: 'action is required' });
    return;
  }

  try {
    let result: any;

    switch (action) {
      case 'navigate':
        if (!url) { res.status(400).json({ error: 'url required' }); return; }
        result = await browser.navigate(url);
        break;

      case 'snapshot':
        result = { tree: await browser.snapshot() };
        break;

      case 'screenshot':
        result = { image: await browser.screenshot(), format: 'base64/png' };
        break;

      case 'click':
        if (!selector) { res.status(400).json({ error: 'selector required' }); return; }
        result = { message: await browser.click(selector) };
        break;

      case 'fill':
        if (!selector || value === undefined) { res.status(400).json({ error: 'selector and value required' }); return; }
        result = { message: await browser.fill(selector, value) };
        break;

      case 'type':
        if (!selector || !text) { res.status(400).json({ error: 'selector and text required' }); return; }
        result = { message: await browser.type(selector, text) };
        break;

      case 'press_key':
        if (!key) { res.status(400).json({ error: 'key required' }); return; }
        result = { message: await browser.pressKey(key) };
        break;

      case 'get_text':
        result = { text: await browser.getText() };
        break;

      case 'get_links':
        result = { links: await browser.getLinks() };
        break;

      case 'evaluate':
        if (!code) { res.status(400).json({ error: 'code required' }); return; }
        result = { output: await browser.evaluate(code) };
        break;

      case 'close':
        await browser.closeBrowser();
        result = { message: 'Browser closed' };
        break;

      case 'restart':
        await browser.restartBrowser();
        result = { message: 'Browser restarted' };
        break;

      case 'scroll':
        result = { message: await browser.scroll(direction || 'down', amount) };
        break;

      case 'hover':
        if (!selector) { res.status(400).json({ error: 'selector required' }); return; }
        result = { message: await browser.hover(selector) };
        break;

      case 'select':
        if (!selector || !value) { res.status(400).json({ error: 'selector and value required' }); return; }
        result = { message: await browser.selectOption(selector, value) };
        break;

      case 'wait_for':
        if (!selector) { res.status(400).json({ error: 'selector required' }); return; }
        result = { message: await browser.waitFor(selector, amount) };
        break;

      case 'click_text':
        if (!text) { res.status(400).json({ error: 'text required' }); return; }
        result = { message: await browser.clickText(text) };
        break;

      case 'back':
        result = { message: await browser.goBack() };
        break;

      case 'forward':
        result = { message: await browser.goForward() };
        break;

      case 'upload_file':
        if (!selector || !filePathParam) { res.status(400).json({ error: 'selector and filePath required' }); return; }
        result = { message: await browser.uploadFile(selector, filePathParam) };
        break;

      case 'list_tabs':
        result = { tabs: await browser.listTabs() };
        break;

      case 'switch_tab':
        if (index === undefined) { res.status(400).json({ error: 'index required' }); return; }
        result = { message: await browser.switchTab(index) };
        break;

      case 'current_page':
        result = await browser.currentPage();
        break;

      default:
        res.status(400).json({ error: `Unknown action: ${action}` });
        return;
    }

    log.info({ action, url, selector }, 'Browse action executed');
    res.json(result);
  } catch (err) {
    log.error({ err, action }, 'Browse action failed');
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
