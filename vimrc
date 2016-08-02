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

    " vundle itself
    Plugin 'gmarik/Vundle.vim'

    " find files
    Plugin 'kien/ctrlp.vim'
    " colorschemes
    Plugin 'flazz/vim-colorschemes'
    " solarized-dark colorscheme
    Plugin 'altercation/vim-colors-solarized'
    " csv display
    Plugin 'chrisbra/csv.vim'
    " nerdtree
    Plugin 'scrooloose/nerdtree'
    " html close tag
    Plugin 'docunext/closetag.vim'
    " autoclose braces
    Plugin 'Raimondi/delimitMate'
    " auto complete
    Plugin 'Shougo/neocomplcache.vim'
    " indent for html
    Bundle 'captbaritone/better-indent-support-for-php-with-html'
    " qa for php code
    Plugin 'joonty/vim-phpqa'
    " grep plugin
    Bundle 'yegappan/grep'
    " surroundings
    Plugin 'tpope/vim-surround'
    " Git wrapper
    Plugin 'tpope/vim-fugitive'
    " tag bar
    Plugin 'majutsushi/tagbar'
    " custom statusline, tabline
    Plugin 'vim-airline/vim-airline'

    Plugin 'scrooloose/nerdcommenter'

    call vundle#end()
endif
" End Vundle setting
"--------------------------------
" Other setting:
"
" set mouse=a                     " Enable mouse
set t_Co=256
set clipboard=unnamed
set noswapfile
set fileformat=unix
set tabstop=4
set shiftwidth=4
set softtabstop=4
set expandtab                   " Use spaces instead of tabs
set smarttab                    " Be smart when using tabs ;)
set wildmenu                    " show list instead of just completing
" set spell                       " spell checking on
set ffs=unix,dos,mac            " Use Unix as the standard file type
" set showcmd                     " show (partial) commands
set autoread                    " Set to auto read when a file is changed from the outside
set wildignore=*.o,*~,*.pyc     " Ignore compiled files
let g:reload_on_write = 0
set shiftround
set autoindent
set smartindent
set number
set ruler
set backspace=indent,eol,start
set laststatus=2

set backspace=indent,eol,start  " Backspace for dummies
set linespace=0                 " No extra spaces between rows
set showmatch                   " Show matching brackets/parenthesis
set winminheight=0              " Windows can be 0 line high
set ignorecase                  " Case insensitive search
set smartcase                   " Case sensitive when uc present
set wildmenu                    " Show list instead of just completing
set wildmode=list:longest,full  " Command <Tab> completion, list matches, then longest common part, then all.
set omnifunc=syntaxcomplete#Complete
set whichwrap=b,s,h,l,<,>,[,]   " Backspace and cursor keys wrap too
set scrolljump=5                " Lines to scroll when cursor leaves screen
set scrolloff=3                 " Minimum lines to keep above and below cursor
let g:DisableAutoPHPFolding = 1 " Disable autofold
set list listchars=tab:\¦\ ,trail:•,extends:#,nbsp:. " Highlight problematic whitespace
set list


set fileformats=dos
set ffs=unix,dos,mac            " Use Unix as the standard file type
" Encode setting
set encoding=utf-8
set fileencoding=utf-8
" set fileencodings=ucs-bom,korea,utf-8,sjis,default
set fileencodings=ucs-bom,utf-8,sjis,default
set fileencodings=ucs-bom,iso-2022-jp-3,iso-2022-jp,eucjp-ms,euc-jisx0213,euc-jp,sjis,cp932,utf-8
set fenc=utf-8                  " fix unicode error while saving file
" colorscheme koehler
colorscheme molokai
" set cc=81
hi ColorColumn guibg=#2d2d2d ctermbg=246
filetype plugin indent on
filetype on
filetype plugin on
syntax on

