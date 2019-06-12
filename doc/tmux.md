# tmux cheatsheet

## Command line

    $ tmux                           -> start new
    $ tmux new -s myname             -> start new w/session name
    $ tmux a  #  (or at, or attach)  -> attach
    $ tmux a -t myname               -> attach to named
    $ tmux ls                        -> list sessions
    $ tmux kill-session -t myname    -> kill session w/name

## Quick, oft-used shortcuts (defined in ~/.tmux.conf)

    ctrl-arrow  -> toggle window in arrow direction
    alt-arrow    -> toggle pane in arrow direction

## Tmux command mode - in tmux, type the prefix (default is `ctrl+b`, I use `ctrl+a`) and then

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
