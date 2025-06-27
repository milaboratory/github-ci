# Setup Regctl

#### Sample workflow to install a specific version of regctl binary on the runner.

Acceptable values are latest or any semantic version string like `v0.4.5`. Use this action in workflow to define which version of regctl will be used.

```yaml
- uses: milaboratory/github-ci/actions/setup-regctl@v4-db-1
  with:
     version: '<version>' # default is latest
```
## Credits

Code of this actions is based on: https://github.com/Azure/setup-kubectl
