# Version number detector

This action tries to automatically detect version number of application
from either GitHub Action Context, or git history state

## Code structure
* `src/` - all main action sources
* `action.yaml` - action definition for GitHub Actions engine.
  Specifies Action code entrypoint, inputs, outputs and so on.
* `dist/index.js` - actual JS code executed by GitHub Action (specified in `action.yaml`).
  All files in `dist/` dir including `index.js` are built by `npm run package` or `npm run all` commands

## Useful commands

```shell
npm run all  # build, lint, format, package and test the code
npm run build   # build JS from TypeScript (create files in lib/)
npm run format  # autoformat code
npm run lint    # run linter to check for most common issues
npm run package # update release version of code (create files in dist/, actually used in action run)
npm run test    # run JEST tests in __tests__ directory
```

## How to develop the action

* **Create separate branch**.
  This will allow you to check workflow changes in real life without breaking every existing process;
* Update the code;
* Write unit tests to check your changes;
* Run `npm run test` to check everything is fine;
* Run `npm run all` and commit all changes including generated files in `lib/` and `dist/`;
* Check your updates by separate workflow run to make sure everything is
  fine (that's why you need separate branch);
* Merge your changes to the appropriate version branch (v1, v2, etc.)
