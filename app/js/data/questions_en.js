/* questions_en.js — English content overlay for the public demo, keyed by id.
   Original sample tasks (no third-party content). */
window.QUESTIONS_EN = {
 "s1": {
  "id": "s1",
  "title_en": "Create a user and add it to a group",
  "promptHtml_en": "On <strong>ServerA</strong>, create a group and a user, then set the account to expire.",
  "specHtml_en": [
   "Create a group named <code>engineering</code>.",
   "Create a user <code>dev1</code> that belongs to <code>engineering</code> as a supplementary group.",
   "Make the account expire on <code>2030-12-31</code>."
  ],
  "solutionHtml_en": "<pre><code class=\"lang-bash\">groupadd engineering\nuseradd -G engineering dev1\nchage -E 2030-12-31 dev1\n\n# verify\nid dev1\nchage -l dev1 | grep -i expire</code></pre>",
  "pitfallsHtml_en": [
   "Use <code>-G</code> for a supplementary group; <code>-g</code> would change the primary group instead."
  ],
  "verifyHtml_en": [
   "<code>id dev1</code> lists the engineering group.",
   "<code>chage -l dev1</code> shows the account expiry date."
  ],
  "rebootCheckHtml_en": "User and group definitions persist across a reboot.",
  "lab_en": [
   "ServerA 192.0.2.10/24 - practice VM (example address)",
   "Run every command as root."
  ]
 },
 "s2": {
  "id": "s2",
  "title_en": "Find large files and copy them, preserving attributes",
  "promptHtml_en": "Copy the large log files into a new directory while keeping their attributes.",
  "specHtml_en": [
   "Find every regular file under <code>/var/log</code> larger than <code>1 MiB</code>.",
   "Copy them into <code>/root/biglogs</code> (create it if needed).",
   "Preserve their permissions and timestamps."
  ],
  "solutionHtml_en": "<pre><code class=\"lang-bash\">mkdir -p /root/biglogs\nfind /var/log -type f -size +1M -exec cp -p {} /root/biglogs/ \\;\n\n# verify\nls -l /root/biglogs</code></pre>",
  "pitfallsHtml_en": [
   "<code>-size +1M</code> means strictly larger than 1 MiB (1,048,576 bytes), not megabytes.",
   "<code>cp -p</code> preserves mode, ownership and timestamps; plain <code>cp</code> does not."
  ],
  "verifyHtml_en": [
   "Files larger than 1 MiB from <code>/var/log</code> exist in <code>/root/biglogs</code>.",
   "Copied files keep their original timestamps."
  ],
  "rebootCheckHtml_en": "Copied files persist across a reboot.",
  "lab_en": [
   "ServerA 192.0.2.10/24 - practice VM (example address)",
   "Run every command as root."
  ]
 },
 "s3": {
  "id": "s3",
  "title_en": "Create an LVM logical volume and mount it persistently",
  "promptHtml_en": "Build an LVM logical volume on the spare disk and mount it so it survives a reboot.",
  "specHtml_en": [
   "On <code>/dev/sdb</code>, create a volume group <code>vg_demo</code> and a 1 GiB logical volume <code>lv_demo</code>.",
   "Format it <code>ext4</code> and mount it at <code>/mnt/demo</code>.",
   "Make the mount persistent across reboots (use the UUID)."
  ],
  "solutionHtml_en": "<pre><code class=\"lang-bash\">parted -s /dev/sdb mklabel gpt mkpart primary 1MiB 100% set 1 lvm on\npartprobe /dev/sdb\npvcreate /dev/sdb1\nvgcreate vg_demo /dev/sdb1\nlvcreate -n lv_demo -L 1G vg_demo\nmkfs.ext4 /dev/vg_demo/lv_demo\nmkdir -p /mnt/demo\nUUID=$(blkid -s UUID -o value /dev/vg_demo/lv_demo)\necho \"UUID=$UUID /mnt/demo ext4 defaults 0 0\" >> /etc/fstab\nmount -a\n\n# verify\nlvs vg_demo\ndf -h /mnt/demo</code></pre>",
  "pitfallsHtml_en": [
   "A typo in <code>/etc/fstab</code> can stop the system from booting; always run <code>mount -a</code> to test first.",
   "Mount by UUID, not the device name, which can change."
  ],
  "verifyHtml_en": [
   "<code>lvs</code> shows lv_demo at 1 GiB in vg_demo.",
   "<code>df -h /mnt/demo</code> shows it mounted as ext4.",
   "The <code>/etc/fstab</code> entry uses the UUID so it remounts after reboot."
  ],
  "rebootCheckHtml_en": "Mount by UUID in <code>/etc/fstab</code> so it survives a reboot; test with <code>mount -a</code> before rebooting.",
  "lab_en": [
   "ServerA 192.0.2.10/24 - practice VM (example address)",
   "Spare disk: /dev/sdb (unpartitioned).",
   "Run every command as root."
  ]
 },
 "s4": {
  "id": "s4",
  "title_en": "Set a static IPv4 address with nmcli",
  "promptHtml_en": "Configure a connection with a static IPv4 address that applies on boot.",
  "specHtml_en": [
   "On connection <code>ens3</code>, set address <code>192.0.2.50/24</code>, gateway <code>192.0.2.1</code>, DNS <code>192.0.2.1</code>.",
   "Make the address static (manual method).",
   "Make it apply automatically on boot."
  ],
  "solutionHtml_en": "<pre><code class=\"lang-bash\">nmcli con mod ens3 ipv4.addresses 192.0.2.50/24\nnmcli con mod ens3 ipv4.gateway 192.0.2.1\nnmcli con mod ens3 ipv4.dns 192.0.2.1\nnmcli con mod ens3 ipv4.method manual\nnmcli con mod ens3 connection.autoconnect yes\nnmcli con up ens3\n\n# verify\nnmcli -g ipv4.addresses con show ens3\nip -4 addr show ens3</code></pre>",
  "pitfallsHtml_en": [
   "Forgetting <code>ipv4.method manual</code> leaves the interface on DHCP.",
   "Run <code>nmcli con up</code> (or reactivate) to apply the change."
  ],
  "verifyHtml_en": [
   "<code>ip -4 addr show ens3</code> reports 192.0.2.50/24.",
   "<code>ipv4.method</code> is manual so the address is static.",
   "<code>connection.autoconnect</code> is yes so it applies on boot."
  ],
  "rebootCheckHtml_en": "autoconnect yes plus ipv4.method manual keeps the address after reboot.",
  "lab_en": [
   "ServerA - practice VM",
   "Interface: ens3 (example name).",
   "Run every command as root."
  ]
 },
 "s5": {
  "id": "s5",
  "title_en": "Open a service in firewalld permanently",
  "promptHtml_en": "Allow a service through firewalld, both now and permanently.",
  "specHtml_en": [
   "Allow the <code>http</code> service in the default zone.",
   "Make the rule permanent so it survives a reload and reboot."
  ],
  "solutionHtml_en": "<pre><code class=\"lang-bash\">firewall-cmd --add-service=http --permanent\nfirewall-cmd --reload\n\n# verify\nfirewall-cmd --list-services</code></pre>",
  "pitfallsHtml_en": [
   "Without <code>--permanent</code> the rule is lost on reload/reboot.",
   "Remember to run <code>--reload</code> (or also apply the runtime rule)."
  ],
  "verifyHtml_en": [
   "<code>firewall-cmd --list-services</code> includes http after reload.",
   "The rule survives a reload because <code>--permanent</code> was used."
  ],
  "rebootCheckHtml_en": "<code>--permanent</code> writes the rule to disk so it persists across reboot.",
  "lab_en": [
   "ServerA - practice VM",
   "Run every command as root."
  ]
 }
};
