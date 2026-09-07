# Session 30 Notes: Starter Skills and Durable Memory

**Date**: 2026-09-06
**Status**: ✅ Complete
**Duration**: ~3 hours

## What Was Built

Every sub-app now starts with a method rather than a single convention. Three seeded
workspace skills — `plan`, `implement`, `remember` — replace `working-notes`, every app is
seeded with an `AGENTS.md` Pi loads into every request, and `NOTES.md` is replaced by an
indexed `memory/` directory that is **gitignored**, so it survives the rollback of the code
whose failure it explains.

The organising idea: **`memory/` is the skills manifest applied to notes.** `memory/INDEX.md`
carries one line per note saying *when that note matters*; bodies are read on demand. That
is the same two-register split the Skills section of `AGENTS.md` already describes, and it
is the mechanism a single monolithic file structurally cannot have.

### Components Created

1. **`docs/skills/{plan,implement,remember}/SKILL.md`**
   - `plan` — goal, ordered steps and a check per step into `memory/task.md` before editing
   - `implement` — one step at a time; pairs a twice-failed `edit` with `replace_lines` and
     the line numbers the repair message printed
   - `remember` — the `memory/` format, what earns a note, the size caps, and the
     `NOTES.md` fold-in
2. **`DEFAULT_AGENTS_MD` / `DEFAULT_MEMORY_INDEX`** (`packages/shared/src/apps/templates.ts`)
   - About the *app*, never about method — the method is in the prompt and the skills, and
     restating it would charge every request twice
   - `memory/` added to `DEFAULT_GITIGNORE`
3. **`applyTemplateVars`** (`packages/shared/src/apps/templates.ts`)
   - Lifted out of `createApp`'s template-file loop; three callers now render the same
     placeholders
4. **`backfillAgentMemory`** (`apps/electron/src/main/migrate-workspace.ts`)
   - Three independent repairs into existing apps, on every launch, idempotently
5. **`VersionManager.isIgnored`** (`packages/shared/src/versions/manager.ts`)
   - Not planned. See **The defect the tests could not have found**.

### Changed

- `system-prompt.ts` — the `NOTES.md` paragraph becomes a `## Memory` section
- `session.ts` — `COMPACTION_NOTICE` names `memory/INDEX.md` and `memory/task.md`
- `superseded-seeds.ts` — one `working-notes` entry, `removed: true`
- `auto-commit.ts` — both paths refuse an ignored path

## Decisions

**Workspace skills, not per-app copies.** An app skill shadows a workspace one by name, so
shipping once gives every app the three skills *and* leaves any app free to override one.
The alternative would have needed a second seeding and correction mechanism, since
`SUPERSEDED_SEEDS` only covers the workspace root — and a defective body shipped into every
app is frozen there forever.

**Gitignored, and that is load-bearing.** `rollback` is a `git checkout`, which restores
tracked files and leaves untracked ones in place. So the note explaining why an approach
failed survives the rollback that failure caused. `templates.test.ts` asserts this through
the real `initGitRepo` rather than asserting a string is in `DEFAULT_GITIGNORE` — the
property is that nothing under `memory/` is *tracked*, and only git can answer that.

**The always-on half is not a skill.** "Check your memory" triggers on *every* task, and a
skill is matched against a description — by the time the model is choosing skills it has
already decided what to do. So the trigger is in `system-prompt.ts` and the *format* is
`remember`, whose body costs nothing until loaded.

**Measured, not estimated, three times — and it changed the code once.** The manifest went
from ~361 to 510 tokens (+149, not the planned +130: `renderSkillEntry`'s XML wrapper costs
~20 tokens per skill that a description-length estimate misses). The first draft of the
prompt section cost 141 against the 56 the `NOTES.md` paragraph cost; the plan had guessed
~70. Cutting the sentence explaining *why* rather than *what to do* brought it to 114.
Spending freely in the always-on block would have undercut the argument the block makes.

## Deviations from Plan

1. **`applyTemplateVars` lives in `templates.ts`, not `manager.ts`.** The placeholders are
   defined there, and `migrate-workspace.ts` needs it without pulling in `AppManager`.

2. **`createApp` is not directly tested.** The plan called for `manager.test.ts` cases.
   `APPS_DIR` resolves from `homedir()` at module load and bun shares the module registry
   across test files, so redirecting `HOME` in a `beforeEach` does not reach it. A first
   attempt proved this — and the guard asserting `getAppsDir()` was inside the temp
   directory is the only reason it did not create five apps in the real `~/.keylimepi/apps`.
   `templates.test.ts` covers everything reachable with an explicit path instead. Making
   `APPS_DIR` injectable would touch the security-critical `appDir` path and was out of
   scope.

3. **The plan was wrong about `Outdated`, and the code was right.** It claimed an edited
   `working-notes` would be flagged Outdated. `outdated` is `isSupersededSeed`, true only of
   an *exact* match to a shipped body — and an exact match is deleted by `seedSkills` at
   startup before any panel renders. So `outdated` means "the correction did not run". The
   residual is real and accepted: an install whose `working-notes` was edited keeps a skill
   advertising `NOTES.md` while the prompt says `memory/`. Never overwriting a user's edit
   is the rule the seeding design rests on.

