# Session 30: Starter Skills and Durable Memory

## Overview

A sub-app is created with source files, a `.gitignore` and a git repo — and nothing that
tells the agent how to work in it. Everything it knows about method comes from the system
prompt and the six workspace skills, and the method those describe is one file:

> For a task of more than a few steps, keep a `NOTES.md` in the app root with the goal
> and the remaining steps, and update it as you go.

`NOTES.md` was the right first answer and it does not scale. It is monolithic, so it is
read whole or not at all; the `working-notes` skill has to tell the agent to keep it
"under a screen" and to "delete finished sections once the whole task is done", which is
an instruction to *destroy* the durable part in order to protect the context budget. It
is tracked, so every update is an auto-commit and a row in the changed-files strip. And
because it is tracked, a `rollback` reverts it — erasing the note explaining the failure
that caused the rollback, at exactly the moment it was worth having.

This session replaces it with the pattern the app already uses successfully one level up.
**`memory/` is the skills manifest applied to notes**: an index of one line per note
saying *when that note matters*, and bodies fetched on demand. Reading fifteen lines and
then one relevant forty-line file is the mechanism; a monolithic file has no way to
express it.

It also gives every app a starting method rather than a single convention. Three skills —
`plan`, `implement`, `remember` — join the workspace library, so every app gets them at
once and any app can override one by writing `skills/<name>/SKILL.md`, which shadows the
workspace copy. And every app gets a seeded `AGENTS.md`: the agent-maintained description
of what the app *is*, which Pi already loads into every request and which no template has
ever written.

### Where this comes from

Four sources converge on the same shape:

- Anthropic's [memory tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)
  makes the agent view its memory directory *before anything else*, then read only what
  applies. Its injected instruction is "assume interruption".
