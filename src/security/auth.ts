import type { Request, Response, NextFunction } from 'express';

export function authMiddleware(gatewaySecret: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.headers['x-gateway-key'];
    if (!key || key !== gatewaySecret) {
      res.status(401).json({ error: 'Unauthorized: invalid or missing X-Gateway-Key' });
      return;
    }
    next();
  };
}
