export function encodeLocationToken(x: number, y: number): string {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error('無効な座標が指定されました');
  }

  const normalizedX = Math.round(x);
  const normalizedY = Math.round(y);

  return `@${normalizedX},${normalizedY}`;
}

export function decodeLocationToken(token: string): { x: number; y: number } | null {
  if (!token) {
    return null;
  }

  const cleaned = token.startsWith('@') ? token.substring(1) : token;
  const [xPart, yPart] = cleaned.split(',');
  if (!xPart || !yPart) {
    return null;
  }

  const x = Number.parseInt(xPart, 10);
  const y = Number.parseInt(yPart, 10);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return { x, y };
}

