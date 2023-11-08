# MiLaboratories custom GitHub Actions and common workflows

To reduce number of repositories we keep all our custom actions in single repository (this repo)
This allows us to split workflow into as small pieces, as it is comfortable for code
deduplication and actions unit testing.

The drawback is that we can't control versions of particular actions: new 'v2' branch creates
'v2' version of all actions in repository, regardless the only one could have backwards incompatible
changes.

# Development
All production workflow versions are stored in special 'vN' branches: v1, v2, v3, ...

Version branches could get new features, but should keep backwards compatibility
of _workflow_ modifications. This means you can put backward-incompatible changes into some
action and update workflows, so they can work with updated action.

Each 'vN' version branch has connected 'vN-beta' branch with not-tested-yet versions of actions and workflows.
This 'vN-beta' branches can be used in action and workflow tests.

# Testing
For actions and workflows testing the another GitHub repository was created: [github-ci-tests](https://github.com/milaboratory/github-ci-tests/).
This repository contains lots of workflows for unit-testing particular actions and whole workflows.
Use it to test your changes before putting them into vN branch.

# v1
First version of all actions.

Most of 'v1' workflows initialize 'context' inside the workflow itself.
This makes workflow usage simpler (you don't need to create two dependant jobs), but makes impossible
to control workflow's parameters based on current context's state.

# v2
All workflows here expect outer workflow to call 'context/init' action before starting.
Without 'context/init' 'v2' workflows can't perform some of their jobs.

# v3
All workflows here expect outer workflow to call 'context/init' action before starting.
Without 'context/init' 'v3' workflows can't perform some of their jobs.
