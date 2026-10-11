# Linux Workspace Configuration

My vimrc, bashrc, git, tmux... config for linux workspace

## Installation

```bash
bash -c "`curl -fsSL https://raw.githubusercontent.com/vodkavn/dotfiles/master/install.sh`"
```

### What will this command do?

- The script above will backup any existing config files/folders
  - `.vim`
  - `.vimrc`
  - `.bash`
  - `.bashrc`
  - `.bash_profile`
  - `.bash_logout`

  into `.setting_backup_{timestamp}` folder, and add create symlinks to the new config files/folders

- These files below will be skipped if existed
  - `.gitconfig`
  - `.tmux.conf`

## Local Validation

For Ubuntu 26.x, without changing your installed configuration:

```bash
bash scripts/doctor.sh
bash scripts/check.sh
```

Full checks require ShellCheck and bash-completion. See `bash scripts/check.sh --help`
for options or [AGENTS.md](AGENTS.md) for validation details.

## Continuous Integration

`.github/workflows/validate.yml` runs `bash scripts/check.sh` on every push and
pull request, so a change that breaks the suite locally fails on the runner too.
It installs its own prerequisites (`bash-completion`, `jq`, `shellcheck`) and
checks out without submodules, since `vim/bundle/` is vendored third-party code
that no check reads.

Workflow YAML is itself checked by `scripts/check.sh`, so a malformed workflow
fails locally instead of after a push.

## Cheatsheet

- [Common Settings](doc/common.md)
- [AI Coding](doc/ai.md)
- [Docker](doc/docker.md)
- [Git](doc/git.md)
- [Tmux](doc/tmux.md)
- [Vim](doc/vim.md)
- [OpenVPN](doc/openvpn.md)
- [Dracula Theme](doc/dracula.md)

## Screenshots

### Terminal

![terminal](https://github.com/vodkavn/dotfiles/blob/master/screenshots/terminal.png)

### Tmux

![tmux](https://github.com/vodkavn/dotfiles/blob/master/screenshots/tmux.png)

### Vim

![vim](https://github.com/vodkavn/dotfiles/blob/master/screenshots/vim.png)
