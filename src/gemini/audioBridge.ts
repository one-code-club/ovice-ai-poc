import { Page } from 'playwright';
import { GeminiLiveClient } from './client.js';

export interface AudioBridgeConfig {
  audioSelector: string; // oViceのスピーカー音声要素のセレクタ
  inputSampleRate?: number; // 入力サンプルレート（デフォルト: 16000Hz）
  outputSampleRate?: number; // 出力サンプルレート（デフォルト: 16000Hz）
}

/**
 * oViceとGemini Live API間の音声ブリッジ
 */
export class AudioBridge {
  private page: Page;
  private geminiClient: GeminiLiveClient;
  private config: Required<AudioBridgeConfig>;
  private isRunning = false;
  private audioDataQueue: string[] = []; // ページ準備前の音声データを一時保存

  constructor(page: Page, geminiClient: GeminiLiveClient, config: AudioBridgeConfig) {
    this.page = page;
    this.geminiClient = geminiClient;
    this.config = {
      audioSelector: config.audioSelector,
      inputSampleRate: config.inputSampleRate ?? 16000,
      outputSampleRate: config.outputSampleRate ?? 16000
    };
  }

  /**
   * Init scriptの内容を取得（BrowserContext作成時に使用）
   */
  static getInitScript(sampleRate: number = 16000): string {
    // 関数本体を文字列として返す（即時実行関数として）
    return `(() => {
      const sampleRate = ${sampleRate};
      console.log('[oVice] 🚀 Init script開始 (sampleRate: ' + sampleRate + 'Hz)');
      (function() {
      const w = window;
      console.log('[oVice] 🚀 Init script内部開始');
      
      // 初期化処理をDOMContentLoaded後に実行
      const initGeminiStream = () => {
        console.log('[oVice] 🎵 Geminiストリームを初期化中...');
        
        // AudioContextを作成
        const audioContext = new AudioContext({ sampleRate });
        w.__geminiAudioContext = audioContext;
        w.__geminiAudioQueue = [];
        
        // AudioContextを明示的にresumeする
        audioContext.resume().then(() => {
          console.log('[oVice] AudioContextがresumeされました:', audioContext.state);
        });
        
        console.log('[oVice] Gemini用AudioContextを作成:', audioContext.sampleRate, 'Hz');

        // Gemini音声を再生するための音声ストリーム生成
        const streamDestination = audioContext.createMediaStreamDestination();
        const outputStream = streamDestination.stream;

        // ScriptProcessorNodeで音声データを処理
        const bufferSize = 4096;
        const processor = audioContext.createScriptProcessor(bufferSize, 0, 1);
        
        processor.onaudioprocess = (e) => {
          const outputBuffer = e.outputBuffer;
          const outputData = outputBuffer.getChannelData(0);
          
          // キューから音声データを取り出す
          if (w.__geminiAudioQueue.length > 0) {
            const base64Audio = w.__geminiAudioQueue.shift();
            
            // Base64をArrayBufferに変換
            try {
              const binaryString = atob(base64Audio);
              const bytes = new Uint8Array(binaryString.length);
              for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
              }
              
              // PCM16データをFloat32に変換
              const int16Array = new Int16Array(bytes.buffer);
              for (let i = 0; i < outputData.length && i < int16Array.length; i++) {
                outputData[i] = int16Array[i] / 32768.0; // -1.0 ~ 1.0に正規化
              }
              
              console.log('[oVice] 🔊 Gemini音声を処理: ' + int16Array.length + 'サンプル, キュー残: ' + w.__geminiAudioQueue.length);
            } catch (error) {
              console.error('[oVice] Gemini音声のデコードに失敗:', error);
            }
          } else {
            // データがない場合は無音
            outputData.fill(0);
          }
        };

        processor.connect(streamDestination);
        // ローカルスピーカーには出力しない（相手にのみ聞こえるようにする）
        // processor.connect(audioContext.destination);
        
        // マイクストリームとして保存
        w.__geminiMicStream = outputStream;
        
        console.log('[oVice] ✓ Gemini音声再生ストリームを作成しました。トラック:', outputStream.getAudioTracks().map((t) => t.label));
      };

      // getUserMediaをオーバーライド（ページロード前に実行）
      const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      
      // オーバーライドが成功したことを確認
      console.log('[oVice] 🔧 getUserMediaオーバーライド開始');
      console.log('[oVice] 🔧 元のgetUserMedia:', typeof originalGetUserMedia);
      
      navigator.mediaDevices.getUserMedia = async function(constraints) {
        console.log('[oVice] 🎤 getUserMedia呼び出し検出!!!!!!!!!!!!!');
        console.log('[oVice] 🎤 制約:', JSON.stringify(constraints));
        w.__getUserMediaCalled = true;
        
        // 初回呼び出し時にストリームを初期化
        if (!w.__geminiMicStream) {
          console.log('[oVice] getUserMediaでGeminiストリームを初期化中...');
          initGeminiStream();
        }
        
        if (constraints?.audio && w.__geminiMicStream) {
          console.log('[oVice] 🎙️ ✅ マイク要求をGeminiストリームで応答します！');
          console.log('[oVice] 返すストリームのトラック:', w.__geminiMicStream.getAudioTracks().map((t) => ({ id: t.id, label: t.label, enabled: t.enabled })));
          // Geminiストリームを返す
          return Promise.resolve(w.__geminiMicStream);
        }
        
        console.log('[oVice] 通常のgetUserMediaを使用します。');
        return originalGetUserMedia(constraints);
      };

      console.log('[oVice] ✓ getUserMediaをオーバーライドしました（init script）');
      console.log('[oVice] 🔧 オーバーライド後のgetUserMedia:', typeof navigator.mediaDevices.getUserMedia);
      console.log('[oVice] 🔧 オーバーライドしたコードを含むか:', navigator.mediaDevices.getUserMedia.toString().includes('getUserMedia呼び出し検出'));
      
      // RTCPeerConnectionをオーバーライドして音声トラックを監視
      const OriginalRTCPeerConnection = window.RTCPeerConnection;
      let remoteAudioContext = null;
      
      // sendAudioToGeminiが利用可能になるまでキューに保存
      w.__remoteAudioQueue = w.__remoteAudioQueue || [];
      
      window.RTCPeerConnection = function(...args) {
        console.log('[oVice → Gemini] 🔗 新しいRTCPeerConnectionが作成されました');
        const pc = new OriginalRTCPeerConnection(...args);
        
        // オリジナルのontrackcallbackを保存
        const originalOntrack = pc.ontrack;
        
        // ontrackイベントをインターセプト
        pc.addEventListener('track', (event) => {
          console.log('[oVice → Gemini] 📡 トラックイベント:', event.track.kind, event.track.label);
          
          if (event.track.kind === 'audio' && event.streams && event.streams[0]) {
            console.log('[oVice → Gemini] 🎤 リモート音声トラックを検出！');
            
            // AudioContextを作成（初回のみ）
            if (!remoteAudioContext) {
              remoteAudioContext = new AudioContext({ sampleRate });
              console.log('[oVice → Gemini] リモート音声用AudioContextを作成 (sampleRate: ' + sampleRate + 'Hz)');
            }
            
            try {
              const stream = event.streams[0];
              const source = remoteAudioContext.createMediaStreamSource(stream);
              const processor = remoteAudioContext.createScriptProcessor(4096, 1, 1);
              // ダミーのGainNode（ScriptProcessorを動作させるために必要だが音は出さない）
              const dummyGain = remoteAudioContext.createGain();
              dummyGain.gain.value = 0; // 完全に無音
              
              let processCount = 0;
              processor.onaudioprocess = (e) => {
                processCount++;
                if (processCount === 1) {
                  console.log('[oVice → Gemini] 🎤 WebRTC音声処理が開始されました');
                }
                
                const inputBuffer = e.inputBuffer;
                const inputData = inputBuffer.getChannelData(0);
                
                // 音声データの存在を確認
                let hasAudio = false;
                let maxAmplitude = 0;
                for (let i = 0; i < inputData.length; i++) {
                  const amp = Math.abs(inputData[i]);
                  if (amp > maxAmplitude) maxAmplitude = amp;
                  if (amp > 0.01) {
                    hasAudio = true;
                  }
                }
                
                if (hasAudio && processCount % 100 === 0) {
                  console.log('[oVice → Gemini] 🎤 音声データ検出 (' + processCount + '回目, max: ' + maxAmplitude.toFixed(3) + ')');
                }
                
                // Float32ArrayをPCM16に変換
                const pcm16 = new Int16Array(inputData.length);
                for (let i = 0; i < inputData.length; i++) {
                  const s = Math.max(-1, Math.min(1, inputData[i]));
                  pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                }
                
                // Base64エンコード
                const bytes = new Uint8Array(pcm16.buffer);
                let binary = '';
                for (let i = 0; i < bytes.length; i++) {
                  binary += String.fromCharCode(bytes[i]);
                }
                const base64 = btoa(binary);
                
                // Node側に送信（関数が利用可能な場合）またはキューに保存
                if (w.sendAudioToGemini) {
                  w.sendAudioToGemini(base64, 'audio/pcm');
                } else {
                  // まだ関数が利用できない場合はキューに保存（最大1000個まで）
                  if (w.__remoteAudioQueue.length < 1000) {
                    w.__remoteAudioQueue.push(base64);
                  }
                  if (processCount === 1) {
                    console.warn('[oVice → Gemini] ⚠ sendAudioToGemini関数がまだ利用できません。キューに保存します');
                  }
                }
              };
              
              source.connect(processor);
              processor.connect(dummyGain);
              dummyGain.connect(remoteAudioContext.destination);
              // ダミーのGainは音量0なのでエコーなし、Gemini音声とも競合しない
              
              console.log('[oVice → Gemini] ✅ WebRTC音声キャプチャを開始しました（エコーなしモード）');
            } catch (error) {
              console.error('[oVice → Gemini] ❌ 音声キャプチャ設定失敗:', error);
            }
          }
        });
        
        return pc;
      };
      
      console.log('[oVice] ✓ RTCPeerConnectionをオーバーライドしました');
      })();
    })()`;
  }

