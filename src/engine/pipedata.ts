// Pipe dimension datasets. Every dataset records its source and units.
// Dimensions are inches. Inside diameter = OD − 2 × wall (nominal/specified wall).
// Nominal pipe size (NPS) is a designation only — it is never used as an outside diameter.
import { CalcError, LB_PER_FT3_WATER } from './units';

export type Material = 'steel' | 'stainless' | 'copper' | 'plastic' | 'brass' | 'aluminum' | 'castiron';

export interface MaterialInfo {
  id: Material; label: string; short: string;
  densityLbIn3: number | null; densitySource: string;
  roughnessFt: number; // absolute roughness ε in feet (reference calculator appendix D values)
  datasets: string[]; coverage: string;
}

export interface Dataset {
  id: string; label: string; source: string; units: string; notes: string;
  types: string[]; rows: Array<{ nps: string; od: number; walls: Record<string, number> }>;
}

// NPS label -> numeric value (for sorting / fitting tables)
export const NPS_VALUE: Record<string, number> = {
  '1/8': 0.125, '1/4': 0.25, '3/8': 0.375, '1/2': 0.5, '5/8': 0.625, '3/4': 0.75, '1': 1, '1-1/4': 1.25, '1-1/2': 1.5,
  '2': 2, '2-1/2': 2.5, '3': 3, '3-1/2': 3.5, '4': 4, '5': 5, '6': 6, '8': 8, '10': 10, '12': 12,
  '14': 14, '16': 16, '18': 18, '20': 20, '24': 24,
};

// ---- ASME B36.10M (welded & seamless wrought steel pipe) ----
// OD and nominal wall thickness, inches.
const B3610: Dataset['rows'] = [
  { nps: '1/8', od: 0.405, walls: { Std: 0.068, '40': 0.068, XS: 0.095, '80': 0.095 } },
  { nps: '1/4', od: 0.540, walls: { Std: 0.088, '40': 0.088, XS: 0.119, '80': 0.119 } },
  { nps: '3/8', od: 0.675, walls: { Std: 0.091, '40': 0.091, XS: 0.126, '80': 0.126 } },
  { nps: '1/2', od: 0.840, walls: { Std: 0.109, '40': 0.109, XS: 0.147, '80': 0.147, '160': 0.188, XXS: 0.294 } },
  { nps: '3/4', od: 1.050, walls: { Std: 0.113, '40': 0.113, XS: 0.154, '80': 0.154, '160': 0.219, XXS: 0.308 } },
  { nps: '1', od: 1.315, walls: { Std: 0.133, '40': 0.133, XS: 0.179, '80': 0.179, '160': 0.250, XXS: 0.358 } },
  { nps: '1-1/4', od: 1.660, walls: { Std: 0.140, '40': 0.140, XS: 0.191, '80': 0.191, '160': 0.250, XXS: 0.382 } },
  { nps: '1-1/2', od: 1.900, walls: { Std: 0.145, '40': 0.145, XS: 0.200, '80': 0.200, '160': 0.281, XXS: 0.400 } },
  { nps: '2', od: 2.375, walls: { Std: 0.154, '40': 0.154, XS: 0.218, '80': 0.218, '160': 0.344, XXS: 0.436 } },
  { nps: '2-1/2', od: 2.875, walls: { Std: 0.203, '40': 0.203, XS: 0.276, '80': 0.276, '160': 0.375, XXS: 0.552 } },
  { nps: '3', od: 3.500, walls: { Std: 0.216, '40': 0.216, XS: 0.300, '80': 0.300, '160': 0.438, XXS: 0.600 } },
  { nps: '3-1/2', od: 4.000, walls: { Std: 0.226, '40': 0.226, XS: 0.318, '80': 0.318 } },
  { nps: '4', od: 4.500, walls: { Std: 0.237, '40': 0.237, XS: 0.337, '80': 0.337, '120': 0.438, '160': 0.531, XXS: 0.674 } },
  { nps: '5', od: 5.563, walls: { Std: 0.258, '40': 0.258, XS: 0.375, '80': 0.375, '120': 0.500, '160': 0.625, XXS: 0.750 } },
  { nps: '6', od: 6.625, walls: { Std: 0.280, '40': 0.280, XS: 0.432, '80': 0.432, '120': 0.562, '160': 0.719, XXS: 0.864 } },
  { nps: '8', od: 8.625, walls: { '20': 0.250, '30': 0.277, Std: 0.322, '40': 0.322, '60': 0.406, XS: 0.500, '80': 0.500, '100': 0.594, '120': 0.719, '140': 0.812, '160': 0.906, XXS: 0.875 } },
  { nps: '10', od: 10.750, walls: { '20': 0.250, '30': 0.307, Std: 0.365, '40': 0.365, XS: 0.500, '60': 0.500, '80': 0.594, '100': 0.719, '120': 0.844, '140': 1.000, '160': 1.125, XXS: 1.000 } },
  { nps: '12', od: 12.750, walls: { '20': 0.250, '30': 0.330, Std: 0.375, '40': 0.406, XS: 0.500, '60': 0.562, '80': 0.688, '100': 0.844, '120': 1.000, '140': 1.125, '160': 1.312, XXS: 1.000 } },
  { nps: '14', od: 14.000, walls: { '10': 0.250, '20': 0.312, '30': 0.375, Std: 0.375, '40': 0.438, XS: 0.500, '60': 0.594, '80': 0.750, '100': 0.938, '120': 1.094, '140': 1.250, '160': 1.406 } },
  { nps: '16', od: 16.000, walls: { '10': 0.250, '20': 0.312, '30': 0.375, Std: 0.375, '40': 0.500, XS: 0.500, '60': 0.656, '80': 0.844, '100': 1.031, '120': 1.219, '140': 1.438, '160': 1.594 } },
  { nps: '18', od: 18.000, walls: { '10': 0.250, '20': 0.312, Std: 0.375, '30': 0.438, XS: 0.500, '40': 0.562, '60': 0.750, '80': 0.938, '100': 1.156, '120': 1.375, '140': 1.562, '160': 1.781 } },
  { nps: '20', od: 20.000, walls: { '10': 0.250, '20': 0.375, Std: 0.375, '30': 0.500, XS: 0.500, '40': 0.594, '60': 0.812, '80': 1.031, '100': 1.281, '120': 1.500, '140': 1.750, '160': 1.969 } },
  { nps: '24', od: 24.000, walls: { '10': 0.250, '20': 0.375, Std: 0.375, XS: 0.500, '30': 0.562, '40': 0.688, '60': 0.969, '80': 1.219, '100': 1.531, '120': 1.812, '140': 2.062, '160': 2.344 } },
];

