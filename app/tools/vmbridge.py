#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
vmbridge.py — RHCSA10 exam practice / SSH bridge (relay program for automated grading)

Receives HTTP requests from the browser (http://localhost:8765), runs "verification
commands" on the real RHEL 10 VM over SSH, and returns the results.

Design (conforms to MVP design document §6):
  - The browser only sends questionId. This script resolves the command to run
    from the "trusted grader definitions" in manual_overrides.json
    (it never accepts arbitrary commands from the browser).
  - Binds to 127.0.0.1 only. Issues a random token at startup.
  - CORS allows only allowed_origins. POST accepts JSON only. Validates Origin.
  - SSH is multiplexed with ControlMaster (only the first connection has cost,
    subsequent ones are reused).
  - grader.checks are read-only in principle. State-changing operations are reserved
    for the future /reset and /reboot only.

Usage:
  1. Copy vmbridge.config.example.json to vmbridge.config.json and edit it
  2. python3 app/tools/vmbridge.py
  3. Open http://localhost:8765/index.html

Python 3 standard library only.
"""

import json
import os
import secrets
import shlex
import ssl
import subprocess
import sys
import tempfile
import threading
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.path.dirname(TOOLS_DIR)
CONFIG_PATH = os.path.join(TOOLS_DIR, "vmbridge.config.json")
OVERRIDES_PATH = os.path.join(TOOLS_DIR, "manual_overrides.json")
CONTROL_PATH = os.path.join(tempfile.gettempdir(), "rhcsa_vmbridge_ssh.sock")

DEFAULT_ORIGINS = ["http://localhost:8765", "http://127.0.0.1:8765"]

# Token issued only once at startup (used to authenticate /grade)
TOKEN = secrets.token_urlsafe(24)


# ---------------------------------------------------------------------------
# Loading config and grader definitions
# ---------------------------------------------------------------------------
def load_config():
    """Read vmbridge.config.json. Returns None if it does not exist (/status returns ok:false)."""
    if not os.path.exists(CONFIG_PATH):
        return None, "vmbridge.config.json is missing (please copy vmbridge.config.example.json and edit it)"
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            cfg = json.load(f)
    except json.JSONDecodeError as e:
        return None, "Invalid JSON in vmbridge.config.json: %s" % e
    for key in ("ssh_host", "ssh_user", "ssh_key"):
        if not cfg.get(key):
            return None, "vmbridge.config.json is missing %s" % key
    cfg.setdefault("ssh_port", 22)
    cfg.setdefault("bridge_port", 8770)
    cfg.setdefault("allowed_origins", DEFAULT_ORIGINS)
    # Macro for the "ssh command to ServerB" that runs on ServerA.
    # ${SSH_B} in grader.checks[].cmd expands to this. Used for multi-VM exams
    # like the supplementary exam set, when judging ServerB via ServerA.
    cfg.setdefault(
        "serverb_ssh",
        # SSH to ServerB executed from within ServerA. By multiplexing with ControlMaster,
        # consecutive calls within the same script (multiple checks) are consolidated into one connection.
        "ssh -o BatchMode=yes -o StrictHostKeyChecking=no -o ConnectTimeout=5"
        " -o ControlMaster=auto -o ControlPath=/tmp/rhcsa_ssh_b_%C.sock"
        " -o ControlPersist=60 root@192.0.2.11",
    )
    # AI question chat (optional). /chat is enabled if anthropic_api_key is set.
    cfg.setdefault("anthropic_api_key", "")
    cfg.setdefault("anthropic_model", "claude-haiku-4-5")
    cfg["ssh_key"] = os.path.expanduser(cfg["ssh_key"])
    return cfg, None


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------
class GradeError(Exception):
    """Raised when run_grade could not return a "checks array".
    Returned as a 502 on the do_POST side."""


def load_graders():
    """Return the "trusted grader definitions" from manual_overrides.json as
    { qid: { checks: [...], helperCmds: [...] } }.
    helperCmds are automatically run on the VM first during grading as `rhcsa_done <qid> '<cmd1>' ...`.
    This generates /tmp/.rhcsa_<qid>_done without the user having to run rhcsa_done by hand."""
    graders = {}
    try:
        with open(OVERRIDES_PATH, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        print("[WARN] cannot read manual_overrides.json: %s" % e, file=sys.stderr)
        return graders
    for qid, ov in (data.get("overrides") or {}).items():
        g = ov.get("grader")
        if g and isinstance(g.get("checks"), list):
            graders[qid] = {
                "checks": g["checks"],
                "helperCmds": ov.get("helperCmds") or [],
            }
    return graders


def load_question_contexts():
    """Read questions.js and return { qid: {title, prompt, lab, solutionText, pitfalls} }.
    Used for injecting question context into the AI chat (trusted data)."""
    contexts = {}
    qpath = os.path.join(APP_DIR, "js", "data", "questions.js")
    if not os.path.exists(qpath):
        return contexts
    try:
        import re
        text = open(qpath, encoding="utf-8").read()
        m = re.search(r"const QUESTIONS = (\[.*?\]);\s*\nif", text, re.DOTALL)
        if not m:
            return contexts
        qs = json.loads(m.group(1))
        for q in qs:
            contexts[q["id"]] = {
                "title": q.get("title", ""),
                "prompt": q.get("prompt", ""),
                "lab": q.get("lab", []),
                "solutionText": q.get("solutionText", ""),
                "pitfalls": q.get("pitfalls", []),
                "category": q.get("categoryLabel", ""),
                "test": q.get("test"),
                "qno": q.get("qno"),
            }
    except (OSError, json.JSONDecodeError, ValueError) as e:
        print("[WARN] cannot read questions.js: %s" % e, file=sys.stderr)
    return contexts


# ---------------------------------------------------------------------------
# SSH execution (multiplexed with ControlMaster)
# ---------------------------------------------------------------------------
def ssh_base(cfg):
    return [
        "ssh",
        "-o", "BatchMode=yes",                       # do not show a password prompt (key auth only)
        "-o", "ConnectTimeout=5",
        "-o", "StrictHostKeyChecking=accept-new",
        "-o", "ControlMaster=auto",                  # multiplex the connection
        "-o", "ControlPath=" + CONTROL_PATH,
        "-o", "ControlPersist=60",                   # keep the connection for 60 seconds and reuse it
        "-i", cfg["ssh_key"],
        "-p", str(cfg["ssh_port"]),
        "%s@%s" % (cfg["ssh_user"], cfg["ssh_host"]),
    ]


def ssh_run(cfg, remote_args, stdin_data=None, timeout=90):
    """Run a remote command over SSH. Returns (exit_code, stdout, stderr).
    The default timeout is 90 seconds. Generous so that graders doing many
    two-hop ServerA->ServerB SSH calls (e.g. supplementary exam set t7q6-12)
    complete with plenty of margin."""
    try:
        proc = subprocess.run(
            ssh_base(cfg) + remote_args,
            input=stdin_data, capture_output=True, text=True, timeout=timeout)
        return proc.returncode, proc.stdout, proc.stderr
    except subprocess.TimeoutExpired:
        return 124, "", "SSH timeout"
    except FileNotFoundError:
        return 127, "", "ssh command not found"
    except Exception as e:                            # noqa: BLE001
        return 1, "", "SSH execution error: %s" % e


def vm_status(cfg):
    """Check VM reachability. Returns { ok, hostname, error }."""
    if cfg is None:
        return {"ok": False, "error": "config not set"}
    rc, out, err = ssh_run(cfg, ["hostname"], timeout=8)
    if rc == 0:
        return {"ok": True, "hostname": out.strip()}
    return {"ok": False, "error": (err.strip() or ("ssh exit %d" % rc))}


def expand_macros(cmd, cfg):
    """Expand ${SSH_B} and the like in grader.checks[].cmd to the values from config.
    Only the fixed macros of trusted grader definitions are expanded (no arbitrary substitution)."""
    return cmd.replace("${SSH_B}", cfg.get("serverb_ssh", ""))


def build_check_script(checks, cfg, qid=None, helper_cmds=None):
    """Generate a shell script from trusted checks to be batch-executed in a single SSH call.
    Each check: exit code 0 = pass. Output is lines of 'id<TAB>exitcode'.

    If helper_cmds is given, `rhcsa_done <qid> '<cmd1>' ...` is run at the top to
    auto-generate /tmp/.rhcsa_<qid>_done (so grading works even if the user did not run it by hand).
    """
    lines = ["#!/bin/bash"]
    # Auto-run the helper (create /tmp/.rhcsa_<qid>_done before grader.checks)
    if qid and helper_cmds:
        helper_parts = ["rhcsa_done", shlex.quote(qid)]
        for hc in helper_cmds:
            helper_parts.append(shlex.quote(hc))
        # Continue even on failure (if the helper fails, the helper_fresh check fails and reveals the cause)
        lines.append("# auto-run helper for " + qid)
        # </dev/null is required: the script is fed via the stdin of bash -s, so if an
        # ssh inside it (${SSH_B} etc.) reads stdin, it would consume and lose the remaining check lines
        lines.append(" ".join(helper_parts) + " </dev/null >/dev/null 2>&1 || true")
    for c in checks:
        cid = str(c.get("id", ""))
        cmd = expand_macros(c.get("cmd", ""), cfg)
        # cid is trusted data, but shell-quote it just in case. cmd runs the trusted definition as-is.
        lines.append(
            "( " + cmd + " ) </dev/null >/dev/null 2>&1; "
            + "printf '%s\\t%s\\n' " + shlex.quote(cid) + ' "$?"')
    return "\n".join(lines) + "\n"


def run_grade(cfg, checks, qid=None, helper_cmds=None):
    """Batch-execute checks (already filtered by phase) on the VM and return a result list.
    If qid and helper_cmds are passed, `rhcsa_done <qid> ...` is run first before the checks
    to auto-generate /tmp/.rhcsa_<qid>_done.
    Raises GradeError when SSH itself fails and the parsed result is empty."""
    if not checks:
        return []
    script = build_check_script(checks, cfg, qid=qid, helper_cmds=helper_cmds)
    rc, out, err = ssh_run(cfg, ["bash", "-s"], stdin_data=script, timeout=40)
    parsed = {}
    for line in out.splitlines():
        if "\t" in line:
            cid, _, code = line.partition("\t")
            code = code.strip()
            parsed[cid] = int(code) if code.lstrip("-").isdigit() else -1
    if rc != 0 and not parsed:
        # The script itself could not be sent (unreachable, key error, etc.)
        raise GradeError(err.strip() or ("ssh exit %d" % rc))
    results = []
    for c in checks:
        cid = str(c.get("id", ""))
        results.append({"id": cid, "exitCode": parsed.get(cid, -1)})
    return results


# ---------------------------------------------------------------------------
# AI chat (Anthropic Claude)
# ---------------------------------------------------------------------------
ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"

CHAT_SYSTEM_BASE = (
    "You are an excellent tutor for the RHEL 10 / RHCSA EX200 exam.\n"
    "The student is learning on real VMs (ServerA = 192.0.2.10, ServerB = 192.0.2.11,\n"
    "OS disk nvme0n1, additional disks nvme0n2/n3, 8GB each).\n"
    "Answer in English, wrap commands in ```bash```, and briefly explain the meaning of each option.\n"
    "Show only commands that actually work on RHEL 10 (RHCSA EX200), and clearly note any uncertainties."
)

CHAT_MODE_INSTRUCTIONS = {
    "hint": (
        "[Mode: Hint] The student is trying to solve it on their own.\n"
        "- **Do not give out the model-answer command itself**. Only hint at the approach, the man pages to look up, and related concepts.\n"
        "- Suggest 1-2 things to try next, then guide further after seeing the results."
    ),
    "explain": (
        "[Mode: Explain] The student wants to deepen their understanding.\n"
        "- Explain each option, argument, and symbol of the command (`{}`, `\\;`, `-r`, etc.) item by item.\n"
        "- Also touch on knock-on effects to related topics (persistence after reboot, SELinux, firewalld, etc.)."
    ),
    "debug": (
        "[Mode: Error Diagnosis] The student ran a command and got an error.\n"
        "- Infer the root cause from the error message the student pasted.\n"
        "- Suggest commands to check (`ls -Z`, `getenforce`, `systemctl status`, etc.).\n"
        "- Prioritize suspecting common RHCSA mistakes such as SELinux / firewalld / forgetting partprobe."
    ),
}


def build_chat_system_prompt(qctx, mode):
    """Assemble the system prompt from question context + mode-specific instructions.
    qctx: a single entry from load_question_contexts(). None means no-question mode."""
    parts = [CHAT_SYSTEM_BASE]
    parts.append(CHAT_MODE_INSTRUCTIONS.get(mode, CHAT_MODE_INSTRUCTIONS["explain"]))
    if qctx:
        ctx_lines = []
        ctx_lines.append("\n--- The question the student currently has open ---")
        if qctx.get("test") and qctx.get("qno"):
            ctx_lines.append("ID: Test %s Q%s" % (qctx["test"], qctx["qno"]))
        if qctx.get("category"):
            ctx_lines.append("Category: %s" % qctx["category"])
        ctx_lines.append("Title: %s" % qctx.get("title", ""))
        ctx_lines.append("Question: %s" % qctx.get("prompt", ""))
        if qctx.get("lab"):
            ctx_lines.append("Lab environment:")
            for line in qctx["lab"]:
                ctx_lines.append("  - %s" % line)
        # In hint mode, hide the model answer
        if mode != "hint" and qctx.get("solutionText"):
            ctx_lines.append("\nModel answer (for reference, quote as needed):")
            ctx_lines.append(qctx["solutionText"])
        if mode != "hint" and qctx.get("pitfalls"):
            ctx_lines.append("\nPitfalls and exam tips:")
            for p in qctx["pitfalls"][:6]:        # cap at the first 6 to avoid being too long
                ctx_lines.append("  - %s" % p)
        parts.append("\n".join(ctx_lines))
    return "\n\n".join(parts)


def anthropic_chat_stream(cfg, system, messages, write_chunk):
    """Call the Anthropic API with stream=true and pass only text_delta to write_chunk(text).
    write_chunk is responsible for formatting into SSE format and sending to the browser.
    On exception, call write_chunk("[ERROR] ...") at the end and finish."""
    api_key = cfg.get("anthropic_api_key")
    if not api_key:
        write_chunk("[ERROR] anthropic_api_key is not set in vmbridge.config.json.")
        return
    body = json.dumps({
        "model": cfg.get("anthropic_model", "claude-haiku-4-5"),
        "max_tokens": 2048,
        "system": system,
        "messages": messages,
        "stream": True,
    }).encode("utf-8")
    req = urllib.request.Request(
        ANTHROPIC_URL,
        data=body,
        method="POST",
        headers={
            "x-api-key": api_key,
            "anthropic-version": ANTHROPIC_VERSION,
            "content-type": "application/json",
            "accept": "text/event-stream",
        },
    )
    try:
        ctx = ssl.create_default_context()
        with urllib.request.urlopen(req, timeout=60, context=ctx) as resp:
            buf = ""
            for raw in resp:
                line = raw.decode("utf-8", errors="replace")
                buf += line
                # In SSE, a blank line delimits one event
                if "\n\n" in buf or buf.endswith("\n"):
                    # Process one line at a time (parse incrementally so buf does not grow too large)
                    pass
                if line.startswith("data: "):
                    try:
                        evt = json.loads(line[6:].strip())
                    except json.JSONDecodeError:
                        continue
                    if evt.get("type") == "content_block_delta":
                        delta = evt.get("delta", {})
                        if delta.get("type") == "text_delta":
                            t = delta.get("text", "")
                            if t:
                                write_chunk(t)
                    elif evt.get("type") == "message_stop":
                        return
    except urllib.error.HTTPError as e:
        try:
            err_body = e.read().decode("utf-8", errors="replace")
        except Exception:
            err_body = str(e)
        write_chunk("[ERROR] HTTP %d: %s" % (e.code, err_body[:500]))
    except Exception as e:                                   # noqa: BLE001
        write_chunk("[ERROR] %s" % e)


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------
class BridgeHandler(BaseHTTPRequestHandler):
    server_version = "rhcsa-vmbridge/1.0"

    # ---- CORS / Origin ----
    def _origin_allowed(self):
        origin = self.headers.get("Origin")
        if origin is None:
            return True, None          # non-browser (curl, etc.). Allowed as a local tool
        if origin in ALLOWED_ORIGINS:
            return True, origin
        return False, origin

    def _send_json(self, status, payload, origin=None):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Headers",
                             "Content-Type, X-RHCSA-Bridge-Token")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Vary", "Origin")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        ok, origin = self._origin_allowed()
        if not ok:
            self._send_json(403, {"error": "origin not allowed"})
            return
        self.send_response(204)
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Headers",
                             "Content-Type, X-RHCSA-Bridge-Token")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Vary", "Origin")
        self.end_headers()

    def do_GET(self):
        ok, origin = self._origin_allowed()
        if not ok:
            self._send_json(403, {"error": "origin not allowed"})
            return
        if self.path.split("?")[0] == "/status":
            st = vm_status(CONFIG)
            payload = {
                "ok": bool(st.get("ok")),
                "vm": "reachable" if st.get("ok") else "unreachable",
                "hostname": st.get("hostname", ""),
                "error": st.get("error", ""),
                "token": TOKEN,             # only a valid Origin can read the response (CORS)
                "chat": bool(CONFIG and CONFIG.get("anthropic_api_key")),
                "chatModel": (CONFIG.get("anthropic_model") if CONFIG else ""),
            }
            self._send_json(200, payload, origin)
        else:
            self._send_json(404, {"error": "not found"}, origin)

    def do_POST(self):
        ok, origin = self._origin_allowed()
        if not ok:
            self._send_json(403, {"error": "origin not allowed"})
            return
        path = self.path.split("?")[0]
        if path == "/grade":
            self._handle_grade(origin)
            return
        if path == "/chat":
            self._handle_chat(origin)
            return
        self._send_json(404, {"error": "not found"}, origin)

    def _read_json_body(self, origin, max_size=4096):
        """Common: token validation + reading the JSON body. On failure, returns an HTTP response and returns None."""
        if self.headers.get("X-RHCSA-Bridge-Token") != TOKEN:
            self._send_json(403, {"error": "invalid bridge token"}, origin)
            return None
        ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip()
        if ctype != "application/json":
            self._send_json(415, {"error": "JSON only"}, origin)
            return None
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > max_size:
            self._send_json(400, {"error": "bad request body"}, origin)
            return None
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._send_json(400, {"error": "invalid JSON"}, origin)
            return None

    def _handle_grade(self, origin):
        req = self._read_json_body(origin)
        if req is None:
            return
        qid = req.get("questionId")
        phase = req.get("phase", "live")
        if not isinstance(qid, str) or qid not in GRADERS:
            self._send_json(404, {"error": "unknown questionId"}, origin)
            return
        if phase not in ("live", "reboot"):
            self._send_json(400, {"error": "phase must be live or reboot"}, origin)
            return
        if CONFIG is None:
            self._send_json(503, {"error": "VM not configured (vmbridge.config.json)"}, origin)
            return
        grader = GRADERS[qid]
        checks = [c for c in grader["checks"] if c.get("scope", "live") == phase]
        # helperCmds are auto-run only in the live phase (the reboot phase verifies persistence
        # after reboot, so generating a helper on the spot is meaningless there).
        # Can be turned OFF with auto_helper=false (POST body). Used in grader_audit's clean-mode
        # grading to eliminate "false positives caused by auto-running the helper".
        auto_helper = req.get("auto_helper", True)
        helper_cmds = (grader.get("helperCmds")
                       if (phase == "live" and auto_helper) else None)
        try:
            results = run_grade(CONFIG, checks, qid=qid, helper_cmds=helper_cmds)
        except GradeError as e:
            self._send_json(502, {"error": "VM execution error: " + str(e)}, origin)
            return
        self._send_json(200, {"questionId": qid, "phase": phase,
                              "results": results}, origin)

    def _handle_chat(self, origin):
        # Chat history is capped at 32KB
        req = self._read_json_body(origin, max_size=32768)
        if req is None:
            return
        if CONFIG is None or not CONFIG.get("anthropic_api_key"):
            self._send_json(503, {"error": "AI chat not configured (anthropic_api_key in vmbridge.config.json)"}, origin)
            return
        qid = req.get("questionId")
        mode = req.get("mode", "explain")
        if mode not in CHAT_MODE_INSTRUCTIONS:
            self._send_json(400, {"error": "mode must be one of hint/explain/debug"}, origin)
            return
        messages = req.get("messages") or []
        if not isinstance(messages, list) or not messages:
            self._send_json(400, {"error": "messages array is empty"}, origin)
            return
        # Normalize each message to only { role: user|assistant, content: str } (allow only the trusted shape)
        clean_msgs = []
        for m in messages[-20:]:                    # up to 20 turns
            role = m.get("role")
            content = m.get("content")
            if role in ("user", "assistant") and isinstance(content, str) and content.strip():
                clean_msgs.append({"role": role, "content": content[:8000]})  # 8KB cap per message
        if not clean_msgs:
            self._send_json(400, {"error": "no valid messages"}, origin)
            return
        # Resolve the question context (trusted)
        qctx = QCONTEXTS.get(qid) if isinstance(qid, str) else None
        system = build_chat_system_prompt(qctx, mode)

        # Start the SSE streaming response
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.end_headers()

        def write_chunk(text):
            try:
                # SSE: data: <json>\n\n
                payload = json.dumps({"text": text}, ensure_ascii=False)
                self.wfile.write(("data: " + payload + "\n\n").encode("utf-8"))
                self.wfile.flush()
            except Exception:                       # noqa: BLE001
                pass

        anthropic_chat_stream(CONFIG, system, clean_msgs, write_chunk)
        # Completion marker
        try:
            self.wfile.write(b"event: done\ndata: {}\n\n")
            self.wfile.flush()
        except Exception:                            # noqa: BLE001
            pass

    def log_message(self, fmt, *args):
        # /status is a health check the app hits every 20 seconds. Suppress it so the log
        # does not get flooded and bury the actual grading logs (delete the lines below if you want to see all).
        if args and isinstance(args[0], str) and "/status" in args[0]:
            return
        sys.stderr.write("[vmbridge] " + (fmt % args) + "\n")


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------
CONFIG, CONFIG_ERR = load_config()
GRADERS = load_graders()
QCONTEXTS = load_question_contexts()
ALLOWED_ORIGINS = (CONFIG.get("allowed_origins") if CONFIG else DEFAULT_ORIGINS)
BRIDGE_PORT = (CONFIG.get("bridge_port") if CONFIG else 8770)


def main():
    print("=" * 60)
    print(" RHCSA10 exam practice — SSH bridge (vmbridge.py)")
    print("=" * 60)
    if CONFIG is None:
        print(" [no config] %s" % CONFIG_ERR)
        print("  -> /status returns ok:false. Configure it and restart.")
    else:
        print(" VM      : %s@%s:%s (key %s)" % (
            CONFIG["ssh_user"], CONFIG["ssh_host"],
            CONFIG["ssh_port"], CONFIG["ssh_key"]))
    print(" Listening: http://127.0.0.1:%d  (127.0.0.1 only)" % BRIDGE_PORT)
    print(" Allowed Origins: %s" % ", ".join(ALLOWED_ORIGINS))
    print(" grader  : loaded %d trusted question definitions" % len(GRADERS))
    print(" qcontext: %d question contexts (for AI chat)" % len(QCONTEXTS))
    chat_on = bool(CONFIG and CONFIG.get("anthropic_api_key"))
    print(" AI chat : %s (model=%s)" % (
        "enabled" if chat_on else "disabled (anthropic_api_key not set)",
        (CONFIG.get("anthropic_model") if CONFIG else "")))
    print(" token   : %s" % TOKEN)
    print(" Stop    : Ctrl+C")
    print("=" * 60)
    httpd = ThreadingHTTPServer(("127.0.0.1", BRIDGE_PORT), BridgeHandler)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping.")
    finally:
        httpd.server_close()
        # Close the SSH master connection
        if CONFIG is not None:
            subprocess.run(ssh_base(CONFIG)[:-1] + ["-O", "exit",
                           "%s@%s" % (CONFIG["ssh_user"], CONFIG["ssh_host"])],
                           capture_output=True)


if __name__ == "__main__":
    main()
