# OpenAPI Follow-up — Register 5 New Endpoints

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把"猎头代雇主建岗"特性的 5 个新端点登记到 `docs/superpowers/openapi.json`，消除 `pnpm test` 输出的 "5 forward gaps (informational)" 警告，让外部 AI Agent 通过 OpenAPI discovery 能找到这些端点。

**Architecture:** 直接编辑 `openapi.json` 的 `paths` 对象，**追加 4 个新 path entry**（5 个 HTTP method，POST/GET /v1/headhunter/jobs 合并到一个 path entry）。沿用现有 pattern：每个 method 包含 `summary` / `security` / `requestBody` / `parameters` / `responses` 字段，错误响应通过 `$ref` 复用 `components/responses/*` 已有的 schema。不需要新加 `components` 块。

**Tech Stack:** OpenAPI 3.0, JSON。无新依赖。无代码改动（仅配置文件）。

**背景**: `tests/global-setup.ts` 跑 `pnpm openapi:check`（即 `scripts/generate-openapi.ts` 的 `runCheck`）做反向+正向覆盖率检查。当前：`57 declared, 62 scanned, 5 forward gaps`。本任务消除这 5 个 gap。

---

## Conventions

- **路径基准**: 仓库根 `d:\dev\hunter-platform\`
- **OpenAPI 3.0**: 沿用现有 schema (Ok/Err/Unauthorized/Forbidden/NotFound)
- **本项目非 git repo**（环境已知），如未初始化先 `git init` 在根目录

---

## 文件结构总览

```
docs/superpowers/openapi.json  (MODIFY: paths 对象追加 4 个新 path)

