/**
 * 2027 재고자산(sim) 합성 계산.
 *
 * 2027 은 실적(Snowflake) 데이터가 없으므로 전량 파생한다:
 *   - 리테일(대리상 sell-out / 직영 hqSales): **2026 월별 × 성장률**
 *       (MLB 만 성장, KIDS·DISCOVERY 는 2026 동일)
 *   - 공급(대리상 입고=OTB / 본사 매입 / 본사 출고): 2026 연간(오버레이 반영)과 동일 →
 *       2025(실적) 월별 패턴으로 12개월 배부
 *   - 기초재고 = 2026 기말재고 (시즌 aging)
 *   - 기말 = 기초 + 입고 − 판매(대리상) / 기초 + 매입 − 출고(본사) 롤포워드
 *
 * 반환:
 *   - dealer/hq: 상단 재고자산표(InventoryTableData, K 단위)
 *   - monthly/retail/shipment/purchase: 하위 섹션용 응답(원 단위, planFromMonth=1 → 전월 F)
 */
import type { AccKey, InventoryRowRaw, InventoryTableData, RowKey } from './inventory-types';
import { SEASON_KEYS, ACC_KEYS } from './inventory-types';
import { buildTableData, applyAccTargetWoiOverlay } from './inventory-calc';
import type { MonthlyStockResponse, MonthlyStockRow, MonthlyStockTableData } from './inventory-monthly-types';
import type { RetailSalesResponse, RetailSalesRow, RetailSalesTableData } from './retail-sales-types';
import type { ShipmentSalesResponse } from '@/app/api/inventory/shipment-sales/route';
import type { PurchaseResponse } from '@/app/api/inventory/purchase/route';

const LEAF_KEYS: RowKey[] = [...SEASON_KEYS, ...ACC_KEYS];
/** 2027 은 전량 예상 — closedThrough 를 실적 없음으로 표기 */
export const CLOSED_THROUGH_2027 = '202612';
/** 2027 OTB 제외 대상 = 과거 의류 시즌 (신규 발주 없음 → 입고=OTB=본사출고 0, 기존 재고만 판매) */
const OTB_PAST_SEASONS = new Set<string>(['1년차', '2년차', '과시즌']);
/** 본사 의류: 기말재고를 2026 동일 시즌 기말과 같게 고정 → 상품매입 역산 (그 외 시즌은 매입 고정) */
const HQ_TARGET_CLOSING_SEASONS = new Set<string>(['당년F', '당년S', '차기시즌']);

type LeafRow = InventoryTableData['rows'][number];
type Monthly = (number | null)[];

export interface Pattern2025 {
  shipment: Record<string, Monthly>;
  purchase: Record<string, Monthly>;
}

/** 2025 출고/매입 응답에서 rel-key 월별 패턴 맵 구성 */
export function buildPattern2025(shipment2025: ShipmentSalesResponse, purchase2025: PurchaseResponse): Pattern2025 {
  const idx = (rows: { key: string; monthly: Monthly }[] | undefined): Record<string, Monthly> =>
    Object.fromEntries((rows ?? []).map((r) => [r.key, r.monthly]));
  return {
    shipment: idx(shipment2025.data?.rows),
    purchase: idx(purchase2025.data?.rows),
  };
}

export interface Build2027BrandInput {
  brand: string;
  /** 2026 재고자산표 (finalize2026InventoryTopTable 결과 — 오버레이 반영, K) */
  basis2026: { dealer: InventoryTableData; hq: InventoryTableData };
  /** 2026 리테일 응답 (원) — 리테일 = 2026 월별 × 성장률 스케일용 */
  retail2026: RetailSalesResponse;
  /** 2025 공급 월별 패턴 */
  pattern2025: Pattern2025;
  dealerGrowthFactor: number;
  hqGrowthFactor: number;
  /** ACC 기말 목표 재고주수 (대리상/본사/본사 직영보유) — ACC 출고·매입 역산용 */
  accTargetWoiDealer: Record<AccKey, number>;
  accTargetWoiHq: Record<AccKey, number>;
  accHqHoldingWoi: Record<AccKey, number>;
}

