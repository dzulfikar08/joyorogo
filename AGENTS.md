<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->

## Marketing: every user-visible feature gets a release entry

When your change adds or visibly changes something a user can see or use (screen, feature, setting, supported device,
plan or price, a fix people asked for in public), finish with both steps below. Skip refactors, tests, CI, internal
tooling, docs-only and invisible fixes.

1. Write `docs/marketing/releases/YYYY-MM-DD-<slug>.md` from the template in `docs/marketing/releases/README.md`, one
   file per feature. If the feature already has an entry, update that file (for example `available: code` to
   `test-build`) instead of adding another.
2. Create an atur issue (workspace `joyodigitama`, project Joyorogo `JRG`) titled `[Konten] JoyoRogo: <feature>`, state
   Todo, as a sub-issue of JRG-235 (`parent_id` `62fc3334-ca8a-4427-b236-ce1c50b2bc52`), with the entry's angle and
   path, and put its key in the entry's `atur:` field. If atur is unreachable, leave `atur:` empty; the weekly sweep
   files it.

Claims follow `docs/marketing/marketing-plan.md` section 1.1 and `docs/marketing/social-playbook.md`. Never call a
feature available in the Play Store or App Store before it is.
