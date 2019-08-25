"---------------------------------------------------------------------------
" Vundle setting
"
set nocompatible
filetype off

if isdirectory($HOME."/.vim/bundle/Vundle.vim")
    set rtp+=~/.vim/bundle/Vundle.vim
    call vundle#begin()
    Plugin 'gmarik/Vundle.vim'

    " Editor
    Plugin 'ctrlpvim/ctrlp.vim'
    Plugin 'Raimondi/delimitMate'
    Plugin 'Shougo/neocomplete.vim'
    Plugin 'Shougo/unite.vim'
    Plugin 'yegappan/grep'
    Plugin 'tpope/vim-surround'
    Plugin 'tpope/vim-fugitive'
    Plugin 'majutsushi/tagbar'
    Plugin 'tomtom/tcomment_vim'
    Plugin 'vim-airline/vim-airline'
    Plugin 'vim-airline/vim-airline-themes'

    " Development
    Plugin 'chrisbra/csv.vim'
    Plugin 'vim-ruby/vim-ruby'
    Plugin 'tpope/vim-rails'
    Plugin 'tpope/vim-rake'
    Plugin 'pangloss/vim-javascript'
    Plugin 'mxw/vim-jsx'
    Plugin 'moll/vim-node'
    Plugin 'posva/vim-vue'

    call vundle#end()
    set rtp+=~/.vim
endif

"--------------------------------
" Other setting
"
syntax on
filetype plugin on
filetype indent on

set t_Co=256
set clipboard=unnamedplus
set noswapfile

set tabstop=4
set shiftwidth=4
set softtabstop=4
set expandtab                   " Use spaces instead of tabs
set smarttab                    " Be smart when using tabs
set autoread                    " Set to auto read when a file is changed from the outside
set shiftround
set autoindent
set smartindent
set number
set ruler
set laststatus=2
set showcmd                     " Show (partial) command in the status line

set backspace=indent,eol,start  " Backspace for dummies
set linespace=0                 " No extra spaces between rows
set showmatch                   " Show matching brackets/parenthesis
set winminheight=0              " Windows can be 0 line high
set wildmenu                    " Show list instead of just completing
set wildmode=list:longest,full  " Command <Tab> completion, list matches, then longest common part, then all.
set omnifunc=syntaxcomplete#Complete
set whichwrap=b,s,h,l,<,>,[,]   " Backspace and cursor keys wrap too
set scrolljump=5                " Lines to scroll when cursor leaves screen
set scrolloff=3                 " Minimum lines to keep above and below cursor
set fileformat=unix
set fileformats=unix,dos,mac    " Use Unix as the standard file type
set encoding=utf-8
set fileencoding=utf-8          " Fix unicode error while saving file
set fileencodings=ucs-bom,iso-2022-jp-3,iso-2022-jp,eucjp-ms,euc-jisx0213,euc-jp,sjis,cp932,utf-8,sjis,default

set wildignore=*.o,*~,*.pyc     " Ignore compiled files
set wildignore+=*/vendor/**
set wildignore+=*/node_modules/**

"---------------------------------------------------------------------------
" Customize key map
"
map <SPACE> <leader>
inoremap jk <ESC>          " Map jk to <ESC> to quit INSERT mode faster
inoremap jj <ESC>          " Map jj to <ESC> to quit INSERT mode faster

" Split navigations
nnoremap <C-J> <C-W><C-J>  " Move to the split below
nnoremap <C-K> <C-W><C-K>  " Move to the split above
nnoremap <C-L> <C-W><C-L>  " Move to the split to the right
nnoremap <C-H> <C-W><C-H>  " Move to the split to the left

" Buffer navigations
map <F5> :bp<CR>
map <F6> :bn<CR>

" Leader shortcuts
map <leader>a ggVG         " Select all text in buffer
map <leader>y ggVGy        " Copy all text in buffer
map <leader>d ggVGd        " Cut all text in buffer

"---------------------------------------------------------------------------
" Config for python
"
autocmd FileType python set smartindent cinwords=if,elif,else,for,while,try,except,finally,def,class
autocmd FileType python set ai sw=4 sts=4 et
autocmd FileType python if &modifiable | retab | endif
autocmd BufWritePre *.py normal m`:%s/\s\+$//e``

"---------------------------------------------------------------------------
" Config for ruby
"
autocmd FileType ruby,eruby,yaml,markdown set ai sw=2 sts=2 et
autocmd FileType ruby,eruby,yaml,markdown set smartindent cinwords=if,elsif,else,for,begin,rescue,finally,def,end
autocmd FileType ruby,eruby,yaml,markdown if &modifiable | retab | endif
autocmd BufWritePre *.rb normal m`:%s/\s\+$//e``

"---------------------------------------------------------------------------
" Search
"
set ignorecase       " Ignore the case of normal letters.
set smartcase        " If the search pattern contains upper case characters, override ignorecase option.
set incsearch        " Enable incremental search.
set nohlsearch       " Don't highlight search result.
set wrapscan         " Searches wrap around the end of the file.

"---------------------------------------------------------------------------
" Config default netrw
"
let g:netrw_dirhistmax=0        " Auto delete vim/.netrwhist
let g:netrw_banner=0
let g:netrw_liststyle=3
let g:netrw_browse_split=4
let g:netrw_altv=1
let g:netrw_winsize=20

let g:NetrwIsOpen=0
function! ToggleNetrw()
    if g:NetrwIsOpen
        let i = bufnr("$")
        while (i >= 1)
            if (getbufvar(i, "&filetype") == "netrw")
                silent exe "bwipeout " . i
            endif
            let i-=1
        endwhile
        let g:NetrwIsOpen=0
    else
        let g:NetrwIsOpen=1
        silent Vexplore
    endif
endfunction
map <C-n> :call ToggleNetrw()<CR>

"---------------------------------------------------------------------------
" Config Color theme - highlight
"
"color molokai
color dracula

" Highlight problematic whitespace, trailing whitespace and spaces before a tab
set list listchars=tab:\¦\ ,trail:•,extends:#,nbsp:.
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
" Config Unite
"
if isdirectory($HOME."/.vim/bundle/unite.vim")
    nnoremap <leader>u :<C-u>Unite<Space>
    nnoremap <leader>f :<C-u>Unite file<CR>
    nnoremap <leader>b :<C-u>Unite buffer<CR>
endif

"---------------------------------------------------------------------------
" Config Tagbar
"
if isdirectory($HOME."/.vim/bundle/tagbar")
    " Toggle Tagbar
    map <C-t> :TagbarToggle<CR>
endif

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
endif

"---------------------------------------------------------------------------
