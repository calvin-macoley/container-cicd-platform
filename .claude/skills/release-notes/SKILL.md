---
name: release-notes
description: Use when preparing a release or asked for release notes or a changelog between two versions or SHAs.
---
# Release notes

1. Determine the range: previous tag to HEAD unless told otherwise
   (`git describe --tags --abbrev=0`).
2. List commits with `git log <from>..<to> --pretty=format:'%h %s'`.
3. Group by conventional commit type: Features (feat), Fixes (fix),
   Infrastructure (ci, build, infra), Docs, Other. Skip chore unless notable.
4. Call out any migration and its expand/contract phase.
5. Call out breaking changes (commits with "!" or BREAKING CHANGE) at the top.
6. Output Markdown suitable for a GitHub Release. Do not create the tag or
   release yourself.
