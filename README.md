# PipeWorks Pro

Pipefitting layout and fabrication calculator for iPhone (installable web app, works offline).
React + TypeScript. The calculation engine (`src/engine/`) is pure TypeScript with no UI code and is shared by the keypad and the guided screens.

## Run it

```bash
npm install
npm run dev            # http://localhost:5173 (no service worker in dev)
npm test               # vitest, 150 tests
npm run typecheck
npm run build          # dist/ — installable, offline-capable PWA
npm run build:preview  # dist-preview/ — single-file page (no service worker)
```

No network? `npm run test:offline` runs the same tests with a built-in shim.

## Put it on your iPhone

Service workers need HTTPS, so host `dist/` on any static HTTPS host (GitHub Pages, Netlify, Cloudflare Pages, an internal web server). Open the URL in Safari → Share → **Add to Home Screen**. After the first load it runs offline. Settings, history, jobs, memory registers and tool inputs are stored on the phone (localStorage) and never leave it.

## What's in it

| Area | Functions |
|---|---|
| **Calc** (keypad) | Feet-inch-fraction and metric entry, dimensional math (length × length = area, × length = volume; mismatches rejected with an explanation), ( ), %, xʸ, ʸ√x, x², √x, 1/x, ±, π, sin/cos/tan and inverses (degrees), D:M:S, order-of-operations or chain mode, Offset / Run / Travel / Angle-Slope project keys, Roll, take-out & arcs, gap, cutback, pipe material/type/size data, elbow type, flow / velocity / pressure / force / area, pressure loss, gal/L/lb/kg/°F/°C/gpm/L/s/cfm/cfs conversions with weight/volume density, cost, M+ / M− (total, average, count), Stor/Rcl 1–9, paperless tape. |
| **Layout** | Simple offset (any two of O, A, L, θ), rolling offset (H & V or O & φ, plus A, L or θ), slope/grade/drop, parallel cutback, combination offset (entry/exit angles for any in/out directions). Conflicting or insufficient inputs are reported. Optional cut length with separate take-out and gap per end. **Miter** (segmented / lobster-back bends: cut angle, heel/centerline/throat for middle and end pieces, take-out, wrap-around template ordinates). **Cope** (fish-mouth / saddle cut for a branch on a header at 15–90°, centered or offset, cut-back ordinates and a template plot). **Expansion** (thermal growth for carbon/stainless steel, copper, aluminum, cast iron, PVC, CPVC, ABS, HDPE, PE; coefficients from Engineering ToolBox). |
| **ISO** | Isometric sketch. Draw by dragging point to point along the 30/60/90 iso paper (lines stay on the paper directions); Add offset builds simple and rolling offsets from heading, fitting angle and offset/roll amounts; New start point (pin button on the drawing) begins a separate line anywhere; branch fittings dropped on a line split it and add a branch; tap a fitting for Move / Change / Joint / Delete, or drag it along its line; connection type per fitting (butt weld, socket weld, threaded, soldered, glued, flanged) with joint symbols, drawing default in Setup; two-finger twist / compass turn in 90° steps (on a flat, E–W or N–S plane) or with direction buttons; branch from any point (tee). Tap a line to dimension it later (single length, or offset legs / travel), change direction, add valves, flanges, reducers, unions, spool breaks, or delete it; tap a point for end type (cap, flange, blind, plug, field weld) and notes. Offsets drawn with dashed legs and hatched triangles, each leg dimensioned. Fittings & valves palette (drag-and-drop or tap to place): 13 valve types on lines plus angle, 3-way, relief, vent and drain valves; flange pairs, orifice flanges, spectacle blinds, concentric/eccentric reducers, swages, unions, couplings, dielectric unions, expansion joints, flex connectors, Y and basket strainers, steam traps, flow meters, sight glasses, spool breaks; LR/SR/3R/5R/mitered/threaded elbows; straight and reducing tees, weldolets, sockolets, threadolets, stub-ins, laterals; caps, flanges, blinds, plugs, threaded ends, field welds, nozzles, hose connections, gauges, thermowells. SR, 3R and 5R take-outs and olet headers flow into the cut list. Sketch or to-scale view, 3D orbit, ISO/plan/elevation presets, Home button, compass that sets North. Full-screen landscape mode with hideable tools. Cut list per line (C-C less B16.9 LR elbow / tee take-outs and root gaps; undimensioned lines flagged). Drawing library on the device, share cut list and PNG. |
| **Fittings** | Take-out & inside/center/outside arcs (B16.9 or manual R & OD), cut length with every deduction shown, elbow trim (retained vs removed angle, arcs measured from the kept factory end), **Fit-to-Fit** solver. |
| **Pipe** | Pipe data (OD, ID, wall, area, capacity, empty & filled weight), flow/velocity, pressure·force·area, pressure loss, unit converter, circle. |
| **Data** | Reference library. **Flanges** (ASME B16.5, Class 150–2500): OD, thickness, raised face, hub, length through hub by type, bolt circle, bolts, stud lengths RF/RTJ, wrench size, full class tables. **Bolting**: torque from target stress and nut factor, pass torques, cross-pattern tightening order diagram. **Gaskets**: B16.20 spiral-wound dimensions. **Fittings**: B16.9 elbows, tees, reducers, caps, 180° returns, stub ends; B16.11 socket-weld and threaded; B16.3 150# malleable; threaded and socket take-outs. **Valves**: B16.10 face-to-face (gate, globe, swing check, ball). **Pipe & supports**: volume in all units, inside/outside surface area, B31.1 support spans, parallel pipe spacing, Weldolet center-to-end. Every table shows its source. |
| **Jobs** | History (auto-records = results), favorites, named jobs, reopen saved guided calculations, copy/share, settings, help. |

