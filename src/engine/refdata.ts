// Reference data library: flanges, bolting, gaskets, fittings, valves, branch outlets, supports.
// Every table records its source. Values are inches unless noted. A missing value means the source
// did not provide it — nothing is estimated. Metric source tables are converted with 1 in = 25.4 mm.
import { CalcError } from './units';

export const SIZES = ['1/2', '3/4', '1', '1-1/4', '1-1/2', '2', '2-1/2', '3', '3-1/2', '4', '5', '6', '8', '10', '12', '14', '16', '18', '20', '24'] as const;
export type Nps = (typeof SIZES)[number];
const SIZES19: readonly string[] = SIZES.filter((s) => s !== "3-1/2"); // tables that skip 3-1/2

type Cell = number | null;
/** Parse a compact table: one row per line "nps v1 v2 …"; "-" = not given. */
function table(src: string): Record<string, Cell[]> {
  const out: Record<string, Cell[]> = {};
  for (const line of src.trim().split('\n')) {
    const [k, ...vals] = line.trim().split(/\s+/);
    out[k] = vals.map((v) => (v === '-' ? null : Number(v)));
  }
  return out;
}
const mm = (v: Cell) => (v === null ? null : v / 25.4);
/** Round to nearest 1/16 (used for B16.10 metric→inch, whose inch values are in 1/16ths). */
const to16 = (v: Cell) => (v === null ? null : Math.round((v / 25.4) * 16) / 16);
function zip(sizes: readonly string[], ...cols: Cell[][]) {
  const out: Record<string, Cell[]> = {};
  sizes.forEach((s, i) => { out[s] = cols.map((c) => c[i] ?? null); });
  return out;
}

// =============================================================================== FLANGES
export const FLANGE_CLASSES = [150, 300, 400, 600, 900, 1500, 2500] as const;
export type FlangeClass = (typeof FLANGE_CLASSES)[number];

export const FLANGE_SOURCE = 'Texas Flange — ASME B16.5 forged flange dimension tables, Classes 150–2500 (texasflange.com, product catalog v5.1). OD, bolt circle and bolting cross-checked against Engineering ToolBox "ASME/ANSI B16.5 Flanges and Bolt Dimensions".';
export const STUD_SOURCE = 'Texas Flange — Bolt and Stud Dimensions, ASME B16.5 Flanges. Stud length for a flange-to-flange joint with heavy hex nuts, including usual thread projection. Add length for spacers, blinds, wafer valves or thick gaskets. Class 150 cross-checked against USA Fastener B16.5 chart.';

