if command -v aws_completer >/dev/null 2>&1; then
    complete -C "$(command -v aws_completer)" aws
fi
