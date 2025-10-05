import { loadConfig } from '../config.js';
import { createBrowserSession } from '../browser/session.js';
import { loginAndPrepare } from '../ovice/login.js';
import { GeminiLiveClient } from '../gemini/client.js';
import { AudioBridge } from '../gemini/audioBridge.js';
import { SYSTEM_INSTRUCTIONS } from '../gemini/systemInstructions.js';

async function main(): Promise<void> {
  const config = loadConfig();
  
  // Gemini Live APIクライアントを初期化（BrowserContext作成前）
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('環境変数 GEMINI_API_KEY が設定されていません。');
  }

  console.log('🤖 Gemini Live APIクライアントを初期化中...');
  const geminiClient = new GeminiLiveClient({
    apiKey,
    modelName: process.env.GEMINI_MODEL_NAME,
    systemInstructions: SYSTEM_INSTRUCTIONS,
    voiceName: process.env.GEMINI_VOICE_NAME,
    temperature: process.env.GEMINI_TEMPERATURE ? parseFloat(process.env.GEMINI_TEMPERATURE) : undefined,
    topP: process.env.GEMINI_TOP_P ? parseFloat(process.env.GEMINI_TOP_P) : undefined
  });

  // Gemini Live APIに接続
  await geminiClient.connect();

  // BrowserContextを作成（init scriptを注入）
  console.log('🎙️ Gemini音声ストリーム用のinit scriptを準備中...');
  const initScriptContent = AudioBridge.getInitScript(24000);
  console.log(`📝 Init scriptの長さ: ${initScriptContent.length}文字`);
  console.log(`📝 Init script先頭200文字: ${initScriptContent.substring(0, 200)}...`);
  const session = await createBrowserSession(config.browser, initScriptContent);
  
  let page = await session.context.newPage();
  
  // ブラウザのコンソールログをNode側で表示
  page.on('console', (msg) => {
    const type = msg.type();
    const text = msg.text();
    
    // [oVice]または[Gemini]のログのみ表示
    if (text.includes('[oVice]') || text.includes('[Gemini]') || text.includes('[Audio')) {
      if (type === 'error') {
        console.error(`[Browser Error] ${text}`);
      } else if (type === 'warning') {
        console.warn(`[Browser] ${text}`);
      } else {
        console.log(`[Browser] ${text}`);
      }
    }
  });
  
  // ブラウザのエラーを全て表示
  page.on('pageerror', (error) => {
    console.error(`[Browser Page Error] ${error.message}`);
    console.error(error.stack);
  });
  
  let audioBridge: AudioBridge | null = null;

  try {
    // 音声ブリッジを初期化（音声ハンドラーを設定）
    audioBridge = new AudioBridge(page, geminiClient, {
      audioSelector: config.audio.audioSelector
    });
    await audioBridge.setupBeforeLogin();

    console.log('✓ Gemini音声ストリームの準備が完了しました。');

    // oViceにログイン（この時点でマイクがONになり、Geminiストリームが接続される）
    page = await loginAndPrepare(session.context, page, config.baseUrl, config.credentials, config.selectors);

    console.log('✓ oViceスペースに入りました。');
    
    // デバッグ: マイク設定の状態を確認
    console.log('\n🔍 === マイク設定の診断 ===');
    const micDiagnostics = await page.evaluate(() => {
      const w = window as any;
      
      // AudioContext状態
      const audioContextState = w.__geminiAudioContext?.state;
      const audioContextSampleRate = w.__geminiAudioContext?.sampleRate;
      
      // ストリーム状態
      const hasStream = !!w.__geminiMicStream;
      const streamTracks = w.__geminiMicStream?.getAudioTracks?.() || [];
      const trackStates = streamTracks.map((track: MediaStreamTrack) => ({
        id: track.id,
        label: track.label,
        enabled: track.enabled,
        readyState: track.readyState,
        muted: track.muted
      }));
      
      // キューとバッファの状態
      const queueLength = w.__geminiAudioQueue?.length || 0;
      const bufferLength = w.__geminiAudioBuffer?.length || 0;
      
      // マイクボタンの状態
      const micButton = document.querySelector('button[aria-label="microphone"]');
      const micButtonColor = micButton ? window.getComputedStyle(micButton).color : 'not found';
      const micButtonAriaPressed = micButton?.getAttribute('aria-pressed');
      
      return {
        audioContextState,
        audioContextSampleRate,
        hasStream,
        trackStates,
        queueLength,
        bufferLength,
        micButtonColor,
        micButtonAriaPressed
      };
    });
    
    console.log('AudioContext状態:', micDiagnostics.audioContextState);
    console.log('AudioContext サンプルレート:', micDiagnostics.audioContextSampleRate);
    console.log('Geminiストリーム存在:', micDiagnostics.hasStream);
    console.log('ストリームトラック:', JSON.stringify(micDiagnostics.trackStates, null, 2));
    console.log('音声キューの長さ:', micDiagnostics.queueLength);
    console.log('音声バッファの長さ:', micDiagnostics.bufferLength, 'サンプル');
    console.log('マイクボタン色:', micDiagnostics.micButtonColor);
    console.log('マイクボタン aria-pressed:', micDiagnostics.micButtonAriaPressed);
    console.log('=========================\n');
    
    // 5秒後に再度確認
    setTimeout(async () => {
      console.log('\n🔍 === 5秒後のマイク設定の診断 ===');
      const laterDiagnostics = await page.evaluate(() => {
        const w = window as any;
        return {
          queueLength: w.__geminiAudioQueue?.length || 0,
          bufferLength: w.__geminiAudioBuffer?.length || 0,
          audioContextState: w.__geminiAudioContext?.state,
          processorNode: !!w.__geminiAudioContext?.destination
        };
      });
      console.log('音声キューの長さ:', laterDiagnostics.queueLength);
      console.log('音声バッファの長さ:', laterDiagnostics.bufferLength, 'サンプル');
      console.log('AudioContext状態:', laterDiagnostics.audioContextState);
      console.log('=========================\n');
    }, 5000);
    
    // 音声ブリッジの後処理を開始
    await audioBridge.completeSetup();

    console.log('✓ Gemini Live APIとの音声ブリッジが確立されました。');
    
    // oViceスペースに入った後でGeminiとの会話を開始
    console.log('💬 Geminiに話しかけています...');
    geminiClient.startConversation();
    
    console.log('🎉 準備完了！Geminiとの会話が開始されました。終了するには Ctrl+C を押してください。');
    
    // oViceセッションが続く限りGeminiとの接続を維持
    await new Promise<void>((resolve) => {
      const handle = () => {
        console.log('終了シグナルを受信しました。接続を閉じます...');
        resolve();
      };
      process.once('SIGINT', handle);
      process.once('SIGTERM', handle);
    });
  } finally {
    // クリーンアップ
    if (audioBridge) {
      await audioBridge.stop();
    }
    if (geminiClient) {
      geminiClient.close();
    }
    await session.browser.close();
    console.log('ブラウザとGemini接続を閉じました。');
  }
}

main().catch((error) => {
  console.error('PoC 実行中にエラーが発生しました:', error);
  process.exit(1);
});