// cols: O, T(tf), R(raised face dia), X(hub dia), BC, nBolts, hole, Y_SO (slip-on/threaded/socket length thru hub), Y_WN, Y_LJ
const F150 = table(`
1/2 3.50 0.38 1.38 1.19 2.38 4 0.62 0.56 1.81 0.62
3/4 3.88 0.44 1.69 1.50 2.75 4 0.62 0.56 2.00 0.62
1 4.25 0.50 2.00 1.94 3.12 4 0.62 0.62 2.12 0.69
1-1/4 4.62 0.56 2.50 2.31 3.50 4 0.62 0.75 2.19 0.81
1-1/2 5.00 0.62 2.88 2.56 3.88 4 0.62 0.81 2.38 0.88
2 6.00 0.69 3.62 3.06 4.75 4 0.75 0.94 2.44 1.00
2-1/2 7.00 0.81 4.12 3.56 5.50 4 0.75 1.06 2.69 1.12
3 7.50 0.88 5.00 4.25 6.00 4 0.75 1.12 2.69 1.19
3-1/2 8.50 0.88 5.50 4.81 7.00 8 0.75 1.19 2.75 1.25
4 9.00 0.88 6.19 5.31 7.50 8 0.75 1.25 2.94 1.31
5 10.00 0.88 7.31 6.44 8.50 8 0.88 1.38 3.44 1.44
6 11.00 0.94 8.50 7.56 9.50 8 0.88 1.50 3.44 1.56
8 13.50 1.06 10.62 9.69 11.75 8 0.88 1.69 3.94 1.75
10 16.00 1.12 12.75 12.00 14.25 12 1.00 1.88 3.94 1.94
12 19.00 1.19 15.00 14.38 17.00 12 1.00 2.12 4.44 2.19
14 21.00 1.31 16.25 15.75 18.75 12 1.12 2.19 4.94 3.12
16 23.50 1.38 18.50 18.00 21.25 16 1.12 2.44 4.94 3.44
18 25.00 1.50 21.00 19.88 22.75 16 1.25 2.62 5.44 3.81
20 27.50 1.62 23.00 22.00 25.00 20 1.25 2.81 5.62 4.06
24 32.00 1.81 27.25 26.12 29.50 20 1.38 3.19 5.94 4.38`);
const F300 = table(`
1/2 3.75 0.50 1.38 1.50 2.62 4 0.62 0.81 2.00 0.88
3/4 4.62 0.56 1.69 1.88 3.25 4 0.75 0.94 2.19 1.00
1 4.88 0.62 2.00 2.12 3.50 4 0.75 1.00 2.38 1.06
1-1/4 5.25 0.69 2.50 2.50 3.88 4 0.75 1.00 2.50 1.06
1-1/2 6.12 0.75 2.88 2.75 4.50 4 0.88 1.13 2.63 1.19
2 6.50 0.81 3.62 3.31 5.00 8 0.75 1.25 2.69 1.31
2-1/2 7.50 0.94 4.12 3.94 5.88 8 0.88 1.44 2.94 1.50
3 8.25 1.06 5.00 4.62 6.62 8 0.88 1.63 3.06 1.69
3-1/2 9.00 1.12 5.50 5.25 7.25 8 0.88 1.69 3.13 1.75
4 10.00 1.19 6.19 5.75 7.88 8 0.88 1.82 3.32 1.88
5 11.00 1.31 7.31 7.00 9.25 8 0.88 1.94 3.82 2.00
6 12.50 1.38 8.50 8.12 10.62 12 0.88 2.00 3.82 2.06
8 15.00 1.56 10.62 10.25 13.00 12 1.00 2.38 4.32 2.44
10 17.50 1.81 12.75 12.62 15.25 16 1.12 2.56 4.56 3.75
12 20.50 1.94 15.00 14.75 17.75 16 1.25 2.82 5.06 4.00
14 23.00 2.06 16.25 16.75 20.25 20 1.25 2.94 5.56 4.38
16 25.50 2.19 18.50 19.00 22.50 20 1.38 3.19 5.69 4.75
18 28.00 2.31 21.00 21.00 24.75 24 1.38 3.44 6.19 5.12
20 30.50 2.44 23.00 23.12 27.00 24 1.38 3.69 6.32 5.50
24 36.00 2.69 27.25 27.62 32.00 24 1.62 4.13 6.56 6.00`);
const F600 = table(`
1/2 3.75 0.56 1.38 1.50 2.62 4 0.62 0.88 2.06 0.88
3/4 4.62 0.62 1.69 1.88 3.25 4 0.75 1.00 2.25 1.00
1 4.88 0.69 2.00 2.12 3.50 4 0.75 1.06 2.44 1.06
1-1/4 5.25 0.81 2.50 2.50 3.88 4 0.75 1.12 2.62 1.12
1-1/2 6.12 0.88 2.88 2.75 4.50 4 0.88 1.25 2.75 1.25
2 6.50 1.00 3.62 3.31 5.00 8 0.75 1.44 2.88 1.44
2-1/2 7.50 1.12 4.12 3.94 5.88 8 0.88 1.62 3.12 1.62
3 8.25 1.25 5.00 4.62 6.62 8 0.88 1.81 3.25 1.81
3-1/2 9.00 1.38 5.50 5.25 7.25 8 1.00 1.94 3.38 1.94
4 10.75 1.50 6.19 6.00 8.50 8 1.00 2.12 4.00 2.12
5 13.00 1.75 7.31 7.44 10.50 8 1.12 2.38 4.50 2.38
6 14.00 1.88 8.50 8.75 11.50 12 1.12 2.62 4.62 2.62
8 16.50 2.19 10.62 10.75 13.75 12 1.25 3.00 5.25 3.00
10 20.00 2.50 12.75 13.50 17.00 16 1.38 3.38 6.00 4.38
12 22.00 2.62 15.00 15.75 19.25 20 1.38 3.62 6.12 4.62
14 23.75 2.75 16.25 17.00 20.75 20 1.50 3.69 6.50 5.00
16 27.00 3.00 18.50 19.50 23.75 20 1.62 4.19 7.00 5.50
18 29.25 3.25 21.00 21.50 25.75 20 1.75 4.62 7.25 6.00
20 32.00 3.50 23.00 24.00 28.50 24 1.75 5.00 7.50 6.50
24 37.00 4.00 27.25 28.25 33.00 24 2.00 5.50 8.00 7.25`);
// Class 400: NPS 3-1/2 and smaller are identical to Class 600 (B16.5).
const F400 = {
  ...Object.fromEntries(Object.entries(F600).filter(([k]) => ['1/2', '3/4', '1', '1-1/4', '1-1/2', '2', '2-1/2', '3', '3-1/2'].includes(k))),
  ...table(`
4 10.00 1.38 6.19 5.75 7.88 8 1.00 2.00 3.50 2.00
5 11.00 1.50 7.31 7.00 9.25 8 1.00 2.12 4.00 2.12
6 12.50 1.62 8.50 8.12 10.62 12 1.00 2.25 4.06 2.25
8 15.00 1.88 10.62 10.25 13.00 12 1.12 2.69 4.62 2.69
10 17.50 2.12 12.75 12.62 15.25 16 1.25 2.88 4.88 4.00
12 20.50 2.25 15.00 14.75 17.75 16 1.38 3.12 5.38 4.25
14 23.00 2.38 16.25 16.75 20.25 20 1.38 3.31 5.88 4.62
16 25.50 2.50 18.50 19.00 22.50 20 1.50 3.69 6.00 5.00
18 28.00 2.62 21.00 21.00 24.75 24 1.50 3.88 6.50 5.38
20 30.50 2.75 23.00 23.12 27.00 24 1.62 4.00 6.62 5.75
24 36.00 3.00 27.25 27.62 32.00 24 1.88 4.50 6.88 6.25`),
};
const F1500 = table(`
1/2 4.75 0.88 1.38 1.50 3.25 4 0.88 1.25 2.38 1.25
3/4 5.12 1.00 1.69 1.75 3.50 4 0.88 1.38 2.75 1.38
1 5.88 1.12 2.00 2.06 4.00 4 1.00 1.62 2.88 1.62
1-1/4 6.25 1.12 2.50 2.50 4.38 4 1.00 1.62 2.88 1.62
1-1/2 7.00 1.25 2.88 2.75 4.88 4 1.12 1.75 3.25 1.75
2 8.50 1.50 3.62 4.12 6.50 8 1.00 2.25 4.00 2.25
2-1/2 9.62 1.62 4.12 4.88 7.50 8 1.12 2.50 4.12 2.50
3 10.50 1.88 5.00 5.25 8.00 8 1.25 - 4.62 2.88
4 12.25 2.12 6.19 6.38 9.50 8 1.38 - 4.88 3.56
5 14.75 2.88 7.31 7.75 11.50 8 1.62 - 6.12 4.12
6 15.50 3.25 8.50 9.00 12.50 12 1.50 - 6.75 4.69
8 19.00 3.62 10.62 11.50 15.50 12 1.75 - 8.38 5.62
10 23.00 4.25 12.75 14.50 19.00 12 2.00 - 10.00 7.00
12 26.50 4.88 15.00 17.75 22.50 16 2.12 - 11.12 8.62
14 29.50 5.25 16.25 19.50 25.00 16 2.38 - 11.75 9.50
16 32.50 5.75 18.50 21.75 27.75 16 2.62 - 12.25 10.25
18 36.00 6.38 21.00 23.50 30.50 16 2.88 - 12.88 10.88
20 38.75 7.00 23.00 25.25 32.75 16 3.12 - 14.00 11.50
24 46.00 8.00 27.25 30.00 39.00 16 3.62 - 16.00 13.00`);
// Class 900: NPS 2-1/2 and smaller are identical to Class 1500 (B16.5).
const F900 = {
  ...Object.fromEntries(Object.entries(F1500).filter(([k]) => ['1/2', '3/4', '1', '1-1/4', '1-1/2', '2', '2-1/2'].includes(k))),
  ...table(`
3 9.50 1.50 5.00 5.00 7.50 8 1.00 2.12 4.00 2.12
4 11.50 1.75 6.19 6.25 9.25 8 1.25 2.75 4.50 2.75
5 13.75 2.00 7.31 7.50 11.00 8 1.38 3.12 5.00 3.12
6 15.00 2.19 8.50 9.25 12.50 12 1.25 3.38 5.50 3.38
8 18.50 2.50 10.62 11.75 15.50 12 1.50 4.00 6.38 4.50
10 21.50 2.75 12.75 14.50 18.50 16 1.50 4.25 7.25 5.00
12 24.00 3.12 15.00 16.50 21.00 20 1.50 4.62 7.88 5.62
14 25.25 3.38 16.25 17.75 22.00 20 1.62 5.12 8.38 6.12
16 27.75 3.50 18.50 20.00 24.25 20 1.75 5.25 8.50 6.50
18 31.00 4.00 21.00 22.25 27.00 20 2.00 6.00 9.00 7.50
20 33.75 4.25 23.00 24.50 29.50 20 2.12 6.25 9.75 8.25
24 41.00 5.50 27.25 29.50 35.50 20 2.62 8.00 11.50 10.50`),
};
const F2500 = table(`
1/2 5.25 1.19 1.38 1.69 3.50 4 0.88 1.56 2.88 1.56
3/4 5.50 1.25 1.69 2.00 3.75 4 0.88 1.69 3.12 1.69
1 6.25 1.38 2.00 2.25 4.25 4 1.00 1.88 3.50 1.88
1-1/4 7.25 1.50 2.50 2.88 5.12 4 1.12 2.06 3.75 2.06
1-1/2 8.00 1.75 2.88 3.12 5.75 4 1.25 2.38 4.38 2.38
2 9.25 2.00 3.62 3.75 6.75 8 1.12 2.75 5.00 2.75
2-1/2 10.50 2.25 4.12 4.50 7.75 8 1.25 3.12 5.62 3.12
3 12.00 2.62 5.00 5.25 9.00 8 1.38 - 6.62 3.62
4 14.00 3.00 6.19 6.50 10.75 8 1.62 - 7.50 4.25
5 16.50 3.62 7.31 8.00 12.75 8 1.88 - 9.00 5.12
6 19.00 4.25 8.50 9.25 14.50 8 2.12 - 10.75 6.00
8 21.75 5.00 10.62 12.00 17.25 12 2.12 - 12.50 7.00
10 26.50 6.50 12.75 14.75 21.25 12 2.62 - 16.50 9.00
12 30.00 7.25 15.00 17.38 24.38 12 2.88 - 18.25 10.00`);
const FLANGE_TABLES: Record<FlangeClass, Record<string, Cell[]>> = { 150: F150, 300: F300, 400: F400, 600: F600, 900: F900, 1500: F1500, 2500: F2500 };

