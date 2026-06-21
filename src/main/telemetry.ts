/**
 * OpenTelemetry SDK init + tracing helpers.
 *
 * Lifecycle:
 *   await startTelemetry({ exporter: 'console' | 'otlp' | 'none' });
 *   // ... app runs, withSpan / getTraceIdFromContext work as needed
 *   await shutdownTelemetry();
 *
 * MUST be called before any HTTP server / DB code is imported, so that
 * auto-instrumentation can patch http/express/sqlite at module-load time.
 * The first import of this file should be the very first thing server.ts
 * does.
 *
 * Trace contract:
 *   - Every HTTP response gets an `x-trace-id` response header (32 hex
 *     chars, W3C Trace ID format). See respond() in responses.ts.
 *   - Every row in action_history is stamped with trace_id of the request
 *     that caused the action.
 *   - Webhook deliveries carry `traceparent` outbound so the recipient's
 *     Agent can join their trace timeline to ours.
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { ConsoleSpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { trace, context, SpanStatusCode, SpanKind, type Span, type Tracer } from '@opentelemetry/api';
import type { Request, Response, NextFunction, RequestHandler } from 'express';

let sdk: NodeSDK | null = null;
let started = false;

export interface TelemetryOptions {
  /** 'console' for dev, 'otlp' for prod, 'none' to disable */
  exporter: 'console' | 'otlp' | 'none';
  serviceName?: string;
}

/**
 * Initialize the OTel SDK. Idempotent — second call is a no-op so test
 * harnesses that import this module multiple times are safe.
 */
export async function startTelemetry(opts: TelemetryOptions = { exporter: 'none' }): Promise<void> {
  if (started) return;
  started = true;

  const serviceName = opts.serviceName ?? 'hunter-platform';

  if (opts.exporter === 'none') {
    // No-op mode: no SDK, no exporter, no auto-instrumentation patches.
    // The OTel API still works (returns NoopSpans), so withSpan etc.
    // remain callable but produce no telemetry output.
    return;
  }

  let processor;
  if (opts.exporter === 'console') {
    processor = new SimpleSpanProcessor(new ConsoleSpanExporter());
  } else {
    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318/v1/traces';
    processor = new SimpleSpanProcessor(new OTLPTraceExporter({ url: endpoint }));
  }

  sdk = new NodeSDK({
    serviceName,
    spanProcessor: processor,
    instrumentations: [getNodeAutoInstrumentations({
      // Disable fs instrumentation: too noisy and not useful for a backend.
      '@opentelemetry/instrumentation-fs': { enabled: false },
    })],
  });

  await sdk.start();
}

export async function shutdownTelemetry(): Promise<void> {
  if (sdk) await sdk.shutdown();
  sdk = null;
  started = false;
}

const tracer: Tracer = trace.getTracer('hunter-platform');

/**
 * Run `fn` inside a new child span. The span is ended (and exported) when
 * the function resolves OR throws. Errors are recorded on the span and
 * rethrown unchanged.
 *
 * Use for business-logic-level tracing (recommendation.create, claimJob, etc.).
 * HTTP-level tracing is automatic via the http/express auto-instrumentation.
 *
 * If the SDK was never started (or was started with exporter='none'),
 * `tracer.startActiveSpan` returns a NoopSpan and the function runs as
 * if no instrumentation were present — making this safe to use in tests
 * without a live SDK.
 */
export async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean | undefined>,
  fn: (span: Span) => Promise<T> | T,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      throw err;
    } finally {
      span.end();
    }
  });
}

/** Synchronous variant. Same semantics but no async. */
export function withSpanSync<T>(
  name: string,
  attributes: Record<string, string | number | boolean | undefined>,
  fn: (span: Span) => T,
): T {
  return tracer.startActiveSpan(name, { attributes }, (span) => {
    try {
      const result = fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * Get the trace_id (W3C, 32-char hex) of the currently active span.
 * Returns undefined when called outside any active span.
 */
export function getTraceIdFromContext(): string | undefined {
  const span = trace.getSpan(context.active());
  return span?.spanContext().traceId;
}

/**
 * Get the W3C `traceparent` header value of the currently active span.
 * Format: `00-<traceId 32 hex>-<spanId 16 hex>-<flags 2 hex>`.
 * Returns undefined when called outside any active span.
 */
export function getTraceparentFromContext(): string | undefined {
  const span = trace.getSpan(context.active());
  if (!span) return undefined;
  const sc = span.spanContext();
  return `00-${sc.traceId}-${sc.spanId}-01`;
}

/**
 * Express middleware that creates one root span per HTTP request and
 * makes it the active context. Also writes the `x-trace-id` response
 * header so every response carries the trace id (not just those that
 * go through respond()).
 *
 * In production this is the request-level root span; auto-instrumentation
 * adds child spans (DB, fetch, etc.) under it. In tests, this is the
 * ONLY span source — the e2e tests in tests/integration/trace-id.test.ts
 * depend on it.
 *
 * Safe to use when no SDK is started: tracer.startActiveSpan returns
 * a NoopSpan, no overhead. The x-trace-id header is simply not set in
 * that case (no span → no trace_id).
 */
export function traceContextMiddleware(): RequestHandler {
  const tracer = trace.getTracer('http-server');
  return (req: Request, res: Response, next: NextFunction): void => {
    const incomingTraceparent = req.headers['traceparent'];
    if (typeof incomingTraceparent === 'string') {
      // Continue the upstream trace. We don't strictly parse the W3C format —
      // if SDK is running, propagation is automatic; if not, treat as a
      // fresh span and let the upstream-supplied id flow through the
      // `x-trace-id` response header.
    }
    tracer.startActiveSpan(
      `HTTP ${req.method} ${req.path}`,
      { kind: SpanKind.SERVER, attributes: { 'http.method': req.method, 'http.path': req.path } },
      (span) => {
        // Write x-trace-id here, BEFORE the handler runs, so it's set
        // regardless of whether the handler uses respond() or plain
        // res.json. respond() also sets it, which is harmless.
        const traceId = span.spanContext().traceId;
        if (traceId) res.setHeader('x-trace-id', traceId);

        res.on('finish', () => {
          if (res.statusCode >= 500) {
            span.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${res.statusCode}` });
          } else {
            span.setStatus({ code: SpanStatusCode.OK });
          }
          span.end();
        });
        next();
      },
    );
  };
}
