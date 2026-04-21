# Contributing

Thanks for your interest in improving `asana-chat-sdk-adapter`. This document covers local development, tests, the end-to-end flow against a real Asana workspace, and how releases are cut.

For what the packages do and how Asana events map onto the Chat SDK, see the [README](./README.md).

## Repository layout

```
packages/
  chat-adapter-asana/       # @soofi-xyz/chat-adapter-asana (npm)
  chat-adapter-asana-cdk/   # @soofi-xyz/chat-adapter-asana-cdk (npm)
examples/
  lambda-http/              # reference deployment + E2E test (not published)
```

The repo is a pnpm workspace (`pnpm-workspace.yaml`). Both published packages are ESM-only, built with `tsup`, and tested with Vitest.

## Prerequisites

- Node.js >= 20
- pnpm 9.15.9 (pinned via `packageManager` in `package.json`)
- For the end-to-end example: AWS credentials and an Asana workspace

## Local development

Install once, then run any of the workspace scripts:

```bash
pnpm install
pnpm -r --filter "./packages/*" run typecheck
pnpm -r --filter "./packages/*" run test
pnpm -r --filter "./packages/*" run build
```

Per-package watch mode:

```bash
pnpm --filter @soofi-xyz/chat-adapter-asana run dev
pnpm --filter @soofi-xyz/chat-adapter-asana-cdk run dev
```

## Tests

Unit tests live beside each package in `packages/*/tests` and run with coverage by default:

```bash
pnpm -r --filter "./packages/*" run test
```

CI (`.github/workflows/ci.yml`) also builds the `examples/lambda-http` package and runs `cdk synth` against a dummy account/region as a smoke test on every push and pull request, so catch integration-style regressions before they ship.

### End-to-end test

The E2E test deploys the example stack and drives a real Asana workspace. It needs a bot personal access token **and** a second "sender" token so reactions and mentions are exercised against a different user.

```bash
export AWS_PROFILE=elephant-cursor
export ASANA_PAT=...         # bot personal access token
export ASANA_PAT_SENDER=...  # sender PAT (must not equal ASANA_PAT)
export ASANA_WORKSPACE_GID=...

pnpm --filter @soofi-xyz-examples/chat-adapter-asana-lambda-http run deploy
pnpm --filter @soofi-xyz-examples/chat-adapter-asana-lambda-http run test:e2e
```

The test creates a task as `ASANA_PAT_SENDER`, assigns it to the bot, then verifies:

1. Bot posts a reply that mentions the sender.
2. Sender posts a follow-up asking for a file.
3. Bot reacts with the `eyes` emoji on the follow-up.
4. Bot uploads a `.txt` attachment on the task.

## Making changes

1. Create a branch from `main`.
2. Write the change plus tests. Keep unit coverage at parity with what you're touching.
3. Add a changeset describing the user-visible impact:

   ```bash
   pnpm changeset
   ```

   Pick the bump type per the [versioning policy](#versioning-policy) below. One changeset per logical change is ideal; multiple are fine if a PR spans distinct concerns.

4. Run `pnpm -r run typecheck && pnpm -r run test && pnpm -r run build` locally before opening the PR.
5. Open a PR against `main`. CI will re-run typecheck, tests, build, and the CDK synth smoke test.

## Release process

Publishing is driven by [Changesets](https://github.com/changesets/changesets) and the release workflow in `.github/workflows/release.yml`:

- Every push to `main` triggers the workflow.
- If pending changesets exist, the workflow opens (or updates) a **version PR** titled `chore(release): version packages` that bumps versions and writes `CHANGELOG.md` entries for each package.
- When that version PR is merged, the workflow runs `pnpm release` (builds the packages then `changeset publish`) and publishes both packages to npm.
- After a successful publish the job installs each just-published version from the public registry in an isolated working directory and runs a dynamic `import()` smoke test. This catches misconfigured `exports` maps, missing `files` entries, or any other packaging regression that unit tests can't see.

Manual release (normally only used for recovery):

```bash
pnpm changeset          # describe the change
pnpm changeset version  # bump versions + update changelogs
pnpm release            # pnpm -r build && changeset publish
```

### Versioning policy

`@soofi-xyz/chat-adapter-asana` and `@soofi-xyz/chat-adapter-asana-cdk` are **linked** in `.changeset/config.json`. They always ship on the same version number and are treated as a single product:

- A `patch` / `minor` / `major` changeset on either package bumps **both** packages to the same new version, even if only one package changed.
- A major bump on the adapter (for example, when Chat SDK releases a new major and we widen the peer range) therefore also produces a major bump on the CDK construct.
- Internal dependencies between the two packages are kept in lockstep via `updateInternalDependencies: patch`.

Bump the changeset type according to the strictest change across either package:

| Change                                                           | Bump    |
| ---------------------------------------------------------------- | ------- |
| Bug fix, internal refactor                                       | `patch` |
| New public API, new config option, new export                    | `minor` |
| Removed/renamed export, changed signature, peer range major bump | `major` |

When Chat SDK ships a new major version, update the `chat` peer dependency range in `packages/chat-adapter-asana`, run the test suite against it, and land a `major` changeset — both packages will be published together.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
