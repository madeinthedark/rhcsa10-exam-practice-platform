#!/usr/bin/env bash
# rhcsa_done — RHCSA10 learning app grading-helper command
# Install at /usr/local/bin/rhcsa_done on the VMs (ServerA / ServerB).
#
# After completing a question, the learner only needs to call this function once,
# and the grader can record the required state information in
# /tmp/.rhcsa_<qid>_done. The grader greps that output file.
#
# Usage:
#   rhcsa_done <qid> [<cmd1> [<cmd2> ...]]
#
# Example:
#   rhcsa_done t1q22 'ps -eo pid,ni,comm | grep sleep' 'history | tail -20'
#
# Output path: /tmp/.rhcsa_<qid>_done
# An existing file is overwritten (for re-grading)
#
# Security:
#   - qid only accepts ^t[0-9]+q[0-9]+$ (prevents arbitrary file writes)
#   - Output path is fixed to /tmp/ (auto-removed on snapshot revert)
#   - cmd is eval'd (intentionally allowed since this is a learning tool)

set -u

rhcsa_done() {
  local qid="${1:-}"
  shift || true

  # Validate qid format
  if [[ ! "${qid}" =~ ^t[0-9]+q[0-9]+$ ]]; then
    echo "Error: specify qid in 't<test>q<no>' format (example: t1q22)" >&2
    return 1
  fi

  local outfile="/tmp/.rhcsa_${qid}_done"
  {
    echo "qid:${qid}"
    echo "at:$(date -Iseconds 2>/dev/null || date +%Y-%m-%dT%H:%M:%S%z)"
    echo "host:$(hostname 2>/dev/null || echo unknown)"
    echo "user:$(id -un 2>/dev/null || echo unknown)"
    if [[ "$#" -eq 0 ]]; then
      echo ""
      echo "=== (no commands) ==="
    else
      for cmd in "$@"; do
        echo ""
        echo "=== ${cmd} ==="
        eval "${cmd}" 2>&1 || true
      done
    fi
  } > "${outfile}" 2>/dev/null

  # Make the grading-helper file world-readable (vmbridge SSHes as root, but just in case)
  chmod 644 "${outfile}" 2>/dev/null || true

  echo "✓ grading-helper file: ${outfile}"
}

# When this file is sourced, only define the function
# When executed directly, pass the arguments to rhcsa_done
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  rhcsa_done "$@"
fi
