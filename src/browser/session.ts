import { Browser, BrowserContext, chromium } from 'playwright';
import { BrowserConfig } from '../config.js';

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
}

export async function createBrowserSession(
  config: BrowserConfig,
  initScript?: string
): Promise<BrowserSession> {
  const browser = await chromium.launch({
    headless: config.headless,
    slowMo: config.slowMo,
    args: config.launchArgs
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });

  await context.grantPermissions(['microphone', 'camera']);

  // init scriptがあれば、ページ作成前に注入
  if (initScript) {
    console.log('🔧 BrowserContextにinit scriptを注入中...');
    await context.addInitScript(initScript);
    console.log('✓ Init scriptを注入しました。');
  }

  return { browser, context };
}

