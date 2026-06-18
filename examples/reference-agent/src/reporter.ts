export interface EndpointResult {
  name: string;
  method: string;
  path: string;
  status: number;
  ok: boolean;
  expected?: number | number[];
  error?: string;
}

export class Reporter {
  results: EndpointResult[] = [];

  record(r: EndpointResult): void {
    this.results.push(r);
    const tag = r.ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
    const expected = r.expected !== undefined ? ` (expected ${JSON.stringify(r.expected)})` : '';
    const errMsg = r.error ? ` — ${r.error}` : '';
    console.log(`  ${tag} ${r.method.padEnd(6)} ${r.path.padEnd(50)} → ${r.status}${expected}${errMsg}`);
  }

  startScenario(name: string): void {
    console.log(`\n\x1b[1m--- ${name} ---\x1b[0m`);
  }

  summary(): { passed: number; failed: number } {
    const passed = this.results.filter(r => r.ok).length;
    const failed = this.results.length - passed;
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Summary: ${passed}/${this.results.length} passed, ${failed} failed`);
    if (failed > 0) {
      console.log('\nFailures:');
      this.results.filter(r => !r.ok).forEach(r => {
        console.log(`  - ${r.method} ${r.path} (status ${r.status})${r.error ? `: ${r.error}` : ''}`);
      });
    }
    return { passed, failed };
  }
}
