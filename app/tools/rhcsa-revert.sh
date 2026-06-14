#!/usr/bin/env bash
# rhcsa-revert.sh — Revert the RHCSA10 study VMs to a clean snapshot and reboot
#
# Usage:
#   ./rhcsa-revert.sh                 # Revert to the default snapshot "RHCSA10-exam-baseline"
#   ./rhcsa-revert.sh <snapshot-name> # Revert to any snapshot
#   ./rhcsa-revert.sh --a-only        # Revert ServerA only
#   ./rhcsa-revert.sh --b-only        # Revert ServerB only
#
# Configuration:
#   Edit SERVERA_VMX / SERVERB_VMX below to match the paths of your own VMs.
#   You can check the paths of running VMs with `vmrun list`.

set -eu

# ---- Configuration (edit to match your own environment) ----
SERVERA_VMX="${SERVERA_VMX:-$HOME/Virtual Machines.localized/ServerA.vmwarevm/RHCSA10 practice1.vmx}"
SERVERB_VMX="${SERVERB_VMX:-$HOME/Virtual Machines.localized/ServerB.vmwarevm/RHCSA10 practice2.vmx}"
SERVERA_IP="${SERVERA_IP:-192.0.2.10}"
SERVERB_IP="${SERVERB_IP:-192.0.2.11}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/rhcsa_vm}"
# v3 (2026-06-10): clears bash_history, sets CD startConnected, and moves the ISO to a path outside TCC protection
# (The old RHCSA10-exam-baseline is kept as a fallback. The canonical ISO is
#  ~/Virtual Machines/rhel-10.1-x86_64-dvd.iso, because a headless-launched
#  VMware cannot open files under Documents due to TCC.)
DEFAULT_SNAPSHOT="${DEFAULT_SNAPSHOT:-RHCSA10-exam-baseline-v3}"

# ---- Argument parsing ----
TARGETS=("a" "b")
SNAPSHOT="${DEFAULT_SNAPSHOT}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --a-only) TARGETS=("a"); shift ;;
    --b-only) TARGETS=("b"); shift ;;
    --help|-h)
      head -16 "$0" | tail -15
      exit 0
      ;;
    *)
      SNAPSHOT="$1"
      shift
      ;;
  esac
done

# ---- Locate vmrun ----
VMRUN=$(command -v vmrun || echo "/Applications/VMware Fusion.app/Contents/Public/vmrun")
if [[ ! -x "$VMRUN" ]]; then
  echo "ERROR: vmrun command not found"
  echo "→ Check that VMware Fusion is installed, or export \$VMRUN to specify it"
  exit 1
fi

# ---- Verify snapshot exists ----
check_snapshot() {
  local vmx="$1"
  if ! "$VMRUN" listSnapshots "$vmx" 2>/dev/null | grep -q "^${SNAPSHOT}$"; then
    echo "ERROR: snapshot '${SNAPSHOT}' does not exist in $vmx"
    echo "  Available snapshots:"
    "$VMRUN" listSnapshots "$vmx" | sed 's/^/    /'
    exit 1
  fi
}

# ---- Revert + start ----
revert_vm() {
  local label="$1" vmx="$2" ip="$3"
  echo "==> ${label} (${vmx})"
  check_snapshot "$vmx"
  echo "    revertToSnapshot: ${SNAPSHOT}"
  "$VMRUN" revertToSnapshot "$vmx" "$SNAPSHOT"
  echo "    start (nogui)"
  "$VMRUN" start "$vmx" nogui

  # Wait for SSH connection
  echo -n "    Waiting for SSH connection "
  local n=0
  while (( n < 60 )); do
    if ssh -i "$SSH_KEY" \
           -o ConnectTimeout=3 \
           -o BatchMode=yes \
           -o StrictHostKeyChecking=no \
           -o UserKnownHostsFile=/dev/null \
           root@${ip} 'echo ok' >/dev/null 2>&1; then
      echo "✓"
      return 0
    fi
    echo -n "."
    sleep 2
    n=$((n+1))
  done
  echo " ✗ timed out (2 minutes)"
  exit 1
}

# ---- Execute ----
echo "===== RHCSA10 VM revert (${SNAPSHOT}) ====="
for t in "${TARGETS[@]}"; do
  case "$t" in
    a) revert_vm "ServerA" "$SERVERA_VMX" "$SERVERA_IP" ;;
    b) revert_vm "ServerB" "$SERVERB_VMX" "$SERVERB_IP" ;;
  esac
done

echo ""
echo "===== Done ====="
echo "Next steps:"
echo "  1. If vmbridge.py is running, wait 10-20 seconds for the state to be reflected"
echo "  2. Hard-reload in your browser with Cmd+Shift+R"
echo "  3. To check grading quality: python3 app/tools/grader_audit.py"
