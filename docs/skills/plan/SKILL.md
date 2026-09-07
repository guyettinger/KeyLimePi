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
