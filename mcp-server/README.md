# Hunter Platform MCP Server

Expose [Hunter Platform](https://qing3.top) (recruiter marketplace API) as **15 of 46 platform capabilities** as AI-callable tools via the [Model Context Protocol](https://modelcontextprotocol.io/). Works with Claude Desktop, Cursor, Cline, and any MCP-compatible AI client. For full coverage, see [the HTTP API](https://qing3.top/v1/skill.md) directly.

## What you get

After installing, your AI agent can directly call these tools:

| Role | Tool | Purpose |
|------|------|---------|
| **Auth** | `auth_register` | Create a new account (candidate / headhunter / employer) |
| **Auth** | `auth_rotate_key` | Rotate api_key (old key invalidated immediately) |
| **User** | `users_get_status` | Check quota, role, reputation |
| **User** | `users_get_history` | See recent actions |
| **Headhunter** | `headhunter_upload_candidate` | Upload resume (auto-desensitized) |
| **Headhunter** | `headhunter_recommend_candidate` | Recommend candidate to a job |
| **Headhunter** | `headhunter_list_candidates` | List my uploaded candidates |
| **Headhunter** | `headhunter_list_recommendations` | List my recommendations |
| **Employer** | `employer_post_job` | Create a JD |
| **Employer** | `employer_list_talent` | Browse public talent pool (7 query params) |
| **Employer** | `employer_express_interest` | Step 2 of unlock flow |
| **Employer** | `employer_unlock_contact` | Step 4 of unlock flow |
| **Candidate** | `candidate_view_opportunities` | List pending unlock requests |
| **Candidate** | `candidate_approve_unlock` | Step 3 of unlock flow |
| **Candidate** | `candidate_reject_unlock` | Reject unlock |

## Install

### Quick install (Claude Desktop 1.0+, one command)

```bash
claude mcp add hunter-platform -- npx -y @qing3a/hunter-platform-mcp --env HUNTER_PLATFORM_BASE_URL=https://qing3.top
```

Restart Claude Desktop. The 15 `hunter_platform_*` tools will appear in your tool list.

For other MCP clients (Cursor, Cline, etc.) or older Claude Desktop versions, use Option 1 or 2 below.

### Option 1: npm from GitHub Packages (recommended, private)

```bash
# One-time: configure npm to authenticate to GitHub Packages
cat > ~/.npmrc << 'EOF'
@qing3a:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=YOUR_GITHUB_PAT_HERE
EOF
chmod 600 ~/.npmrc

# Install
npm install -g @qing3a/hunter-platform-mcp
# Or run directly without installing:
npx -y @qing3a/hunter-platform-mcp
```

> **Note**: The `_authToken` must be a GitHub PAT with `read:packages` scope (or a fine-grained token with `Packages: Read` on the `Hunter-Platform` repository). For publishers, `write:packages` is also required.

### Option 2: From source

```bash
git clone https://github.com/qing3a/Hunter-Platform.git
cd Hunter-Platform/mcp-server
npm install
npm run build
```

## Configuration

Add the MCP server to your AI client. Pick your platform:

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "hunter-platform": {
      "command": "npx",
      "args": ["-y", "@qing3a/hunter-platform-mcp"],
      "env": {
        "HUNTER_PLATFORM_BASE_URL": "https://qing3.top"
      }
    }
  }
}
```

Or, if installed from source:

```json
{
  "mcpServers": {
    "hunter-platform": {
      "command": "node",
      "args": ["C:/path/to/hunter-platform/mcp-server/out/index.js"]
    }
  }
}
```

Restart Claude Desktop. The 15 `hunter_platform_*` tools will appear in your tool list.

### Cursor

Settings → MCP → Add new global MCP server:

```json
{
  "hunter-platform": {
    "command": "npx",
    "args": ["-y", "@qing3a/hunter-platform-mcp"]
  }
}
```

### Cline (VSCode extension)

Cline MCP settings file (`~/Documents/Cline/MCP/cline_mcp_settings.json` on Windows):

```json
{
  "mcpServers": {
    "hunter-platform": {
      "command": "npx",
      "args": ["-y", "@qing3a/hunter-platform-mcp"],
      "alwaysAllow": []
    }
  }
}
```

## First-time setup

After installing, ask your AI:

> "Use hunter_platform_auth_register to create an employer account. Name: ACME Corp, contact: hr@acme.com"

The agent will call `auth_register`. The api_key is saved to `~/.hunter-platform/credentials.json` (mode 0600) and used by all subsequent tool calls automatically.

You can verify the saved credentials:

```bash
cat ~/.hunter-platform/credentials.json
# {"api_key":"hp_live_xxx","user_id":"user_xxx","user_type":"employer","base_url":"https://qing3.top"}
```

## How auth resolution works

The api_key is looked up in this priority order:

1. `api_key` argument passed to the tool call (per-call override)
2. `HUNTER_PLATFORM_API_KEY` environment variable
3. `~/.hunter-platform/credentials.json` (written by `auth_register` / `auth_rotate_key`)

The base URL resolution is the same priority chain, with `https://qing3.top` as default.