// Stud lengths (RF, RTJ) by class; "-" = not given (RTJ not standard).
const STUDS: Partial<Record<FlangeClass, Record<string, Cell[]>>> = {
  150: table(`
1/2 2.25 -
3/4 2.5 -
1 2.5 3
1-1/4 2.75 3.25
1-1/2 2.75 3.25
2 3.25 3.75
2-1/2 3.5 4
3 3.5 4
3-1/2 3.5 4
4 3.5 4
5 3.75 4.25
6 4 4.5
8 4.25 4.75
10 4.5 5
12 4.75 5.25
14 5.25 5.75
16 5.25 5.75
18 5.75 6.25
20 6.25 6.75
24 6.75 7.25`),
  300: table(`
1/2 2.5 3
3/4 3 3.5
1 3 3.5
1-1/4 3.25 3.75
1-1/2 3.5 4
2 3.5 4
2-1/2 4 4.5
3 4.25 4.75
3-1/2 4.25 5
4 4.5 5
5 4.75 5.25
6 4.75 5.5
8 5.5 6
10 6.25 6.75
12 6.75 7.25
14 7 7.5
16 7.5 8
18 7.75 8.25
20 8 8.75
24 9 10`),
  600: table(`
1/2 3 3
3/4 3.5 3.5
1 3.5 3.5
1-1/4 3.75 3.75
1-1/2 4.25 4.25
2 4.25 4.25
2-1/2 4.75 4.75
3 5 5
3-1/2 5.5 5.5
4 5.75 5.75
5 6.5 6.5
6 6.75 6.75
8 7.5 7.75
10 8.5 8.5
12 8.75 8.75
14 9.25 9.25
16 10 10
18 10.75 10.75
20 11.25 11.5
24 13 13.25`),
  900: table(`
1/2 4.25 4.25
3/4 4.5 4.5
1 5 5
1-1/4 5 5
1-1/2 5.5 5.5
2 5.75 5.75
2-1/2 6.25 6.25
3 5.75 5.75
4 6.75 6.75
5 7.5 7.5
6 7.5 7.75
8 8.75 8.75
10 9.25 9.25
12 10 10
14 10.75 11
16 11.25 11.5
18 12.75 13.25
20 13.75 14.25
24 17.25 18`),
  1500: table(`
1/2 4.25 4.25
3/4 4.5 4.5
1 5 5
1-1/4 5 5
1-1/2 5.5 5.5
2 5.75 5.75
2-1/2 6.25 6.25
3 7 7
4 7.75 7.75
5 9.75 9.75
6 10.25 10.5
8 11.5 11.75
10 13.25 13.5
12 14.75 15.25
14 16 16.75
16 17.5 18.5
18 19.5 20.75
20 21.25 22.25
24 24.25 25.5`),
  2500: table(`
1/2 4.75 4.75
3/4 5 5
1 5.5 5.5
1-1/4 6 6
1-1/2 6.75 6.75
2 7 7
2-1/2 7.75 8
3 8.75 9
4 10 10.25
5 11.75 12.25
6 13.5 14
8 15 15.5
10 19.25 20
12 21.25 22`),
};

