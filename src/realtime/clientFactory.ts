import { GeminiLiveClient } from '../gemini/client.js';
import { type RealtimeVoiceConfig, type RealtimeVoiceClient } from './types.js';
import { OpenAIRealtimeClient } from '../openai/realtimeClient.js';

export function createRealtimeClient(config: RealtimeVoiceConfig): RealtimeVoiceClient {
  switch (config.provider) {
    case 'GEMINI': {
      if (!config.gemini) {
        throw new Error('Gemini設定が不足しています。');
      }
      return new GeminiLiveClient({
        apiKey: config.gemini.apiKey,
        modelName: config.gemini.modelName,
        voiceName: config.gemini.voiceName,
        temperature: config.gemini.temperature,
        topP: config.gemini.topP,
        systemInstructions: config.gemini.systemInstructions
      });
    }
    case 'OPENAI': {
      if (!config.openai) {
        throw new Error('OpenAI設定が不足しています。');
      }
      return new OpenAIRealtimeClient({
        apiKey: config.openai.apiKey,
        model: config.openai.model,
        voice: config.openai.voice,
        temperature: config.openai.temperature,
        topP: config.openai.topP,
        systemInstructions: config.openai.systemInstructions
      });
    }
    default:
      throw new Error(`未対応のRealtimeプロバイダです: ${config.provider satisfies never}`);
  }
}

