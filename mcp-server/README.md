# Hunter Platform MCP Server

Expose [Hunter Platform](https://qing3.top) (recruiter marketplace API) as **15 AI-callable tools** via the [Model Context Protocol](https://modelcontextprotocol.io/). Works with Claude Desktop, Cursor, Cline, and any MCP-compatible AI client.

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

### Option 1: npm (recommended once published)

```bash
npm install -g @hunter-platform/mcp-server
```

### Option 2: From source

```bash
git clone https://github.com/convo-ai/hunter-platform.git
cd hunter-platform/mcp-server
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
      "args": ["-y", "@hunter-platform/mcp-server"],
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
    "args": ["-y", "@hunter-platform/mcp-server"]
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
      "args": ["-y", "@hunter-platform/mcp-server"],
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

## License

MIT