// RTJ ring numbers — only the Class 300/400/600 column could be confirmed against a published table.
export const RING_SOURCE = 'Ring numbers for Class 300/400/600 per ASME B16.5/B16.20 as tabulated by Project Materials (blog.projectmaterials.com, "Gasket Dimensions: ASME B16.20 Ring Joint"). Other classes: not included — read the ring number from the flange or check B16.20.';
const RINGS_300_600: Record<string, string> = {
  '1/2': 'R-11', '3/4': 'R-13', '1': 'R-16', '1-1/2': 'R-20', '2': 'R-23', '2-1/2': 'R-26', '3': 'R-31', '4': 'R-37', '5': 'R-41', '6': 'R-45',
  '8': 'R-49', '10': 'R-53', '12': 'R-57', '14': 'R-61', '16': 'R-65', '18': 'R-69', '20': 'R-73', '24': 'R-77',
};

export interface Flange {
  cls: FlangeClass; nps: string;
  od: number; tf: number; rfDia: number; rfHeight: number; hubDia: number;
  boltCircle: number; nBolts: number; holeDia: number; boltDia: number;
  ySO: number | null; yWN: number; yLJ: number | null;
  socketDepth: number | null; studRF: number | null; studRTJ: number | null; ring: string | null;
  wrench: number; // heavy hex nut across flats
}

const SOCKET_DEPTH: Record<string, number> = { '1/2': 0.38, '3/4': 0.44, '1': 0.5, '1-1/4': 0.56, '1-1/2': 0.62, '2': 0.69, '2-1/2': 0.75, '3': 0.81 };

/** Heavy hex nut width across flats, ASME B18.2.2: F = 1.5·D + 1/8 in. */
export const heavyHexAcrossFlats = (d: number) => 1.5 * d + 0.125;

export function flangeSizes(cls: FlangeClass): string[] { return SIZES.filter((s) => FLANGE_TABLES[cls][s]); }

export function flange(cls: FlangeClass, nps: string): Flange {
  const r = FLANGE_TABLES[cls]?.[nps];
  if (!r) throw new CalcError('DATA', `NPS ${nps} is not listed for Class ${cls} in the bundled B16.5 tables (${flangeSizes(cls).join(', ')}).`);
  const [od, tf, rfDia, hubDia, bc, n, hole, ySO, yWN, yLJ] = r;
  const studs = STUDS[cls]?.[nps];
  const boltDia = Math.round((hole! - 0.125) * 8) / 8; // B16.5: hole = bolt + 1/8 in
  return {
    cls, nps, od: od!, tf: tf!, rfDia: rfDia!, rfHeight: cls <= 300 ? 0.06 : 0.25, hubDia: hubDia!,
    boltCircle: bc!, nBolts: n!, holeDia: hole!, boltDia, ySO, yWN: yWN!, yLJ,
    // socket-weld flanges: Classes 150–600 to NPS 3, 900–1500 to NPS 2-1/2, none in 2500
    socketDepth: SOCKET_DEPTH[nps] !== undefined && (cls <= 600 || (cls <= 1500 && nps !== '3')) ? SOCKET_DEPTH[nps] : null,
    studRF: studs?.[0] ?? null, studRTJ: studs?.[1] ?? null,
    ring: cls >= 300 && cls <= 600 ? RINGS_300_600[nps] ?? null : null,
    wrench: heavyHexAcrossFlats(boltDia),
  };
}

// =============================================================================== BOLTING
/** UNC (≤ 1 in) and 8-UN (> 1 in) threads per inch, as used for B16.5 stud bolts. */
export function boltTPI(d: number): number {
  const unc: Record<string, number> = { '0.5': 13, '0.625': 11, '0.75': 10, '0.875': 9, '1': 8 };
  return unc[String(d)] ?? 8;
}
/** Tensile stress area, ASME B1.1: As = 0.7854·(D − 0.9743/n)². */
export const tensileStressArea = (d: number, tpi = boltTPI(d)) => 0.7854 * Math.pow(d - 0.9743 / tpi, 2);

export interface TorqueResult { As: number; preload: number; torqueFtLb: number; passes: Array<{ pct: number; ftlb: number }> }
/** Short-form torque T = K·D·F (Motosh / PCC-1 Appendix K). F = target bolt stress × As. */
export function boltTorque(d: number, targetStressPsi: number, nutFactor: number): TorqueResult {
  if (!(d > 0)) throw new CalcError('INPUT', 'Bolt diameter must be greater than zero.');
  if (!(targetStressPsi > 0) || !(nutFactor > 0)) throw new CalcError('INPUT', 'Enter a target bolt stress and nut factor greater than zero.');
  const As = tensileStressArea(d);
  const F = targetStressPsi * As;
  const T = (nutFactor * d * F) / 12;
  return { As, preload: F, torqueFtLb: T, passes: [20, 30, 70, 100].map((p) => ({ pct: p, ftlb: (T * p) / 100 })) };
}

/** Cross-pattern ("legacy star") tightening order, bolts numbered clockwise from 1. ASME PCC-1 legacy pattern. */
export function tighteningSequence(n: number): number[] {
  if (n < 4 || n % 4 !== 0) throw new CalcError('INPUT', 'Bolt count must be a multiple of 4.');
  // Order quadrant groups by bit-reversal of the group index, then within a group: i, i+N/2, i+N/4, i+3N/4.
  const q = n / 4;
  const order: number[] = [];
  const groups = Array.from({ length: q }, (_, i) => i);
  // PCC-1 legacy order for group starts: 0, then halves recursively (e.g. q=3 → 0,1,2; q=4 → 0,2,1,3; q=5 → 0,2,4,1,3; q=6 → 0,3,1,4,2,5)
  const groupOrder = LEGACY_GROUPS[q] ?? groups;
  for (const g of groupOrder) {
    const b = g + 1;
    order.push(b, b + n / 2, b + n / 4, b + (3 * n) / 4);
  }
  return order;
}
const LEGACY_GROUPS: Record<number, number[]> = {
  1: [0], 2: [0, 1], 3: [0, 1, 2], 4: [0, 2, 1, 3], 5: [0, 2, 4, 1, 3], 6: [0, 3, 1, 4, 2, 5], 7: [0, 4, 2, 6, 1, 5, 3], 8: [0, 4, 2, 6, 1, 5, 3, 7],
};