// ---- ASME B36.19M stainless (5S, 10S, 40S, 80S) ----
const B3619_S: Record<string, Record<string, number>> = {
  '1/8': { '10S': 0.049 }, '1/4': { '10S': 0.065 }, '3/8': { '10S': 0.065 },
  '1/2': { '5S': 0.065, '10S': 0.083 }, '3/4': { '5S': 0.065, '10S': 0.083 }, '1': { '5S': 0.065, '10S': 0.109 },
  '1-1/4': { '5S': 0.065, '10S': 0.109 }, '1-1/2': { '5S': 0.065, '10S': 0.109 }, '2': { '5S': 0.065, '10S': 0.109 },
  '2-1/2': { '5S': 0.083, '10S': 0.120 }, '3': { '5S': 0.083, '10S': 0.120 }, '3-1/2': { '5S': 0.083, '10S': 0.120 },
  '4': { '5S': 0.083, '10S': 0.120 }, '5': { '5S': 0.109, '10S': 0.134 }, '6': { '5S': 0.109, '10S': 0.134 },
  '8': { '5S': 0.109, '10S': 0.148 }, '10': { '5S': 0.134, '10S': 0.165 }, '12': { '5S': 0.156, '10S': 0.180 },
  '14': { '5S': 0.156, '10S': 0.188 }, '16': { '5S': 0.165, '10S': 0.188 }, '18': { '5S': 0.165, '10S': 0.188 },
  '20': { '5S': 0.188, '10S': 0.218 }, '24': { '5S': 0.218, '10S': 0.250 },
};
const STAINLESS: Dataset['rows'] = B3610.map((r) => {
  const w: Record<string, number> = { ...(B3619_S[r.nps] ?? {}) };
  if (NPS_VALUE[r.nps] <= 12) { w['40S'] = r.walls.Std; w['80S'] = r.walls.XS; }
  if (r.walls['160'] !== undefined) w['160'] = r.walls['160'];
  return { nps: r.nps, od: r.od, walls: w };
});

