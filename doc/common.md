# Common settings

## Grub for nvidia

- Open `/etc/default/grub`
- Append to `GRUB_CMDLINE_LINUX`
  - Centos: `modprobe.blacklist=nouveau nouveau.modeset=0`
  - Ubuntu: `nouveau.modeset=0`
- Update grub

```bash
# Redhat
sudo grub2-mkconfig -o /boot/efi/EFI/redhat/grub.cfg
# Centos
sudo grub2-mkconfig -o /boot/efi/EFI/centos/grub.cfg
# Ubuntu
sudo update-grub
```

## RHEL remove old kernels

```bash
# Check Installed Kernels and All Kernel Packages
rpm -qa kernel\* |sort -V

# Remove Old Kernels
sudo dnf remove $(dnf repoquery --installonly --latest-limit=-2 -q)
```

## Docker config

- Create file `/etc/docker/daemon.json`

```text
{
  "dns": ["8.8.8.8", "8.8.4.4", "1.1.1.1"],
  "default-address-pools":[
    {"base":"10.201.0.0/16","size":24},
    {"base":"10.202.0.0/16","size":24}
  ]
}
```

- Add docker to firewall

```bash
# Check what interface docker is using, e.g. 'docker0'
ip link show

# Check available firewalld zones, e.g. 'public'
sudo firewall-cmd --get-active-zones

# Check what zone the docker interface it bound to, most likely 'no zone' yet
sudo firewall-cmd --get-zone-of-interface=docker0

# So add the 'docker0' interface to the 'public' zone. Changes will be visible only after firewalld reload
sudo nmcli connection modify docker0 connection.zone public

# Masquerading allows for docker ingress and egress (this is the juicy bit)
sudo firewall-cmd --zone=public --add-masquerade --permanent
# Optional open required incomming ports (wasn't required in my tests)
# sudo firewall-cmd --zone=public --add-port=443/tcp
# Reload firewalld
sudo firewall-cmd --reload

# Reload dockerd
sudo systemctl restart docker
```

## Change display server to classic

- Change file `/etc/gdm/custom.conf`

```text
WaylandEnable=false
```

## Bluetooth mouse

```bash
$ bluetoothctl

// scan for bluetooth devices (make sure your mouse is in discovery mode before running this command)
[bluetooth]# scan on
...
[bluetooth]# scan off
Discovery stopped

// turn the agent on just incase you need to supply a pin code
[bluetooth]# agent on
Agent registered

[bluetooth]# pair 88:E7:A6:06:FC:87
...
[CHG] Device 88:E7:A6:06:FC:87 Paired: yes
Pairing successful
[CHG] Device 88:E7:A6:06:FC:87 Connected: no

// once you have done this use the following two commands to
// complete setup
[bluetooth]# connect 88:E7:A6:06:FC:87
...
[bluetooth]# trust 88:E7:A6:06:FC:87
...
```

## History with timestamp

```bash
$ HISTTIMEFORMAT="%d/%m/%y %T " history
```
