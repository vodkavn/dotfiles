# Docker settings

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

## Move docker data directory

Add to `/etc/docker/daemon.json`

```text
"data-root": "/home/docker",
```

Move files

```bash
sudo systemctl stop docker

sudo rsync -aP /var/lib/docker/ /home/docker

sudo systemctl start docker
```

## Add docker to firewall

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

## Clean up

```bash
docker volume rm $(docker volume ls -q -f dangling=true)
docker image rm $(docker images -q -f dangling=true)
```