// ---- ASTM B88 seamless copper water tube (K, L, M); ASTM B306 DWV; ASTM B819 medical gas (same K/L dims) ----
const B88: Array<[string, number, number | null, number | null, number | null, number | null]> = [
  // nps, OD, K, L, M, DWV
  ['1/4', 0.375, 0.035, 0.030, null, null],
  ['3/8', 0.500, 0.049, 0.035, 0.025, null],
  ['1/2', 0.625, 0.049, 0.040, 0.028, null],
  ['5/8', 0.750, 0.049, 0.042, null, null],
  ['3/4', 0.875, 0.065, 0.045, 0.032, null],
  ['1', 1.125, 0.065, 0.050, 0.035, null],
  ['1-1/4', 1.375, 0.065, 0.055, 0.042, 0.040],
  ['1-1/2', 1.625, 0.072, 0.060, 0.049, 0.042],
  ['2', 2.125, 0.083, 0.070, 0.058, 0.042],
  ['2-1/2', 2.625, 0.095, 0.080, 0.065, null],
  ['3', 3.125, 0.109, 0.090, 0.072, 0.045],
  ['3-1/2', 3.625, 0.120, 0.100, 0.083, null],
  ['4', 4.125, 0.134, 0.110, 0.095, 0.058],
  ['5', 5.125, 0.160, 0.125, 0.109, 0.072],
  ['6', 6.125, 0.192, 0.140, 0.122, 0.083],
  ['8', 8.125, 0.271, 0.200, 0.170, 0.109],
  ['10', 10.125, 0.338, 0.250, 0.212, null],
  ['12', 12.125, 0.405, 0.280, 0.254, null],
];
const COPPER: Dataset['rows'] = B88.map(([nps, od, k, l, m, dwv]) => {
  const w: Record<string, number> = {};
  if (k !== null) { w.K = k; w['Med K'] = k; }
  if (l !== null) { w.L = l; w['Med L'] = l; }
  if (m !== null) w.M = m;
  if (dwv !== null) w.DWV = dwv;
  return { nps, od, walls: w };
});

// ---- ASTM D1785 PVC Sch 40/80 (IPS OD, minimum wall); ASTM D2241 SDR (wall = OD / SDR, min 0.060") ----
const D1785_80_OVERRIDE: Record<string, number> = { '12': 0.687 };
const PVC: Dataset['rows'] = B3610.filter((r) => NPS_VALUE[r.nps] >= 0.5 && NPS_VALUE[r.nps] <= 12 && r.nps !== '3-1/2' && r.nps !== '5')
  .map((r) => {
    const w: Record<string, number> = { '40': r.walls['40'], '80': D1785_80_OVERRIDE[r.nps] ?? r.walls['80'] };
    const n = NPS_VALUE[r.nps];
    const sdr = (dr: number, min: number) => { if (n >= min) w[`SDR ${dr}`] = Math.max(0.060, r.od / dr); };
    sdr(21, 0.75); sdr(26, 1); sdr(32.5, 1.25); sdr(41, 2);
    return { nps: r.nps, od: r.od, walls: w };
  });

// ---- Aluminum: ANSI H35.2 pipe uses ASME B36.10M OD and wall for Sch 40 / 80 ----
const ALUMINUM: Dataset['rows'] = B3610.filter((r) => NPS_VALUE[r.nps] <= 12)
  .map((r) => ({ nps: r.nps, od: r.od, walls: { '40': r.walls['40'], '80': r.walls['80'] } }));

