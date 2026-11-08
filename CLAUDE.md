# Ridgecrest Pipe Calculator — project notes for Claude

Read this first in any new session. It carries the decisions and working rules from earlier conversations.

## What this is
A React + TypeScript PWA for pipefitters, modelled on the Pipe Trades Pro 4095 calculator, for Ridgecrest Industries.
- Live site: https://romandc95.github.io/ridgecrest-pipe-calculator/ (GitHub Pages, deployed by `.github/workflows` on push to `main`).
- Preview artifact (claude.ai): https://claude.ai/artifact/FNujdpStN9TGCQW1cvUDP2 — republish `dist-preview/ridgecrest-pipe-calculator.html` to the same URL after each change.
- Owner: RC@ridgecrestindustries.com. Used on iPhone (home-screen app), iPad and desktop.

## Hard rules
- **Never fabricate data.** Do not invent missing table entries, never treat nominal size as actual OD. Every dataset cites its source; say plainly when data is unavailable. Calculated values (e.g. bolt torque) are labelled as calculated, with the method and the source of each input.
- Every change: tests pass, both builds, push, wait for the Pages deploy, republish the preview.
- Keep the in-app Help text (`src/ui/Jobs.tsx`) up to date when a feature changes.
- Measurements on drawings show as feet-inches with a dash: `5'-7 5/8"`, `0'-0 1/2"` style (zero before a fraction with no whole inches). Inch entries like `67 5/8` convert to feet-inches.
- Pipe size dropdowns sort smallest → largest (`NPS_SORTED`).

## Builds and React versions
- `dist/` bundles React 19 (esbuild, target safari15/es2020).
- The preview build (`--preview`) uses React 18 UMD from cdnjs with a jsx shim. **Avoid React-19-only patterns**: no prop named `ref` on function components (that crashed Miter/Cope — use names like `baseline`, `svgRef`), no `<Context value>` without `.Provider`, no `use()` / `useActionState`.
- Each tab is wrapped in `SectionBoundary` (components.tsx): a crash shows Try again / Reset this screen / Copy error instead of taking the app down. `useTool` ignores non-string saved values.

## Deploy flow
```
node scripts/run-tests.mjs > TEST-RESULTS.txt      # all must pass
node scripts/build.mjs && node scripts/build.mjs --preview
git add -A && git -c user.name="Ridgecrest" -c user.email="RC@ridgecrestindustries.com" commit -m "..."
git push origin HEAD
# poll https://api.github.com/repos/Romandc95/ridgecrest-pipe-calculator/actions/runs?per_page=1 until the SHA is completed/success
# then republish dist-preview/ridgecrest-pipe-calculator.html to the preview artifact URL above
```
Browser checks: Playwright + Chromium (`/opt/pw-browsers/...` in the cloud sandbox), serving `dist/` locally. Seed ISO drawings via localStorage key `ridgecrest.v1.iso`; view options in `ridgecrest.v1.isoview`.

## Layout of the code
- `src/engine/` — pure calculation and data (unit-tested): `iso.ts` (ISO sketch model, cut list, welds, materials), `refdata.ts` (B16.5 flanges, bolting, gaskets, valves, torque), `fittings.ts` (B16.9, `NPS_SORTED`), `parse.ts` (length parsing incl. `5'-7 5/8"`), `pipedata.ts`, `hydraulics.ts`, `shop.ts` (miter, cope, expansion).
- `src/ui/` — screens: `App.tsx` (tabs, toast 5 s), `IsoSketch.tsx` (the big one), `isoSymbols.tsx`, `DataTools.tsx`, `PipeTools.tsx`, `ShopTools.tsx`, `LayoutTools.tsx`, `FittingTools.tsx`, `Jobs.tsx` (history, jobs, settings, Help), `components.tsx`.
- `tests/*.test.ts` — vitest-style, run by `scripts/run-tests.mjs`.

## ISO sketch — features in place (keep working)
- Modes Draw / Move / 3D (button order Draw, Move, 3D) with a coloured mode frame (teal / orange / purple) on the working drawing only. New drawings open in the home ISO view.
- Drag-and-drop palette (Valves, Line, Elbows, Branches, Ends) with snapping by item kind; "Connect with" joint type; **Flanges: Weld neck | Socket weld** (SW = Y − socket depth + 1/16" setback, no root gap, socket welds; falls back to WN where B16.5 has no SW flange).
- Separate lines / new start point (no dashed link), tie-in links (line end onto a point or line → elbow/tee).
- Per-size Setup cards: schedule, joint, flange class, gasket, weld gap — reducers change downstream size.
- Tap an offset's angle to change it. Tap a measurement to retype it. Reducers drawn in the direction of the size change.
- Pipe letters (A, B, C… in pipe-traversal order) on the working drawing; item numbers only on the completed sheet. No L# or numeric point callouts on the working drawing.
- Text boxes (border none/box/rounded/cloud, size, colour) with arrows (single/double/none, solid/dashed, straight/curved); tap a text box for its menu incl. Move.
- Weld map with W#/FW# tags, stencil / shop-field / notes; sheet-level weld map on/off.
- Complete → locked 11×17 sheet: title block (customer, job site, job #, system, per-size rows), material list (#), lettered cut list, weld log; pinch / wheel zoom, print, share. No hidden info on the sheet (incl. "to scale").
- Desktop: wheel zooms over the drawing, scrolls the side panel elsewhere; middle-button pans. Full screen uses the whole screen with a compact tool panel.

## Data tab
- Flanges: B16.5 dimensions, diagram, table, and a **Bolt torque** card (stud grade with ASTM A193 yield by size, lubrication/nut-factor presets incl. dry, target as % yield or psi, optional approved job target, passes, wrench, tightening order). Torque is calculated by the PCC-1 short form T = K·D·F/12, not copied from vendor charts.

## Open items / offered but not started
- Account login + sync across devices via **Supabase** — waiting on the owner's Supabase Project URL and anon key. Don't start without them.
- Offered: dash format (`5'-7 5/8"`) in cut list / material list too; pipe letters instead of "Line 3" in line menus.
