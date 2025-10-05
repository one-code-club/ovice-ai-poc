import WebSocket from 'ws';
import { type RealtimeAudioMessageHandler, type RealtimeErrorHandler, type RealtimeVoiceClient } from '../realtime/types.js';

export interface GeminiConfig {
  apiKey: string;
  modelName?: string;
  systemInstructions?: string;
  voiceName?: string;
  temperature?: number;
  topP?: number;
}

export interface AudioChunk {
  data: string; // Base64エンコードされた音声データ
  mimeType: string;
}

type MessageHandler = (audioData: string) => void;
type ErrorHandler = (error: Error) => void;

export class GeminiLiveClient implements RealtimeVoiceClient {
  private ws: WebSocket | null = null;
  private config: Required<GeminiConfig>;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = Infinity; // oViceセッションが続く限り再接続
  private reconnectDelay = 2000; // 2秒
  private isIntentionallyClosed = false;
  private messageHandler: RealtimeAudioMessageHandler | null = null;
  private errorHandler: RealtimeErrorHandler | null = null;
  private isSessionStarted = false;
  private audioSendCount = 0;

  constructor(config: GeminiConfig) {
    this.config = {
      apiKey: config.apiKey,
      modelName: config.modelName ?? 'models/gemini-2.0-flash-exp',
      systemInstructions: config.systemInstructions ?? "Say, Hello everyone, I'm Gemini AI. Can you hear me?",
      voiceName: config.voiceName ?? 'Puck', // 若い女性の声
      temperature: config.temperature ?? 0.7,
      topP: config.topP ?? 0.9
    };
  }

