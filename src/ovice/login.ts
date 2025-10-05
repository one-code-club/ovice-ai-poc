import { BrowserContext, Frame, Locator, Page } from 'playwright';
import { Credentials, UiSelectors } from '../config.js';

const CANCEL_APP_SELECTORS = [
  'button:has-text("キャンセル")',
  'button:has-text("Cancel")',
  'role=button[name="キャンセル"]',
  'role=button[name="Cancel"]',
  'text="キャンセル"',
  'text="Cancel"'
];

const CONTINUE_BROWSER_SELECTORS = [
  'a:has-text("ブラウザでの利用を継続")',
  'a:has-text("Continue in Browser")',
  'a:has-text("Continue with Browser")',
  'button:has-text("ブラウザでの利用を継続")',
  'button:has-text("Continue in Browser")',
  'button:has-text("Continue with Browser")',
  'text="Continue in Browser"',
  'text="Continue with Browser"'
];

const LOGIN_BUTTON_SELECTORS = [
  'button[type="submit"]',
  'button:has-text("ログイン")',
  'button:has-text("Log in")',
  'button:has-text("Sign in")',
  'button:has-text("メールアドレスでログイン")'
];

const LOGIN_BUTTON_TEXTS = [
  'Login with your email',
  'メールアドレスでログイン',
  'ログイン',
  'Log in',
  'Sign in'
];

const EMAIL_FIELD_SELECTORS = [
  'input[type="email"]',
  'input[name="email"]',
  'input[id="email"]',
  'input[autocomplete="username"]',
  'input[placeholder*="メール"]',
  'input[placeholder*="email"]',
  'input[aria-label*="メール"]',
  'input[aria-label*="Email"]'
];

const PASSWORD_FIELD_SELECTORS = [
  'input[type="password"]',
  'input[name="password"]',
  'input[id="password"]',
  'input[autocomplete="current-password"]',
  'input[placeholder*="パスワード"]',
  'input[placeholder*="password"]',
  'input[aria-label*="パスワード"]',
  'input[aria-label*="Password"]'
];

async function clickFirstVisible(page: Page, selectors: string[], timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      if ((await locator.count()) === 0) {
        continue;
      }
      const isVisible = await locator.isVisible().catch(() => false);
      if (!isVisible) {
        continue;
      }
      await locator.scrollIntoViewIfNeeded();
      await locator.click();
      return true;
    }
    await page.waitForTimeout(200);
  }

  return false;
}

async function waitForFirstVisible(page: Page, selectors: string[], timeoutMs: number): Promise<Locator | null> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      try {
        await locator.waitFor({ state: 'visible', timeout: 200 });
        return locator;
      } catch {
        continue;
      }
    }
  }

  return null;
}

async function locateElement(
  frame: Frame,
  selectors: string[],
  accessibleNamePattern: RegExp,
  role: Parameters<Frame['getByRole']>[0]
): Promise<Locator> {
  for (const selector of selectors) {
    const locator = frame.locator(selector).first();
    if ((await locator.count()) > 0) {
      return locator;
    }
  }

  const roleLocator = frame.getByRole(role, { name: accessibleNamePattern }).first();
  if ((await roleLocator.count()) > 0) {
    return roleLocator;
  }

  for (const child of frame.childFrames()) {
    try {
      return await locateElement(child, selectors, accessibleNamePattern, role);
    } catch {
      continue;
    }
  }

  throw new Error(`要素 (${accessibleNamePattern}) が見つかりませんでした。`);
}

async function findLoginFrame(page: Page, timeoutMs: number): Promise<Frame> {
  const deadline = Date.now() + timeoutMs;
  const selector = EMAIL_FIELD_SELECTORS.join(', ');

  while (Date.now() < deadline) {
    const frames = page.frames();
    for (const frame of frames) {
      try {
        const locator = frame.locator(selector).first();
        const count = await locator.count();
        if (count > 0) {
          return frame;
        }
      } catch {
        continue;
      }
    }
    await page.waitForTimeout(200);
  }

  throw new Error('ログインフォームが見つかりませんでした。');
}

