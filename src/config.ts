import { config as loadEnv } from 'dotenv';
import path from 'node:path';

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

  return {
    baseUrl: process.env.OVICE_BASE_URL ?? 'https://occ.ovice.in',
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
    }
  };
}

