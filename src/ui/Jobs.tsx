import React, { useState } from 'react';

/** Two-tap confirmation (browser confirm() dialogs are not available everywhere). */
function ConfirmButton({ label, confirmLabel, onConfirm, className = 'btn danger' }: { label: string; confirmLabel: string; onConfirm: () => void; className?: string }) {
  const [armed, setArmed] = useState(false);
  return armed
    ? <div className="actions"><button className={className} onClick={() => { setArmed(false); onConfirm(); }}>{confirmLabel}</button><button className="btn" onClick={() => setArmed(false)}>Cancel</button></div>
    : <button className={className} onClick={() => setArmed(true)}>{label}</button>;
}
import { Segmented, Select, useApp, Card, Msg } from './components';
import { SavedItem, Job, uid, shareText, storageAvailable, Settings, OutUnit } from './store';
import { CONV_MAP } from '../engine/calculator';
import { KEYPAD } from './Calculator';
import { FracDen } from '../engine/format';

export function JobsView(props: {
  items: SavedItem[]; setItems: (f: (p: SavedItem[]) => SavedItem[]) => void;
  jobs: Job[]; setJobs: (f: (p: Job[]) => Job[]) => void;
  open: (it: SavedItem) => void; section: string; setSection: (s: string) => void;
}) {
  return (
    <div className="tool">
      <Segmented value={props.section} onChange={props.setSection} options={[['history', 'History'], ['jobs', 'Jobs'], ['settings', 'Settings'], ['help', 'Help']]} />
      {props.section === 'history' && <History {...props} />}
      {props.section === 'jobs' && <Jobs {...props} />}
      {props.section === 'settings' && <SettingsView />}
      {props.section === 'help' && <Help />}
    </div>
  );
}

