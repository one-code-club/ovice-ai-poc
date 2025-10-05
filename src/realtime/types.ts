export type RealtimeProvider = 'GEMINI' | 'OPENAI';

export interface RealtimeVoiceConfig {
  provider: RealtimeProvider;
  gemini?: {
    apiKey: string;
    modelName: string;
    voiceName: string;
    temperature: number;
    topP: number;
    systemInstructions: string;
  };
  openai?: {
    apiKey: string;
    model: string;
    voice: string;
    temperature: number;
    topP: number;
    systemInstructions: string;
  };
}

export type RealtimeAudioMessageHandler = (audioData: string) => void;
export type RealtimeErrorHandler = (error: Error) => void;

export interface RealtimeVoiceClient {
  connect(): Promise<void>;
  startConversation(): void;
  sendAudio(audioData: string, mimeType?: string): void;
  onAudioMessage(handler: RealtimeAudioMessageHandler): void;
  onError(handler: RealtimeErrorHandler): void;
  close(): void;
  isConnected(): boolean;
  getPreferredInputMimeType(): string;
  getPreferredSampleRate(): number;
  getProviderLabel(): string;
}

