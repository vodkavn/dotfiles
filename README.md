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

## Cheatsheet

- [Common Settings](doc/common.md)
- [Vim](doc/vim.md)
- [Tmux](doc/tmux.md)
- [Dracula Theme](doc/dracula.md)

## Screenshots

### Terminal

![terminal](https://github.com/vodkavn/dotfiles/blob/master/screenshots/terminal.png)

### Tmux

![tmux](https://github.com/vodkavn/dotfiles/blob/master/screenshots/tmux.png)

### Vim

![vim](https://github.com/vodkavn/dotfiles/blob/master/screenshots/vim.png)
