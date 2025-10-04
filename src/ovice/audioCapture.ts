import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Page } from 'playwright';
import { AudioCaptureConfig } from '../config.js';

export interface AudioCaptureController {
  stop: () => Promise<void>;
}

export async function startAudioCapture(page: Page, config: AudioCaptureConfig): Promise<AudioCaptureController> {
  const outputDir = path.dirname(config.outputFile);
  await mkdir(outputDir, { recursive: true });

  const writer = createWriteStream(config.outputFile);
  let stopped = false;

  await page.exposeFunction('oviceOnAudioChunk', (chunk: number[]) => {
    if (!stopped && chunk.length > 0) {
      writer.write(Buffer.from(chunk));
    }
  });

  await page.exposeFunction('oviceOnAudioLog', (message: string) => {
    console.debug(`[browser] ${message}`);
  });

  await page.exposeFunction('oviceOnAudioError', (message: string) => {
    console.error(`[browser] audio error: ${message}`);
  });

  await page.waitForFunction(
    (selector) => !!document.querySelector(selector),
    config.audioSelector,
    { timeout: 15000 }
  );

  await page.evaluate(
    ({ audioSelector, chunkMs }) => {
      const globalThisRef = window as typeof window & {
        __oviceAudioCleanup?: () => void;
      };

      if (globalThisRef.__oviceAudioCleanup) {
        globalThisRef.__oviceAudioCleanup();
        delete globalThisRef.__oviceAudioCleanup;
      }

      const target = document.querySelector(audioSelector) as HTMLMediaElement | null;
      if (!target) {
        throw new Error(`Audio element not found for selector: ${audioSelector}`);
      }

      const ensurePlayback = async () => {
        try {
          if (target.paused) {
            await target.play();
          }
        } catch (error) {
          console.warn('Audio playback could not be started automatically', error);
        }
      };

      const startRecorder = async () => {
        await ensurePlayback();

        let stream: MediaStream | null = null;
        let audioContext: AudioContext | undefined;

        if (typeof target.captureStream === 'function') {
          stream = target.captureStream();
        } else if (typeof (target as any).mozCaptureStream === 'function') {
          stream = (target as any).mozCaptureStream();
        }

        if (!stream) {
          audioContext = new AudioContext();
          const source = audioContext.createMediaElementSource(target);
          const destination = audioContext.createMediaStreamDestination();
          source.connect(audioContext.destination);
          source.connect(destination);
          stream = destination.stream;
        }

        const recorder = new MediaRecorder(stream!, { mimeType: 'audio/webm;codecs=opus' });

        recorder.addEventListener('dataavailable', async (event) => {
          if (event.data.size > 0) {
            const buffer = await event.data.arrayBuffer();
            const chunk = Array.from(new Uint8Array(buffer));
            (window as any).oviceOnAudioChunk(chunk);
          }
        });

        recorder.addEventListener('error', (event) => {
          (window as any).oviceOnAudioError(String(event));
        });

        recorder.start(chunkMs);

        globalThisRef.__oviceAudioCleanup = () => {
          if (recorder.state !== 'inactive') {
            recorder.stop();
          }
          stream?.getTracks().forEach((track) => track.stop());
          audioContext?.close().catch(() => {});
        };
      };

      startRecorder().catch((error) => {
        (window as any).oviceOnAudioError(error instanceof Error ? error.message : String(error));
      });
    },
    { audioSelector: config.audioSelector, chunkMs: config.chunkMs }
  );

  const stop = async () => {
    if (stopped) {
      return;
    }
    stopped = true;

    await page.evaluate(() => {
      const globalThisRef = window as typeof window & {
        __oviceAudioCleanup?: () => void;
      };
      if (globalThisRef.__oviceAudioCleanup) {
        globalThisRef.__oviceAudioCleanup();
        delete globalThisRef.__oviceAudioCleanup;
      }
    });

    await new Promise<void>((resolve) => {
      writer.end(resolve);
    });
  };

  return { stop };
}

