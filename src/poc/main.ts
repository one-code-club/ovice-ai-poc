import { loadConfig } from '../config.js';
import { createBrowserSession } from '../browser/session.js';
import { loginAndPrepare } from '../ovice/login.js';
import { AudioBridge } from '../gemini/audioBridge.js';
import { createRealtimeClient } from '../realtime/clientFactory.js';
import { moveToInitialPosition } from '../ovice/avatarControl.js';

async function main(): Promise<void> {
  const config = loadConfig();
  
  console.log('🤖 リアルタイム音声クライアントを初期化中...');
  const realtimeClient = createRealtimeClient(config.realtime);

  await realtimeClient.connect();

  // BrowserContextを作成（init scriptを注入）
  console.log(`🎙️ ${realtimeClient.getProviderLabel()}音声ストリーム用のinit scriptを準備中...`);
  const initScriptContent = AudioBridge.getInitScript(realtimeClient.getPreferredSampleRate());
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
    audioBridge = new AudioBridge(page, realtimeClient, {
      audioSelector: config.audio.audioSelector
    });
    await audioBridge.setupBeforeLogin();

    console.log(`✓ ${realtimeClient.getProviderLabel()}音声ストリームの準備が完了しました。`);

    // oViceにログイン（この時点でマイクがONになり、Geminiストリームが接続される）
    page = await loginAndPrepare(session.context, page, config.baseUrl, config.credentials, config.selectors);

    console.log('✓ oViceスペースに入りました。');
    
    // デバッグ: 設定値を確認
    console.log('\n🔍 === 初期位置設定の確認 ===');
    console.log('config.initialLocation:', config.initialLocation);
    console.log('環境変数 INITIAL_LOCATION_X:', process.env.INITIAL_LOCATION_X);
    console.log('環境変数 INITIAL_LOCATION_Y:', process.env.INITIAL_LOCATION_Y);
    console.log('=========================\n');
    
    // 初期位置が設定されている場合、アバターを移動
    if (config.initialLocation) {
      console.log(`📍 アバターを初期位置に移動します: (${config.initialLocation.x}, ${config.initialLocation.y})`);
      await moveToInitialPosition(page, config.initialLocation.x, config.initialLocation.y);
    } else {
      console.log('⚠ 初期位置が設定されていないため、アバターの移動をスキップします。');
      console.log('  ヒント: .envファイルにINITIAL_LOCATION_XとINITIAL_LOCATION_Yを設定してください。');
    }
    
    // デバッグ: マイク設定の状態を確認
    console.log('\n🔍 === マイク設定の診断 ===');
    const micDiagnostics = await page.evaluate((providerLabel: string) => {
      const w = window as any;
      const context = w.__realtimeAudioContext ?? w.__geminiAudioContext;
      const stream = w.__realtimeMicStream ?? w.__geminiMicStream;
      const queue = w.__realtimeAudioQueue ?? w.__geminiAudioQueue;
      const buffer = w.__realtimeAudioBuffer ?? w.__geminiAudioBuffer;

      // AudioContext状態
      const audioContextState = context?.state;
      const audioContextSampleRate = context?.sampleRate;
      
      // ストリーム状態
      const hasStream = !!stream;
      const streamTracks = stream?.getAudioTracks?.() || [];
      const trackStates = streamTracks.map((track: MediaStreamTrack) => ({
        id: track.id,
        label: track.label,
        enabled: track.enabled,
        readyState: track.readyState,
        muted: track.muted
      }));
      
      // キューとバッファの状態
      const queueLength = queue?.length || 0;
      const bufferLength = buffer?.length || 0;
      
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
        micButtonAriaPressed,
        providerLabel
      };
    }, realtimeClient.getProviderLabel());
    
    console.log('AudioContext状態:', micDiagnostics.audioContextState);
    console.log('AudioContext サンプルレート:', micDiagnostics.audioContextSampleRate);
    console.log(`${micDiagnostics.providerLabel}ストリーム存在:`, micDiagnostics.hasStream);
    console.log('ストリームトラック:', JSON.stringify(micDiagnostics.trackStates, null, 2));
    console.log('音声キューの長さ:', micDiagnostics.queueLength);
    console.log('音声バッファの長さ:', micDiagnostics.bufferLength, 'サンプル');
    console.log('マイクボタン色:', micDiagnostics.micButtonColor);
    console.log('マイクボタン aria-pressed:', micDiagnostics.micButtonAriaPressed);
    console.log('=========================\n');
    
    // 5秒後に再度確認
    setTimeout(async () => {
      console.log('\n🔍 === 5秒後のマイク設定の診断 ===');
      const laterDiagnostics = await page.evaluate((providerLabel: string) => {
        const w = window as any;
        const context = w.__realtimeAudioContext ?? w.__geminiAudioContext;
        const queue = w.__realtimeAudioQueue ?? w.__geminiAudioQueue;
        const buffer = w.__realtimeAudioBuffer ?? w.__geminiAudioBuffer;
        return {
          queueLength: queue?.length || 0,
          bufferLength: buffer?.length || 0,
          audioContextState: context?.state,
          processorNode: !!context?.destination,
          providerLabel
        };
      }, realtimeClient.getProviderLabel());
      console.log('音声キューの長さ:', laterDiagnostics.queueLength);
      console.log('音声バッファの長さ:', laterDiagnostics.bufferLength, 'サンプル');
      console.log('AudioContext状態:', laterDiagnostics.audioContextState);
      console.log('=========================\n');
    }, 5000);
    
    // 音声ブリッジの後処理を開始
    await audioBridge.completeSetup();

    console.log(`✓ ${realtimeClient.getProviderLabel()}との音声ブリッジが確立されました。`);
    
    // oViceスペースに入った後でGeminiとの会話を開始
    console.log(`💬 ${realtimeClient.getProviderLabel()}に話しかけています...`);
    realtimeClient.startConversation();
    
    console.log(`🎉 準備完了！${realtimeClient.getProviderLabel()}との会話が開始されました。終了するには Ctrl+C を押してください。`);
    
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
    realtimeClient.close();
    await session.browser.close();
    console.log(`ブラウザと${realtimeClient.getProviderLabel()}接続を閉じました。`);
  }
}

main().catch((error) => {
  console.error('PoC 実行中にエラーが発生しました:', error);
  process.exit(1);
});