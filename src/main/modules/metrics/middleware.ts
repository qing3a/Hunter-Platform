import type { Request, Response, NextFunction } from 'express';
import { getHunterMetrics } from './registry.js';

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();
  const route = req.path;

  res.on('finish', () => {
    // Skip /metrics endpoint to avoid recursion (and keep cardinality low).
    if (route === '/metrics' || route === '/v1/metrics') return;
    const durationSec = Number(process.hrtime.bigint() - start) / 1e9;
    const m = getHunterMetrics();
    const labels = { route, method: req.method, status: String(res.statusCode) };
    m.httpRequestDuration.observe(labels, durationSec);
    m.httpRequestsTotal.inc(labels);
  });

  next();
}
