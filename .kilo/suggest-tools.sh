#!/bin/bash

# This script only prints suggestions; it never installs or configures tools.
if [ ! -r /etc/os-release ]; then
    exit 0
fi
. /etc/os-release
case " ${ID:-} ${ID_LIKE:-} " in
    *" ubuntu "*|*" debian "*) ;;
    *) exit 0 ;;
esac

printf '\nAI CLI toolchain (optional, Ubuntu/Debian)\n'
printf 'Suggestions only. Review and run these commands yourself.\n'

packages=()
for entry in rg:ripgrep jq:jq shellcheck:shellcheck gh:gh git-delta:git-delta shfmt:shfmt; do
    tool=${entry%%:*}
    if ! command -v "$tool" >/dev/null 2>&1; then
        packages+=("${entry#*:}")
    fi
done

if ! command -v fd >/dev/null 2>&1 && ! command -v fdfind >/dev/null 2>&1; then
    packages+=(fd-find)
fi
if ! command -v bat >/dev/null 2>&1 && ! command -v batcat >/dev/null 2>&1; then
    packages+=(bat)
fi
if [ "${#packages[@]}" -gt 0 ]; then
    printf '\nMissing apt packages (search, JSON, Bash lint, GitHub CLI, diff review):\n'
    printf '  sudo apt update && sudo apt install'
    printf ' %s' "${packages[@]}"
    printf '\n'
fi

if ! command -v fd >/dev/null 2>&1; then
    printf '\nfd-find provides fdfind, not fd. After installation, optionally expose fd:\n'
    printf '  mkdir -p "$HOME/.local/bin"\n'
    printf '  ln -s /usr/bin/fdfind "$HOME/.local/bin/fd"\n'
fi
if ! command -v bat >/dev/null 2>&1; then
    printf '\nbat provides batcat on Ubuntu/Debian. After installation, optionally expose bat:\n'
    printf '  mkdir -p "$HOME/.local/bin"\n'
    printf '  ln -s /usr/bin/batcat "$HOME/.local/bin/bat"\n'
fi

if ! command -v glab >/dev/null 2>&1; then
    printf '\nGitLab CLI (glab) is not carried in the Ubuntu archive. Consult upstream\n'
    printf 'installation instructions rather than an unofficial mirror:\n'
    printf '  https://gitlab.com/gitlab-org/cli/-/blob/main/docs/install/linux.md\n'
fi

if ! command -v difft >/dev/null 2>&1; then
    printf '\nOptional structural diff (difftastic), not in the Ubuntu archive:\n'
    printf '  https://difftastic.wilfred.me.uk/\n'
fi

if ! command -v npx >/dev/null 2>&1; then
    printf '\nNode.js (npx) is required by the sequential-thinking MCP server and by\n'
    printf 'npm-based tools such as ast-grep. The Ubuntu archive ships an outdated\n'
    printf 'release, so use nvm and install the current LTS:\n'
    printf '  https://github.com/nvm-sh/nvm#installing-and-updating\n'
    printf '  nvm install --lts\n'
    printf '  nvm use --lts\n'
    printf 'Direct downloads: https://nodejs.org/en/download\n'
    printf 'Never install global npm packages with sudo.\n'
fi

if ! command -v ast-grep >/dev/null 2>&1; then
    printf '\nOptional structural search: ast-grep (not the unrelated system sg command).\n'
    printf '  npm install -g @ast-grep/cli\n'
    printf '  Requires npx/npm; see the Node.js suggestion above.\n'
    printf '  Use a user-owned npm prefix or Node version manager; do not use sudo npm.\n'
fi

printf '\nVerify required tools with command -v <tool>; restart your shell if PATH changed.\n'
