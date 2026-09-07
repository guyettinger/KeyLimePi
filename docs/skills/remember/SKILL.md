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

Read `memory/INDEX.md` at the start of a task. Open only the notes whose line applies to what
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

- `memory/INDEX.md`: **20 lines or fewer.**
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
3. Add a line to `memory/INDEX.md` for each.
4. Delete `NOTES.md`.

Do this the first time you see one, before starting other work.