// =============================================================================== GASKETS
export const SW_GASKET_SOURCE = 'ASME B16.20 spiral-wound gaskets for B16.5 raised-face flanges. Winding ID and centering-ring OD by class: Hardhat Engineer, "Spiral Wound Gasket Dimensions Class 150 to 2500" (mm, converted). Class 150 inner-ring ID and winding OD: Wermac, "Dimensions Spiral Wound Gaskets ASME B16.20".';
const GK_ORDER = SIZES19; // 1/2 … 24, no 3-1/2
// winding OD — same for Classes 150–600 per source (mm)
const GK_WOD_150_600 = [31.8, 39.6, 47.8, 60.5, 69.9, 85.9, 98.6, 120.7, 149.4, 177.8, 209.6, 263.7, 317.5, 374.7, 406.4, 463.6, 527.1, 577.9, 685.8];
const GK: Record<FlangeClass, { wid: Cell[]; ring: Cell[] }> = {
  150: { wid: [19.1, 25.4, 31.8, 47.8, 54.1, 69.9, 82.6, 101.6, 127, 155.7, 182.6, 233.4, 287.3, 339.9, 371.6, 422.4, 474.7, 525.5, 628.7], ring: [47.8, 57.2, 66.8, 76.2, 85.9, 104.9, 124, 136.7, 174.8, 196.9, 222.3, 279.4, 339.9, 409.7, 450.9, 514.4, 549.4, 606.6, 717.6] },
  300: { wid: [19.1, 25.4, 31.8, 47.8, 54.1, 69.9, 82.6, 101.6, 127, 155.7, 182.6, 233.4, 287.3, 339.9, 371.6, 422.4, 474.7, 525.5, 628.7], ring: [54.1, 66.8, 73.2, 82.6, 95.3, 111.3, 130.3, 149.4, 181.1, 215.9, 251, 308.1, 362, 422.4, 485.9, 539.8, 596.9, 654.1, 774.7] },
  400: { wid: [19.1, 25.4, 31.8, 47.8, 54.1, 69.9, 82.6, 101.6, 120.7, 147.6, 174.8, 225.6, 274.6, 327.2, 362, 412.8, 469.9, 520.7, 628.7], ring: [54.1, 66.8, 73.2, 82.6, 95.3, 111.3, 130.3, 149.4, 177.8, 212.9, 247.7, 304.8, 358.9, 419.1, 482.6, 536.7, 593.9, 647.7, 768.4] },
  600: { wid: [19.1, 25.4, 31.8, 47.8, 54.1, 69.9, 82.6, 101.6, 120.7, 147.6, 174.8, 225.6, 274.6, 327.2, 362, 412.8, 469.9, 520.7, 628.7], ring: [54.1, 66.8, 73.2, 82.6, 95.3, 111.3, 130.3, 149.4, 193.8, 241.3, 266.7, 320.8, 400.1, 457.2, 492.3, 565.2, 612.9, 682.8, 790.7] },
  900: { wid: [19.1, 25.4, 31.8, 39.6, 47.8, 58.7, 69.9, 95.3, 120.7, 147.6, 174.8, 222.3, 276.4, 323.9, 355.6, 412.8, 463.6, 520.7, 628.7], ring: [63.5, 69.9, 79.5, 88.9, 98.6, 143, 165.1, 168.4, 206.5, 247.7, 289.1, 358.9, 435.1, 498.6, 520.7, 574.8, 638.3, 698.5, 838.2] },
  1500: { wid: [19.1, 25.4, 31.8, 39.6, 47.8, 58.7, 69.9, 92.2, 117.6, 143, 171.5, 215.9, 266.7, 323.9, 362, 406.4, 463.6, 514.4, 616], ring: [63.5, 69.9, 79.5, 88.9, 98.6, 143, 165.1, 174.8, 209.6, 254, 282.7, 352.6, 435.1, 520.7, 577.9, 641.4, 704.9, 755.7, 901.7] },
  2500: { wid: [19.1, 25.4, 31.8, 39.6, 47.8, 58.7, 69.9, 92.2, 117.6, 143, 171.5, 215.9, 270, 317.5], ring: [69.9, 76.2, 85.9, 104.9, 117.6, 146.1, 168.4, 196.9, 235, 279.4, 317.5, 387.4, 476.3, 549.4] },
};
// Class 900 sizes ≤ 2-1/2 equal Class 1500 (both the B16.5 flange and the source table).
const GK_INNER_150 = [0.56, 0.81, 1.06, 1.5, 1.75, 2.19, 2.62, 3.19, 4.19, 5.19, 6.19, 8.5, 10.56, 12.5, 13.75, 15.75, 17.69, 19.69, 23.75];

export interface SpiralGasket { windingID: number | null; windingOD: number | null; ringOD: number | null; innerRingID: number | null }
export function spiralGasket(cls: FlangeClass, nps: string): SpiralGasket {
  const i = GK_ORDER.indexOf(nps);
  if (i < 0) throw new CalcError('DATA', `No spiral-wound gasket data for NPS ${nps} (3-1/2 is not in the source table).`);
  const g = GK[cls];
  if (g.ring[i] === undefined) throw new CalcError('DATA', `Class ${cls} spiral-wound gasket data covers NPS 1/2–12 only.`);
  return {
    windingID: mm(g.wid[i] ?? null), windingOD: cls <= 600 ? mm(GK_WOD_150_600[i]) : null, ringOD: mm(g.ring[i] ?? null),
    innerRingID: cls === 150 ? GK_INNER_150[i] : null,
  };
}

