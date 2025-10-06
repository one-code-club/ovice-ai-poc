import { Page } from 'playwright';

export interface AvatarPosition {
  x: number;
  y: number;
}

export interface AvatarController {
  /**
   * 現在のアバターの位置を取得します
   */
  getCurrentPosition: () => Promise<AvatarPosition>;

  /**
   * アバターを指定された相対位置に移動します
   * @param deltaX X方向の移動距離（ピクセル）
   * @param deltaY Y方向の移動距離（ピクセル）
   */
  moveRelative: (deltaX: number, deltaY: number) => Promise<void>;

  /**
   * アバターを指定された絶対位置に移動します
   * @param x X座標（ピクセル）
   * @param y Y座標（ピクセル）
   */
  moveAbsolute: (x: number, y: number) => Promise<void>;
}

/**
 * oViceスペース内のアバターを制御するコントローラーを作成します
 * @param page Playwrightのページオブジェクト
 * @returns アバター制御用のコントローラー
 */
export function createAvatarController(page: Page): AvatarController {
  const getCurrentPosition = async (): Promise<AvatarPosition> => {
    return await page.evaluate(() => {
      // oViceのアバター要素を探す
      // 一般的にoViceでは自分のアバターに特定のクラスやdata属性が付いている
      const avatarElement = document.querySelector('[data-my-avatar="true"]') 
        || document.querySelector('.my-avatar')
        || document.querySelector('[class*="MyAvatar"]');
      
      if (!avatarElement) {
        // フォールバック: canvas上のアバター座標を取得する別の方法を試す
        // oViceは内部状態を持っている可能性があるので、windowオブジェクトから取得を試みる
        const oviceState = (window as any).__oviceState || (window as any).ovice;
        if (oviceState?.myAvatar?.position) {
          return {
            x: oviceState.myAvatar.position.x,
            y: oviceState.myAvatar.position.y
          };
        }
        
        throw new Error('自分のアバター要素が見つかりませんでした');
      }

      const rect = avatarElement.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      };
    });
  };

  const moveAbsolute = async (x: number, y: number): Promise<void> => {
    console.log(`  - canvas上の座標 (${x}, ${y}) をクリックしてアバターを移動します...`);
    
    const result = await page.evaluate(() => {
      const canvases = Array.from(document.querySelectorAll('canvas')).map((canvas, index) => {
        const rect = canvas.getBoundingClientRect();
        return {
          index,
          area: rect.width * rect.height,
          boundingRect: {
            width: rect.width,
            height: rect.height,
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom
          },
          intrinsic: {
            width: canvas.width,
            height: canvas.height
          },
          dataset: { ...canvas.dataset }
        };
      });

      if (canvases.length === 0) {
        return { success: false as const, error: 'oViceのcanvas要素が見つかりませんでした' };
      }

      const largestCanvas = canvases.reduce((max, current) => {
        return current.area > max.area ? current : max;
      }, canvases[0]);

      const globalOvice = (window as any).ovice;
      const legacyState = (window as any).__oviceState;

      const myAvatar = legacyState?.myAvatar ?? globalOvice?.space?.store?.state?.myAvatar ?? null;
      const currentStatePosition = myAvatar?.position ?? null;

      const spaceInfo = legacyState?.space ?? globalOvice?.space ?? null;
      const cameraInfo = legacyState?.camera ?? globalOvice?.space?.camera ?? null;
      const avatarKeys = myAvatar ? Object.keys(myAvatar) : [];

      let cameraSnapshot: Record<string, unknown> | null = null;
      const camera = globalOvice?.space?.camera ?? legacyState?.camera;
      if (camera) {
        cameraSnapshot = {
          keys: Object.keys(camera),
          state: camera.state ?? camera._state ?? null,
          zoom: camera.zoom ?? null,
          position: camera.position ?? camera._position ?? null
        };
      }

      const landscape = spaceInfo?.landscape ?? null;
      let landscapeSummary: Record<string, unknown> | null = null;
      if (landscape)
        landscapeSummary = {
          keys: Object.keys(landscape),
          width: (landscape as any).width ?? null,
          height: (landscape as any).height ?? null,
          scale: (landscape as any).scale ?? null,
          origin: (landscape as any).origin ?? null
        };

      const winKeys = Object.keys(window).filter(key => key.toLowerCase().includes('ovice'));

      return {
        success: true as const,
        canvases,
        selectedCanvas: largestCanvas,
        selectedIndex: largestCanvas.index,
        statePosition: currentStatePosition,
        debug: {
          avatarKeys,
          spaceKeys: spaceInfo ? Object.keys(spaceInfo) : [],
          cameraKeys: cameraInfo ? Object.keys(cameraInfo) : [],
          landscapeSummary,
          cameraSnapshot,
          windowKeys: winKeys.slice(0, 20)
        }
      };
    });

    if (!result.success) {
      throw new Error(result.error || 'アバター移動に失敗しました');
    }

    const { selectedCanvas, selectedIndex, canvases, statePosition, debug } = result;
    const canvasRect = selectedCanvas.boundingRect;
    const intrinsicSize = selectedCanvas.intrinsic;
    console.log(`  ✓ Canvas情報: ${JSON.stringify(canvasRect)}`);
    console.log(`  ✓ Canvas内部解像度: ${JSON.stringify(intrinsicSize)}`);
    console.log(`  ℹ 取得したcanvas一覧: ${JSON.stringify(canvases, null, 2)}`);
    if (debug) {
      console.log(`  ℹ oViceデバッグ情報: ${JSON.stringify(debug)}`);
    }
    if (statePosition) {
      console.log(`  ℹ 現在のoVice座標: (${statePosition.x}, ${statePosition.y})`);
    }
    console.log(`[oVice] 指定座標: (${x}, ${y})`);

    const isViewportCoordinate = x >= canvasRect.left && x <= canvasRect.right && y >= canvasRect.top && y <= canvasRect.bottom;

    let relativeX: number;
    let relativeY: number;

    if (isViewportCoordinate) {
      relativeX = x - canvasRect.left;
      relativeY = y - canvasRect.top;
      console.log('  ℹ 座標をビューポート基準として解釈します');
    } else {
      const clampedCanvasX = Math.max(0, Math.min(x, intrinsicSize.width || x));
      const clampedCanvasY = Math.max(0, Math.min(y, intrinsicSize.height || y));

      relativeX = intrinsicSize.width
        ? (clampedCanvasX / intrinsicSize.width) * canvasRect.width
        : clampedCanvasX;
      relativeY = intrinsicSize.height
        ? (clampedCanvasY / intrinsicSize.height) * canvasRect.height
        : clampedCanvasY;

      console.log('  ℹ 座標をcanvas基準としてスケーリングします');
      console.log(`    - 正規化後: (${relativeX.toFixed(2)}, ${relativeY.toFixed(2)})`);
    }

    relativeX = Math.max(0, Math.min(relativeX, canvasRect.width - 1));
    relativeY = Math.max(0, Math.min(relativeY, canvasRect.height - 1));

    console.log(`  - canvas相対座標に変換: (${relativeX.toFixed(2)}, ${relativeY.toFixed(2)})`);

    const latestRectResult = await page.evaluate(({ index, relX, relY }) => {
      const canvases = document.querySelectorAll('canvas');
      const canvas = canvases[index] as HTMLCanvasElement | undefined;
      if (!canvas) {
        return { success: false as const, error: `canvas index ${index} が見つかりません` };
      }

      const rect = canvas.getBoundingClientRect();
      const clickX = rect.left + Math.max(0, Math.min(relX, rect.width - 1));
      const clickY = rect.top + Math.max(0, Math.min(relY, rect.height - 1));

      const ovice = (window as any).ovice;
      const cameraState = ovice?.space?.camera?.state ?? ovice?.space?.camera?._state ?? null;
      const cameraPosition = ovice?.space?.camera?.position ?? ovice?.space?.camera?._position ?? null;

      return {
        success: true as const,
        rect: {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height
        },
        clickX,
        clickY,
        extraCamera: {
          state: cameraState,
          position: cameraPosition,
          zoom: ovice?.space?.camera?.zoom ?? null,
          viewport: ovice?.space?.camera?.renderer?.view?.getBoundingClientRect?.() ?? null
        }
      };
    }, { index: selectedIndex, relX: relativeX, relY: relativeY });

    if (!latestRectResult.success) {
      throw new Error(latestRectResult.error || 'canvas詳細の取得に失敗しました');
    }

    console.log(`  ℹ 最新のcanvas rect: ${JSON.stringify(latestRectResult.rect)}`);
    if (latestRectResult.extraCamera) {
      console.log(`  ℹ カメラ情報: ${JSON.stringify(latestRectResult.extraCamera)}`);
    }

    const { clickX, clickY } = latestRectResult;
    console.log(`  - グローバルクリック座標: (${clickX.toFixed(2)}, ${clickY.toFixed(2)})`);

    await page.mouse.move(clickX, clickY, { steps: 8 });
    await page.mouse.click(clickX, clickY, {
      button: 'left',
      delay: 30
    });
    console.log(`[oVice] Playwrightのcanvasクリックを送信しました`);
    console.log(`  - アバターの移動を待機中...`);

    // 移動が完了するまで待機
    await page.waitForTimeout(2000);

    try {
      const updatedPosition = await getCurrentPosition();
      console.log(`  ✓ 移動後のアバター位置(視覚座標): (${updatedPosition.x}, ${updatedPosition.y})`);
    } catch (err) {
      console.warn('  ⚠ 移動後のアバター位置を取得できませんでした:', err);
    }
  };

  const moveRelative = async (deltaX: number, deltaY: number): Promise<void> => {
    console.log(`アバターを相対移動します: X方向 +${deltaX}px, Y方向 +${deltaY}px`);
    
    const currentPos = await getCurrentPosition();
    console.log(`現在のアバター位置: (${currentPos.x}, ${currentPos.y})`);
    
    const newX = currentPos.x + deltaX;
    const newY = currentPos.y + deltaY;
    console.log(`新しい目標位置: (${newX}, ${newY})`);
    
    await moveAbsolute(newX, newY);
    console.log('✓ アバターの移動が完了しました');
  };

  return {
    getCurrentPosition,
    moveRelative,
    moveAbsolute
  };
}

