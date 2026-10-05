#!/bin/bash
#
# -binaryanomaly

cite 'about-alias'
about-alias 'kubectl aliases'

function _set_pkg_aliases()
{
  if _command_exists kubectl; then
    alias kc='kubectl'
    alias kcgp='kubectl get pods'
    alias kcgd='kubectl get deployments'
    alias kcgn='kubectl get nodes'
    alias kcgs='kubectl get services'
    alias kcdp='kubectl describe pod'
    alias kcdd='kubectl describe deployment'
    alias kcdn='kubectl describe node'
    alias kcds='kubectl describe services'
    alias kcgpan='kubectl get pods --all-namespaces'
    alias kcgdan='kubectl get deployments --all-namespaces'
    alias kcgnan='kubectl get nodes --all-namespaces'
    alias kcgsan='kubectl get services --all-namespaces'
    # launches a disposable netshoot pod in the k8s cluster
    # --generator was removed in Kubernetes 1.18; --restart=Never is the replacement
    alias kcnetshoot='kubectl run "netshoot-$(date +%s)" --restart=Never --rm -i --tty --image nicolaka/netshoot -- /bin/bash'
  fi
}

_set_pkg_aliases
