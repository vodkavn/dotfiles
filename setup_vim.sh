#!/bin/bash
#---------------------------
# Compile vim 7.4 from source code
#
# yum -y remove $(rpm -qa | grep ^vim)
# yum -y groupinstall 'Development tools'
# yum -y install ncurses ncurses-devel

yum -y install gcc make ncurses-devel

cd /usr/local/src
wget ftp://ftp.vim.org/pub/vim/unix/vim-7.4.tar.bz2
tar jxvf vim-*.tar.bz2
rm -f vim-*.tar.bz2
cd vim*
./configure --prefix=/usr --with-features=huge --enable-multibyte
make
make install


#---------------------------
