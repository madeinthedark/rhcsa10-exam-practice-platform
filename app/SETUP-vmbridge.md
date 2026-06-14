# SSH Bridge Setup Guide (Live VM Grading)

This app can connect to a real RHEL 10 VM over SSH and automatically grade whether
a task has been completed correctly. To enable this, you set up the relay program `vmbridge.py`.

```
Browser (Mac, :8765) ──HTTP──▶ vmbridge.py (Mac, :8770) ──SSH──▶ RHEL 10 VM
```

The app itself (browsing and self-grading) works even without the bridge running. The SSH bridge
is only required when you want to use the "Grade on VM" button.

---

## Prerequisites

- A **RHEL 10 VM** is already set up in VMware Fusion (or similar) and is running
- **sshd is running** inside the VM (in a typical RHCSA environment it runs out of the box)
- You know the VM's IP address (check it inside the VM with `ip addr` or `hostname -I`)

---

## Steps

### 1. Create an SSH key (on the Mac, first time only)

To avoid writing a password in the config file, we use key-based authentication.

```bash
ssh-keygen -t ed25519 -f ~/.ssh/rhcsa_vm -N ""
```

### 2. Register the public key on the VM

```bash
ssh-copy-id -i ~/.ssh/rhcsa_vm.pub root@<VM_IP>
```

If `ssh-copy-id` is not available, append the contents of `~/.ssh/rhcsa_vm.pub` to the VM's
`~/.ssh/authorized_keys`.

Once registered, verify that you can log in without a password:

```bash
ssh -i ~/.ssh/rhcsa_vm root@<VM_IP> hostname
```

### 3. Create the bridge config file

In `app/tools/`, copy the template and edit it:

```bash
cd app/tools
cp vmbridge.config.example.json vmbridge.config.json
```

Open `vmbridge.config.json` and edit it to match your VM:

```json
{
  "ssh_host": "192.168.x.x",       ← VM IP
  "ssh_user": "root",
  "ssh_key": "~/.ssh/rhcsa_vm",
  "ssh_port": 22,
  "bridge_port": 8770
}
```

> `vmbridge.config.json` is already in `.gitignore` (it is not committed, since it contains secrets).

### 4. Start the bridge

```bash
python3 app/tools/vmbridge.py
```

Information such as `VM connection` and a `token` is displayed, and the bridge starts listening.
Leave this terminal open.

### 5. Open the app

In a separate terminal, start the app server (if it is not already running):

```bash
python3 -m http.server 8765 --directory app
```

Open **http://localhost:8765/index.html** in your browser.
You have succeeded when the indicator in the top-right corner turns to **"● VM connected" (green)**.

---

## Usage

1. Open a problem screen and first **actually perform the task on the VM**
2. Press the **"Grade on VM"** button to grade the VM's state check by check via the bridge
3. For problems that include a post-reboot persistence check (e.g., LVM), **reboot the VM first**,
   then press the "Run post-reboot check" button

---

## Troubleshooting

| Indicator | State | What to do |
|---|---|---|
| ● VM not connected (gray) | `vmbridge.py` is not running / not reachable | Start the bridge. Check that `bridge_port` does not conflict with another port |
| ● VM unreachable (orange) | The bridge is running but cannot SSH to the VM | Check that the VM is running and verify the IP, key path, and that sshd is running. Manually confirm that `ssh -i <key> <user>@<IP> hostname` succeeds |
| ● VM connected (green) | Normal | You can use "Grade on VM" as-is |

- Automatic grading is not available when opened via `file://` (a browser security restriction).
  Always open it via `http://localhost:8765`. Self-grading works even via `file://`.

---

## About Security

- `vmbridge.py` listens on **127.0.0.1 only** and is not exposed externally
- The browser sends **only the problem ID**; the commands to run are resolved from the trusted
  definitions on the bridge side (the `grader` field in `manual_overrides.json`). Arbitrary
  commands cannot be run from the browser
- Grading commands are, as a rule, **read-only** (verification commands that do not change state)
- A random token generated at startup and Origin validation prevent calls from other sites