// =============================================================================== BUTT-WELD FITTINGS (B16.9)
export const B169_FIT_SOURCE = 'ASME B16.9. Tees and reducers: Wermac "Dimensions Butt Weld Straight Tees" and Project Materials "BW Pipe Fittings Sizes (ASME B16.9)" (mm, agree with inch values). 180° returns: Texas Flange long- and short-radius return bend tables. Stub ends: Wermac "Dimensions Stub Ends Carbon Steel" (B16.9 long pattern). Caps: B16.9 STD, partially confirmed by Project Materials.';
// cols: tee C=M, cap E, reducer H (large end), LR return O, LR return K, SR return O, SR return K, stub F (long), stub G (lap OD), stub R (fillet)
export const B169_FIT = table(`
1/2 1.00 1.00 - 3.00 1.88 - - 3 1.38 0.12
3/4 1.12 1.00 1.50 - - - - 3 1.69 0.12
1 1.50 1.50 2.00 3.00 2.19 2.00 1.62 4 2.00 0.12
1-1/4 1.88 1.50 2.00 3.75 2.75 2.50 2.06 4 2.50 0.19
1-1/2 2.25 1.50 2.50 4.50 3.25 3.00 2.44 4 2.88 0.25
2 2.50 1.50 3.00 6.00 4.19 4.00 3.19 6 3.62 0.31
2-1/2 3.00 1.50 3.50 7.50 5.19 5.00 3.94 6 4.12 0.31
3 3.38 2.00 3.50 9.00 6.25 6.00 4.75 6 5.00 0.38
3-1/2 3.75 2.50 4.00 10.50 7.25 7.00 5.50 6 5.50 0.38
4 4.12 2.50 4.00 12.00 8.25 8.00 6.25 6 6.19 0.44
5 4.88 3.00 5.00 15.00 10.31 10.00 7.75 8 7.31 0.44
6 5.62 3.50 5.50 18.00 12.31 12.00 9.31 8 8.50 0.50
8 7.00 4.00 6.00 24.00 16.31 16.00 12.31 8 10.62 0.50
10 8.50 5.00 7.00 30.00 20.38 20.00 15.38 10 12.75 0.50
12 10.00 6.00 8.00 36.00 24.38 24.00 18.38 10 15.00 0.50
14 11.00 6.50 13.00 42.00 28.00 28.00 21.00 12 16.25 0.50
16 12.00 7.00 14.00 48.00 32.00 32.00 24.00 12 18.50 0.50
18 13.50 8.00 15.00 54.00 36.00 36.00 27.00 12 21.00 0.50
20 15.00 9.00 20.00 60.00 40.00 40.00 30.00 12 23.00 0.50
24 17.00 10.50 20.00 72.00 48.00 48.00 36.00 12 27.25 0.50`);
export const B169_FIT_COLS = ['teeC', 'capE', 'reducerH', 'lrO', 'lrK', 'srO', 'srK', 'stubF', 'stubG', 'stubR'] as const;
export function bwFitting(nps: string): Record<(typeof B169_FIT_COLS)[number], number | null> {
  const r = B169_FIT[nps];
  if (!r) throw new CalcError('DATA', `No B16.9 data for NPS ${nps}.`);
  return Object.fromEntries(B169_FIT_COLS.map((k, i) => [k, r[i]])) as Record<(typeof B169_FIT_COLS)[number], number | null>;
}

// =============================================================================== SOCKET-WELD & THREADED (B16.11, B16.3)
export const B1611_SOURCE = 'ASME B16.11 forged fittings. Socket-weld: Wermac "Dimensions Socket Weld Elbows ASME B16.11"; threaded: Wermac "Dimensions Threaded Elbows ASME B16.11" (mm, converted). Tees and crosses share the 90° elbow center-to-end.';
const SW_SIZES = ['1/2', '3/4', '1', '1-1/4', '1-1/2', '2', '2-1/2', '3', '4'];
// mm: socket bore max, min, socket depth J, A90 3000, A45 3000, A90 6000, A45 6000
const SWmm = table(`
1/2 21.95 21.70 10 15.5 11.5 19.5 12.5
3/4 27.30 27.05 13 19.5 12.5 22.5 14.5
1 34.05 33.80 13 22 14 27 17
1-1/4 42.80 42.55 13 27 17 32 21
1-1/2 48.90 48.65 13 32 21 38 25
2 61.35 61.10 16 38 25 41 29
2-1/2 74.20 73.80 16 41.5 29 - -
3 90.15 89.80 16 57.5 31.5 - -
4 115.80 115.45 19 66.5 41.5 - -`);
export interface SocketFitting { bore: number; depth: number; a90: number | null; a45: number | null; engagement: number; takeout90: number | null; takeout45: number | null }
/** Socket-weld fitting; take-out = A − (J − gap). B31.1/B31.3 require ≈1/16 in gap before welding. */
export function socketWeld(nps: string, cls: 3000 | 6000, gap = 0.0625): SocketFitting {
  const r = SWmm[nps];
  if (!r) throw new CalcError('DATA', `B16.11 socket-weld data covers NPS ${SW_SIZES.join(', ')}.`);
  const [bmax, bmin, J, a3, c3, a6, c6] = r.map(mm);
  const a90 = cls === 3000 ? a3 : a6, a45 = cls === 3000 ? c3 : c6;
  if (a90 === null) throw new CalcError('DATA', `Class 6000 socket-weld data covers NPS 1/2–2 only.`);
  const engagement = J! - gap;
  return { bore: (bmax! + bmin!) / 2, depth: J!, a90, a45, engagement, takeout90: a90 - engagement, takeout45: a45 === null ? null : a45 - engagement };
}

