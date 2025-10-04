import { loadConfig } from '../config.js';
import { createBrowserSession } from '../browser/session.js';
import { loginAndPrepare } from '../ovice/login.js';
import { startAudioCapture, AudioCaptureController } from '../ovice/audioCapture.js';

async function waitForDurationOrSignal(durationMs: number): Promise<void> {
  if (durationMs > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, durationMs));
    return;
  }

  await new Promise<void>((resolve) => {
    const handle = () => resolve();
    process.once('SIGINT', handle);
    process.once('SIGTERM', handle);
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const session = await createBrowserSession(config.browser);
  let page = await session.context.newPage();
  let capture: AudioCaptureController | null = null;

  try {
    page = await loginAndPrepare(session.context, page, config.baseUrl, config.credentials, config.selectors);

    capture = await startAudioCapture(page, config.audio);
    console.log(`音声を ${config.audio.outputFile} に保存しています。Ctrl+C で終了します。`);

    await waitForDurationOrSignal(config.audio.durationMs);

    await capture.stop();
    capture = null;
  } finally {
    if (capture) {
      await capture.stop().catch(() => {});
    }
    await session.browser.close();
  }
}

main().catch((error) => {
  console.error('PoC 実行中にエラーが発生しました:', error);
  process.exit(1);
});