export interface Build2027BrandResult {
  dealer: InventoryTableData;
  hq: InventoryTableData;
  monthly: MonthlyStockResponse;
  retail: RetailSalesResponse;
  shipment: ShipmentSalesResponse;
  purchase: PurchaseResponse;
}

/** 12개월 원본에서 배분 비중(합=1). 유효 양수합이 없으면 균등(1/12). */
function weightsFromMonthly(monthly: Monthly | undefined): number[] {
  const v = Array.from({ length: 12 }, (_, i) => {
    const x = monthly?.[i];
    return typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : 0;
  });
  const sum = v.reduce((s, x) => s + x, 0);
  if (sum <= 0) return new Array(12).fill(1 / 12);
  return v.map((x) => x / sum);
}

/** 연간값(K)을 비중으로 12개월 배부 */
function distribute(annualK: number, weights: number[]): number[] {
  return weights.map((w) => annualK * w);
}

/** 월별 배열(K) × 계수 */
function scaleMonthlyK(arr: number[] | undefined, f: number): number[] {
  return Array.from({ length: 12 }, (_, i) => (arr?.[i] ?? 0) * f);
}

function sum12(arrs: number[][]): number[] {
  const out = new Array(12).fill(0);
  for (const a of arrs) for (let i = 0; i < 12; i += 1) out[i] += a[i] ?? 0;
  return out;
}

function leafByKey(t: InventoryTableData): Map<string, LeafRow> {
  return new Map(t.rows.filter((r) => r.isLeaf).map((r) => [r.key, r]));
}

/**
 * 증감(delta)을 YoY 로 재정의: 2027 기말 − 2026 기말 (같은 시즌 라벨 기준).
 * 연내(기말−기초)가 아니라 전년 동(라벨) 시즌 기말재고 대비 변화.
 */
function applyYoyDelta(t2027: InventoryTableData, t2026: InventoryTableData): InventoryTableData {
  const closing2026 = new Map(t2026.rows.map((r) => [r.key, r.closing]));
  return {
    rows: t2027.rows.map((r) => ({ ...r, delta: r.closing - (closing2026.get(r.key) ?? 0) })),
  };
}

/**
 * 2027 기초(leaf, K) = 2026 기말 시즌 aging (의류는 한 시즌씩 나이 이동, ACC는 그대로):
 *   당년F/당년S(26F/26S) → 2027 1년차
 *   1년차 → 2년차 / 2년차 + 과시즌 → 과시즌
 *   차기시즌(27F+27S 선입고) → 2027 **당년S 전부** (사용자 지정: 임의 분리 없이 당년S로)
 *   차기시즌(2027) → 0 (28 시즌 재고 없음) / ACC → 동일 라벨 그대로
 */
function rollForwardOpening(basis: Map<string, LeafRow>): Record<string, number> {
  const c = (k: string) => basis.get(k)?.closing ?? 0;
  const next: Record<string, number> = {};
  next['당년F'] = 0;
  next['당년S'] = c('차기시즌');
  next['1년차'] = c('당년F') + c('당년S');
  next['2년차'] = c('1년차');
  next['과시즌'] = c('2년차') + c('과시즌');
  next['차기시즌'] = 0;
  for (const k of ACC_KEYS) next[k] = c(k);
  return next;
}

/** 대리상 롤포워드 잔액(K): bal[m] = (m=0? opening : bal[m-1]) + 입고[m] − 판매[m] */
function rollBalances(opening: number, sellIn: number[], sellOut: number[]): number[] {
  const out = new Array(12).fill(0);
  let prev = opening;
  for (let m = 0; m < 12; m += 1) {
    prev = prev + (sellIn[m] ?? 0) - (sellOut[m] ?? 0);
    out[m] = prev;
  }
  return out;
}