  /**
   * ログイン前のセットアップ（音声ハンドラを設定）
   */
  async setupBeforeLogin(): Promise<void> {
    console.log('🎙️ Gemini音声ハンドラーを設定中...');
    
    // Geminiクライアントからの音声を受け取る
    this.geminiClient.onAudioMessage(async (audioData: string) => {
      // ブラウザのキューに音声データを追加（エラーハンドリング付き）
      try {
        await this.page.evaluate((data) => {
          const w = window as any;
          if (!w.__geminiAudioQueue) {
            w.__geminiAudioQueue = [];
          }
          const queueLengthBefore = w.__geminiAudioQueue.length;
          w.__geminiAudioQueue.push(data);
          if (queueLengthBefore % 10 === 0) {  // 10個ごとにログ
            console.log(`[oVice] 📦 Gemini音声データをキューに追加 (キュー長: ${w.__geminiAudioQueue.length})`);
          }
        }, audioData);
      } catch (error: any) {
        // ページナビゲーション中などでevaluateが失敗した場合
        if (error.message?.includes('Execution context was destroyed')) {
          // 一時的にNode側のキューに保存
          this.audioDataQueue.push(audioData);
        } else {
          console.error('音声データの送信に失敗:', error.message);
        }
      }
    });
    
    console.log('✓ Gemini音声ハンドラーの設定が完了しました。');
  }