async function fillLoginForm(page: Page, credentials: Credentials): Promise<void> {
  console.log('  - ログインフォームを検索中...');
  const frame = await findLoginFrame(page, 20000);
  console.log('  ✓ ログインフォームが見つかりました。');

  console.log('  - メール入力欄を検索中...');
  const emailInput = await locateElement(frame, EMAIL_FIELD_SELECTORS, /メールアドレス|email/i, 'textbox');
  console.log('  - パスワード入力欄を検索中...');
  const passwordInput = await locateElement(frame, PASSWORD_FIELD_SELECTORS, /パスワード|password/i, 'textbox');

  console.log(`  - メールアドレスを入力中: ${credentials.email}`);
  await emailInput.waitFor({ state: 'visible', timeout: 15000 });
  await emailInput.fill(credentials.email, { timeout: 5000 });
  
  // 入力値を確認
  const emailValue = await emailInput.inputValue();
  console.log(`  ✓ メールアドレスを入力しました。確認: ${emailValue}`);
  
  if (emailValue !== credentials.email) {
    console.warn(`  ⚠ 入力値が一致しません。再入力します...`);
    await emailInput.clear();
    await emailInput.type(credentials.email, { delay: 50 });
    const emailValueRetry = await emailInput.inputValue();
    console.log(`  再入力後の値: ${emailValueRetry}`);
  }

  console.log('  - パスワードを入力中...');
  await passwordInput.waitFor({ state: 'visible', timeout: 15000 });
  await passwordInput.fill(credentials.password, { timeout: 5000 });
  
  // パスワード長を確認（値は表示しない）
  const passwordValue = await passwordInput.inputValue();
  console.log(`  ✓ パスワードを入力しました。文字数: ${passwordValue.length}`);
  
  if (passwordValue.length === 0) {
    console.warn(`  ⚠ パスワードが空です。再入力します...`);
    await passwordInput.clear();
    await passwordInput.type(credentials.password, { delay: 50 });
    const passwordValueRetry = await passwordInput.inputValue();
    console.log(`  再入力後の文字数: ${passwordValueRetry.length}`);
  }
  
  // フォーカスを外してバリデーションをトリガー
  await page.keyboard.press('Tab');
  await page.waitForTimeout(500);

  let loginButton: Locator | null = null;
  console.log('  - ログインボタンを検索中...');
  
  // まず、テキストで検索（タブボタンを除外）
  for (const text of LOGIN_BUTTON_TEXTS) {
    const locator = frame.getByRole('button', { name: text, exact: false });
    const count = await locator.count();
    
    if (count > 0) {
      // タブボタンではないことを確認
      for (let i = 0; i < count; i++) {
        const btn = locator.nth(i);
        const isTab = await btn.evaluate((el) => {
          const classList = Array.from(el.classList);
          return classList.some(cls => cls.includes('Tab') || cls.includes('tab'));
        });
        
        if (!isTab) {
          loginButton = btn;
          console.log(`  ✓ ログインボタンが見つかりました: "${text}"`);
          break;
        } else {
          console.log(`  - "${text}" ボタンはタブなのでスキップしました。`);
        }
      }
      
      if (loginButton) break;
    }
  }

  // セレクターで検索（タブを除外）
  if (!loginButton) {
    for (const selector of LOGIN_BUTTON_SELECTORS) {
      const locator = frame.locator(selector);
      const count = await locator.count();
      
      if (count > 0) {
        for (let i = 0; i < count; i++) {
          const btn = locator.nth(i);
          const isTab = await btn.evaluate((el) => {
            const classList = Array.from(el.classList);
            return classList.some(cls => cls.includes('Tab') || cls.includes('tab'));
          });
          
          if (!isTab) {
            loginButton = btn;
            console.log(`  ✓ ログインボタンが見つかりました（セレクター経由）`);
            break;
          }
        }
        
        if (loginButton) break;
      }
    }
  }

  if (loginButton) {
    // ログインボタンの状態を確認
    const buttonState = await loginButton.evaluate((btn: HTMLButtonElement) => {
      return {
        disabled: btn.disabled,
        type: btn.type,
        classList: Array.from(btn.classList),
        textContent: btn.textContent?.trim(),
        ariaDisabled: btn.getAttribute('aria-disabled')
      };
    });
    
    console.log('  - ログインボタンの状態:');
    console.log(`    - disabled: ${buttonState.disabled}`);
    console.log(`    - type: ${buttonState.type}`);
    console.log(`    - aria-disabled: ${buttonState.ariaDisabled}`);
    console.log(`    - テキスト: ${buttonState.textContent}`);
    
    if (buttonState.disabled || buttonState.ariaDisabled === 'true') {
      console.warn('  ⚠ ログインボタンがdisabledになっています！');
      console.log('  - 5秒待機してから再確認します...');
      await page.waitForTimeout(5000);
      
      const buttonStateRetry = await loginButton.evaluate((btn: HTMLButtonElement) => {
        return { disabled: btn.disabled, ariaDisabled: btn.getAttribute('aria-disabled') };
      });
      console.log(`  - 再確認: disabled=${buttonStateRetry.disabled}, aria-disabled=${buttonStateRetry.ariaDisabled}`);
    }
    
    console.log('  - ログインボタンをクリック中...');
    await loginButton.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    
    const urlBefore = page.url();
    
    // force: true オプションでクリックを強制
    await loginButton.click({ timeout: 5000, force: true });
    console.log('  ✓ ログインボタンをクリックしました。ページ遷移を待機中...');
    
    // ナビゲーションを待つ（タイムアウトしても続行）
    const navigationResult = await page.waitForNavigation({ 
      waitUntil: 'networkidle', 
      timeout: 30000 
    }).catch((err) => {
      console.warn(`  ⚠ ナビゲーション待機がタイムアウトしました: ${err.message}`);
      return null;
    });
    
    const urlAfter = page.url();
    if (urlBefore === urlAfter) {
      console.warn('  ⚠ URLが変わっていません。ログインに失敗した可能性があります。');
      
      // エラーメッセージを探す
      const errorMessages = await page.evaluate(() => {
        const errors: Array<{ selector: string; text: string }> = [];
        // よくあるエラー要素を探す
        const errorSelectors = [
          '[role="alert"]',
          '.error',
          '.error-message',
          '[class*="error"]',
          '[class*="Error"]',
          '[aria-live="polite"]',
          '[aria-live="assertive"]'
        ];
        
        errorSelectors.forEach(selector => {
          const elements = document.querySelectorAll(selector);
          elements.forEach(el => {
            const text = el.textContent?.trim();
            if (text && text.length > 0) {
              errors.push({ selector, text: text.substring(0, 200) });
            }
          });
        });
        
        return errors;
      });
      
      if (errorMessages.length > 0) {
        console.error('  ❌ エラーメッセージが見つかりました:');
        errorMessages.forEach(err => {
          console.error(`    - [${err.selector}] ${err.text}`);
        });
      } else {
        console.log('  - エラーメッセージは見つかりませんでした。');
      }
    } else {
      console.log(`  ✓ ページが遷移しました: ${urlBefore} → ${urlAfter}`);
    }
  } else {
    console.log('  - ログインボタンが見つかりません。Enterキーを押します。');
    await passwordInput.press('Enter');
    await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  }

  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2000); // 追加の待機時間
  console.log('  ✓ ページのロードが完了しました。');
}

