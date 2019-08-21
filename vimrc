augroup HighlightTrailingSpaces
    autocmd!
    autocmd VimEnter,WinEnter,ColorScheme * highlight TrailingSpaces term=underline guibg=Red ctermbg=Red
    autocmd VimEnter,WinEnter * match TrailingSpaces /\s\+$/
    " Auto remove trailing whitespace in specific file type
    autocmd FileType c,cpp,java,php,ctp,html,css autocmd BufWritePre <buffer> %s/\s\+$//e
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
    Plugin 'ctrlpvim/ctrlp.vim'
    " csv display
    Plugin 'chrisbra/csv.vim'
    " nerdtree
    Plugin 'scrooloose/nerdtree'
    " html close tag
    Plugin 'docunext/closetag.vim'
    " autoclose braces
    Plugin 'Raimondi/delimitMate'
    " auto complete
    Plugin 'Shougo/neocomplete.vim'
    " indent for html
    Plugin 'captbaritone/better-indent-support-for-php-with-html'
    " grep plugin
    Plugin 'yegappan/grep'
    " surroundings
    Plugin 'tpope/vim-surround'
    " git wrapper
    Plugin 'tpope/vim-fugitive'
    " tag bar
    Plugin 'majutsushi/tagbar'
    " custom statusline, tabline
    Plugin 'vim-airline/vim-airline'
    Plugin 'vim-airline/vim-airline-themes'
    " rails
    Plugin 'tpope/vim-rails'
    " ruby
    Plugin 'vim-ruby/vim-ruby'
    " vue
    Plugin 'posva/vim-vue'

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
" set fileencodings=ucs-bom,korea,utf-8,sjis,default
set fileencodings=ucs-bom,iso-2022-jp-3,iso-2022-jp,eucjp-ms,euc-jisx0213,euc-jp,sjis,cp932,utf-8,sjis,default
set fenc=utf-8                  " fix unicode error while saving file
" set cc=81
hi ColorColumn guibg=#2d2d2d ctermbg=246
filetype plugin indent on
filetype on
filetype plugin on
syntax on

"---------------------------------------------------------------------------
" Config for python
"
autocmd FileType python set smartindent cinwords=if,elif,else,for,while,try,except,finally,def,class
autocmd FileType python set ai sw=4 sts=4 et
autocmd FileType python if &modifiable | retab | endif
autocmd BufWritePre *.py normal m`:%s/\s\+$//e``

"---------------------------------------------------------------------------
" Config for php
"
autocmd FileType php set noro
autocmd FileType html set noro

"---------------------------------------------------------------------------
" Config for ruby
"
autocmd FileType ruby,eruby,yaml,markdown set ai sw=2 sts=2 et
autocmd FileType ruby,eruby,yaml,markdown set smartindent cinwords=if,elsif,else,for,begin,rescue,finally,def,end
autocmd FileType ruby,eruby,yaml,markdown if &modifiable | retab | endif
autocmd BufWritePre *.rb normal m`:%s/\s\+$//e``

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
    " autocmd vimenter * if !argc() | NERDTree | endif
    autocmd bufenter * if (winnr("$") == 1 && exists("b:NERDTreeType") && b:NERDTreeType == "primary") | q | endif
    map <C-n> :NERDTreeToggle<CR>
    map <F5> :NERDTreeToggle<CR>
endif

"---------------------------------------------------------------------------
" Config Color theme - highlight
"
"color molokai
color dracula

"Show trailing whitespace and spaces before a tab
:highlight ExtraWhitespace ctermbg=red guibg=red
:autocmd Syntax * syn match ExtraWhitespace /\s\+$\| \+\ze\\t/

