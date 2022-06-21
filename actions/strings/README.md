# Simple string actions helper library

This library contains actions designed for simple operations with strings.

## Code structure
* `implementation/` - all library's actions implementations
  * `implementation/src/*` - *.ts sources
  * `implementation/Makefile` - actions compilation rules
  * `implementation/lib/*` - *.js files generated from `src/*`. These files do not contain 
    dependencies and thus can't be used in actions in most cases.
* `<action-name>/index.js` - final actions code assembled from sources inside `implementation/`.
* `<action-name>/action.yaml` - action definition for GitHub actions.

## How to develop a new action

* **Create separate branch**.
  This will allow you to check workflow changes in real runs without breaking every existing process;
* Go to `implementation/` directory;
* Create `implementation/src/<action>.js` with action implementation;
* Update `implementation/Makefile` by adding target for new action. 
  Remember to update `release` target;
* Write unit tests to check your changes;
* Run `make test` to check everything is fine;
* Run `make release` and commit all changes including generated files in `lib/`;
* Check your updates by separate workflow run to make sure everything is
  fine (that's why you need separate branch);
* Merge your changes to the appropriate version branch (v1, v2, etc.)

## Useful commands

```shell
make all           # build, lint, format, package and test all actions
make build         # build JS from TypeScript (create files in lib/)
make format        # autoformat code
make lint          # run linter to check for most common issues
make <action-name> # update specific action (generate ../<action-name>/index.js file)
make release       # update all known actions (same as make <action-name> for all actions)
make test          # run JEST tests in __tests__ directory
```
