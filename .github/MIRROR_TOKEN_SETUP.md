# Mirror-lua workflow setup

`.github/workflows/mirror-lua.yml` runs on every `v*` tag push and mirrors `lua/`, `spec/`, and `CHANGELOG.md` from `piqusy/murmur` into `piqusy/murmur.nvim`, then re-tags the mirror at the same version. Lazy.nvim / packer.nvim / vim-plug users pick up the new tag on their next `:Lazy update murmur`.

## One-time: provision `MIRROR_TOKEN`

The workflow needs a personal access token with push rights on `piqusy/murmur.nvim`. Without it, the workflow fails at clone time.

1. Create a fine-grained PAT at <https://github.com/settings/tokens?type=beta>.
   - **Token name:** `murmur-mirror-bot`
   - **Resource owner:** `piqusy`
   - **Repository access:** `Only select repositories` → `piqusy/murmur.nvim`
   - **Permissions → Repository permissions:**
     - Contents: **Read and write**
   - **Expiration:** 1 year (set a calendar reminder to rotate).
2. Copy the token (you only see it once).
3. Open <https://github.com/piqusy/murmur/settings/secrets/actions/new>.
   - **Name:** `MIRROR_TOKEN`
   - **Secret:** paste the PAT.
   - **Repository access:** leave default ("All repositories") — this secret is only usable from `piqusy/murmur` workflows.
4. Click **Add secret**.

## Verify

After the next `v*` tag is pushed:

1. Watch <https://github.com/piqusy/murmur/actions/workflows/mirror-lua.yml>.
2. On success, <https://github.com/piqusy/murmur.nvim/tags> should show the new tag and main should advance.
3. From a Neovim install with lazy.nvim:
   ```vim
   :Lazy update murmur
   ```
   The lockfile shows the new tag pulled.

## Rotation reminder

Tokens issued through the fine-grained beta UI have a configurable lifetime. When the token expires, mirror runs fail with `Bad credentials` — repeat the four steps above. A future improvement is to swap the PAT for a GitHub App installation token with auto-rotation; for now the PAT is fine.
