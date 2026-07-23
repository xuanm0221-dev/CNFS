import { InventoryRow, InventoryRowRaw, InventoryTableData, RowKey, AccKey } from './inventory-types';
import type { RetailSalesResponse } from './retail-sales-types';

const SEASON_KEYS: RowKey[] = ['당년F', '당년S', '1년차', '2년차', '차기시즌', '과시즌'];
const ACC_KEYS: RowKey[] = ['신발', '모자', '가방', '기타'];

const LABELS: Record<string, string> = {
  '당년F': '당년F',
  '당년S': '당년S',
  '1년차': '1년차',
  '2년차': '2년차',
  '차기시즌': '차기시즌',
  '과시즌': '과시즌',
  '신발': '신발',
  '모자': '모자',
  '가방': '가방',
  '기타': '기타',
  '의류합계': '의류합계',
  'ACC합계': 'ACC합계',
  '재고자산합계': '재고자산합계',
};

function sumArr(a: number[], b: number[]): number[] {
  return a.map((v, i) => v + (b[i] ?? 0));
}

/** Sell-through 분모: 의류는 기초+매입, 재고합계·ACC는 매입만 */
function sellThroughDenominator(
  key: string,
  opening: number,
  sellInTotal: number
): number {
  if (key === '재고자산합계') return sellInTotal;
  if (key === '의류합계' || SEASON_KEYS.includes(key as RowKey)) return opening + sellInTotal;
  // ACC합계, 신발, 모자, 가방, 기타
  return sellInTotal;
}

/** Sell-through 분자: 본사는 대리상출고+본사판매, 대리상은 sellOutTotal */
function sellThroughNumerator(
  key: string,
  sellOutTotal: number,
  hqSalesTotal?: number
): number {
  const isHqRowWithSales = (key === '의류합계' || SEASON_KEYS.includes(key as RowKey) || key === 'ACC합계' || key === '재고자산합계' || ACC_KEYS.includes(key as AccKey)) && hqSalesTotal != null;
  if (isHqRowWithSales) {
    return sellOutTotal + hqSalesTotal; // 본사: 대리상출고 + 본사판매
  }
  return sellOutTotal;
}

function calcRow(raw: InventoryRowRaw, yearDays: number): InventoryRow {
  const sellInTotal = raw.sellIn.reduce((s, v) => s + v, 0);
  const sellOutTotal = raw.sellOut.reduce((s, v) => s + v, 0);
  const delta = raw.closing - raw.opening;

  // Sell-through: 행 타입별 분모 적용. 본사 ACC는 분자=대리상출고+본사판매
  const stDenominator = sellThroughDenominator(raw.key, raw.opening, sellInTotal);
  const hqSalesTotal = raw.hqSales ? raw.hqSales.reduce((s, v) => s + v, 0) : undefined;
  const stNumerator = sellThroughNumerator(raw.key, sellOutTotal, hqSalesTotal);
  const sellThrough = stDenominator > 0 ? (stNumerator / stDenominator) * 100 : 0;

  // WOI: 기말재고 / 주매출 (주매출 = woiSellOut / (연도일수 / 7))
  const woiSellOut = raw.woiSellOut ?? raw.sellOut;
  const woiSellOutTotal = woiSellOut.reduce((s, v) => s + v, 0);
  const weeklyRate = woiSellOutTotal / (yearDays / 7);
  const woi = weeklyRate > 0 ? raw.closing / weeklyRate : 0;

  const hqSales = raw.hqSales;
  const hqSalesTotalForRow = hqSales ? hqSales.reduce((s, v) => s + v, 0) : undefined;

  return {
    key: raw.key,
    label: LABELS[raw.key] ?? raw.key,
    isTotal: false,
    isSubtotal: false,
    isLeaf: true,
    opening: raw.opening,
    sellIn: raw.sellIn,
    sellInTotal,
    sellOut: raw.sellOut,
    sellOutTotal,
    closing: raw.closing,
    delta,
    sellThrough,
    woi,
    woiSellOut,
    ...(hqSales && { hqSales, hqSalesTotal: hqSalesTotalForRow }),
  };
}