4. **A pre-existing test was narrowed, not deleted.** `never rewrites a .gitignore the app
   already has` asserted byte-identity, and `backfillAgentMemory` appends one line. The
   test's *name* stays true — appending is not rewriting — so the assertion now covers what
   must stay true (nothing the user wrote is lost; that step reports doing nothing) with a
   pointer to where the append is covered.

5. **Two `AGENTS.md` statements were corrected beyond adding the new section.** The
   compaction bullet still sent the agent to `NOTES.md`. And *Config location* stated the
   rule as "outside an app's directory, because anything kept there would be rolled back" —
   `memory/` is the counterexample, since `checkConfinement` refuses every path outside the
   app root. The real rule is "not tracked by the app's repo".

6. **One unplanned fix, one unverified check.** See below.

## The defect the tests could not have found

Running the app surfaced something 630 passing tests did not.

`git.add` on an ignored path is a **silent no-op**. The `git.commit` that follows still
succeeds, producing an **empty commit** whose message names a file it does not contain. In
the History panel that expands to nothing — which reads as a commit with a small diff, not
as one with no diff.

Session 30 made this routine rather than rare: `memory/` is ignored by design, so every note
the agent writes minted one. A real app had five before it was noticed, one per memory write
in a single session.

The defect is **older and more general** than the directory that exposed it — any ignored
path the agent writes to did this, and a template ignoring `dist/` is enough. So
`VersionManager.isIgnored` asks git rather than checking a list of paths this app knows
about, and both auto-commit paths consult it. `autoCommitRefactor` filters rather than
refuses, because the other files in a rename still have to be committed together.

The pre-fix behaviour was reproduced directly before the tests were written: `git.add` on
`memory/task.md` then `git.commit` yields a commit whose `listFiles` is `['.gitignore',
'a.ts']`.

## What the live run actually verified

On the real workspace (three existing apps plus one created by hand during the session):

- `working-notes` deleted; `plan`, `implement`, `remember` installed
- All three existing apps: one backfill commit each, `memory/` untracked, `git_status` clean
- `pony-pony-pony` kept its hand-written `AGENTS.md` — only its `.gitignore` was committed,
  which is the "never rewrites" path exercised on real data
- Exactly one `memory/` line per `.gitignore`, including the app that received
  `DEFAULT_GITIGNORE` from the earlier step — the ordering dependency, live
- The Skills panel reported `8 of 10 active · 528 tokens`, with the two shadowed workspace
  skills shown at **0 tk** and labelled *"This app has its own implement, which the agent
  gets instead"*

**The loop ran end to end on a local model.** The new `Mood` app's commit log is
`write: memory/task.md` → hook → `edit: memory/task.md` → component → `edit: memory/task.md`
→ `App.tsx` → css → `write: memory/visualizer.md` → `edit: memory/INDEX.md`, and `task.md`
was deleted at the end as `implement` instructs. The durable note it left records *why* —
the user-gesture requirement for `getUserMedia`, and the StrictMode double-mount — rather
than summarising the code, which is exactly the rule `remember` states.

**Not verified**: the context meter's `context-files` block showing `AGENTS.md`. The window
closed before that check ran.

## Gotchas

- **`bun test` shares a module registry across test files.** A module-level constant
  computed from `homedir()` cannot be redirected by setting `process.env.HOME` in a
  `beforeEach`. Any test that creates real user data needs a guard asserting the redirect
  took *before* it writes anything — that guard is the only thing that kept this session
  from writing five apps into the real workspace.

- **The electron package resolves `@keylimepi/shared` through `dist`, not `src`.** A new
  export needs `bun run --filter @keylimepi/shared build` before it typechecks in
  `apps/electron`.

- **`git.add` on an ignored path fails silently and successfully.** No error, no return
  value to check; the empty commit downstream is the only symptom. Ask `git.isIgnored`
  first.

- **`isSupersededSeed` takes the parsed body, not the file.** `Skill.content` is
  `parsed.body` (`loader.ts:148`). Feeding it a raw `SKILL.md` returns false and looks like
  a broken migration.

- **A seed body is an equality key against files on users' disks.** Generate it with
  `git show` and check it round-trips through `parseSkillBody`; never retype it. One
  character adrift and the check answers "the user edited this" for a file nobody touched.

- **A wrapped `description:` in frontmatter is silently truncated.** `parseSkillFrontmatter`
  matches `description:\s*(.+)` and `.` does not match a newline. The second line is
  discarded with no error, and the description is the only text the model matches a skill
  on. There is now a guard.

- **The agent had already invented this design.** `pony-pony-pony`'s hand-written
  `AGENTS.md` describes a "plan → implement" workflow, and `moon-phase` carries app-scoped
  `plan` and `implement` skills the agent wrote itself — which now shadow the workspace
  copies. Those app skills still reference `NOTES.md`, so on that app the old convention
  wins until someone updates them. That is the shadowing design working as specified, and
  it is also a second form of the accepted residual.
