# Security

RackDraw holds network documentation: IP plans, device names, serial numbers, sometimes password-protected client
files. Security problems are taken seriously.

## Reporting a problem

**Please don't open a public issue for a security problem.** Report it privately instead:
GitHub → this repository → **Security** tab → **Report a vulnerability**.

Include what you found, the RackDraw version (Help → About), and how to reproduce it: a small sample file is ideal,
but **never send a file with real client data**. You'll get an answer within a week; fixes go out as a new release,
and you'll be credited in its notes unless you'd rather not be.

## Supported versions

Only the latest release gets fixes. RackDraw has no automatic updates yet: install the newest
`RackDraw-Setup-x.y.z.exe` from the Releases page.

## What is in scope

- Opening files from someone else: `.rackdraw`, older `.rackdraw.json` / `.netcraft.json`, backups, stencil
  libraries, Visio `.vsdx` / `.vssx` / `.vstx`, DXF, PDF, pictures, CSV / Excel sheets, network scans. A file must
  never run code, read or write other files, or make RackDraw unusable.
- The desktop app (Electron): anything that lets page content reach the computer beyond saving the user's own
  client files.
- Password-protected files and backups (PBKDF2-SHA256 + AES-256-GCM through WebCrypto): anything that weakens them.

Out of scope: problems that need someone who already controls the computer, and the unsigned installer warning
(code signing is on the to-do list).

## How RackDraw protects itself (for reviewers)

- Everything read from a file is checked before use (`src/lib/sanitize.ts`, `src/lib/safe.ts`); ZIP files are
  unpacked with size limits (`src/lib/zipSafe.ts`).
- The desktop app runs with context isolation, a sandbox and no Node.js in the page, a narrow preload bridge
  (`electron/preload.cjs`), a Content Security Policy that only allows its own scripts (by hash), and writes only to
  files the user chose (`electron/files.cjs`).
- Nothing is sent over the network: RackDraw works offline and has no telemetry.
- `tests/security.test.ts`, `tests/importers.test.ts` (including a seeded fuzz of every file reader) and the
  end-to-end tests run on every pull request.