async function ensureToggleOn(page: Page, selectors: string[], label: string, optional: boolean = false): Promise<boolean> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) === 0) {
      continue;
    }

    try {
      await locator.waitFor({ state: 'visible', timeout: 5000 });
    } catch {
      continue;
    }

    const pressedBefore = await locator.getAttribute('aria-pressed');
    const colorBefore = await locator.evaluate((el) => {
      return window.getComputedStyle(el).color;
    });
    
    console.log(`${label}ボタンの状態: aria-pressed="${pressedBefore}", color="${colorBefore}"`);

    // aria-pressedがtrueの場合、またはcolorがエラー色（赤系）でない場合は既にON
    if (pressedBefore === 'true') {
      console.log(`${label}は既にONです。`);
      return true;
    }

    console.log(`${label}をクリックしてONにします...`);
    await locator.click();
    await page.waitForTimeout(400);

    const pressedAfter = await locator.getAttribute('aria-pressed');
    if (pressedAfter === 'true' || pressedBefore === null) {
      console.log(`${label}をONにしました。`);
      return true;
    }
  }

  if (optional) {
    console.warn(`⚠ ${label}のトグル操作をスキップしました（オプション）。`);
    return false;
  }

  throw new Error(`${label} のトグル操作に失敗しました。セレクタ設定を確認してください。`);
}