"---------------------------------------------------------------------------
" Config for python
"
autocmd BufRead *.py set smartindent cinwords=if,elif,else,for,while,try,except,finally,def,class
autocmd BufRead *.py set tabstop=4
autocmd BufRead *.py set shiftwidth=4
autocmd BufRead *.py set smarttab
autocmd BufRead *.py set expandtab
autocmd BufRead *.py set softtabstop=4
autocmd BufRead *.py set autoindent
autocmd BufRead *.py if &modifiable | retab | endif
autocmd BufWritePre *.py normal m`:%s/\s\+$//e``

"---------------------------------------------------------------------------
" Config for php
"
autocmd FileType php set noro
autocmd FileType html set noro

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
"set hlsearch 

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
    " Always display NERDTree on vim enter
    " autocmd vimenter * NERDTree
    autocmd vimenter * if !argc() | NERDTree | endif
    autocmd bufenter * if (winnr("$") == 1 && exists("b:NERDTreeType") && b:NERDTreeType == "primary") | q | endif
    map <C-n> :NERDTreeToggle<CR>
    map <F5> :NERDTreeToggle<CR>
endif

"---------------------------------------------------------------------------
" Config Color theme
"
"if isdirectory($HOME."/.vim/bundle/vim-colors-solarized")
"    set background=dark
"    let g:solarized_termcolors=256
"    colorscheme solarized
"endif

"---------------------------------------------------------------------------
" Config neocomplcache
"
if isdirectory($HOME."/.vim/bundle/neocomplcache.vim")
    "Note: This option must set it in .vimrc(_vimrc).  NOT IN .gvimrc(_gvimrc)!
    " Disable AutoComplPop.
    let g:acp_enableAtStartup = 1
    " Use neocomplcache.
    let g:neocomplcache_enable_at_startup = 0
    " Use smartcase.
    let g:neocomplcache_enable_smart_case = 1
    " Waiting for input before using autocomplete. This prevents unwanted
    " autocomplete while scrolling
    let g:neocomplcache_enable_insert_char_pre = 1
    " Set minimum syntax keyword length.
    let g:neocomplcache_min_syntax_length = 3
    let g:neocomplcache_lock_buffer_name_pattern = '\*ku\*'

    " Enable heavy features.
    " Use camel case completion.
    "let g:neocomplcache_enable_camel_case_completion = 1
    " Use underbar completion.
    "let g:neocomplcache_enable_underbar_completion = 1

    " Define dictionary.
    let g:neocomplcache_dictionary_filetype_lists = {
                \ 'default' : '',
                \ 'vimshell' : $HOME.'/.vimshell_hist',
                \ 'scheme' : $HOME.'/.gosh_completions'
                \ }

    " Define keyword.
    if !exists('g:neocomplcache_keyword_patterns')
        let g:neocomplcache_keyword_patterns = {}
    endif
    let g:neocomplcache_keyword_patterns['default'] = '\h\w*'

    " Plugin key-mappings.
    inoremap <expr><C-g>     neocomplcache#undo_completion()
    inoremap <expr><C-l>     neocomplcache#complete_common_string()

    " Recommended key-mappings.
    " <CR>: close popup and save indent.
    inoremap <silent> <CR> <C-r>=<SID>my_cr_function()<CR>
    function! s:my_cr_function()
        return neocomplcache#smart_close_popup() . "\<CR>"
        " For no inserting <CR> key.
        "return pumvisible() ? neocomplcache#close_popup() : "\<CR>"
    endfunction
    " <TAB>: completion.
    inoremap <expr><TAB>  pumvisible() ? "\<C-n>" : "\<TAB>"
    " <C-h>, <BS>: close popup and delete backword char.
    inoremap <expr><C-h> neocomplcache#smart_close_popup()."\<C-h>"
    inoremap <expr><BS> neocomplcache#smart_close_popup()."\<C-h>"
    inoremap <expr><C-y>  neocomplcache#close_popup()
    inoremap <expr><C-e>  neocomplcache#cancel_popup()
    " Close popup by <Space>.
    "inoremap <expr><Space> pumvisible() ? neocomplcache#close_popup() : "\<Space>"

    " For cursor moving in insert mode(Not recommended)
    "inoremap <expr><Left>  neocomplcache#close_popup() . "\<Left>"
    "inoremap <expr><Right> neocomplcache#close_popup() . "\<Right>"
    "inoremap <expr><Up>    neocomplcache#close_popup() . "\<Up>"
    "inoremap <expr><Down>  neocomplcache#close_popup() . "\<Down>"
    " Or set this.
    "let g:neocomplcache_enable_cursor_hold_i = 1
    " Or set this.
    "let g:neocomplcache_enable_insert_char_pre = 1

    " AutoComplPop like behavior.
    "let g:neocomplcache_enable_auto_select = 1

    " Shell like behavior(not recommended).
    "set completeopt+=longest
    "let g:neocomplcache_enable_auto_select = 1
    "let g:neocomplcache_disable_auto_complete = 1
    "inoremap <expr><TAB>  pumvisible() ? "\<Down>" : "\<C-x>\<C-u>"

    " Enable omni completion.
    autocmd FileType css setlocal omnifunc=csscomplete#CompleteCSS
    autocmd FileType html,markdown setlocal omnifunc=htmlcomplete#CompleteTags
    autocmd FileType javascript setlocal omnifunc=javascriptcomplete#CompleteJS
    autocmd FileType python setlocal omnifunc=pythoncomplete#Complete
    autocmd FileType xml setlocal omnifunc=xmlcomplete#CompleteTags

    " Enable heavy omni completion.
    if !exists('g:neocomplcache_omni_patterns')
        let g:neocomplcache_omni_patterns = {}
    endif
    let g:neocomplcache_omni_patterns.php = '[^. \t]->\h\w*\|\h\w*::'
    let g:neocomplcache_omni_patterns.c = '[^.[:digit:] *\t]\%(\.\|->\)'
    let g:neocomplcache_omni_patterns.cpp = '[^.[:digit:] *\t]\%(\.\|->\)\|\h\w*::'

    " For perlomni.vim setting.
    " https://github.com/c9s/perlomni.vim
    let g:neocomplcache_omni_patterns.perl = '\h\w*->\h\w*\|\h\w*::'
endif

"---------------------------------------------------------------------------
" Config Tagbar
"
if isdirectory($HOME."/.vim/bundle/tagbar")
    " Toggle Tagbar
    map <C-t> :TagbarToggle<CR>
    map <F6> :TagbarToggle<CR>
endif

"---------------------------------------------------------------------------
" Config for tab
"
map <F7> :tabN<CR>
map <F8> :tabn<CR>

"---------------------------------------------------------------------------
" Config Grep plugin
"
if isdirectory($HOME."/.vim/bundle/grep")
    nnoremap <silent> <F2> :Rgrep <cword><cr><cr>
    nnoremap <silent> <F3> :Rgrep \(function\\\|class\)\ <cword><cr><cr>
    nnoremap <silent> <F4> /function\ <C-R>=expand('<cword>')<cr><cr>
endif

"---------------------------------------------------------------------------
" Config CtrlP
"
if isdirectory($HOME."/.vim/bundle/ctrlp.vim")
    let g:ctrlp_show_hidden = 1
    let g:ctrlp_working_path_mode = 0
    let g:ctrlp_prompt_mappings = {
                \ 'AcceptSelection("e")': ['<c-t>'],
                \ 'AcceptSelection("t")': ['<cr>', '<2-LeftMouse>']
                \ }
endif

"---------------------------------------------------------------------------
" Config vim-airline
"
if isdirectory($HOME."/.vim/bundle/vim-airline")
    let g:airline#extensions#tabline#enabled = 1
    let g:airline#extensions#tabline#tab_nr_type = 1
    let g:airline#extensions#tabline#buffer_idx_mode = 1
    let g:airline#extensions#tabline#fnamemod = ':t:.'
    let g:airline#extensions#tabline#show_tab_type = 0
    let g:airline#extensions#tabline#show_splits = 0
    " let g:airline_section_warning = '%{airline#util#wrap(airline#extensions#whitespace#check(),0)}'
    " let g:airline_section_error = %{airline#util#wrap(airline#extensions#syntastic#get_warnings(),0)}'
    let g:airline_section_warning = ''
    let g:airline_section_error = ''
endif

"---------------------------------------------------------------------------