- [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
  pairs a progress log with a checklist, read at session start and updated at session end,
  and marks a feature done only after end-to-end verification.
- The [progressive disclosure pattern](https://aipatternbook.com/progressive-disclosure)
  names three tiers — an always-loaded ~100-token index, an on-demand body, path-referenced
  supplements — and names the monolithic instruction file as the anti-pattern.
- [Agent memory patterns](https://timkellogg.me/blog/2026/04/27/memory-patterns) separates
  files (explorable knowledge), small always-visible blocks, and indexed skills, and warns
  against hierarchies that force search.

**Estimated scope**: Medium (~2–3 hours)
**Prerequisites**: Session 21 (skills that reach the model), Session 29 (the workspace
migration chain)
**Deliverable**: A newly created app that opens with an `AGENTS.md`, a `memory/INDEX.md`
and three method skills in its manifest — and every existing app on disk backfilled with
the same on the next launch, without a `NOTES.md` anywhere in the prompt.

## Objectives

1. `memory/` in every app root: `INDEX.md` (the only file read at session start),
   `task.md` (the live plan), and one file per durable subject. **Gitignored**, so it
   survives a rollback and costs nothing in `git_status`, the strip, or commit noise.
2. Three seeded workspace skills — `plan`, `implement`, `remember` — replacing
   `working-notes` through the existing `SUPERSEDED_SEEDS` path.
3. A seeded per-app `AGENTS.md`, tracked, short, and about the app rather than about
   method.
4. The always-on half of the protocol moved into `system-prompt.ts` and
   `COMPACTION_NOTICE`, replacing every mention of `NOTES.md`.
5. A per-app backfill in `migrate-workspace.ts` so existing installs converge without the
   user doing anything.
6. Live `NOTES.md` files folded into `memory/` by the agent itself, in a visible tool
   call, rather than by code that guesses at their contents.

---

## Anatomy

```
~/.keylimepi/
  skills/
    plan/SKILL.md            <- new, seeded once, shared by every app
    implement/SKILL.md       <- new
    remember/SKILL.md        <- new
    working-notes/           <- removed when untouched, flagged Outdated when edited
    create-skill/ debug-fix/ enhance-ui/ lookup-docs/ manage-versions/

  apps/my-app/
    AGENTS.md                <- new, tracked, in every request
    .gitignore               <- gains `memory/`
    memory/                  <- new, never committed
      INDEX.md               one line per note: what it is and when it matters
      task.md                the live plan; deleted when the task is done
      <topic>.md             one durable subject each
    skills/                  <- still empty; an app skill here shadows the workspace copy
```

The split between the two registers is the whole design:

| Register | Lives in | Cost | Says |
|---|---|---|---|
| Always on | `system-prompt.ts` | ~70 tok/request | Read `memory/INDEX.md` first. Record as you go. Load `remember` for the format. |
| Always on, per app | `<app>/AGENTS.md` | measured in `context-files` | What this app is, how to run it, its conventions. |
| On demand | `plan` / `implement` / `remember` | +149 tok/request advertised, body free until loaded | The method. |

"Check your memory" triggers on *every* task, so it cannot be a skill — a skill is
matched against a description, and by the time the model is choosing skills it has
already decided what to do. The *format* of memory triggers only when writing memory, so
that is a skill, and its body costs nothing until then.

---

## Task 1: The three skills

`docs/skills/` is the editable source; `bun run sync:skills` regenerates
`packages/shared/src/skills/seed-content.ts` from it and a test fails if the two drift.
Write these three, delete `docs/skills/working-notes/`, then run the sync.

### docs/skills/plan/SKILL.md

```markdown
---
name: plan
description: Write the goal, the ordered steps and how you will check each one into memory/task.md before editing anything. Use at the start of any task that needs more than two or three steps, or that you cannot finish in one turn.
---

# Plan Before You Edit

A plan you did not write down is a plan that disappears when your conversation is
summarized. Write it to `memory/task.md` first, then work from the file.

## Find Out What Is There First

Do not plan against a guess. Before writing a step that touches a file, look at it:

- `code_intel` with `outline` on a file tells you its symbols without reading it whole.
- `grep` finds where a name is used.
- `read` the region you are actually going to change.

A plan built on what you assumed the code does is a plan you will throw away on step two.

## The File

```markdown
# Goal

Add a dark mode toggle to the settings page.

## Steps

- [ ] Add a `theme` field to the settings store — src/store/settings.ts
      Check: the store's type compiles and the default is 'light'
- [ ] Render the toggle in the settings panel — src/pages/Settings.tsx
      Check: the toggle appears and calls the store
- [ ] Apply the class to the root element — src/App.tsx
      Check: toggling changes the class on <html>

## Notes

- Tailwind is configured with `darkMode: 'class'`, so this sets a class, not a variable.
- `src/store/settings.ts` already persists to localStorage; reuse that.
```

## Rules

1. **Every step names a file.** A step that does not is not yet a step, it is a wish.
2. **Every step says how you will check it.** If you cannot say what "done" looks like,
   you do not understand the step well enough to write it.
3. **Keep steps small enough to finish in one turn.** A step you cannot finish is a step
   you cannot tick, and an unticked step you already did is worse than no plan at all.
4. **Do not plan a one-line change.** Renaming a variable does not need a file.
5. **Put what you learned in `## Notes`,** then move anything still true when the task
   ends into its own memory note. `task.md` is deleted when the task is done; the notes
   are what stays.

## Then

Load the `implement` skill and work the plan one step at a time.
```

### docs/skills/implement/SKILL.md

```markdown
---
name: implement
description: Work through memory/task.md one step at a time, checking each before starting the next. Use after the plan skill, and whenever you are resuming a task you did not finish.
---

# Work the Plan

Read `memory/task.md`. Take the first unticked step. Do only that step.

## The Loop

1. **Read the region you are about to change.** Not the whole file — the part the step
   names. `code_intel` with `read_symbol` gets you a function by name.
2. **Make the edit.**
3. **Read the compiler errors** that come back attached to the result of your `write`,
   `edit` or `replace_lines`. They are already there; you do not need to run anything.
   A step is not done while its file has an error you introduced.
4. **Do the check the step names.** Writing the code is not the same as it working.
5. **Tick the step in the same turn you finished it.** A checklist that lags will tell
   you to redo work you already did.
6. **Take the next step.**

## When an Edit Will Not Apply

`edit` matches text, and it does not forgive leading indentation, internal whitespace
runs, or blank-line counts. When one fails you are shown the file's real text with line
numbers beside it.

**Do not retype the `oldText` with different indentation.** Use `replace_lines` with the
line numbers you were just shown. That is what those numbers are for, and it cannot fail
this way at all.

## When You Learn Something

If you found out something that will still be true tomorrow — a constraint, a dead end
and why it was one, a command that works — write it to a memory note before you forget
it. Load `remember` for the format. Do this *when you find it*, not at the end.

## When the Plan Is Done

1. Move anything from `## Notes` in `task.md` that is still worth keeping into its own
   memory note, and add its line to `memory/INDEX.md`.
2. Delete `memory/task.md`.
3. Tell the user what you changed and what you checked.

Do not say a task is done because the code is written. Say it is done because you ran
the check the step named and it passed.
```

### docs/skills/remember/SKILL.md

```markdown
---
name: remember
description: The memory directory format — the index, one note per subject, and when to write, merge or delete one. Use when recording something worth keeping, when the index gets long, or when you find a NOTES.md in the app root.
---

# Durable Memory

Your conversation is summarized when it grows too long, and a summary keeps the gist and
drops the specifics — which is exactly backwards. `memory/` is on disk and survives it.

## The Layout

```
memory/
  INDEX.md        one line per note. The only file you read at the start of a task.
  task.md         the task in progress. Deleted when it is done.
  <topic>.md      one durable subject each.
```

`memory/` is not committed. That is deliberate: a rollback restores tracked files and
leaves untracked ones alone, so the note explaining why an approach failed survives the
rollback that failure caused.

## The Index

```markdown
# Memory Index

- task.md — the task in progress: goal, steps, where I am
- vite-dev-server.md — why dev needs host:true, and the port collision it fixes
- api-shape.md — the /api/items response fields, and which are optional
```

One line per file: the name, then **when that note matters**. Write the line the way you
would write a skill's description — it is the only thing you will see before deciding
whether to open the file. "notes about the API" tells a later session nothing.

Read `INDEX.md` at the start of a task. Open only the notes whose line applies to what
you are doing now. That is the whole point: fifteen lines, then one file, instead of
everything.

## What Earns a Note

Something that will still be true next week and that you cannot get back by reading the
code:

- A constraint you discovered the hard way.
- An approach that did not work, **and why** — this is the single most valuable kind.
- A decision and the reason for it.
- A command or a sequence that works.

## What Does Not

Anything you could re-read from the source. Do not summarize a file into memory — the
file is already the memory for that, it is more accurate than your summary, and your
summary will be wrong the moment someone edits it. Write down what the code cannot tell
you.

## Sizes

- `INDEX.md`: **20 lines or fewer.**
- Each note: **50 lines or fewer.**
- Flat. No subdirectories — `grep` finds what nesting would have organised.

When the index is full, do not append. Merge two related notes into one and fix their
lines, or delete a note that has stopped being true. Deleting a stale note is a real
improvement, not a loss: a note that is wrong is worse than no note, because you will
believe it.

## If You Find a NOTES.md

Older apps kept one file in the app root. Fold it in and delete it:

1. Its goal and remaining steps become `memory/task.md`.
2. Anything under its notes that is still true becomes one note per subject.
3. Add a line to `INDEX.md` for each.
4. Delete `NOTES.md`.

Do this the first time you see one, before starting other work.
```

### Delete the old skill

```bash
rm -r docs/skills/working-notes
bun run sync:skills
```

---

## Task 2: Retiring `working-notes`

`seedSkills` never overwrites, so a skill already on disk stays forever unless it is named
in `SUPERSEDED_SEEDS`. `working-notes` has shipped exactly one body — `git log --follow`
over `docs/skills/working-notes/SKILL.md` shows a single commit, and the text carries no
brand name, so it survived both renames unchanged. One entry is therefore enough, and it
must be **byte-exact**: recover it with `git show` rather than retyping it, because a body
that differs by a character makes the check answer "the user edited this" for a file
nobody touched.

Because the correction is a *different* skill rather than a rewrite of this one, the entry
is `removed: true` — `seedSkills` deletes the directory, and `plan`, `implement` and
`remember` are seeded fresh in the same pass.

### packages/shared/src/skills/superseded-seeds.ts

Append to `SUPERSEDED_SEEDS`:

```typescript
  {
    name: 'working-notes',
    removed: true,
    // Superseded by `plan`, `implement` and `remember`, which replace the single
    // `NOTES.md` with an indexed `memory/` directory. Removed rather than rewritten:
    // the correction is three skills under different names, and a skill whose body no
    // longer matches its own name is worse than one that is gone.
    body: `# Working Notes

Before starting a task of more than a few steps, write the plan to \`NOTES.md\` in
the app root. Update it as you go.

... the rest of the file, verbatim ...`
  }
```

**Capture the body before Task 1 deletes the directory.** The shipped text is byte-identical
to the copy at `HEAD` — verified with
`diff <(git show 4f6b266:docs/skills/working-notes/SKILL.md) docs/skills/working-notes/SKILL.md`,
which is empty — so the entry is the current file with its frontmatter removed and the
remainder `.trim()`ed, exactly as `parseSkillBody` does it. Generate it, do not retype it:

```bash
git show 4f6b266:docs/skills/working-notes/SKILL.md \
  | sed '1,/^---$/d' | sed '1,/^---$/d'
```

Backticks and `${` inside it must be escaped for the template literal, the way every
existing entry in the file is.

A user who edited their copy keeps it, and the Skills panel flags it **Outdated** —
which is the honest answer, since the skill it describes no longer exists.

---

## Task 3: The seeded `AGENTS.md` and the gitignore entry

### packages/shared/src/apps/templates.ts

Add `memory/` to `DEFAULT_GITIGNORE`, under the runtime-state section that already
explains why entries live there:

```
# Key Lime Pi runtime state
.chat-sessions.json
.chat-history/
memory/
```

Then a new export beside it:

```typescript
/**
 * The `AGENTS.md` every new sub-app is seeded with.
 *
 * Pi loads this file into every request, so it is the one place where a fact about the
 * app is guaranteed to be in front of the model without a tool call. No template has
 * ever written one, which meant the only thing the agent knew about an app was its
 * source.
 *
 * It is deliberately about the *app*, not about method: the method lives in the system
 * prompt and in the `plan`, `implement` and `remember` skills, and duplicating it here
 * would charge every request twice for the same instruction. What is here is what only
 * this app can say.
 *
 * It is also agent-writable under `acceptEdits`, and it is paid for on every request —
 * so the file says so about itself. An `AGENTS.md` that grows unnoticed is a permanent
 * tax on the context window, visible in the meter's `context-files` block and nowhere
 * else.
 */
export const DEFAULT_AGENTS_MD = `# {{APP_NAME}}

{{APP_DESCRIPTION}}

## Running It

<!-- Fill this in once you know: the command, the port, anything that has to be running
     first. Read it from package.json rather than guessing. -->

## Conventions

<!-- Record the decisions this app has made that its source does not state outright. -->

## Memory

Durable notes live in \`memory/\`. \`memory/INDEX.md\` has one line per note saying when
that note matters — read it before starting work and open only what applies. The plan for
the task in progress is \`memory/task.md\`. Load the \`remember\` skill for the format.

\`memory/\` is not committed, so it survives a rollback of the code.

---

Keep this file short — it is sent with every request. Anything longer than a screen
belongs in a memory note or a skill, not here.
`

/**
 * The starting `memory/INDEX.md`.
 *
 * Seeded rather than left to the agent because an empty directory is indistinguishable
 * from a missing feature: a model told to read `memory/INDEX.md` and given a failed
 * `read` learns that memory does not work here. A file that exists and says it is empty
 * teaches the format instead.
 */
export const DEFAULT_MEMORY_INDEX = `# Memory Index

One line per note: the file name, then when that note matters. Read this before starting
work and open only the notes that apply.

<!-- - api-shape.md — the /api/items response fields, and which are optional -->
`
```

### packages/shared/src/apps/manager.ts

`createApp` currently applies template variables inline in the template-file loop. Lift
that into a helper so the two new files get the same substitution, then write them:

```typescript
/**
 * Substitute a template's placeholders.
 *
 * Extracted from the template-file loop because `AGENTS.md` is written outside it and a
 * second, divergent copy of the replacement chain is how one of them silently stops
 * substituting.
 *
 * @param content - The template text
 * @param params - The app's name, description and id
 * @returns The text with placeholders replaced
 */
function applyTemplateVars(
  content: string,
  params: { name: string; description: string; id: string }
): string {
  return content
    .replace(/\{\{APP_NAME\}\}/g, params.name)
    .replace(/\{\{APP_DESCRIPTION\}\}/g, params.description)
    .replace(/\{\{APP_ID\}\}/g, params.id)
}
```

In `createApp`, beside the existing `.gitignore` seeding and guarded the same way — a
template that ships its own `AGENTS.md` wins:

```typescript
    // Seeded before the template's files, so a template that ships its own `AGENTS.md`
    // overwrites this default rather than being overwritten by it — the same ordering
    // the `.gitignore` above relies on.
    if (!template.files.some((file) => file.path === 'AGENTS.md')) {
      await writeFile(
        join(appPath, 'AGENTS.md'),
        applyTemplateVars(DEFAULT_AGENTS_MD, vars)
      )
    }

    // The memory directory is in `DEFAULT_GITIGNORE`, so `initGitRepo` below will not
    // add it. That is what keeps a rollback from deleting the notes explaining the
    // failure that prompted it.
    await mkdir(join(appPath, 'memory'), { recursive: true })
    await writeFile(join(appPath, 'memory', 'INDEX.md'), DEFAULT_MEMORY_INDEX)
```

---

## Task 4: The always-on half

### apps/electron/src/main/agent/system-prompt.ts

Replace the closing `NOTES.md` paragraph:

```typescript
For a task of more than a few steps, keep the plan in \`memory/task.md\` and update it as
you go. \`memory/INDEX.md\` holds one line per durable note saying when that note matters —
read it before your first edit and open only the notes that apply. Record what you learn
there as you work: your conversation gets summarized when it grows too long, and those
files are what survives. The \`plan\`, \`implement\` and \`remember\` skills have the rest.
```

### apps/electron/src/main/agent/session.ts

```typescript
/**
 * What the agent is told after its history has been summarized away.
 *
 * Compaction is where a long task quietly goes wrong on a small model: the plan was
 * in the messages that just got replaced by a paragraph. `memory/` is on disk, so it
 * survives — but only if the agent remembers to look. Two files are named rather than a
 * directory, because a `ls memory/` answers with names and the whole reason the index
 * exists is that a name does not say when a note matters.
 */
const COMPACTION_NOTICE =
  'Your earlier conversation was summarized to free up context. Read `memory/INDEX.md` ' +
  'and `memory/task.md` in the app root before continuing — they hold the goal, the ' +
  'remaining steps, and what you have already worked out.'
```

`customType: 'anyapp-compaction-notice'` **does not change.** It is written into Pi's
session transcripts on disk and renaming it orphans every notice in a conversation the
user can still open.

### apps/electron/src/main/ipc.ts

The comment at the skill-seeding handler names `working-notes` and `NOTES.md` as the
worked example of a skill the compaction nudge depends on. Update it to name `remember`
and `memory/INDEX.md`; the reasoning it states is unchanged.

---

## Task 5: Backfilling existing apps

`migrateWorkspace` already walks every app under the *current* root on every launch — the
legacy-root move at the top is guarded, but the per-app loop below it is unconditional and
each step is independently idempotent. That is the right home; no new mechanism.

Order matters: this runs **after** `backfillGitignore`, so an app that has no `.gitignore`
gets `DEFAULT_GITIGNORE` (which already contains `memory/`) and this function then finds
the entry present and does nothing.

### apps/electron/src/main/migrate-workspace.ts

```typescript
/** The ignore entry that keeps `memory/` untracked. */
const MEMORY_IGNORE_ENTRY = 'memory/'

/**
 * Gives an app the `AGENTS.md`, the ignored `memory/` and the memory index it was
 * scaffolded without.
 *
 * Three independent repairs, because an app can be missing any subset of them: apps
 * created before this session have none, and an app created between this session's
 * `.gitignore` change and its `createApp` change could have the entry and no index.
 *
 * The `.gitignore` is **appended to**, which is a deliberate narrowing of the rule
 * {@link backfillGitignore} states — that an existing `.gitignore` is never touched,
 * however little it covers. Replacing a user's file is not the same as adding one line
 * to it, and without the line `initGitRepo`'s add-everything makes `memory/` tracked:
 * every note becomes an auto-commit and a rollback deletes the notes that explain the
 * failure being rolled back. That is the outcome the whole design exists to avoid, so
 * the entry is worth the exception.
 *
 * `memory/INDEX.md` is written but never committed — it is ignored, which is the point.
 * An empty directory is not enough: a model told to read a file and handed a failed
 * `read` learns that memory does not work in this app.
 *
 * @param appPath - The app's root
 * @returns Whether anything was written
 */
async function backfillAgentMemory(appPath: string): Promise<boolean> {
  let changed = false
  const committable: string[] = []

  const ignorePath = join(appPath, '.gitignore')
  try {
    const current = await readFile(ignorePath, 'utf-8')
    const listed = current
      .split('\n')
      .some((line) => line.trim() === MEMORY_IGNORE_ENTRY)
    if (!listed) {
      const separator = current.endsWith('\n') ? '' : '\n'
      await writeFile(
        ignorePath,
        `${current}${separator}\n# Key Lime Pi agent memory\n${MEMORY_IGNORE_ENTRY}\n`,
        'utf-8'
      )
      committable.push('.gitignore')
      changed = true
    }
  } catch {
    // No `.gitignore` at all. `backfillGitignore` runs before this and writes
    // `DEFAULT_GITIGNORE`, which already carries the entry; if that failed, failing
    // again here is not worth reporting twice.
  }

  const agentsPath = join(appPath, 'AGENTS.md')
  if (!(await exists(agentsPath))) {
    // The app's real name, so the seeded heading is not the directory slug. Read the
    // same way `migrateAppMeta` reads it, and fall back to the directory name rather
    // than refusing: an app whose metadata will not parse still benefits from the file.
    const id = basename(appPath)
    let meta: Partial<AppMetadata> = {}
    try {
      meta = JSON.parse(await readFile(join(appPath, META_FILE), 'utf-8'))
    } catch {
      // Unreadable or not yet renamed to the current metadata name. The fallbacks hold.
    }

    await writeFile(
      agentsPath,
      applyTemplateVars(DEFAULT_AGENTS_MD, {
        name: meta.name ?? id,
        description: meta.description ?? '',
        id: meta.id ?? id
      }),
      'utf-8'
    )
    committable.push('AGENTS.md')
    changed = true
  }

  const indexPath = join(appPath, 'memory', 'INDEX.md')
  if (!(await exists(indexPath))) {
    await mkdir(join(appPath, 'memory'), { recursive: true })
    await writeFile(indexPath, DEFAULT_MEMORY_INDEX, 'utf-8')
    changed = true
  }

  if (committable.length > 0) {
    try {
      for (const filepath of committable) {
        await git.add({ fs, dir: appPath, filepath })
      }
      await git.commit({
        fs,
        dir: appPath,
        author: COMMIT_AUTHOR,
        message: 'chore: add AGENTS.md and ignore the agent memory directory'
      })
    } catch (error) {
      console.error(`Could not commit the memory backfill in ${appPath}:`, error)
    }
  }

  return changed
}
```

`applyTemplateVars`, `DEFAULT_AGENTS_MD` and `DEFAULT_MEMORY_INDEX` are exported from
`@keylimepi/shared` alongside `DEFAULT_GITIGNORE`, which this module already imports. The
node imports gain `basename`; `readFile`, `mkdir`, `writeFile`, `join` and the local
`exists` helper are all already there. `AppMetadata` comes from `@keylimepi/core`.

`migrateAppMeta` runs earlier in the same loop and may have just *renamed* an older
metadata file to `META_FILE`, so reading `META_FILE` here is correct in both the migrated
and the already-current case.

Add to `MigrateWorkspaceResult`:

```typescript
  /** App ids given the `AGENTS.md` and `memory/` they were scaffolded without. */
  backfilledMemory: string[]
