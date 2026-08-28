/** 사업계획 화면 공통 정의 — 허브(카드)와 손익계산서가 같이 쓴다 */

export const YEAR = 2026;

export type BrandKey = 'all' | 'mlb' | 'kids' | 'discovery' | 'duvetica' | 'supra';

export interface BpBrand {
  key: BrandKey;
  label: string;
  primary?: boolean;
  /** 카드 제목 색 — 브랜드 구분용 */
  color: string;
}

export const BP_BRANDS: BpBrand[] = [
  { key: 'all', label: 'F&F CHINA', primary: true, color: '#15243B' },
  { key: 'mlb', label: 'MLB', color: '#1F5C8B' },
  { key: 'kids', label: 'MLB KIDS', color: '#2E7D5B' },
  { key: 'discovery', label: 'DISCOVERY', color: '#9C7A43' },
  { key: 'duvetica', label: 'DUVETICA', color: '#7A4B7F' },
  { key: 'supra', label: 'SUPRA', color: '#A9503B' },
];

/** 재무제표 대시보드와 동일한 PL API — 별도 계산 없이 그대로 사용 */
export function plUrl(brand: BrandKey, year: number, baseMonth: number): string {
  return brand === 'all'
    ? `/api/fs/pl?year=${year}&baseMonth=${baseMonth}`
    : `/api/fs/pl/brand?brand=${brand}&year=${year}&baseMonth=${baseMonth}`;
}

export interface PlRow {
  account: string;
  values?: (number | null)[];
  comparisons?: { prevYearAnnual?: number | null; currYearAnnual?: number | null };
}

/** 월별 값의 연간 합계 (null 은 건너뜀) */
export function annualSum(row?: PlRow): number | null {
  if (!row) return null;
  const vals = (row.values ?? []).filter((v): v is number => v != null);
  return vals.length ? vals.reduce((s, v) => s + v, 0) : null;
}

/** 위안 → K위안, 천단위 콤마 */
export function fmtK(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '–';
  const k = Math.round(v / 1000);
  return k === 0 ? '0' : k.toLocaleString('ko-KR');
}

/** 비율(%) — a ÷ b */
export function fmtRate(a: number | null | undefined, b: number | null | undefined): string {
  if (a == null || !b) return '–';
  return `${((a / b) * 100).toFixed(1)}%`;
}
