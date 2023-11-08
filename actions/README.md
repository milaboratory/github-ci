# MiLaboratories custom actions and action wrappers

This directory contains our custom GitHub actions and external action bindings with
commit hardening for security reasons.

If you want to use some external non-official GitHub Action (located outside of github.com/actions,
maintained by third-party), create linked action inside this directory with exact SHA in link.

> Check `notify/telegram/send` or `java/gradle/cache` for examples of commit hardened external actions.

> Check [GitHub Actions security guides](https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions#using-third-party-actions) 
for more info about reasons to use commit hardening.
