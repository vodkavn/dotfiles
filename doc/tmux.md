# tmux/tmuxinator cheatsheet

## tmux

## Command line
    $ tmux                           -> start new
    $ tmux new -s myname             -> start new w/session name
    $ tmux a  #  (or at, or attach)  -> attach
    $ tmux a -t myname               -> attach to named
    $ tmux ls                        -> list sessions
    $ tmux kill-session -t myname    -> kill session w/name

### Shortcuts (via .oh-my-zsh/plugins/tmux/tmux.plugin.zsh)
* ta    =  tmux attach -t
* ts    =  tmux new-session -s
* tl    =  tmux list-sessions
* tksv  =  tmux kill-server
* tkss  =  tmux kill-session -t

## Quick, oft-used shortcuts (defined in ~/.tmux.conf)
    shift-arrow  -> toggle window in arrow direction
    alt-arrow    -> toggle pane in arrow direction

## Tmux command mode - in tmux, type the prefix (default is `ctrl+b`, I use `ctrl+q`) and then:

### Sessions
    :new<CR>  -> new session
    s         -> list sessions
    $         -> name session

### Windows (tabs)
    l            -> last window
    c            -> new window
    ,            -> name window
    w            -> list windows
    f            -> find window
    &            -> kill window
    .            -> move window - prompted for a new number
    :movew<CR>   -> move window to the next unused number

### Panes (splits)
    -          -> horizontal split (defined in ~/.tmux.conf)
    |          -> vertical split (defined in ~/.tmux.conf)
    Ctrl-q     -> quick swap (defined in ~/.tmux.conf)
    o          -> swap panes
    q          -> show pane numbers
    x          -> kill pane
    !          -> kill all panes except current
    ⍽          -> space - toggle between layouts

### Window/pane surgery
  (following 4 commands specified in ~/.tmux.conf)
    h                 -> stretch/shrink left side of pane
    j                 -> stretch/shrink bottom of pane
    k                 -> stretch/shrink top of pane
    l                 -> stretch/shrink right side of pane
    :joinp -s :2<CR>  -> move window 2 into a new pane in the current window
    :joinp -t :1<CR>  -> move the current pane into a new pane in window 1

* [Move window to pane](http://unix.stackexchange.com/questions/14300/tmux-move-window-to-pane)
* [How to reorder windows](http://superuser.com/questions/343572/tmux-how-do-i-reorder-my-windows)

### Misc
    [  -> "copy" or "scroll" mode - from here type Fn+Arrow or use mouse scrollwheel
    r  -> reload config (defined in ~/.tmux.conf)
    d  -> detach
    t  -> big clock
    ?  -> mlist shortcuts
    :  -> prompt

## Copy & Paste w/the System Clipboard
    1. Enter copy mode           $ <prefix> [
    2. Enter selection mode      $ v
    3. Move to end of selection  $ arrows or hjkl
    4. Copy selected text        $ y or <Enter>
    5. Paste copied text         $ ctrl+p

## Resources:

* [cheat sheet](http://cheat.errtheblog.com/s/tmux/)

Notes:

* You can cmd+click URLs to open in iTerm.
* You can cmd+double-click strings to select w/iTerm (and the cmd+c to copy)
  * HOWEVER: If you are copying text and multiple tmux panes are open, it will copy across panes! This is usually undesirable. It is recommended to use the above copy-paste instructions for copying to the system clipboard from within tmux.

## Tmuxinator

As configured in [my dotfiles](https://github.com/crittelmeyer/dotfiles/blob/master/oh-my-zsh/plugins/tmuxinator/_tmuxinator).

* mux new [PROJECT] => create new project and open config in editor
* mux copy [EXISTING] [NEW] => copy existing project to new project and open config in editor
* mux list => list all projects
* mux delete [PROJECT] => delete project
* mux help => more commands + descriptions
* mux implode => delete all projects