/** 본사 롤포워드 잔액(K): bal[m] = 기초 + 매입 − 대리상출고 − 직영판매(hqSales) */
function rollBalancesHq(opening: number, sellIn: number[], sellOut: number[], hqSales: number[]): number[] {
  const out = new Array(12).fill(0);
  let prev = opening;
  for (let m = 0; m < 12; m += 1) {
    prev = prev + (sellIn[m] ?? 0) - (sellOut[m] ?? 0) - (hqSales[m] ?? 0);
    out[m] = prev;
  }
  return out;
}

/** flow 응답 테이블(리테일/출고/매입 shape) — leaf K 배열 → 원 (합계·소계 포함) */
function buildFlowTable(totalKey: string, leafK: Record<string, number[]>): RetailSalesTableData {
  const toWon = (a: number[]): Monthly => a.map((v) => Math.round(v * 1000));
  const leaf = (key: string): RetailSalesRow => ({
    key,
    label: key,
    isTotal: false,
    isSubtotal: false,
    isLeaf: true,
    monthly: toWon(leafK[key] ?? new Array(12).fill(0)),
  });
  const clothingSum = sum12(SEASON_KEYS.map((k) => leafK[k] ?? new Array(12).fill(0)));
  const accSum = sum12(ACC_KEYS.map((k) => leafK[k] ?? new Array(12).fill(0)));
  const grand = sum12([clothingSum, accSum]);
  return {
    rows: [
      { key: totalKey, label: totalKey, isTotal: true, isSubtotal: false, isLeaf: false, monthly: toWon(grand) },
      { key: '의류합계', label: '의류합계', isTotal: false, isSubtotal: true, isLeaf: false, monthly: toWon(clothingSum) },
      ...SEASON_KEYS.map(leaf),
      { key: 'ACC합계', label: 'ACC합계', isTotal: false, isSubtotal: true, isLeaf: false, monthly: toWon(accSum) },
      ...ACC_KEYS.map(leaf),
    ],
  };
}

/** 재고잔액 응답 테이블(대리상/본사) — 잔액·기초 K → 원 (합계·소계 포함) */
function buildStockTable(balK: Record<string, number[]>, openingK: Record<string, number>): MonthlyStockTableData {
  const toWon = (a: number[]): Monthly => a.map((v) => Math.round(v * 1000));
  const openWon = (k: string) => Math.round((openingK[k] ?? 0) * 1000);
  const leaf = (key: string): MonthlyStockRow => ({
    key,
    label: key,
    isTotal: false,
    isSubtotal: false,
    isLeaf: true,
    opening: openWon(key),
    monthly: toWon(balK[key] ?? new Array(12).fill(0)),
  });
  const clothingSum = sum12(SEASON_KEYS.map((k) => balK[k] ?? new Array(12).fill(0)));
  const accSum = sum12(ACC_KEYS.map((k) => balK[k] ?? new Array(12).fill(0)));
  const grand = sum12([clothingSum, accSum]);
  const openClothing = SEASON_KEYS.reduce((s, k) => s + (openingK[k] ?? 0), 0);
  const openAcc = ACC_KEYS.reduce((s, k) => s + (openingK[k] ?? 0), 0);
  return {
    rows: [
      { key: '재고자산합계', label: '재고자산합계', isTotal: true, isSubtotal: false, isLeaf: false, opening: Math.round((openClothing + openAcc) * 1000), monthly: toWon(grand) },
      { key: '의류합계', label: '의류합계', isTotal: false, isSubtotal: true, isLeaf: false, opening: Math.round(openClothing * 1000), monthly: toWon(clothingSum) },
      ...SEASON_KEYS.map(leaf),
      { key: 'ACC합계', label: 'ACC합계', isTotal: false, isSubtotal: true, isLeaf: false, opening: Math.round(openAcc * 1000), monthly: toWon(accSum) },
      ...ACC_KEYS.map(leaf),
    ],
  };
}

