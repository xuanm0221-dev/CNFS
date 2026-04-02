import type { RowKey } from './inventory-types';
import type { InventoryRowRaw, InventoryTableData } from './inventory-types';
import { buildTableData } from './inventory-calc';
import type { MonthlyStockResponse } from './inventory-monthly-types';
import type { RetailSalesResponse } from './retail-sales-types';
import type { ShipmentSalesResponse } from '@/app/api/inventory/shipment-sales/route';
import type { PurchaseResponse } from '@/app/api/inventory/purchase/route';

const LEAF_KEYS: RowKey[] = [
  '당년F',
  '당년S',
  '1년차',
  '2년차',
  '차기시즌',
  '과시즌',
  '신발',
  '모자',
  '가방',
  '기타',
];

function byKey<T extends { key: string }>(rows: T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const r of rows) map.set(r.key, r);
  return map;
}

/** API 1위안 → 상단 재고자산표는 K 단위 기대 */
function toK(v: number | null | undefined): number {
  return (v ?? 0) / 1000;
}

function to12Values(arr: (number | null)[]): number[] {
  return Array.from({ length: 12 }, (_, i) => arr[i] ?? 0);
}

/** 12개월 배열을 원 → K 변환 (상단 표용) */
function to12ValuesK(arr: (number | null)[]): number[] {
  return to12Values(arr).map((v) => v / 1000);
}

function calcYearDays(year: number): number {
  return (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 366 : 365;
}

/**
 * 2025·2026 상단 재고자산표용 데이터 구성 (이미 로드된 월별/리테일/출고/매입 데이터 재사용)
 * - 기초/기말: 월별 재고잔액 기초(전년 12월), 12월
 * - 대리상: Sell-in = 본사→대리상 출고 1~12월, Sell-out = 리테일 매출 대리상 1~12월
 * - 본사: 상품매입 = 본사 매입상품 1~12월 합계(purchaseData 있을 때), 대리상출고 = 본사→대리상 출고 1~12월
 *   - 본사 WOI 기준: 리테일 매출(본사) → woiSellOut으로 별도 전달
 * - API는 1위안 단위이므로 상단 표(K 기대)에 맞게 원→K 변환 후 전달
 */
export function buildTableDataFromMonthly(
  monthlyData: MonthlyStockResponse,
  retailData: RetailSalesResponse,
  shipmentData: ShipmentSalesResponse,
  purchaseData?: PurchaseResponse,
  year: number = 2025
): { dealer: InventoryTableData; hq: InventoryTableData } {
  const yearDays = calcYearDays(year);

  const dealerMonthly = byKey(monthlyData.dealer.rows);
  const hqMonthly = byKey(monthlyData.hq.rows);
  const dealerRetail = byKey(retailData.dealer.rows);
  const hqRetail = byKey(retailData.hq.rows);
  const shipment = byKey(shipmentData.data.rows);
  const purchase = purchaseData ? byKey(purchaseData.data.rows) : null;

  const dealerRaw: InventoryRowRaw[] = [];
  const hqRaw: InventoryRowRaw[] = [];

  for (const key of LEAF_KEYS) {
    const mDealer = dealerMonthly.get(key);
    const mHq = hqMonthly.get(key);
    const rDealer = dealerRetail.get(key);
    const rHq = hqRetail.get(key);
    const ship = shipment.get(key);
    const purch = purchase?.get(key);

    const openingDealer = toK(mDealer?.opening);
    const closingDealer = toK(mDealer?.monthly?.[11] ?? null);
    const sellInDealer = ship ? to12ValuesK(ship.monthly) : new Array(12).fill(0);

    // Sell-out = 대리상 리테일 매출 실적 (Snowflake FR), 없으면 기초 + Sell-in - 기말로 역산
    const dealerMonthlyK = mDealer
      ? to12Values(mDealer.monthly).map((v) => v / 1000)
      : new Array(12).fill(0);
    const sellOutDealer = rDealer
      ? to12ValuesK(rDealer.monthly)
      : sellInDealer.map((si, m) => {
          const prevClose = m === 0 ? openingDealer : dealerMonthlyK[m - 1];
          const thisClose = dealerMonthlyK[m];
          return prevClose + si - thisClose;
        });

    dealerRaw.push({
      key,
      opening: openingDealer,
      sellIn: sellInDealer,
      sellOut: sellOutDealer,  // = 기초 + Sell-in - 기말
      closing: closingDealer,
    });

    const openingHq = toK(mHq?.opening);
    const closingHq = toK(mHq?.monthly?.[11] ?? null);
    const sellInHq = purch ? to12ValuesK(purch.monthly) : new Array(12).fill(0);
    const sellOutHq = ship ? to12ValuesK(ship.monthly) : new Array(12).fill(0);
    // 본사 WOI: 주 매출 = (대리상 리테일 + 본사 리테일) 연간합 / (연도일수/7)
    const dealerRetailK = rDealer ? to12ValuesK(rDealer.monthly) : new Array(12).fill(0);
    const hqRetailK = rHq ? to12ValuesK(rHq.monthly) : new Array(12).fill(0);
    const woiSellOutHq = dealerRetailK.map((v, i) => v + (hqRetailK[i] ?? 0));

    hqRaw.push({
      key,
      opening: openingHq,
      sellIn: sellInHq,
      sellOut: sellOutHq,
      closing: closingHq,
      woiSellOut: woiSellOutHq,
      hqSales: hqRetailK,
    });
  }

  return {
    dealer: buildTableData(dealerRaw, yearDays),
    hq: buildTableData(hqRaw, yearDays),
  };
}
