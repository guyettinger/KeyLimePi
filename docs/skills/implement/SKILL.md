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
