# RHCSA10 VM Automated Grading Specification

_Last updated: 2026-05-16 / **Introduced the grading-assist type (rhcsa_done), promoting the remaining assisted-grading questions to high-accuracy grading**_

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [HTTP API Specification (vmbridge)](#3-http-api-specification-vmbridge)
4. [grader Data Schema](#4-grader-data-schema)
5. [Grading Logic](#5-grading-logic)
6. [scope Policy (live / reboot)](#6-scope-policy-live--reboot)
7. [Macro Expansion (${SSH_B})](#7-macro-expansion-ssh_b)
8. [Grading Flow](#8-grading-flow)
9. [Integration with selfGrade](#9-integration-with-selfgrade)
10. [Security](#10-security)
11. [Error Handling](#11-error-handling)
12. [The 5 Grading Rules (Operational Standards)](#12-the-5-grading-rules-operational-standards)
13. [Current Implementation Scope and Accuracy](#13-current-implementation-scope-and-accuracy)
14. [Known Constraints and Trade-offs](#14-known-constraints-and-trade-offs)
15. [Extension and Improvement Opportunities](#15-extension-and-improvement-opportunities)
16. [Verification Procedure (3-Case Manual Verification)](#16-verification-procedure-3-case-manual-verification)
17. [Related Files List](#17-related-files-list)

---

## 0. Changes in This Version (2026-05-16)

The questions that previously relied on assisted grading (medium accuracy) have been promoted to high-accuracy grading through the introduction of the **grading-assist command `rhcsa_done`**.

How it works:

1. After the learner implements the question on the VM, they run the single line specified in the `[Grading Assist]` section at the end of the question text:
   ```bash
   rhcsa_done t1q22 'ps -eo pid,ni,comm | grep sleep' 'history | tail -20'
   ```
2. This records **state information optimized per question** into `/tmp/.rhcsa_t1q22_done`
3. When you click "Grade on VM" in the browser, the grader `grep`s that file to make its judgment

With this approach, root password reset questions (which previously could only check the mtime of `/etc/shadow`) and process management questions (where traces disappear after a kill) can now obtain a **checkable state trail**.

**Caveats**:
- The grading-assist command is **not needed for the actual exam**. It is exclusively for this app's grading
- If you forget to run the grading-assist command, grading will report "× assist not run" (this is explicit, not a misjudgment)
- The shared shell function is placed at `/usr/local/bin/rhcsa_done` (details in §18)

---

## 1. Overview

### Purpose

A mechanism in the RHCSA10 learning app to **objectively determine** "whether the result the learner implemented on the VM would pass on the exam." In parallel with the subjective ○△× self-grading, it mechanically verifies the actual state of the VM over SSH.

### Problems Solved

- With self-grading, learners cannot be certain whether "their own procedure would pass the exam"
- Marking ○ while looking at the model answer leaves you weak on first-encounter questions in the real exam
- Mock exam scores rely on gut feeling, making pass/fail judgments ambiguous

### Scope

| Range | Content |
|---|---|
| Supported questions | The full private question bank (excluded from this public repo); the published build ships original sample tasks |
| Categories | Covers all 10 official RHCSA objective categories |
| Grading unit | 2 to 12 checks per question |
| Grading method | SSH command execution + exit code judgment |
| Grading mode | Single-question grading / mock-exam VM batch grading |

---

## 2. Architecture

```
┌─────────────────┐    HTTP    ┌──────────────────┐    SSH    ┌─────────────┐
│   Browser        │ ────────▶ │  vmbridge.py     │ ────────▶ │  ServerA    │
│  (Vanilla JS)   │  qid only  │  (Python http)   │  run cmd  │  (192.x.134)│
│  index.html     │ ◀──────── │  127.0.0.1:8770  │ ◀──────── │             │
└─────────────────┘ result JSON│                  │  exit code └──────┬──────┘
                              │                  │                   │ ${SSH_B}
                              │  - token auth     │                   ▼
                              │  - Origin check   │            ┌─────────────┐
                              │  - qid check      │            │  ServerB    │
                              │  - trusted cmd   │            │ (192.x.135) │
                              └──────────────────┘            └─────────────┘
```

### Components

| Component | Role | File |
|---|---|---|
| Browser | UI, sends qid only (cannot send arbitrary commands) | `app/js/bridge.js`, `app/js/grader.js`, `app/js/ui/screens.js` |
| vmbridge.py | Bridges qid → grader.checks → SSH execution | `app/tools/vmbridge.py` |
| manual_overrides.json | The single source of truth for grader.checks (server-side trust) | `app/tools/manual_overrides.json` |
| ServerA | VM grading target (primary) | `192.0.2.10/24` |
| ServerB | Graded over `${SSH_B}` via ServerA | `192.0.2.11/24` |

### Trust Boundaries

- **Browser ↔ vmbridge**: not trusted (authenticated via token + Origin, accepts qid only)
- **vmbridge ↔ VM**: trusted (SSH key authentication, multiplexed connections via ControlMaster)
- **manual_overrides.json**: trusted source (hand-written by humans)

---

## 3. HTTP API Specification (vmbridge)

### Endpoint List

| Method | Path | Purpose |
|---|---|---|
| GET | `/status` | Check the bridge and VM connection status |
| OPTIONS | `/grade` | CORS preflight |
| POST | `/grade` | Run grading |
| OPTIONS | `/chat` | CORS preflight |
| POST | `/chat` | AI chat (Anthropic API streaming) |

### Common Headers

| Header | Purpose |
|---|---|
| `X-RHCSA-Bridge-Token` | Required for `/grade` and `/chat` (a random token generated at startup). Not required for `/status` |
| `Origin` | Validated against an allowlist such as `http://localhost:8765` on all endpoints |
| `Content-Type` | POST is fixed to `application/json` (`/grade` capped at 4096 bytes, `/chat` capped at 32 KB) |

### GET /status (no token required)

```http
GET /status HTTP/1.1
Origin: http://localhost:8765
```

Response:
```json
{
  "ok": true,
  "vm": "reachable",
  "hostname": "server1.example.com",
  "error": "",
  "token": "<token string generated at startup>",
  "chat": true,
  "chatModel": "claude-opus-4-5"
}
```

- `ok`: whether ServerA is reachable over SSH (`true`/`false`)
- `vm`: `"reachable"` or `"unreachable"`
- `hostname`: the result of running the `hostname` command over the SSH connection
- `error`: the SSH error message (empty string if none)
- `token`: the browser stores this and attaches it to the `X-RHCSA-Bridge-Token` header on subsequent `/grade` and `/chat` calls. The bridge includes it in the `/status` response only for a request carrying an allowed `Origin` (server-side gate; CORS is a second layer). Anonymous local callers receive reachability only.
- `chat`: whether anthropic_api_key is configured

> The browser polls `/status` once every 20 seconds. From the response, the browser computes `Bridge.bridgeUp` (whether HTTP 200 was returned) and `Bridge.connected` (the value of `d.ok`) (bridge.js).
> vmbridge is configured to suppress access logs for `/status` (`vmbridge.py:log_message`)

### POST /grade

```http
POST /grade HTTP/1.1
X-RHCSA-Bridge-Token: <token>
Origin: http://localhost:8765
Content-Type: application/json
Content-Length: <length, max 4096>

{
  "questionId": "t2q11",
  "phase": "live"
}
```

Response:
```json
{
  "questionId": "t2q11",
  "phase": "live",
  "results": [
    {"id": "hostname_runtime", "exitCode": 0},
    {"id": "hostname_file", "exitCode": 0}
  ]
}
```

- The request **does not contain any commands** (vmbridge resolves the grader.checks in `manual_overrides.json` from the questionId alone)
- `phase` is `"live"` or `"reboot"`. Currently all grader questions are `"live"` (§6 scope policy)
- A check passes when the response's `results[].exitCode` is 0
- On the browser side, `Grader.score(q, response)` converts `results` into a `perCheck` array (`{id, label, scope, passed, score, earned, exitCode}`) (`app/js/grader.js`)

### Error Responses (as implemented)

| Situation | HTTP | Response |
|---|---|---|
| Origin not on allowlist | 403 | `{"error":"origin not allowed"}` |
| Invalid / missing token header | 403 | `{"error":"invalid bridge token"}` |
| Content-Type is not JSON | 415 | `{"error":"JSON only"}` |
| No body / exceeds 4096 | 400 | `{"error":"bad request body"}` |
| JSON syntax error | 400 | `{"error":"invalid JSON"}` |
| questionId unspecified / unknown | 404 | `{"error":"unknown questionId"}` |
| phase other than live/reboot | 400 | `{"error":"phase must be live or reboot"}` |
| vmbridge.config.json not configured | 503 | `{"error":"VM not configured..."}` |
| SSH execution failed | 502 | `{"error":"VM execution error: ..."}` |

---

## 4. grader Data Schema

### Structure of manual_overrides.json

```json
{
  "overrides": {
    "t2q11": {
      "server": "A",
      "prompt": "...",
      "pitfalls": ["..."],
      "verify": ["..."],
      "autoGradeReady": true,
      "maxScore": 8,
      "grader": {
        "checks": [
          {
            "id": "hostname_runtime",
            "label": "Current hostname is rhel.server.com",
            "cmd": "test \"$(hostname)\" = 'rhel.server.com'",
            "score": 4,
            "scope": "live"
          },
          {
            "id": "hostname_file",
            "label": "Persisted in /etc/hostname",
            "cmd": "grep -qx rhel.server.com /etc/hostname",
            "score": 4,
            "scope": "live"
          }
        ]
      }
    }
  }
}
```

### check Field Definitions

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | ✓ | Unique check identifier (alphanumeric and _) |
| `label` | string | ✓ | Label shown in the UI |
| `cmd` | string | ✓ | Shell command run over SSH |
| `score` | int | ✓ | Points awarded on pass (the sum must equal maxScore) |
| `scope` | string | ✓ | `"live"` (current state) or `"reboot"` (persistence after reboot) |

### Validation (build_data.py:908-930)

- For questions with `autoGradeReady: true`, `grader.checks` is required and must be non-empty
- `cmd` is a non-empty string
- `score` is an integer
- `scope` is either `"live"` or `"reboot"`
- `maxScore == sum(checks.score)` must match exactly

---

## 5. Grading Logic

### Pass/Fail Judgment: unified on "exit code 0 = pass"

vmbridge runs each check's `cmd` over SSH and records only the exit code.

```python
# Script generated by vmbridge.py: build_check_script(checks)
( test "$(hostname)" = 'rhel.server.com' ) >/dev/null 2>&1
printf 'hostname_runtime\t%s\n' $?
( grep -qx rhel.server.com /etc/hostname ) >/dev/null 2>&1
printf 'hostname_file\t%s\n' $?
```

Aggregated on the browser side (`app/js/grader.js:Grader.score()`):

```js
// scored = { earned, max, perCheck, phase }
// perCheck[i] = { id, label, scope, passed, score, earned, exitCode }
{
  earned: 8,                  // sum of scores for passed checks
  max: 8,                     // sum of scores for all checks in this phase
  perCheck: [
    { id: "hostname_runtime", passed: true,  score: 4, earned: 4, exitCode: 0 },
    { id: "hostname_file",    passed: true,  score: 4, earned: 4, exitCode: 0 }
  ],
  phase: "live"
}
```

### Partial Credit

Because each check is judged independently, partial credit is awarded automatically:

- `hostname_runtime` ○ + `hostname_file` × → earned=4, max=8 (50%)
- In mock exams, the actual score is computed as `earned / max * points`

### expect / expectRegex are not used

Since all checks are unified on `exit code 0`, they are built with `grep -q` / `test` / `&&`.

---

## 6. scope Policy (live / reboot)

### Current Implementation

**All grader questions × all checks are unified on `scope: "live"`** (as of 2026-05-16).

> History: only `t1q6.mounted_persist` from the initial implementation remained as `scope: "reboot"`, but following a review finding (P0-3) it was replaced with the live check `findmnt -rn /mylv && grep -qE '[[:space:]]/mylv[[:space:]]' /etc/fstab`. As a result, the "unified on live" claim now fully matches the actual data.

### Rationale

The current VM batch grading only calls `Bridge.grade(qid, "live")`. `Progress.recordAutoGradeAndSync()` judges a question `correct` if the live earned/max is a perfect score.

Adding `scope: "reboot"` would cause the following problems:

1. The question is judged a perfect score by live grading alone, leaving the reboot check unevaluated
2. In mock-exam VM batch grading, the reboot check portion does not count toward the score
3. The `maxScore == sum of checks` validation passes, but the live `scored.max` becomes a subtotal that excludes reboot

### Alternative for Persistence Checks

Substitute with "grep the config file in live":

| What you want to verify | NG (reboot scope) | OK (live + file grep) |
|---|---|---|
| Hostname persistence | `hostname` after reboot | `grep -qx rhel.server.com /etc/hostname` |
| Mount persistence | `findmnt` after reboot | `findmnt -rn /mnt/data && grep -qE '/mnt/data' /etc/fstab` |
| Service auto-start | `systemctl is-active` after reboot | `systemctl is-enabled --quiet httpd` |
| sysctl persistence | `sysctl` after reboot | `grep -E '^net.ipv4.ip_forward[[:space:]]*=' /etc/sysctl.d/*.conf` |
| timer persistence | `systemctl list-timers` after reboot | `systemctl is-enabled --quiet mytimer.timer` |

### Future reboot scope

The reboot scope will be introduced once "combined live earned + reboot earned grading" is implemented. Until then, live is used as a substitute.

---

## 7. Macro Expansion (${SSH_B})

### Purpose

Verifies ServerA → ServerB operations for the supplementary exam set (t7q*) and the test 6 series.

### Expansion Rule (vmbridge.py:179-182)

```python
def expand_macros(cmd, cfg):
    serverb_ssh = cfg.get("serverb_ssh",
        "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new root@server2")
    return cmd.replace("${SSH_B}", serverb_ssh)
```

### Usage Example

```json
{
  "id": "serverb_user_exists",
  "cmd": "${SSH_B} 'id alice'",
  "score": 4,
  "scope": "live"
}
```

Expanded at run time:
```bash
ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new root@server2 'id alice'
```

### Configuration

Can be overridden via the `serverb_ssh` key in `app/tools/vmbridge.config.json`.

---

## 8. Grading Flow

### Single-Question Grading (#q/t2q11 → "Grade on VM" button)

```
1. Browser:   POST /grade {qid: "t2q11", phase: "live"}
2. vmbridge:  retrieves t2q11.grader.checks from manual_overrides.json
3. vmbridge:  consolidates all checks into a single bash -s script
4. vmbridge:  SSH to ServerA (reused via ControlMaster)
5. ServerA:   runs the script, returns each check's exit code as tab-separated
6. vmbridge:  formats into a perCheck array and returns to the browser
7. Browser:   aggregates earned/max via Grader.score(q, result)
8. Browser:   displays ○/× in the autograde-result section
9. Browser:   Progress.recordAutoGradeAndSync(qid, scored)
```

### Mock-Exam VM Batch Grading (#exam-run/... → "Batch-grade on VM and submit")

```
1. Browser:   POST /grade for each task in sequence (80ms apart to avoid VM congestion)
2. Browser:   shows progress in an overlay (X / Y completed)
3. Each task: saves t.vmGrade = { earned, max, perCheck } to the session
4. Browser:   Progress.recordAutoGradeAndSync(t.qid, sc, {ctx: "vm-batch"})
5. After all complete: _completeExam scales points (earned / max * t.points)
6. Browser:   transitions to the examResult screen, shows ○△× in the results table
```

### Fallback for Non-Gradable Questions

| Situation | Behavior |
|---|---|
| autoGradeReady=false | VM grading button hidden, selfGrade only |
| VM not connected | Shows a "bridge not connected" error in autograde-result |
| VM grading failed (SSH error) | Saves `t.vmGradeError = msg`, falls back to selfGrade |
| autoGradeReady=false in mock exam | Adopts selfGrade (counted as gradedVm / skippedSelf) |

---

## 9. Integration with selfGrade

### Public API: `Progress.recordAutoGradeAndSync(qid, scored, opts)`

```js
Progress.recordAutoGradeAndSync = function (qid, scored, opts) {
  this.recordAutoGrade(qid, scored);   // save to q.autoGrade[phase]

  var q = state.questions[qid] || { attemptCount: 0 };
  // respect an existing manual grade (do not overwrite if selfGradeSource !== "vm-auto")
  if (q.selfGrade && q.selfGradeSource !== "vm-auto") return;
  if (!scored.max) return;

  var grade = scored.earned >= scored.max ? "correct"
            : scored.earned > 0          ? "partial"
            :                              "wrong";

  q.selfGrade = grade;
  q.selfGradeSource = "vm-auto";
  q.reviewedAt = new Date().toISOString();
  q.attemptCount = (q.attemptCount || 0) + 1;
  state.log.push({ qid, selfGrade: grade,
    ctx: (opts && opts.ctx) || "vm-auto",
    at: q.reviewedAt });
  persist();
};
```

### Integration Rules

| Case | Behavior |
|---|---|
| First VM grading (perfect score) | selfGrade = "correct", selfGradeSource = "vm-auto" |
| First VM grading (partial credit) | selfGrade = "partial" |
| First VM grading (zero) | selfGrade = "wrong" |
| VM grading after manually marking ○ first | **Respects the manual grade, does not overwrite** |
| Previously "correct" via VM → "partial" on re-grading via VM | **Overwrites** (vm-auto origin can be updated) |

### Structure of the `Progress` Store

```js
state = {
  version: 1,
  questions: {
    "t2q11": {
      selfGrade: "correct",
      selfGradeSource: "vm-auto",   // ← origin
      reviewedAt: "2026-05-16T...",
      attemptCount: 3,
      autoGrade: {
        live:   { earned: 8, max: 8, perCheck: [...], at: "..." },
        reboot: null
      }
    }
  },
  log: [{qid, selfGrade, ctx, at}, ...],   // ctx: "vm-auto" | "vm-batch" | "single" | ...
  exams: [...]
}
```

### UI Reflection

- Home: "VM graded X / N" is updated by `vmGradedCount()`
- Review screen: each card under "Today's tasks" counts the corresponding selfGrade
- Question list: the × / △ / ○ grade symbols are displayed directly

---

## 10. Security

### Defense in Depth

| Layer | Measure |
|---|---|
| Bind | 127.0.0.1 only (not exposed to the LAN) |
| Authentication | A random token generated at startup (a URL-safe string derived from `secrets.token_urlsafe(24)`) |
| Origin validation | A whitelist such as `http://localhost:8765` (`vmbridge.py:_origin_allowed`) |
| token distribution | Included in the `/status` response only for a request carrying an allowed `Origin` (server-side gate; CORS is a second layer). Anonymous local callers (e.g. `curl` with no `Origin`) get reachability only |
| Request size | `/grade` 4096 bytes, `/chat` 32 KB |
| Input validation | Checks whether `questionId` is registered in manual_overrides |
| Trusted Command Pattern | **The browser sends only the questionId; commands are referenced solely from the server-side manual_overrides.json** |
| SSH | Key authentication + ControlMaster + BatchMode=yes |

### The Trusted Command Pattern Is Paramount

- Even if `cmd: "rm -rf /"` were sent from the browser via XSS, vmbridge **never looks at the command field**
- vmbridge resolves the qid against manual_overrides.json and runs only the hard-coded check.cmd
- This blocks the attack path of "executing arbitrary commands on the VM from the browser"

### Files Requiring Careful Handling

- `vmbridge.config.json` (anthropic_api_key, SSH private key path) → already in `.gitignore`
- `~/.ssh/rhcsa_vm` (SSH private key) → of course in `.gitignore`

---

## 11. Error Handling

### On the vmbridge Side (as implemented)

| Error | HTTP | Response | Handling |
|---|---|---|---|
| Invalid Origin | 403 | `origin not allowed` | "Unauthenticated" shown in the browser |
| Invalid token | 403 | `invalid bridge token` | "Unauthenticated" shown in the browser |
| Content-Type violation | 415 | `JSON only` | Normally does not occur (fixed by bridge.js) |
| Empty body / size exceeded | 400 | `bad request body` | "Invalid request" shown in the browser |
| JSON syntax error | 400 | `invalid JSON` | Same as above |
| questionId not registered | **404** | `unknown questionId` | "Not a grading target" shown in the browser |
| Invalid phase | 400 | `phase must be live or reboot` | Normally does not occur (fixed by bridge.js) |
| vmbridge.config.json not configured | 503 | `VM not configured...` | "VM not configured" shown in the browser |
| SSH connection failed / execution error | 502 | `VM execution error: ...` | "VM unreachable" shown in the browser |

### On the Browser Side

| Error | Behavior |
|---|---|
| VM grading failed (single question) | Shows "Grading error: ..." in `autograde-result` |
| VM grading failed (mock exam) | Saves to `t.vmGradeError`, falls back to selfGrade, shows a "⚠ VM failed" badge on the results screen |
| Bridge not running | "● VM not connected" at the top-right of the header, autograde button disabled |

### Individual check Failures

Because each check is scored independently, one failure does not affect the others:

```
check1: exit 0 → earned += score1
check2: exit 1 → no addition to earned
check3: exit 0 → earned += score3
```

---

## 12. The 5 Grading Rules (Operational Standards)

Always follow these when writing a new grader.

### Rule 1: Inspect the final state, not the command

```bash
# Bad example
grep -q "lvcreate" ~/.bash_history

# Good example
lvs myvg/mylv
blkid -s TYPE -o value /dev/myvg/mylv | grep -qx ext4
findmnt -rn /mnt/data
```

### Rule 2: Do not finish a persistence check with grep alone (AND condition)

```bash
# Written in fstab but cannot mount → mark as failed
findmnt -rn /mnt/data >/dev/null && \
  grep -Eq '[[:space:]]/mnt/data[[:space:]]' /etc/fstab
```

### Rule 3: Allow alternative solutions (UUID / LABEL / device path)

```bash
# Bad example: only pass UUID specification
grep -E '^UUID=[0-9a-f-]+[[:space:]]+/mnt/data' /etc/fstab

# Good example: OK as long as the mount succeeds
findmnt -rn /mnt/data
```

### Rule 4: Make partial credit granular (aim for at least 3 checks)

One check per question is forbidden. Split into at least 3 checks to make "how far you got it right" visible.

```json
[
  { "id": "pv_exists",         "score": 3 },
  { "id": "vg_exists",         "score": 3 },
  { "id": "lv_size",           "score": 4 },
  { "id": "fs_type",           "score": 3 },
  { "id": "mounted",           "score": 3 },
  { "id": "persistent_config", "score": 4 }
]
```

### Rule 5: 3-case manual verification (required before setting autoGradeReady=true)

| Case | Operation | Expected |
|---|---|---|
| Not done | Right after snapshot | earned is 0 or a low score |
| Model answer | Implement exactly per the model answer | earned == maxScore (perfect score) |
| Representative wrong answer | Mounted but not listed in fstab, user created but forgot UID specification, etc. | Partial credit |

---

## 13. Current Implementation Scope and Accuracy

### Public build vs. full question bank

This repository is published **code-only**: it ships a small set of **original sample tasks** so the
grading pipeline stays explorable. The full question bank — its exact question counts, per-category
breakdown, per-question accuracy classes, and the `graderQuality` audit list — is derived from
third-party paid materials and is **part of the excluded private data**, so those figures are not
reproduced here.

Each grader question carries a `"graderQuality": "A" | "B"` field in `manual_overrides.json`, which
`build_data.py` propagates into `questions.js`; this lets a reviewer mechanically check the accuracy
class of any question that is present. Accuracy is reported in two tiers — high-accuracy checks and
assisted-grading (`rhcsa_done`) checks — so the reliability of each question is explicit rather than
implied by a single coverage number.

---

## 14. Known Constraints and Trade-offs

### Constraints

1. **reboot scope not used**: Substituted with live + config-file grep. Genuine post-reboot behavior requires separate manual verification
2. **SSH disconnection risk**: Network-changing operations (t2q3 nmcli, etc.) may drop the SSH connection during grading. Checks are limited mainly to reading the configuration
3. **rsyslog priority judgment**: Only picks up the string "debug" via string matching. The actual log output is not verified
4. **Interactive scripts (t3q12)**: Assumes feeding input to stdin. Cannot handle complex interactions
5. **TuneD composite profile**: Only confirms "some profile is active." A check for the specific profile name is omitted

### Trade-offs

| Choice | Reason for Adoption | Cost |
|---|---|---|
| Unified exit code | Script generation is simple, easy to allow alternative solutions | Cannot judge "fine differences in expected values" |
| Unified live | Completes in a single SSH, evaluated in mock exams | Does not guarantee true persistence (post-reboot behavior) |
| Support for the full question bank | The learning flow completes for every question | Assisted-grading questions have lower accuracy and may misjudge |
| Bridge accepts qid only | Prevents arbitrary command execution via the XSS path | The grader must be consolidated server-side |

---

## 15. Extension and Improvement Opportunities

### Short-term (1-2 days)

- Run the 3-case verification on the assisted-grading questions in sequence, fix misjudgments, and promote to high-accuracy grading
- root password reset type: add a "new password usage count" check via `passwd -S root` + `chage -l root` (improves accuracy)
- TuneD: add a check for the specific profile name (improves accuracy)

### Medium-term (1-2 weeks)

- Official adoption of the reboot scope: implement a two-phase mode that runs `(qid, "reboot")` after `Bridge.grade(qid, "live")`
- Introduce expect / expectRegex fields: support judgment methods other than exit code
- grader test feature: a script that auto-reproduces the 3 cases "not done / model answer / wrong answer"
- Graph the grading history (autoGrade.live[].at) (improvement curve)

### Long-term

- A full test mechanism for each question: "snapshot revert + auto-apply model answer + grade"
- Double-check against AI grading (compare the grader's score vs Claude's score to detect deviation)
- Grader DSL: make graders easier to write with not just JSON but YAML or shell functions

---

## 16. Verification Procedure (3-Case Manual Verification)

### Required for Each grader

#### Case 1: Not Done

1. Revert the VM to the clean-base snapshot
2. Click "Grade on VM" on the question screen (without doing anything)
3. **Expected**: earned is 0 or very low (false positive check)

#### Case 2: Model Answer

1. Revert the VM to the clean-base snapshot
2. Implement on the VM exactly per the model answer
3. Click "Grade on VM" on the question screen
4. **Expected**: earned == maxScore (perfect score) (false negative check)

#### Case 3: Representative Wrong Answer

1. Revert the VM to the clean-base snapshot
2. Intentionally introduce a single error within the model answer:
   - Mounted but not listed in fstab
   - User created but forgot UID specification
   - Service active but forgot to enable
3. Click "Grade on VM" on the question screen
4. **Expected**: earned is partial credit (neither 0 nor a perfect score)

### If Any of the 3 Cases Differs from Expectation

1. Fix the `grader.checks` for the relevant qid in `manual_overrides.json`
2. Re-run `python3 app/tools/build_data.py`
3. Hard-reload in the browser (Cmd+Shift+R)
4. Re-run the 3 cases

### Batch Verification (build_data.py)

```bash
python3 app/tools/build_data.py
# Expected:
#   Total questions      : <N>
#   Auto-grading support : <N>
#   Zero ERRORs
```

---

## 17. Related Files List

### Critical Paths (high change frequency)

| File | Role |
|---|---|
| `app/tools/manual_overrides.json` | The single source of truth for grader.checks |
| `app/tools/build_data.py` | Generates questions.js by applying manual_overrides |
| `app/tools/vmbridge.py` | HTTP API, SSH execution, check consolidation |
| `app/tools/vmbridge.config.json` | bridge configuration (SSH connection info, API key) |
| **`app/tools/rhcsa_done.sh`** | **Grading-assist shell function (placed at each VM's `/usr/local/bin/rhcsa_done`)** |

### On the Browser Side

| File | Role |
|---|---|
| `app/js/bridge.js` | vmbridge HTTP client |
| `app/js/grader.js` | Score aggregation of bridge results (`Grader.score()`) |
| `app/js/ui/progress.js` | Progress.recordAutoGradeAndSync |
| `app/js/ui/screens.js` | autograde-result UI, mock-exam VM batch grading UI |
| `app/js/main.js` | `_vmBatchGrade` mock-exam VM batch grading flow |

### Generated Artifacts (do not edit)

| File | Description |
|---|---|
| `app/js/data/questions.js` | Generated by build_data.py. The full data for every question in the bank |
| `app/js/data/exams.js` | Data for the 4 mock exams |
| `app/js/data/guides.js` | Study guides (with links to related questions) |

### Documentation

| File | Description |
|---|---|
| `README.md` | Overall project, quick start, VM snapshot operations |
| `app/SETUP-vmbridge.md` | Detailed vmbridge setup |
| **`VM_GRADING_SPEC.md`** | **This specification** |

> The per-question accuracy-class audit list (the basis for `graderQuality`) is generated alongside
> the full question bank and is part of the excluded private data; it is not included in this
> public, code-only repository.

---

## Appendix A: grader Template Collection (common patterns)

> All checks are unified on `scope: "live"`. Write "persistence checks" in live with an AND condition of config-file grep + current state (see §6).

```bash
# File/directory existence
test -f /path
test -d /path
test -e /path

# User/group existence
id alice
getent group developers

# Permissions
test "$(stat -c %a /path)" = "750"

# SGID / Sticky bit
test "$(stat -c %A /path | cut -c7)" = 's'    # SGID
test "$(stat -c %A /path | cut -c10)" = 't'   # Sticky

# LVM
lvs --noheadings -o lv_name vg/lv | grep -q lv
s=$(lvs --noheadings --units m --nosuffix -o lv_size vg/lv | tr -d ' ' | cut -d. -f1)
test "$s" -ge 1000

# FS type
blkid -s TYPE -o value /dev/x | grep -qx xfs

# Mount
findmnt -rn /mnt/data
findmnt -rn -t ext4 /mnt/data

# fstab entry (persisted via UUID)
grep -qE '^[[:space:]]*UUID=[0-9a-fA-F-]+[[:space:]]+/mnt/data[[:space:]]+ext4' /etc/fstab

# Service
systemctl is-active --quiet httpd
systemctl is-enabled --quiet httpd

# SELinux
test "$(getenforce)" = 'Enforcing'
grep -qE '^[[:space:]]*SELINUX=enforcing' /etc/selinux/config
getsebool httpd_can_network_connect | grep -q ' on$'
ls -Zd /web | grep -q httpd_sys_content_t

# firewall
firewall-cmd --permanent --list-services | tr ' ' '\n' | grep -wq http
firewall-cmd --permanent --list-ports | tr ' ' '\n' | grep -wq '82/tcp'

# sysctl
test "$(sysctl -n net.ipv4.ip_forward)" = '1'
grep -qE '^[[:space:]]*net\.ipv4\.ip_forward[[:space:]]*=[[:space:]]*1' /etc/sysctl.d/*.conf

# Hostname
test "$(hostname)" = 'rhel.server.com'
grep -qx rhel.server.com /etc/hostname

# Chrony
systemctl is-active --quiet chronyd
grep -qE '^(pool|server)[[:space:]]+[a-zA-Z]' /etc/chrony.conf

# Shell script output
bash /path/script arg | grep -qx 'expected'

# Via ServerB
${SSH_B} 'test -f /tmp/foo'
${SSH_B} 'id alice'

# crontab
crontab -u root -l | grep -E '^[[:space:]]*45[[:space:]]+0[[:space:]]'

# at command
test "$(atq | wc -l)" -ge 1
```

## Appendix B: Review Checklist

Points to check when reviewing the spec:

- [ ] Does `maxScore == sum(checks.score)` hold for every grader question?
- [ ] **Are all checks `scope: "live"` (intentionally unified on live this round, keeping reboot at 0)?**
- [ ] Is the `graderQuality` field assigned to every grader question?
- [ ] **Is the API request key named `questionId` (not `qid`), and the response key `results` (not `perCheck`)?**
- [ ] Does `/status` require no token to call, while `/grade` and `/chat` require one — and is the token returned by `/status` only to an allowed `Origin`?
- [ ] Are the HTTP error codes as implemented (403/404/415/400/502/503)?
- [ ] Are the low-accuracy question types (e.g. root password reset, legacy ACL/VDO/Thin) within their acceptable accuracy range?
- [ ] Do checks that use ServerB use the `${SSH_B}` macro (not writing `ssh root@server2` directly)?
- [ ] Is the Trusted Command Pattern upheld (vmbridge never accepts a cmd from the browser)?
- [ ] Are the existing overrides in manual_overrides.json (server, pitfalls, prompt, verify) left intact?
- [ ] Does `python3 app/tools/build_data.py` report the question/auto-grading totals and per-accuracy-class counts without errors?
- [ ] Is the selfGrade integration "respect the manual grade + vm-auto can be updated"?
- [ ] Does the mock-exam VM batch grading include an 80ms-interval sleep (to avoid VM congestion)?