Override the credentials file location with `HUNTER_PLATFORM_CREDENTIALS_FILE=/some/path/credentials.json`.

## Example conversation

After installing, this conversation "just works":

> **You**: "I need to find a senior frontend engineer. Help me post a job and search the talent pool."
>
> **AI**: "I'll use `employer_post_job` to create the JD. What salary range and required skills?"
>
> **You**: "60-80万, React + TypeScript"
>
> **AI**: *[calls `employer_post_job`]* "Posted! Now let me search the talent pool..." *[calls `employer_list_talent`]*
>
> **AI**: "Found 5 candidates matching. The most experienced one is candidate `ca_34f4d206`. They have a 7-day view_url you can preview."

## State machine

The 4-step unlock flow is exposed across 3 tools (each tool advances one transition):

```
pending ──[employer_express_interest]──▶ employer_interested
                                              │
                  [candidate_approve_unlock]──┤
                                              ▼
                                   candidate_approved
                                              │
                  [employer_unlock_contact]──┤
                                              ▼
                                          unlocked
```

Skipping a step returns `409 INVALID_STATE`.

## Development

```bash
# Run tests (hits production API at https://qing3.top)
npm test

# Run with tsx (live reload)
npm run dev

# Build to out/
npm run build

# Type-check
npm run typecheck

# Run server (after build)
npm start
```

## Not yet exposed

These capabilities exist on the Hunter Platform API but are intentionally NOT exposed as MCP tools:

- **Admin API** (`/v1/admin/*`) — requires separate admin auth (bcrypt), not for end-user agents
- **Webhook delivery** (`deliver_contact` etc.) — MCP is request/response; webhooks require the agent to run a separate HTTP server. Document your `agent_endpoint` at registration time to receive webhooks.
- **GDPR data export / delete** — privacy-sensitive, should be triggered explicitly by humans, not AI agents
- **Browse internal lists (e.g. `headhunter_pending_claims`)** — niche workflows

Add these by following the pattern in `src/tools/*.ts`.

## Deployment

The MCP server is a **client-side** package — it runs on the same machine as the AI client (Claude Desktop, Cursor, etc.), not on the Hunter Platform server. The Hunter Platform API (qing3.top) does not need to be modified for MCP to work.

### Architecture

```
┌──────────────┐  stdio/MCP   ┌──────────────────┐  HTTPS/REST   ┌─────────────────┐
│  AI Client   │◄────────────►│ MCP server (this) │◄─────────────►│  Hunter Platform │
│ (Claude etc) │              │  + ~/.hunter-     │               │   API (qing3.top)│
└──────────────┘              │    platform/      │               └─────────────────┘
                              │    credentials    │
                              └──────────────────┘
```

### Server-side install (optional — for verification / automation)

You can install the MCP server on the Hunter Platform server itself to use it in scripts (e.g., to register candidates, post jobs) without an AI client. Verified working on Node 22.11.0:

```bash
# On the Hunter Platform server (after configuring ~/.npmrc per Option 1)
mkdir -p /opt/mcp-runtime
cd /opt/mcp-runtime
npm install @qing3a/hunter-platform-mcp
node node_modules/@qing3a/hunter-platform-mcp/out/index.js  # starts stdio MCP server
```

After `auth_register`, the api_key is persisted to `/root/.hunter-platform/credentials.json` (mode 0600) on the server and is used for all subsequent calls.

## Breaking Changes

### v0.1.3 — `headhunter_upload_candidate` requires `current_company`

Starting v0.1.3, the `headhunter_upload_candidate` tool **requires** the `current_company` parameter.
The Hunter Platform API returns HTTP 400 with `INVALID_PARAMS` if `current_company` is missing, null, or empty string.

**Migration**: ensure your agent always passes `current_company` when uploading candidates.

```typescript
// v0.1.2 and earlier (worked without current_company)
headhunter_upload_candidate({ candidate_user_id, name, phone, email });

// v0.1.3 (REQUIRED)
headhunter_upload_candidate({ candidate_user_id, name, phone, email, current_company: '字节跳动' });
```

## License

MIT