/**
 * 영업이익 Bridge 산출.
 *
 * 전년 실적(P0) → 당년 목표(P1) 의 영업이익 증감을 6개 요인으로 분해한다.
 *
 * 이 대시보드의 PL 은 Tag매출만 V+ 이고 실판매출·매출원가는 V− 다.
 * Bridge 는 V+ 기준 지표(할인율·원가율)로 정의되므로 V(=1.13) 로 환산해 쓰고,
 * 요인 금액은 이익 단위(V−)로 되돌리기 위해 다시 V 로 나눈다.
 *
 *   할인율  d = 1 − 실판V+ / Tag = 1 − (실판V− × V) / Tag
 *   원가율  r = 매출원가V+ / Tag = (매출원가V− × V) / Tag
 *
 *   매출총이익 = Tag(1 − d − r)/V − 평가감  이므로 ΔGP 는 아래 3개로 정확히 분해된다.
 *     Tag매출 vol  = ΔTag × (1 − d0 − r0) / V
 *     할인율 disc = Tag1 × (d0 − d1) / V
 *     원가율 cogs = Tag1 × (r0 − r1) / V
 *   나머지
 *     평가감 vltn = −(평가감1 − 평가감0)
 *     직접비 dc   = −(직접비1 − 직접비0)
 *     영업비 opx  = −(영업비1 − 영업비0)
 *
 * 6개 합 = 실제 ΔOP (항등식). resid 는 부동소수 오차만 남는다.
 */

export const BASE_MONTH = 12;

export interface BrandDef { key: string; api: string; label: string }

export const BRIDGE_BRANDS: BrandDef[] = [
  { key: 'mlb',       api: 'mlb',       label: 'MLB' },
  { key: 'kids',      api: 'kids',      label: 'MLB KIDS' },
  { key: 'discovery', api: 'discovery', label: 'Discovery' },
  { key: 'duvetica',  api: 'duvetica',  label: 'Duvetica' },
  { key: 'supra',     api: 'supra',     label: 'SUPRA' },
];

export const BRAND_LABEL_MAP: Record<string, string> = Object.fromEntries(
  BRIDGE_BRANDS.map((b) => [b.key, b.label]),
);

export const ITEM_ORDER = ['vol', 'disc', 'cogs', 'vltn', 'dc', 'opx'] as const;
export type ItemKey = (typeof ITEM_ORDER)[number];

export const ITEM_LABEL: Record<ItemKey, string> = {
  vol: 'Tag매출', disc: '할인율',
  cogs: '매출원가율', vltn: '평가감', dc: '직접비', opx: '영업비',
};
export const ITEM_LABEL_SHORT: Record<ItemKey, string> = {
  vol: 'Tag매출', disc: '할인', cogs: '원가율', vltn: '평가감', dc: '직접비', opx: '영업비',
};

/* ── 포맷 ─────────────────────────────────────────────────── */

export const fmtK = (v: number | null | undefined): string =>
  v == null || !isFinite(v) ? '–' : Math.round(v / 1000).toLocaleString('ko-KR');

export const fmtKsigned = (v: number | null | undefined): string => {
  if (v == null || !isFinite(v)) return '–';
  const n = Math.round(v / 1000);
  if (n > 0) return '+' + n.toLocaleString('ko-KR');
  if (n < 0) return '−' + Math.abs(n).toLocaleString('ko-KR');
  return '0';
};

export const fmtPct = (v: number | null | undefined): string =>
  v == null || !isFinite(v) ? '–' : (v * 100).toFixed(1) + '%';

export const fmtPctSigned = (v: number | null | undefined): string => {
  if (v == null || !isFinite(v)) return '–';
  const p = v * 100;
  if (p > 0) return '+' + p.toFixed(1) + '%p';
  if (p < 0) return '−' + Math.abs(p).toFixed(1) + '%p';
  return '0.0%p';
};

/** 증감값의 색상 클래스 ('' = 색 없음) */
export const signCls = (v: number | null | undefined): string => {
  if (v == null || !isFinite(v)) return '';
  return v > 0 ? 'pos' : v < 0 ? 'neg' : '';
};

/* ── 데이터 추출 ──────────────────────────────────────────── */

export interface PLApiRow { account: string; values?: (number | null)[] }
export interface PLApiResponse { rows?: PLApiRow[] }

/** 손익 8개 라인의 연간 합계 (단위 위안) */
export interface Totals {
  tag: number | null; sales: number | null; cogs: number | null; vltn: number | null;
  gp: number | null; dc: number | null; opx: number | null; op: number | null;
}

