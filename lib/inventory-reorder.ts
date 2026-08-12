// 리오더 추가 시뮬레이션 (MLB 전용)
// 본문 재고자산(sim)과 동일한 표에 reorder 컬럼만 추가하고, ACC 계산을 역방향으로 돌린다.
//   - 대리상: reorder = Sell-in 증가액 → 기말 = 기초 + Sell-in + reorder − Sell-out
//   - 본사  : reorder = 대리상출고 증가액 → 그만큼 상품매입도 증가 → 기말 불변
//             (표시상 기말 = 기초 + 상품매입 − 대리상출고 − reorder − 본사판매)
// 본문은 ACC 목표 재고주수로 Sell-in 을 역산하지만, 여기서는 리오더 효과를 그대로 노출한다.
import {
  InventoryRow,
  InventoryTableData,
  ACC_KEYS,
  SEASON_KEYS,
  AccKey,
} from './inventory-types';

/** MLB 대리상 리오더 물량 (CNY K). 값 변경 시 이 상수만 수정. */
export const MLB_REORDER_ACC_K: Record<AccKey, number> = {
  신발: 141_086,
  모자: 153_574,
  가방: 2_179,
  기타: 0,
};

/** 2026 = 윤년 */
const DEFAULT_YEAR_DAYS = 366;

/**
 * ACC 소분류 리오더 → 행 키별 리오더 맵.
 * 의류 행은 키를 만들지 않는다 (표에서 공란 = 0).
 */
export function buildReorderByRowKey(reorder: Record<AccKey, number>): Record<string, number> {
  const out: Record<string, number> = {};
  let accSum = 0;
  for (const k of ACC_KEYS) {
    const v = reorder[k] ?? 0;
    if (v !== 0) out[k] = v;
    accSum += v;
  }
  if (accSum !== 0) {
    out['ACC합계'] = accSum;
    out['재고자산합계'] = accSum;
  }
  return out;
}

/** WOI = 기말 / 주간판매 (주간판매 = woiSellOut 연간합 ÷ (연일수/7)) — 본문과 동일 공식 */
function calcWoi(closing: number, woiSellOut: number[], yearDays: number): number {
  const total = woiSellOut.reduce((s, v) => s + v, 0);
  const weekly = total / (yearDays / 7);
  return weekly > 0 ? closing / weekly : 0;
}

/** Sell-through 분모 — 본문 inventory-calc 와 동일 (의류만 기초+매입, 나머지는 매입) */
function stDenominator(key: string, opening: number, sellInTotal: number): number {
  if (key === '재고자산합계') return sellInTotal;
  if (key === '의류합계' || (SEASON_KEYS as string[]).includes(key)) return opening + sellInTotal;
  return sellInTotal;
}

/** Sell-through 분자 — 본사는 대리상출고+본사판매, 대리상은 sellOut */
function stNumerator(key: string, sellOutTotal: number, hqSalesTotal?: number): number {
  const isHqRowWithSales =
    (key === '의류합계'
      || (SEASON_KEYS as string[]).includes(key)
      || key === 'ACC합계'
      || key === '재고자산합계'
      || (ACC_KEYS as string[]).includes(key))
    && hqSalesTotal != null;
  return isHqRowWithSales ? sellOutTotal + (hqSalesTotal ?? 0) : sellOutTotal;
}

/**
 * 대리상 표에 리오더 반영.
 * Sell-in 컬럼은 본문값 그대로 두고 reorder 를 별도 컬럼으로 보여주되,
 * 기말·판매율·재고주수는 (Sell-in + reorder) 기준으로 계산한다.
 */
export function applyReorderDealer(
  data: InventoryTableData,
  reorderByKey: Record<string, number>,
  yearDays: number = DEFAULT_YEAR_DAYS,
): InventoryTableData {
  const rows: InventoryRow[] = data.rows.map((row) => {
    const r = reorderByKey[row.key] ?? 0;
    if (r === 0) return row;
    const closing = row.closing + r;
    const sellInEff = row.sellInTotal + r;
    const den = stDenominator(row.key, row.opening, sellInEff);
    const num = stNumerator(row.key, row.sellOutTotal, row.hqSalesTotal);
    return {
      ...row,
      closing,
      delta: closing - row.opening,
      sellThrough: den > 0 ? (num / den) * 100 : 0,
      woi: calcWoi(closing, row.woiSellOut, yearDays),
    };
  });
  return { rows };
}

/**
 * 본사 표에 리오더 반영 (방향 반대).
 * 대리상출고가 reorder 만큼 늘고 그만큼 상품매입도 늘어 기말은 불변.
 * → 상품매입 컬럼 값 자체를 올리고, 대리상출고 컬럼은 본문값 유지 + reorder 별도 표시.
 */
export function applyReorderHq(
  data: InventoryTableData,
  reorderByKey: Record<string, number>,
  yearDays: number = DEFAULT_YEAR_DAYS,
): InventoryTableData {
  const rows: InventoryRow[] = data.rows.map((row) => {
    const r = reorderByKey[row.key] ?? 0;
    if (r === 0) return row;
    const sellInTotal = row.sellInTotal + r; // 상품매입 증가
    const sellOutEff = row.sellOutTotal + r; // 대리상출고 실질 증가 (컬럼은 원값 + reorder 별도)
    const den = stDenominator(row.key, row.opening, sellInTotal);
    const num = stNumerator(row.key, sellOutEff, row.hqSalesTotal);
    return {
      ...row,
      sellInTotal,
      // 기말·증감 불변 (매입 증가분이 출고 증가분과 상쇄)
      sellThrough: den > 0 ? (num / den) * 100 : 0,
      woi: calcWoi(row.closing, row.woiSellOut, yearDays),
    };
  });
  return { rows };
}
