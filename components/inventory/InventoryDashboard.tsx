'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Brand, InventoryApiResponse, InventoryTableData, InventoryRowRaw, AccKey, ACC_KEYS, SEASON_KEYS, RowKey } from '@/lib/inventory-types';
import { MonthlyStockResponse } from '@/lib/inventory-monthly-types';
import { RetailSalesResponse, RetailSalesRow } from '@/lib/retail-sales-types';
import type { ShipmentSalesResponse } from '@/app/api/inventory/shipment-sales/route';
import type { PurchaseResponse } from '@/app/api/inventory/purchase/route';
import { buildTableDataFromMonthly } from '@/lib/build-inventory-from-monthly';
import { buildTableData, applyAccTargetWoiOverlay, applyHqSellInSellOutPlanOverlay } from '@/lib/inventory-calc';
import {
  saveSnapshot,
  loadSnapshot,
  type SnapshotData,
} from '@/lib/inventory-snapshot';
import { stripPlanMonths, applyPlanToSnapshot, mergePlanMonths, PLAN_FROM_MONTH } from '@/lib/retail-plan';
import {
  BRANDS_TO_AGGREGATE,
  aggregateMonthlyStock,
  aggregateRetailSales,
  aggregateShipmentSales,
  aggregatePurchase,
} from '@/lib/aggregate-inventory-by-brand';
import InventoryFilterBar, { GrowthRateControl } from './InventoryFilterBar';
import InventoryTable from './InventoryTable';
import InventoryMonthlyTable, { TableData } from './InventoryMonthlyTable';

type LeafBrand = Exclude<Brand, '전체'>;
type TopTablePair = { dealer: InventoryTableData; hq: InventoryTableData };
const ANNUAL_SHIPMENT_PLAN_KEY = 'inv_annual_shipment_plan_2026_v1';
const INVENTORY_HQ_CLOSING_KEY = 'inventory_hq_closing_totals';
const INVENTORY_MONTHLY_TOTAL_KEY = 'inventory_monthly_total_closing';
const ANNUAL_PLAN_BRANDS = ['MLB', 'MLB KIDS', 'DISCOVERY'] as const;
const ANNUAL_PLAN_SEASONS = ['currF', 'currS', 'year1', 'year2', 'next', 'past'] as const;
type AnnualPlanBrand = typeof ANNUAL_PLAN_BRANDS[number];
type AnnualPlanSeason = typeof ANNUAL_PLAN_SEASONS[number];
type AnnualShipmentPlan = Record<AnnualPlanBrand, Record<AnnualPlanSeason, number>>;
type HqClosingByBrand = Record<AnnualPlanBrand, number>;
type MonthlyInventoryTotalByBrand = Record<AnnualPlanBrand, (number | null)[]>;
type ShipmentProgressBrand = AnnualPlanBrand;

interface ShipmentProgressRow {
  brand: ShipmentProgressBrand;
  season: '당년S' | '당년F';
  prevYearProgress: number | null;
  monthly: (number | null)[];
}

interface AccShipmentRatioRow {
  brand: ShipmentProgressBrand;
  monthly: (number | null)[];
}

const ANNUAL_PLAN_SEASON_LABELS: Record<AnnualPlanSeason, string> = {
  currF: '당년F',
  currS: '당년S',
  year1: '1년차',
  year2: '2년차',
  next: '차기시즌',
  past: '과시즌',
};
const OTB_SEASONS_LIST = ['27F', '27S', '26F', '26S'] as const;
type OtbSeason = typeof OTB_SEASONS_LIST[number];
type OtbBrand = AnnualPlanBrand;
type OtbData = Record<OtbSeason, Record<OtbBrand, number>>;

const TXT_HQ_PURCHASE_HEADER = '본사 매입';
const TXT_ANNUAL_PLAN_TITLE = '26년 시즌별 연간 출고계획표';
const TXT_BRAND = '브랜드';
const TXT_PLAN_SECTION = '본사 의류매입';
const TXT_PLAN_UNIT = '(단위: CNY K)';
const TXT_OTB_SECTION = '대리상 OTB';
const TXT_OTB_UNIT = '(단위: CNY K)';
const TXT_SEASON = '시즌';
const TXT_EDIT = '수정';
const TXT_SAVE = '저장';
const TXT_PLAN_ICON = '📋';
const TXT_COLLAPSE = '▲ 접기';
const TXT_EXPAND = '▼ 펼치기';

/** 본사 의류매입 표(annualPlan) → hqSellInPlan 시즌 행 매핑 */
const DRIVER_COLUMN_HEADERS = ['전년', '계획', 'YOY', 'Rolling', 'YOY', '계획대비 증감'] as const;
const INDEPENDENT_DRIVER_COLUMN_HEADERS = ['Rolling'] as const;
const INDEPENDENT_DRIVER_ROWS = ['대리상 리테일 성장율', '본사 리테일 성장율'] as const;
const DEPENDENT_DRIVER_ROWS = ['대리상출고', '본사상품매입', '본사기말재고'] as const;

function formatDriverPercent(value: number): string {
  return `${100 + value}%`;
}

function formatDriverNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return Math.round(value).toLocaleString();
}

function getDependentDriverCellValue(
  column: (typeof DRIVER_COLUMN_HEADERS)[number],
  columnIndex: number,
  rowIndex: number,
  currentTotalRow: InventoryTableData['rows'][number] | null,
  prevTotalRow: InventoryTableData['rows'][number] | null,
): string {
  const pickValue = (row: InventoryTableData['rows'][number] | null): number | null | undefined => {
    if (rowIndex === 0) return row?.sellOutTotal;
    if (rowIndex === 1) return row?.sellInTotal;
    return row?.closing;
  };
  if (column === '전년') return formatDriverNumber(pickValue(prevTotalRow));
  if (column === 'Rolling') return formatDriverNumber(pickValue(currentTotalRow));
  if (column === 'YOY' && columnIndex === 4) {
    const currentValue = pickValue(currentTotalRow);
    const prevValue = pickValue(prevTotalRow);
    if (currentValue == null || prevValue == null || !Number.isFinite(currentValue) || !Number.isFinite(prevValue) || prevValue === 0) {
      return '-';
    }
    return `${Math.round((currentValue / prevValue) * 100).toLocaleString()}%`;
  }
  return '-';
}

function buildShipmentProgressRates(row: ShipmentProgressRow | null | undefined): number[] {
  let prevCumulative = row?.prevYearProgress ?? 0;
  return Array.from({ length: 12 }, (_, monthIndex) => {
    const currentCumulative = row?.monthly[monthIndex] ?? prevCumulative;
    const monthlyRate = Math.max(currentCumulative - prevCumulative, 0);
    prevCumulative = currentCumulative;
    return monthlyRate;
  });
}

function annualPlanToHqSellInPlan(plan: AnnualShipmentPlan, planBrand: AnnualPlanBrand): Partial<Record<RowKey, number>> {
  const row = plan[planBrand];
  if (!row) return {};
  const SEASON_MAP: { plan: AnnualPlanSeason; key: RowKey }[] = [
    { plan: 'currF', key: '당년F' }, { plan: 'currS', key: '당년S' },
    { plan: 'year1', key: '1년차' }, { plan: 'year2', key: '2년차' },
    { plan: 'next', key: '차기시즌' }, { plan: 'past', key: '과시즌' },
  ];
  const out: Partial<Record<RowKey, number>> = {};
  for (const { plan: p, key } of SEASON_MAP) {
    const v = row[p];
    out[key] = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  }
  return out;
}

/** OTB(CNY) → 대리상 의류 Sell-in(CNY K) 매핑. 당년F=26F, 당년S=26S, 차기시즌=27F+27S. 1년차/2년차/과시즌=0 */
function otbToDealerSellInPlan(otbData: OtbData | null, planBrand: OtbBrand): Partial<Record<RowKey, number>> {
  if (!otbData) return {};
  const out: Partial<Record<RowKey, number>> = {};
  out['당년F'] = Math.round((otbData['26F']?.[planBrand] ?? 0) / 1000);
  out['당년S'] = Math.round((otbData['26S']?.[planBrand] ?? 0) / 1000);
  out['1년차'] = 0;
  out['2년차'] = 0;
  out['차기시즌'] = Math.round(((otbData['27F']?.[planBrand] ?? 0) + (otbData['27S']?.[planBrand] ?? 0)) / 1000);
  out['과시즌'] = 0;
  return out;
}

function createEmptyAnnualShipmentPlan(): AnnualShipmentPlan {
  const emptyRow: Record<AnnualPlanSeason, number> = {
    currF: 0,
    currS: 0,
    year1: 0,
    year2: 0,
    next: 0,
    past: 0,
  };
  return {
    MLB: { ...emptyRow },
    'MLB KIDS': { ...emptyRow },
    DISCOVERY: { ...emptyRow },
  };
}

