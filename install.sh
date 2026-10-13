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
file_list=(vim vimrc tmux bash bashrc bash_profile bash_logout)
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
# Install AI configuration
#
# Like every other entry here, the source path is named after its $HOME target:
#   config/opencode/opencode.json  ->  ~/.config/opencode/opencode.json
#   config/opencode/plugins/       ->  ~/.config/opencode/plugins/
#
# opencode auto-discovers ~/.config/opencode/plugins/ and the project's
# .opencode/plugins/, so these plugins need no entry in opencode.json.
# A plugin directory is discovered from its flat sibling entries: index.ts for a
# server plugin, tui.tsx for one that draws; a directory holding only index.ts
# loads fine as a server-only plugin. A nested src/ directory or a package.json
# is not resolved.
#
# inspector draws in the sidebar, so it has an index.ts plus a tui.tsx.
# shell-guard and compaction-memory only change behaviour, so each is index.ts
# alone.
#
# Skills under .opencode/skills/ stay project-scoped: that directory belongs to
# this repository, not to the global layer, and is never linked here. Global
# skills, if any are added later, would live in config/opencode/skills/ and are
# picked up by the discovery below.
#
# config/opencode/commands/ is the one command directory that is global:
# new-ai.md scaffolds agents, skills, and commands for whatever project you are
# standing in, so it is useful everywhere. What it creates is still project-level.
#
# Community packages installed with `opencode plugin add` land in the same
# ~/.config/opencode/plugins/ directory but are NOT symlinked from here. Linking
# each plugin individually, as this used to, meant every new plugin needed an
# edit to the list below plus a re-run to take effect. Instead the tree is
# discovered at run time: one entry per top-level JSON file and directory in
# config/opencode/, plus one entry per plugin inside config/opencode/plugins/.
# Adding a plugin, agent, command, or skill under config/opencode/ is therefore
# enough on its own; nothing in this file needs to change.
#
# Plugins installed with `opencode plugin add` are real directories rather than
# symlinks, so the "unchanged" test below never matches them and they are left
# in place. Only an entry that is already a symlink into this checkout, or a
# file this repository is meant to own, is ever replaced.
#
# opencode merges two layers, global first and project second:
#   $HOME/.config/opencode/      global; applies to every project
#   $HOME/.dotfiles/.opencode/   project; this repository only
#
# The global layer carries CLI-wide settings, MCP servers, agents, references,
# tool-agnostic commands, and plugins. Repository-specific commands, skills, and
# permission rules stay project-scoped in .opencode/. Note that ~/.opencode is
# opencode's own data directory, not its config directory; never link this
# repository's .opencode there.
#
ai_global=$HOME/.config/opencode
ai_src=$HOME/.dotfiles/config/opencode

# Build the link list from the filesystem rather than a hardcoded array. Emits
# paths relative to config/opencode/ (opencode.json, plugins/inspector, ...) and
# is sorted so two runs print the same order.
#
#   top-level *.json  the config file itself
#   plugins/*/        each plugin on its own, so a plugin directory is never
#                     merged wholesale into ~/.config/opencode/plugins/, which
#                     would collide with community plugins living there
#   other top-level   agents/, commands/, skills/ and anything added later,
#   directories       linked whole
#
ai_link_list=$(
    cd "$ai_src" 2>/dev/null || exit 0
    {
        find . -mindepth 1 -maxdepth 1 -type f -name '*.json' -printf '%P\n'
        find . -mindepth 2 -maxdepth 2 -type d -path './plugins/*' -printf '%P\n'
        find . -mindepth 1 -maxdepth 1 -type d ! -name plugins -printf '%P\n'
    } | LC_ALL=C sort
)

if command -v opencode >/dev/null 2>&1; then
    echo "Installing AI configuration..."
    if [ -z "$ai_link_list" ]; then
        echo "--> No global AI configuration found in $ai_src, skipped"
    fi
    for file in $ai_link_list
    do
        src=$ai_src/$file
        dst=$ai_global/$file
        if [ ! -e "$src" ]; then
            echo "--> Missing $src, skipped"
            continue
        fi
        if [ -L "$dst" ] && [ "$(readlink "$dst")" = "$src" ]; then
            echo "--> .config/opencode/$file unchanged"
            continue
        fi
        if [ -e "$dst" ]; then
            mkdir -p $Dir_bak/ai/$(dirname "$file")
            echo "--> Backing up .config/opencode/$file to $Dir_bak/ai/$file"
            mv -f "$dst" $Dir_bak/ai/$file
            echo "-->   Merge anything worth keeping from $Dir_bak/ai/$file"
        fi
        echo "--> Installing .config/opencode/$file..."
        mkdir -p $(dirname "$dst")
        ln -sf "$src" "$dst"
        case $file in
            *.json)
                if command -v jq >/dev/null 2>&1; then
                    jq empty "$dst" || echo "-->   WARNING: $file is not valid JSON"
                fi
                ;;
        esac
    done
    echo "--> Restart any running opencode; it caches config at startup."
else
    echo "--> opencode not found, skipping AI configuration"
    echo "-->   Re-run this script after installing opencode."
fi

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
bash "$HOME/.dotfiles/.kilo/suggest-tools.sh"
echo "DONE!"
source $HOME/.bashrc
########################
