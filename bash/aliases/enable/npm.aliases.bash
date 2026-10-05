cite 'about-alias'
about-alias 'common npm abbreviations'

# Aliases
# npm saves dependency changes by default; retain the explicit --save aliases.
# Install to dependencies
alias ni='npm install'
# Install and save to dependencies (npm 5+ default; --save kept for explicitness)
alias nis='npm install --save'
# Install and save to devDependencies
alias nid='npm install --save-dev'
# Install and run tests
alias nit='npm install-test'
alias nits='npm install-test --save'
alias nitd='npm install-test --save-dev'
# Uninstall (removal from package.json is the npm 5+ default)
alias nu='npm uninstall'
alias nus='npm uninstall --save'
alias nusd='npm uninstall --save-dev'
alias np='npm publish'
alias nup='npm unpublish'
alias nlk='npm link'
alias nod='npm outdated'
alias nrb='npm rebuild'
alias nud='npm update'
alias nr='npm run'
alias nls='npm list --depth=0 2>/dev/null'
alias nlsg='npm list -g --depth=0 2>/dev/null'
