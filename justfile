# photosite convenience wrappers — run `just <recipe>`.
# Install just: https://github.com/casey/just

# install tool deps and link `photosite` onto PATH
link:
    cd tool && npm install && npm link

# install site deps
install-site:
    cd site && npm install

# run the local preview server (renders trips before any R2 upload)
preview:
    photosite preview

# build the static site into site/dist
build:
    cd site && npm run build

# list trips
list:
    photosite list

# enable the opt-in gitleaks pre-commit hook
hooks:
    git config core.hooksPath .githooks
