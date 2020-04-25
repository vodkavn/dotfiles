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

## Install vim with +lua and +clipboard

```bash
# Centos
# Install requirement libs and tools
sudo yum install -y gcc \
    ctags               \
    ncurses             \
    ncurses-devel       \
    lua-devel           \
    python-devel        \
    libX11-devel        \
    libXtst-devel       \
    libXt-devel         \
    libXpm-devel        \
    libSM-devel
# Get vim 7.4
wget -O ~/vim-7.4.tar.bz2 ftp://ftp.vim.org/pub/vim/unix/vim-7.4.tar.bz2
tar -xjf ~/vim-7.4.tar.bz2 -C ~
# Build and install
cd ~/vim74/src
make distclean
./configure --prefix=/usr     \
    --enable-luainterp        \
    --enable-pythoninterp     \
    --enable-cscope           \
    --disable-netbeans        \
    --enable-multibyte        \
    --enable-largefile        \
    --enable-gui=auto         \
    --with-x=yes              \
    --x-includes=/usr/include \
    --x-libraries=/usr/lib64  \
    --with-features=huge
make -j8
sudo make install
sudo cp -ru ~/vim/src/vim /usr/bin
sudo ln -fs /usr/bin/vim /usr/local/bin/vim

```
