# Changesets

This project uses [changesets](https://github.com/changesets/changesets) for versioning and changelog generation.

## Adding a changeset

When you make a change that should appear in the changelog, run:

```
yarn changeset
```

This will prompt you to:
1. Select the package (`@getbrevo/cli`)
2. Choose a bump type (`patch`, `minor`, or `major`)
3. Write a summary of the change

A markdown file will be created in this directory. Commit it with your PR.

## When to add a changeset

- **patch** — bug fixes, internal changes visible to users
- **minor** — new commands, new flags, new features
- **major** — breaking changes to command syntax, config format, or behavior

## When NOT to add a changeset

- CI/CD changes, docs-only changes, test-only changes, refactors with no user-visible effect