  /**
   * Gemini Live APIに接続
   */
  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log('既にGemini Live APIに接続しています。');
      return;
    }

    this.isIntentionallyClosed = false;

    return new Promise((resolve, reject) => {
      try {
        const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${this.config.apiKey}`;
        
        console.log('Gemini Live APIに接続中...');
        this.ws = new WebSocket(url);

        this.ws.on('open', () => {
          console.log('✓ Gemini Live APIに接続しました。');
          this.reconnectAttempts = 0;
          this.setupSession();
          resolve();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          this.handleMessage(data);
        });

        this.ws.on('error', (error) => {
          console.error('❌ Gemini WebSocketエラー:', error.message);
          if (this.errorHandler) {
            this.errorHandler(error);
          }
          reject(error);
        });

        this.ws.on('close', (code, reason) => {
          console.log(`Gemini WebSocket接続が閉じられました。コード: ${code}, 理由: ${reason || 'なし'}`);
          this.ws = null;
          this.isSessionStarted = false;

          if (!this.isIntentionallyClosed) {
            this.attemptReconnect();
          }
        });

      } catch (error) {
        console.error('❌ Gemini接続の初期化に失敗:', error);
        reject(error);
      }
    });
  }

  /**
   * セッションのセットアップメッセージを送信
   */
  private setupSession(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('⚠ WebSocketが開いていないため、セッションをセットアップできません。');
      return;
    }

    const setupMessage = {
      setup: {
        model: this.config.modelName,
        generation_config: {
          response_modalities: ['AUDIO'],
          speech_config: {
            voice_config: {
              prebuilt_voice_config: {
                voice_name: this.config.voiceName
              }
            }
          },
          temperature: this.config.temperature,
          top_p: this.config.topP
        },
        system_instruction: {
          parts: [
            {
              text: this.config.systemInstructions
            }
          ]
        }
      }
    };

    this.ws.send(JSON.stringify(setupMessage));
    console.log('Geminiセッションをセットアップしました。');
    console.log(`システム指示: "${this.config.systemInstructions}"`);
    console.log(`音声: ${this.config.voiceName}`);
    this.isSessionStarted = true;
  }

  /**
   * 受信メッセージの処理
   */
  private handleMessage(data: WebSocket.Data): void {
    try {
      const message = JSON.parse(data.toString());

      // セットアップ完了の確認
      if (message.setupComplete) {
        console.log('✓ Geminiセッションの準備が完了しました。');
        // 初回挨拶は呼び出し元が startConversation() を呼ぶまで待つ
        return;
      }

      // サーバーからの音声データ
      if (message.serverContent?.modelTurn?.parts) {
        for (const part of message.serverContent.modelTurn.parts) {
          if (part.inlineData?.data) {
            // Base64エンコードされた音声データ
            const audioDataLength = part.inlineData.data.length;
            console.log(`🔊 Gemini音声データを受信: ${audioDataLength}文字 (Base64)`);
            if (this.messageHandler) {
              this.messageHandler(part.inlineData.data);
            }
          }
          if (part.text) {
            console.log('💬 Geminiテキスト応答:', part.text);
          }
        }
      }

      // ターン完了
      if (message.serverContent?.turnComplete) {
        console.log('✓ Geminiのターンが完了しました。');
      }

    } catch (error) {
      console.error('❌ Geminiメッセージの解析に失敗:', error);
    }
  }

  /**
   * 会話を開始（最初の挨拶を促す）
   */
  startConversation(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.isSessionStarted) {
      console.warn('⚠ Geminiセッションが準備できていません。');
      return;
    }

    console.log('💬 Geminiに最初の挨拶を促しています...');
    
    // システム指示に従って話し始めるよう促す
    const message = {
      clientContent: {
        turns: [
          {
            role: 'user',
            parts: [
              {
                text: 'Please introduce yourself now.'
              }
            ]
          }
        ],
        turnComplete: true
      }
    };

    this.ws.send(JSON.stringify(message));
  }

  /**
   * 音声データをGeminiに送信
   */
  sendAudio(audioData: string, mimeType: string = 'audio/pcm'): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('⚠ WebSocketが開いていないため、音声を送信できません。');
      return;
    }

    if (!this.isSessionStarted) {
      console.warn('⚠ セッションが開始されていないため、音声を送信できません。');
      return;
    }

    const message = {
      realtimeInput: {
        mediaChunks: [
          {
            mimeType: mimeType,
            data: audioData
          }
        ]
      }
    };

    this.ws.send(JSON.stringify(message));
    
    this.audioSendCount++;
    if (this.audioSendCount === 1) {
      console.log('✓ Geminiへの音声送信を開始しました');
    } else if (this.audioSendCount % 100 === 0) {
      console.log(`✓ Geminiへ ${this.audioSendCount}個の音声チャンクを送信しました`);
    }
  }

  /**
   * 音声メッセージハンドラを設定
   */
  onAudioMessage(handler: RealtimeAudioMessageHandler): void {
    this.messageHandler = handler;
  }

  /**
   * エラーハンドラを設定
   */
  onError(handler: RealtimeErrorHandler): void {
    this.errorHandler = handler;
  }

  /**
   * 再接続を試みる
   */
  private attemptReconnect(): void {
    if (this.isIntentionallyClosed) {
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectDelay * this.reconnectAttempts, 30000); // 最大30秒

    console.log(`Gemini Live APIへの再接続を試みます... (試行 ${this.reconnectAttempts}回目、${delay}ms後)`);

    setTimeout(() => {
      if (!this.isIntentionallyClosed) {
        this.connect().catch((error) => {
          console.error('❌ 再接続に失敗:', error);
        });
      }
    }, delay);
  }

  /**
   * 接続を閉じる
   */
  close(): void {
    this.isIntentionallyClosed = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    console.log('Gemini Live API接続を閉じました。');
  }

  /**
   * 接続状態を確認
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this.isSessionStarted;
  }

  getPreferredInputMimeType(): string {
    return 'audio/pcm';
  }

  getPreferredSampleRate(): number {
    return 24000;
  }

  getProviderLabel(): string {
    return 'Gemini';
  }
}
