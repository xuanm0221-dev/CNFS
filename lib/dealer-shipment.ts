/**
 * 대리상 출고 FCST — 브랜드 × 시즌 월별 시리즈 (단위 K위안).
 *
 * 손익계산서의 "대리상 출고표"(DealerShipmentByBrand)와 사업계획 첫화면 브랜드 카드가
 * 같은 값을 쓰도록 계산을 여기로 모았다.
 *
 *   당년 시리즈: 1~latestActualMonth = Snowflake Tag매출 전처리(실적, 이미 K)
 *                그 이후        = 대리상출고계획 CSV (API가 CNY로 주므로 /1000)
 *   전년 시리즈: 전 구간 Snowflake Tag매출 전처리(실적)
 */

export type DealerShipmentBrand = 'MLB' | 'MLB KIDS' | 'DISCOVERY' | 'DUVETICA' | 'SUPRA';
export type DealerShipmentSeason = '당년S' | '당년F' | '1년차' | '차기시즌' | 'ACC';

export const DEALER_SHIPMENT_BRANDS: DealerShipmentBrand[] = [
  'MLB', 'MLB KIDS', 'DISCOVERY', 'DUVETICA', 'SUPRA',
];
export const DEALER_SHIPMENT_SEASONS: DealerShipmentSeason[] = [
  '당년S', '당년F', '1년차', '차기시즌', 'ACC',
];

export interface TagSalesBrandData {
  '직영': Record<string, (number | null)[]>;
  '대리상(ACC)': Record<string, (number | null)[]>;
  '대리상(의류)': Record<string, (number | null)[]>;
}

export interface TagSalesYearResponse {
  year?: number;
  brands?: Record<DealerShipmentBrand, TagSalesBrandData>;
}

export interface DealerShipmentPlanResponse {
  brands?: Record<DealerShipmentBrand, Record<DealerShipmentSeason, (number | null)[]>>;
}

export type SeasonSeries = Record<DealerShipmentSeason, (number | null)[]>;

export function empty12(): (number | null)[] {
  return new Array(12).fill(null);
}

export function emptySeasonMap(): SeasonSeries {
  return { 당년S: empty12(), 당년F: empty12(), '1년차': empty12(), 차기시즌: empty12(), ACC: empty12() };
}

/** minYear 이상 시즌(의류 태그 'yyS'/'yyF')만 합산 — 차기시즌 계산용 */
export function sumClothingByYearGte(
  clothing: Record<string, (number | null)[]>,
  minYear: number,
): (number | null)[] {
  const out: (number | null)[] = empty12();
  for (const [tag, series] of Object.entries(clothing)) {
    if (tag === '과시즌') continue;
    const m = tag.match(/^(\d{2})[SF]$/);
    if (!m) continue;
    const yr = Number(m[1]);
    if (!Number.isFinite(yr) || yr < minYear) continue;
    for (let i = 0; i < 12; i += 1) {
      const v = series[i] ?? null;
      if (v != null) out[i] = (out[i] ?? 0) + v;
    }
  }
  return out;
}

export function pairSum(a: (number | null)[], b: (number | null)[]): (number | null)[] {
  const out: (number | null)[] = empty12();
  for (let i = 0; i < 12; i += 1) {
    const va = a[i] ?? null;
    const vb = b[i] ?? null;
    if (va == null && vb == null) out[i] = null;
    else out[i] = (va ?? 0) + (vb ?? 0);
  }
  return out;
}

/** Tag매출 전처리 응답에서 한 연도의 브랜드×시즌 실적 시리즈를 뽑는다 (yy = 당년 두자리) */
function actualSeasonSeries(
  tag: TagSalesYearResponse | null | undefined,
  brand: DealerShipmentBrand,
  yy: number,
): SeasonSeries {
  const cloth = tag?.brands?.[brand]?.['대리상(의류)'] ?? {};
  const cur = (suffix: 'S' | 'F') => cloth[`${yy}${suffix}`] ?? empty12();
  const prev = (suffix: 'S' | 'F') => cloth[`${yy - 1}${suffix}`] ?? empty12();
  return {
    당년S: [...cur('S')],
    당년F: [...cur('F')],
    '1년차': pairSum(prev('S'), prev('F')),
    차기시즌: sumClothingByYearGte(cloth, yy + 1),
    ACC: [...(Object.values(tag?.brands?.[brand]?.['대리상(ACC)'] ?? {})[0] ?? empty12())],
  };
}

/**
 * 당년(계획 포함) 시리즈 — 실적월은 Snowflake, 이후는 출고계획 CSV.
 * @param yy 당년 두자리 (2026 → 26)
 */
export function buildCurrentYearSeries(
  tag: TagSalesYearResponse | null | undefined,
  plan: DealerShipmentPlanResponse | null | undefined,
  latestActualMonth: number,
  yy: number,
): Record<DealerShipmentBrand, SeasonSeries> {
  const out = {} as Record<DealerShipmentBrand, SeasonSeries>;
  for (const b of DEALER_SHIPMENT_BRANDS) {
    const actual = actualSeasonSeries(tag, b, yy);
    const csvBrand = plan?.brands?.[b];
    const result = emptySeasonMap();
    for (const season of DEALER_SHIPMENT_SEASONS) {
      const csvSeries = csvBrand?.[season] ?? empty12();
      for (let i = 0; i < 12; i += 1) {
        if (i < latestActualMonth) {
          result[season][i] = actual[season][i] ?? null;
        } else {
          const csvCny = csvSeries[i];
          result[season][i] = csvCny == null ? null : csvCny / 1000; // CNY → K
        }
      }
    }
    out[b] = result;
  }
  return out;
}

/** 전년 시리즈 — 전 구간 실적 */
export function buildPrevYearSeries(
  tag: TagSalesYearResponse | null | undefined,
  yy: number,
): Record<DealerShipmentBrand, SeasonSeries> {
  const out = {} as Record<DealerShipmentBrand, SeasonSeries>;
  for (const b of DEALER_SHIPMENT_BRANDS) out[b] = actualSeasonSeries(tag, b, yy);
  return out;
}

/** 12개월 합 — 전부 null 이면 null */
export function sumSeries(arr: (number | null)[]): number | null {
  let s = 0;
  let any = false;
  for (const v of arr) {
    if (v != null && Number.isFinite(v)) { s += v; any = true; }
  }
  return any ? s : null;
}