/**
 * ログイン後にアバターを初期化し、指定された距離だけ移動します
 * @param page Playwrightのページオブジェクト
 * @param deltaX X方向の移動距離（ピクセル）
 * @param deltaY Y方向の移動距離（ピクセル）
 */
export async function initializeAndMoveAvatar(
  page: Page,
  deltaX: number = 300,
  deltaY: number = 300
): Promise<void> {
  console.log('📍 アバター制御を初期化中...');
  
  // アバターが完全にロードされるまで待機
  await page.waitForTimeout(2000);
  
  const controller = createAvatarController(page);
  
  try {
    await controller.moveRelative(deltaX, deltaY);
  } catch (error) {
    console.error('❌ アバターの移動に失敗しました:', error);
    throw error;
  }
}

/**
 * アバターを指定された絶対座標に移動します
 * @param page Playwrightのページオブジェクト
 * @param x X座標（ピクセル）
 * @param y Y座標（ピクセル）
 */
export async function moveToInitialPosition(
  page: Page,
  x: number,
  y: number
): Promise<void> {
  console.log(`📍 アバターを初期位置に移動中: (${x}, ${y})`);
  
  // アバターが完全にロードされるまで待機
  await page.waitForTimeout(2000);
  
  const controller = createAvatarController(page);
  
  try {
    await controller.moveAbsolute(x, y);
    console.log(`✓ アバターを初期位置 (${x}, ${y}) に移動しました`);
  } catch (error) {
    console.error('❌ アバターの初期位置への移動に失敗しました:', error);
    throw error;
  }
}

