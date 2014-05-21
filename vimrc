augroup HighlightTrailingSpaces
    autocmd!
    autocmd VimEnter,WinEnter,ColorScheme * highlight TrailingSpaces term=underline guibg=Red ctermbg=Red
    autocmd VimEnter,WinEnter * match TrailingSpaces /\s\+$/
augroup END

" Auto delete vim/.netrwhist
au VimLeave * if filereadable($HOME."/.vim/.netrwhist")|call delete($HOME."/.vim/.netrwhist")|endif

"--------------------------------
" Vundle setting
set nocompatible
filetype off

if isdirectory($HOME."/.vim/bundle/Vundle.vim")
    set rtp+=~/.vim/bundle/Vundle.vim
    call vundle#begin()

    Plugin 'gmarik/Vundle.vim'

    " Plugin 'joonty/vim-phpqa'
    " Plugin 'altercation/solarized'
    Plugin 'altercation/vim-colors-solarized'
    Plugin 'chrisbra/csv.vim'
    Plugin 'scrooloose/nerdtree'

    Plugin 'kien/ctrlp.vim'
    Plugin 'tpope/vim-surround'
    Plugin 'scrooloose/nerdcommenter'
    Plugin 'Shougo/neocomplcache.vim'
    Plugin 'tpope/vim-fugitive'
    Plugin 'majutsushi/tagbar'

    call vundle#end()
endif

filetype plugin indent on
" End Vundle setting
"--------------------------------
" Other setting:
"
syntax on
set t_Co=256
set tabstop=4
set shiftwidth=4
set softtabstop=4
set expandtab
set smarttab
set shiftround
set autoindent
set smartindent
set number
set ruler
set backspace=2
set encoding=utf-8
set fileencoding=utf-8
set fileencodings=ucs-bom,korea,utf-8,sjis,default
" colorscheme koehler
" set cc=81
hi ColorColumn guibg=#2d2d2d ctermbg=246
filetype plugin indent on

"---------------------------------------------------------------------------
" Format coding:
"
" Pass arguments to phpcs binary
let g:phpqa_codesniffer_args = "--standard=Zend"
" Another example
let g:phpqa_codesniffer_args = "--standard=/path/to/xml/file.xml --tab-width=4"
" PHP codesniffer binary (default = phpcs)
let g:phpqa_codesniffer_cmd='/path/to/phpcs'
" Run codesniffer on save (default = 1)
let g:phpqa_codesniffer_autorun = 0
let g:phpqa_messdetector_ruleset = "/path/to/phpmd.xml"
" PHP mess detector binary (default = phpmd)
let g:phpqa_messdetector_cmd='/path/to/phpmd'
" Run mess detector on save (default = 1)
let g:phpqa_messdetector_autorun = 0


"---------------------------------------------------------------------------
" Search:
"
" Ignore the case of normal letters.
set ignorecase
" If the search pattern contains upper case characters, override ignorecase option.
set smartcase

" Enable incremental search.
set incsearch
" Don't highlight search result.
set nohlsearch

" Searches wrap around the end of the file.
set wrapscan

"---------------------------------------------------------------------------
" Load plugin by pathogen
"
execute pathogen#infect()
filetype plugin indent on

"---------------------------------------------------------------------------
" Config NERDTree
"
if isdirectory($HOME."/.vim/bundle/nerdtree")
    autocmd vimenter * NERDTree
    autocmd vimenter * if !argc() | NERDTree | endif
    autocmd bufenter * if (winnr("$") == 1 && exists("b:NERDTreeType") && b:NERDTreeType == "primary") | q | endif
    map <C-n> :NERDTreeToggle<CR>
endif

"---------------------------------------------------------------------------
" Config Color theme
"
if isdirectory($HOME."/.vim/bundle/vim-colors-solarized")
    set background=dark
    let g:solarized_termcolors=256
    colorscheme solarized
endif
"---------------------------------------------------------------------------

