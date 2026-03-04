import { RetailSalesResponse, RetailSalesRow } from './retail-sales-types';

/** 2026년 기준: 2월부터 계획월 */
export const PLAN_FROM_MONTH = 2;

/**
 * 당년 실적 rows + 전년 rows를 받아, planFromMonth 이상 월은
 * 전년 동월 × factor 로 채운 rows를 반환한다.
 * grand total / subtotal도 재계산.
 */
export function mergePlanMonths(
  currRows: RetailSalesRow[],
  prevRows: RetailSalesRow[],
  planFromMonth: number,
  factor: number,
): RetailSalesRow[] {
  const prevByKey = new Map(prevRows.map((r) => [r.key, r]));
  const mergedLeafs = currRows
    .filter((r) => r.isLeaf)
    .map((row) => {
      const prev = prevByKey.get(row.key);
      const monthly = row.monthly.map((v, i) => {
        const month1 = i + 1;
        if (month1 < planFromMonth) return v;
        const prevVal = prev?.monthly[i] ?? null;
        return prevVal != null ? prevVal * factor : null;
      });
      return { ...row, monthly };
    });
  const clothingLeafs = mergedLeafs.slice(0, 6);
  const accLeafs = mergedLeafs.slice(6);
  const sumCol = (col: (number | null)[]): number | null => {
    const valid = col.filter((v): v is number => v != null);
    return valid.length > 0 ? valid.reduce((a, b) => a + b, 0) : null;
  };
  const clothingSubtotal: RetailSalesRow = {
    ...currRows[1],
    monthly: Array.from({ length: 12 }, (_, i) =>
      sumCol(clothingLeafs.map((r) => r.monthly[i])),
    ),
  };
  const accSubtotal: RetailSalesRow = {
    ...currRows[1 + 1 + 6],
    monthly: Array.from({ length: 12 }, (_, i) =>
      sumCol(accLeafs.map((r) => r.monthly[i])),
    ),
  };
  const grandTotal: RetailSalesRow = {
    ...currRows[0],
    monthly: Array.from({ length: 12 }, (_, i) => {
      const c = clothingSubtotal.monthly[i];
      const a = accSubtotal.monthly[i];
      if (c == null && a == null) return null;
      return (c ?? 0) + (a ?? 0);
    }),
  };
  return [
    grandTotal,
    clothingSubtotal,
    ...mergedLeafs.slice(0, 6),
    accSubtotal,
    ...mergedLeafs.slice(6),
  ];
}

/**
 * RetailSalesResponse에서 계획월(planFromMonth 이상) 값을 null로 strip.
 * 스냅샷 저장 전 실적월만 남기기 위해 사용.
 */
export function stripPlanMonths(
  data: RetailSalesResponse,
  planFromMonth: number,
): RetailSalesResponse {
  const stripRows = (rows: RetailSalesRow[]): RetailSalesRow[] =>
    rows.map((r) => ({
      ...r,
      monthly: r.monthly.map((v, i) => (i + 1 >= planFromMonth ? null : v)),
    }));
  return {
    ...data,
    dealer: { rows: stripRows(data.dealer.rows) },
    hq: { rows: stripRows(data.hq.rows) },
  };
}

/**
 * 스냅샷에서 로드한 실적 rows에 계획월을 동적으로 적용해
 * 완전한 RetailSalesResponse를 복원한다.
 */
export function applyPlanToSnapshot(
  retailActuals: RetailSalesResponse,
  retail2025: RetailSalesResponse,
  planFromMonth: number,
  growthRateDealer: number,
  growthRateHq: number,
): RetailSalesResponse {
  const factorDealer = 1 + growthRateDealer / 100;
  const factorHq = 1 + growthRateHq / 100;
  return {
    ...retailActuals,
    dealer: {
      rows: mergePlanMonths(
        retailActuals.dealer.rows,
        retail2025.dealer.rows,
        planFromMonth,
        factorDealer,
      ),
    },
    hq: {
      rows: mergePlanMonths(
        retailActuals.hq.rows,
        retail2025.hq.rows,
        planFromMonth,
        factorHq,
      ),
    },
    planFromMonth,
  };
}