  /**
   * ログイン後のセットアップ（双方向通信の完成）
   */
  async completeSetup(): Promise<void> {
    if (this.isRunning) {
      console.log('音声ブリッジは既に実行中です。');
      return;
    }

    console.log('\n========================================');
    console.log('🎙️ oVice ⇄ Gemini音声ブリッジを完成させます...');
    console.log('========================================');

    // 溜まっていた音声データをブラウザに送信
    if (this.audioDataQueue.length > 0) {
      console.log(`📦 溜まっていた音声データ ${this.audioDataQueue.length}個をブラウザに送信中...`);
      for (const audioData of this.audioDataQueue) {
        try {
          await this.page.evaluate((data) => {
            const w = window as any;
            if (!w.__geminiAudioQueue) {
              w.__geminiAudioQueue = [];
            }
            w.__geminiAudioQueue.push(data);
          }, audioData);
        } catch (error) {
          console.warn('溜まっていた音声データの送信に失敗:', error);
        }
      }
      this.audioDataQueue = [];
      console.log('✓ 溜まっていた音声データを送信しました。');
    }

    // oViceスピーカーからGeminiへの音声ストリームを設定（オプション）
    console.log('🎤 oVice→Gemini音声ストリームを設定中...');
    try {
      await this.setupOViceToGeminiStream();
      console.log('✓ 双方向音声ブリッジが開始されました。');
    } catch (error: any) {
      console.error('❌ oVice→Gemini音声ストリームの設定に失敗しました:');
      console.error('エラー詳細:', error.message || error);
      console.log('ℹ Gemini→oViceの片方向モードで続行します（GeminiがoViceで話せます）');
    }

    this.isRunning = true;
    console.log('✓ 音声ブリッジが開始されました。');
  }

