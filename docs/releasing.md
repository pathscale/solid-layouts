# Releasing with npm Trusted Publishing

Solid Layouts publishes from GitHub Actions with npm Trusted Publishing. Release
workflows do not use `NPM_TOKEN` or any other npm secret.

## Trust boundary

The publish jobs have exactly the permissions and environment npm's OIDC exchange
requires:

- GitHub-hosted `ubuntu-latest` runner
- `permissions: id-token: write`
- npm 11.5.1 or newer
- no `registry-url` input that writes an `_authToken` placeholder

The build and package jobs may run elsewhere. They upload an immutable tarball, and
the GitHub-hosted publish job downloads and publishes that tarball. npm generates
provenance automatically for Trusted Publishing releases.

## One-time package bootstrap

npm can only attach a trusted publisher after a package exists. The first version
of each new package therefore has a one-time bootstrap; this does not add a secret
to GitHub.

1. Run the relevant workflow manually. Manual dispatch packages the selected
   module and uploads its tarball, but the publish job is intentionally skipped.
2. Download and inspect the `npm-package` artifact.
3. Authenticate interactively on a maintainer workstation with npm web login and
   publish that exact tarball once.
4. Configure the GitHub Actions trusted publisher immediately.
5. Log out of npm on the workstation.

For `solid-layouts` and `rsbuild-plugin-solid-layouts`, manually dispatch
`release-js.yml` and choose the package. For `solid-layouts-oxc`, manually dispatch
`release-oxc.yml`; its artifact contains all four native bindings.

With npm 11.15.0 or newer, a maintainer with package access and two-factor
authentication can configure the publishers from the repository root:

```sh
npm trust github solid-layouts \
  --repo pathscale/solid-layouts \
  --file release-js.yml \
  --allow-publish

npm trust github rsbuild-plugin-solid-layouts \
  --repo pathscale/solid-layouts \
  --file release-js.yml \
  --allow-publish

npm trust github solid-layouts-oxc \
  --repo pathscale/solid-layouts \
  --file release-oxc.yml \
  --allow-publish
```

The `--file` values are filenames relative to `.github/workflows`, exactly as npm
expects. Repository and workflow matching are case-sensitive.

After trust is configured, set each package's npm publishing access to require
two-factor authentication and disallow tokens. That prevents legacy granular or
automation tokens from bypassing the OIDC-only release path.

## Normal releases

Every release tag must exactly match the package version:

| Package | Workflow | Tag |
| --- | --- | --- |
| `solid-layouts` | `release-js.yml` | `solid-layouts-v0.1.0` |
| `rsbuild-plugin-solid-layouts` | `release-js.yml` | `rsbuild-plugin-solid-layouts-v0.1.0` |
| `solid-layouts-oxc` | `release-oxc.yml` | `solid-layouts-oxc-v0.1.0` |

The workflow rejects a tag whose version differs from `package.json`. A valid tag
builds the tarball, transfers it to the GitHub-hosted publish job, exchanges the
job's short-lived OIDC identity with npm, and publishes. No maintainer credential
is available to the workflow.

## PathScale UI

`@pathscale/ui` uses the same boundary: its existing release preparation can run
on Ubicloud, but the packed tarball is published by a separate GitHub-hosted job
with `id-token: write`. Configure its trusted publisher for the PathScale UI
repository and its exact release workflow filename. It must not receive an
`NPM_TOKEN`.

## References

- [npm Trusted Publishers](https://docs.npmjs.com/trusted-publishers/)
- [`npm trust`](https://docs.npmjs.com/cli/v11/commands/npm-trust/)