// NPT (ASME B1.20.1) — Chicago Tube "ASME Standard Taper Pipe Thread Dimensions"
export const NPT_SOURCE = 'ASME B1.20.1 NPT dimensions as published by Chicago Tube & Iron: L1 hand-tight engagement, L3 wrench makeup (3 threads). Actual makeup varies ±1 thread with tapping tolerance and sealant.';
const NPT = table(`
1/8 0.405 27 0.1615 0.1111
1/4 0.540 18 0.2278 0.1667
3/8 0.675 18 0.240 0.1667
1/2 0.840 14 0.320 0.2143
3/4 1.050 14 0.339 0.2143
1 1.315 11.5 0.400 0.2609
1-1/4 1.660 11.5 0.420 0.2609
1-1/2 1.900 11.5 0.420 0.2609
2 2.375 11.5 0.436 0.2609
2-1/2 2.875 8 0.682 0.2500
3 3.500 8 0.766 0.2500
3-1/2 4.000 8 0.821 0.2500
4 4.500 8 0.844 0.2500
5 5.563 8 0.937 0.2500
6 6.625 8 0.958 0.2500
8 8.625 8 1.063 0.2500`);
export function nptMakeup(nps: string) {
  const r = NPT[nps];
  if (!r) throw new CalcError('DATA', `No NPT data for ${nps}.`);
  return { tpi: r[1]!, L1: r[2]!, L3: r[3]!, makeup: r[2]! + r[3]! };
}
// B16.11 threaded center-to-end (mm): A90 2000, A45 2000, A90 3000, A45 3000, A90 6000, A45 6000
const THDmm = table(`
1/2 28 22 33 25 38 28
3/4 33 25 38 28 44 33
1 38 28 44 33 51 35
1-1/4 44 33 51 35 60 43
1-1/2 51 35 60 43 64 44
2 60 43 64 44 83 52
2-1/2 76 52 83 52 95 64
3 86 64 95 64 106 79
4 106 79 114 79 114 79`);
// B16.3 Class 150 malleable iron (BuyFittingsOnline data sheets, conform to ASME B16.3): A90 (= tee), A45
export const B163_SOURCE = 'ASME B16.3 Class 150 malleable iron threaded fittings — QMC/BuyFittingsOnline 90° and 45° elbow data sheets (in). Tees and crosses share the 90° elbow center-to-end.';
const B163 = table(`
1/8 0.69 0.60
1/4 0.81 0.73
3/8 0.95 0.80
1/2 1.12 0.88
3/4 1.31 0.98
1 1.50 1.12
1-1/4 1.75 1.29
1-1/2 1.94 1.43
2 2.25 1.68
2-1/2 2.70 1.95
3 3.08 2.17
4 3.79 2.61
5 4.50 3.05
6 5.13 3.46
8 6.38 4.00`);
export type ThreadedKind = 'B16.3-150' | 'B16.11-2000' | 'B16.11-3000' | 'B16.11-6000';
export const THREADED_KINDS: ThreadedKind[] = ['B16.3-150', 'B16.11-2000', 'B16.11-3000', 'B16.11-6000'];
export const THREADED_LABEL: Record<ThreadedKind, string> = {
  'B16.3-150': '150# malleable iron (B16.3)', 'B16.11-2000': 'Forged 2000 (B16.11)', 'B16.11-3000': 'Forged 3000 (B16.11)', 'B16.11-6000': 'Forged 6000 (B16.11)',
};
export function threadedSizes(k: ThreadedKind) { return Object.keys(k === 'B16.3-150' ? B163 : THDmm); }
export function threadedFitting(k: ThreadedKind, nps: string) {
  let a90: number, a45: number;
  if (k === 'B16.3-150') { const r = B163[nps]; if (!r) throw new CalcError('DATA', `No B16.3 data for ${nps}.`); [a90, a45] = r as number[]; }
  else {
    const r = THDmm[nps]; if (!r) throw new CalcError('DATA', `No B16.11 threaded data for ${nps}.`);
    const off = k === 'B16.11-2000' ? 0 : k === 'B16.11-3000' ? 2 : 4;
    a90 = mm(r[off])!; a45 = mm(r[off + 1])!;
  }
  const m = nptMakeup(nps);
  return { a90, a45, makeup: m.makeup, takeout90: a90 - m.makeup, takeout45: a45 - m.makeup, L1: m.L1, L3: m.L3 };
}

// =============================================================================== VALVES (B16.10)
export const VALVE_SOURCE = 'ASME B16.10 face-to-face, raised-face flanged steel valves, as tabulated by Wermac "Face to Face dimensions of flanged valves" Classes 150–2500 (mm, converted to the nearest 1/16 in). Ring-joint end-to-end and butt-weld end dimensions differ and are not included.';
export type ValveType = 'gate' | 'globe' | 'swing' | 'ball';
export const VALVE_LABEL: Record<ValveType, string> = { gate: 'Gate (wedge / double disc)', globe: 'Globe & lift check', swing: 'Swing check', ball: 'Ball (long / regular pattern)' };
const VS = SIZES19;
const VALVES: Partial<Record<FlangeClass, Partial<Record<ValveType, Cell[]>>>> = {
  150: {
    gate: [108, 117, 127, 140, 165, 178, 190, 203, 229, 254, 267, 292, 330, 356, 381, 406, 432, 457, 508],
    globe: [108, 117, 127, 140, 165, 203, 216, 241, 292, 356, 406, 495, 622, 698, 787, 914, null, null, null],
    swing: [108, 117, 127, 140, 165, 203, 216, 241, 292, 330, 356, 495, 622, 698, 787, 864, 978, 978, 1295],
    ball: [108, 117, 127, 140, 165, 178, 190, 203, 229, null, 394, 457, 533, 610, 686, 762, 864, 914, 1067],
  },
  300: {
    gate: [140, 152, 165, 178, 190, 216, 241, 282, 305, 381, 403, 419, 457, 502, 762, 838, 914, 991, 1143],
    globe: [152, 178, 203, 216, 229, 267, 292, 318, 356, 400, 444, 559, 622, 711, null, null, null, null, null],
    swing: [null, null, 216, 229, 241, 267, 292, 318, 356, 400, 444, 533, 622, 711, 838, 864, 978, 1016, 1346],
    ball: [140, 152, 165, 178, 190, 216, 241, 282, 305, null, 403, 502, 568, 648, 762, 838, 914, 991, 1143],
  },
  600: {
    gate: [165, 190, 216, 229, 241, 292, 330, 356, 432, 508, 559, 660, 787, 838, 889, 991, 1092, 1194, 1397],
    globe: [165, 190, 216, 229, 241, 292, 330, 356, 432, 508, 559, 660, 787, 838, null, null, null, null, null],
    swing: [165, 190, 216, 229, 241, 292, 330, 356, 432, 508, 559, 660, 787, 838, 889, 991, 1092, 1194, 1397],
    ball: [165, 190, 216, 229, 241, 292, 330, 356, 432, null, 559, 660, 787, 838, 889, 991, 1092, 1194, 1397],
  },
  900: {
    gate: [null, null, 254, 279, 305, 368, 419, 381, 457, 559, 610, 737, 838, 965, 1029, 1130, 1219, 1321, 1549],
    globe: [null, 229, 254, 279, 305, 368, 419, 381, 457, 559, 610, 737, 838, 965, 1029, null, null, null, null],
    swing: [null, 229, 254, 279, 305, 368, 419, 381, 457, 559, 610, 737, 838, 965, 1029, 1130, 1219, 1321, 1549],
    ball: [null, null, 254, 279, 305, 368, 419, 381, 457, null, 610, 737, 838, 965, 1029, 1130, 1219, 1321, 1549],
  },
  1500: {
    gate: [null, null, 254, 279, 305, 368, 419, 470, 546, 673, 705, 832, 991, 1130, 1257, 1384, 1537, 1664, 1943],
    globe: [216, 229, 254, 279, 305, 368, 419, 470, 546, 673, 705, 832, 991, 1130, 1257, null, null, null, null],
    swing: [null, 229, 254, 279, 305, 368, 419, 470, 546, 673, 705, 832, 991, 1130, 1257, 1384, 1537, 1664, 1943],
    ball: [null, null, null, null, null, 368, 419, 470, 546, null, 705, 832, 991, 1130, 1257, 1384, null, null, null],
  },
  2500: {
    gate: [264, 273, 308, 349, 384, 451, 508, 578, 673, 794, 914, 1022, 1270, 1422],
    globe: [264, 273, 308, 349, 384, 451, 508, 578, 673, 794, 914, 1022, 1270, 1422],
    swing: [264, 273, 308, 349, 384, 451, 508, 578, 673, 794, 914, 1022, 1270, 1422],
    ball: [null, null, null, null, null, 451, 508, 578, 673, null, 914, 1022, 1270, 1422],
  },
};
export const VALVE_CLASSES = [150, 300, 600, 900, 1500, 2500] as const;
export function valveFaceToFace(cls: FlangeClass, type: ValveType, nps: string): number | null {
  const col = VALVES[cls]?.[type];
  if (!col) throw new CalcError('DATA', `No B16.10 data for Class ${cls}.`);
  const i = VS.indexOf(nps);
  if (i < 0) throw new CalcError('DATA', `NPS ${nps} is not in the B16.10 table set (3-1/2 not included).`);
  return to16(col[i] ?? null);
}