  /**
   * 音声ブリッジを開始（後方互換性のため）
   */
  async start(): Promise<void> {
    await this.setupBeforeLogin();
    await this.completeSetup();
  }

  /**
   * oViceのスピーカー音声をGeminiに送る
   */
  private async setupOViceToGeminiStream(): Promise<void> {
    console.log('\n🔧 === setupOViceToGeminiStream 開始 ===');
    let audioChunkCount = 0;
    
    // ページ内でoViceの音声をキャプチャしてNode側に送る関数を公開
    console.log('📡 sendAudioToGemini 関数を公開中...');
    await this.page.exposeFunction('sendAudioToGemini', (base64Audio: string, mimeType: string) => {
      audioChunkCount++;
      if (audioChunkCount === 1) {
        console.log('🎉 最初の音声チャンクを受信しました！');
      }
      if (this.geminiClient.isConnected()) {
        this.geminiClient.sendAudio(base64Audio, mimeType);
        if (audioChunkCount <= 5 || audioChunkCount % 50 === 0) {  // 最初の5個と50チャンクごとにログ
          console.log(`🎤 oVice → Gemini: ${audioChunkCount}個目の音声チャンクを送信 (${base64Audio.length}文字)`);
        }
      } else {
        if (audioChunkCount % 10 === 0) {
          console.warn(`⚠ Geminiクライアントが接続されていないため、音声を送信できません (${audioChunkCount}個目)`);
        }
      }
    });
    console.log('✓ sendAudioToGemini 関数を公開しました');
    
    // キューに溜まっていたリモート音声データを送信
    const queuedAudioCount = await this.page.evaluate(() => {
      const w = window as any;
      const queue = w.__remoteAudioQueue || [];
      const count = queue.length;
      
      if (count > 0) {
        console.log(`[oVice → Gemini] キューに溜まっていた音声データ ${count}個を送信中...`);
        for (const audioData of queue) {
          if (w.sendAudioToGemini) {
            w.sendAudioToGemini(audioData, 'audio/pcm');
          }
        }
        w.__remoteAudioQueue = [];
      }
      
      return count;
    });
    
    if (queuedAudioCount > 0) {
      console.log(`✓ キューに溜まっていた ${queuedAudioCount}個の音声データを送信しました`);
    }

    // ページ内のaudio要素を確認
    const audioElements = await this.page.evaluate(() => {
      const audios = Array.from(document.querySelectorAll('audio'));
      return audios.map((audio, idx) => ({
        index: idx,
        src: audio.src,
        srcObject: audio.srcObject ? 'MediaStream' : null,
        id: audio.id,
        className: audio.className,
        paused: audio.paused,
        muted: audio.muted,
        volume: audio.volume,
        duration: audio.duration,
        currentTime: audio.currentTime
      }));
    });

    console.log(`\n🔍 ページ内のaudio要素: ${audioElements.length}個`);
    audioElements.forEach((audio, idx) => {
      console.log(`  [${idx}] ID: "${audio.id}", Class: "${audio.className}"`);
      console.log(`      Src: ${audio.src || 'なし'}, SrcObject: ${audio.srcObject || 'なし'}`);
      console.log(`      再生中: ${!audio.paused}, ミュート: ${audio.muted}, 音量: ${audio.volume}`);
      console.log(`      長さ: ${audio.duration}秒, 現在位置: ${audio.currentTime}秒`);
    });

    if (audioElements.length === 0) {
      console.warn('⚠ oViceには<audio>要素がありません。WebRTC経由で音声を取得します。');
      // audio要素がない場合、WebRTCから音声を取得
      await this.setupWebRTCAudioCapture();
      return;
    }

    // 10秒後にどのaudio要素が再生されているかチェック
    console.log('\n🔍 10秒後にaudio要素の状態を再確認します...');
    setTimeout(async () => {
      try {
        const laterAudioStates = await this.page.evaluate(() => {
          const audios = Array.from(document.querySelectorAll('audio'));
          return audios.map((audio, idx) => ({
            index: idx,
            id: audio.id,
            className: audio.className,
            paused: audio.paused,
            currentTime: audio.currentTime,
            volume: audio.volume,
            muted: audio.muted,
            hasSrcObject: !!audio.srcObject
          }));
        });
        
        console.log('\n📊 === 10秒後のaudio要素状態 ===');
        laterAudioStates.forEach((audio) => {
          console.log(`  [${audio.index}] ID: "${audio.id}", Class: "${audio.className}"`);
          console.log(`      再生中: ${!audio.paused}, 現在位置: ${audio.currentTime}秒`);
          console.log(`      音量: ${audio.volume}, ミュート: ${audio.muted}, SrcObject: ${audio.hasSrcObject}`);
        });
        console.log('================================\n');
      } catch (error) {
        console.error('audio要素の状態確認に失敗:', error);
      }
    }, 10000);

    console.log(`🔍 セレクタ "${this.config.audioSelector}" で音声要素を待機中...`);
    // oViceのスピーカー要素が存在するまで待機（タイムアウトを5秒に短縮）
    await this.page.waitForSelector(this.config.audioSelector, { timeout: 5000 });
    console.log('✓ 音声要素が見つかりました');

    // ブラウザ内でスピーカー音声をキャプチャ
    console.log('🎧 ブラウザ内で音声キャプチャを設定中...');
    await this.page.evaluate(
      ({ audioSelector, sampleRate }) => {
        console.log(`[oVice → Gemini] セレクタ "${audioSelector}" で音声要素を検索中...`);
        const audioElement = document.querySelector(audioSelector) as HTMLMediaElement;
        
        if (!audioElement) {
          console.error(`[oVice → Gemini] ❌ 音声要素が見つかりません: ${audioSelector}`);
          throw new Error(`音声要素が見つかりません: ${audioSelector}`);
        }

        console.log('[oVice → Gemini] ✓ oViceスピーカー要素を検出しました:', audioElement);
        console.log('[oVice → Gemini] 要素の状態: paused=' + audioElement.paused + ', muted=' + audioElement.muted + ', volume=' + audioElement.volume);

        // AudioContextでキャプチャ
        console.log('[oVice → Gemini] AudioContextを作成中... (sampleRate: ' + sampleRate + 'Hz)');
        const audioContext = new AudioContext({ sampleRate });
        let source: MediaElementAudioSourceNode;

        try {
          console.log('[oVice → Gemini] MediaElementSourceNodeを作成中...');
          source = audioContext.createMediaElementSource(audioElement);
          console.log('[oVice → Gemini] ✓ MediaElementSourceNodeを作成しました');
        } catch (error) {
          console.error('[oVice → Gemini] ❌ MediaElementSourceの作成に失敗:', error);
          throw error;
        }

        // ScriptProcessorNodeで音声データを取得
        const bufferSize = 4096;
        const processor = audioContext.createScriptProcessor(bufferSize, 1, 1);
        
        let processCount = 0;
        processor.onaudioprocess = (e) => {
          processCount++;
          if (processCount === 1) {
            console.log('[oVice → Gemini] 🎤 音声処理が開始されました');
          }
          
          const inputBuffer = e.inputBuffer;
          const inputData = inputBuffer.getChannelData(0);

          // 音声データの存在を確認（無音かどうか）
          let hasAudio = false;
          for (let i = 0; i < inputData.length; i++) {
            if (Math.abs(inputData[i]) > 0.01) {
              hasAudio = true;
              break;
            }
          }

          if (hasAudio && processCount % 100 === 0) {
            console.log(`[oVice → Gemini] 🎤 音声データを検出 (${processCount}回目)`);
          }

          // Float32ArrayをPCM16に変換
          const pcm16 = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            const s = Math.max(-1, Math.min(1, inputData[i]));
            pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }

          // Base64エンコード
          const bytes = new Uint8Array(pcm16.buffer);
          let binary = '';
          for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          const base64 = btoa(binary);

          // Node側に送信
          (window as any).sendAudioToGemini(base64, 'audio/pcm');
        };

        console.log('[oVice → Gemini] 🔗 音声ノードを接続中...');
        source.connect(processor);
        processor.connect(audioContext.destination); // スピーカーにも出力
        console.log('[oVice → Gemini] ✓ 音声ノードを接続しました');
        
        console.log('[oVice → Gemini] ✅ oVice → Geminiストリームを設定しました。音声処理を開始します...');

        // クリーンアップ用
        (window as any).__oviceAudioCleanup = () => {
          processor.disconnect();
          source.disconnect();
          audioContext.close();
        };
      },
      { audioSelector: this.config.audioSelector, sampleRate: this.config.inputSampleRate }
    );

