# Test fixture workspace

Minimal pnpm workspace used by `check-coverage` bats tests.

- `packages/pkg-a` and `packages/pkg-b` both consume `is-number` from the default catalog in `dependencies`.
- `packages/pkg-c` consumes `is-string` from the default catalog in `dependencies`.
- `packages/pkg-dev` consumes `is-string` from the default catalog in `devDependencies`.
- `packages/pkg-peer` consumes `is-number` from the default catalog in `peerDependencies`.
- `packages/pkg-legacy` consumes `is-number` from the `legacy` named catalog in `dependencies`.
- `packages/pkg-private` is marked `private: true` and should never require a bump.

Tests mutate this fixture inside a temp clone — the originals stay untouched.