// =============================================================================== BRANCH OUTLETS (MSS SP-97)
export const OLET_SOURCE = 'MSS SP-97 Weldolet®, standard weight, reducing — height A by branch size (Bonney Forge data as tabulated by Wermac "Dimensions Weldolet® Reducing STD MSS SP97"). Size-on-size, XS, sockolet and threadolet heights are not included.';
export const WELDOLET_A = zip(SIZES, [0.75, 0.875, 1.0625, 1.25, 1.3125, 1.5, 1.625, 1.75, 1.875, 2, 2.25, 2.375, 2.75, 3.0625, 3.375, 3.5, 3.6875, 3.8125, 4, 4.5625]);
export function weldolet(branchNps: string, runOD: number, gap = 0) {
  const a = WELDOLET_A[branchNps]?.[0];
  if (a == null) throw new CalcError('DATA', `No Weldolet data for branch NPS ${branchNps}.`);
  if (!(runOD > 0)) throw new CalcError('INPUT', 'Run pipe OD is required.');
  return { A: a, centerToEnd: runOD / 2 + a + gap };
}

// =============================================================================== SUPPORTS (B31.1 Table 121.5)
export const SUPPORT_SOURCE = 'ASME B31.1 Table 121.5 suggested maximum span, as reproduced by Wermac "Pipe Supports Spacing". Horizontal straight runs of standard-weight and heavier steel pipe at up to 750 °F; insulated pipe; bending stress ≤ 2,300 psi; 0.1 in sag allowed. Not for concentrated loads (valves, flanges) between supports.';
export const SUPPORT_SPAN = table(`
1 7 9
2 10 13
3 12 15
4 14 17
6 17 21
8 19 24
12 23 30
16 27 35
20 30 39
24 32 42`);

// =============================================================================== PIPE EXTRAS (computed)
export const IN3 = { m3: Math.pow(0.0254, 3), ft3: 1 / 1728, L: Math.pow(0.254, 3), usgal: 1 / 231, impgal: Math.pow(0.254, 3) / 4.54609, bbl: 1 / (231 * 42) };
/** Internal volume of a pipe length (in) with inside diameter id (in), in each unit. */
export function pipeVolume(id: number, length: number) {
  if (!(id > 0) || !(length > 0)) throw new CalcError('INPUT', 'Enter a pipe size and a length greater than zero.');
  const v = (Math.PI / 4) * id * id * length;
  return { in3: v, m3: v * IN3.m3, ft3: v * IN3.ft3, L: v * IN3.L, usgal: v * IN3.usgal, impgal: v * IN3.impgal, bbl: v * IN3.bbl };
}
/** Internal and external surface area of a pipe length, in² (π·D·L). */
export function pipeSurface(od: number, id: number, length: number) {
  if (!(od > 0) || !(id > 0) || !(length > 0)) throw new CalcError('INPUT', 'Enter a pipe size and a length greater than zero.');
  return { outside: Math.PI * od * length, inside: Math.PI * id * length };
}
/**
 * Center-to-center spacing of two parallel pipes.
 * Each side is half its OD plus insulation, or half the flange OD if a flange sits at that point; plus clear gap.
 */
export function pipeSpacing(a: { od: number; insul: number; flangeOD?: number | null }, b: { od: number; insul: number; flangeOD?: number | null }, clear: number) {
  const side = (p: typeof a) => Math.max(p.od / 2 + p.insul, (p.flangeOD ?? 0) / 2);
  if (!(a.od > 0) || !(b.od > 0)) throw new CalcError('INPUT', 'Both pipe ODs are required.');
  if (clear < 0 || a.insul < 0 || b.insul < 0) throw new CalcError('INPUT', 'Clearance and insulation must be zero or positive.');
  return { spacing: side(a) + side(b) + clear, sideA: side(a), sideB: side(b) };
}
