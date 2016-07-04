#!/bin/bash
#######START############

###### Add repo
# EPEL
rpm -Uvh http://dl.fedoraproject.org/pub/epel/7/x86_64/e/epel-release-7-5.noarch.rpm

# REMI
rpm -Uvh http://rpms.famillecollet.com/enterprise/remi-release-7.rpm

# RPMFORGE
rpm -Uvh http://pkgs.repoforge.org/rpmforge-release/rpmforge-release-0.5.3-1.el7.rf.x86_64.rpm

# RPMFUSION
# no repo for rhel 7

# ATRPMS
rpm -Uvh http://dl.atrpms.net/all/atrpms-repo-7-7.el7.x86_64.rpm

# WEBTATIC
rpm -Uvh http://repo.webtatic.com/yum/el7/webtatic-release.rpm

yum repolist

###### Set timezone
rm -f /etc/localtime
ln -sf /usr/share/zoneinfo/Asia/Ho_Chi_Minh /etc/localtime

###### Install package
yum -y install yum-plugin-replace

# htop
yum -y install htop

# vim
yum -y install vim
yum -y install ctags

# git
yum -y install git
yum -y install tig

# nginx, monit
yum -y install nginx
yum -y install monit

# php
#yum -y install php54w

# apache2 and enable on startup
#yum -y install httpd
#chkconfig --levels 235 httpd on
#/etc/init.d/httpd start

# mysql and enable on startup
#yum -y replace mysql-libs --replace-with mysql55w-libs #fix some error

#yum -y install mysql55w mysql55w-server
#chkconfig --levels 235 mysqld on
#/etc/init.d/mysqld start

# Install wget
yum install -y wget

# Install curl
yum install -y curl

# Nodejs
#yum -y install nodejs npm --enablerepo=epel

# Manual
yum install -y man

# Config mysql
mysql_secure_installation

# generate ssh-key
#ssh-keygen -t rsa -C "hoangxuanthanh1986@gmail.com"

#######END############
