#!/usr/bin/env node
/**
 * Production verification: starts the installed MCP server, calls
 * auth_register via tools/call, prints the result.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const SERVER = '/tmp/mcp-remote-test/node_modules/@qing3a/hunter-platform-mcp/out/index.js';
const child = spawn('node', [SERVER], { stdio: ['pipe', 'pipe', 'pipe'] });

let stderr = '';
child.stderr.on('data', d => stderr += d.toString());

let buf = '';
child.stdout.on('data', d => {
  buf += d.toString();
  const lines = buf.split('\n'); buf = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      // tools/list result
      if (msg.id === 2 && msg.result?.tools) {
        console.log('✓ Listed', msg.result.tools.length, 'tools');
      }
      // tools/call result
      if (msg.id === 3) {
        if (msg.result?.content) {
          const txt = msg.result.content[0].text;
          console.log('✓ auth_register response:');
          console.log(txt);
        } else {
          console.log('✗ tool call error:', JSON.stringify(msg.error ?? msg.result));
        }
        child.stdin.end();
        process.exit(0);
      }
    } catch { /* ignore */ }
  }
});

child.on('exit', c => {
  console.log('--- stderr ---');
  console.log(stderr.slice(0, 500));
  process.exit(c ?? 0);
});

setTimeout(() => {
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'prod-verify',version:'1'}}}) + '\n');
  setTimeout(() => {
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'}) + '\n');
    setTimeout(() => {
      // List tools
      child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list',params:{}}) + '\n');
      setTimeout(() => {
        // Call auth_register — uses prod API by default
        child.stdin.write(JSON.stringify({
          jsonrpc:'2.0',id:3,method:'tools/call',
          params:{name:'auth_register',arguments:{
            user_type:'employer',
            name:`prod-mcp-test-${Date.now()}`,
            contact:`prod-${Date.now()}@mcp.test`,
          }},
        }) + '\n');
        setTimeout(() => child.stdin.end(), 2000);
      }, 200);
    }, 200);
  }, 200);
}, 200);
