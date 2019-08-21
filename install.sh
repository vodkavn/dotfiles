#!/bin/bash
#
# Clone from GitHub
#
if [ ! -d "$HOME/.dotfiles" ]; then
    echo "Cloning from GitHub"
    cd "$HOME"
    git clone --recursive https://github.com/vodkavn/dotfiles.git .dotfiles
else
    echo "Updating from GitHub"
    cd "$HOME/.dotfiles"
    # git reset --hard
    # git pull -f origin master
    git pull -s recursive -X theirs
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
cp_file_list=(gitconfig tmux.conf)

#
# Start
#
for file in ${file_list[*]}
do
    echo "Checking .$file..."
    Dir=$HOME/.$file
    # Check if file or directory exist?
    if [[ -d $Dir || -f $Dir ]]; then
        if cmp -s "$Dir" "$HOME/.dotfiles/$file"; then
            echo "--> File unchanged"
        else
            echo "--> Backing up .$file to $Dir_bak"
            # Check and create backup folder
            if [ ! -d $Dir_bak ]; then
                mkdir $Dir_bak
            fi
            # Move file or directory to backup folder
            mv -f $Dir $Dir_bak/
            # Create link to config file
            echo "--> Installing .$file..."
            ln -sf $HOME/.dotfiles/$file $HOME/.$file
        fi
    else
        # Create link to config file
        echo "--> Installing .$file..."
        ln -sf $HOME/.dotfiles/$file $HOME/.$file
    fi
done

for file in ${cp_file_list[*]}
do
    echo "Checking .$file..."
    Dir=$HOME/.$file
    # Check if file or directory exist?
    if [[ -d $Dir || -f $Dir ]]; then
        # Do nothing
        echo "--> Skipping existed config file"
    else
        # Copy config file instead of liking
        echo "--> Installing .$file..."
        cp -f $HOME/.dotfiles/$file $HOME/.$file
    fi
done

#
########################
# Install Powerline Font
echo "Install Powerline Font..."
font_dir="$HOME/.local/share/fonts"
font_config_dir="$HOME/.config/fontconfig/conf.d"
mkdir -p $font_dir
mkdir -p $font_config_dir

echo "Copying fonts..."
cp -f $HOME/.dotfiles/font/*.otf $font_dir/
if which fc-cache >/dev/null 2>&1 ; then
    echo "Resetting font cache, this may take a moment..."
    fc-cache -vf "$font_dir"
fi
cp -f $HOME/.dotfiles/font/*.conf $font_config_dir/

#
########################
# Install Vim plugins using Vundle
echo "Install Vim plugins using Vundle..."
vim +PluginInstall +PluginClean! +qall
#
########################
#
echo "DONE!"
source $HOME/.bashrc
########################