export const DATASETS: Record<string, Dataset> = {
  steel: {
    id: 'steel', label: 'Carbon steel — ASME B36.10M', units: 'inches (OD, nominal wall)',
    source: 'ASME B36.10M, Welded and Seamless Wrought Steel Pipe — dimension table (OD, nominal wall by schedule/weight class).',
    notes: 'NPS 1/8 – 24. Sch 10 listed for NPS 14–24 only; smaller thin-wall sizes are in the stainless table (B36.19M).',
    types: ['Std', '40', 'XS', '80', '10', '20', '30', '60', '100', '120', '140', '160', 'XXS'], rows: B3610,
  },
  stainless: {
    id: 'stainless', label: 'Stainless — ASME B36.19M (+ Sch 160 per B36.10M)', units: 'inches',
    source: 'ASME B36.19M, Stainless Steel Pipe (5S, 10S, 40S, 80S); Sch 160 walls from ASME B36.10M.',
    notes: '40S/80S listed through NPS 12. OD identical to B36.10M.',
    types: ['5S', '10S', '40S', '80S', '160'], rows: STAINLESS,
  },
  copper: {
    id: 'copper', label: 'Copper tube — ASTM B88 / B306 / B819', units: 'inches (actual OD, nominal wall)',
    source: 'ASTM B88 (Types K, L, M seamless copper water tube); ASTM B306 (DWV); ASTM B819 (medical gas, same dimensions as K and L).',
    notes: 'Copper OD = nominal size + 1/8". ACR tube (ASTM B280) is sized by actual OD and is not included — use manual dimensions.',
    types: ['K', 'L', 'M', 'DWV', 'Med K', 'Med L'], rows: COPPER,
  },
  plastic: {
    id: 'plastic', label: 'PVC — ASTM D1785 / D2241', units: 'inches (average OD, minimum wall)',
    source: 'ASTM D1785 (PVC Sch 40/80, IPS OD, minimum wall). ASTM D2241 SDR pipe: minimum wall = OD ÷ SDR (not less than 0.060").',
    notes: 'NPS 1/2 – 12. SDR walls are computed from the standard\'s DR definition; confirm the size is manufactured in that SDR. Sch 120 is not included.',
    types: ['40', '80', 'SDR 21', 'SDR 26', 'SDR 32.5', 'SDR 41'], rows: PVC,
  },
  aluminum: {
    id: 'aluminum', label: 'Aluminum pipe — ANSI H35.2 (B36.10M dims)', units: 'inches',
    source: 'ANSI H35.2 aluminum pipe dimensions, which follow ASME B36.10M OD and wall for Sch 40 and 80.',
    notes: 'NPS 1/8 – 12, Sch 40 and 80 only.', types: ['40', '80'], rows: ALUMINUM,
  },
};

const R6 = 1e-6;
export const MATERIALS: Record<Material, MaterialInfo> = {
  steel: { id: 'steel', label: 'Steel', short: 'STEEL', densityLbIn3: 490 / 1728, densitySource: '490 lb/ft³ (basis of ASME B36.10M plain-end weights)', roughnessFt: 221 * R6, datasets: ['steel'], coverage: 'ASME B36.10M, NPS 1/8–24.' },
  stainless: { id: 'stainless', label: 'Stainless steel', short: 'S.STEEL', densityLbIn3: 0.289, densitySource: '0.289 lb/in³ (austenitic 304/316, ≈8.0 g/cm³)', roughnessFt: 49.2 * R6, datasets: ['stainless'], coverage: 'ASME B36.19M 5S/10S/40S/80S + Sch 160.' },
  copper: { id: 'copper', label: 'Copper', short: 'COPPER', densityLbIn3: 0.323, densitySource: '0.323 lb/in³ (≈8.94 g/cm³)', roughnessFt: 4.9 * R6, datasets: ['copper'], coverage: 'ASTM B88 K/L/M, B306 DWV, B819 medical. ACR not included.' },
  plastic: { id: 'plastic', label: 'PVC / plastic', short: 'PLASTIC', densityLbIn3: 1.40 * 0.0361273, densitySource: '1.40 g/cm³ (typical rigid PVC)', roughnessFt: 15.6 * R6, datasets: ['plastic'], coverage: 'ASTM D1785 Sch 40/80, D2241 SDR 21/26/32.5/41 (computed). Sch 120 not included.' },
  aluminum: { id: 'aluminum', label: 'Aluminum', short: 'AL.', densityLbIn3: 0.0975, densitySource: '0.0975 lb/in³ (6061 alloy)', roughnessFt: 4.9 * R6, datasets: ['aluminum'], coverage: 'ANSI H35.2 Sch 40/80, NPS 1/8–12.' },
  brass: { id: 'brass', label: 'Brass', short: 'BRASS', densityLbIn3: null, densitySource: 'not included', roughnessFt: 4.9 * R6, datasets: [], coverage: 'No traceable brass pipe table (ASTM B43) is bundled. Enter OD and wall manually.' },
  castiron: { id: 'castiron', label: 'Cast iron', short: 'CAST', densityLbIn3: null, densitySource: 'not included', roughnessFt: 850 * R6, datasets: [], coverage: 'No traceable cast-iron table (CISPI 301 / ASTM A74 / A888) is bundled. Enter OD and wall manually.' },
};
export const MATERIAL_ORDER: Material[] = ['steel', 'stainless', 'brass', 'aluminum', 'castiron', 'plastic', 'copper'];

