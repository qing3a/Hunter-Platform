// Unit tests for src/main/telemetry.ts — covers withSpan and trace_id
// helpers. The SDK itself (NodeSDK, exporters) is exercised in the
// integration tests under tests/integration/trace-id.test.ts where the
// full request lifecycle is available.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { trace } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';

let sdk: NodeSDK;
let exporter: InMemorySpanExporter;

beforeAll(async () => {
  exporter = new InMemorySpanExporter();
  sdk = new NodeSDK({
    serviceName: 'hunter-platform-test',
    spanProcessor: new SimpleSpanProcessor(exporter),
  });
  await sdk.start();
});

afterAll(async () => {
  await sdk.shutdown();
});

describe('telemetry helpers', () => {
  it('withSpanSync returns the function result and creates a span', async () => {
    const { withSpanSync } = await import('../../src/main/telemetry');
    const result = withSpanSync('test.op', { foo: 'bar' }, () => 42);
    expect(result).toBe(42);
    // Span was exported
    const spans = exporter.getFinishedSpans();
    const last = spans[spans.length - 1];
    expect(last.name).toBe('test.op');
  });

  it('withSpanSync records attributes on the span', async () => {
    const { withSpanSync } = await import('../../src/main/telemetry');
    withSpanSync('test.attrs', { kind: 'a', count: 7 }, () => 1);
    const spans = exporter.getFinishedSpans();
    const last = spans[spans.length - 1];
    expect(last.attributes).toMatchObject({ kind: 'a', count: 7 });
  });

  it('getTraceIdFromContext returns a 32-char hex string inside withSpanSync', async () => {
    const { withSpanSync, getTraceIdFromContext } = await import('../../src/main/telemetry');
    let tid: string | undefined;
    withSpanSync('test.tid', {}, () => {
      tid = getTraceIdFromContext();
    });
    expect(tid).toMatch(/^[0-9a-f]{32}$/);
  });

  it('getTraceparentFromContext returns W3C-format traceparent', async () => {
    const { withSpanSync, getTraceparentFromContext } = await import('../../src/main/telemetry');
    let tp: string | undefined;
    withSpanSync('test.tp', {}, () => {
      tp = getTraceparentFromContext();
    });
    expect(tp).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/);
  });

  it('errors thrown inside withSpan are rethrown and span records the error', async () => {
    const { withSpan } = await import('../../src/main/telemetry');
    await expect(
      withSpan('test.err', {}, async () => { throw new Error('boom'); })
    ).rejects.toThrow('boom');
  });
});