"---------------------------------------------------------------------------
" Config autocomplete
"
if isdirectory($HOME."/.vim/bundle/neocomplete.vim")
    " Disable AutoComplPop.
    let g:acp_enableAtStartup = 0
    " Use neocomplete.
    let g:neocomplete#enable_at_startup = 1
    " Use smartcase.
    let g:neocomplete#enable_smart_case = 1
    " Set minimum syntax keyword length.
    let g:neocomplete#sources#syntax#min_keyword_length = 3

    " Define dictionary.
    let g:neocomplete#sources#dictionary#dictionaries = {
        \ 'default' : '',
        \ 'ruby' : $HOME.'/.dotfiles/dict/ruby.dict',
        \ 'jquery' : $HOME.'/.dotfiles/dict/jquery.dict'
            \ }

    " Define keyword.
    if !exists('g:neocomplete#keyword_patterns')
        let g:neocomplete#keyword_patterns = {}
    endif
    let g:neocomplete#keyword_patterns['default'] = '\h\w*'

    " Plugin key-mappings.
    inoremap <expr><C-g>     neocomplete#undo_completion()
    inoremap <expr><C-l>     neocomplete#complete_common_string()

    " Recommended key-mappings.
    " <CR>: close popup and save indent.
    inoremap <silent> <CR> <C-r>=<SID>my_cr_function()<CR>
    function! s:my_cr_function()
        return (pumvisible() ? "\<C-y>" : "" ) . "\<CR>"
        " For no inserting <CR> key.
        "return pumvisible() ? "\<C-y>" : "\<CR>"
    endfunction
    " <TAB>: completion.
    inoremap <expr><TAB>  pumvisible() ? "\<C-n>" : "\<TAB>"
    " <C-h>, <BS>: close popup and delete backword char.
    inoremap <expr><C-h> neocomplete#smart_close_popup()."\<C-h>"
    inoremap <expr><BS> neocomplete#smart_close_popup()."\<C-h>"
    " Close popup by <Space>.
    "inoremap <expr><Space> pumvisible() ? "\<C-y>" : "\<Space>"

    " AutoComplPop like behavior.
    "let g:neocomplete#enable_auto_select = 1

    " Shell like behavior(not recommended).
    "set completeopt+=longest
    "let g:neocomplete#enable_auto_select = 1
    "let g:neocomplete#disable_auto_complete = 1
    "inoremap <expr><TAB>  pumvisible() ? "\<Down>" : "\<C-x>\<C-u>"

    " Enable omni completion.
    autocmd FileType css setlocal omnifunc=csscomplete#CompleteCSS
    autocmd FileType html,markdown setlocal omnifunc=htmlcomplete#CompleteTags
    autocmd FileType javascript setlocal omnifunc=javascriptcomplete#CompleteJS
    autocmd FileType python setlocal omnifunc=pythoncomplete#Complete
    autocmd FileType xml setlocal omnifunc=xmlcomplete#CompleteTags

    " Enable heavy omni completion.
    if !exists('g:neocomplete#sources#omni#input_patterns')
    let g:neocomplete#sources#omni#input_patterns = {}
    endif
    "let g:neocomplete#sources#omni#input_patterns.php = '[^. \t]->\h\w*\|\h\w*::'
    "let g:neocomplete#sources#omni#input_patterns.c = '[^.[:digit:] *\t]\%(\.\|->\)'
    "let g:neocomplete#sources#omni#input_patterns.cpp = '[^.[:digit:] *\t]\%(\.\|->\)\|\h\w*::'

    " For perlomni.vim setting.
    " https://github.com/c9s/perlomni.vim
    let g:neocomplete#sources#omni#input_patterns.perl = '\h\w*->\h\w*\|\h\w*::'
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
    nnoremap <silent> <F3> :Rgrep \(function\\\|func\\\|class\\\|def\\\|const\)\ <cword><cr><cr>
    nnoremap <silent> <F4> /<C-R>=expand('<cword>')<cr><cr>
endif

"---------------------------------------------------------------------------
" Config CtrlP
"
if isdirectory($HOME."/.vim/bundle/ctrlp.vim")
    let g:ctrlp_show_hidden = 0
    let g:ctrlp_working_path_mode = 0
    let g:ctrlp_prompt_mappings = {
                \ 'AcceptSelection("e")': ['<c-t>'],
                \ 'AcceptSelection("t")': ['<cr>', '<2-LeftMouse>']
                \ }
    let g:ctrlp_custom_ignore = {
                \ 'dir':  '\v[\/]\.(git|hg|svn)$',
                \ 'file': '\v\.(exe|so|dll)$',
                \ }
    " Skip gitignored files
    let g:ctrlp_user_command = ['.git', 'cd %s && git ls-files -co --exclude-standard']
endif

"---------------------------------------------------------------------------
" Config vim-airline
"
if isdirectory($HOME."/.vim/bundle/vim-airline")
    let g:airline#extensions#tabline#enabled = 1
    let g:airline#extensions#tabline#tab_nr_type = 1
    let g:airline#extensions#tabline#buffer_idx_mode = 1
    let g:airline#extensions#tabline#buffer_nr_show = 1
    let g:airline#extensions#tabline#fnamemod = ':t:.'
    let g:airline#extensions#tabline#show_tab_type = 0
    let g:airline#extensions#tabline#show_splits = 0
    let g:airline#extensions#branch#enabled = 1
    " let g:airline_section_warning = '%{airline#util#wrap(airline#extensions#whitespace#check(),0)}'
    " let g:airline_section_error = %{airline#util#wrap(airline#extensions#syntastic#get_warnings(),0)}'
    let g:airline_section_warning = ''
    let g:airline_section_error = ''
    let g:airline_powerline_fonts = 1
    let g:airline_theme = 'dracula'
    map <F9> :bp<CR>
    map <F10> :bn<CR>
endif

"---------------------------------------------------------------------------
