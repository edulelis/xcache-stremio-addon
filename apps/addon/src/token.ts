import crypto from 'node:crypto';

const TOKEN_CONTEXT = 'xcache-stremio-addon/install-token/v1';

export function createInstallToken(secret: string): string {
  const digest = crypto.createHmac('sha256', secret).update(TOKEN_CONTEXT).digest('base64url');
  return `xc_${digest.slice(0, 32)}`;
}

export function isValidInstallToken(token: string, secret: string): boolean {
  const expected = createInstallToken(secret);
  return timingSafeEqual(token, expected);
}

function timingSafeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
