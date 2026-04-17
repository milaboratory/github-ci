# mirror-directory

Mirror a subdirectory from one repository to another as a snapshot. Each
run wipes the target directory, copies the current source directory on top,
and pushes one commit carrying a `Source-Commit: <sha>` trailer that points
at the source commit producing the snapshot. Source history is not replayed.

## Testing with act

`test-helm-sync.sh` is a self-contained script that sets up test data, runs
the test workflow via [act](https://github.com/nektos/act), and cleans up.
The workflow (`test-helm-sync.yaml`) covers three scenarios:

| Test | Scenario | What it verifies |
|------|----------|------------------|
| **snapshot** | Current source dir pushed to empty/existing target | One commit in target, files match source, `Source-Commit` trailer present |
| **no-op** | Re-run with no source changes | No new commit in target |
| **tag-sync** | Snapshot push + tag via `GITHUB_REF` override | Commit pushed, tag pushed to target, tag tree matches branch HEAD |

A **cleanup** job runs after all tests (`if: always()`) and deletes the
throwaway branches and tags from the target repo.

### Prerequisites

1. **act** installed (`brew install act` or [see docs](https://github.com/nektos/act))
2. **Docker** running (act uses Docker containers)
3. The **pl** repo checked out with full history (this test uses a worktree)
4. The **github-ci** repo cloned alongside pl (for `--local-repository`)
5. **GitHub token** with push access to the target repo (`gh auth token`)

### Quick start

The script handles everything — setup, run, and cleanup:

```bash
# From anywhere (the script auto-detects pl/ and github-ci/ paths):
./github-ci/actions/git/mirror-directory/test-helm-sync.sh
```

### Script options

```bash
./test-helm-sync.sh                      # full run: setup → test → cleanup
./test-helm-sync.sh --dry-run            # validate YAML only, no containers
./test-helm-sync.sh --job multi-commit   # run a single job
./test-helm-sync.sh --job pr-merge       # run only the squash merge test
./test-helm-sync.sh --job tag-sync       # run only the tag sync test
./test-helm-sync.sh --setup-only         # create test branch, don't run
./test-helm-sync.sh --cleanup-only       # delete test branch + remote leftovers
```

The script:
1. Creates a `test-helm-sync-verify` branch in `pl/` with 3 helm commits
2. Auto-detects git worktree layout and mounts the right `.git` dir
3. Runs act with all required flags
4. Cleans up the local branch afterward
5. The workflow's cleanup job deletes remote branches/tags

### Manual cleanup

If a run is interrupted before cleanup:

```bash
./test-helm-sync.sh --cleanup-only
```

Or manually:

```bash
# Local
cd pl/ && git checkout main && git branch -D test-helm-sync-verify

# Remote (throwaway branches + tag)
for b in _test-sync-multi-commit _test-sync-pr-merge _test-sync-tag; do
  gh api -X DELETE "repos/milaboratory/platforma-helm/git/refs/heads/$b" 2>/dev/null
done
gh api -X DELETE "repos/milaboratory/platforma-helm/git/refs/tags/v99.0.0-sync-test" 2>/dev/null
```

### act quirks and workarounds

| Issue | Workaround |
|-------|------------|
| **Git worktree** `.git` file not resolvable in container | Mount the main `.git` dir via `--container-options "-v ..."` |
| **`-b` (bind mount)** shares workdir across all jobs | Jobs run sequentially via `needs:` dependencies |
| **`GITHUB_WORKSPACE` override** ignored by act for composite actions | Mutate the bind-mounted workdir directly; restore state in `if: always()` steps |
| **Branch filter** `on: push: branches: [main]` doesn't match test branch | `--defaultbranch <branch>` makes act treat the current branch as default |
| **Apple Silicon** emulation warnings | `--container-architecture linux/amd64` |
| **Squash merge conflicts** on non-helm files | Use `git checkout <ref> -- helm/` to copy only helm files instead of `git merge --squash` |
| **Leftover local tags** from interrupted runs pollute subsequent runs | Cleanup steps with `if: always()`; verify clean state before re-running |
