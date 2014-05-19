#!/bin/sh
if [ ! -d "$HOME/linux_workspace" ]; then
    echo "Cloning from GitHub"
    cd "$HOME"
    git clone https://github.com/vodkavn/linux_workspace.git
else
    echo "Updating from GitHub"
    cd "$HOME/linux_workspace"
    git pull -f origin master
fi


########################
echo "Back-up old config files..."
if [ -d "$HOME/.vim" ]; then
    mv -f $HOME/.vim $HOME/.vim_bak 
fi
if [ -f "$HOME/.vimrc" ]; then
    mv -f $HOME/.vimrc $HOME/.vimrc_bak
fi
if [ -d "$HOME/.bash" ]; then
    mv -f $HOME/.bash $HOME/.bash_bak 
fi
if [ -f "$HOME/.bashrc" ]; then
    mv -f $HOME/.bashrc $HOME/.bashrc_bak 
fi
if [ -f "$HOME/.bash_logout" ]; then
    mv -f $HOME/.bash_logout $HOME/.bash_logout_bak 
fi
if [ -f "$HOME/.bash_profile" ]; then
    mv -f $HOME/.bash_profile $HOME/.bash_profile_bak 
fi
if [ -f "$HOME/.gitconfig" ]; then
    mv -f $HOME/.gitconfig $HOME/.gitconfig_bak 
fi


########################
echo "Installing..."
cd "$HOME"
ln -sf $HOME/linux_workspace/vimrc .vimrc
ln -sf $HOME/linux_workspace/vim .vim
ln -sf $HOME/linux_workspace/bash_profile .bash_profile
ln -sf $HOME/linux_workspace/bash_logout .bash_logout
ln -sf $HOME/linux_workspace/bashrc .bashrc
ln -sf $HOME/linux_workspace/bash .bash
ln -sf $HOME/linux_workspace/gitconfig .gitconfig


########################
echo "DONE!"
echo "Please restart your terminal!"