function calcSubtotal(
  key: string,
  rows: InventoryRow[],
  yearDays: number,
): InventoryRow {
  const opening = rows.reduce((s, r) => s + r.opening, 0);
  const closing = rows.reduce((s, r) => s + r.closing, 0);
  const sellIn = rows.reduce((acc, r) => sumArr(acc, r.sellIn), new Array(12).fill(0));
  const sellOut = rows.reduce((acc, r) => sumArr(acc, r.sellOut), new Array(12).fill(0));
  const woiSellOut = rows.reduce((acc, r) => sumArr(acc, r.woiSellOut), new Array(12).fill(0));
  const sellInTotal = sellIn.reduce((s, v) => s + v, 0);
  const sellOutTotal = sellOut.reduce((s, v) => s + v, 0);
  const woiSellOutTotal = woiSellOut.reduce((s, v) => s + v, 0);
  const delta = closing - opening;

  const hasHqSales = rows.every((r) => r.hqSales != null);
  const hqSales = hasHqSales
    ? rows.reduce((acc, r) => sumArr(acc, r.hqSales!), new Array(12).fill(0))
    : undefined;
  const hqSalesTotal = hqSales ? hqSales.reduce((s, v) => s + v, 0) : undefined;
  const stDenominator = sellThroughDenominator(key, opening, sellInTotal);
  const stNumerator = sellThroughNumerator(key, sellOutTotal, hqSalesTotal);
  const sellThrough = stDenominator > 0 ? (stNumerator / stDenominator) * 100 : 0;
  const weeklyRate = woiSellOutTotal / (yearDays / 7);
  const woi = weeklyRate > 0 ? closing / weeklyRate : 0;

  return {
    key,
    label: LABELS[key] ?? key,
    isTotal: key === '재고자산합계',
    isSubtotal: key !== '재고자산합계',
    isLeaf: false,
    opening,
    sellIn,
    sellInTotal,
    sellOut,
    sellOutTotal,
    closing,
    delta,
    sellThrough,
    woi,
    woiSellOut,
    ...(hqSales != null && hqSalesTotal != null && { hqSales, hqSalesTotal }),
  };
}

export function buildTableData(rawRows: InventoryRowRaw[], yearDays: number = 365): InventoryTableData {
  const byKey = Object.fromEntries(rawRows.map((r) => [r.key, calcRow(r, yearDays)]));

  const clothingLeafs = SEASON_KEYS.map((k) => byKey[k]).filter(Boolean);
  const accLeafs = ACC_KEYS.map((k) => byKey[k]).filter(Boolean);

  const clothingSubtotal = calcSubtotal('의류합계', clothingLeafs, yearDays);
  const accSubtotal = calcSubtotal('ACC합계', accLeafs, yearDays);
  const grandTotal = calcSubtotal('재고자산합계', [clothingSubtotal, accSubtotal], yearDays);

  const rows: InventoryRow[] = [
    grandTotal,
    clothingSubtotal,
    ...clothingLeafs,
    accSubtotal,
    ...accLeafs,
  ];

  return { rows };
}

export function formatK(value: number): string {
  if (value === 0) return '-';
  return `${Math.round(value).toLocaleString()}K`;
}

/** 재고자산표 셀용: K 접미사 없이 숫자만 (제목에 CNY K 표기 시 사용) */
export function formatKValue(value: number): string {
  if (value === 0) return '-';
  return Math.round(value).toLocaleString();
}

export function formatPct(value: number): string {
  if (value === 0) return '-';
  return `${value.toFixed(1)}%`;
}

export function formatWoi(value: number): string {
  if (value === 0) return '-';
  return `${value.toFixed(1)}주`;
}

