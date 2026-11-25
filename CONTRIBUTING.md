# Contributing to RackDraw

Thanks for helping! RackDraw is a free, open-source alternative to Visio for documenting networks, racks and floor
plans, made for IT providers (MSPs). Bug reports, ideas, Visio files that don't import well, and code are all welcome.

## Reporting bugs and asking for features

Use the issue templates (Issues → New issue). For a bug, say which version (Help → About), Windows desktop app or
browser, and the steps. A sample file helps a lot, but **remove real client data first** (names, IPs, serials).
Security problems go privately: see [SECURITY.md](SECURITY.md).

## Getting started

Requires Node 22.6 or newer.

```bash
npm install
npm run dev          # the web version at http://localhost:3000
npm run desktop      # build and start the desktop app
```

Your own RackDraw data is never touched by development builds if you set `RACKDRAW_DATA_DIR` to a scratch folder
when you start the desktop app.

## Before you open a pull request

```bash
npx tsc --noEmit         # types
npx eslint src tests e2e # lint
npm test                 # unit tests (includes a fuzz of every file reader)
npm run build && npm run e2e   # the real desktop app, driven by Playwright
```

GitHub runs all of these on every pull request (`.github/workflows/ci.yml`).

- **Add an entry to `RELEASES` in `src/lib/whatsNew.ts`** for anything a user would notice (a test checks that the
  newest release has notes). Write it for the user: where it is and what it does.
- **Add a test** for a bug fix or a calculation: `tests/*.test.ts` for logic (Node's test runner), `e2e/*.spec.ts`
  for something only the real app shows.
- Keep pull requests to one change; describe what a user will see.
- **Dependencies**: please open an issue before adding one. RackDraw has no runtime dependencies beyond what it
  bundles, and every added package is code that opens untrusted files. If you add one the app imports, run
  `npm run notices` to update THIRD-PARTY-NOTICES.md.

## Things that must not change

RackDraw used to be called NetCraft. Existing users' data depends on these, so keep them as they are:

- the desktop app id `com.crlsgeraldino.netcraft`, the `app://netcraft` origin and the `%APPDATA%\NetCraft` data
  folder;
- the lowercase `netcraft` storage keys, clipboard type and file-format tags;
- older `.netcraft.json`, `.rackdraw.json` and `.netcraft-stencils.json` files must keep opening.

## Stencils and artwork

RackDraw ships only its own generic, built-in stencils (`src/lib/stencils.tsx`, drawn in code). **Don't add vendor
artwork, logos or stencils copied from Visio or a manufacturer**: users import those themselves (Insert → Visio
Stencil). Visio files you use for testing must not be committed if they contain Microsoft's or a vendor's shapes.

## Where things are

| Folder | What |
|---|---|
| `src/components/` | The editor: ribbon, canvas, panels, dialogs |
| `src/store/useDiagramStore.ts` | All editing commands and undo (Zustand) |
| `src/lib/` | Pure logic: file formats, exports (PDF, Word, Excel, PowerPoint, Visio), calculations |
| `electron/` | The desktop app: window, file access, security rules |
| `tests/`, `e2e/` | Unit tests and end-to-end tests |

By contributing, you agree that your contribution is released under the MIT License (see [LICENSE](LICENSE)).
