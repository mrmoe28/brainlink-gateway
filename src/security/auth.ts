import { timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

function safeCompare(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

export function authMiddleware(gatewaySecret: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.headers['x-gateway-key'];
    if (!key || !safeCompare(String(key), gatewaySecret)) {
      res.status(401).json({ error: 'Unauthorized: invalid or missing X-Gateway-Key' });
      return;
    }
    next();
  };
}