```

initialised to `[]`, and in the per-app loop, immediately after the `.gitignore` step and
guarded on its own the way every other step is:

```typescript
    try {
      if (await backfillAgentMemory(appPath)) result.backfilledMemory.push(id)
    } catch (error) {
      console.error(`Could not backfill the memory directory for app ${id}:`, error)
    }
```

### What is deliberately not migrated

A live `NOTES.md` is left where it is. Its contents are prose only the model can sort into
subjects, and code that guessed would either lose the file or produce one note called
`notes.md` — which is the shape being replaced. The `remember` skill tells the agent to
fold it in the first time it sees one, which happens in a visible tool call the user can
watch and roll back.

---

## Task 6: Tests

### packages/shared/src/skills/seed.test.ts

The existing assertions match on `NOTES.md` and must be replaced, not deleted — they are
the guard that the compaction nudge and the skill library agree.

- `seedSkills` writes `plan`, `implement` and `remember` on an empty directory.
- The seeded `remember` body mentions `memory/INDEX.md`; `plan` and `implement` mention
  `memory/task.md`. (This is the drift guard the `NOTES.md` assertions used to be.)
- An untouched `working-notes` is removed.
- An edited `working-notes` is left on disk and reported by `isSupersededSeed` as false.
- Every entry in `SEED_SKILLS` parses to a non-empty single-line description — the
  manifest is the only thing the model matches on, and a skill with no description is
  seeded, listed in the panel, and invisible to the agent.

### packages/shared/src/apps/manager.test.ts

- `createApp` writes `AGENTS.md` with `{{APP_NAME}}` substituted.
- `createApp` writes `memory/INDEX.md`.
- The seeded `.gitignore` contains `memory/`.
- After `initGitRepo`, `git.statusMatrix` reports nothing under `memory/` — the assertion
  that actually proves the rollback property, rather than asserting the string is in a
  file.

### apps/electron/src/main/migrate-workspace.test.ts

- An app with an existing `.gitignore` lacking the entry gets it appended, and the rest of
  the file is unchanged.
- Running twice appends once. (`backfillGitignore`'s own idempotence test is the model.)
- An app with no `AGENTS.md` gets one carrying its metadata name; an app with one keeps it
  byte for byte.
- `memory/INDEX.md` is created and is not committed.
- A directory under `apps/` with no metadata file is left entirely alone.

---

## Task 7: Documentation

- **`AGENTS.md`** (repo root): a new section for the memory layout — the two registers,
  why `memory/` is gitignored, and why the index is a manifest rather than a directory
  listing. It goes after **Skills**, which it depends on for the manifest analogy.
- The **Skills** section's table of three populations gains nothing; `memory/` is not a
  skill population. But the line describing `working-notes` as the seeded `NOTES.md`
  convention is now false and must change.
- **`docs/plans/README.md`**: add the Session 30 row.

---

## Verification

```bash
bun run sync:skills          # regenerates seed-content.ts from docs/skills/
bun run typecheck:all
bun test
```

`bun test` must include the seed-content drift test passing *after* the sync — a plan that
edits `docs/skills/` and forgets the sync is the exact failure the Session 29 notes record.

Then, in the real app (the `run-app` skill):

1. **A new app.** Create one. Its file tree shows `AGENTS.md` and `memory/INDEX.md`; the
   Code panel opens both. The changed-files strip is empty — `memory/` must not appear.
2. **The manifest.** Open the Skills panel. `plan`, `implement` and `remember` are listed
   under workspace skills; `working-notes` is gone. The header's per-request token count
   has moved by **+149** against the previous six-skill total, and the context meter's
   `skills` block agrees with it.

   Measured on the rendered manifest entries, not on the descriptions alone —
   `renderSkillEntry` wraps each in an indented `<skill>` block that costs about 20 tokens
   on its own, which a description-length estimate misses:

   | Skill | Entry | Body (free until loaded) |
   |---|---|---|
   | `plan` | 74 | 556 |
   | `implement` | 63 | 514 |
   | `remember` | 74 | 742 |
   | `working-notes` (removed) | −62 | −509 |

   The five untouched seeds total 299 tokens of manifest, so the library goes from ~361 to
   510 — about 1.6% of a 32k window.
3. **The context meter.** The `context-files` block is now non-zero on a fresh app and
   labelled `AGENTS.md` — the fixed cost of the seed, measured rather than estimated here.
4. **An existing app.** On an install that predates this, launch and confirm the app now
   has `AGENTS.md` and `memory/INDEX.md`, that its `.gitignore` has one `memory/` line, and
   that the History panel shows exactly one new commit for the backfill. Launch again: no
   second commit.
5. **The loop, end to end.** Ask a running app for a three-step change. The agent should
   load `plan`, write `memory/task.md`, load `implement`, and tick steps as it goes. Force
   a compaction (or use `Summarize now`) mid-task and confirm the notice sends it back to
   `memory/INDEX.md` and it resumes from the right step.
6. **The rollback property.** With a note in `memory/`, roll the app back to an earlier
   commit. The note is still there. This is the one behaviour that cannot be checked by a
   unit test on the string in `.gitignore`.
