import { ApiClient, AgentContext } from './client';
import { Reporter } from './reporter';
import * as s00 from './scenarios/00-public';
import * as s00b from './scenarios/00b-config';
import * as s01 from './scenarios/01-register';
import * as s02 from './scenarios/02-user-status';
import * as s03 from './scenarios/03-employer-jobs';
import * as s04 from './scenarios/04-headhunter-upload';
import * as s05 from './scenarios/05-headhunter-recommend';
import * as s06 from './scenarios/06-employer-talent';
import * as s07 from './scenarios/07-candidate-approve';
import * as s08 from './scenarios/08-employer-unlock';
import * as s09 from './scenarios/09-employer-placement';
import * as s10 from './scenarios/10-headhunter-withdraw';
import * as s11 from './scenarios/11-candidate-reject';
import * as s12 from './scenarios/12-view-tokens';

interface Scenario { name: string; run: (c: ApiClient, r: Reporter) => Promise<void>; }
const SCENARIOS: Scenario[] = [s00, s01, s00b, s02, s03, s04, s05, s06, s07, s08, s09, s10, s11, s12];

async function main() {
  const baseUrl = process.env.HUNTER_BASE_URL ?? 'http://localhost:3000';
  console.log(`\n🚀 Reference Agent — testing ${baseUrl}\n`);
  console.log(`Coverage: 27 endpoints across 13 scenarios\n`);

  try {
    const probe = await fetch(`${baseUrl}/v1/health`);
    if (!probe.ok) {
      console.error(`❌ Cannot reach ${baseUrl}/v1/health (status ${probe.status})`);
      console.error('   Is the API server running? Start with: pnpm api:dev');
      process.exit(1);
    }
  } catch {
    console.error(`❌ Connection refused to ${baseUrl}`);
    console.error('   Is the API server running? Start with: pnpm api:dev');
    process.exit(1);
  }

  const ctx: AgentContext = { baseUrl, userIds: {}, apiKeys: {}, resources: {} };
  const client = new ApiClient(ctx);
  const reporter = new Reporter();

  for (const scenario of SCENARIOS) {
    try { await scenario.run(client, reporter); }
    catch (e) { console.error(`Scenario crashed: ${(e as Error).message}`); }
  }

  const { passed, failed } = reporter.summary();
  console.log(`\nEndpoint coverage: ${reporter.results.length} endpoints tested\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
