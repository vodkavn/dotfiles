#!/bin/bash
#######START############

###### Add repo
# EPEL
rpm --import https://fedoraproject.org/static/0608B895.txt
rpm -Uvh http://dl.fedoraproject.org/pub/epel/6/x86_64/epel-release-6-8.noarch.rpm

# REMI
#rpm -Uvh http://rpms.famillecollet.com/enterprise/remi-release-6.rpm
rpm -Uvh http://rpms.famillecollet.com/enterprise/6/remi/x86_64/remi-release-6.5-1.el6.remi.noarch.rpm

rpm -Uvh http://mirror.webtatic.com/yum/el6/latest.rpm

# RPMFORGE
rpm --import http://apt.sw.be/RPM-GPG-KEY.dag.txt
rpm -Uvh http://pkgs.repoforge.org/rpmforge-release/rpmforge-release-0.5.3-1.el6.rf.x86_64.rpm

# RPMFUSION
rpm -Uvh http://download1.rpmfusion.org/free/el/updates/6/i386/rpmfusion-free-release-6-1.noarch.rpm
rpm -Uvh http://download1.rpmfusion.org/nonfree/el/updates/6/i386/rpmfusion-nonfree-release-6-1.noarch.rpm

# ELREPO
rpm --import https://www.elrepo.org/RPM-GPG-KEY-elrepo.org
rpm -Uvh http://www.elrepo.org/elrepo-release-6-6.el6.elrepo.noarch.rpm

yum repolist

###### Set timezone
ln -sf /usr/share/zoneinfo/Asia/Ho_Chi_Minh /etc/localtime

###### Install package
yum -y install yum-plugin-replace

# htop
yum -y install htop

# vim
yum -y install vim

# git
yum -y install git
yum -y install tig

# nginx, monit
yum -y install nginx
yum -y install monit

# php
yum -y install php54w

# apache2 and enable on startup
yum -y install httpd
chkconfig --levels 235 httpd on
/etc/init.d/httpd start

# mysql and enable on startup
yum -y replace mysql-libs --replace-with mysql55w-libs #fix some error

yum -y install mysql55w mysql55w-server
chkconfig --levels 235 mysqld on
/etc/init.d/mysqld start

# Install wget
yum install -y wget

# Install curl
yum install -y curl

# Nodejs
yum -y install nodejs npm --enablerepo=epel

# Manual
yum install -y man

# Config mysql
mysql_secure_installation

# generate ssh-key
#ssh-keygen -t rsa -C "hoangxuanthanh1986@gmail.com"

#######END############