async function waitForSpaceUi(page: Page, selectors: UiSelectors): Promise<void> {
  console.log('マイク/スピーカーUIを待機中...');
  
  // デバッグ: スクリーンショットを撮る
  try {
    await page.screenshot({ path: 'artifacts/debug-before-ui-search.png', fullPage: false });
    console.log('デバッグ用スクリーンショットを保存しました: artifacts/debug-before-ui-search.png');
  } catch (err) {
    console.warn('スクリーンショットの保存に失敗しました:', err);
  }

  // デバッグ: ページ内のボタン要素を確認
  const buttons = await page.evaluate(() => {
    const allButtons = Array.from(document.querySelectorAll('button'));
    return allButtons.map(btn => ({
      text: btn.textContent?.trim().substring(0, 50),
      ariaLabel: btn.getAttribute('aria-label'),
      title: btn.getAttribute('title'),
      class: btn.className,
      id: btn.id
    }));
  });
  console.log(`ページ内のボタン要素（全${buttons.length}個）:`, JSON.stringify(buttons, null, 2));

  const micLocator = await waitForFirstVisible(page, selectors.mic, 20000);
  if (!micLocator) {
    console.error('試したマイクセレクター:', selectors.mic);
    throw new Error('マイクの制御UIが表示されませんでした。上記のボタン要素リストを確認してください。');
  }
  console.log('マイクUIが見つかりました。');

  const speakerLocator = await waitForFirstVisible(page, selectors.speaker, 5000);
  if (!speakerLocator) {
    console.warn('⚠ スピーカーの制御UIが見つかりませんでした。oViceではスピーカーボタンが存在しない可能性があります。');
    console.warn('試したスピーカーセレクター:', selectors.speaker);
    console.warn('スピーカー設定をスキップして続行します。');
  } else {
    console.log('スピーカーUIが見つかりました。');
  }
}