function calcYearDays(year: number): number {
  return (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 366 : 365;
}

/** retailData 월별 합 → 연간 리테일(K). API는 1위안 단위이므로 /1000 */
function getAnnualRetailK(rows: { key: string; monthly?: (number | null)[] | null }[], key: string): number {
  const row = rows.find((r) => r.key === key);
  if (!row) return 0;
  return (row.monthly ?? []).reduce<number>((s, v) => s + (v ?? 0), 0) / 1000;
}

/** 목표 기말에 맞춰 sellInTotal 역산 후 월별 비율로 재분배 */
function applyTargetClosingToAccRow(
  row: InventoryRow,
  targetClosing: number,
  targetWoi: number,
  yearDays: number
): InventoryRow {
  const newSellInTotal = targetClosing + row.sellOutTotal - row.opening;
  let sellIn: number[];
  const prevTotal = row.sellInTotal;
  if (newSellInTotal <= 0) {
    sellIn = new Array(12).fill(0);
  } else if (prevTotal > 0) {
    const scale = newSellInTotal / prevTotal;
    sellIn = row.sellIn.map((v) => Math.round(v * scale));
    const sum = sellIn.reduce((s, v) => s + v, 0);
    if (sum !== newSellInTotal) sellIn[11] += newSellInTotal - sum;
  } else {
    sellIn = new Array(12).fill(0);
    const perMonth = Math.floor(newSellInTotal / 12);
    for (let i = 0; i < 12; i++) sellIn[i] = perMonth;
    sellIn[11] += newSellInTotal - perMonth * 12;
  }
  const delta = targetClosing - row.opening;
  const stDenom = sellThroughDenominator(row.key, row.opening, newSellInTotal);
  const sellThrough = stDenom > 0 ? (row.sellOutTotal / stDenom) * 100 : 0;
  return {
    ...row,
    sellIn,
    sellInTotal: newSellInTotal,
    closing: targetClosing,
    delta,
    sellThrough,
    woi: targetWoi,
  };
}

/**
 * 2026년 ACC만: 목표 재고주수 × 주간매출 → 기말 목표 재고 반영
 * - 대리상 주간매출 = 대리상 연간 리테일(K) / (yearDays/7)
 * - 본사 기말 = 직영판매용(본사주간매출×accHqHoldingWoi) + 대리상출고예정(대리상주간매출×accTargetWoiHq)
 */
export function applyAccTargetWoiOverlay(
  dealer: InventoryTableData,
  hq: InventoryTableData,
  retailData: RetailSalesResponse,
  accTargetWoiDealer: Record<AccKey, number>,
  accTargetWoiHq: Record<AccKey, number>,
  accHqHoldingWoi: Record<AccKey, number>,
  year: number
): { dealer: InventoryTableData; hq: InventoryTableData } {
  if (year !== 2026 && year !== 2027) return { dealer, hq };
  const yearDays = calcYearDays(year);

  const dealerByKey = Object.fromEntries(
    dealer.rows.filter((r) => r.isLeaf).map((r) => [r.key, r])
  ) as Record<string, InventoryRow>;
  const hqByKey = Object.fromEntries(
    hq.rows.filter((r) => r.isLeaf).map((r) => [r.key, r])
  ) as Record<string, InventoryRow>;

  function scaleSellToTotal(sell: number[], newTotal: number): number[] {
    const prevTotal = sell.reduce((s, v) => s + v, 0);
    if (newTotal <= 0) return new Array(12).fill(0);
    if (prevTotal > 0) {
      const scale = newTotal / prevTotal;
      const out = sell.map((v) => Math.round(v * scale));
      const sum = out.reduce((s, v) => s + v, 0);
      if (sum !== newTotal) out[11] += newTotal - sum;
      return out;
    }
    const perMonth = Math.floor(newTotal / 12);
    const out = new Array(12).fill(perMonth);
    out[11] += newTotal - perMonth * 12;
    return out;
  }

  for (const key of ACC_KEYS as AccKey[]) {
    const dealerAnnualK = getAnnualRetailK(retailData.dealer.rows, key);
    const hqAnnualK = getAnnualRetailK(retailData.hq.rows, key);
    const dealerWeekly = dealerAnnualK / (yearDays / 7);
    const hqWeekly = hqAnnualK / (yearDays / 7);

    const targetClosingDealer = Math.round(dealerWeekly * accTargetWoiDealer[key]);

    // 1. 대리상 처리 — 먼저 완료하여 Sell-in 결과를 HQ 대리상출고에 사용
    const dRow = dealerByKey[key];
    if (dRow) {
      dealerByKey[key] = applyTargetClosingToAccRow(
        dRow,
        targetClosingDealer,
        accTargetWoiDealer[key],
        yearDays
      );
    }
    const dealerSellInTotal = dealerByKey[key]?.sellInTotal ?? 0;

    // 2. 본사 기말재고 2단계 계산
    //    step1: 직영 판매용 재고 = 본사 주간매출 × 직영 보유주수(accHqHoldingWoi)
    //    step2: 대리상 출고예정 버퍼 = 대리상 주간매출 × 본사 목표재고주수(accTargetWoiHq)
    //    본사 대리상출고 = 대리상 ACC Sell-in (step2와 별도)
    const hRow = hqByKey[key];
    if (hRow) {
      const step1 = Math.round(hqWeekly * accHqHoldingWoi[key]);
      const step2 = Math.round(dealerWeekly * accTargetWoiHq[key]);
      const targetClosingHq = step1 + step2;
      // 본사 대리상출고 = 대리상 ACC Sell-in 결과값
      const newSellOutHq = dealerSellInTotal;
      const hqSalesTotal = hRow.hqSalesTotal ?? 0;
      // 본사 의류매입 = 기말(목표) + 대리상출고 + 본사판매 − 기초
      const rawSellInHq = targetClosingHq + newSellOutHq + hqSalesTotal - hRow.opening;

      // 매입이 음수면(기초재고로 충분) 매입=0, 기말은 실제 공식으로 재계산
      const newSellInHq = Math.max(0, rawSellInHq);
      const actualClosingHq =
        rawSellInHq >= 0
          ? targetClosingHq
          : Math.max(0, hRow.opening + newSellInHq - newSellOutHq - hqSalesTotal);

      const sellOut = scaleSellToTotal(hRow.sellOut, newSellOutHq);
      const sellIn = scaleSellToTotal(hRow.sellIn, newSellInHq);
      const delta = actualClosingHq - hRow.opening;
      const stDenom = sellThroughDenominator(hRow.key, hRow.opening, newSellInHq);
      const stNum = sellThroughNumerator(hRow.key, newSellOutHq, hqSalesTotal);
      const sellThrough = stDenom > 0 ? (stNum / stDenom) * 100 : 0;
      // WOI 표시: 기말 / 대리상주간매출 (대리상 출고예정 재고 기준)
      const woiWeekly = dealerWeekly > 0 ? dealerWeekly : 1;
      const actualWoi = actualClosingHq / woiWeekly;

      hqByKey[key] = {
        ...hRow,
        sellIn,
        sellInTotal: newSellInHq,
        sellOut,
        sellOutTotal: newSellOutHq,
        closing: actualClosingHq,
        delta,
        sellThrough,
        woi: rawSellInHq >= 0 ? accTargetWoiHq[key] : actualWoi,
      };
    }
  }

  const leafRowOrder = [...SEASON_KEYS, ...ACC_KEYS];
  const dealerLeafs = leafRowOrder.map((k) => dealerByKey[k]!);
  const hqLeafs = leafRowOrder.map((k) => hqByKey[k]!);
  const dealerRows = rebuildTableFromLeafs(dealerLeafs, yearDays);
  const hqRows = rebuildTableFromLeafs(hqLeafs, yearDays);

  return {
    dealer: { rows: dealerRows },
    hq: { rows: hqRows },
  };
}

const LEAF_ROW_ORDER: RowKey[] = ['당년F', '당년S', '1년차', '2년차', '차기시즌', '과시즌', '신발', '모자', '가방', '기타'];

/** 2026년만: 본사 의류매입·대리상출고 계획 오버레이. 본사 대리상출고 = 대리상 Sell-in 반영. */
export function applyHqSellInSellOutPlanOverlay(
  dealer: InventoryTableData,
  hq: InventoryTableData,
  hqSellInPlan: Partial<Record<RowKey, number>>,
  hqSellOutPlan: Partial<Record<RowKey, number>>,
  year: number
): { dealer: InventoryTableData; hq: InventoryTableData } {
  if (year !== 2026) return { dealer, hq };
  const yearDays = calcYearDays(year);

  const dealerByKey = Object.fromEntries(
    dealer.rows.filter((r) => r.isLeaf).map((r) => [r.key, r])
  ) as Record<string, InventoryRow>;
  const hqByKey = Object.fromEntries(
    hq.rows.filter((r) => r.isLeaf).map((r) => [r.key, r])
  ) as Record<string, InventoryRow>;

  function scaleSellToTotal(sell: number[], newTotal: number): number[] {
    const prevTotal = sell.reduce((s, v) => s + v, 0);
    if (newTotal <= 0) return new Array(12).fill(0);
    if (prevTotal > 0) {
      const scale = newTotal / prevTotal;
      const out = sell.map((v) => Math.round(v * scale));
      const sum = out.reduce((s, v) => s + v, 0);
      if (sum !== newTotal) out[11] += newTotal - sum;
      return out;
    }
    const perMonth = Math.floor(newTotal / 12);
    const out = new Array(12).fill(perMonth);
    out[11] += newTotal - perMonth * 12;
    return out;
  }

  // 본사: plan에 있으면 sellInTotal/sellOutTotal 덮어쓰고 기말 = 기초 + 매입 - 대리상출고 - 본사판매
  for (const key of LEAF_ROW_ORDER) {
    const row = hqByKey[key];
    if (!row) continue;
    const planSellIn = hqSellInPlan[key as RowKey];
    const planSellOut = hqSellOutPlan[key as RowKey];
    const hasOverride = planSellIn != null || planSellOut != null;
    if (!hasOverride) continue;

    const newSellInTotal = planSellIn ?? row.sellInTotal;
    const newSellOutTotal = planSellOut ?? row.sellOutTotal;

    const sellIn = scaleSellToTotal(row.sellIn, newSellInTotal);
    const sellOut = scaleSellToTotal(row.sellOut, newSellOutTotal);
    const hqSalesTotal = row.hqSalesTotal ?? 0;
    const closing = Math.round(row.opening + newSellInTotal - newSellOutTotal - hqSalesTotal);
    const delta = closing - row.opening;
    const stDenom = sellThroughDenominator(row.key, row.opening, newSellInTotal);
    const stNum = sellThroughNumerator(row.key, newSellOutTotal, hqSalesTotal);
    const sellThrough = stDenom > 0 ? (stNum / stDenom) * 100 : 0;
    const woiSellOutTotal = row.woiSellOut.reduce((s, v) => s + v, 0);
    const weeklyRate = woiSellOutTotal / (yearDays / 7);
    const woi = weeklyRate > 0 ? closing / weeklyRate : 0;

    hqByKey[key] = {
      ...row,
      sellIn,
      sellInTotal: newSellInTotal,
      sellOut,
      sellOutTotal: newSellOutTotal,
      closing,
      delta,
      sellThrough,
      woi,
    };
  }

  // 대리상: hqSellOutPlan에 있으면 해당 행의 Sell-in = 그 값, 기말 = 기초 + Sell-in - Sell-out
  for (const key of LEAF_ROW_ORDER) {
    const planSellOut = hqSellOutPlan[key as RowKey];
    if (planSellOut == null) continue;
    const row = dealerByKey[key];
    if (!row) continue;

    const sellIn = scaleSellToTotal(row.sellIn, planSellOut);
    const closing = Math.round(row.opening + planSellOut - row.sellOutTotal);
    const delta = closing - row.opening;
    const stDenom = sellThroughDenominator(row.key, row.opening, planSellOut);
    const sellThrough = stDenom > 0 ? (row.sellOutTotal / stDenom) * 100 : 0;
    const weeklyRate = row.sellOutTotal / (yearDays / 7);
    const woi = weeklyRate > 0 ? closing / weeklyRate : 0;

    dealerByKey[key] = {
      ...row,
      sellIn,
      sellInTotal: planSellOut,
      closing,
      delta,
      sellThrough,
      woi,
    };
  }

  const dealerLeafs = LEAF_ROW_ORDER.map((k) => dealerByKey[k]!);
  const hqLeafs = LEAF_ROW_ORDER.map((k) => hqByKey[k]!);
  return {
    dealer: { rows: rebuildTableFromLeafs(dealerLeafs, yearDays) },
    hq: { rows: rebuildTableFromLeafs(hqLeafs, yearDays) },
  };
}

// 2026년 역산: 목표 재고주수 → 목표 기말재고 → 필요 매입(Sell-in)
// 대리상용: sellOut = POS 판매계획
export function applyTargetWOI(
  raw2025: InventoryRowRaw[],
  targetWOI: number,
  growthRate: number,
  yearDays: number = 365
): InventoryRowRaw[] {
  const factor = 1 + growthRate / 100;
  return raw2025.map((r) => {
    const opening = r.closing;
    const sellOut = r.sellOut.map((v) => Math.round(v * factor));
    const sellOutTotal = sellOut.reduce((s, v) => s + v, 0);
    const weeklyRate = sellOutTotal / (yearDays / 7);
    const targetClosing = weeklyRate > 0 ? Math.round(weeklyRate * targetWOI) : 0;
    const requiredSellInTotal = targetClosing + sellOutTotal - opening;

    let sellIn: number[];
    const prevSellInTotal = r.sellIn.reduce((s, v) => s + v, 0);
    if (requiredSellInTotal <= 0) {
      sellIn = new Array(12).fill(0);
    } else if (prevSellInTotal > 0) {
      const scale = requiredSellInTotal / prevSellInTotal;
      sellIn = r.sellIn.map((v) => Math.round(v * scale));
      const sum = sellIn.reduce((s, v) => s + v, 0);
      if (sum !== requiredSellInTotal) {
        sellIn[11] += requiredSellInTotal - sum;
      }
    } else {
      sellIn = new Array(12).fill(0);
      const perMonth = Math.floor(requiredSellInTotal / 12);
      for (let i = 0; i < 12; i++) sellIn[i] = perMonth;
      sellIn[11] += requiredSellInTotal - perMonth * 12;
    }

    return {
      key: r.key,
      opening,
      sellIn,
      sellOut,
      closing: targetClosing,
    };
  });
}

// 본사용: sellOut = 대리상 sellIn (본사→대리상 출고)
export function applyTargetWOIForHq(
  raw2025: InventoryRowRaw[],
  dealerRaw2026: InventoryRowRaw[],
  targetHqWOI: number,
  yearDays: number = 365
): InventoryRowRaw[] {
  const byKey = Object.fromEntries(dealerRaw2026.map((r) => [r.key, r]));
  return raw2025.map((r) => {
    const opening = r.closing;
    const dealerRow = byKey[r.key];
    const sellOut = dealerRow ? dealerRow.sellIn : new Array(12).fill(0);
    const sellOutTotal = sellOut.reduce((s, v) => s + v, 0);
    const weeklyRate = sellOutTotal / (yearDays / 7);
    const targetClosing = weeklyRate > 0 ? Math.round(weeklyRate * targetHqWOI) : 0;
    const requiredSellInTotal = targetClosing + sellOutTotal - opening;

    let sellIn: number[];
    const prevSellInTotal = r.sellIn.reduce((s, v) => s + v, 0);
    if (requiredSellInTotal <= 0) {
      sellIn = new Array(12).fill(0);
    } else if (prevSellInTotal > 0) {
      const scale = requiredSellInTotal / prevSellInTotal;
      sellIn = r.sellIn.map((v) => Math.round(v * scale));
      const sum = sellIn.reduce((s, v) => s + v, 0);
      if (sum !== requiredSellInTotal) {
        sellIn[11] += requiredSellInTotal - sum;
      }
    } else {
      sellIn = new Array(12).fill(0);
      const perMonth = Math.floor(requiredSellInTotal / 12);
      for (let i = 0; i < 12; i++) sellIn[i] = perMonth;
      sellIn[11] += requiredSellInTotal - perMonth * 12;
    }

    return {
      key: r.key,
      opening,
      sellIn,
      sellOut,
      closing: targetClosing,
    };
  });
}

// 표 내 WOI 편집 시 역산 (2026년)
function recalcLeafFromWoi(row: InventoryRow, newWoi: number, yearDays: number = 365): InventoryRow {
  if (!row.isLeaf) return row;
  const sellOutTotal = row.sellOutTotal;
  const weeklyRate = sellOutTotal / (yearDays / 7);
  const newClosing = weeklyRate > 0 ? Math.round(weeklyRate * newWoi) : 0;
  const newSellInTotal = newClosing + sellOutTotal - row.opening;

  let sellIn: number[];
  const prevTotal = row.sellInTotal;
  if (newSellInTotal <= 0) {
    sellIn = new Array(12).fill(0);
  } else if (prevTotal > 0) {
    const scale = newSellInTotal / prevTotal;
    sellIn = row.sellIn.map((v) => Math.round(v * scale));
    const sum = sellIn.reduce((s, v) => s + v, 0);
    if (sum !== newSellInTotal) sellIn[11] += newSellInTotal - sum;
  } else {
    sellIn = new Array(12).fill(0);
    const perMonth = Math.floor(newSellInTotal / 12);
    for (let i = 0; i < 12; i++) sellIn[i] = perMonth;
    sellIn[11] += newSellInTotal - perMonth * 12;
  }

  const delta = newClosing - row.opening;
  const stDenom = sellThroughDenominator(row.key, row.opening, newSellInTotal);
  const stNum = sellThroughNumerator(row.key, sellOutTotal, row.hqSalesTotal);
  const sellThrough = stDenom > 0 ? (stNum / stDenom) * 100 : 0;

  return {
    ...row,
    sellIn,
    sellInTotal: newSellInTotal,
    closing: newClosing,
    delta,
    sellThrough,
    woi: newWoi,
  };
}

export function rebuildTableFromLeafs(leafRows: InventoryRow[], yearDays: number = 365): InventoryRow[] {
  const clothingLeafs = SEASON_KEYS.map((k) => leafRows.find((r) => r.key === k)).filter(Boolean) as InventoryRow[];
  const accLeafs = ACC_KEYS.map((k) => leafRows.find((r) => r.key === k)).filter(Boolean) as InventoryRow[];
  const clothingSubtotal = calcSubtotal('의류합계', clothingLeafs, yearDays);
  const accSubtotal = calcSubtotal('ACC합계', accLeafs, yearDays);
  const grandTotal = calcSubtotal('재고자산합계', [clothingSubtotal, accSubtotal], yearDays);
  return [grandTotal, clothingSubtotal, ...clothingLeafs, accSubtotal, ...accLeafs];
}

export function recalcOnDealerWoiChange(
  data: { dealer: InventoryTableData; hq: InventoryTableData },
  rowKey: string,
  newWoi: number
): { dealer: InventoryTableData; hq: InventoryTableData } {
  const leafRows = [...SEASON_KEYS, ...ACC_KEYS];
  const dealerByKey = Object.fromEntries(
    data.dealer.rows.filter((r) => r.isLeaf).map((r) => [r.key, r])
  );
  const hqByKey = Object.fromEntries(
    data.hq.rows.filter((r) => r.isLeaf).map((r) => [r.key, r])
  );

  const updatedDealerLeaf = recalcLeafFromWoi(dealerByKey[rowKey]!, newWoi, 366);
  dealerByKey[rowKey] = updatedDealerLeaf;
  const newDealerLeafs = leafRows.map((k) => dealerByKey[k]!);
  const dealerRows = rebuildTableFromLeafs(newDealerLeafs, 366);

  // HQ sellOut = dealer sellIn; HQ 해당 행 갱신
  const hqRow = hqByKey[rowKey];
  if (hqRow) {
    const sellOut = updatedDealerLeaf.sellIn;
    const sellOutTotal = sellOut.reduce((s, v) => s + v, 0);
    const weeklyRate = sellOutTotal / (366 / 7);
    const newClosing = weeklyRate > 0 ? Math.round(weeklyRate * hqRow.woi) : 0;
    const newSellInTotal = newClosing + sellOutTotal - hqRow.opening;

    let sellIn: number[];
    const prevTotal = hqRow.sellInTotal;
    if (newSellInTotal <= 0) {
      sellIn = new Array(12).fill(0);
    } else if (prevTotal > 0) {
      const scale = newSellInTotal / prevTotal;
      sellIn = hqRow.sellIn.map((v) => Math.round(v * scale));
      const sum = sellIn.reduce((s, v) => s + v, 0);
      if (sum !== newSellInTotal) sellIn[11] += newSellInTotal - sum;
    } else {
      sellIn = new Array(12).fill(0);
      const perMonth = Math.floor(newSellInTotal / 12);
      for (let i = 0; i < 12; i++) sellIn[i] = perMonth;
      sellIn[11] += newSellInTotal - perMonth * 12;
    }

    const stDenom = sellThroughDenominator(rowKey, hqRow.opening, newSellInTotal);
    const stNum = sellThroughNumerator(rowKey, sellOutTotal, hqRow.hqSalesTotal);
    hqByKey[rowKey] = {
      ...hqRow,
      sellOut,
      sellOutTotal,
      sellIn,
      sellInTotal: newSellInTotal,
      closing: newClosing,
      delta: newClosing - hqRow.opening,
      sellThrough: stDenom > 0 ? (stNum / stDenom) * 100 : 0,
    };
  }
  const newHqLeafs = leafRows.map((k) => hqByKey[k]!);
  const hqRows = rebuildTableFromLeafs(newHqLeafs, 366);

  return {
    dealer: { rows: dealerRows },
    hq: { rows: hqRows },
  };
}

export function recalcOnHqWoiChange(
  data: { dealer: InventoryTableData; hq: InventoryTableData },
  rowKey: string,
  newWoi: number
): { dealer: InventoryTableData; hq: InventoryTableData } {
  const leafRows = [...SEASON_KEYS, ...ACC_KEYS];
  const hqByKey = Object.fromEntries(
    data.hq.rows.filter((r) => r.isLeaf).map((r) => [r.key, r])
  );

  const updatedHqLeaf = recalcLeafFromWoi(hqByKey[rowKey]!, newWoi, 366);
  hqByKey[rowKey] = updatedHqLeaf;
  const newHqLeafs = leafRows.map((k) => hqByKey[k]!);
  return {
    ...data,
    hq: { rows: rebuildTableFromLeafs(newHqLeafs, 366) },
  };
}