### Keypad: entering vs. solving
Type a value and press a project key → **stored**. Press a project key with nothing typed → **solved**; press again to cycle related results (Travel → CUT, TO, GAP, FIT°, IARC, CARC, OARC, RUN, OFST). Only two of Offset/Run/Travel/Angle are independent; a third entry replaces the oldest and the display says which. Conv gives the second function printed above each key (Help tab has the full list).

### Fit-to-Fit solver
Elbow 1 (fixed angle, measured center-to-face) is rolled about its inlet and welded directly to elbow 2, which is trimmed from a 90° of radius R (or is a fixed-angle fitting). Given inlet/outlet directions, the required drop or offset, and the joint gap, it solves the roll ρ and the retained angle β numerically from the actual tangent geometry of **both** fittings, then reports travel, run, advance, lateral position, elbow-2 clocking, all endpoint coordinates and tangents, and trim arcs. Example (inlet +X, outlet +Y, 2" drop, 6" C-F 90° into a 6"-radius trimmed elbow, zero gap): roll ≈ 16.87°, retained ≈ 16.87°, travel ≈ 6-7/8". If the outlet runs parallel to the inlet it returns both solutions and names the missing constraint (which side). A fixed-angle second fitting is flagged as over-constrained when it cannot meet the drop.

## Data sources (bundled)

| Material | Source | Coverage |
|---|---|---|
| Steel | ASME B36.10M | NPS 1/8–24, Std/XS/XXS and Sch 10–160 where listed |
| Stainless | ASME B36.19M (+ Sch 160 from B36.10M) | 5S, 10S, 40S/80S (≤ 12), 160 |
| Copper | ASTM B88 K/L/M, B306 DWV, B819 medical | 1/4–12 as listed |
| PVC | ASTM D1785 Sch 40/80; ASTM D2241 SDR (wall = OD/SDR, min 0.060") | NPS 1/2–12 (no 3-1/2, 5) |
| Aluminum | ANSI H35.2 (B36.10M dims) | Sch 40/80, NPS 1/8–12 |
| Elbows | ASME B16.9 center-to-end (LR 90, LR 45, SR 90) | NPS 1/2–24 |

**Data tab, not included:** ring numbers for Classes 150/900/1500/2500 (only 300–600 could be confirmed), B16.47 large-diameter, B16.36 orifice and AWWA flanges, B16.21 flat gaskets, B16.48 line blanks (published sources disagree on thickness), fitting/flange/valve weights, reducing-tee outlet dimensions, sockolet/threadolet/elbolet heights, 3/4" LR return (sources disagree). Bolt torque is a calculation from your procedure's target stress and nut factor, not a published torque table.

**Not included (enter dimensions manually):** brass pipe (ASTM B43), cast-iron soil pipe (CISPI 301 / ASTM A74 / A888), copper ACR tube (B280), PVC Sch 120. Automatic take-outs exist only for butt-weld steel/stainless/aluminum elbows. Dimension tables were transcribed from the standards listed; spot-check critical values against your current standard or mill certs.

## Compatibility with the reference calculator's guide

Every worked example in the user's guide is a test (key sequences in `tests/guide.test.ts`) and passes. Known numeric differences:

- **Steel weight:** 3" Sch 80 shows 10.26 lb/ft (ASME B36.10M tabulated value, 490 lb/ft³); the guide shows 10.2528. Filled weight differs by the same 0.01 lb/ft; the water portion matches exactly.
- **6" 5S stainless filled:** 21.716 lb/ft vs guide 21.714 (density 0.289 lb/in³).
- **47 cfs → gpm:** 21095.06 (exact factor 448.8312) vs guide 21095.07.
- **Head:** 1 psi = 2.30665 ft of water at 1000 kg/m³; guide's 115.3329 ft for 50 psi vs ours 115.3327.
- **Pressure loss above Re 100,000:** the guide does not publish its exact method. We use Kármán–Prandtl (smooth) or Colebrook–White (rough). Guide examples (Re 6,120 and 61,201) match to all displayed digits.
- Pressing Angle to solve shows the angle first, then slope, % grade and grade (guide shows slope first in the drop example).
- Display rounds to 7 significant digits like an 8-digit LCD; full precision is kept internally and shown in the decimal line.

## Not verified here

The build environment had no npm registry access, so the UI was bundled with esbuild against preinstalled React 19 and checked by rendering it in headless Chromium at iPhone sizes; `tsc` was run on the engine only (no React type packages offline). Run `npm install && npm run typecheck && npm test` once on your machine.
