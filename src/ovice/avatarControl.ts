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
    await page.evaluate(({ targetX, targetY }) => {
      // oViceスペース内のcanvas要素を取得
      const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
      if (!canvas) {
        throw new Error('oViceのcanvas要素が見つかりませんでした');
      }

      // canvas上の指定位置をクリックしてアバターを移動
      const rect = canvas.getBoundingClientRect();
      const canvasX = targetX;
      const canvasY = targetY;

      // クリックイベントを発火
      const clickEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: canvasX,
        clientY: canvasY
      });
      
      canvas.dispatchEvent(clickEvent);
    }, { targetX: x, targetY: y });

    // 移動が完了するまで待機
    await page.waitForTimeout(1000);
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

