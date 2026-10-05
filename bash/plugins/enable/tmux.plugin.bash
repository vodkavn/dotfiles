# tmux is left to use the terminal-provided TERM (e.g. tmux-256color) so
# correct terminfo is used. Previously forced TERM=xterm-256color, which
# discarded modern terminal capabilities.

cite about-plugin
about-plugin 'no-op: TMUX TERM is provided by the terminal'
