#!/bin/sh
if [ ! -d "$HOME/linux_workspace" ]; then
  echo "Cloning from GitHub"
  git clone https://github.com/vodkavn/linux_workspace.git
fi

cd "$HOME/linux_workspace"

echo "Configuring vim setting..."
cp -rf .vim ~/
cp -f .vimrc ~/

echo "Configuring bash setting..."
cp -rf .bash ~/
cp -f .bashrc ~/
cp -f .bash_logout ~/
cp -f .bash_profile ~/

echo "Configuring git setting..."
cp -f .gitconfig ~/

echo "DONE!"
echo "Please restart your terminal!"
