#!/bin/bash
###################
yum install -y wget
rpm --import https://fedoraproject.org/static/0608B895.txt
rpm -Uvh http://dl.fedoraproject.org/pub/epel/6/x86_64/epel-release-6-8.noarch.rpm
rpm -Uvh http://rpms.famillecollet.com/enterprise/remi-release-6.rpm
rpm -Uvh http://mirror.webtatic.com/yum/el6/latest.rpm
rpm --import http://apt.sw.be/RPM-GPG-KEY.dag.txt
rpm -Uvh http://pkgs.repoforge.org/rpmforge-release/rpmforge-release-0.5.3-1.el6.rf.x86_64.rpm
rpm -Uvh http://download1.rpmfusion.org/free/el/updates/6/i386/rpmfusion-free-release-6-1.noarch.rpm
rpm -Uvh http://download1.rpmfusion.org/nonfree/el/updates/6/i386/rpmfusion-nonfree-release-6-1.noarch.rpm

yum repolist

###################
ln -sf /usr/share/zoneinfo/Asia/Ho_Chi_Minh /etc/localtime

###################
yum -y install yum-plugin-replace
yum -y install nodejs npm --enablerepo=epel

yum -y install htop

yum -y install vim

yum -y install git
yum -y install tig

yum -y install nginx
yum -y install monit

yum -y install php54w

yum -y install httpd
chkconfig --levels 235 httpd on
/etc/init.d/httpd start

yum -y replace mysql-libs --replace-with mysql55w-libs
yum -y install mysql55w mysql55w-server
chkconfig --levels 235 mysqld on
/etc/init.d/mysqld start
mysql_secure_installation
#ssh-keygen -t rsa -C "hoangxuanthanh1986@gmail.com"
###################
