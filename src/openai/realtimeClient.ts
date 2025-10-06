import WebSocket from 'ws';
import { type RealtimeAudioMessageHandler, type RealtimeErrorHandler, type RealtimeVoiceClient } from '../realtime/types.js';

export interface OpenAIRealtimeConfig {
  apiKey: string;
  model: string;
  voice: string;
  temperature: number;
  topP: number;
  systemInstructions: string;
}

export class OpenAIRealtimeClient implements RealtimeVoiceClient {
  private ws: WebSocket | null = null;
  private readonly config: OpenAIRealtimeConfig;
  private messageHandler: RealtimeAudioMessageHandler | null = null;
  private errorHandler: RealtimeErrorHandler | null = null;
  private isReady = false;
  private audioSendCount = 0;

  constructor(config: OpenAIRealtimeConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log('既にOpenAI Realtime APIに接続しています。');
      return;
    }

    const url = 'wss://api.openai.com/v1/realtime?model=' + encodeURIComponent(this.config.model);
    console.log('OpenAI Realtime APIに接続中...');

    return new Promise((resolve, reject) => {
      try {
        const headers = {
          Authorization: `Bearer ${this.config.apiKey}`,
          'OpenAI-Beta': 'realtime=v1'
        };

        this.ws = new WebSocket(url, { headers });

        this.ws.on('open', () => {
          console.log('✓ OpenAI Realtime APIに接続しました。');
          resolve();
        });

        this.ws.on('message', (raw) => {
          this.handleMessage(raw);
        });

        this.ws.on('error', (error) => {
          console.error('❌ OpenAI WebSocketエラー:', error.message);
          if (this.errorHandler) {
            this.errorHandler(error);
          }
          reject(error);
        });

        this.ws.on('close', (code, reason) => {
          console.log(`OpenAI WebSocket接続が閉じられました。コード: ${code}, 理由: ${reason || 'なし'}`);
          this.ws = null;
          this.isReady = false;
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  startConversation(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('⚠ OpenAIセッションが準備されていません。');
      return;
    }

    if (this.isReady) {
      console.log('💬 OpenAI会話を開始（VADモードで自動応答）');
      // サーバーVADが有効な場合、ユーザーが話すと自動的に応答が生成されます
      // 必要に応じて初回挨拶を促すこともできます
      console.log('   ユーザーが話すと、OpenAIが自動的に応答します');
    } else {
      console.warn('⚠ OpenAIセッションがまだ初期化中のため、startConversationは待機します。');
    }
  }

  sendAudio(audioData: string, mimeType: string = 'audio/pcm'): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('⚠ OpenAI WebSocketが開いていません。');
      return;
    }

    if (!this.isReady) {
      console.warn('⚠ OpenAIセッションが準備できていないため、音声を送信できません。');
      return;
    }

    // OpenAI Realtime APIは audio フィールドに直接base64文字列を期待します
    const message = {
      type: 'input_audio_buffer.append',
      audio: audioData
    };

    this.ws.send(JSON.stringify(message));

    this.audioSendCount++;
    if (this.audioSendCount === 1) {
      console.log('✓ OpenAIへの音声送信を開始しました');
    } else if (this.audioSendCount % 100 === 0) {
      console.log(`✓ OpenAIへ ${this.audioSendCount}個の音声チャンクを送信しました`);
    }
  }

  onAudioMessage(handler: RealtimeAudioMessageHandler): void {
    this.messageHandler = handler;
  }

  onError(handler: RealtimeErrorHandler): void {
    this.errorHandler = handler;
  }

  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isReady = false;
    console.log('OpenAI Realtime API接続を閉じました。');
  }

  isConnected(): boolean {
    return Boolean(this.ws && this.ws.readyState === WebSocket.OPEN && this.isReady);
  }

  getPreferredInputMimeType(): string {
    return 'audio/pcm';
  }

  getPreferredSampleRate(): number {
    // OpenAI Realtime APIは24kHzをサポート
    return 24000;
  }

  getProviderLabel(): string {
    return 'OpenAI';
  }

  private handleMessage(raw: WebSocket.Data): void {
    let message: any;
    try {
      message = JSON.parse(raw.toString());
    } catch (error) {
      console.error('❌ OpenAIメッセージの解析に失敗:', error);
      return;
    }

    // 🔍 全てのイベントをログ出力（デバッグ用）
    console.log('📨 OpenAIイベント:', message.type);

    // セッション作成
    if (message.type === 'session.created') {
      this.isReady = true;
      console.log('✓ OpenAIセッションが作成されました');
      console.log('  - モデル:', message.session?.model);
      console.log('  - ボイス:', message.session?.voice);
      console.log('  - 入力音声フォーマット:', message.session?.input_audio_format);
      console.log('  - 出力音声フォーマット:', message.session?.output_audio_format);
      console.log('  - ターン検出:', message.session?.turn_detection);
      this.configureSession();
      return;
    }

    // セッション更新
    if (message.type === 'session.updated') {
      console.log('✓ OpenAIセッションが更新されました');
      return;
    }

    // 音声データ受信
    if (message.type === 'response.audio.delta') {
      if (message.delta && this.messageHandler) {
        console.log('🔊 OpenAI音声データ受信:', message.delta.length, '文字');
        this.messageHandler(message.delta);
      }
      return;
    }

    // 音声書き起こし受信
    if (message.type === 'response.audio_transcript.delta') {
      console.log('📝 OpenAI書き起こし:', message.delta);
      return;
    }

    // 応答完了
    if (message.type === 'response.done') {
      console.log('✓ OpenAI応答完了');
      return;
    }

    // 入力音声バッファコミット
    if (message.type === 'input_audio_buffer.committed') {
      console.log('✓ 音声入力がコミットされました');
      return;
    }

    // 会話アイテム作成
    if (message.type === 'conversation.item.created') {
      console.log('✓ 会話アイテム作成:', message.item?.type);
      return;
    }

    // エラー
    if (message.type === 'error') {
      const err = new Error(`OpenAI Error ${message.error?.code}: ${message.error?.message}`);
      console.error('❌', err.message);
      if (this.errorHandler) {
        this.errorHandler(err);
      }
      return;
    }

    // その他のイベント（デバッグ用）
    if (message.type !== 'response.audio.delta') {
      console.log('  📋 イベント詳細:', JSON.stringify(message, null, 2).substring(0, 500));
    }
  }

  private configureSession(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    console.log('🔧 OpenAIセッションを設定中...');
    const sessionConfig = {
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        instructions: this.config.systemInstructions,
        voice: this.config.voice,
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        input_audio_transcription: {
          model: 'whisper-1'
        },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 500
        },
        temperature: this.config.temperature,
        max_response_output_tokens: 4096
      }
    };

    console.log('  - システム指示:', this.config.systemInstructions.substring(0, 100) + '...');
    console.log('  - ボイス:', this.config.voice);
    console.log('  - VAD有効: サーバーサイド');
    this.ws.send(JSON.stringify(sessionConfig));
  }
}


