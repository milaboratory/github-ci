# Test fixture workspace

Minimal pnpm workspace used by `check-coverage` bats tests.

- `packages/pkg-a` and `packages/pkg-b` both consume `is-number` via the catalog.
- `packages/pkg-c` consumes `is-string` via the catalog.
- `packages/pkg-private` is marked `private: true` and should never require a bump.

Tests mutate this fixture inside a temp clone — the originals stay untouched.
