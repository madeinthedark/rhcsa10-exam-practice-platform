#!/usr/bin/env bash
# vm_make_clean.sh — Reset the practice VM to a "real-exam-ready clean state" (destructive).
#
# Purpose: Remove anything pre-configured so that each RHCSA question is actually "work" to do.
#   Remove: task packages / local.repo / pre-mounted DVD (+fstab) / task artifacts and users
#   Keep  : networking (ens160) + SSH key / system foundation such as lvm2 / standard services such as chrony and rsyslog / DVD connection (sr0)
#
# Usage (run on ServerA -> verify -> create a new clean snapshot in VMware Fusion):
#   ssh -i ~/.ssh/rhcsa_vm root@192.0.2.10 bash -s < app/tools/vm_make_clean.sh
#   Then verify cleanliness with  app/tools/vm_clean_check.sh  before taking the snapshot.
#
# WARNING: Destructive. Take a "snapshot of the current state" before running (so you can roll back on failure).
set -u

echo "=== [Safety check] Do not touch: network/ens160, sshd, root SSH key, lvm2, /(boot) ==="

echo; echo "=== [1] Remove task packages (keep system foundation lvm2/chrony/rsyslog/vim) ==="
REMOVE_PKGS="httpd flatpak tuned nfs-utils autofs vdo vsftpd nmap-ncat nmap podman at"
for p in $REMOVE_PKGS; do
  if rpm -q "$p" >/dev/null 2>&1; then
    echo "removing: $p"
    dnf remove -y "$p" >/dev/null 2>&1 && echo "  -> removed $p" || echo "  -> failed/held back due to dependencies $p"
  fi
done

echo; echo "=== [2] Remove local.repo (make repo configuration a real task) ==="
[ -f /etc/yum.repos.d/local.repo ] && rm -f /etc/yum.repos.d/local.repo && echo "removed local.repo" || echo "local.repo is already absent"
dnf clean all >/dev/null 2>&1 || true

echo; echo "=== [3] Unmount the pre-mounted DVD (leave mounting up to the student too; keep sr0 connected) ==="
# Remove the /dev/sr0 line from fstab
if grep -q '/dev/sr0' /etc/fstab 2>/dev/null; then
  cp -a /etc/fstab /etc/fstab.bak.$(date +%s) 2>/dev/null || true
  grep -v '/dev/sr0' /etc/fstab > /etc/fstab.tmp && mv /etc/fstab.tmp /etc/fstab && echo "removed the /dev/sr0 line from fstab"
fi
mountpoint -q /mnt && umount /mnt 2>/dev/null && echo "unmounted /mnt" || echo "/mnt is not mounted"

echo; echo "=== [4] Remove leftover task artifacts (if present) ==="
for d in /find /opt/dev-data /vdo_data /mylv /groups /shares /data/public; do
  [ -e "$d" ] && rm -rf "$d" && echo "rm $d" || true
done
rm -f /usr/local/bin/*.sh /root/ssh_hosts.txt /root/config_backup.tar.gz /var/tmp/fstab_copy 2>/dev/null || true

echo; echo "=== [5] Remove task users/groups (if present; do not touch standard users) ==="
for u in alex harry sam john sarah peter carl dan natasha; do
  id "$u" >/dev/null 2>&1 && userdel -r "$u" 2>/dev/null && echo "userdel $u" || true
done
for g in developers accounting finance sysadmin; do
  getent group "$g" >/dev/null 2>&1 && groupdel "$g" 2>/dev/null && echo "groupdel $g" || true
done

echo; echo "=== [6] Erase partitions on the additional disks (wipe nvme0n2/n3 clean) ==="
for disk in /dev/nvme0n2 /dev/nvme0n3; do
  if [ -b "$disk" ]; then
    # Only deactivate swap/mounts originating from these task disks (do not touch the OS rhel-swap)
    for part in "$disk" "$disk"p*; do
      [ -b "$part" ] || continue
      swapoff "$part" 2>/dev/null || true
      umount "$part" 2>/dev/null || true
    done
    wipefs -a "$disk" >/dev/null 2>&1 && echo "wipefs $disk" || echo "$disk: wipe failed/not needed"
  fi
done

echo; echo "=== [7] Clear shell history (so practice history is not baked into the snapshot and does not contaminate grading) ==="
for h in /root/.bash_history /home/*/.bash_history; do
  [ -f "$h" ] && truncate -s 0 "$h" && echo "truncated $h" || true
done

echo; echo "=== Done. Next, verify with app/tools/vm_clean_check.sh -> if all good, take a new snapshot in VMware Fusion ==="
