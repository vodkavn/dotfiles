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

## Change display server to classic

- Change file `/etc/gdm/custom.conf`

```text
WaylandEnable=false
```

## History with timestamp

```bash
$ HISTTIMEFORMAT="%d/%m/%y %T " history
```