export function typesFor(m: Material): string[] { const d = MATERIALS[m].datasets[0]; return d ? DATASETS[d].types : []; }
export function sizesFor(m: Material, type: string): string[] {
  const d = MATERIALS[m].datasets[0];
  if (!d) return [];
  return DATASETS[d].rows.filter((r) => r.walls[type] !== undefined).map((r) => r.nps);
}
export function defaultType(m: Material): string { return typesFor(m)[0] ?? ''; }

export interface PipeProps {
  material: Material; type: string; nps: string | null; manual: boolean;
  od: number; id: number; wall: number; area: number; // in, in, in, in²
  metalArea: number; weightPerFt: number | null; filledPerFt: number | null;
  galPerFt: number; source: string; fluidPcf: number;
}

export function pipeProps(material: Material, type: string, nps: string, fluidPcf = LB_PER_FT3_WATER): PipeProps {
  const dsId = MATERIALS[material].datasets[0];
  if (!dsId) throw new CalcError('DATA', `${MATERIALS[material].label}: ${MATERIALS[material].coverage}`);
  const ds = DATASETS[dsId];
  const row = ds.rows.find((r) => r.nps === nps);
  if (!row) throw new CalcError('DATA', `NPS ${nps} is not in the ${ds.label} table. Covered sizes: ${ds.rows.map((r) => r.nps).join(', ')}.`);
  const wall = row.walls[type];
  if (wall === undefined) throw new CalcError('DATA', `${MATERIALS[material].label} NPS ${nps} is not listed in type ${type}. Available: ${Object.keys(row.walls).join(', ')}.`);
  return build(material, type, nps, row.od, wall, false, ds.source, fluidPcf);
}

export function manualPipe(material: Material, od: number, wall: number, fluidPcf = LB_PER_FT3_WATER, densityLbIn3?: number): PipeProps {
  if (!(od > 0) || !(wall > 0) || 2 * wall >= od) throw new CalcError('INPUT', 'Manual pipe needs OD > 0 and 0 < wall < OD/2.');
  const p = build(material, 'manual', null, od, wall, true, 'User-entered dimensions', fluidPcf);
  if (densityLbIn3 && densityLbIn3 > 0) {
    p.weightPerFt = p.metalArea * 12 * densityLbIn3; p.filledPerFt = p.weightPerFt + p.area * 12 * fluidPcf / 1728;
  }
  return p;
}

function build(material: Material, type: string, nps: string | null, od: number, wall: number, manual: boolean, source: string, fluidPcf: number): PipeProps {
  const id = od - 2 * wall;
  const area = (Math.PI / 4) * id * id;
  const metalArea = (Math.PI / 4) * (od * od - id * id);
  const dens = MATERIALS[material].densityLbIn3;
  const weightPerFt = dens === null ? null : metalArea * 12 * dens;
  const fluidPerFt = (area * 12 * fluidPcf) / 1728;
  return {
    material, type, nps, manual, od, id, wall, area, metalArea, weightPerFt,
    filledPerFt: weightPerFt === null ? null : weightPerFt + fluidPerFt, galPerFt: (area * 12) / 231, source, fluidPcf,
  };
}

/** Parse "1-1/2", "1 1/2", "1.5", "6" into an NPS label from the table. */
export function npsLabel(v: number): string | null {
  for (const [k, x] of Object.entries(NPS_VALUE)) if (Math.abs(x - v) < 1e-6) return k;
  return null;
}