scripts/generate-openapi.ts     (UNTOUCHED: 检查脚本)
tests/global-setup.ts          (UNTOUCHED: 调用检查)
```

**没有**新增/修改任何 `.ts` 文件。仅 1 个 `.json` 文件改动 + 验证。

---

## 待登记的 5 个端点（合并到 4 个 path entry）

| Method | Path | 合并到 |
|---|---|---|
| POST | /v1/headhunter/jobs | `/v1/headhunter/jobs` (含 get) |
| GET  | /v1/headhunter/jobs | `/v1/headhunter/jobs` (同 path) |
| GET  | /v1/employer/pending-claims | `/v1/employer/pending-claims` |
| POST | /v1/employer/claim-jobs/{id} | `/v1/employer/claim-jobs/{id}` |
| POST | /v1/employer/reject-jobs/{id} | `/v1/employer/reject-jobs/{id}` |

OpenAPI 中同一 path 下的不同 HTTP method 共享 path key，所以 5 个 method 折合 4 个 path entry。

---

## Phase 1: 编辑 openapi.json

### Task 1.1: 找到 paths 对象的结尾位置

**Files:**
- Modify: `docs/superpowers/openapi.json`

- [ ] **Step 1: 用 grep 找 paths 块结尾**

Run:
```bash
cd d:\dev\hunter-platform
grep -nE '^\s*"/v1/[^"]+":\s*\{' docs/superpowers/openapi.json | tail -3
grep -nE '^\s*\},\s*$|^\s*\}\s*$' docs/superpowers/openapi.json | tail -3
```

Expected: 看到最后一个 path key（如 `/v1/admin/...`）和对应的 `},` 闭合。复制这两个行号备用。

> 注：用 Edit 工具的 `old_string` 匹配时,需要包含**最后一个 path 完整块**的末尾 + 闭合 `}`。

- [ ] **Step 2: 备份**

Run:
```bash
cd d:\dev\hunter-platform
cp docs/superpowers/openapi.json docs/superpowers/openapi.json.bak
```

- [ ] **Step 3: 验证文件可解析**

Run: `cd d:\dev\hunter-platform && node -e "JSON.parse(require('fs').readFileSync('docs/superpowers/openapi.json', 'utf8')); console.log('OK')"`
Expected: `OK`

- [ ] **Step 4: Commit (备份点)**

```bash
cd d:\dev\hunter-platform
git add docs/superpowers/openapi.json.bak
git commit -m "chore(openapi): backup openapi.json before follow-up"
```

---

### Task 1.2: 追加 4 个 path entry

**Files:**
- Modify: `docs/superpowers/openapi.json`

- [ ] **Step 1: 找到最后一个 path entry 的结尾 `},`**

读 openapi.json 找到 path 列表最后一项的 `},` 闭合（例如 `"/v1/admin/...": { ... },` 末尾的 `},`）。

- [ ] **Step 2: 在最后一项的 `},` 之后插入 4 个新 path entry**

用 Edit 工具的 `old_string` 匹配该 `},` 后跟一个**未注册但即将注册**的 path 字符串前缀附近的模式，确保唯一性。最简单：匹配 `    },\n    "/v1/employer/recommendations/{id}/unlock-contact": {` 这种已知 pattern，**追加** 4 个新 entry 到 paths 块中**最末尾**的 `},` 之后。

> 注：OpenAPI path 顺序不影响功能。为简化，**追加到末尾**（最后一个 path entry 的 `},` 之后，下一个 `}` 闭合 paths 块之前）。

**追加内容**（按下面 4 段依次粘贴到 paths 块末尾的 `},` 之后，下一个 `}` 之前）：

```json
    "/v1/headhunter/jobs": {
      "post": {
        "summary": "Create a job on behalf of an employer (headhunter-only)",
        "description": "猎头为雇主建岗。job 入库后 employer_id=NULL, source_headhunter_id=caller, status=open,priority=normal。雇主事后通过 GET /v1/employer/pending-claims + POST /v1/employer/claim-jobs/{id} 认领,或 POST /v1/employer/reject-jobs/{id} 拒绝。扣 caller 的 create_job 配额(5)。",
        "security": [
          {
            "ApiKey": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "title"
                ],
                "properties": {
                  "title": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 200
                  },
                  "description": {
                    "type": "string",
                    "maxLength": 5000
                  },
                  "salary_min": {
                    "type": "integer",
                    "minimum": 1
                  },
                  "salary_max": {
                    "type": "integer",
                    "minimum": 1
                  },
                  "industry": {
                    "type": "string",
                    "maxLength": 100
                  },
                  "deadline": {
                    "type": "string",
                    "format": "date-time"
                  },
                  "priority": {
                    "type": "string",
                    "enum": [
                      "low",
                      "normal",
                      "high",
                      "urgent"
                    ]
                  },
                  "required_skills": {
                    "type": "array",
                    "items": {
                      "type": "string"
                    },
                    "maxItems": 20
                  },
                  "created_for_employer_id": {
                    "type": "string",
                    "description": "Optional. If set, only this employer can claim. If null/omitted, any employer can claim."
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "ok",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Ok"
                }
              }
            }
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          },
          "404": {
            "$ref": "#/components/responses/NotFound"
          },
          "429": {
            "description": "Insufficient quota",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Err"
                }
              }
            }
          }
        }
      },
      "get": {
        "summary": "List jobs created by caller (headhunter-only)",
        "description": "返回 source_headhunter_id=caller 的所有 job(含未认领/已认领/已关闭)。",
        "security": [
          {
            "ApiKey": []
          }
        ],
        "responses": {
          "200": {
            "description": "ok",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Ok"
                }
              }
            }
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          }
        }
      }
    },
    "/v1/employer/pending-claims": {
      "get": {
        "summary": "List pending-claim jobs (employer-only)",
        "description": "返回 status=open AND employer_id IS NULL AND (created_for_employer_id=me OR created_for_employer_id IS NULL) 的 job。未认领的 job 在公开页隐藏,只有创建猎头和被指定的雇主(或任何 employer,当 created_for_employer_id=NULL)能看到。",
        "security": [
          {
            "ApiKey": []
          }
        ],
        "responses": {
          "200": {
            "description": "ok",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Ok"
                }
              }
            }
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          }
        }
      }
    },
    "/v1/employer/claim-jobs/{id}": {
      "post": {
        "summary": "Claim a headhunter-created job (employer-only)",
        "description": "认领成功后 job.employer_id=caller,公开页可见。Idempotent: 同一 employer 重复 claim 自己的 job 返回 200 no-op。已认领给别人的 job 返回 409 INVALID_STATE。无权认领(创建猎头指定了别的雇主)的 job 返回 403 FORBIDDEN。",
        "security": [
          {
            "ApiKey": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "ok",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Ok"
                }
              }
            }
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          },
          "404": {
            "$ref": "#/components/responses/NotFound"
          },
          "409": {
            "description": "Invalid state (job already claimed, closed, or filled)",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Err"
                }
              }
            }
          }
        }
      }
    },
    "/v1/employer/reject-jobs/{id}": {
      "post": {
        "summary": "Reject a pending-claim job (employer-only)",
        "description": "拒绝后 job.status=closed,永久下线。雇主可以传 reason(可选, max 500 字符),记录到 action_history 审计日志。",
        "security": [
          {
            "ApiKey": []
          }
        ],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "requestBody": {
          "required": false,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "reason": {
                    "type": "string",
                    "maxLength": 500
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "ok",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Ok"
                }
              }
            }
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          },
          "404": {
            "$ref": "#/components/responses/NotFound"
          },
          "409": {
            "description": "Invalid state (job already closed or filled)",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Err"
                }
              }
            }
          }
        }
      }
