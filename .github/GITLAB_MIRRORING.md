# GitLab mirroring

GitHub (`OpenTubeX/OpenTubeX`) is the authoritative repository. GitLab
(`opentubex/OpenTubeX`) is a read-only mirror and must not be used as an
upstream source. Direct commits, branches, or tags created on GitLab may be
overwritten or deleted by the next synchronization.

The `Mirror to GitLab` workflow synchronizes every GitHub branch and tag in a
single run. It starts after pushes to `development`, after tag pushes, after
branch or tag deletions, and nightly to reconcile failed attempts. Pushes to
other branches do not start a run of their own, so a new feature branch reaches
GitLab with the next run rather than immediately. Force updates preserve exact
synchronization after rewritten GitHub history, and branch or tag deletions on
GitHub are propagated to GitLab.

Verification compares GitLab against the snapshot the run itself fetched and
pushed. Refs that appear or disappear on GitHub while a run is in flight are
therefore not reported as mirroring failures; the next run picks them up.

Only Git refs are mirrored. Issues, merge requests, pull requests, releases,
CI variables, project settings, packages, and other platform-specific metadata
are not mirrored.

## Credentials and GitLab settings

The workflow requires a GitHub Actions repository secret named
`GITLAB_MIRROR_TOKEN`. The token must belong to a GitLab user with sufficient
access to `opentubex/OpenTubeX` and needs only the `write_repository` scope.

GitLab protected-branch and protected-tag rules must allow that user to create,
update, force-update, and delete every mirrored ref. In particular, force
pushes must be permitted when GitHub history is rewritten. A protected default
branch or protected tag rule that denies updates or deletions will prevent an
exact mirror and cause verification to fail.

## Operations

To run synchronization manually, open the repository on GitHub, select
**Actions**, select **Mirror to GitLab**, choose **Run workflow**, select the
`development` branch, and confirm **Run workflow**.

To investigate a failure, open **Actions**, select **Mirror to GitLab**, and
open the failed run. Review the `Validate mirror credentials` and `Mirror and
verify branches and tags` step logs. The final comparison reports any GitLab
branch or tag refs that differ from GitHub without displaying credentials.

To rotate the token:

1. Create a replacement GitLab personal access token for an eligible user with
   the `write_repository` scope.
2. In the GitHub repository, open **Settings** → **Secrets and variables** →
   **Actions**.
3. Update `GITLAB_MIRROR_TOKEN` with the replacement token.
4. Manually run the workflow and confirm verification passes.
5. Revoke the old GitLab token.