async function handleNativeAppPrompt(page: Page): Promise<void> {
  console.log('ネイティブアプリダイアログの確認中...');
  
  // ダイアログの存在を確認
  const dialogInfo = await page.evaluate(() => {
    const dialogs = document.querySelectorAll('[role="dialog"]');
    const cancelButtons = Array.from(document.querySelectorAll('button')).filter(btn => 
      btn.textContent?.includes('キャンセル') || btn.textContent?.includes('Cancel')
    );
    
    return {
      dialogCount: dialogs.length,
      cancelButtonCount: cancelButtons.length,
      cancelButtonTexts: cancelButtons.map(btn => btn.textContent?.trim()),
      allButtonTexts: Array.from(document.querySelectorAll('button')).map(btn => btn.textContent?.trim()).slice(0, 20)
    };
  });
  
  console.log(`  ダイアログ数: ${dialogInfo.dialogCount}`);
  console.log(`  キャンセルボタン数: ${dialogInfo.cancelButtonCount}`);
  if (dialogInfo.cancelButtonTexts.length > 0) {
    console.log(`  キャンセルボタンのテキスト:`, dialogInfo.cancelButtonTexts);
  }
  console.log(`  ページ内の全ボタン（最大20個）:`, dialogInfo.allButtonTexts);
  
  // まず、ダイアログが実際に表示されるか確認
  const cancelByRole = page.getByRole('button', { name: /キャンセル|Cancel/i });
  
  // ダイアログが表示されるまで少し待つ（最大8秒）
  let dialogVisible = false;
  try {
    await cancelByRole.waitFor({ state: 'visible', timeout: 8000 });
    dialogVisible = true;
    console.log('✓ ネイティブアプリダイアログが表示されました。');
  } catch {
    // セレクターでも確認
    const altDialog = await clickFirstVisible(page, CANCEL_APP_SELECTORS, 2000);
    if (altDialog) {
      console.log('✓ セレクター経由でキャンセルボタンを見つけてクリックしました。');
      await page.waitForTimeout(1000);
      return;
    }
    
    console.log('ℹ ネイティブアプリダイアログは表示されませんでした（またはすでに閉じています）。');
    return;
  }

  if (!dialogVisible) {
    return;
  }

  // スクリーンショットを撮ってダイアログの状態を確認
  await page.screenshot({ path: 'artifacts/dialog-visible.png', fullPage: true }).catch(() => {});
  console.log('ダイアログのスクリーンショット保存: artifacts/dialog-visible.png');

  // 方法1: Enterキーを押す（キャンセルボタンにフォーカスが当たっている想定）
  try {
    console.log('方法1: Enterキーでダイアログを閉じます...');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1500);
    
    // ダイアログが閉じたか確認
    const stillVisible = await cancelByRole.isVisible().catch(() => false);
    if (!stillVisible) {
      console.log('✓ Enterキーでダイアログを閉じました。');
      await page.screenshot({ path: 'artifacts/dialog-closed-by-enter.png', fullPage: true }).catch(() => {});
      return;
    } else {
      console.log('❌ Enterキーではダイアログが閉じませんでした。別の方法を試します。');
    }
  } catch (err) {
    console.warn('Enterキーでの処理に失敗しました:', err);
  }

  // 方法2: Escapeキーを試す
  try {
    console.log('方法2: Escapeキーでダイアログを閉じます...');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
    
    const stillVisible = await cancelByRole.isVisible().catch(() => false);
    if (!stillVisible) {
      console.log('✓ Escapeキーでダイアログを閉じました。');
      await page.screenshot({ path: 'artifacts/dialog-closed-by-escape.png', fullPage: true }).catch(() => {});
      return;
    } else {
      console.log('❌ Escapeキーではダイアログが閉じませんでした。');
    }
  } catch (err) {
    console.warn('Escapeキーでの処理に失敗しました:', err);
  }

  // 方法3: キャンセルボタンをクリック
  try {
    console.log('方法3: キャンセルボタンをクリックします...');
    await cancelByRole.click({ timeout: 3000, force: true });
    await page.waitForTimeout(1000);
    
    const stillVisible = await cancelByRole.isVisible().catch(() => false);
    if (!stillVisible) {
      console.log('✓ キャンセルボタンをクリックしてダイアログを閉じました。');
      await page.screenshot({ path: 'artifacts/dialog-closed-by-click.png', fullPage: true }).catch(() => {});
      return;
    }
  } catch (err) {
    console.warn('キャンセルボタンのクリックに失敗しました:', err);
  }

  // 方法4: セレクターリストから探してクリック
  console.log('方法4: セレクターリストから探してクリックします...');
  const clicked = await clickFirstVisible(page, CANCEL_APP_SELECTORS, 3000);
  if (clicked) {
    await page.waitForTimeout(1000);
    const stillVisible = await cancelByRole.isVisible().catch(() => false);
    if (!stillVisible) {
      console.log('✓ セレクター経由でダイアログを閉じました。');
      return;
    }
  }
  
  console.warn('⚠ ネイティブアプリダイアログを閉じることができませんでした。');
  await page.screenshot({ path: 'artifacts/dialog-failed-to-close.png', fullPage: true }).catch(() => {});
}