```

> 注：最后一个 entry 末尾的 `},` 是 paths 块内 entry 的闭合。**最后还需要一个 `},` 闭合 paths 块本身**——保留原有即可（不删除）。

- [ ] **Step 3: 验证 JSON 仍可解析**

Run: `cd d:\dev\hunter-platform && node -e "const d=JSON.parse(require('fs').readFileSync('docs/superpowers/openapi.json', 'utf8')); console.log('paths:', Object.keys(d.paths).length, 'OK')"`
Expected: `paths: 61 OK`（从 57 增加到 57+4=61;但 /v1/headhunter/jobs 是新 path,所以 62-1=61 才对，因为 /v1/headhunter/jobs 是新 path,旧文件里没有 /v1/headhunter/jobs,所以 +4 而非 +3. 检查逻辑: 老 57 + 4 新 path entry = 61.）

注: 之前报"5 forward gaps"是因为 routes 里有 5 个 method 没在 spec 里。现在 spec 加 4 个 path 覆盖 5 个 method, 应消除 5 gaps。

- [ ] **Step 4: 验证 path key 数量**

Run: `cd d:\dev\hunter-platform && node -e "const d=JSON.parse(require('fs').readFileSync('docs/superpowers/openapi.json', 'utf8')); for (const p of ['/v1/headhunter/jobs','/v1/employer/pending-claims','/v1/employer/claim-jobs/{id}','/v1/employer/reject-jobs/{id}']) { console.log(p, ':', d.paths[p] ? 'OK' : 'MISSING'); }"`
Expected: 4 行 `OK`

- [ ] **Step 5: Commit**

```bash
cd d:\dev\hunter-platform
git add docs/superpowers/openapi.json
git commit -m "feat(openapi): register 5 new endpoints (headhunter-jobs, employer-claim/reject)"
```

---

## Phase 2: 验证

### Task 2.1: 跑 openapi:check 反向覆盖率（确保没改坏现有 path）

**Files:** (none)

- [ ] **Step 1: 跑检查**

Run: `cd d:\dev\hunter-platform && pnpm openapi:check 2>&1 | tail -20`
Expected:
```
[global-setup] openapi.json ok: 61 declared, 62 scanned, 0 forward gaps (informational).
```
(从 57 → 61 declared,5 forward gaps → 0)

If FAIL: 说明改了某条 path 的 key 让 scanner 找不到,回滚 + 重新编辑。

- [ ] **Step 2: 跑全量测试确认没破**

Run: `cd d:\dev\hunter-platform && pnpm test 2>&1 | tail -8`
Expected:
```
Test Files  101 passed (101)
     Tests  461 passed (461)
```

(测试数量不变,因为只改文档;但确保反向 check 没 fail)

- [ ] **Step 3: 清理备份**

Run: `cd d:\dev\hunter-platform && rm docs/superpowers/openapi.json.bak`
确认:`dir docs\superpowers\openapi.json.bak` → "File Not Found"

- [ ] **Step 4: 清理 commit（如果有）**

```bash
cd d:\dev\hunter-platform
git add -u docs/superpowers/openapi.json.bak
git commit -m "chore(openapi): remove backup file" || echo "no commit needed (not tracked)"
```

---

## Self-Review（执行前核对）

### 1. Spec/Plan 覆盖

| 需求 | 任务 |
|---|---|
| 5 个新端点登记到 openapi.json | Task 1.2 |
| JSON 仍可解析 | Task 1.2 Step 3 |
| 4 个新 path key 存在 | Task 1.2 Step 4 |
| openapi:check 通过（0 forward gaps）| Task 2.1 Step 1 |
| 全量测试不破 | Task 2.1 Step 2 |

### 2. 占位符检查

0 个 TBD / TODO / FIXME

### 3. 风险

| 风险 | 缓解 |
|---|---|
| JSON 解析失败 | Task 1.1 Step 3 验证起点 + Task 1.2 Step 3 验证终点 |
| 改坏 path key | Task 2.1 Step 1 反向 check 兜底,失败回滚到 .bak |
| 字段格式跟现有 entry 不一致 | 字段名严格匹配 src/main/routes/employer.ts 和 headhunter.ts 的 Zod schema |

### 4. 完成判据

- 4 个 path 出现在 openapi.json (`/v1/headhunter/jobs`, `/v1/employer/pending-claims`, `/v1/employer/claim-jobs/{id}`, `/v1/employer/reject-jobs/{id}`)
- `pnpm openapi:check` 输出 `0 forward gaps`
- `pnpm test` 461+ 全 PASS
- .bak 文件已删
