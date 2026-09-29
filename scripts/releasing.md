# Releases

The `Release` workflow publishes the stable version in `package.json` once that exact `main` revision passes `ci-quality` and `ci-browser`. It runs after successful push CI on `main`; PR and fork runs cannot publish. Already published versions are left untouched.

To prepare a new release, update the package version and lockfile and add its `## [version]` entry to `CHANGELOG.md` in a normal pull request. Merge after validation. The workflow verifies current `main`, the successful CI revision and both job results before building. It checks `main` again immediately before publishing.

Each GitHub release includes:

- `LLM-Writer-vX.Y.Z-dist.zip`: the static production build.
- `SHA256SUMS.txt`: the ZIP's SHA-256 checksum.
- `build-info.json`: version, tag, exact commit and CI evidence URL (also inside the ZIP).

Download, extract and serve the ZIP contents from a static HTTP server. The app uses hash routes and needs no backend for storage. AI provider configuration and writing data remain in the browser; back up data before changing origins.

If publication fails before a release exists, rerun the Release workflow on `main` after resolving the failure. Never move an existing release tag to another commit. A release with incorrect content should be superseded by a new patch version.
