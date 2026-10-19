# `npm-trust-setup.sh` tests

Bats suite for `apply` of `../npm-trust-setup.sh` against a stubbed npm
(`bin/npm`). `fixtures/trust/*.json` are `npm trust list --json` outputs in the
shape npm 11 prints them. `discover` calls the GitHub API and is not covered.

```bash
bats scripts/test/npm-trust-setup.bats < /dev/null
```

Needs `bats` and `jq`. Stdin must not be an open terminal: the stub drains it
the way npm's 2FA prompt would.
