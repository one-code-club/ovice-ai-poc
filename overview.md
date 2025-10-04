# Objectives
oViceという2Dのメタバースシステムを使っています。すでにログインするIDを作って利用ｓていますが、これをPlayWrightを使って、自動的にログインすることができないか検討しています。プログラム的にPlayWrightを使って指定されたIDとPasswordを使ってログインさせ、さらに、自動でスピーカーとマイクをオンの状態にし、入ってきた音声入力に対してOpen AIやGeminiなどのAIに音声データを渡し、それに対する返答をやってもらうということをしたいです。どの程度技術的に可能か検討し、実装方法の提案をしてください

# Design
**Playwright で oVice への自動ログイン＋マイク／スピーカー制御までは実装可能**で、**入ってくる音声を取得して OpenAI/Gemini に渡し、AI の返答（音声含む）を返す**ことも、**技術的には構築できます**。ただし、**ブラウザの権限・自動再生ポリシー・oVice 側の利用規約／API 仕様**に依存する部分があり、いくつか実装上のクセと注意点があります（後述）。([playwright.dev][1])

# 実現方式（アーキテクチャ案）

1. **ログイン自動化**

* Playwright でログインフォームに ID/Password を入力→遷移確認→`storageState` を保存して以後のセッションを再利用（定期実行や複数ボットにも流用可）。([Checkly][2])

2. **マイク／カメラ／通知などの権限付与**

* コンテキストに対して `grantPermissions(['microphone','camera'])` を付与。Chromium 起動時に
  `--use-fake-device-for-media-stream` / `--use-fake-ui-for-media-stream`（許可ダイアログ抑止）/（必要なら）`--use-file-for-fake-audio-capture=/path/sample.wav` を付けると、E2E・CI でも安定します。([playwright.dev][1])
* oVice は入室時に**マイク許可が必須**なので、事前に上記で権限を与えておくのが安定策です。([help.ovice.com][3])

3. **oVice 内でのミュート解除（UI 操作）**

* 入室後、DOM 上のマイク／スピーカーのトグルボタン（例：🎙️アイコン）を `page.click()`。oVice はブラウザ版の利用を推奨（Chrome/Edge）なので、UI 変更に備え**ロール／ARIAラベル／テキスト**など堅牢なロケータ戦略をとります。([help.ovice.com][3])

4. **入ってくる音声の取得 → AI へストリーム**

* 受信音声は通常 `<audio>` 要素に出ます。Playwright から**スクリプトを注入**して Web Audio API で
  `const ctx = new AudioContext(); const node = ctx.createMediaStreamDestination();`
  `const es = new MediaStream();`（または `audioEl.captureStream()`）で**メディアストリーム化→MediaRecorder で chunk を取得→WebSocket 経由でサーバーへ**送り、OpenAI Realtime API または Gemini Live API に**双方向ストリーミング**します。([developer.mozilla.org][4])
* **OpenAI Realtime（WebRTC/WS）**や **Gemini Live** は**低遅延双方向**に対応しており、音声を送りつつ返答（テキスト/音声）をストリームでもらえます。([platform.openai.com][5])

5. **AI の返答を oVice 内に再生（TTS）**

* 返ってきた音声（または TTS で合成した音声）を `<audio>` に流せば**スピーカーから再生**できます。Gemini もネイティブ TTS を提供しています。([Google AI for Developers][6])

6. **自動再生ブロック回避（開発／検証環境）**

* 自動再生がブロックされるため、**Chromium 起動フラグ**に `--autoplay-policy=no-user-gesture-required` を加え、テスト・ボット用途で自動再生を許可すると安定（本番ブラウザでは通常の自動再生制限がかかります）。([Chrome for Developers][7])

---

# サンプル実装（Node.js + Playwright）

> ログイン→権限付与→入室→マイクON→受信音声キャプチャ→WebSocket で AI サーバーへ