/** 한 브랜드의 2027 재고자산표 + 하위섹션 응답 합성 */
export function build2027BrandTables(input: Build2027BrandInput): Build2027BrandResult {
  const {
    brand, basis2026, pattern2025, dealerGrowthFactor, hqGrowthFactor,
    accTargetWoiDealer, accTargetWoiHq, accHqHoldingWoi,
  } = input;
  const dLeaf = leafByKey(basis2026.dealer);
  const hLeaf = leafByKey(basis2026.hq);
  const openDealer = rollForwardOpening(dLeaf);
  const openHq = rollForwardOpening(hLeaf);

  // 1) 기준(base) 표 구성 — 의류/ACC 공통 롤포워드
  //    대리상 판매 = 2026 리테일 월별 × 성장 / 입고(OTB) = 2026 연간 → 2025 출고 패턴
  //    본사 매입/출고 = 2026 연간(의류=OTB, ACC=예비) → 2025 패턴 / 직영판매(hqSales) = 2026 월별 × 성장
  //    본사 기말 = 기초 + 매입 − 대리상출고 − 직영판매
  const dealerRaw: InventoryRowRaw[] = [];
  const hqRaw: InventoryRowRaw[] = [];
  for (const key of LEAF_KEYS) {
    const d26 = dLeaf.get(key);
    const h26 = hLeaf.get(key);

    // 과거 의류 시즌은 신규 발주(OTB) 없음 → 대리상 입고·본사 출고 0 (기존 재고만 판매)
    const isOtbPast = OTB_PAST_SEASONS.has(key);
    const dOpening = openDealer[key] ?? 0;
    const dSellOut = scaleMonthlyK(d26?.sellOut, dealerGrowthFactor);
    const dSellIn = isOtbPast ? new Array(12).fill(0) : distribute(d26?.sellInTotal ?? 0, weightsFromMonthly(pattern2025.shipment[key]));
    const dSellInT = dSellIn.reduce((a, b) => a + b, 0);
    const dSellOutT = dSellOut.reduce((a, b) => a + b, 0);
    dealerRaw.push({ key: key as RowKey, opening: dOpening, sellIn: dSellIn, sellOut: dSellOut, closing: dOpening + dSellInT - dSellOutT });

    const hOpening = openHq[key] ?? 0;
    const hSellOut = isOtbPast ? new Array(12).fill(0) : distribute(h26?.sellOutTotal ?? 0, weightsFromMonthly(pattern2025.shipment[key]));
    const hHqSales = scaleMonthlyK(h26?.hqSales, hqGrowthFactor);
    const hSellOutT = hSellOut.reduce((a, b) => a + b, 0);
    const hHqSalesT = hHqSales.reduce((a, b) => a + b, 0);
    // 당년F/당년S/차기시즌: 기말 = 2026 동일 시즌 본사 기말 고정 → 상품매입 역산.
    //   매입 = 목표기말 − 기초 + 대리상출고 + 직영판매 (음수면 0). 그 외 시즌: 매입 = 2026 고정.
    let hSellIn: number[];
    if (HQ_TARGET_CLOSING_SEASONS.has(key)) {
      const targetClosing = h26?.closing ?? 0;
      const rawSellInT = targetClosing - hOpening + hSellOutT + hHqSalesT;
      hSellIn = distribute(Math.max(0, rawSellInT), weightsFromMonthly(pattern2025.purchase[key]));
    } else {
      hSellIn = distribute(h26?.sellInTotal ?? 0, weightsFromMonthly(pattern2025.purchase[key]));
    }
    const hSellInT = hSellIn.reduce((a, b) => a + b, 0);
    const woiSellOut = dSellOut.map((v, i) => v + (hHqSales[i] ?? 0));
    hqRaw.push({ key: key as RowKey, opening: hOpening, sellIn: hSellIn, sellOut: hSellOut, closing: hOpening + hSellInT - hSellOutT - hHqSalesT, woiSellOut, hqSales: hHqSales });
  }

  // 리테일 = 표에 표시되는 값 그대로: 대리상 sell-out / 본사 직영판매(hqSales).
  //   → ACC 재고주수 역산의 "주매출"이 표시 컬럼과 정확히 일치하도록(별도 리테일 응답과의 미세차 제거).
  const retail2027: RetailSalesResponse = {
    year: 2027,
    brand,
    closedThrough: CLOSED_THROUGH_2027,
    dealer: buildFlowTable('매출합계', Object.fromEntries(dealerRaw.map((r) => [r.key, r.sellOut]))),
    hq: buildFlowTable('매출합계', Object.fromEntries(hqRaw.map((r) => [r.key, r.hqSales ?? new Array(12).fill(0)]))),
    planFromMonth: 1,
  };

  // 2) ACC 만 목표 재고주수로 역산 (2026 로직 그대로 재사용; 의류는 그대로).
  //    대리상 ACC 입고 = 목표기말(대리상주간매출×WOI) + 판매 − 기초.
  //    본사 ACC 출고 = 대리상 ACC 입고 / 본사 ACC 매입 = 목표기말(본사) 역산.
  const overlaid = applyAccTargetWoiOverlay(
    buildTableData(dealerRaw, 365),
    buildTableData(hqRaw, 365),
    retail2027,
    accTargetWoiDealer,
    accTargetWoiHq,
    accHqHoldingWoi,
    2027,
  );

  // 3) 최종표의 leaf 월별에서 하위섹션 응답 구성 (ACC 는 역산 반영값)
  const dFinal = leafByKey(overlaid.dealer);
  const hFinal = leafByKey(overlaid.hq);
  const dealerBalByKey: Record<string, number[]> = {};
  const hqBalByKey: Record<string, number[]> = {};
  const shipmentByKey: Record<string, number[]> = {};
  const purchaseByKey: Record<string, number[]> = {};
  const openDealerFinal: Record<string, number> = {};
  const openHqFinal: Record<string, number> = {};
  for (const key of LEAF_KEYS) {
    const dr = dFinal.get(key);
    const hr = hFinal.get(key);
    const dOpen = dr?.opening ?? (openDealer[key] ?? 0);
    const hOpen = hr?.opening ?? (openHq[key] ?? 0);
    openDealerFinal[key] = dOpen;
    openHqFinal[key] = hOpen;
    dealerBalByKey[key] = rollBalances(dOpen, dr?.sellIn ?? [], dr?.sellOut ?? []);
    hqBalByKey[key] = rollBalancesHq(hOpen, hr?.sellIn ?? [], hr?.sellOut ?? [], hr?.hqSales ?? []);
    shipmentByKey[key] = hr?.sellOut ?? new Array(12).fill(0);
    purchaseByKey[key] = hr?.sellIn ?? new Array(12).fill(0);
  }

  return {
    // 증감 = YoY (2027 기말 − 2026 기말, 같은 시즌 라벨)
    dealer: applyYoyDelta(overlaid.dealer, basis2026.dealer),
    hq: applyYoyDelta(overlaid.hq, basis2026.hq),
    monthly: {
      year: 2027,
      brand,
      closedThrough: CLOSED_THROUGH_2027,
      dealer: buildStockTable(dealerBalByKey, openDealerFinal),
      hq: buildStockTable(hqBalByKey, openHqFinal),
    },
    retail: retail2027,
    shipment: { year: 2027, brand, closedThrough: CLOSED_THROUGH_2027, data: buildFlowTable('출고매출합계', shipmentByKey) },
    purchase: { year: 2027, brand, closedThrough: CLOSED_THROUGH_2027, data: buildFlowTable('매입합계', purchaseByKey) },
  };
}