async function continueInBrowser(context: BrowserContext, page: Page): Promise<Page> {
  await page.waitForTimeout(1000);

  let found: Locator | null = null;

  const getByTextLocator = page.getByText('Continue in Browser', { exact: false });
  if ((await getByTextLocator.count()) > 0) {
    found = getByTextLocator.first();
    console.log('  ✓ "Continue in Browser" ボタンが見つかりました（テキスト検索）');
  }

  if (!found) {
    found = await waitForFirstVisible(page, CONTINUE_BROWSER_SELECTORS, 8000);
    if (found) {
      console.log('  ✓ "Continue in Browser" ボタンが見つかりました（セレクター検索）');
    }
  }

  if (!found) {
    console.log('  - "Continue in Browser" ボタンは見つかりませんでした。スキップします。');
    return page;
  }

  try {
    await found.scrollIntoViewIfNeeded({ timeout: 2000 });
  } catch {
    // ignore
  }

  console.log('  - "Continue in Browser" ボタンをクリック中...');
  const [maybeNewPage] = await Promise.all([
    context.waitForEvent('page', { timeout: 3000 }).catch(() => null),
    found.click({ timeout: 5000 }).catch(() => {})
  ]);

  if (maybeNewPage) {
    console.log('  ✓ 新しいページが開きました。');
    await maybeNewPage.waitForLoadState('domcontentloaded');
    await page.close({ runBeforeUnload: true }).catch(() => {});
    return maybeNewPage;
  }

  console.log('  ✓ 同じページで継続します。');
  await page.waitForLoadState('domcontentloaded');
  return page;
}


async function logPageState(page: Page, stepName: string): Promise<void> {
  const url = page.url();
  const title = await page.title();
  
  // ページ内の主要な要素を確認
  const pageInfo = await page.evaluate(() => {
    const dialogs = document.querySelectorAll('[role="dialog"]');
    const buttons = document.querySelectorAll('button');
    const inputs = document.querySelectorAll('input');
    const links = document.querySelectorAll('a');
    
    return {
      dialogCount: dialogs.length,
      buttonCount: buttons.length,
      inputCount: inputs.length,
      linkCount: links.length,
      hasLoginForm: !!document.querySelector('input[type="email"], input[type="password"]'),
      bodyText: document.body.innerText.substring(0, 200)
    };
  });

  console.log(`\n=== ${stepName} ===`);
  console.log(`  URL: ${url}`);
  console.log(`  タイトル: ${title}`);
  console.log(`  ダイアログ数: ${pageInfo.dialogCount}`);
  console.log(`  ボタン数: ${pageInfo.buttonCount}`);
  console.log(`  入力フィールド数: ${pageInfo.inputCount}`);
  console.log(`  リンク数: ${pageInfo.linkCount}`);
  console.log(`  ログインフォーム存在: ${pageInfo.hasLoginForm ? 'あり' : 'なし'}`);
  console.log(`  本文抜粋: ${pageInfo.bodyText.replace(/\n/g, ' ')}`);
  console.log('=================\n');
}

