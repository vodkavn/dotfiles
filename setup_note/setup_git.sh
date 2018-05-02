#!/bin/bash
#--------------------
# install git from source code
#
yum -y groupinstall "Development Tools"
yum -y install zlib-devel perl-ExtUtils-MakeMaker asciidoc xmlto openssl-devel
cd ~
wget -O git.zip https://github.com/git/git/archive/master.zip
unzip git.zip
cd git-master
make configure
./configure --prefix=/usr/local
make prefix=/usr/local all
make install
#make all doc
#make install install-doc install-html


#--------------------