function ItemCard({ it, jobs, setItems, open }: { it: SavedItem; jobs: Job[]; setItems: (f: (p: SavedItem[]) => SavedItem[]) => void; open: (it: SavedItem) => void }) {
  const { toast } = useApp();
  const upd = (patch: Partial<SavedItem>) => setItems((p) => p.map((x) => (x.id === it.id ? { ...x, ...patch } : x)));
  return (
    <div className="item">
      <div className="ihead">
        <button className={'star' + (it.fav ? ' on' : '')} aria-label={it.fav ? 'Unfavorite' : 'Favorite'} onClick={() => upd({ fav: !it.fav })}>★</button>
        <b>{it.title}</b>
        <span className="muted">{new Date(it.ts).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
      </div>
      <pre className="isum">{it.summary}</pre>
      <div className="iact">
        {it.kind === 'guided' && <button className="chip" onClick={() => open(it)}>Open</button>}
        <button className="chip" onClick={async () => { const m = await shareText(it.summary); if (m) toast(m); }}>Share</button>
        <select className="chip" value={it.jobId ?? ''} onChange={(e) => upd({ jobId: e.target.value || undefined })} aria-label="Assign to job">
          <option value="">No job</option>
          {jobs.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
        </select>
        <button className="chip danger" onClick={() => setItems((p) => p.filter((x) => x.id !== it.id))}>Delete</button>
      </div>
    </div>
  );
}

function History({ items, setItems, jobs, open }: Parameters<typeof JobsView>[0]) {
  const [filter, setFilter] = useState<'all' | 'fav'>('all');
  const list = items.filter((i) => filter === 'all' || i.fav);
  return (
    <>
      <div className="row-between">
        <Segmented small value={filter} onChange={setFilter} options={[['all', `All (${items.length})`], ['fav', `★ Favorites (${items.filter((i) => i.fav).length})`]]} />
      </div>
      {list.length === 0 && <p className="muted center">Nothing here yet. Calculations made with = are recorded automatically; use Save in guided tools.</p>}
      {list.map((it) => <ItemCard key={it.id} it={it} jobs={jobs} setItems={setItems} open={open} />)}
      {items.some((i) => !i.fav && !i.jobId) && <ConfirmButton className="btn" label="Clear unstarred history" confirmLabel="Delete unstarred items" onConfirm={() => setItems((p) => p.filter((i) => i.fav || i.jobId))} />}
    </>
  );
}

function Jobs({ items, setItems, jobs, setJobs, open }: Parameters<typeof JobsView>[0]) {
  const { toast } = useApp();
  const [name, setName] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const job = jobs.find((j) => j.id === sel);
  if (job) {
    const its = items.filter((i) => i.jobId === job.id);
    return (
      <>
        <button className="btn ghost" onClick={() => setSel(null)}>‹ All jobs</button>
        <Card>
          <label className="field"><span className="flabel">Job name</span><input value={job.name} onChange={(e) => setJobs((p) => p.map((j) => (j.id === job.id ? { ...j, name: e.target.value } : j)))} /></label>
          <div className="actions">
            <button className="btn" onClick={async () => { const m = await shareText(`${job.name}\n\n` + its.map((i) => `${i.title}\n${i.summary}`).join('\n\n')); if (m) toast(m); }}>Share job</button>
            <ConfirmButton label="Delete job" confirmLabel="Delete job (items stay)" onConfirm={() => { setItems((p) => p.map((i) => (i.jobId === job.id ? { ...i, jobId: undefined } : i))); setJobs((p) => p.filter((j) => j.id !== job.id)); setSel(null); }} />
          </div>
        </Card>
        {its.length === 0 && <p className="muted center">No items. Assign history items to this job from the History list.</p>}
        {its.map((it) => <ItemCard key={it.id} it={it} jobs={jobs} setItems={setItems} open={open} />)}
      </>
    );
  }
  return (
    <>
      <Card>
        <label className="field"><span className="flabel">New job</span>
          <span className="finput"><input value={name} placeholder="e.g. Boiler room — line 12" onChange={(e) => setName(e.target.value)} /></span>
        </label>
        <button className="btn" disabled={!name.trim()} onClick={() => { setJobs((p) => [{ id: uid(), name: name.trim(), ts: Date.now() }, ...p]); setName(''); }}>Create job</button>
      </Card>
      {jobs.length === 0 && <p className="muted center">Create a named job, then assign saved calculations to it.</p>}
      {jobs.map((j) => (
        <button key={j.id} className="jobrow" onClick={() => setSel(j.id)}>
          <b>{j.name}</b><span className="muted">{items.filter((i) => i.jobId === j.id).length} items ›</span>
        </button>
      ))}
    </>
  );
}

function SettingsView() {
  const { settings, setSettings } = useApp();
  const S = <K extends keyof Settings>(k: K, v: Settings[K]) => setSettings((s) => ({ ...s, [k]: v }));
  const P = <K extends keyof Settings['prefs']>(k: K, v: Settings['prefs'][K]) => setSettings((s) => ({ ...s, prefs: { ...s.prefs, [k]: v } }));
  return (
    <>
      <Card>
        <h4>Display</h4>
        <Segmented small value={settings.theme} onChange={(v) => S('theme', v)} options={[['dark', 'Dark'], ['light', 'Light'], ['system', 'Auto']]} />
        <Select label="Fractional resolution" value={String(settings.prefs.fracDen)} options={[['2', '1/2"'], ['4', '1/4"'], ['8', '1/8"'], ['16', '1/16" (default)'], ['32', '1/32"'], ['64', '1/64"']]} onChange={(v) => P('fracDen', Number(v) as FracDen)} />
        <Select label="Fraction display" value={settings.prefs.fracMode} options={[['std', 'Standard — reduced (8/16 → 1/2)'], ['const', 'Constant — always in set resolution']]} onChange={(v) => P('fracMode', v as 'std' | 'const')} />
        <Select label="Guided-mode length results" value={settings.outUnit} options={[['infrac', 'Inches & fractions'], ['ftin', 'Feet-inch-fraction'], ['indec', 'Decimal inches'], ['ftdec', 'Decimal feet'], ['mm', 'Millimeters'], ['m', 'Meters']]} onChange={(v) => S('outUnit', v as OutUnit)} />
        <Select label="Area answers" value={settings.prefs.areaPref} options={[['std', 'Standard (by input units)'], ['sqft', 'Always sq ft'], ['sqin', 'Always sq in'], ['sqm', 'Always sq m']]} onChange={(v) => P('areaPref', v as Settings['prefs']['areaPref'])} />
        <Select label="Volume answers" value={settings.prefs.volPref} options={[['std', 'Standard (by input units)'], ['cuft', 'Always cu ft'], ['cum', 'Always cu m']]} onChange={(v) => P('volPref', v as Settings['prefs']['volPref'])} />
        <Select label="Meters" value={settings.prefs.meterDecimals} options={[['fixed3', '0.000 m'], ['float', 'Floating']]} onChange={(v) => P('meterDecimals', v as 'fixed3' | 'float')} />
        <Select label="Calculator degrees" value={settings.prefs.degDecimals} options={[['fixed2', '0.00°'], ['float', 'Floating']]} onChange={(v) => P('degDecimals', v as 'fixed2' | 'float')} />
      </Card>
      <Card>
        <h4>Math</h4>
        <Segmented small value={settings.chain ? 'chain' : 'order'} onChange={(v) => S('chain', v === 'chain')} options={[['order', 'Order of operations (10+4×5=30)'], ['chain', 'Chain (10+4×5=70)']]} />
        <p className="fhint">Trigonometry is in degrees.</p>
        <label className="toggle sm"><input type="checkbox" checked={settings.haptics} onChange={(e) => S('haptics', e.target.checked)} /> Key vibration (where the browser supports it)</label>
      </Card>
      <Card>
        <h4>Storage</h4>
        <p className="fhint">{storageAvailable() ? 'Settings, history, jobs and calculator memory are saved on this device only.' : 'Local storage is unavailable here (private mode or preview) — nothing will be kept after closing.'}</p>
        <ConfirmButton label="Erase all local data" confirmLabel="Erase everything" onConfirm={() => { try { Object.keys(localStorage).filter((k) => k.startsWith('ridgecrest.')).forEach((k) => localStorage.removeItem(k)); } catch { /* */ } location.reload(); }} />
      </Card>
    </>
  );
}

function Help() {
  const convRows = KEYPAD.flat().filter((k) => CONV_MAP[k.k]);
  return (
    <div className="help">
      <Card>
        <h4>Calculator mode</h4>
        <ul>
          <li><b>Enter vs. solve.</b> Type a value, then press a project key (Offset, Run, Travel, Angle/Slope…) to <i>store</i> it — the display shows <i className="tag tag-entered">stored</i>. Press a project key with nothing typed to <i>solve</i> it — <i className="tag tag-solved">solved</i>. Press it again to step through related results (Travel → cut, take-out, gap, fitting angle, arcs, run, offset).</li>
          <li>A result from = or a function counts as a new value, so “12 + 3 Offset” stores 15.</li>
          <li>Only two of Offset / Run / Travel / Angle are independent. A third entry replaces the oldest; the display says which.</li>
          <li><b>Dimensions:</b> 5 Feet 7 Inch 3 ⁄ 8 → 5′ 7-3/8″. A fraction without a denominator uses the resolution (3 ⁄ Inch = 3/16″). Feet Feet = sq ft, Feet Feet Feet = cu ft. With a result showing, Feet / Inch / mm / m convert it; pressing again toggles fraction ↔ decimal.</li>
          <li>Angle/Slope accepts degrees (45), slope per foot (1⁄8 Inch) or percent grade (2 Conv x² %).</li>
          <li>Pipe Matl cycles material; Conv+Matl cycles schedule (or type 80 Conv Matl). Size: 6 Inch Pipe Size, then Pipe Size again for OD, ID, wall, weights, area.</li>
          <li>Stor 1–9 / Rcl 1–9 memory registers; M+ / Conv M+ (M−) accumulate; Rcl M+ shows total, then average and count. C clears; C twice clears project values; AC restores defaults.</li>
        </ul>
      </Card>
      <Card>
        <h4>Conv (second functions)</h4>
        <div className="convgrid">{convRows.map((k) => <div key={k.k}><span>{k.aria}</span><b>{CONV_MAP[k.k]!.label}</b></div>)}</div>
      </Card>
      <Card>
        <h4>ISO sketch</h4>
        <ul>
          <li><b>Draw:</b> in Draw mode press on a point and drag — the line stays on the iso paper (30°, 150° or vertical), snaps to whole squares and is placed when you let go (drag from empty space to continue from the dashed-circle point). Start a drag on or near a line end or a tee to run a new line off it (lines can't start from a turn — an elbow or offset bend); start on the middle of a line to branch off right there (the line splits into a tee at the nearest grid square). Or type a length (optional) and tap a direction button.</li>
          <li><b>Offset</b> (the tab on the left of the drawing, under the new-start pin) builds an angled run from the current point: pick the heading, the fitting angle (11¼, 22½, 30, 45, 60 or any), which way it offsets and, for a rolling offset, which way it rolls. Enter the amounts to get the travel and setback, or leave them empty to sketch it and dimension it later.</li>
          <li><b>Two fingers</b> (any mode): pinch to zoom, slide to move. To turn the drawing use the <b>spin arrows</b> under the compass (↺ ↻, one compass direction each tap) or tap the compass. Valve handles keep pointing the same real-world way (up off level pipe) whichever way you turn it.</li>
          <li><b>New start point</b> (pin-with-plus button on the drawing, under Home): tap it, then tap the paper where a separate line should start (or tap an existing point to draw from there). A faint dotted link marks it; no pipe is drawn or cut for it.</li>
          <li><b>Connect with</b> (top of the fittings palette): pick butt weld, socket weld, threaded, soldered, glued or flanged before you place a valve or fitting. Joints are marked ● butt weld, ●⊏ socket weld, | threaded, ○ soldered, ■ glued, ‖ flanged. Change a fitting's joint by tapping its line or point; set the drawing's default joint for elbows and tees in Setup. Only butt welds get a root gap and B16.9 take-outs in the cut list; other joints are noted for you.</li>
          <li><b>Fittings &amp; valves:</b> drag one from the palette onto a line (valves, flanges, reducers, strainers, unions…) or a point (elbow types and angle valves at turns, olets, laterals and 3-way valves at tees, caps, flanges, relief/vent/drain valves and instruments at ends) — or tap it, then tap the spot. Branch fittings (tee, olets, lateral…) dropped on a line split it there and add a short branch to drag out or dimension. <b>Tap a fitting on a line</b> for its menu — Move (then tap a line), Change (pick another fitting), Joint, Length, Delete — or drag it along its line to slide it. <b>A valve or fitting dropped on a line breaks it there</b>, just like a tee: you get two lines, each measured to the fitting's face (flanged) or end. <b>Tap any measurement</b> on the drawing to type a new length — the fitting (and everything after it) moves to suit. <b>Tap a valve, tee, elbow or end fitting</b> for its menu: Joint (connection type), Move (then tap the line — or line end — it should go to), Change, Length or Size where they apply, and Delete (a valve's line joins back up; a tee's branch is removed). <b>Flanges:</b> pick <b>Weld neck</b> or <b>Socket weld</b> under Flanges in the palette (Line or Ends group, or when Connect with is Flanged) before you drop a flange pair, flange, blind or flanged valve; tap a placed flange and use its WN / SW flange button to change it. Weld neck: butt weld with root gap, take-off to the hub end. Socket weld: the pipe stops 1/16" short of the socket bottom (B16.5 hub Y − socket depth + 1/16"), no root gap, socket welds on the weld map, and SW flanges on the material list. B16.5 only makes socket-weld flanges up to 3" (2-1/2" in Class 900–1500), so larger sizes fall back to weld neck and say so. A <b>reducer</b> can go in a line or on the end of a line (Ends → Reducer); set its Size and every line after it changes to that size — fittings and take-offs follow. A reducing tee's or olet's branch size does the same for the branch. In the cut list each side is cut: each pipe piece is cut between fitting faces, less the fitting's length (ASME B16.10 face-to-face for flanged gate/globe/check/ball valves at the flange class in Setup, 2 × WN flange + gasket for a flange pair, or your manufacturer's length under Length) and adjusted for its joint (root gap, WN flange + gasket, thread makeup or socket engagement). End fittings deduct their take-off too (cap E, WN flange, blind) — tap the end point to enter your own. Tap a point to change the fitting there. A reducing tee is drawn with a reducer on its branch; tap its point to add the branch size if you want (optional).</li>
          <li><b>Edit:</b> tap a point to draw or branch from it (a branch makes a tee). Tap any line to dimension it, change its direction, add a valve or flange, or delete it. Lines with a yellow ? still need a dimension.</li>
          <li><b>Offsets</b> are shown with their legs dashed and the offset triangle hatched. Enter each leg, or the travel and all but one leg.</li>
          <li><b>To scale</b> redraws the sketch using your dimensions. <b>Rotate 3D</b>: drag to turn the drawing; View buttons jump to ISO, plan or elevations; the Home button under the compass resets to the standard ISO view. Tap or drag the compass to turn North in 90° steps.</li>
          <li><b>Every length says what it measures to</b>: C = fitting center (elbows, tees, olets), F = face (flanged valves and fittings, flange and blind ends, nozzles), E = end (pipe ends and straight joints, caps, plugs, threaded / welded / socket / soldered / glued fittings). E.g. 10' 0" C-C, 4' 7-1/2" E-F.</li>
          <li><b>Back</b> (lower-left corner of the drawing) steps back through your last 100 changes — lines, dimensions, fittings and deletes. After you go back, <b>Forward</b> appears to put them back; making a new change clears Forward.</li>
          <li><b>Full screen</b> (corner button) opens the drawing landscape with the tools at the side; Hide tools leaves just the drawing.</li>
          <li>The Cut list subtracts B16.9 long-radius elbow and tee take-outs for the size in Setup plus a root gap at every butt weld. Drawings are saved on this device (Library); Setup → Share drawing as image makes a PNG of the current view.</li>
          <li><b>Text boxes:</b> tap <b>Text</b> on the left of the drawing, pick a border (none, box, rounded or cloud), size (A− / A+) and colour, then tap where it goes and type. Tap a text box any time for its menu: change its words, border, size or colour, add arrows, Move it (then tap the new spot) or delete it. (⋮ → Edit / move notes also lets you drag them.) The last style you used is kept for the next one. <b>Arrows:</b> in a text box's menu pick the arrow style — single or double head (or none), solid or dashed, straight or curved — tap + Add arrow, then tap where it should point; add as many as you need. Each arrow can be restyled, have its tip moved, or be removed.</li>
          <li><b>On a computer:</b> the mouse wheel over the drawing zooms; hold the wheel button down and drag to move the view in any mode (Draw, Move or 3D); the side panel scrolls on its own.</li>
          <li><b>Several lines on one drawing</b> (piping overview): tap the new-start pin, then drag on the paper — a new, separate line starts where you press (nothing links it to the other lines) (or tap to set the start, then drag from it). <b>Tie a line back in</b> by ending your drag on any point or line of the drawing: it snaps there and joins (a line end becomes an elbow, the middle of a line becomes a tee). <b>Dragging fittings:</b> drop them near where they go — a valve or line fitting snaps to the nearest line, an elbow to the nearest turn, an end fitting to the nearest line end; a dashed ring shows where it will land. Messages stay up 5 seconds (tap one to close it).</li>
          <li><b>Pipe letters</b> (on by default): while you draw, every pipe piece is lettered A, B, C … following the pipe the way it was drawn — a fitting added later keeps the letters in order — matching the Cut list tab and the completed sheet. Fittings and valves get their material-list numbers on the completed sheet. A fitting with no standard length (flow meter, strainer …) doesn't hold up the cut: lines dimensioned to its face are cut from that face. A flange pair, union or coupling on a line shows its joint to the pipe on both sides (butt weld dots for weld-neck flanges).</li>
          <li><b>Setup → pipe sizes:</b> every pipe size on the drawing gets its own card — schedule, joint, flange class, gasket and weld gap. A size after a reducer (or a reducing tee / olet branch) starts with the main size's settings; change any of them and the cut list, weld map and material list for that size follow. "Same as main" puts it back. The schedule shows in the cut list and material list, with the OD / wall / ID where the pipe tables have it.</li>
          <li><b>Offset angle</b>: tap the angle shown at an offset's elbow (dashed outline) to change it — pick 11¼, 22½, 30, 45 or 60° or type any angle. The offset (set) stays the same; the run and travel are worked out again and the lines after it move with it.</li>
          <li><b>Weld map</b> (toggle after To scale) numbers every weld — W1, W2 … and FW for field welds. Tap a weld number to enter the welder stencil, pick Shop or Field and add notes. Flanged joints count a weld for the weld-neck flange. Tags are placed clear of pipes, dimensions and each other; stencils and notes stay in the weld log so the drawing stays readable.</li>
          <li><b>⋮ menu</b> (top right): My Drawings, New Drawing, Name Drawing (name plus customer, job site address, job number and system — shown in the sheet's title block), Add text box (same as the Text button on the drawing) and Edit / move notes (drag a note to move it, tap it to change or delete it).</li>
          <li><b>✓ Complete</b> saves the drawing, asks you to confirm its name and locks it as an 11×17 iso sheet: the drawing on iso paper with item numbers in circles (the same fitting or valve always gets the same number, matching the # in the material list) and pipe pieces lettered A, B, C … in boxes (matching the cut list), a material breakdown (pipe by size, fittings, valves, flanges, gaskets, bolt sets, shop / field welds), the cut list, the weld log and a title block. Pinch to zoom and drag to scan it (double-tap zooms in or back out), view it full screen (landscape), <b>🖨 Print…</b> lets you pick the paper size (11×17, Letter, Legal, ARCH B/C/D, ANSI C, A4, A3 — landscape, scaled to fit) and opens your printer dialog; <b>💾 Save…</b> saves it as a PDF at the paper size you pick or as a JPEG image (3400 × 2200). On iPhone / iPad Save opens the share sheet — Save to Files, Save Image, AirDrop…; on a computer it downloads. Use the website or home-screen app for printing and saving; the Claude preview page blocks them. Switch Weld map off on the sheet for a clean drawing without weld numbers or the weld log. ✎ Edit reopens it.</li>
        </ul>
      </Card>
      <Card>
        <h4>Shop layout (Layout tab)</h4>
        <ul>
          <li><b>Miter:</b> n welds give n−1 full gores and two half-gore ends; each cut is tilted B/(2n) from square. Wrap the template ordinates around the pipe from the heel.</li>
          <li><b>Cope:</b> ordinates are cut-backs from the square end of the branch, starting at the heel (φ = 0, in line with the header axis).</li>
          <li><b>Take-out, Cut length, Trim</b> (moved here from the old Fittings tab): elbow take-outs (B16.9 or your own radius & OD), cut length between fittings, and trimming an elbow to an odd angle.</li>
          <li><b>Fit-Fit</b> (last section): an offset made with two elbows cut to the same angle — fitting to fitting, or with a pipe piece between them (know the pipe length → get the angle, or pick the angle → get the pipe). Plain or rolling offset (side and rise, with the clock position to roll elbow 1). Gives the cut angle, pipe piece, travel, C-C run, offset take off, center to face, heel / sides / throat cut marks, a to-scale drawing that checks itself, and a table of other ways to make the same offset (tap a row to use it). O = 2R(1 − cos θ) + L·sin θ.</li>
          <li><b>Rolled 90:</b> a full 90 rolled down θ, welded direct to an elbow cut down to θ that brings the outlet back level. Find angle solves D = [A + B·tan(θ/2) + g]·sin θ for θ; Find drop works it forward. Gives the travel, take-offs, horizontal projection and the throat / centerline / heel arc marks for cutting the elbow, with a lookup table for 1°–90°. Long / short radius from ASME B16.9.</li>
          <li><b>Expansion</b> (Conversion tab)<b>:</b> ΔL = α · L · ΔT with mean coefficients; check your design code for allowable movement.</li>
        </ul>
      </Card>
      <Card>
        <h4>Conventions</h4>
        <ul>
          <li>All layout dimensions are centerline. O = offset perpendicular to the run, A = run along it, L = center-to-center travel, θ = bend angle at each fitting.</li>
          <li>Rolling offset: H horizontal transverse, V vertical (+ up), φ = atan2(V, H) from +H toward +V looking downstream. φ is the offset-plane rotation, not an elbow’s clocking.</li>
          <li>Take-outs: ASME B16.9 center-to-end for factory 90° and LR 45°; ideal R·tan(θ/2) for field-cut / odd angles. Cut = L − both take-outs − both gaps.</li>
          <li>Full precision is kept internally; rounding to the selected fraction happens only on screen.</li>
        </ul>
      </Card>
      <Card>
        <h4>Not included / limits</h4>
        <ul>
          <li>No bundled dimension tables for brass pipe, cast-iron soil pipe, copper ACR tube or PVC Sch 120 — use manual OD and wall.</li>
          <li>Automatic take-outs exist only for butt-weld steel / stainless / aluminum elbows (B16.9). Other fittings need a known take-out (the Specs tab lists socket-weld and threaded take-outs).</li>
          <li>Specs tab: not included are ring numbers outside Classes 300–600, B16.47 and orifice flanges, flat gaskets, line blanks, weights, reducing-tee outlets and sockolet/threadolet heights. Each table names its source.</li>
          <li>Pressure loss: water only, straight pipe, no fittings or valves.</li>
          <li>Fit-Fit models ideal elbows (tangent lengths); verify cut fittings against the actual part.</li>
        </ul>
      </Card>
      <Card>
        <h4>Install on iPhone</h4>
        <p>Open the app URL in Safari → Share → Add to Home Screen. After the first load it works offline. Data stays on the phone.</p>
        <Msg kind="info">In the Claude preview, offline install and service workers are not available and saved data may not persist. Use the standalone build for field use.</Msg>
      </Card>
      <p className="muted center">PipeWorks Pro · independent software. Function set modeled on a commonly used pipe-trades calculator; not affiliated with or endorsed by its manufacturer.</p>
    </div>
  );
}
