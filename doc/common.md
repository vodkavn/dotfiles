# Common settings

## Grub for nvidia

### Centos

- Open `/etc/default/grub`
- Add `modprobe.blacklist=nouveau nouveau.modeset=0` to `GRUB_CMDLINE_LINUX`
- Update grub

```bash
sudo grub2-mkconfig -o /boot/efi/EFI/centos/grub.cfg
```

### Ubuntu

- Open `/etc/default/grub`
- Add `nouveau.modeset=0` to `GRUB_CMDLINE_LINUX`
- Update grub

```bash
sudo update-grub
```
