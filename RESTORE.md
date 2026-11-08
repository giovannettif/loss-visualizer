# RESTORE — how to return to the BackupPlan1 snapshot

The stable version you liked is frozen in git as the tag **`BackupPlan1`**
(commit: "BackupPlan1 — stable version: all 9 sections, interaction v4, professional copy, multi-well swarm, hover-to-look").

## What is in the snapshot
All source (`src/`), all docs (`PLAN.md`, `P3-proposal.md`, `BUILD-PLAN.md`, `PROPOSAL-DRAFT.md`, `STATUS.md`, this file), `tools/` (gate scripts + portable-Node bootstrap), `index.html`, `debug.html`, configs.

## What is NOT in git (regenerable, git-ignored)
- `node_modules/` — reinstall: `bash tools/run-install.sh` (or `npm install` with the portable Node: `export PATH="$PWD/tools/node:$PATH"`)
- `shots/` — verification screenshots: regenerate with `bash tools/run-gate.sh tools/shots.mjs`
- `qa/` — QA evidence screenshots (297MB)
- `.zcode/` — workflow machinery

## How to go back to the snapshot
**Look without changing anything (recommended first):**
```bash
git log --oneline BackupPlan1          # see the snapshot commit
git diff BackupPlan1 -- src/index.html # see what changed since, per file
```

**Throw away everything after the snapshot and return to it exactly:**
```bash
git reset --hard BackupPlan1
```
⚠️ This permanently discards all changes made after `BackupPlan1` — uncommitted work included. If you want to keep the newer work first: `git branch later-work` then `git reset --hard BackupPlan1` (the newer work stays reachable on the `later-work` branch).

**Just restore a single file from the snapshot:**
```bash
git checkout BackupPlan1 -- src/view/LandscapeView.ts
```

## Running the restored version
```bash
export PATH="$PWD/tools/node:$PATH"
npm run dev          # dev server on http://localhost:5173
npm run build && npm run preview   # production build on http://localhost:4173
```