    console.log('✓ oVice → Gemini音声ストリームを設定しました。');
    console.log('=== setupOViceToGeminiStream 完了 ===\n');
  }

  /**
   * WebRTC経由で音声をキャプチャ（audio要素がない場合）
   */
  private async setupWebRTCAudioCapture(): Promise<void> {
    console.log('\n🔧 === WebRTC音声キャプチャを設定 ===');
    
    // ブラウザ内でWebRTCのPeerConnectionを監視
    await this.page.evaluate(
      ({ sampleRate }) => {
        console.log('[oVice → Gemini] WebRTC音声キャプチャを設定中...');
        
        // RTCPeerConnectionのトラック追加を監視
        const OriginalRTCPeerConnection = window.RTCPeerConnection;
        let audioContext: AudioContext | null = null;
        let activeProcessors: ScriptProcessorNode[] = [];
        
        // @ts-ignore
        window.RTCPeerConnection = function(...args) {
          console.log('[oVice → Gemini] 新しいRTCPeerConnection が作成されました');
          const pc = new OriginalRTCPeerConnection(...args);
          
          // トラックが追加されたときに音声をキャプチャ
          pc.ontrack = (event) => {
            console.log('[oVice → Gemini] トラックを検出:', event.track.kind);
            
            if (event.track.kind === 'audio') {
              console.log('[oVice → Gemini] 🎤 音声トラックを検出！キャプチャを開始します');
              
              // MediaStreamから音声をキャプチャ
              const stream = event.streams[0];
              if (!stream) {
                console.error('[oVice → Gemini] ストリームが見つかりません');
                return;
              }
              
              // AudioContextを作成（初回のみ）
              if (!audioContext) {
                audioContext = new AudioContext({ sampleRate });
                console.log('[oVice → Gemini] AudioContextを作成しました (sampleRate: ' + sampleRate + 'Hz)');
              }
              
              try {
                const source = audioContext.createMediaStreamSource(stream);
                const processor = audioContext.createScriptProcessor(4096, 1, 1);
                
                let processCount = 0;
                processor.onaudioprocess = (e) => {
                  processCount++;
                  if (processCount === 1) {
                    console.log('[oVice → Gemini] 🎤 WebRTC音声処理が開始されました');
                  }
                  
                  const inputBuffer = e.inputBuffer;
                  const inputData = inputBuffer.getChannelData(0);
                  
                  // 音声データの存在を確認
                  let hasAudio = false;
                  for (let i = 0; i < inputData.length; i++) {
                    if (Math.abs(inputData[i]) > 0.01) {
                      hasAudio = true;
                      break;
                    }
                  }
                  
                  if (hasAudio && processCount % 100 === 0) {
                    console.log(`[oVice → Gemini] 🎤 音声データを検出 (${processCount}回目)`);
                  }
                  
                  // Float32ArrayをPCM16に変換
                  const pcm16 = new Int16Array(inputData.length);
                  for (let i = 0; i < inputData.length; i++) {
                    const s = Math.max(-1, Math.min(1, inputData[i]));
                    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                  }
                  
                  // Base64エンコード
                  const bytes = new Uint8Array(pcm16.buffer);
                  let binary = '';
                  for (let i = 0; i < bytes.length; i++) {
                    binary += String.fromCharCode(bytes[i]);
                  }
                  const base64 = btoa(binary);
                  
                  // Node側に送信
                  (window as any).sendAudioToGemini(base64, 'audio/pcm');
                };
                
                source.connect(processor);
                processor.connect(audioContext.destination);
                activeProcessors.push(processor);
                
                console.log('[oVice → Gemini] ✅ WebRTC音声キャプチャを開始しました');
              } catch (error) {
                console.error('[oVice → Gemini] ❌ 音声キャプチャの設定に失敗:', error);
              }
            }
          };
          
          return pc;
        };
        
        // 既存のRTCPeerConnectionも確認
        setTimeout(() => {
          // @ts-ignore
          const peerConnections = window.peerConnections || [];
          console.log('[oVice → Gemini] 既存のPeerConnection数:', peerConnections.length);
        }, 1000);
        
        console.log('[oVice → Gemini] ✓ RTCPeerConnectionの監視を開始しました');
      },
      { sampleRate: this.config.inputSampleRate }
    );
    
    console.log('✓ WebRTC音声キャプチャを設定しました');
    console.log('=== setupWebRTCAudioCapture 完了 ===\n');
  }

  /**
   * 音声ブリッジを停止
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    await this.page.evaluate(() => {
      const cleanup = (window as any).__oviceAudioCleanup;
      if (cleanup) {
        cleanup();
        delete (window as any).__oviceAudioCleanup;
      }
    });

    this.isRunning = false;
    console.log('音声ブリッジを停止しました。');
  }
}
