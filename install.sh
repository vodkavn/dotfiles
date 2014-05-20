#!/bin/shi
#
# Clone from GitHub
#
if [ ! -d "$HOME/linux_workspace" ]; then
    echo "Cloning from GitHub"
    cd "$HOME"
    git clone --recursive https://github.com/vodkavn/linux_workspace.git
else
    echo "Updating from GitHub"
    cd "$HOME/linux_workspace"
    git pull -f origin master
    git submodule update --init
    git submodule foreach git pull -f origin master
fi


########################
#
# Backup folder
#
timestamp=$(date -d "today" +"%Y%m%d%H%M")
Dir_bak=$HOME/.setting_backup_$timestamp

#
# Setting file list
#
file_list=(vim vimrc bash bashrc bash_profile bash_logout)

#
# Start
#
for file in ${file_list[*]}
do
    echo "Editing .$file..."
    Dir=$HOME/.$file
    # Check if file or directory exist?
    if [[ -d $Dir || -f $Dir ]]; then
        echo "--> Backing up .$file to $Dir_bak"
        # Check and create backup folder
        if [ ! -d $Dir_bak ]; then
            mkdir $Dir_bak
        fi
        # Move file or directory to backup folder
        mv -f $Dir $Dir_bak/
    fi
    # Create link to config file
    echo "--> Installing .$file..."
    ln -sf $HOME/linux_workspace/$file $HOME/.$file
done

#
########################
# Install Vim plugins using Vundle
echo "Install Vim plugins using Vundle..."
vim +PluginInstall +qall
#
########################
#
echo "DONE!"
echo "Please restart your terminal!"
########################