function calcYearDays(year: number): number {
  return (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 366 : 365;
}

function sum12(a: number[], b: number[]): number[] {
  return a.map((v, i) => v + (b[i] ?? 0));
}

function aggregateLeafTables(tables: InventoryTableData[], year: number): InventoryTableData {
  if (tables.length === 0) return { rows: [] };
  const yearDays = calcYearDays(year);
  const byKey = new Map<string, InventoryRowRaw>();
  for (const table of tables) {
    for (const row of table.rows) {
      if (!row.isLeaf) continue;
      const existing = byKey.get(row.key);
      if (!existing) {
        byKey.set(row.key, {
          key: row.key as RowKey,
          opening: row.opening,
          sellIn: [...row.sellIn],
          sellOut: [...row.sellOut],
          closing: row.closing,
          woiSellOut: [...row.woiSellOut],
          ...(row.hqSales ? { hqSales: [...row.hqSales] } : {}),
        });
      } else {
        existing.opening += row.opening;
        existing.closing += row.closing;
        existing.sellIn = sum12(existing.sellIn, row.sellIn);
        existing.sellOut = sum12(existing.sellOut, row.sellOut);
        existing.woiSellOut = sum12(existing.woiSellOut ?? new Array(12).fill(0), row.woiSellOut);
        if (row.hqSales) {
          existing.hqSales = sum12(existing.hqSales ?? new Array(12).fill(0), row.hqSales);
        }
      }
    }
  }
  return buildTableData(Array.from(byKey.values()), yearDays);
}

function aggregateTopTables(tables: TopTablePair[], year: number): TopTablePair {
  return {
    dealer: aggregateLeafTables(tables.map((t) => t.dealer), year),
    hq: aggregateLeafTables(tables.map((t) => t.hq), year),
  };
}

type AdjustedDealerRetailRow = RetailSalesRow & { opening?: number | null };

function buildAdjustedDealerRetailRows(
  sourceRows: RetailSalesRow[],
  monthlyRows: MonthlyStockResponse['dealer']['rows'],
  shipmentRows: ShipmentSalesResponse['data']['rows'],
): AdjustedDealerRetailRow[] {
  const monthlyByKey = new Map(monthlyRows.map((row) => [row.key, row]));
  const shipmentByKey = new Map(shipmentRows.map((row) => [row.key, row]));
  const leafRows: AdjustedDealerRetailRow[] = sourceRows
    .filter((row) => row.isLeaf)
    .map((row) => ({
      ...row,
      opening: monthlyByKey.get(row.key)?.opening ?? null,
      monthly: row.monthly.map((_, monthIndex) => {
        const monthlyRow = monthlyByKey.get(row.key);
        const shipmentRow = shipmentByKey.get(row.key);
        if (!monthlyRow || !shipmentRow) return null;
        const opening = monthIndex === 0 ? (monthlyRow.opening ?? null) : (monthlyRow.monthly[monthIndex - 1] ?? null);
        const sellIn = shipmentRow.monthly[monthIndex] ?? null;
        const closing = monthlyRow.monthly[monthIndex] ?? null;
        if (opening === null || sellIn === null || closing === null) return null;
        return opening + sellIn - closing;
      }),
    }));

  const sumOpening = (rows: AdjustedDealerRetailRow[]): number | null => {
    const values = rows
      .map((row) => row.opening)
      .filter((value): value is number => value != null && Number.isFinite(value));
    if (values.length === 0) return null;
    return values.reduce((sum, value) => sum + value, 0);
  };
  const sumMonthly = (rows: AdjustedDealerRetailRow[], monthIndex: number): number | null => {
    const values = rows
      .map((row) => row.monthly[monthIndex] ?? null)
      .filter((value): value is number => value != null && Number.isFinite(value));
    if (values.length === 0) return null;
    return values.reduce((sum, value) => sum + value, 0);
  };

  const clothingLeafRows = leafRows.slice(0, 6);
  const accLeafRows = leafRows.slice(6);
  const totalTemplate = sourceRows.find((row) => row.isTotal);
  const subtotalTemplates = sourceRows.filter((row) => row.isSubtotal);
  const clothingSubtotalTemplate = subtotalTemplates[0] ?? null;
  const accSubtotalTemplate = subtotalTemplates[1] ?? null;
  const clothingSubtotal =
    clothingSubtotalTemplate == null
      ? null
      : {
          ...clothingSubtotalTemplate,
          opening: sumOpening(clothingLeafRows),
          monthly: clothingSubtotalTemplate.monthly.map((_, monthIndex) => sumMonthly(clothingLeafRows, monthIndex)),
        };
  const accSubtotal =
    accSubtotalTemplate == null
      ? null
      : {
          ...accSubtotalTemplate,
          opening: sumOpening(accLeafRows),
          monthly: accSubtotalTemplate.monthly.map((_, monthIndex) => sumMonthly(accLeafRows, monthIndex)),
        };
  const grandTotal =
    totalTemplate == null
      ? null
      : {
          ...totalTemplate,
          opening: sumOpening(leafRows),
          monthly: totalTemplate.monthly.map((_, monthIndex) => sumMonthly(leafRows, monthIndex)),
        };

  return [
    ...(grandTotal ? [grandTotal] : []),
    ...(clothingSubtotal ? [clothingSubtotal] : []),
    ...clothingLeafRows,
    ...(accSubtotal ? [accSubtotal] : []),
    ...accLeafRows,
  ];
}

function applyAdjustedDealerRetailPlanBase(
  currentRetail: RetailSalesResponse,
  prevYearMonthly: MonthlyStockResponse,
  prevYearRetail: RetailSalesResponse,
  prevYearShipment: ShipmentSalesResponse,
  growthRateDealer: number,
): RetailSalesResponse {
  if (currentRetail.planFromMonth == null) return currentRetail;
  const adjustedPrevDealerRows = buildAdjustedDealerRetailRows(
    prevYearRetail.dealer.rows,
    prevYearMonthly.dealer.rows,
    prevYearShipment.data.rows,
  );
  return {
    ...currentRetail,
    dealer: {
      rows: mergePlanMonths(
        currentRetail.dealer.rows,
        adjustedPrevDealerRows,
        currentRetail.planFromMonth,
        1 + growthRateDealer / 100,
      ),
    },
  };
}

function buildSeasonShipmentDerivedSellOutPlan(
  planBrand: AnnualPlanBrand,
  annualPlan: AnnualShipmentPlan,
  hqTable: InventoryTableData,
): Partial<Record<RowKey, number>> {
  const byKey = new Map(hqTable.rows.filter((r) => r.isLeaf).map((r) => [r.key, r]));
  const out: Partial<Record<RowKey, number>> = {};
  for (let i = 0; i < SEASON_KEYS.length && i < ANNUAL_PLAN_SEASONS.length; i += 1) {
    const seasonKey = SEASON_KEYS[i] as RowKey;
    const planSeason = ANNUAL_PLAN_SEASONS[i];
    const plannedShipment = annualPlan[planBrand][planSeason] ?? 0;
    const hqSalesTotal = byKey.get(seasonKey)?.hqSalesTotal ?? 0;
    out[seasonKey] = Math.max(0, Math.round(plannedShipment - hqSalesTotal));
  }
  return out;
}

function SectionIcon({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center w-5 h-5 flex-shrink-0">
      {children}
    </div>
  );
}

const ACC_KEYS_ORDER: AccKey[] = ['신발', '모자', '가방', '기타'];
const TH_SMALL = 'px-3 py-2 text-center text-xs font-semibold bg-[#1a2e5a] text-white border border-[#2e4070] whitespace-nowrap';

function HqHoldingWoiTable({
  values,
  onChange,
}: {
  values: Record<AccKey, number>;
  onChange: (key: AccKey, value: number) => void;
}) {
  const [editingKey, setEditingKey] = useState<AccKey | null>(null);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = (key: AccKey) => {
    setEditingKey(key);
    setEditValue(String(values[key]));
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const commitEdit = (key: AccKey) => {
    const v = parseFloat(editValue);
    if (!isNaN(v) && v > 0) onChange(key, v);
    setEditingKey(null);
    setEditValue('');
  };

  return (
    <div className="flex-shrink-0">
      <div className="rounded border border-gray-200 shadow-sm">
        <table className="border-collapse text-xs">
          <thead>
            <tr>
              <th className={TH_SMALL} style={{ minWidth: 70 }}>
                본사판매용
              </th>
            </tr>
          </thead>
          <tbody>
            {ACC_KEYS_ORDER.map((key) => (
              <tr key={key} className="bg-white hover:bg-gray-50">
                <td
                  className="px-3 py-1.5 text-right text-xs border-b border-gray-200 tabular-nums align-middle cursor-text"
                  onClick={() => editingKey !== key && startEdit(key)}
                >
                  {editingKey === key ? (
                    <input
                      ref={inputRef}
                      type="number"
                      min={1}
                      step={1}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={() => commitEdit(key)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget.blur(), e.preventDefault())}
                      className="w-12 text-right text-xs border-0 bg-transparent outline-none tabular-nums"
                    />
                  ) : (
                    <span className="text-blue-700 font-medium">{values[key]}주</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function normalizeAnnualShipmentPlan(source: unknown): AnnualShipmentPlan {
  const base = createEmptyAnnualShipmentPlan();
  const parsed = (source ?? {}) as Partial<AnnualShipmentPlan>;
  for (const b of ANNUAL_PLAN_BRANDS) {
    for (const season of ANNUAL_PLAN_SEASONS) {
      const v = parsed?.[b]?.[season];
      base[b][season] = typeof v === 'number' && Number.isFinite(v) ? v : 0;
    }
  }
  return base;
}

async function fetchSnapshotFromServer(year: number, brand: string): Promise<SnapshotData | null> {
  try {
    const params = new URLSearchParams({ year: String(year), brand });
    const res = await fetch(`/api/inventory/snapshot?${params}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: SnapshotData | null };
    return (json.data ?? null) as SnapshotData | null;
  } catch {
    return null;
  }
}

async function saveSnapshotToServer(year: number, brand: string, data: SnapshotData): Promise<void> {
  try {
    await fetch('/api/inventory/snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ year, brand, data }),
    });
  } catch {
    // ignore server sync errors; local snapshot remains available
  }
}

async function fetchAnnualPlanFromServer(year: number): Promise<AnnualShipmentPlan | null> {
  try {
    const params = new URLSearchParams({ year: String(year) });
    const res = await fetch(`/api/inventory/annual-shipment-plan?${params}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: unknown };
    if (!json.data) return null;
    return normalizeAnnualShipmentPlan(json.data);
  } catch {
    return null;
  }
}

async function saveAnnualPlanToServer(year: number, data: AnnualShipmentPlan): Promise<void> {
  try {
    await fetch('/api/inventory/annual-shipment-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ year, data }),
    });
  } catch {
    // ignore server sync errors; local copy remains available
  }
}

export default function InventoryDashboard() {
  const [year, setYear] = useState<number>(2026);
  const [brand, setBrand] = useState<Brand>('MLB');
  const [growthRate, setGrowthRate] = useState<number>(5);
  const [growthRateHq, setGrowthRateHq] = useState<number>(17);

  const publishDealerAccSellIn = useCallback((nextMap: Record<'MLB' | 'MLB KIDS' | 'DISCOVERY', number>) => {
    if (typeof window === 'undefined') return;
    const payload = {
      values: nextMap,
      updatedAt: Date.now(),
    };
    localStorage.setItem('inventory_dealer_acc_sellin', JSON.stringify(payload));
    window.dispatchEvent(new CustomEvent('inventory-dealer-acc-sellin-updated', { detail: payload }));
  }, []);

  const publishHqClosingByBrand = useCallback((partialMap: Partial<HqClosingByBrand>) => {
    if (typeof window === 'undefined') return;
    const currentRaw = localStorage.getItem(INVENTORY_HQ_CLOSING_KEY);
    let currentValues: HqClosingByBrand = {
      MLB: 0,
      'MLB KIDS': 0,
      DISCOVERY: 0,
    };
    try {
      const parsed = currentRaw ? JSON.parse(currentRaw) : null;
      if (parsed?.values) {
        currentValues = {
          MLB: Number(parsed.values.MLB) || 0,
          'MLB KIDS': Number(parsed.values['MLB KIDS']) || 0,
          DISCOVERY: Number(parsed.values.DISCOVERY) || 0,
        };
      }
    } catch {
      // ignore parse errors and overwrite with fresh values below
    }
    const nextValues = { ...currentValues, ...partialMap };
    const payload = {
      values: nextValues,
      updatedAt: Date.now(),
    };
    localStorage.setItem(INVENTORY_HQ_CLOSING_KEY, JSON.stringify(payload));
    window.dispatchEvent(new CustomEvent('inventory-hq-closing-updated', { detail: payload }));
  }, []);
  const publishMonthlyInventoryTotalByBrand = useCallback((partialMap: Partial<MonthlyInventoryTotalByBrand>) => {
    if (typeof window === 'undefined') return;
    const currentRaw = localStorage.getItem(INVENTORY_MONTHLY_TOTAL_KEY);
    let currentValues: MonthlyInventoryTotalByBrand = {
      MLB: new Array(12).fill(null),
      'MLB KIDS': new Array(12).fill(null),
      DISCOVERY: new Array(12).fill(null),
    };
    try {
      const parsed = currentRaw ? JSON.parse(currentRaw) : null;
      if (parsed?.values) {
        currentValues = {
          MLB: Array.isArray(parsed.values.MLB) ? parsed.values.MLB : new Array(12).fill(null),
          'MLB KIDS': Array.isArray(parsed.values['MLB KIDS']) ? parsed.values['MLB KIDS'] : new Array(12).fill(null),
          DISCOVERY: Array.isArray(parsed.values.DISCOVERY) ? parsed.values.DISCOVERY : new Array(12).fill(null),
        };
      }
    } catch {
      // ignore parse errors and overwrite with fresh values below
    }
    const nextValues = { ...currentValues, ...partialMap };
    const payload = {
      values: nextValues,
      updatedAt: Date.now(),
    };
    localStorage.setItem(INVENTORY_MONTHLY_TOTAL_KEY, JSON.stringify(payload));
    window.dispatchEvent(new CustomEvent('inventory-monthly-total-updated', { detail: payload }));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const payload = {
      growthRate,
      growthRateHq,
      updatedAt: Date.now(),
    };
    localStorage.setItem('inventory_growth_params', JSON.stringify(payload));
    window.dispatchEvent(new CustomEvent('inventory-growth-updated', { detail: payload }));
  }, [growthRate, growthRateHq]);

  // 湲곗〈 Sell-in/Sell-out ???곗씠??
  const [data, setData] = useState<InventoryApiResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // ?붾퀎 ?ш퀬?붿븸 ???곗씠??
  const [monthlyData, setMonthlyData] = useState<MonthlyStockResponse | null>(null);
  const [monthlyLoading, setMonthlyLoading] = useState<boolean>(false);
  const [monthlyError, setMonthlyError] = useState<string | null>(null);

  // 2026 YOY 계산용 전년(year-1) 데이터
  const [prevYearMonthlyData, setPrevYearMonthlyData] = useState<MonthlyStockResponse | null>(null);
  const [prevYearRetailData, setPrevYearRetailData] = useState<RetailSalesResponse | null>(null);
  const [prevYearShipmentData, setPrevYearShipmentData] = useState<ShipmentSalesResponse | null>(null);
  const [prevYearPurchaseData, setPrevYearPurchaseData] = useState<PurchaseResponse | null>(null);
  const [prevYearMonthlyDataByBrand, setPrevYearMonthlyDataByBrand] = useState<Partial<Record<LeafBrand, MonthlyStockResponse>>>({});
  const [prevYearRetailDataByBrand, setPrevYearRetailDataByBrand] = useState<Partial<Record<LeafBrand, RetailSalesResponse>>>({});
  const [prevYearShipmentDataByBrand, setPrevYearShipmentDataByBrand] = useState<Partial<Record<LeafBrand, ShipmentSalesResponse>>>({});
  const [prevYearLoading, setPrevYearLoading] = useState<boolean>(false);
  const [prevYearError, setPrevYearError] = useState<boolean>(false);

  // 由ы뀒??留ㅼ텧 ???곗씠??
  const [retailData, setRetailData] = useState<RetailSalesResponse | null>(null);
  const [retailLoading, setRetailLoading] = useState<boolean>(false);
  const [retailError, setRetailError] = useState<string | null>(null);

  // 蹂몄궗?믩?由ъ긽 異쒓퀬留ㅼ텧 ???곗씠??
  const [shipmentData, setShipmentData] = useState<ShipmentSalesResponse | null>(null);
  const [shipmentLoading, setShipmentLoading] = useState<boolean>(false);
  const [shipmentError, setShipmentError] = useState<string | null>(null);

  // 蹂몄궗 留ㅼ엯?곹뭹 ???곗씠??
  const [purchaseData, setPurchaseData] = useState<PurchaseResponse | null>(null);
  const [purchaseLoading, setPurchaseLoading] = useState<boolean>(false);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [plActualAvailableMonths, setPlActualAvailableMonths] = useState<number[]>([]);
  const [shipmentProgressRows, setShipmentProgressRows] = useState<ShipmentProgressRow[]>([]);
  const [accShipmentRatioRows, setAccShipmentRatioRows] = useState<AccShipmentRatioRow[]>([]);

  // ?붾퀎 ?뱀뀡 ?좉? (湲곕낯 ?묓옒)
  const [monthlyOpen, setMonthlyOpen] = useState(false);
  const [retailOpen, setRetailOpen] = useState(false);
  const [adjustedRetailOpen, setAdjustedRetailOpen] = useState(false);
  const [shipmentOpen, setShipmentOpen] = useState(false);
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [annualPlanOpen, setAnnualPlanOpen] = useState(false);
  const [otbData, setOtbData] = useState<OtbData | null>(null);
  const [otbLoading, setOtbLoading] = useState(false);
  const [otbError, setOtbError] = useState<string | null>(null);
  const [annualShipmentPlan2026, setAnnualShipmentPlan2026] = useState<AnnualShipmentPlan>(createEmptyAnnualShipmentPlan);
  const [annualShipmentPlanDraft2026, setAnnualShipmentPlanDraft2026] = useState<AnnualShipmentPlan>(createEmptyAnnualShipmentPlan);
  const [annualPlanEditMode, setAnnualPlanEditMode] = useState(false);

  // ?ㅻ깄???곹깭
  const [snapshotSaved, setSnapshotSaved] = useState(false);
  const [snapshotSavedAt, setSnapshotSavedAt] = useState<string | null>(null);
  const [recalcLoading, setRecalcLoading] = useState(false);
  // 2026 ACC 湲곕쭚 紐⑺몴 ?ш퀬二쇱닔 (?由ъ긽/蹂몄궗蹂??좊컻쨌紐⑥옄쨌媛諛㈑룰린?)
  const [accTargetWoiDealer, setAccTargetWoiDealer] = useState<Record<AccKey, number>>({
    '신발': 29,
    '모자': 20,
    '가방': 25.5,
    '기타': 39,
  } as Record<AccKey, number>);
  const [accTargetWoiHq, setAccTargetWoiHq] = useState<Record<AccKey, number>>({
    '신발': 10,
    '모자': 8,
    '가방': 10,
    '기타': 10,
  } as Record<AccKey, number>);
  const [accHqHoldingWoi, setAccHqHoldingWoi] = useState<Record<AccKey, number>>({
    '신발': 30,
    '모자': 20,
    '가방': 30,
    '기타': 30,
  } as Record<AccKey, number>);
  const accTargetWoiDealerRef = useRef(accTargetWoiDealer);
  const accTargetWoiHqRef = useRef(accTargetWoiHq);
  const accHqHoldingWoiRef = useRef(accHqHoldingWoi);
  useEffect(() => {
    accTargetWoiDealerRef.current = accTargetWoiDealer;
  }, [accTargetWoiDealer]);
  useEffect(() => {
    accTargetWoiHqRef.current = accTargetWoiHq;
  }, [accTargetWoiHq]);
  useEffect(() => {
    accHqHoldingWoiRef.current = accHqHoldingWoi;
  }, [accHqHoldingWoi]);
  useEffect(() => {
    const firstAccKey = ACC_KEYS[0];
    if (!firstAccKey) return;
    setAccTargetWoiDealer((prev) => {
      if (prev[firstAccKey as AccKey] === 30) return prev;
      return { ...prev, [firstAccKey]: 30 };
    });
  }, []);
  const [hqSellOutPlan, setHqSellOutPlan] = useState<Partial<Record<RowKey, number>>>({});
  const retail2025Ref = useRef<RetailSalesResponse['retail2025'] | null>(null);
  const monthlyByBrandRef = useRef<Partial<Record<LeafBrand, MonthlyStockResponse>>>({});
  const retailByBrandRef = useRef<Partial<Record<LeafBrand, RetailSalesResponse>>>({});
  const shipmentByBrandRef = useRef<Partial<Record<LeafBrand, ShipmentSalesResponse>>>({});
  const purchaseByBrandRef = useRef<Partial<Record<LeafBrand, PurchaseResponse>>>({});
  const [savedSnapshotByBrand, setSavedSnapshotByBrand] = useState<Partial<Record<LeafBrand, SnapshotData>>>({});
  const [monthlyDataByBrand, setMonthlyDataByBrand] = useState<Partial<Record<LeafBrand, MonthlyStockResponse>>>({});
  const [retailDataByBrand, setRetailDataByBrand] = useState<Partial<Record<LeafBrand, RetailSalesResponse>>>({});
  const [shipmentDataByBrand, setShipmentDataByBrand] = useState<Partial<Record<LeafBrand, ShipmentSalesResponse>>>({});
  const [purchaseDataByBrand, setPurchaseDataByBrand] = useState<Partial<Record<LeafBrand, PurchaseResponse>>>({});

  const DEFAULT_ACC_WOI_DEALER: Record<AccKey, number> = {
    '신발': 29,
    '모자': 20,
    '가방': 25.5,
    '기타': 39,
  } as Record<AccKey, number>;
  const DEFAULT_ACC_WOI_HQ: Record<AccKey, number> = {
    '신발': 10,
    '모자': 8,
    '가방': 10,
    '기타': 10,
  } as Record<AccKey, number>;
  const DEFAULT_ACC_HQ_HOLDING_WOI: Record<AccKey, number> = {
    '신발': 30,
    '모자': 20,
    '가방': 30,
    '기타': 30,
  } as Record<AccKey, number>;

  // ?? 湲곗〈 ??fetch ??
  const fetchData = useCallback(async () => {
    // 2025/2026 ?ш퀬?먯궛 ???곷떒 ?붿빟?쒕뒗 ?붾퀎/由ы뀒??異쒓퀬/留ㅼ엯 議고빀?쇰줈留??뚮뜑?쒕떎.
    // (湲곗〈 /api/inventory fallback???곕㈃ 珥덇린 ?섎뱶肄붾뵫 ?レ옄 源쒕묀?꾩씠 諛쒖깮)
    if (year === 2025 || year === 2026) {
      setLoading(false);
      setError(null);
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        year: String(year),
        growthRate: String(growthRate),
        brand,
      });
      const res = await fetch(`/api/inventory?${params}`);
      if (!res.ok) throw new Error('?곗씠??濡쒕뱶 ?ㅽ뙣');
      setData(await res.json());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [year, brand, growthRate]);

  // ?? ?붾퀎 ?ш퀬?붿븸 fetch ??
  const fetchMonthlyData = useCallback(async () => {
    setMonthlyLoading(true);
    setMonthlyError(null);
    try {
      if (brand === '전체') {
        const ress = await Promise.all(
          BRANDS_TO_AGGREGATE.map((b) =>
            fetch(`/api/inventory/monthly-stock?${new URLSearchParams({ year: String(year), brand: b })}`),
          ),
        );
        const jsons: MonthlyStockResponse[] = await Promise.all(ress.map((r) => r.json()));
        for (const j of jsons) if ((j as { error?: string }).error) throw new Error((j as { error?: string }).error);
        BRANDS_TO_AGGREGATE.forEach((b, i) => {
          monthlyByBrandRef.current[b] = jsons[i];
        });
        setMonthlyDataByBrand(Object.fromEntries(BRANDS_TO_AGGREGATE.map((b, i) => [b, jsons[i]])) as Record<LeafBrand, MonthlyStockResponse>);
        setMonthlyData(aggregateMonthlyStock(jsons));
      } else {
        const res = await fetch(`/api/inventory/monthly-stock?${new URLSearchParams({ year: String(year), brand })}`);
        if (!res.ok) throw new Error('?붾퀎 ?곗씠??濡쒕뱶 ?ㅽ뙣');
        const json: MonthlyStockResponse = await res.json();
        if ((json as { error?: string }).error) throw new Error((json as { error?: string }).error);
        monthlyByBrandRef.current[brand as LeafBrand] = json;
        setMonthlyData(json);
      }
    } catch (e) {
      setMonthlyError(String(e));
    } finally {
      setMonthlyLoading(false);
    }
  }, [year, brand]);

  // ?? 由ы뀒??留ㅼ텧 fetch ??
  const fetchRetailData = useCallback(async () => {
    setRetailLoading(true);
    setRetailError(null);
    try {
      if (brand === '전체') {
        const ress = await Promise.all(
          BRANDS_TO_AGGREGATE.map((b) =>
            fetch(`/api/inventory/retail-sales?${new URLSearchParams({ year: String(year), brand: b, growthRate: String(growthRate), growthRateHq: String(growthRateHq) })}`),
          ),
        );
        const jsons: RetailSalesResponse[] = await Promise.all(ress.map((r) => r.json()));
        for (const j of jsons) if ((j as { error?: string }).error) throw new Error((j as { error?: string }).error);
        BRANDS_TO_AGGREGATE.forEach((b, i) => {
          retailByBrandRef.current[b] = jsons[i];
        });
        setRetailDataByBrand(Object.fromEntries(BRANDS_TO_AGGREGATE.map((b, i) => [b, jsons[i]])) as Record<LeafBrand, RetailSalesResponse>);
        const aggregated = aggregateRetailSales(jsons);
        if (aggregated.retail2025) retail2025Ref.current = aggregated.retail2025;
        setRetailData(aggregated);
      } else {
        const res = await fetch(`/api/inventory/retail-sales?${new URLSearchParams({ year: String(year), brand, growthRate: String(growthRate), growthRateHq: String(growthRateHq) })}`);
        if (!res.ok) throw new Error('由ы뀒??留ㅼ텧 ?곗씠??濡쒕뱶 ?ㅽ뙣');
        const json: RetailSalesResponse = await res.json();
        if ((json as { error?: string }).error) throw new Error((json as { error?: string }).error);
        if (json.retail2025) retail2025Ref.current = json.retail2025;
        retailByBrandRef.current[brand as LeafBrand] = json;
        setRetailData(json);
      }
    } catch (e) {
      setRetailError(String(e));
    } finally {
      setRetailLoading(false);
    }
  }, [year, brand, growthRate, growthRateHq]);

  // ?? 異쒓퀬留ㅼ텧 fetch ??
  const fetchShipmentData = useCallback(async () => {
    setShipmentLoading(true);
    setShipmentError(null);
    try {
      if (brand === '전체') {
        const ress = await Promise.all(
          BRANDS_TO_AGGREGATE.map((b) =>
            fetch(`/api/inventory/shipment-sales?${new URLSearchParams({ year: String(year), brand: b })}`),
          ),
        );
        const jsons: ShipmentSalesResponse[] = await Promise.all(ress.map((r) => r.json()));
        for (const j of jsons) if ((j as { error?: string }).error) throw new Error((j as { error?: string }).error ?? '異쒓퀬留ㅼ텧 ?곗씠??濡쒕뱶 ?ㅽ뙣');
        BRANDS_TO_AGGREGATE.forEach((b, i) => {
          shipmentByBrandRef.current[b] = jsons[i];
        });
        setShipmentDataByBrand(Object.fromEntries(BRANDS_TO_AGGREGATE.map((b, i) => [b, jsons[i]])) as Record<LeafBrand, ShipmentSalesResponse>);
        setShipmentData(aggregateShipmentSales(jsons));
      } else {
        const res = await fetch(`/api/inventory/shipment-sales?${new URLSearchParams({ year: String(year), brand })}`);
        const json: ShipmentSalesResponse = await res.json();
        if (!res.ok || (json as { error?: string }).error) throw new Error((json as { error?: string }).error ?? '異쒓퀬留ㅼ텧 ?곗씠??濡쒕뱶 ?ㅽ뙣');
        shipmentByBrandRef.current[brand as LeafBrand] = json;
        setShipmentData(json);
      }
    } catch (e) {
      setShipmentError(String(e));
    } finally {
      setShipmentLoading(false);
    }
  }, [year, brand]);

  // ?? 蹂몄궗 留ㅼ엯?곹뭹 fetch ??
  const fetchPurchaseData = useCallback(async () => {
    setPurchaseLoading(true);
    setPurchaseError(null);
    try {
      if (brand === '전체') {
        const ress = await Promise.all(
          BRANDS_TO_AGGREGATE.map((b) =>
            fetch(`/api/inventory/purchase?${new URLSearchParams({ year: String(year), brand: b })}`),
          ),
        );
        const jsons: PurchaseResponse[] = await Promise.all(ress.map((r) => r.json()));
        for (const j of jsons) if ((j as { error?: string }).error) throw new Error((j as { error?: string }).error ?? '留ㅼ엯?곹뭹 ?곗씠??濡쒕뱶 ?ㅽ뙣');
        BRANDS_TO_AGGREGATE.forEach((b, i) => {
          purchaseByBrandRef.current[b] = jsons[i];
        });
        setPurchaseDataByBrand(Object.fromEntries(BRANDS_TO_AGGREGATE.map((b, i) => [b, jsons[i]])) as Record<LeafBrand, PurchaseResponse>);
        setPurchaseData(aggregatePurchase(jsons));
      } else {
        const res = await fetch(`/api/inventory/purchase?${new URLSearchParams({ year: String(year), brand })}`);
        const json: PurchaseResponse = await res.json();
        if (!res.ok || (json as { error?: string }).error) throw new Error((json as { error?: string }).error ?? '留ㅼ엯?곹뭹 ?곗씠??濡쒕뱶 ?ㅽ뙣');
        purchaseByBrandRef.current[brand as LeafBrand] = json;
        setPurchaseData(json);
      }
    } catch (e) {
      setPurchaseError(String(e));
    } finally {
      setPurchaseLoading(false);
    }
  }, [year, brand]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ?ㅻ깄?룹씠 ?덉쑝硫?API ?앸왂, ?놁쑝硫?4媛?API ?몄텧 (전체 ??? ?ㅻ깄??誘몄궗?? ??긽 API 吏묎퀎)
  useEffect(() => {
    let cancelled = false;

    const applySnapshotToState = (snap: SnapshotData) => {
      setMonthlyData(snap.monthly);
      setShipmentData(snap.shipment);
      setPurchaseData(snap.purchase);
      // 4개 항목만 저장하므로 hqSellOutPlan·accTargetWoi·accHqHoldingWoi는 적용하지 않음
      if (year === 2026 && snap.planFromMonth != null && snap.retail2025) {
        setRetailData(
          applyPlanToSnapshot(
            snap.retailActuals,
            snap.retail2025 as RetailSalesResponse,
            snap.planFromMonth,
            growthRate,
            growthRateHq,
          ),
        );
      } else {
        setRetailData(snap.retailActuals);
      }
      setSnapshotSaved(true);
      setSnapshotSavedAt(snap.savedAt);
    };

    const run = async () => {
      if (brand === '전체') {
        setSnapshotSaved(false);
        setSnapshotSavedAt(null);
        await Promise.all([
          fetchMonthlyData(),
          fetchRetailData(),
          fetchShipmentData(),
          fetchPurchaseData(),
        ]);
        return;
      }

      if (year === 2026) {
        setSnapshotSaved(false);
        setSnapshotSavedAt(null);
        await Promise.all([
          fetchMonthlyData(),
          fetchRetailData(),
          fetchShipmentData(),
          fetchPurchaseData(),
        ]);
        return;
      }

      const serverSnap = await fetchSnapshotFromServer(year, brand);
      if (cancelled) return;
      if (serverSnap) {
        saveSnapshot(year, brand, serverSnap);
        applySnapshotToState(serverSnap);
        return;
      }

      setSnapshotSaved(false);
      setSnapshotSavedAt(null);
      await Promise.all([
        fetchMonthlyData(),
        fetchRetailData(),
        fetchShipmentData(),
        fetchPurchaseData(),
      ]);
    };

    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, brand]); // growthRate???섎룄?곸쑝濡??쒖쇅

  useEffect(() => {
    if (year !== 2026) return;
    let cancelled = false;

    const run = async () => {
      const serverPlan = await fetchAnnualPlanFromServer(year);
      if (cancelled) return;
      if (serverPlan) {
        setAnnualShipmentPlan2026(serverPlan);
        setAnnualShipmentPlanDraft2026(serverPlan);
        setAnnualPlanEditMode(false);
        return;
      }

      const empty = createEmptyAnnualShipmentPlan();
      setAnnualShipmentPlan2026(empty);
      setAnnualShipmentPlanDraft2026(empty);
      setAnnualPlanEditMode(false);
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [year]);

  // 2026 대리상 OTB 데이터 fetch
  useEffect(() => {
    if (year !== 2026) {
      setOtbData(null);
      return;
    }
    let cancelled = false;
    setOtbLoading(true);
    setOtbError(null);

    const run = async () => {
      try {
        const res = await fetch('/api/inventory/otb?year=2026', { cache: 'no-store' });
        if (cancelled) return;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { data?: OtbData | null; error?: string };
        if (cancelled) return;
        if (json.error) throw new Error(json.error);
        setOtbData(json.data ?? null);
      } catch (e) {
        if (!cancelled) setOtbError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setOtbLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [year]);

  // 2026은 snapshot을 우회하므로 성장률 변경 시 리테일 API를 다시 조회한다.
  useEffect(() => {
    if (year !== 2026) return;
    void fetchRetailData();
    setSnapshotSaved(false);
    setSnapshotSavedAt(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, growthRate, growthRateHq]);

  useEffect(() => {
    if (year !== 2026 || brand !== '전체') return;
    let cancelled = false;

    const warmServerSnapshotsToLocal = async () => {
      if (!cancelled) {
        setSavedSnapshotByBrand({});
      }
    };

    void warmServerSnapshotsToLocal();
    return () => {
      cancelled = true;
    };
  }, [year, brand]);

  // 2026 YOY 계산용: 전년(year-1) monthly/retail/shipment/purchase fetch
  useEffect(() => {
    if (year !== 2026) {
      setPrevYearMonthlyData(null);
      setPrevYearRetailData(null);
      setPrevYearShipmentData(null);
      setPrevYearPurchaseData(null);
      setPrevYearMonthlyDataByBrand({});
      setPrevYearRetailDataByBrand({});
      setPrevYearShipmentDataByBrand({});
      setPrevYearLoading(false);
      setPrevYearError(false);
      return;
    }
    // 탭 전환 시 즉시 전년 데이터 초기화 → YOY가 '- → 정상'으로 표시 (잘못된 숫자 방지)
    setPrevYearMonthlyData(null);
    setPrevYearRetailData(null);
    setPrevYearShipmentData(null);
    setPrevYearPurchaseData(null);
    setPrevYearMonthlyDataByBrand({});
    setPrevYearRetailDataByBrand({});
    setPrevYearShipmentDataByBrand({});
    setPrevYearLoading(true);
    setPrevYearError(false);
    let cancelled = false;

    const run = async () => {
      try {
        const prevYear = year - 1;
        if (brand !== '전체') {
          const localPrevSnap = loadSnapshot(prevYear, brand);
          const prevSnap = localPrevSnap ?? await fetchSnapshotFromServer(prevYear, brand);
          if (cancelled) return;
          if (prevSnap) {
            if (!localPrevSnap) {
              saveSnapshot(prevYear, brand, prevSnap);
            }
            setPrevYearMonthlyData(prevSnap.monthly);
            setPrevYearRetailData(prevSnap.retailActuals);
            setPrevYearShipmentData(prevSnap.shipment);
            setPrevYearPurchaseData(prevSnap.purchase);
            setPrevYearMonthlyDataByBrand({});
            setPrevYearRetailDataByBrand({});
            setPrevYearShipmentDataByBrand({});
            return;
          }
        }

        if (brand === '전체') {
          const [monthlyRess, retailRess, shipmentRess, purchaseRess] = await Promise.all([
            Promise.all(BRANDS_TO_AGGREGATE.map((b) =>
              fetch(`/api/inventory/monthly-stock?${new URLSearchParams({ year: String(prevYear), brand: b })}`),
            )),
            Promise.all(BRANDS_TO_AGGREGATE.map((b) =>
              fetch(`/api/inventory/retail-sales?${new URLSearchParams({ year: String(prevYear), brand: b, growthRate: '0' })}`),
            )),
            Promise.all(BRANDS_TO_AGGREGATE.map((b) =>
              fetch(`/api/inventory/shipment-sales?${new URLSearchParams({ year: String(prevYear), brand: b })}`),
            )),
            Promise.all(BRANDS_TO_AGGREGATE.map((b) =>
              fetch(`/api/inventory/purchase?${new URLSearchParams({ year: String(prevYear), brand: b })}`),
            )),
          ]);
          if (cancelled) return;
          const [monthlyJsons, retailJsons, shipmentJsons, purchaseJsons] = await Promise.all([
            Promise.all(monthlyRess.map((r) => r.json() as Promise<MonthlyStockResponse>)),
            Promise.all(retailRess.map((r) => r.json() as Promise<RetailSalesResponse>)),
            Promise.all(shipmentRess.map((r) => r.json() as Promise<ShipmentSalesResponse>)),
            Promise.all(purchaseRess.map((r) => r.json() as Promise<PurchaseResponse>)),
          ]);
          if (cancelled) return;
          setPrevYearMonthlyDataByBrand({
            MLB: monthlyJsons[0],
            'MLB KIDS': monthlyJsons[1],
            DISCOVERY: monthlyJsons[2],
          });
          setPrevYearRetailDataByBrand({
            MLB: retailJsons[0],
            'MLB KIDS': retailJsons[1],
            DISCOVERY: retailJsons[2],
          });
          setPrevYearShipmentDataByBrand({
            MLB: shipmentJsons[0],
            'MLB KIDS': shipmentJsons[1],
            DISCOVERY: shipmentJsons[2],
          });
          setPrevYearMonthlyData(aggregateMonthlyStock(monthlyJsons));
          setPrevYearRetailData(aggregateRetailSales(retailJsons));
          setPrevYearShipmentData(aggregateShipmentSales(shipmentJsons));
          setPrevYearPurchaseData(aggregatePurchase(purchaseJsons));
        } else {
          const [mRes, rRes, sRes, pRes] = await Promise.all([
            fetch(`/api/inventory/monthly-stock?${new URLSearchParams({ year: String(prevYear), brand })}`),
            fetch(`/api/inventory/retail-sales?${new URLSearchParams({ year: String(prevYear), brand, growthRate: '0' })}`),
            fetch(`/api/inventory/shipment-sales?${new URLSearchParams({ year: String(prevYear), brand })}`),
            fetch(`/api/inventory/purchase?${new URLSearchParams({ year: String(prevYear), brand })}`),
          ]);
          if (cancelled) return;
          const [mJson, rJson, sJson, pJson] = await Promise.all([
            mRes.json() as Promise<MonthlyStockResponse>,
            rRes.json() as Promise<RetailSalesResponse>,
            sRes.json() as Promise<ShipmentSalesResponse>,
            pRes.json() as Promise<PurchaseResponse>,
          ]);
          if (cancelled) return;
          if (!mRes.ok || !rRes.ok || !sRes.ok || !pRes.ok) {
            setPrevYearError(true);
            return;
          }
          if (
            (mJson as { error?: string }).error ||
            (rJson as { error?: string }).error ||
            (sJson as { error?: string }).error ||
            (pJson as { error?: string }).error
          ) {
            setPrevYearError(true);
            return;
          }
          setPrevYearMonthlyData(mJson);
          setPrevYearRetailData(rJson);
          setPrevYearShipmentData(sJson);
          setPrevYearPurchaseData(pJson);
          setPrevYearMonthlyDataByBrand({});
          setPrevYearRetailDataByBrand({});
          setPrevYearShipmentDataByBrand({});
        }
      } catch {
        if (!cancelled) {
          setPrevYearMonthlyData(null);
          setPrevYearRetailData(null);
          setPrevYearShipmentData(null);
          setPrevYearPurchaseData(null);
          setPrevYearMonthlyDataByBrand({});
          setPrevYearRetailDataByBrand({});
          setPrevYearShipmentDataByBrand({});
          setPrevYearError(true);
        }
      } finally {
        if (!cancelled) {
          setPrevYearLoading(false);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [year, brand]);

  useEffect(() => {
    if (year !== 2026) {
      setPlActualAvailableMonths([]);
      setShipmentProgressRows([]);
      setAccShipmentRatioRows([]);
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        const [actualRes, progressRes, accRes] = await Promise.all([
          fetch(`/api/pl-forecast/brand-actual?${new URLSearchParams({ year: String(year) })}`, { cache: 'no-store' }),
          fetch('/api/inventory/shipment-progress', { cache: 'no-store' }),
          fetch('/api/inventory/acc-shipment-ratio', { cache: 'no-store' }),
        ]);
        const [actualJson, progressJson, accJson] = await Promise.all([
          actualRes.json() as Promise<{ availableMonths?: number[] }>,
          progressRes.json() as Promise<{ rows?: ShipmentProgressRow[] }>,
          accRes.json() as Promise<{ rows?: AccShipmentRatioRow[] }>,
        ]);
        if (cancelled) return;
        setPlActualAvailableMonths(actualRes.ok ? (actualJson.availableMonths ?? []) : []);
        setShipmentProgressRows(progressRes.ok ? (progressJson.rows ?? []) : []);
        setAccShipmentRatioRows(accRes.ok ? (accJson.rows ?? []) : []);
      } catch {
        if (cancelled) return;
        setPlActualAvailableMonths([]);
        setShipmentProgressRows([]);
        setAccShipmentRatioRows([]);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [year]);

  // 2025쨌2026?????곷떒 ?쒕뒗 ?붾퀎 ?ш퀬?붿븸 + 由ы뀒??留ㅼ텧 + 異쒓퀬留ㅼ텧 + 留ㅼ엯?곹뭹?쇰줈 援ъ꽦
  // 2026???뚮쭔 ACC 紐⑺몴 ?ш퀬二쇱닔 ?ㅻ쾭?덉씠 ?곸슜

  const effectiveRetailData = useMemo<RetailSalesResponse | null>(() => {
    if (!retailData) return null;
    if (year === 2025 && monthlyData && shipmentData) {
      return {
        ...retailData,
        dealer: {
          rows: buildAdjustedDealerRetailRows(
            retailData.dealer.rows,
            monthlyData.dealer.rows,
            shipmentData.data.rows,
          ),
        },
      };
    }
    if (year === 2026 && prevYearMonthlyData && prevYearRetailData && prevYearShipmentData) {
      return applyAdjustedDealerRetailPlanBase(
        retailData,
        prevYearMonthlyData,
        prevYearRetailData,
        prevYearShipmentData,
        growthRate,
      );
    }
    return retailData;
  }, [year, retailData, monthlyData, shipmentData, prevYearMonthlyData, prevYearRetailData, prevYearShipmentData, growthRate]);

  const adjustedDealerRetailTable = useMemo<TableData | null>(() => {
    if (year !== 2025 || !effectiveRetailData) return null;
    return { rows: effectiveRetailData.dealer.rows as TableData['rows'] };
  }, [year, effectiveRetailData]);

  const topTableData = useMemo(() => {
    if (
      (year !== 2025 && year !== 2026) ||
      !monthlyData ||
      !effectiveRetailData ||
      !shipmentData ||
      !purchaseData ||
      monthlyData.dealer.rows.length === 0 ||
      effectiveRetailData.dealer.rows.length === 0 ||
      shipmentData.data.rows.length === 0 ||
      purchaseData.data.rows.length === 0
    ) {
      return null;
    }
    if (year === 2026 && brand === '전체') {
      if (BRANDS_TO_AGGREGATE.some((b) => !monthlyDataByBrand[b] || !retailDataByBrand[b] || !shipmentDataByBrand[b] || !purchaseDataByBrand[b])) {
        return null;
      }
      const perBrandTables: TopTablePair[] = BRANDS_TO_AGGREGATE.map((b) => {
        const mData = monthlyDataByBrand[b]!;
        const baseRetailData = retailDataByBrand[b]!;
        const sData = shipmentDataByBrand[b]!;
        const pData = purchaseDataByBrand[b];
        const prevMData = prevYearMonthlyDataByBrand[b];
        const prevRData = prevYearRetailDataByBrand[b];
        const prevSData = prevYearShipmentDataByBrand[b];
        const rData =
          prevMData && prevRData && prevSData
            ? applyAdjustedDealerRetailPlanBase(baseRetailData, prevMData, prevRData, prevSData, growthRate)
            : baseRetailData;
        const built = buildTableDataFromMonthly(mData, rData, sData, pData ?? undefined, year);
        const withWoi = applyAccTargetWoiOverlay(
          built.dealer,
          built.hq,
          rData,
          accTargetWoiDealer,
          accTargetWoiHq,
          accHqHoldingWoi,
          year,
        );
        const otbDealerSellIn = otbToDealerSellInPlan(otbData, b);
        const mergedSellOutPlan = { ...hqSellOutPlan, ...otbDealerSellIn };
        return applyHqSellInSellOutPlanOverlay(
          withWoi.dealer,
          withWoi.hq,
          annualPlanToHqSellInPlan(annualShipmentPlan2026, b),
          mergedSellOutPlan,
          year,
        );
      });
      return aggregateTopTables(perBrandTables, year);
    }

    const built = buildTableDataFromMonthly(
      monthlyData,
      effectiveRetailData,
      shipmentData,
      purchaseData ?? undefined,
      year,
    );
    if (year === 2026 && brand !== '전체') {
      const withWoi = applyAccTargetWoiOverlay(
        built.dealer,
        built.hq,
        effectiveRetailData,
        accTargetWoiDealer,
        accTargetWoiHq,
        accHqHoldingWoi,
        year,
      );
      const otbDealerSellIn = otbToDealerSellInPlan(otbData, brand as AnnualPlanBrand);
      const mergedSellOutPlan = {
        ...hqSellOutPlan,
        ...otbDealerSellIn,
      };
      return applyHqSellInSellOutPlanOverlay(
        withWoi.dealer,
        withWoi.hq,
        annualPlanToHqSellInPlan(annualShipmentPlan2026, brand as AnnualPlanBrand),
        mergedSellOutPlan,
        year,
      );
    }
    return built;
  }, [year, brand, monthlyData, effectiveRetailData, shipmentData, purchaseData, monthlyDataByBrand, retailDataByBrand, shipmentDataByBrand, purchaseDataByBrand, prevYearMonthlyDataByBrand, prevYearRetailDataByBrand, prevYearShipmentDataByBrand, annualShipmentPlan2026, accTargetWoiDealer, accTargetWoiHq, accHqHoldingWoi, hqSellOutPlan, growthRate, otbData]);

  const shouldUseTopTableOnly = year === 2025 || year === 2026;
  const dealerTableData = shouldUseTopTableOnly
    ? (topTableData?.dealer ?? null)
    : (topTableData?.dealer ?? data?.dealer ?? null);
  const hqTableData = shouldUseTopTableOnly
    ? (topTableData?.hq ?? null)
    : (topTableData?.hq ?? data?.hq ?? null);
  const purchaseAnnualTotalByRowKey = useMemo<Record<string, number | null> | null>(() => {
    if (year !== 2026 || !hqTableData) return null;
    const result: Record<string, number | null> = {};
    const leafRows = hqTableData.rows.filter((row) => row.isLeaf);
    const leafByKey = new Map(leafRows.map((row) => [row.key, row]));
    const sumLeafTotals = (keys: string[]): number | null => {
      const values = keys
        .map((key) => leafByKey.get(key)?.sellInTotal)
        .filter((value): value is number => value != null && Number.isFinite(value));
      if (values.length === 0) return null;
      return values.reduce((sum, value) => sum + value, 0) * 1000;
    };

    for (const row of leafRows) {
      result[row.key] = row.sellInTotal * 1000;
    }
    result['의류합계'] = sumLeafTotals(SEASON_KEYS);
    result['ACC합계'] = sumLeafTotals(ACC_KEYS);
    result['매입합계'] = sumLeafTotals([...SEASON_KEYS, ...ACC_KEYS]);
    return result;
  }, [year, hqTableData]);
  const dealerDriverTotalRow = dealerTableData?.rows.find((row) => row.isTotal) ?? null;
  const hqDriverTotalRow = hqTableData?.rows.find((row) => row.isTotal) ?? null;
  const buildBrand2026TopTable = useCallback((planBrand: AnnualPlanBrand): TopTablePair | null => {
    if (year !== 2026) return null;
    const mData = monthlyDataByBrand[planBrand] ?? (brand === planBrand ? monthlyData : null);
    const baseRetailData = retailDataByBrand[planBrand] ?? (brand === planBrand ? retailData : null);
    const sData = shipmentDataByBrand[planBrand] ?? (brand === planBrand ? shipmentData : null);
    const pData = purchaseDataByBrand[planBrand] ?? (brand === planBrand ? purchaseData : null);
    const prevMData = prevYearMonthlyDataByBrand[planBrand];
    const prevRData = prevYearRetailDataByBrand[planBrand];
    const prevSData = prevYearShipmentDataByBrand[planBrand];
    const rData =
      baseRetailData && prevMData && prevRData && prevSData
        ? applyAdjustedDealerRetailPlanBase(baseRetailData, prevMData, prevRData, prevSData, growthRate)
        : baseRetailData;
    if (!mData || !rData || !sData) return null;
    const built = buildTableDataFromMonthly(
      mData,
      rData,
      sData,
      pData ?? undefined,
      year,
    );
    const withWoi = applyAccTargetWoiOverlay(
      built.dealer,
      built.hq,
      rData,
      accTargetWoiDealer,
      accTargetWoiHq,
      accHqHoldingWoi,
      year,
    );
    const otbDealerSellIn = otbToDealerSellInPlan(otbData, planBrand);
    const mergedSellOutPlan = {
      ...hqSellOutPlan,
      ...otbDealerSellIn,
    };
    return applyHqSellInSellOutPlanOverlay(
      withWoi.dealer,
      withWoi.hq,
      annualPlanToHqSellInPlan(annualShipmentPlan2026, planBrand),
      mergedSellOutPlan,
      year,
    );
  }, [year, brand, monthlyDataByBrand, monthlyData, retailDataByBrand, retailData, shipmentDataByBrand, shipmentData, purchaseDataByBrand, purchaseData, prevYearMonthlyDataByBrand, prevYearRetailDataByBrand, prevYearShipmentDataByBrand, accTargetWoiDealer, accTargetWoiHq, accHqHoldingWoi, otbData, hqSellOutPlan, annualShipmentPlan2026, growthRate]);

  useEffect(() => {
    if (typeof window === 'undefined' || year !== 2026 || !dealerTableData) return;
    if (brand !== 'MLB' && brand !== 'MLB KIDS' && brand !== 'DISCOVERY') return;

    const accRow = dealerTableData.rows.find((r) => r.key === 'ACC합계');
    if (!accRow) return;

    const currentRaw = localStorage.getItem('inventory_dealer_acc_sellin');
    let currentValues: Record<'MLB' | 'MLB KIDS' | 'DISCOVERY', number> = {
      MLB: 0,
      'MLB KIDS': 0,
      DISCOVERY: 0,
    };
    try {
      const parsed = currentRaw ? JSON.parse(currentRaw) : null;
      if (parsed?.values) {
        currentValues = {
          MLB: Number(parsed.values.MLB) || 0,
          'MLB KIDS': Number(parsed.values['MLB KIDS']) || 0,
          DISCOVERY: Number(parsed.values.DISCOVERY) || 0,
        };
      }
    } catch {
      // ignore parse errors and overwrite with fresh value below
    }

    const nextValues = { ...currentValues, [brand]: accRow.sellInTotal };
    publishDealerAccSellIn(nextValues);
  }, [year, brand, dealerTableData, publishDealerAccSellIn]);

  // 2026 YOY: 전년(2025) 테이블 구성 → 재고자산합계 sellIn/sellOut/hqSales 추출
  useEffect(() => {
    if (typeof window === 'undefined' || year !== 2026) return;

    if (brand !== 'MLB' && brand !== 'MLB KIDS' && brand !== 'DISCOVERY') {
      const nextValues: Partial<HqClosingByBrand> = {};
      for (const planBrand of ANNUAL_PLAN_BRANDS) {
        const table = buildBrand2026TopTable(planBrand);
        const totalRow = table?.hq.rows.find((row) => row.isTotal);
        if (totalRow && Number.isFinite(totalRow.closing)) {
          nextValues[planBrand] = totalRow.closing;
        }
      }
      if (Object.keys(nextValues).length > 0) {
        publishHqClosingByBrand(nextValues);
      }
      return;
    }

    if (!hqTableData) return;
    const totalRow = hqTableData.rows.find((row) => row.isTotal);
    if (!totalRow || !Number.isFinite(totalRow.closing)) return;
    publishHqClosingByBrand({ [brand]: totalRow.closing });
  }, [year, brand, hqTableData, buildBrand2026TopTable, publishHqClosingByBrand]);
  const prevYearTableData = useMemo(() => {
    if (year !== 2026 || !prevYearMonthlyData || !prevYearRetailData || !prevYearShipmentData) return null;
    return buildTableDataFromMonthly(
      prevYearMonthlyData,
      prevYearRetailData,
      prevYearShipmentData,
      prevYearPurchaseData ?? undefined,
      year - 1,
    );
  }, [year, prevYearMonthlyData, prevYearRetailData, prevYearShipmentData, prevYearPurchaseData]);
  const prevYearHqDriverTotalRow = prevYearTableData?.hq.rows.find((row) => row.isTotal) ?? null;
  const plLatestActualMonth = useMemo(() => {
    if (plActualAvailableMonths.length === 0) return 0;
    return Math.max(...plActualAvailableMonths);
  }, [plActualAvailableMonths]);
  const shipmentPlanFromMonth = year === 2026 && plLatestActualMonth < 12 ? plLatestActualMonth + 1 : undefined;
  const effectiveShipmentDisplayData = useMemo<TableData | null>(() => {
    if (!shipmentData) return null;
    if (
      year !== 2026 ||
      brand === '전체' ||
      shipmentPlanFromMonth == null ||
      shipmentPlanFromMonth <= 1 ||
      !hqTableData
    ) {
      return shipmentData.data as TableData;
    }

    const brandKey = brand as AnnualPlanBrand;
    const progressS = shipmentProgressRows.find((row) => row.brand === brandKey && row.season === '당년S');
    const progressF = shipmentProgressRows.find((row) => row.brand === brandKey && row.season === '당년F');
    const accRatio = accShipmentRatioRows.find((row) => row.brand === brandKey)?.monthly ?? new Array(12).fill(null);
    const seasonSRates = buildShipmentProgressRates(progressS);
    const seasonFRates = buildShipmentProgressRates(progressF);
    const hqByKey = new Map(hqTableData.rows.map((row) => [row.key, row]));
    const planStartIndex = shipmentPlanFromMonth - 1;

    const leafRows = shipmentData.data.rows
      .filter((row) => row.isLeaf)
      .map((row) => {
        const annualTarget = (hqByKey.get(row.key)?.sellOutTotal ?? 0) * 1000;
        const monthly = [...row.monthly];
        const actualSum = monthly.slice(0, planStartIndex).reduce<number>((sum, value) => sum + (value ?? 0), 0);
        const remaining = annualTarget - actualSum;
        const rawWeights = monthly.map((_, monthIndex) => {
          if (monthIndex < planStartIndex) return 0;
          if (row.key === '당년S') return seasonSRates[monthIndex] ?? 0;
          if (ACC_KEYS.includes(row.key as AccKey)) return Math.max(accRatio[monthIndex] ?? 0, 0);
          return seasonFRates[monthIndex] ?? 0;
        });
        const weightTotal = rawWeights.reduce((sum, value) => sum + value, 0);
        const usableWeights =
          weightTotal > 0
            ? rawWeights
            : rawWeights.map((_, monthIndex) => (monthIndex < planStartIndex ? 0 : 1));
        const usableTotal = usableWeights.reduce((sum, value) => sum + value, 0);
        let allocatedSum = 0;
        let lastPlanMonth = -1;
        for (let monthIndex = planStartIndex; monthIndex < 12; monthIndex += 1) {
          if (usableWeights[monthIndex] > 0) lastPlanMonth = monthIndex;
        }
        for (let monthIndex = planStartIndex; monthIndex < 12; monthIndex += 1) {
          if (monthIndex === lastPlanMonth) {
            monthly[monthIndex] = remaining - allocatedSum;
            continue;
          }
          const nextValue = usableTotal > 0 ? Math.round((remaining * usableWeights[monthIndex]) / usableTotal) : 0;
          monthly[monthIndex] = nextValue;
          allocatedSum += nextValue;
        }
        return { ...row, monthly };
      });

    const sumMonth = (rows: typeof leafRows, monthIndex: number): number | null => {
      const values = rows
        .map((row) => row.monthly[monthIndex] ?? null)
        .filter((value): value is number => value != null && Number.isFinite(value));
      return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : null;
    };
    const clothingLeafRows = leafRows.slice(0, 6);
    const accLeafRows = leafRows.slice(6);
    const totalTemplate = shipmentData.data.rows.find((row) => row.isTotal);
    const subtotalTemplates = shipmentData.data.rows.filter((row) => row.isSubtotal);
    const clothingSubtotalTemplate = subtotalTemplates[0] ?? null;
    const accSubtotalTemplate = subtotalTemplates[1] ?? null;
    const clothingSubtotal =
      clothingSubtotalTemplate == null
        ? null
        : {
            ...clothingSubtotalTemplate,
            monthly: clothingSubtotalTemplate.monthly.map((_, monthIndex) => sumMonth(clothingLeafRows, monthIndex)),
          };
    const accSubtotal =
      accSubtotalTemplate == null
        ? null
        : {
            ...accSubtotalTemplate,
            monthly: accSubtotalTemplate.monthly.map((_, monthIndex) => sumMonth(accLeafRows, monthIndex)),
          };
    const grandTotal =
      totalTemplate == null
        ? null
        : {
            ...totalTemplate,
            monthly: totalTemplate.monthly.map((_, monthIndex) => sumMonth(leafRows, monthIndex)),
          };

    return {
      rows: [
        ...(grandTotal ? [grandTotal] : []),
        ...(clothingSubtotal ? [clothingSubtotal] : []),
        ...clothingLeafRows,
        ...(accSubtotal ? [accSubtotal] : []),
        ...accLeafRows,
      ],
    };
  }, [year, brand, shipmentData, shipmentPlanFromMonth, hqTableData, shipmentProgressRows, accShipmentRatioRows]);
  const shipmentValidationByRowKey = useMemo<Record<string, number | null> | null>(() => {
    if (year !== 2026 || brand === '전체' || !effectiveShipmentDisplayData) return null;
    const result: Record<string, number | null> = {};
    for (const row of effectiveShipmentDisplayData.rows) {
      void row;
      result[row.key] = 0;
    }
    return result;
  }, [year, brand, effectiveShipmentDisplayData]);
  const effectivePurchaseDisplayData = useMemo<TableData | null>(() => {
    if (
      !purchaseData ||
      !effectiveShipmentDisplayData ||
      year !== 2026 ||
      shipmentPlanFromMonth == null ||
      shipmentPlanFromMonth <= 1
    ) {
      return purchaseData?.data as TableData | null;
    }

    const annualByKey = purchaseAnnualTotalByRowKey ?? {};
    const shipmentByKey = new Map(effectiveShipmentDisplayData.rows.map((row) => [row.key, row]));
    const planStartIndex = shipmentPlanFromMonth - 1;

    const leafRows = purchaseData.data.rows
      .filter((row) => row.isLeaf)
      .map((row) => {
        const monthly = [...row.monthly];
        const annualTarget = annualByKey[row.key] ?? null;
        if (annualTarget == null) return { ...row, monthly };

        const actualSum = monthly
          .slice(0, planStartIndex)
          .reduce<number>((sum, value) => sum + (value ?? 0), 0);
        const remaining = annualTarget - actualSum;
        const shipmentMonthly = shipmentByKey.get(row.key)?.monthly ?? [];
        const rawWeights = monthly.map((_, monthIndex) => {
          if (monthIndex < planStartIndex) return 0;
          return Math.max(shipmentMonthly[monthIndex] ?? 0, 0);
        });
        const weightTotal = rawWeights.reduce((sum, value) => sum + value, 0);
        const usableWeights =
          weightTotal > 0
            ? rawWeights
            : rawWeights.map((_, monthIndex) => (monthIndex < planStartIndex ? 0 : 1));
        const usableTotal = usableWeights.reduce((sum, value) => sum + value, 0);

        let assigned = 0;
        for (let monthIndex = planStartIndex; monthIndex < 12; monthIndex += 1) {
          if (usableTotal <= 0) {
            monthly[monthIndex] = 0;
            continue;
          }
          if (monthIndex === 11) {
            monthly[monthIndex] = remaining - assigned;
          } else {
            const nextValue = Math.round((remaining * usableWeights[monthIndex]) / usableTotal);
            monthly[monthIndex] = nextValue;
            assigned += nextValue;
          }
        }

        return { ...row, monthly };
      });

    const sumMonth = (rows: typeof leafRows, monthIndex: number): number | null => {
      const values = rows
        .map((row) => row.monthly[monthIndex] ?? null)
        .filter((value): value is number => value != null && Number.isFinite(value));
      if (values.length === 0) return null;
      return values.reduce((sum, value) => sum + value, 0);
    };

    const clothingLeafRows = leafRows.slice(0, 6);
    const accLeafRows = leafRows.slice(6);
    const totalTemplate = purchaseData.data.rows.find((row) => row.isTotal) ?? null;
    const subtotalTemplates = purchaseData.data.rows.filter((row) => row.isSubtotal);
    const clothingSubtotalTemplate = subtotalTemplates[0] ?? null;
    const accSubtotalTemplate = subtotalTemplates[1] ?? null;
    const clothingSubtotal =
      clothingSubtotalTemplate == null
        ? null
        : {
            ...clothingSubtotalTemplate,
            monthly: clothingSubtotalTemplate.monthly.map((_, monthIndex) => sumMonth(clothingLeafRows, monthIndex)),
          };
    const accSubtotal =
      accSubtotalTemplate == null
        ? null
        : {
            ...accSubtotalTemplate,
            monthly: accSubtotalTemplate.monthly.map((_, monthIndex) => sumMonth(accLeafRows, monthIndex)),
          };
    const grandTotal =
      totalTemplate == null
        ? null
        : {
            ...totalTemplate,
            monthly: totalTemplate.monthly.map((_, monthIndex) => sumMonth(leafRows, monthIndex)),
          };

    return {
      rows: [
        ...(grandTotal ? [grandTotal] : []),
        ...(clothingSubtotal ? [clothingSubtotal] : []),
        ...clothingLeafRows,
        ...(accSubtotal ? [accSubtotal] : []),
        ...accLeafRows,
      ],
    };
  }, [year, purchaseData, effectiveShipmentDisplayData, shipmentPlanFromMonth, purchaseAnnualTotalByRowKey]);
  const purchaseValidationByRowKey = useMemo<Record<string, number | null> | null>(() => {
    if (year !== 2026 || !effectivePurchaseDisplayData || !purchaseAnnualTotalByRowKey) return null;
    const result: Record<string, number | null> = {};
    for (const row of effectivePurchaseDisplayData.rows) {
      const monthlySum = row.monthly.reduce<number>((sum, value) => sum + (value ?? 0), 0);
      const annualTarget = purchaseAnnualTotalByRowKey[row.key];
      result[row.key] = annualTarget == null ? null : monthlySum - annualTarget;
    }
    return result;
  }, [year, effectivePurchaseDisplayData, purchaseAnnualTotalByRowKey]);
  const monthlyPlanFromMonth = useMemo(() => {
    if (year !== 2026 || brand === '전체' || !monthlyData) return undefined;
    const closedThrough = monthlyData.closedThrough ?? '';
    const closedMonth =
      closedThrough.length >= 6 && closedThrough.startsWith(String(year))
        ? Number(closedThrough.slice(4, 6))
        : NaN;
    if (!Number.isInteger(closedMonth) || closedMonth < 1 || closedMonth >= 12) return undefined;
    return closedMonth + 1;
  }, [year, brand, monthlyData]);
  const monthlyPlanSummaryText = useMemo(() => {
    if (year !== 2026 || brand === '전체' || monthlyPlanFromMonth == null) return null;
    const actualEndMonth = monthlyPlanFromMonth - 1;
    const actualText =
      actualEndMonth <= 1 ? '1월: 실적 고정' : `1~${actualEndMonth}월: 실적 고정`;
    const adjustmentText =
      monthlyPlanFromMonth <= 11 ? `${monthlyPlanFromMonth}~11월` : `${monthlyPlanFromMonth}월`;
    return `${actualText}, 12월에서 거꾸로 역산 후 연간 차액은 ${adjustmentText}에서 보정`;
  }, [year, brand, monthlyPlanFromMonth]);
  const monthlyPlanLegendText = useMemo(() => {
    if (year !== 2026 || brand === '전체' || monthlyPlanFromMonth == null) return null;
    const actualEndMonth = monthlyPlanFromMonth - 1;
    const actualText =
      actualEndMonth <= 1 ? '1월: 실적 고정' : `1~${actualEndMonth}월: 실적 고정`;
    const reverseStartText = `12월 기말: 상단 재고자산표 기말로 고정 / 11~${monthlyPlanFromMonth}월: 12월에서 거꾸로 역산`;
    const adjustmentText =
      monthlyPlanFromMonth <= 11
        ? `이후 ${actualEndMonth}월 실적과 역산된 ${monthlyPlanFromMonth}월 사이의 연결 차이(gap)를 ${monthlyPlanFromMonth}~11월 계획월에 비중으로 분산 보정`
        : `이후 ${actualEndMonth}월 실적과 역산된 ${monthlyPlanFromMonth}월 사이의 연결 차이(gap)를 ${monthlyPlanFromMonth}월에 반영`;
    return `${actualText} / ${reverseStartText} / ${adjustmentText} / 최종적으로 ${actualEndMonth}월까지는 실적 유지, 12월은 목표 기말 유지, ${monthlyPlanFromMonth}~11월만 중간 연결용으로 조정`;
  }, [year, brand, monthlyPlanFromMonth]);
  const effectiveDealerMonthlyDisplayData = useMemo<TableData | null>(() => {
    if (
      !monthlyData ||
      !effectiveShipmentDisplayData ||
      !effectiveRetailData ||
      year !== 2026 ||
      brand === '전체' ||
      monthlyPlanFromMonth == null ||
      monthlyPlanFromMonth <= 1
    ) {
      return monthlyData?.dealer as TableData | null;
    }
    const shipmentByKey = new Map(effectiveShipmentDisplayData.rows.map((row) => [row.key, row]));
    const retailByKey = new Map(effectiveRetailData.dealer.rows.map((row) => [row.key, row]));
    const dealerClosingByKey = new Map(
      (dealerTableData?.rows ?? []).map((row) => [row.key, row.closing * 1000]),
    );
    const planStartIndex = monthlyPlanFromMonth - 1;
    const leafRows = monthlyData.dealer.rows
      .filter((row) => row.isLeaf)
      .map((row) => {
        const monthly = [...row.monthly];
        let prevClosing = row.opening;
        for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
          const currentBase = monthly[monthIndex] ?? null;
          if (currentBase != null) prevClosing = currentBase;
          if (monthIndex < planStartIndex) continue;
          const shipVal = shipmentByKey.get(row.key)?.monthly[monthIndex] ?? 0;
          const retailVal = retailByKey.get(row.key)?.monthly[monthIndex] ?? 0;
          if (prevClosing == null) {
            monthly[monthIndex] = null;
          } else {
            monthly[monthIndex] = prevClosing + shipVal - retailVal;
            prevClosing = monthly[monthIndex];
          }
        }
        const targetClosing = dealerClosingByKey.get(row.key) ?? null;
        const currentClosing = monthly[11] ?? null;
        if (targetClosing != null && currentClosing != null) {
          const gap = targetClosing - currentClosing;
          if (gap !== 0) {
            const rawWeights = monthly.map((_, monthIndex) => {
              if (monthIndex < planStartIndex) return 0;
              const shipVal = Math.max(shipmentByKey.get(row.key)?.monthly[monthIndex] ?? 0, 0);
              const retailVal = Math.max(retailByKey.get(row.key)?.monthly[monthIndex] ?? 0, 0);
              return shipVal + retailVal;
            });
            const weightTotal = rawWeights.reduce((sum, value) => sum + value, 0);
            const usableWeights =
              weightTotal > 0
                ? rawWeights
                : rawWeights.map((_, monthIndex) => (monthIndex < planStartIndex ? 0 : 1));
            const usableTotal = usableWeights.reduce((sum, value) => sum + value, 0);
            let assigned = 0;
            let cumulativeAdjustment = 0;
            for (let monthIndex = planStartIndex; monthIndex < 12; monthIndex += 1) {
              const monthAdjustment =
                usableTotal <= 0
                  ? 0
                  : monthIndex === 11
                    ? gap - assigned
                    : Math.round((gap * usableWeights[monthIndex]) / usableTotal);
              assigned += monthAdjustment;
              cumulativeAdjustment += monthAdjustment;
              const currentValue = monthly[monthIndex];
              if (currentValue != null) {
                monthly[monthIndex] = currentValue + cumulativeAdjustment;
              }
            }
          }
        }
        return { ...row, monthly };
      });
    const sumMonth = (rows: typeof leafRows, monthIndex: number): number | null => {
      const values = rows
        .map((row) => row.monthly[monthIndex] ?? null)
        .filter((value): value is number => value != null && Number.isFinite(value));
      return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : null;
    };
    const sumOpening = (rows: typeof leafRows): number | null => {
      const values = rows
        .map((row) => row.opening ?? null)
        .filter((value): value is number => value != null && Number.isFinite(value));
      return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : null;
    };
    const clothingLeafRows = leafRows.slice(0, 6);
    const accLeafRows = leafRows.slice(6);
    const totalTemplate = monthlyData.dealer.rows.find((row) => row.isTotal);
    const subtotalTemplates = monthlyData.dealer.rows.filter((row) => row.isSubtotal);
    const clothingSubtotalTemplate = subtotalTemplates[0] ?? null;
    const accSubtotalTemplate = subtotalTemplates[1] ?? null;
    const clothingSubtotal =
      clothingSubtotalTemplate == null
        ? null
        : {
            ...clothingSubtotalTemplate,
            opening: sumOpening(clothingLeafRows),
            monthly: clothingSubtotalTemplate.monthly.map((_, monthIndex) => sumMonth(clothingLeafRows, monthIndex)),
          };
    const accSubtotal =
      accSubtotalTemplate == null
        ? null
        : {
            ...accSubtotalTemplate,
            opening: sumOpening(accLeafRows),
            monthly: accSubtotalTemplate.monthly.map((_, monthIndex) => sumMonth(accLeafRows, monthIndex)),
          };
    const grandTotal =
      totalTemplate == null
        ? null
        : {
            ...totalTemplate,
            opening: sumOpening(leafRows),
            monthly: totalTemplate.monthly.map((_, monthIndex) => sumMonth(leafRows, monthIndex)),
          };
    if (clothingSubtotal && dealerClosingByKey.has('의류합계')) {
      clothingSubtotal.monthly[11] = dealerClosingByKey.get('의류합계') ?? clothingSubtotal.monthly[11];
    }
    if (accSubtotal && dealerClosingByKey.has('ACC합계')) {
      accSubtotal.monthly[11] = dealerClosingByKey.get('ACC합계') ?? accSubtotal.monthly[11];
    }
    if (grandTotal && dealerClosingByKey.has('재고자산합계')) {
      grandTotal.monthly[11] = dealerClosingByKey.get('재고자산합계') ?? grandTotal.monthly[11];
    }
    return {
      rows: [
        ...(grandTotal ? [grandTotal] : []),
        ...(clothingSubtotal ? [clothingSubtotal] : []),
        ...clothingLeafRows,
        ...(accSubtotal ? [accSubtotal] : []),
        ...accLeafRows,
      ],
    };
  }, [year, brand, monthlyData, monthlyPlanFromMonth, effectiveShipmentDisplayData, effectiveRetailData, dealerTableData]);
  const effectiveHqMonthlyDisplayData = useMemo<TableData | null>(() => {
    if (
      !monthlyData ||
      !effectivePurchaseDisplayData ||
      !effectiveShipmentDisplayData ||
      !effectiveRetailData ||
      year !== 2026 ||
      brand === '전체' ||
      monthlyPlanFromMonth == null ||
      monthlyPlanFromMonth <= 1
    ) {
      return monthlyData?.hq as TableData | null;
    }
    const purchaseByKey = new Map(effectivePurchaseDisplayData.rows.map((row) => [row.key, row]));
    const shipmentByKey = new Map(effectiveShipmentDisplayData.rows.map((row) => [row.key, row]));
    const retailByKey = new Map(effectiveRetailData.hq.rows.map((row) => [row.key, row]));
    const hqClosingByKey = new Map(
      (hqTableData?.rows ?? []).map((row) => [row.key, row.closing * 1000]),
    );
    const planStartIndex = monthlyPlanFromMonth - 1;
    const leafRows = monthlyData.hq.rows
      .filter((row) => row.isLeaf)
      .map((row) => {
        const monthly = [...row.monthly];
        const targetClosing = hqClosingByKey.get(row.key) ?? null;
        const actualBoundaryClosing = planStartIndex > 0 ? (monthly[planStartIndex - 1] ?? null) : (row.opening ?? null);
        if (targetClosing != null) {
          monthly[11] = targetClosing;
          let impliedBoundaryClosing: number | null = null;
          for (let monthIndex = 11; monthIndex >= planStartIndex; monthIndex -= 1) {
            const currentClosing = monthly[monthIndex] ?? null;
            if (currentClosing == null) continue;
            const purchaseVal = purchaseByKey.get(row.key)?.monthly[monthIndex] ?? 0;
            const shipVal = shipmentByKey.get(row.key)?.monthly[monthIndex] ?? 0;
            const retailVal = retailByKey.get(row.key)?.monthly[monthIndex] ?? 0;
            const prevClosing = currentClosing - purchaseVal + shipVal + retailVal;
            if (monthIndex - 1 >= planStartIndex) {
              monthly[monthIndex - 1] = prevClosing;
            } else {
              impliedBoundaryClosing = prevClosing;
            }
          }

          if (actualBoundaryClosing != null && impliedBoundaryClosing != null) {
            const gap = actualBoundaryClosing - impliedBoundaryClosing;
            if (gap !== 0) {
              const tailMonths = Array.from({ length: Math.max(0, 11 - planStartIndex) }, (_, index) => planStartIndex + 1 + index);
              const rawWeights = tailMonths.map((monthIndex) => {
                const purchaseVal = Math.max(purchaseByKey.get(row.key)?.monthly[monthIndex] ?? 0, 0);
                const shipVal = Math.max(shipmentByKey.get(row.key)?.monthly[monthIndex] ?? 0, 0);
                const retailVal = Math.max(retailByKey.get(row.key)?.monthly[monthIndex] ?? 0, 0);
                return purchaseVal + shipVal + retailVal;
              });
              const weightTotal = rawWeights.reduce((sum, value) => sum + value, 0);
              const usableWeights =
                weightTotal > 0
                  ? rawWeights
                  : rawWeights.map(() => 1);
              const usableTotal = usableWeights.reduce((sum, value) => sum + value, 0);
              const portionByMonth = new Map<number, number>();
              let assigned = 0;
              tailMonths.forEach((monthIndex, index) => {
                const portion =
                  usableTotal <= 0
                    ? 0
                    : index === tailMonths.length - 1
                      ? gap - assigned
                      : Math.round((gap * usableWeights[index]) / usableTotal);
                assigned += portion;
                portionByMonth.set(monthIndex, portion);
              });

              let runningAdjustment = gap;
              for (let monthIndex = planStartIndex; monthIndex < 12; monthIndex += 1) {
                const currentValue = monthly[monthIndex];
                if (currentValue != null) {
                  monthly[monthIndex] = currentValue + runningAdjustment;
                }
                if (monthIndex < 11) {
                  runningAdjustment -= portionByMonth.get(monthIndex + 1) ?? 0;
                }
              }
            }
          }
        }
        return { ...row, monthly };
      });
    const sumMonth = (rows: typeof leafRows, monthIndex: number): number | null => {
      const values = rows
        .map((row) => row.monthly[monthIndex] ?? null)
        .filter((value): value is number => value != null && Number.isFinite(value));
      if (values.length === 0) return null;
      return values.reduce((sum, value) => sum + value, 0);
    };
    const clothingLeafRows = leafRows.slice(0, 6);
    const accLeafRows = leafRows.slice(6);
    const totalTemplate = monthlyData.hq.rows.find((row) => row.isTotal) ?? null;
    const subtotalTemplates = monthlyData.hq.rows.filter((row) => row.isSubtotal);
    const clothingSubtotalTemplate = subtotalTemplates[0] ?? null;
    const accSubtotalTemplate = subtotalTemplates[1] ?? null;
    const clothingSubtotal =
      clothingSubtotalTemplate == null
        ? null
        : {
            ...clothingSubtotalTemplate,
            monthly: clothingSubtotalTemplate.monthly.map((_, monthIndex) => sumMonth(clothingLeafRows, monthIndex)),
          };
    const accSubtotal =
      accSubtotalTemplate == null
        ? null
        : {
            ...accSubtotalTemplate,
            monthly: accSubtotalTemplate.monthly.map((_, monthIndex) => sumMonth(accLeafRows, monthIndex)),
          };
    const grandTotal =
      totalTemplate == null
        ? null
        : {
            ...totalTemplate,
            monthly: totalTemplate.monthly.map((_, monthIndex) => sumMonth(leafRows, monthIndex)),
          };
    if (clothingSubtotal && hqClosingByKey.has('의류합계')) {
      clothingSubtotal.monthly[11] = hqClosingByKey.get('의류합계') ?? clothingSubtotal.monthly[11];
    }
    if (accSubtotal && hqClosingByKey.has('ACC합계')) {
      accSubtotal.monthly[11] = hqClosingByKey.get('ACC합계') ?? accSubtotal.monthly[11];
    }
    if (grandTotal && hqClosingByKey.has('재고자산합계')) {
      grandTotal.monthly[11] = hqClosingByKey.get('재고자산합계') ?? grandTotal.monthly[11];
    }

    return {
      rows: [
        ...(grandTotal ? [grandTotal] : []),
        ...(clothingSubtotal ? [clothingSubtotal] : []),
        ...clothingLeafRows,
        ...(accSubtotal ? [accSubtotal] : []),
        ...accLeafRows,
      ],
    };
  }, [year, brand, monthlyData, monthlyPlanFromMonth, effectivePurchaseDisplayData, effectiveShipmentDisplayData, effectiveRetailData, hqTableData]);
  useEffect(() => {
    if (typeof window === 'undefined' || year !== 2026) return;
    if (brand !== 'MLB' && brand !== 'MLB KIDS' && brand !== 'DISCOVERY') return;
    if (!effectiveDealerMonthlyDisplayData || !effectiveHqMonthlyDisplayData) return;

    const hqTotalRow = effectiveHqMonthlyDisplayData.rows.find((row) => row.isTotal);
    if (!hqTotalRow) return;

    const monthly = Array.from({ length: 12 }, (_, monthIndex) => {
      const hqValue = hqTotalRow.monthly[monthIndex];
      return hqValue ?? null;
    });

    publishMonthlyInventoryTotalByBrand({ [brand]: monthly });
  }, [year, brand, effectiveDealerMonthlyDisplayData, effectiveHqMonthlyDisplayData, publishMonthlyInventoryTotalByBrand]);
  const yoyPending = year === 2026 && !prevYearError && (prevYearLoading || !prevYearTableData);
  const statusLoading = loading || monthlyLoading || retailLoading || shipmentLoading || purchaseLoading || recalcLoading || yoyPending;
  const statusError = !!error || !!monthlyError || !!retailError || !!shipmentError || !!purchaseError || prevYearError;
  const statusErrorMessage = error || monthlyError || retailError || shipmentError || purchaseError || prevYearError || null;

  // 2026 ACC ???ш퀬二쇱닔 ?몄쭛 ???곹깭 諛섏쁺 (??? ?먮뒗 湲곕낯媛?釉붾줉怨??곕룞)
  const handleWoiChange = useCallback((tableType: 'dealer' | 'hq', rowKey: string, newWoi: number) => {
    if (!ACC_KEYS.includes(rowKey as AccKey)) return;
    if (tableType === 'dealer') {
      setAccTargetWoiDealer((prev) => {
        const next = { ...prev, [rowKey]: newWoi };
        accTargetWoiDealerRef.current = next;
        return next;
      });
    } else {
      setAccTargetWoiHq((prev) => {
        const next = { ...prev, [rowKey]: newWoi };
        accTargetWoiHqRef.current = next;
        return next;
      });
    }
  }, []);

  // 2026 蹂몄궗 ?由ъ긽異쒓퀬(?곌컙) ?몄쭛 ???由ъ긽 ??Sell-in???먮룞 諛섏쁺
  const handleHqHoldingWoiChange = useCallback((rowKey: AccKey, newWoi: number) => {
    setAccHqHoldingWoi((prev) => {
      const next = { ...prev, [rowKey]: newWoi };
      accHqHoldingWoiRef.current = next;
      return next;
    });
  }, []);

  const handleHqSellOutChange = useCallback((rowKey: RowKey, newSellOutTotal: number) => {
    setHqSellOutPlan((prev) => ({ ...prev, [rowKey]: newSellOutTotal }));
  }, []);

  // 저장 시 월별 재고잔액·리테일 매출·출고·매입 4개만 저장
  const handleSave = useCallback(async () => {
    if (!monthlyData || !retailData || !shipmentData || !purchaseData) return;
    if (year === 2026) {
      setSnapshotSaved(false);
      setSnapshotSavedAt(null);
      return;
    }
    const retailActuals =
      year === 2026 && retailData.planFromMonth
        ? stripPlanMonths(retailData, retailData.planFromMonth)
        : retailData;
    const snap: SnapshotData = {
      monthly: monthlyData,
      retailActuals,
      retail2025: retailData.retail2025 ?? retail2025Ref.current ?? null,
      shipment: shipmentData,
      purchase: purchaseData,
      savedAt: new Date().toISOString(),
      planFromMonth: retailData.planFromMonth,
    };
    saveSnapshot(year, brand, snap);
    await saveSnapshotToServer(year, brand, snap);
    setSnapshotSaved(true);
    setSnapshotSavedAt(snap.savedAt);
  }, [year, brand, monthlyData, retailData, shipmentData, purchaseData]);

  // ?? ?ш퀎????
  const handleRecalc = useCallback(async (mode: 'current' | 'annual') => {
    setRecalcLoading(true);
    try {
      // mode? ?? ?? ???? ??, ??? ?? ?? ??? ?? ????? ??
      void mode;

      if (brand !== 'MLB' && brand !== 'MLB KIDS' && brand !== 'DISCOVERY') {
        await Promise.all([
          fetchMonthlyData(),
          fetchRetailData(),
          fetchShipmentData(),
          fetchPurchaseData(),
        ]);
        setSnapshotSaved(false);
        setSnapshotSavedAt(null);
        return;
      }

      const [fm, fr, fs, fp] = await Promise.all([
        fetch(`/api/inventory/monthly-stock?${new URLSearchParams({ year: String(year), brand })}`).then(
          (r) => r.json() as Promise<MonthlyStockResponse & { error?: string }>,
        ),
        fetch(`/api/inventory/retail-sales?${new URLSearchParams({ year: String(year), brand, growthRate: String(growthRate), growthRateHq: String(growthRateHq) })}`).then(
          (r) => r.json() as Promise<RetailSalesResponse & { error?: string }>,
        ),
        fetch(`/api/inventory/shipment-sales?${new URLSearchParams({ year: String(year), brand })}`).then(
          (r) => r.json() as Promise<ShipmentSalesResponse & { error?: string }>,
        ),
        fetch(`/api/inventory/purchase?${new URLSearchParams({ year: String(year), brand })}`).then(
          (r) => r.json() as Promise<PurchaseResponse & { error?: string }>,
        ),
      ]);

      if (fm.error) throw new Error(fm.error);
      if (fr.error) throw new Error(fr.error);
      if (fs.error) throw new Error(fs.error);
      if (fp.error) throw new Error(fp.error);

      setMonthlyData(fm);
      setRetailData(fr);
      setShipmentData(fs);
      setPurchaseData(fp);
      monthlyByBrandRef.current[brand as LeafBrand] = fm;
      retailByBrandRef.current[brand as LeafBrand] = fr;
      shipmentByBrandRef.current[brand as LeafBrand] = fs;
      purchaseByBrandRef.current[brand as LeafBrand] = fp;
      if (fr.retail2025) retail2025Ref.current = fr.retail2025;

      if (year === 2026) {
        setSnapshotSaved(false);
        setSnapshotSavedAt(null);
        return;
      }

      const retailActuals =
        year === 2026 && fr.planFromMonth
          ? stripPlanMonths(fr, fr.planFromMonth)
          : fr;

      const freshSnapshot: SnapshotData = {
        monthly: fm,
        retailActuals,
        retail2025: fr.retail2025 ?? null,
        shipment: fs,
        purchase: fp,
        savedAt: new Date().toISOString(),
        planFromMonth: fr.planFromMonth,
      };

      saveSnapshot(year, brand, freshSnapshot);
      await saveSnapshotToServer(year, brand, freshSnapshot);
      setSnapshotSaved(true);
      setSnapshotSavedAt(freshSnapshot.savedAt);
    } catch (e) {
      console.error('[recalc] error:', e);
    } finally {
      setRecalcLoading(false);
    }
  }, [year, brand, growthRate, growthRateHq, fetchMonthlyData, fetchRetailData, fetchShipmentData, fetchPurchaseData]);

  const handleAnnualPlanCellChange = useCallback((planBrand: AnnualPlanBrand, season: AnnualPlanSeason, value: string) => {
    if (!annualPlanEditMode) return;
    const numeric = parseInt(value.replace(/[^\d-]/g, ''), 10);
    const nextValue = Number.isNaN(numeric) ? 0 : numeric;
    setAnnualShipmentPlanDraft2026((prev) => ({
      ...prev,
      [planBrand]: {
        ...prev[planBrand],
        [season]: nextValue,
      },
    }));
  }, [annualPlanEditMode]);

  const handleAnnualPlanEditStart = useCallback(() => {
    setAnnualShipmentPlanDraft2026(annualShipmentPlan2026);
    setAnnualPlanEditMode(true);
  }, [annualShipmentPlan2026]);

  const handleAnnualPlanSave = useCallback(async () => {
    setAnnualShipmentPlan2026(annualShipmentPlanDraft2026);
    setAnnualPlanEditMode(false);
    await saveAnnualPlanToServer(2026, annualShipmentPlanDraft2026);
  }, [annualShipmentPlanDraft2026]);

  return (
    <div className="bg-gray-50 overflow-auto h-[calc(100vh-64px)]">
      <InventoryFilterBar
        year={year}
        brand={brand}
        onYearChange={setYear}
        onBrandChange={setBrand}
        snapshotSaved={snapshotSaved}
        snapshotSavedAt={snapshotSavedAt}
        recalcLoading={recalcLoading}
        statusLoading={statusLoading}
        statusError={statusError}
        onSave={handleSave}
        onRecalc={handleRecalc}
        canSave={!!(monthlyData && retailData && shipmentData && purchaseData)}
      />

      <div className="px-6 py-5">
        {/* ?? 湲곗〈 Sell-in / Sell-out ???? */}
        {statusLoading && !dealerTableData && (
            <div className="flex items-center justify-center py-20 text-gray-400 text-sm">
              로딩 중...
            </div>
        )}
        {statusErrorMessage && !statusLoading && !dealerTableData && (
          <div className="py-10 text-center text-red-500 text-sm">{statusErrorMessage}</div>
        )}
        {dealerTableData && hqTableData && (
          <>
            <div className="flex flex-wrap items-start" style={{ gap: '1.5%', paddingLeft: '1.5%', paddingRight: '1.5%' }}>
            <div className="min-w-0" style={{ flex: '0 0 46.15%', minWidth: '320px' }}>
              <InventoryTable
                title="대리상 (CNY K)"
                titleRight={
                  <GrowthRateControl
                    label="대리상 성장률"
                    labelCn="FR 成长率"
                    value={100 + growthRate}
                    onChange={(v) => setGrowthRate(v)}
                    title="대리상 리테일 계획매출 전년 대비 성장률"
                  />
                }
                data={dealerTableData!}
                year={year}
                sellInLabel="Sell-in"
                sellOutLabel="Sell-out"
                tableType="dealer"
                prevYearData={prevYearTableData?.dealer ?? null}
                onWoiChange={year === 2026 && brand !== '전체' ? handleWoiChange : undefined}
                use2025Legend={year === 2026 && brand === '전체'}
                prevYearTotalOpening={(() => {
                  const v = prevYearMonthlyData?.dealer.rows.find((r) => r.key === '재고자산합계')?.opening;
                  return v != null ? v / 1000 : undefined;
                })()}
                prevYearTotalSellIn={prevYearTableData?.dealer.rows.find((r) => r.key === '재고자산합계')?.sellInTotal}
                prevYearTotalSellOut={prevYearTableData?.dealer.rows.find((r) => r.key === '재고자산합계')?.sellOutTotal}
              />
            </div>
            <div className="min-w-0 flex-1" style={{ flex: '1 1 0', minWidth: '320px' }}>
              <InventoryTable
                title="본사 (CNY K)"
                titleRight={
                  <>
                    <GrowthRateControl
                      label="본사 성장률"
                      labelCn="OR 成长率"
                      value={100 + growthRateHq}
                      onChange={(v) => setGrowthRateHq(v)}
                      title="본사 리테일 계획매출 전년 대비 성장률"
                    />
                  </>
                }
                data={hqTableData!}
                year={year}
                sellInLabel="상품매입"
                sellOutLabel="대리상출고"
                tableType="hq"
                prevYearData={prevYearTableData?.hq ?? null}
                onWoiChange={year === 2026 && brand !== '전체' ? handleWoiChange : undefined}
                use2025Legend={year === 2026 && brand === '전체'}
                onHqSellInChange={undefined}
                prevYearTotalOpening={(() => {
                  const v = prevYearMonthlyData?.hq.rows.find((r) => r.key === '재고자산합계')?.opening;
                  return v != null ? v / 1000 : undefined;
                })()}
                prevYearTotalSellIn={prevYearTableData?.hq.rows.find((r) => r.key === '재고자산합계')?.sellInTotal}
                prevYearTotalSellOut={prevYearTableData?.hq.rows.find((r) => r.key === '재고자산합계')?.sellOutTotal}
                prevYearTotalHqSales={prevYearTableData?.hq.rows.find((r) => r.key === '재고자산합계')?.hqSalesTotal}
                sideContent={year === 2026 ? (
                  <HqHoldingWoiTable values={accHqHoldingWoi} onChange={handleHqHoldingWoiChange} />
                ) : undefined}
              />
            </div>
          </div>
          </>
        )}

        {/* 2026 시즌별 연간 출고계획 + 대리상 OTB (좌우 2분할) */}
        {year === 2026 && (
          <div className="mt-8" style={{ paddingLeft: '1.5%', paddingRight: '1.5%' }}>
            <div className="grid gap-6 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
              <div className="min-w-0 max-w-[560px]">
                <div className="mb-3 border-l-4 border-sky-500 pl-3 text-sm font-bold text-slate-900">독립변수</div>
                <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-inner">
                  <table key={`independent-driver-${INDEPENDENT_DRIVER_COLUMN_HEADERS.join('|')}`} className="min-w-full border-collapse text-xs">
                    <thead>
                      <tr>
                        <th className="min-w-[120px] border border-slate-300 bg-slate-900 px-3 py-2.5 text-left text-[11px] font-semibold tracking-wide text-white">항목</th>
                        {INDEPENDENT_DRIVER_COLUMN_HEADERS.map((column, columnIndex) => (
                          <th
                            key={`independent-${columnIndex}`}
                            className="min-w-[84px] border border-slate-300 bg-slate-900 px-3 py-2.5 text-center text-[11px] font-semibold tracking-wide text-white"
                          >
                            {column}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {INDEPENDENT_DRIVER_ROWS.map((rowLabel) => (
                        <tr key={rowLabel} className="bg-white odd:bg-slate-50/80 hover:bg-sky-50">
                          <td className="border-b border-slate-200 px-3 py-2.5 font-semibold text-slate-700">{rowLabel}</td>
                          {INDEPENDENT_DRIVER_COLUMN_HEADERS.map((column, columnIndex) => (
                            <td key={`${rowLabel}-${columnIndex}`} className="border-b border-slate-200 px-3 py-2.5 text-right text-sm font-semibold text-slate-950">
                              {column === 'Rolling'
                                ? rowLabel === '대리상 리테일 성장율'
                                  ? formatDriverPercent(growthRate)
                                  : formatDriverPercent(growthRateHq)
                                : '-'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="min-w-0">
                <div className="mb-3 border-l-4 border-amber-500 pl-3 text-sm font-bold text-slate-900">종속변수</div>
                <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-inner">
                  <table key={`dependent-driver-${DRIVER_COLUMN_HEADERS.join('|')}`} className="min-w-full border-collapse text-xs">
                    <thead>
                      <tr>
                        <th className="min-w-[140px] border border-slate-300 bg-slate-900 px-3 py-2.5 text-left text-[11px] font-semibold tracking-wide text-white">항목</th>
                        {DRIVER_COLUMN_HEADERS.map((column, columnIndex) => (
                          <th
                            key={`dependent-${columnIndex}`}
                            className="min-w-[100px] border border-slate-300 bg-slate-900 px-3 py-2.5 text-center text-[11px] font-semibold tracking-wide text-white"
                          >
                            {column}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {DEPENDENT_DRIVER_ROWS.map((rowLabel, rowIndex) => (
                        <tr key={`derived-${rowLabel}`} className="bg-white odd:bg-slate-50/80 hover:bg-amber-50">
                          <td className="border-b border-slate-200 px-3 py-2.5 font-semibold text-slate-700">{rowLabel}</td>
                          {DRIVER_COLUMN_HEADERS.map((column, columnIndex) => (
                            <td key={`derived-${rowLabel}-${columnIndex}`} className="border-b border-slate-200 px-3 py-2.5 text-right text-sm font-semibold text-slate-950">
                              {getDependentDriverCellValue(column, columnIndex, rowIndex, hqDriverTotalRow, prevYearHqDriverTotalRow)}
                            </td>
                          ))}
                        </tr>
                      ))}
                      {false && DEPENDENT_DRIVER_ROWS.map((rowLabel, rowIndex) => (
                        <tr key={rowLabel} className="bg-white hover:bg-slate-50">
                          <td className="border-b border-slate-200 px-3 py-2 font-medium text-slate-700">{rowLabel}</td>
                          {DRIVER_COLUMN_HEADERS.map((column, columnIndex) => (
                            <td key={`${rowLabel}-${columnIndex}`} className="border-b border-slate-200 px-3 py-2 text-right text-slate-900">
                              {column === '전년'
                                ? getDependentDriverCellValue(column, columnIndex, rowIndex, hqDriverTotalRow, prevYearHqDriverTotalRow)
                                : column === 'Rolling'
                                ? rowLabel === '대리상출고'
                                  ? formatDriverNumber(hqDriverTotalRow?.sellOutTotal)
                                  : rowLabel === '본사상품매입'
                                    ? formatDriverNumber(hqDriverTotalRow?.sellInTotal)
                                    : formatDriverNumber(hqDriverTotalRow?.closing)
                                : '-'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {year === 2026 && (
          <div className="mt-10 border-t border-gray-300 pt-8">
            {/* 공통 헤더 */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setAnnualPlanOpen((v) => !v)}
                className="flex items-center gap-2 flex-1 text-left py-1"
              >
                <SectionIcon>
                  <span className="text-lg">{TXT_PLAN_ICON}</span>
                </SectionIcon>
                <span className="text-sm font-bold text-gray-700">
                  {TXT_PLAN_SECTION}
                  <span className="mx-2 text-gray-300">|</span>
                  {TXT_OTB_SECTION}
                </span>
                <span className="ml-auto text-gray-400 text-xs shrink-0">
                  {annualPlanOpen ? TXT_COLLAPSE : TXT_EXPAND}
                </span>
              </button>
              {annualPlanOpen && (
                <div className="flex items-center gap-2">
                  {!annualPlanEditMode ? (
                    <button
                      type="button"
                      onClick={handleAnnualPlanEditStart}
                      className="px-3 py-1.5 text-xs rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                    >
                      {TXT_EDIT}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleAnnualPlanSave}
                      className="px-3 py-1.5 text-xs rounded border border-sky-600 bg-sky-600 text-white hover:bg-sky-700"
                    >
                      {TXT_SAVE}
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* 좌우 2분할 */}
            {annualPlanOpen && (
              <div className="mt-3 flex gap-6 items-start">

                {/* 좌: 연간 출고계획 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-1 mb-1.5">
                    <span className="text-xs font-semibold text-gray-600">{TXT_PLAN_SECTION}</span>
                    <span className="text-xs text-gray-400">{TXT_PLAN_UNIT}</span>
                  </div>
                  <div className="overflow-x-auto rounded border border-gray-200">
                    <table className="min-w-full border-collapse text-xs">
                      <thead>
                        <tr>
                          <th className="px-3 py-2 text-left bg-[#1a2e5a] text-white border border-[#2e4070] min-w-[100px]">{TXT_BRAND}</th>
                          {ANNUAL_PLAN_SEASONS.map((season) => (
                            <th
                              key={season}
                              className="px-3 py-2 text-center bg-[#1a2e5a] text-white border border-[#2e4070] min-w-[80px]"
                            >
                              {ANNUAL_PLAN_SEASON_LABELS[season]}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {ANNUAL_PLAN_BRANDS.map((planBrand) => (
                          <tr key={planBrand} className="bg-white hover:bg-gray-50">
                            <td className="px-3 py-2 border-b border-gray-200 font-medium text-gray-700">{planBrand}</td>
                            {ANNUAL_PLAN_SEASONS.map((season) => (
                              <td key={`${planBrand}-${season}`} className="px-2 py-1.5 border-b border-gray-200">
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={String((annualPlanEditMode ? annualShipmentPlanDraft2026 : annualShipmentPlan2026)[planBrand][season] || 0)}
                                  onChange={(e) => handleAnnualPlanCellChange(planBrand, season, e.target.value)}
                                  disabled={!annualPlanEditMode}
                                  className={`w-full text-right text-xs px-1.5 py-1 rounded border focus:outline-none focus:ring-1 focus:ring-sky-400 ${
                                    annualPlanEditMode ? 'border-gray-300 bg-white' : 'border-gray-200 bg-gray-50 text-gray-600'
                                  }`}
                                />
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* 우: 대리상 OTB */}
                <div className="flex-shrink-0">
                  <div className="flex items-baseline gap-1 mb-1.5">
                    <span className="text-xs font-semibold text-gray-600">{TXT_OTB_SECTION}</span>
                    <span className="text-xs text-gray-400">{TXT_OTB_UNIT}</span>
                  </div>
                  <div className="overflow-x-auto rounded border border-gray-200">
                    {otbLoading ? (
                      <div className="px-6 py-4 text-xs text-gray-400">불러오는 중...</div>
                    ) : otbError ? (
                      <div className="px-6 py-4 text-xs text-red-500">{otbError}</div>
                    ) : (
                      <table className="border-collapse text-xs">
                        <thead>
                          <tr>
                            <th className="px-3 py-2 text-left bg-[#2e4a2e] text-white border border-[#3d6b3d] min-w-[60px]">{TXT_SEASON}</th>
                            {ANNUAL_PLAN_BRANDS.map((b) => (
                              <th key={b} className="px-3 py-2 text-center bg-[#2e4a2e] text-white border border-[#3d6b3d] min-w-[90px]">
                                {b}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {OTB_SEASONS_LIST.map((sesn) => (
                            <tr key={sesn} className="bg-white hover:bg-gray-50">
                              <td className="px-3 py-2 border-b border-gray-200 font-medium text-gray-700">{sesn}</td>
                              {ANNUAL_PLAN_BRANDS.map((b) => {
                                const raw = otbData?.[sesn]?.[b] ?? 0;
                                const display = raw === 0 ? '-' : Math.round(raw / 1000).toLocaleString();
                                return (
                                  <td key={b} className="px-3 py-2 border-b border-gray-200 text-right text-gray-700 tabular-nums">
                                    {display}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>

              </div>
            )}
          </div>
        )}

        {/* 월별 재고잔액 */}
        {year === 2025 && adjustedDealerRetailTable && (
          <div className="mt-10 border-t border-gray-300 pt-8">
            <button
              type="button"
              onClick={() => setAdjustedRetailOpen((v) => !v)}
              className="flex items-center gap-2 w-full text-left py-1"
            >
              <SectionIcon>
                <span className="text-lg">💤</span>
              </SectionIcon>
              <span className="text-sm font-bold text-gray-700">대리상 리테일매출(보정)</span>
              <span className="text-xs font-normal text-gray-400">(단위: CNY K)</span>
              <span className="ml-auto text-gray-400 text-xs shrink-0">
                {adjustedRetailOpen ? '접기' : '펼치기'}
              </span>
            </button>
            {adjustedRetailOpen && (
              <div className="mt-3">
              <InventoryMonthlyTable
                firstColumnHeader="대리상 리테일매출(보정)"
                data={adjustedDealerRetailTable}
                year={year}
                showOpening={true}
              />
              </div>
            )}
          </div>
        )}

        <div className="mt-10 border-t border-gray-300 pt-8">
          <button
            type="button"
            onClick={() => setMonthlyOpen((v) => !v)}
            className="flex items-center gap-2 w-full text-left py-1"
          >
            <SectionIcon>
              <span className="text-lg">📦</span>
            </SectionIcon>
            <span className="text-sm font-bold text-gray-700">월별 재고잔액</span>
            <span className="text-xs font-normal text-gray-400">
              (단위: CNY K / 실적 기준: ~{monthlyData?.closedThrough ?? '--'})
            </span>
            {monthlyPlanSummaryText && (
              <span className="text-xs font-normal text-red-600">
                {monthlyPlanSummaryText}
              </span>
            )}
            <span className="ml-auto text-gray-400 text-xs shrink-0">
              {monthlyOpen ? '접기' : '펼치기'}
            </span>
          </button>
          {monthlyError && !monthlyOpen && (
            <p className="text-red-500 text-xs mt-1">{monthlyError}</p>
          )}
          {monthlyOpen && (
            <>
              {monthlyPlanLegendText && (
                <div className="mt-2 ml-7 mr-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {monthlyPlanLegendText}
                </div>
              )}
              {monthlyLoading && (
                <div className="flex items-center justify-center py-12 text-gray-400 text-sm">
                  로딩 중...
                </div>
              )}
              {monthlyError && (
                <div className="py-8 text-center text-red-500 text-sm">{monthlyError}</div>
              )}
              {monthlyData && !monthlyLoading && monthlyData.dealer.rows.length > 0 && (
                <>
                  <InventoryMonthlyTable
                    firstColumnHeader="대리상"
                    data={effectiveDealerMonthlyDisplayData ?? (monthlyData.dealer as TableData)}
                    year={year}
                    showOpening={true}
                    showAnnualTotal={false}
                    planFromMonth={year === 2026 && brand !== '전체' ? monthlyPlanFromMonth : undefined}
                  />
                  <InventoryMonthlyTable
                    firstColumnHeader="본사"
                    data={effectiveHqMonthlyDisplayData ?? (monthlyData.hq as TableData)}
                    year={year}
                    showOpening={true}
                    showAnnualTotal={false}
                    planFromMonth={year === 2026 && brand !== '전체' ? monthlyPlanFromMonth : undefined}
                    headerBg="#4db6ac"
                    headerBorderColor="#2a9d8f"
                    totalRowCls="bg-teal-50"
                  />
                </>
              )}
              {monthlyData && !monthlyLoading && monthlyData.dealer.rows.length === 0 && (
                <div className="py-8 text-center text-gray-400 text-sm">
                  해당 연도의 마감 데이터가 없습니다.
                </div>
              )}
            </>
          )}
        </div>

        {/* ?? 由ы뀒??留ㅼ텧 ???? */}
        <div className="mt-10 border-t border-gray-300 pt-8">
          <button
            type="button"
            onClick={() => setRetailOpen((v) => !v)}
            className="flex items-center gap-2 w-full text-left py-1"
          >
            <SectionIcon>
              <span className="text-lg">📊</span>
            </SectionIcon>
            <span className="text-sm font-bold text-gray-700">리테일 매출</span>
            <span className="text-xs font-normal text-gray-400">
              (단위: CNY K / 실적 기준: ~{retailData?.closedThrough ?? '--'})
            </span>
            <span className="ml-auto text-gray-400 text-xs shrink-0">
              {retailOpen ? '접기' : '펼치기'}
            </span>
          </button>
          {year === 2026 && (
            <div className="mt-1 pl-7 text-xs text-red-600">
              대리상: 실적월까지 당해 실적, 이후는 전년(2025 보정 대리상 리테일) x 성장률 / 직영: 실적월까지 당해 실적, 이후는 전년 본사 리테일 x 본사 성장률
            </div>
          )}
          {retailError && !retailOpen && (
            <p className="text-red-500 text-xs mt-1">{retailError}</p>
          )}
          {retailOpen && (
            <>
              {retailLoading && (
                <div className="flex items-center justify-center py-12 text-gray-400 text-sm">
                  로딩 중...
                </div>
              )}
              {retailError && (
                <div className="py-8 text-center text-red-500 text-sm">{retailError}</div>
              )}
              {effectiveRetailData && !retailLoading && effectiveRetailData.dealer.rows.length > 0 && (
                <>
                  <InventoryMonthlyTable
                    firstColumnHeader="대리상"
                    data={effectiveRetailData.dealer as TableData}
                    year={year}
                    showOpening={false}
                    planFromMonth={effectiveRetailData.planFromMonth}
                  />
                  <InventoryMonthlyTable
                    firstColumnHeader="본사"
                    data={effectiveRetailData.hq as TableData}
                    year={year}
                    showOpening={false}
                    planFromMonth={effectiveRetailData.planFromMonth}
                    headerBg="#4db6ac"
                    headerBorderColor="#2a9d8f"
                    totalRowCls="bg-teal-50"
                  />
                </>
              )}
              {effectiveRetailData && !retailLoading && effectiveRetailData.dealer.rows.length === 0 && (
                <div className="py-8 text-center text-gray-400 text-sm">
                  해당 연도의 마감 데이터가 없습니다.
                </div>
              )}
            </>
          )}
        </div>

        {/* ?? 蹂몄궗?믩?由ъ긽 異쒓퀬留ㅼ텧 ???? */}
        <div className="mt-10 border-t border-gray-300 pt-8">
          <button
            type="button"
            onClick={() => setShipmentOpen((v) => !v)}
            className="flex items-center gap-2 w-full text-left py-1"
          >
            <SectionIcon>
              <span className="text-lg">🚚</span>
            </SectionIcon>
            <span className="text-sm font-bold text-gray-700">본사→대리상 출고매출</span>
            <span className="text-xs font-normal text-gray-400">
              (단위: CNY K / 실적 기준: ~{shipmentData?.closedThrough ?? '--'})
            </span>
            <span className="ml-auto text-gray-400 text-xs shrink-0">
              {shipmentOpen ? '접기' : '펼치기'}
            </span>
          </button>
          {year === 2026 && brand !== '전체' && shipmentPlanFromMonth != null && (
            <div className="mt-1 pl-7 text-xs text-red-600">
              본사→대리상 출고매출 표만 예외적으로 PL 실적월 이후는 PL 의류 출고진척률 / ACC 출고비율로 월 배분
            </div>
          )}
          {shipmentError && !shipmentOpen && (
            <p className="text-red-500 text-xs mt-1">{shipmentError}</p>
          )}
          {shipmentOpen && (
            <>
              {shipmentLoading && (
                <div className="flex items-center justify-center py-12 text-gray-400 text-sm">
                  로딩 중...
                </div>
              )}
              {shipmentError && (
                <div className="py-8 text-center text-red-500 text-sm">{shipmentError}</div>
              )}
              {effectiveShipmentDisplayData && !shipmentLoading && effectiveShipmentDisplayData.rows.length > 0 && (
                <InventoryMonthlyTable
                  firstColumnHeader="본사→대리상 출고"
                  data={effectiveShipmentDisplayData}
                  year={year}
                  showOpening={false}
                  planFromMonth={year === 2026 && brand !== '전체' ? shipmentPlanFromMonth : undefined}
                  validationHeader={year === 2026 && brand !== '전체' ? '검증' : undefined}
                  validationByRowKey={year === 2026 && brand !== '전체' ? (shipmentValidationByRowKey ?? undefined) : undefined}
                  headerBg="#4db6ac"
                  headerBorderColor="#2a9d8f"
                  totalRowCls="bg-teal-50"
                />
              )}
              {effectiveShipmentDisplayData && !shipmentLoading && effectiveShipmentDisplayData.rows.length === 0 && (
                <div className="py-8 text-center text-gray-400 text-sm">
                  해당 연도의 마감 데이터가 없습니다.
                </div>
              )}
            </>
          )}
        </div>

        {/* ?? 蹂몄궗 留ㅼ엯?곹뭹 ???? */}
        <div className="mt-10 border-t border-gray-300 pt-8">
          <button
            type="button"
            onClick={() => setPurchaseOpen((v) => !v)}
            className="flex items-center gap-2 w-full text-left py-1"
          >
            <SectionIcon>
              <span className="text-lg">📥</span>
            </SectionIcon>
            <span className="text-sm font-bold text-gray-700">본사 매입상품</span>
            <span className="text-xs font-normal text-gray-400">
              (단위: CNY K / 실적 기준: ~{purchaseData?.closedThrough ?? '--'})
            </span>
            <span className="ml-auto text-gray-400 text-xs shrink-0">
              {purchaseOpen ? '접기' : '펼치기'}
            </span>
          </button>
          {year === 2026 && shipmentPlanFromMonth != null && (
            <div className="mt-1 pl-7 text-xs text-red-600">
              본사 매입상품은 1월 실적 유지, 2월(F)부터는 남은 연간매입계획(연간합계-1월 실적)을 본사→대리상 출고매출의 2~12월 행별 비중으로 배분
            </div>
          )}
          {purchaseError && !purchaseOpen && (
            <p className="text-red-500 text-xs mt-1">{purchaseError}</p>
          )}
          {purchaseOpen && (
            <>
              {purchaseLoading && (
                <div className="flex items-center justify-center py-12 text-gray-400 text-sm">
                  로딩 중...
                </div>
              )}
              {purchaseError && (
                <div className="py-8 text-center text-red-500 text-sm">{purchaseError}</div>
              )}
              {purchaseData && !purchaseLoading && purchaseData.data.rows.length > 0 && (
                <>
                  <InventoryMonthlyTable
                    firstColumnHeader={TXT_HQ_PURCHASE_HEADER}
                    data={effectivePurchaseDisplayData ?? (purchaseData.data as TableData)}
                    year={year}
                    showOpening={false}
                    planFromMonth={year === 2026 ? shipmentPlanFromMonth : undefined}
                    annualTotalByRowKey={year === 2026 ? (purchaseAnnualTotalByRowKey ?? undefined) : undefined}
                    validationHeader={year === 2026 ? '검증' : undefined}
                    validationByRowKey={year === 2026 ? (purchaseValidationByRowKey ?? undefined) : undefined}
                    headerBg="#4db6ac"
                    headerBorderColor="#2a9d8f"
                    totalRowCls="bg-teal-50"
                  />
                </>
              )}
              {purchaseData && !purchaseLoading && purchaseData.data.rows.length === 0 && (
                <div className="py-8 text-center text-gray-400 text-sm">
                  해당 연도의 마감 데이터가 없습니다.
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