```ts
// pnpm add playwright ws
import { chromium } from 'playwright';
import WebSocket from 'ws';

(async () => {
  const browser = await chromium.launch({
    headless: false,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      // 開発・検証で必要なら:
      '--autoplay-policy=no-user-gesture-required',
      // 録音の自動供給（E2E用途・任意）
      // `--use-file-for-fake-audio-capture=/path/to/sample.wav`,
    ],
  });

  const context = await browser.newContext();
  await context.grantPermissions(['microphone','camera']);
  const page = await context.newPage();

  // 1) oVice ログイン
  await page.goto('https://app.ovice.com/…'); // 貴社スペースのURL
  await page.fill('input[type="email"]', process.env.OVICE_ID!);
  await page.fill('input[type="password"]', process.env.OVICE_PW!);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }),
    page.click('button:has-text("ログイン")')
  ]);

  // 2) 入室→マイクON（ボタンのセレクタは実画面に合わせて調整）
  await page.click('button[aria-label*="マイク"]:not([aria-pressed="true"])');

  // 3) 受信音声をキャプチャして WebSocket で送出（ページ内に注入）
  const wsUrl = 'ws://localhost:8080/stream'; // 自作のAI中継サーバ
  await page.exposeFunction('sendToServer', (chunk: ArrayBuffer) => {
    // ページ→Nodeの橋渡し（任意、直接WSに繋ぐなら不要）
  });

  await page.addInitScript(() => {
    (async () => {
      const audioEl = document.querySelector('audio'); // oVice の受信要素
      if (!audioEl) return;
      await audioEl.play().catch(() => {}); // 自動再生フラグが無い環境では失敗することあり

      const stream = (audioEl as any).captureStream?.()  // 1) captureStream
        || new (window as any).AudioContext()            // 2) WebAudioで代替
             .createMediaStreamDestination().stream;      //   （必要に応じて接続）

      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      const ws = new WebSocket('ws://localhost:8080/stream'); // 直接WS接続も可
      ws.binaryType = 'arraybuffer';

      mr.ondataavailable = (e: any) => { if (e.data.size) e.data.arrayBuffer().then((ab: ArrayBuffer) => ws.readyState===1 && ws.send(ab)); };
      mr.start(250); // 250ms チャンク
    })();
  });

  // 4) AI からの返答（音声）をページで再生
  // ここでは簡略のため Node 側で <audio srcObject> を差し替えるスクリプトを評価
  // 実際には WS で opus/webm を受け取り、URL.createObjectURL で流すなど。
})();
```

* `grantPermissions` と起動フラグは **Playwright 公式API** と広く使われる Chromium スイッチです。([playwright.dev][1])
* 受信音声の取り出しは **`captureStream()` または Web Audio API + MediaRecorder** を活用するのが定石です。([developer.mozilla.org][8])

---

# AI 側（選択肢）

* **OpenAI Realtime API（WebRTC/WS）**
  ブラウザから直接 WebRTC で繋ぐ／サーバー中継（WS）で音声 chunk を渡す。返答を**音声でストリーム再生**可能。([platform.openai.com][5])
* **Gemini Live API**
  連続オーディオを**低遅延**処理。返答をテキスト／音声で受領。([Google AI for Developers][9])
* **（TTS だけ欲しい場合）Gemini の TTS 機能**で返答を音声化し `<audio>` 再生。([Google AI for Developers][6])

---

# 重要な注意点

* **oVice の規約／API**
  2025年9月に **Public API** が公開されています。まずは**公式APIや Webhook 連携**で代替できないか検討してください（UI 自動操作は変更に弱い）。([help.ovice.com][10])
* **ブラウザの自動再生ポリシー**
  実運用の通常ブラウザでは**ユーザー操作なしの自動再生は制限**されます。Bot 運用や検証では `--autoplay-policy=no-user-gesture-required` が実務的回避策ですが、一般ユーザー端末を前提とするなら**最初に1クリック**で音解放する UX を入れるのが安全です。([Chrome for Developers][7])
* **WebKit/Firefox の制約**
  カメラ／マイク権限の自動許可は Chromium 系が最も安定。Safari/WebKit では制約が多い点に留意。([GitHub][11])
* **セキュリティとプライバシー**
  収録・送信する音声には個人情報が含まれる可能性。**利用者への明示と同意、ログ管理、保存期間**の設計を。oVice のプライバシー・SLA も確認しておくと安心です。([help.ovice.com][12])

---

# 実装ロードマップ（提案）

1. **PoC（1〜2日規模）**

   * Playwright でログイン～入室～マイクON 自動化
   * 受信 `<audio>` を `captureStream()`→`MediaRecorder` で chunk 化し、ローカルに保存して確認（WS 送出はまだ）。([developer.mozilla.org][8])

  - Log-in Process
    - oViceのURLは、https://occ.ovice.in 
      - IDは tomakazu@gmail.com
      - Passwordは Tomakun1!
    - ブラウザ内にoViceアプリを立ち上げるか尋ねるウィンドウがポップアップされるので、そこでは「キャンセル」ボタンをクリックしてください
    - ダイアログが消えた画面で、「ブラウザでの利用を継続」Continue with Browserというリンクを探してクリックして、ログイン画面に移動する。
    - ログイン画面が出てくるので上記のIDとパスワードを入力する 
    - After log-in
      - マイクをオンにして、チャイム音を２秒間再生してください。

