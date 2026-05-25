import crypto from 'node:crypto';

export function encodeSignedPayload(value: unknown, secret: string): string {
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
  const signature = sign(payload, secret);
  return `${payload}.${signature}`;
}

export function decodeSignedPayload<T>(token: string, secret: string): T {
  const [payload, signature] = token.split('.');
  if (!payload || !signature || !timingSafeEqual(signature, sign(payload, secret))) {
    throw new Error('invalid signed payload');
  }
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as T;
}

function sign(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function timingSafeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
