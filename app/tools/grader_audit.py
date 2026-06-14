#!/usr/bin/env python3
"""grader_audit.py — Harness to machine-verify the grader quality of all 193 questions

[Usage]
  1. Revert the VM to the "clean-base" snapshot (rhcsa-revert.sh or manually)
  2. Start vmbridge.py (rhcsa)
  3. Run this script: python3 app/tools/grader_audit.py [--mode clean|solution]
  4. Review the results to find false positives (= a score appears even though the VM is clean)

[Modes]
  --mode clean    (default) Verify that every question scores 0 points.
                   Any question scoring 1 or more = false positive candidate = gap in grader design
  --mode solution Verify that every question scores 100% on a fully-solved state (not yet implemented)

[Output]
  For each question, displays earned/max and pass/fail per check.
  Ends with a false positive summary.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
QUESTIONS_JS = ROOT / "app/js/data/questions.js"
BRIDGE = "http://127.0.0.1:8770"
ORIGIN = "http://localhost:8765"

# A clean state is expected to score 0, but small scores may occasionally appear due to the system itself; this is the allowance
# e.g. SELinux is always Enforcing, so "SELinux Boolean ON" passes by chance, etc.
TOLERANCE_PCT = 15  # 15% or below is allowed (anything above needs review)


def load_questions():
    src = QUESTIONS_JS.read_text(encoding="utf-8")
    m = re.search(r"const QUESTIONS = (\[[\s\S]*?\]);\nif", src)
    return json.loads(m.group(1))


def get_bridge_status():
    try:
        req = urllib.request.Request(f"{BRIDGE}/status",
                                     headers={"Origin": ORIGIN})
        with urllib.request.urlopen(req, timeout=5) as r:
            return json.load(r)
    except (urllib.error.URLError, OSError) as e:
        print(f"ERROR: Cannot connect to vmbridge ({BRIDGE}): {e}")
        print("-> Check that vmbridge.py is running (run rhcsa or python3 vmbridge.py)")
        sys.exit(1)


def grade(qid: str, token: str, auto_helper: bool = True) -> dict:
    body = {"questionId": qid, "phase": "live"}
    if not auto_helper:
        body["auto_helper"] = False
    req = urllib.request.Request(
        f"{BRIDGE}/grade",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "X-RHCSA-Bridge-Token": token,
            "Origin": ORIGIN,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        return {"error": f"HTTP {e.code}: {body[:120]}"}
    except (urllib.error.URLError, OSError) as e:
        return {"error": str(e)}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mode", choices=["clean", "solution"], default="clean",
                    help="verification mode (clean=expect 0 points, solution=expect full marks)")
    ap.add_argument("--limit", type=int, default=0,
                    help="number of questions to verify (0=all)")
    ap.add_argument("--qid", action="append",
                    help="verify only specific qids (can be specified multiple times)")
    ap.add_argument("--delay", type=float, default=0.2,
                    help="seconds between grading runs (reduces VM load, default 0.2)")
    ap.add_argument("--out", default=None,
                    help="path to save grading results as JSON Lines (e.g. docs/audit/raw_clean.jsonl)")
    ap.add_argument("--no-auto-helper", action="store_true",
                    help="turn OFF vmbridge's automatic helper execution (audit mode, measures the grader's true accuracy)")
    args = ap.parse_args()

    print(f"=== RHCSA10 grader audit ({args.mode} mode) ===\n")

    # Verify vmbridge connection
    st = get_bridge_status()
    if not st.get("ok"):
        print(f"WARN: VM unreachable ({st.get('error', 'unknown')})")
        print("-> Check that the VM is running and SSH key authentication succeeds")
        sys.exit(1)
    token = st["token"]
    print(f"vmbridge OK / VM: {st.get('hostname', '?')}")

    # Load questions
    qs = load_questions()
    targets = [q for q in qs if q.get("autoGradeReady")]
    if args.qid:
        targets = [q for q in targets if q["id"] in args.qid]
    elif args.limit > 0:
        targets = targets[:args.limit]
    print(f"Targets: {len(targets)} questions\n")

    # Grade each question
    results = []

    def _write_out(idx: int, payload: dict) -> None:
        """When `--out` is specified, append payload to JSONL. Truncate only when idx==1."""
        if not args.out:
            return
        import pathlib
        outp = pathlib.Path(args.out)
        outp.parent.mkdir(parents=True, exist_ok=True)
        mode = "a" if idx > 1 else "w"
        with open(outp, mode, encoding="utf-8") as f:
            f.write(json.dumps(payload, ensure_ascii=False) + "\n")

    for i, q in enumerate(targets, 1):
        qid = q["id"]
        print(f"[{i}/{len(targets)}] {qid:8} ", end="", flush=True)
        r = grade(qid, token, auto_helper=not args.no_auto_helper)
        if "error" in r:
            print(f"ERROR: {r['error']}")
            err_entry = {"qid": qid, "error": r["error"]}
            results.append(err_entry)
            _write_out(i, err_entry)
            time.sleep(args.delay)
            continue

        # Compute earned
        checks_by_id = {c["id"]: c for c in q["grader"]["checks"]}
        earned = 0
        per_check = []
        for chk_result in r.get("results", []):
            cid = chk_result["id"]
            passed = chk_result["exitCode"] == 0
            score = checks_by_id.get(cid, {}).get("score", 0)
            if passed:
                earned += score
            per_check.append((cid, passed, score))
        max_score = q.get("maxScore", 0)
        pct = earned / max_score * 100 if max_score else 0

        # Display
        marker = "O" if (args.mode == "clean" and earned == 0) or \
                       (args.mode == "solution" and earned == max_score) else \
                 "~" if (args.mode == "clean" and pct <= TOLERANCE_PCT) else "X"
        print(f"{marker} {earned:3}/{max_score:3} ({pct:5.1f}%) "
              f"checks {sum(1 for _, p, _ in per_check if p)}/{len(per_check)}")

        results.append({
            "qid": qid,
            "title": q.get("title", "")[:40],
            "category": q.get("category", ""),
            "earned": earned,
            "max": max_score,
            "pct": pct,
            "per_check": per_check,
            "graderQuality": q.get("graderQuality", "?"),
        })
        _write_out(i, results[-1])
        time.sleep(args.delay)

    # Summary
    print("\n" + "=" * 70)
    print(f" Audit result summary ({args.mode} mode)")
    print("=" * 70)
    print(f"Total graded: {len(results)} questions")
    err_n = sum(1 for r in results if "error" in r)
    print(f"Errors: {err_n} questions")
    if err_n:
        print("\n--- Error list ---")
        for r in results:
            if "error" in r:
                print(f"  {r['qid']}: {r['error']}")

    valid = [r for r in results if "error" not in r]

    if args.mode == "clean":
        # earned > 0 in a clean state = false positive candidate
        false_pos = sorted([r for r in valid if r["earned"] > 0],
                           key=lambda r: -r["pct"])
        critical = [r for r in false_pos if r["pct"] > TOLERANCE_PCT]
        tolerable = [r for r in false_pos if r["pct"] <= TOLERANCE_PCT]

        print(f"\n--- Critical (false positive rate > {TOLERANCE_PCT}%) {len(critical)} items ---")
        for r in critical:
            print(f"  X {r['qid']:8} [{r['graderQuality']}] {r['earned']:3}/{r['max']:3} "
                  f"({r['pct']:5.1f}%) — {r['title']}")
            passed_checks = [cid for cid, p, _ in r["per_check"] if p]
            if passed_checks:
                print(f"     passing check: {', '.join(passed_checks)}")

        print(f"\n--- Tolerable (around ~{TOLERANCE_PCT}%) {len(tolerable)} items ---")
        for r in tolerable[:20]:
            print(f"  ~ {r['qid']:8} [{r['graderQuality']}] {r['earned']:3}/{r['max']:3} "
                  f"({r['pct']:5.1f}%) — {r['title']}")
        if len(tolerable) > 20:
            print(f"  ... {len(tolerable) - 20} more items")

        print(f"\n--- Perfect 0 points (ideal) {len(valid) - len(false_pos)} items ---")

        # Aggregate by category
        by_cat = defaultdict(list)
        for r in valid:
            by_cat[r["category"]].append(r)
        print("\n--- False positive rate by category ---")
        for cat in sorted(by_cat):
            rs = by_cat[cat]
            fp_n = sum(1 for r in rs if r["earned"] > 0)
            avg = sum(r["pct"] for r in rs) / len(rs) if rs else 0
            print(f"  {cat:18} {fp_n:3}/{len(rs):3} (avg {avg:4.1f}%)")

    elif args.mode == "solution":
        # earned < max in a solution state = false negative
        false_neg = sorted([r for r in valid if r["earned"] < r["max"]],
                          key=lambda r: r["pct"])
        print(f"\n--- Below full marks (false negative) {len(false_neg)} items ---")
        for r in false_neg[:30]:
            print(f"  X {r['qid']:8} {r['earned']:3}/{r['max']:3} "
                  f"({r['pct']:5.1f}%) — {r['title']}")

    # Exit code
    if args.mode == "clean" and any(r.get("pct", 0) > TOLERANCE_PCT for r in valid):
        sys.exit(2)  # critical false positives present
    sys.exit(0)


if __name__ == "__main__":
    main()
