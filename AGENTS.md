# Working on TAPAAL Web

Run commands at the repository root. Start with the [README](README.md) for setup and the supported model families.

- **Editor behaviour.** Check the relevant report in [design/](design/) and the corresponding native behaviour when changing gestures, selection, geometry or simulation. Use real browser input for canvas, focus, clipboard or file interactions. The scripts document their expected build mode and browser dependencies.
- **Models and files.** Keep the authored network and undo history authoritative. Simulate a projection and save the initial model. For changes to a codec or model family, test open → edit → undo → save → reopen. Reject unsupported semantics explicitly and preserve original examples and upstream notices.
- **Examples.** Run `npm run examples:check` when changing model support. After verifying that support really changed, run `npm run examples:update` and review the catalog diff.
- **Checks.** Run focused Vitest specs during development. Before handing off changes, run the relevant checks in [.github/workflows/check.yml](.github/workflows/check.yml). For simulation semantics, consult the matching differential harness in `scripts/native-reference/` and record which native version you compared.
- **Temporary environments.** Follow the host's workload and cleanup instructions. Keep user demos opt-in. Report which tests you ran and any outstanding compatibility limits.
