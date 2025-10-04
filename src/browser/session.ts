import { Browser, BrowserContext, chromium } from 'playwright';
import { BrowserConfig } from '../config.js';

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
}

export async function createBrowserSession(config: BrowserConfig): Promise<BrowserSession> {
  const browser = await chromium.launch({
    headless: config.headless,
    slowMo: config.slowMo,
    args: config.launchArgs
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });

  await context.grantPermissions(['microphone', 'camera']);

  return { browser, context };
}

