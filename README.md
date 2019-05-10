# Linux Workspace Configuration

My vimrc, bashrc, git, tmux... config for linux workspace

## Installation

```bash
bash -c "`curl -fsSL https://raw.githubusercontent.com/vodkavn/linux_workspace/master/install.sh`"
```

### Post-installation

- Install `xclip` to use system clipboard in `tmux`

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

- [Vim](doc/vim.md)
- [Tmux](doc/tmux.md)
- [Dracula Theme](doc/dracula.md)

## Screenshots

### Terminal

![terminal](https://user-images.githubusercontent.com/26565145/57319190-fdb23c80-7136-11e9-9ab7-41ec70211d09.png)

### Tmux

![tmux](https://user-images.githubusercontent.com/26565145/57541596-59283880-738a-11e9-8579-6f5520cf98fb.png)

### Vim

![vim](https://user-images.githubusercontent.com/26565145/57319244-1b7fa180-7137-11e9-865e-b8c3903ba720.png)
