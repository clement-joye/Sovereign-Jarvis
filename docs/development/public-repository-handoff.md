# Public repository handoff

Use this procedure to create the first public repository from a reviewed source
snapshot. Before creating the new repository, review the worktree; a
`git archive`, a copy of `HEAD`, or copying only tracked files can omit any
intended uncommitted release work.

## Prepare the source snapshot

1. Finish and review the release changes in this checkout. Inspect
   `git status --short` and include every intended modified, added, and renamed
   source, test, configuration, migration, and documentation file—including
   intended untracked files. Resolve accidental or obsolete files before
   copying.
2. Use the reviewed tracked and non-ignored files as the snapshot. Do not copy
   the old `.git` directory or ignored files. In particular, exclude populated
   environment files, credentials, deployment state, databases, Matrix crypto,
   model/media caches, generated runtime/catalog state, backups, and local build
   outputs. Keep `eslint.config.js` and the hand-authored declaration shims in
   `scripts/migrations/`, `scripts/operator/`, `scripts/setup/`,
   `scripts/runtime/`, and `scripts/plugins/`:
   `.gitignore` explicitly allows these tracked source contracts because clean
   builds and typechecking need them. Do not use a blanket `cp -a` of the
   checkout or force-add ignored files.
3. In the destination, initialize a fresh repository and inspect
   `git status --short --ignored` before staging. Confirm every expected source
   file is present, no private or ignored state was copied, and `.git` is the new
   repository's metadata. Review the staged file list before the first commit.

For a read-only inventory while preparing the snapshot, these commands separate
tracked files, non-ignored untracked files, and ignored paths; inspect ignored
path names without opening secret files:

```sh
git ls-files --cached
git ls-files --others --exclude-standard
git ls-files --others --ignored --exclude-standard
```

## Validate the new repository

Run the pinned Gitleaks version used by the release checklist against the
copied files before committing. Use a redacted report outside the repository;
review detector and path metadata without publishing matched values. Resolve
real findings, then stage only the reviewed source files and make the new
repository's initial commit. Scan that new history with the same pinned tool.
Repeat the checklist's absolute-path review for `/home/`, `/Users/`, and
`/root/` against both the copied source and new history. Do not import refs,
tags, or objects from the private checkout.

After the initial commit, run checks from the destination using the selected
public Node.js baseline and pinned pnpm version:

```sh
node --version  # Node.js 24 or newer
pnpm --version  # 11.5.0
pnpm install --frozen-lockfile
pnpm verify
```

The initial commit must precede `pnpm verify`: reviewed runtime releases need
a Git revision, and catalog compilation reads tracked plugin resources.

## Release status

Passing `pnpm verify` in the new repository is a source validation result, not
evidence that every release gate has passed. Keep the
[public release checklist](public-release-checklist.md) authoritative: its
remaining selected-host evidence, documentation review, and publication checks
must be completed and recorded before claiming the release gate passed.
