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

interface OpenAIRealtimeMessage {
  type: string;
  event_id?: string;
  session?: {
    default_model: string;
    voice: string;
  };
  response?: {
    output?: Array<{
      type: string;
      audio?: {
        data: string;
        format: string;
      };
      transcript?: string;
    }>;
    status?: string;
  };
  error?: {
    code: string;
    message: string;
  };
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
      console.log('💬 OpenAIに初回挨拶を促しています...');
      const message = {
        type: 'response.create',
        response: {
          modalities: ['audio', 'text'],
          instructions: 'Please introduce yourself now.'
        }
      };
      this.ws.send(JSON.stringify(message));
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

    const message = {
      type: 'input_audio_buffer.append',
      audio: {
        data: audioData,
        format: this.getAudioFormatFromMime(mimeType)
      }
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
    return 16000;
  }

  getProviderLabel(): string {
    return 'OpenAI';
  }

  private handleMessage(raw: WebSocket.Data): void {
    let message: OpenAIRealtimeMessage;
    try {
      message = JSON.parse(raw.toString()) as OpenAIRealtimeMessage;
    } catch (error) {
      console.error('❌ OpenAIメッセージの解析に失敗:', error);
      return;
    }

    if (message.type === 'session.created' && message.session) {
      this.isReady = true;
      console.log('✓ OpenAIセッションが作成されました。音声出力ボイス:', message.session.voice);
      this.sendSystemInstruction();
      return;
    }

    if (message.type === 'response.delta' || message.type === 'response.completed') {
      this.handleResponse(message);
      return;
    }

    if (message.type === 'error' && message.error) {
      const err = new Error(`OpenAI Error ${message.error.code}: ${message.error.message}`);
      if (this.errorHandler) {
        this.errorHandler(err);
      } else {
        console.error(err);
      }
      return;
    }
  }

  private handleResponse(message: OpenAIRealtimeMessage): void {
    const outputs = message.response?.output ?? [];
    for (const output of outputs) {
      if (output.type === 'audio' && output.audio?.data) {
        if (this.messageHandler) {
          this.messageHandler(output.audio.data);
        }
      }
      if (output.transcript) {
        console.log('💬 OpenAIテキスト応答:', output.transcript);
      }
    }
  }

  private sendSystemInstruction(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const message = {
      type: 'response.create',
      response: {
        instructions: this.config.systemInstructions,
        modalities: ['text']
      }
    };
    this.ws.send(JSON.stringify(message));
  }

  private getAudioFormatFromMime(mimeType: string): string {
    switch (mimeType) {
      case 'audio/pcm':
        return 'pcm16';
      case 'audio/wav':
        return 'wav';
      case 'audio/webm':
        return 'webm';
      default:
        console.warn(`未対応のMIMEタイプを受信: ${mimeType}。pcm16として扱います。`);
        return 'pcm16';
    }
  }
}

