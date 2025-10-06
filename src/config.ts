import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { SYSTEM_INSTRUCTIONS } from './gemini/systemInstructions.js';
import { OPENAI_SYSTEM_INSTRUCTIONS } from './openai/systemInstructions.js';
import { type RealtimeProvider, type RealtimeVoiceConfig } from './realtime/types.js';
import { encodeLocationToken } from './ovice/url.js';

loadEnv();

export interface Credentials {
  email: string;
  password: string;
}

export interface BrowserConfig {
  headless: boolean;
  slowMo: number;
  launchArgs: string[];
}

export interface AudioCaptureConfig {
  audioSelector: string;
  outputFile: string;
  chunkMs: number;
  durationMs: number; // 0の場合は無期限、それ以外はミリ秒
}

export interface UiSelectors {
  mic: string[];
  speaker: string[];
}

export interface AppConfig {
  baseUrl: string;
  credentials: Credentials;
  browser: BrowserConfig;
  audio: AudioCaptureConfig;
  selectors: UiSelectors;
  realtime: RealtimeVoiceConfig;
  initialLocation?: {
    x: number;
    y: number;
  };
  initialLocationToken?: string;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`環境変数 ${name} が設定されていません。`);
  }
  return value;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function parseInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildBaseUrlWithLocation(baseUrl: string, token?: string): string {
  if (!token) {
    return baseUrl;
  }

  const url = new URL(baseUrl);

  const normalizedToken = token.startsWith('@') ? token : `@${token}`;

  if (url.hash && url.hash.startsWith('#@')) {
    url.hash = `#${normalizedToken}`;
    return url.toString();
  }

  if (!url.pathname.endsWith('/')) {
    url.pathname = `${url.pathname}/`;
  }

  url.pathname = url.pathname.replace(/@[^/]+$/, '');
  url.pathname += normalizedToken;
  return url.toString();
}

function parseMinutesToMs(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const minutes = Number.parseInt(value, 10);
  if (!Number.isFinite(minutes) || minutes < 0) {
    return fallback;
  }
  // 0の場合は0を返す（無期限）、それ以外は分をミリ秒に変換
  return minutes === 0 ? 0 : minutes * 60 * 1000;
}

export function loadConfig(): AppConfig {
  const defaultAudioPath = path.resolve(process.cwd(), 'artifacts', 'ovice-audio.webm');
  const email = requiredEnv('OVICE_EMAIL');
  const password = requiredEnv('OVICE_PASSWORD');
  const realtimeProvider = (process.env.REALTIME_PROVIDER ?? 'GEMINI').toUpperCase() as RealtimeProvider;

  // 初期位置の読み込み（両方が設定されている場合のみ有効）
  const initialLocationX = process.env.INITIAL_LOCATION_X ? Number.parseInt(process.env.INITIAL_LOCATION_X, 10) : undefined;
  const initialLocationY = process.env.INITIAL_LOCATION_Y ? Number.parseInt(process.env.INITIAL_LOCATION_Y, 10) : undefined;
  const initialLocation =
    initialLocationX !== undefined && initialLocationY !== undefined &&
    Number.isFinite(initialLocationX) && Number.isFinite(initialLocationY)
      ? { x: initialLocationX, y: initialLocationY }
      : undefined;
  const initialLocationToken = initialLocation
    ? encodeLocationToken(initialLocation.x, initialLocation.y)
    : undefined;

  return {
    baseUrl: buildBaseUrlWithLocation(process.env.OVICE_BASE_URL ?? 'https://occ.ovice.in', initialLocationToken),
    credentials: {
      email,
      password
    },
    browser: {
      headless: parseBoolean(process.env.OVICE_HEADLESS, false),
      slowMo: parseInteger(process.env.OVICE_SLOWMO, 0),
      launchArgs: [
        '--use-fake-ui-for-media-stream',
        '--autoplay-policy=no-user-gesture-required'
      ]
    },
    audio: {
      audioSelector: process.env.OVICE_AUDIO_SELECTOR ?? 'audio',
      outputFile: process.env.OVICE_AUDIO_FILE ?? defaultAudioPath,
      chunkMs: parseInteger(process.env.OVICE_AUDIO_CHUNK_MS, 1000),
      durationMs: parseMinutesToMs(process.env.OVICE_CAPTURE_DURATION_MINUTES, 0)
    },
    selectors: {
      mic: [
        'button[aria-label*="マイク"]',
        'button[title*="マイク"]',
        'button[aria-label*="Microphone"]',
        'button[aria-label*="microphone"]',
        'button[title*="Microphone"]',
        'button[title*="microphone"]',
        'button:has-text("Mic")',
        'button:has-text("マイク")',
        '[data-testid*="mic"]',
        '[data-testid*="microphone"]',
        'button[class*="mic"]',
        'button[class*="microphone"]',
        'button svg[class*="mic"]',
        'button:has(svg):has-text("mic")'
      ],
      speaker: [
        'button[aria-label*="スピーカー"]',
        'button[title*="スピーカー"]',
        'button[aria-label*="Speaker"]',
        'button[aria-label*="speaker"]',
        'button[title*="Speaker"]',
        'button[title*="speaker"]',
        'button:has-text("Speaker")',
        'button:has-text("スピーカー")',
        '[data-testid*="speaker"]',
        'button[class*="speaker"]',
        'button svg[class*="speaker"]',
        'button:has(svg):has-text("speaker")'
      ]
    },
    realtime: buildRealtimeConfig(realtimeProvider),
    initialLocation,
    initialLocationToken
  };
}

function buildRealtimeConfig(provider: RealtimeProvider): RealtimeVoiceConfig {
  switch (provider) {
    case 'GEMINI': {
      const apiKey = requiredEnv('GEMINI_API_KEY');
      return {
        provider,
        gemini: {
          apiKey,
          modelName: process.env.GEMINI_MODEL_NAME ?? 'models/gemini-2.0-flash-exp',
          voiceName: process.env.GEMINI_VOICE_NAME ?? 'Puck',
          temperature: process.env.GEMINI_TEMPERATURE ? Number.parseFloat(process.env.GEMINI_TEMPERATURE) : 0.7,
          topP: process.env.GEMINI_TOP_P ? Number.parseFloat(process.env.GEMINI_TOP_P) : 0.9,
          systemInstructions: SYSTEM_INSTRUCTIONS
        }
      };
    }
    case 'OPENAI': {
      const apiKey = requiredEnv('OPENAI_API_KEY');
      return {
        provider,
        openai: {
          apiKey,
          model: process.env.OPENAI_REALTIME_MODEL ?? 'gpt-4o-realtime-preview',
          voice: process.env.OPENAI_REALTIME_VOICE ?? 'alloy',
          temperature: process.env.OPENAI_REALTIME_TEMPERATURE ? Number.parseFloat(process.env.OPENAI_REALTIME_TEMPERATURE) : 0.7,
          topP: process.env.OPENAI_REALTIME_TOP_P ? Number.parseFloat(process.env.OPENAI_REALTIME_TOP_P) : 0.9,
          systemInstructions: OPENAI_SYSTEM_INSTRUCTIONS
        }
      };
    }
    default:
      throw new Error(`未対応のリアルタイムプロバイダです: ${provider}`);
  }
}