2. **AI 連携**

   * 中継サーバ（Node/WS）を用意し、chunk を **OpenAI Realtime** か **Gemini Live** に転送→返答を音声ストリームで受け取り、ページに反映。([platform.openai.com][5])
3. **堅牢化**

   * oVice UI のロケータを**データ属性**中心に再設計（もし提供されていれば）
   * 権限付与や自動再生の**フォールバック**（クリック促し）
   * `storageState` でセッション維持と**エラーハンドリング**。([Checkly][2])
4. **代替案の評価**

   * 公式 **Public API/Webhook** で達成できるタスクを API 側へ寄せ、UI 自動操作を最小化。([help.ovice.com][10])

---

# 参考リンク

* Playwright 権限付与 API（BrowserContext.grantPermissions）([playwright.dev][1])
* Chromium の偽装メディア入力フラグ（マイク／カメラ／UI 抑止）([Stack Overflow][13])
* oVice：マイク許可が必要／推奨ブラウザ ([help.ovice.com][3])
* Autoplay ポリシーと開発者向けフラグ ([Chrome for Developers][7])
* 受信音声のストリーム化（captureStream / MediaRecorder / Web Audio）([Chrome for Developers][14])
* OpenAI Realtime API（WebRTC/WS） / Gemini Live API（リアルタイム）([platform.openai.com][5])
* oVice Public API（2025/09 公開）([help.ovice.com][10])

---

必要でしたら、**貴社スペースの実 DOM に合わせた Playwright セレクタ、AI 中継サーバ（WS→OpenAI/Gemini）の最小実装、音声ストリームのコーデック設定（WebM/Opus など）**まで、すぐに動く雛形をこちらで用意します。どのクラウド（もしくはローカル）で動かすか、対象 OS/ブラウザ、マイクの入出力要件だけ教えてください。

[1]: https://playwright.dev/docs/api/class-browsercontext?utm_source=chatgpt.com "BrowserContext"
[2]: https://www.checklyhq.com/learn/playwright/authentication/?utm_source=chatgpt.com "How to Manage Authentication in Playwright"
[3]: https://help.ovice.com/hc/en-us/articles/10212060051865-Camera-and-Mic-Browser-Permission-Requirements-to-Enter-an-ovice-Space?utm_source=chatgpt.com "Camera and Mic Browser Permission Requirements to ..."
[4]: https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/createMediaStreamDestination?utm_source=chatgpt.com "AudioContext: createMediaStreamDestination() method - MDN"
[5]: https://platform.openai.com/docs/guides/realtime-webrtc?utm_source=chatgpt.com "Realtime API with WebRTC"
[6]: https://ai.google.dev/gemini-api/docs/speech-generation?utm_source=chatgpt.com "Speech generation (text-to-speech) - Gemini API"
[7]: https://developer.chrome.com/blog/autoplay?utm_source=chatgpt.com "Autoplay policy in Chrome | Blog"
[8]: https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/captureStream?utm_source=chatgpt.com "HTMLMediaElement: captureStream() method - Web APIs | MDN"
[9]: https://ai.google.dev/gemini-api/docs/live?utm_source=chatgpt.com "Get started with Live API | Gemini API | Google AI for Developers"
[10]: https://help.ovice.com/hc/en-us/articles/27613800985753-Public-API?utm_source=chatgpt.com "Public API"
[11]: https://github.com/microsoft/playwright/issues/11714?utm_source=chatgpt.com "support \"microphone\" and \"camera\" permissions for WebKit ..."
[12]: https://help.ovice.com/hc/en-us/articles/19399138930841-June-14-2023-Notice-of-ovice-Privacy-Policy-Update-and-Establishment-of-ovice-Subprocessor-Agreement?utm_source=chatgpt.com "June 14, 2023 Notice of ovice Privacy Policy Update and ..."
[13]: https://stackoverflow.com/questions/76781679/how-can-i-send-audio-to-fake-mic-input-using-playwright-on-chromium?utm_source=chatgpt.com "How can I send audio to fake mic input using Playwright on ..."
[14]: https://developer.chrome.com/blog/capture-stream?utm_source=chatgpt.com "Capture a MediaStream from a canvas, video or audio element"