export const TOTALS_FIELDS: (keyof Totals)[] = ['tag', 'sales', 'cogs', 'vltn', 'gp', 'dc', 'opx', 'op'];

function annualSum(rows: PLApiRow[] | undefined, account: string): number | null {
  const r = rows?.find((x) => x.account === account);
  if (!r || !Array.isArray(r.values)) return null;
  return r.values.reduce<number>((a, b) => a + (Number(b) || 0), 0);
}

export function extract(json: PLApiResponse | null | undefined): Totals {
  const rows = json?.rows;
  return {
    tag:   annualSum(rows, 'Tag매출'),
    sales: annualSum(rows, '실판매출'),
    cogs:  annualSum(rows, '매출원가'),
    vltn:  annualSum(rows, '평가감'),
    gp:    annualSum(rows, '매출총이익'),
    dc:    annualSum(rows, '직접비'),
    opx:   annualSum(rows, '영업비'),
    op:    annualSum(rows, '영업이익(관리식)'),
  };
}

/* ── Bridge 계산 ──────────────────────────────────────────── */

export interface BridgeResult {
  vol: number; disc: number; cogs: number; vltn: number; dc: number; opx: number;
  sum: number; deltaOP: number; resid: number;
  disc0: number; disc1: number;
}

/** null 은 0 으로 취급 — 원본 JS 의 산술 동작을 그대로 따른다 */
const n = (v: number | null | undefined): number => v ?? 0;

/** 부가세율 — Tag 는 V+, 실판·원가는 V− 이므로 비율 계산 시 환산한다 */
export const VAT = 1.13;

export function bridge(p0: Totals, p1: Totals): BridgeResult {
  // V+ 기준 할인율 / 원가율
  const disc0 = p0.tag ? 1 - (n(p0.sales) * VAT) / p0.tag : 0;
  const disc1 = p1.tag ? 1 - (n(p1.sales) * VAT) / p1.tag : 0;
  const rate0 = p0.tag ? (n(p0.cogs) * VAT) / p0.tag : 0;
  const rate1 = p1.tag ? (n(p1.cogs) * VAT) / p1.tag : 0;

  // 요인 금액은 이익 단위(V−) 로 환원 (÷ VAT)
  const vol = ((n(p1.tag) - n(p0.tag)) * (1 - disc0 - rate0)) / VAT;
  const disc = (n(p1.tag) * (disc0 - disc1)) / VAT;
  const cogs = (n(p1.tag) * (rate0 - rate1)) / VAT;

  const vltn = -(n(p1.vltn) - n(p0.vltn));
  const dc   = -(n(p1.dc)   - n(p0.dc));
  const opx  = -(n(p1.opx)  - n(p0.opx));

  const sum = vol + disc + cogs + vltn + dc + opx;
  const deltaOP = n(p1.op) - n(p0.op);
  return { vol, disc, cogs, vltn, dc, opx, sum, deltaOP, resid: deltaOP - sum, disc0, disc1 };
}

export interface BrandBridge { p0: Totals; p1: Totals; br: BridgeResult }
export type BrandData = Partial<Record<string, BrandBridge>>;

/** 5브랜드 합산 — 전 항목이 null 이면 null 반환 */
export function aggregateP(data: BrandData, key: 'p0' | 'p1'): Totals | null {
  const out: Totals = { tag: 0, sales: 0, cogs: 0, vltn: 0, gp: 0, dc: 0, opx: 0, op: 0 };
  let anyNonNull = false;
  for (const b of BRIDGE_BRANDS) {
    const p = data[b.key]?.[key];
    if (!p) continue;
    for (const f of TOTALS_FIELDS) {
      const v = p[f];
      if (v != null) { out[f] = (out[f] ?? 0) + v; anyNonNull = true; }
    }
  }
  return anyNonNull ? out : null;
}

/* ── API ──────────────────────────────────────────────────── */

export async function fetchPL(brandApi: string, year: number): Promise<PLApiResponse> {
  const url = brandApi === 'all'
    ? `/api/fs/pl?year=${year}&baseMonth=${BASE_MONTH}`
    : `/api/fs/pl/brand?brand=${brandApi}&year=${year}&baseMonth=${BASE_MONTH}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json();
}

/** 영업이익률 */
export const opMargin = (p: Totals): number | null =>
  p.sales ? n(p.op) / p.sales : null;