export async function loginAndPrepare(
  context: BrowserContext,
  initialPage: Page,
  baseUrl: string,
  credentials: Credentials,
  selectors: UiSelectors
): Promise<Page> {
  let page = initialPage;

  // ブラウザコンソールのログを最初から取得（init scriptのログを見逃さないため）
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[oVice]')) {
      console.log('  📱', text);
    } else if (text.includes('getUserMedia') || text.includes('AudioContext') || text.includes('Gemini')) {
      console.log('  🔍', text);
    }
  });

  // ブラウザレベルのダイアログをハンドリング
  page.on('dialog', async (dialog) => {
    console.log(`🔔 ブラウザダイアログ検出: タイプ="${dialog.type()}", メッセージ="${dialog.message()}"`);
    await dialog.dismiss(); // キャンセル/閉じる
    console.log('  ✓ ブラウザダイアログを閉じました。');
  });

  console.log(`📍 ステップ1: ${baseUrl} に移動中...`);
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000); // ダイアログが表示される時間を待つ
  await page.screenshot({ path: 'artifacts/step1-after-goto.png', fullPage: true }).catch(() => {});
  await logPageState(page, 'ステップ1: ページ移動後');

  console.log('📍 ステップ2: ネイティブアプリダイアログの処理...');
  await handleNativeAppPrompt(page);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'artifacts/step2-after-dialog.png', fullPage: true }).catch(() => {});
  await logPageState(page, 'ステップ2: ダイアログ処理後');

  console.log('📍 ステップ3: "Continue in Browser" ボタンの確認...');
  page = await continueInBrowser(context, page);
  await page.screenshot({ path: 'artifacts/step3-after-continue.png', fullPage: true }).catch(() => {});
  await logPageState(page, 'ステップ3: Continue in Browser後');

  console.log('📍 ステップ4: ログインフォームへの入力を開始...');
  try {
    await fillLoginForm(page, credentials);
    console.log('✓ ログインフォームの入力が完了しました。');
  } catch (err) {
    console.error('❌ ログインフォームの入力に失敗しました:', err);
    await page.screenshot({ path: 'artifacts/error-login-form.png', fullPage: true }).catch(() => {});
    await logPageState(page, 'エラー: ログインフォーム');
    throw err;
  }

  await page.waitForLoadState('networkidle', { timeout: 20000 });
  await page.screenshot({ path: 'artifacts/step4-after-login.png', fullPage: true }).catch(() => {});
  await logPageState(page, 'ステップ4: ログイン後');

  console.log('📍 ステップ5: ログイン後の "Continue in Browser" ボタンの確認...');
  page = await continueInBrowser(context, page);
  await logPageState(page, 'ステップ5: 2回目のContinue in Browser後');

  await page.waitForLoadState('networkidle', { timeout: 20000 });

  // oViceのスペースUIが完全にロードされるまで少し待つ
  console.log('📍 ステップ6: oViceスペースのロードを待機中...');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'artifacts/step6-before-ui-search.png', fullPage: true }).catch(() => {});
  await logPageState(page, 'ステップ6: スペースUI検索前');

  await waitForSpaceUi(page, selectors);
  await ensureToggleOn(page, selectors.mic, 'マイク', false);
  // スピーカーはオンにしない（音声が再生されないようにするため）
  console.log('ℹ スピーカーは意図的にオフのままにしています（音声再生を防ぐため）');

  console.log('マイクをONにしました。');

  // デバッグ: 現在のストリームを確認
  const beforeReplacement = await page.evaluate(() => {
    const w = window as any;
    const getUserMediaStr = navigator.mediaDevices.getUserMedia.toString();
    return {
      hasGeminiContext: !!w.__geminiAudioContext,
      hasGeminiStream: !!w.__geminiMicStream,
      queueLength: w.__geminiAudioQueue?.length || 0,
      getUserMediaOverridden: getUserMediaStr.includes('getUserMedia呼び出し検出'),
      getUserMediaPreview: getUserMediaStr.substring(0, 200)
    };
  });
  console.log('🔍 ストリーム状態（マイクON直後）:', JSON.stringify(beforeReplacement, null, 2));

  // さらに待機
  await page.waitForTimeout(3000);

  // デバッグ: getUserMediaが呼ばれたか、ストリームが使われているかを確認
  const afterMicOn = await page.evaluate(() => {
    const w = window as any;
    const stream = w.__geminiMicStream;
    
    // RTCPeerConnectionを探す
    const peerConnections: any[] = [];
    Object.keys(w).forEach((key) => {
      try {
        const obj = w[key];
        if (obj && obj.constructor && obj.constructor.name === 'RTCPeerConnection') {
          const senders = obj.getSenders();
          const audioSenders = senders.filter((s: any) => s.track?.kind === 'audio');
          peerConnections.push({
            key,
            senderCount: senders.length,
            audioSenderCount: audioSenders.length,
            audioTracks: audioSenders.map((s: any) => ({
              id: s.track.id,
              label: s.track.label,
              enabled: s.track.enabled
            }))
          });
        }
      } catch (e) {
        // ignore
      }
    });
    
    return {
      hasGeminiContext: !!w.__geminiAudioContext,
      contextState: w.__geminiAudioContext?.state,
      hasGeminiStream: !!stream,
      queueLength: w.__geminiAudioQueue?.length || 0,
      streamTracks: stream ? stream.getAudioTracks().map((t: MediaStreamTrack) => ({
        id: t.id,
        label: t.label,
        enabled: t.enabled,
        readyState: t.readyState
      })) : [],
      peerConnections,
      getUserMediaCalled: !!w.__getUserMediaCalled
    };
  });
  console.log('🔍 マイクON後の詳細状態:', JSON.stringify(afterMicOn, null, 2));

  console.log('✓ oViceスペースの準備が完了しました。');
  
  return page;
}

