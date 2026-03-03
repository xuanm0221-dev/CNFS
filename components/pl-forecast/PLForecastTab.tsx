'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  ANNUAL_2025_RAW_BY_BRAND,
  DIRECT_EXPENSE_ACCOUNTS,
  FORECAST_BRANDS,
  MONTH_HEADERS,
  OPERATING_EXPENSE_ACCOUNTS,
  RAW_ACCOUNTS,
  ROWS_BRAND,
  ROWS_CORPORATE,
  type ForecastLeafBrand,
  type ForecastRowDef,
} from './plForecastConfig';

type MonthlyInputs = Record<ForecastLeafBrand, Record<string, (number | null)[]>>;

type CalculatedSeries = {
  monthly: Record<string, (number | null)[]>;
  annual2025: Record<string, number | null>;
};

type SalesBrand = 'MLB' | 'MLB KIDS' | 'DISCOVERY';
type SalesLeafKind = 'dealerCurrS' | 'dealerCurrF' | 'dealerAcc' | 'direct';

interface SalesRowDef {
  id: string;
  parentId: string | null;
  level: number;
  brand: SalesBrand;
  channelLabel: string;
  accountLabel: string;
  isGroup: boolean;
  leafKind?: SalesLeafKind;
}

const SALES_BRANDS: SalesBrand[] = ['MLB', 'MLB KIDS', 'DISCOVERY'];
const FORECAST_TO_SALES_BRAND: Record<ForecastLeafBrand, SalesBrand> = {
  mlb: 'MLB',
  kids: 'MLB KIDS',
  discovery: 'DISCOVERY',
};
const INVENTORY_GROWTH_PARAMS_KEY = 'inventory_growth_params';
const PL_TAG_COST_RATIO_KEY = 'pl_tag_cost_ratio_annual';
const ACCOUNT_LABEL_OVERRIDES: Record<string, string> = {
  Tag매출_대리상: '대리상',
  Tag매출_의류: '의류',
  Tag매출_ACC: 'ACC',
  Tag매출_직영: '직영',
  실판매출_대리상: '대리상',
  실판매출_의류: '의류',
  실판매출_ACC: 'ACC',
  실판매출_직영: '직영',
};

interface InventoryGrowthParams {
  growthRate: number;
  growthRateHq: number;
}

interface RetailRow {
  isTotal: boolean;
  monthly: (number | null)[];
}

interface RetailSalesApiResponse {
  hq?: { rows?: RetailRow[] };
}

interface ShipmentProgressRow {
  brand: SalesBrand;
  season: '당년S' | '당년F';
  prevYearProgress: number | null;
  monthly: (number | null)[];
}

interface AccShipmentRatioRow {
  brand: SalesBrand;
  monthly: (number | null)[];
}

interface BrandActualData {
  tag: { dealer: (number | null)[]; direct: (number | null)[] };
  sales: { dealer: (number | null)[]; direct: (number | null)[] };
  accounts: Record<string, (number | null)[]>;
}

interface BrandActualApiResponse {
  brands: Record<SalesBrand, BrandActualData>;
  availableMonths: number[];
  error?: string;
}

interface OpexForecastApiResponse {
  brands: Record<SalesBrand, Record<string, (number | null)[]>>;
  error?: string;
}

interface DirectExpenseRatioApiResponse {
  brands: Record<SalesBrand, Record<string, (number | null)[]>>;
  error?: string;
}

interface TagCostRatioApiResponse {
  brands: Record<SalesBrand, (number | null)[]>;
  error?: string;
}

const INVENTORY_DEALER_ACC_SELLIN_KEY = 'inventory_dealer_acc_sellin';

interface DealerAccSellInPayload {
  values?: Partial<Record<SalesBrand, number>>;
}

type ShipmentRateChannel = 'dealerCloth' | 'dealerAcc' | 'direct';
const SHIPMENT_RATE_PERCENT_BY_CHANNEL: Record<ShipmentRateChannel, Record<SalesBrand, number>> = {
  dealerCloth: { MLB: 42, 'MLB KIDS': 42, DISCOVERY: 45 },
  dealerAcc: { MLB: 47, 'MLB KIDS': 42, DISCOVERY: 45 },
  direct: { MLB: 90, 'MLB KIDS': 90, DISCOVERY: 90 },
};

const BRAND_SHIPMENT_RATE_ROWS: Array<{ category: '대리상(의류)' | '대리상(ACC)' | '직영'; rates: Record<SalesBrand, number> }> = [
  { category: '대리상(의류)', rates: SHIPMENT_RATE_PERCENT_BY_CHANNEL.dealerCloth },
  { category: '대리상(ACC)', rates: SHIPMENT_RATE_PERCENT_BY_CHANNEL.dealerAcc },
  { category: '직영', rates: SHIPMENT_RATE_PERCENT_BY_CHANNEL.direct },
];

function makeSalesRows(): SalesRowDef[] {
  const rows: SalesRowDef[] = [];

  for (const brand of SALES_BRANDS) {
    const brandId = `brand:${brand}`;
    const dealerId = `dealerCloth:${brand}`;
    const dealerSId = `dealerS:${brand}`;
    const dealerFId = `dealerF:${brand}`;
    const dealerAccId = `dealerACC:${brand}`;
    const directId = `direct:${brand}`;

    rows.push({
      id: brandId,
      parentId: null,
      level: 1,
      brand,
      channelLabel: '',
      accountLabel: brand,
      isGroup: true,
    });
    rows.push({
      id: dealerId,
      parentId: brandId,
      level: 2,
      brand,
      channelLabel: '대리상',
      accountLabel: '대리상(의류)',
      isGroup: true,
    });
    rows.push({
      id: dealerSId,
      parentId: dealerId,
      level: 3,
      brand,
      channelLabel: '',
      accountLabel: '당년S',
      isGroup: false,
      leafKind: 'dealerCurrS',
    });
    rows.push({
      id: dealerFId,
      parentId: dealerId,
      level: 3,
      brand,
      channelLabel: '',
      accountLabel: '당년F',
      isGroup: false,
      leafKind: 'dealerCurrF',
    });
    rows.push({
      id: dealerAccId,
      parentId: brandId,
      level: 2,
      brand,
      channelLabel: '대리상',
      accountLabel: '대리상(ACC)',
      isGroup: false,
      leafKind: 'dealerAcc',
    });
    rows.push({
      id: directId,
      parentId: brandId,
      level: 2,
      brand,
      channelLabel: '직영',
      accountLabel: '직영',
      isGroup: false,
      leafKind: 'direct',
    });
  }

  return rows;
}

function emptyMonthlyInputs(): MonthlyInputs {
  const base: Record<string, (number | null)[]> = {};
  for (const account of RAW_ACCOUNTS) {
    base[account] = new Array(12).fill(null);
  }

  return {
    mlb: Object.fromEntries(Object.entries(base).map(([k, v]) => [k, [...v]])) as Record<string, (number | null)[]>,
    kids: Object.fromEntries(Object.entries(base).map(([k, v]) => [k, [...v]])) as Record<string, (number | null)[]>,
    discovery: Object.fromEntries(Object.entries(base).map(([k, v]) => [k, [...v]])) as Record<string, (number | null)[]>,
  };
}

function sumOrNull(values: (number | null)[]): number | null {
  const hasAny = values.some((v) => v !== null);
  if (!hasAny) return null;
  return values.reduce<number>((sum, v) => sum + (v ?? 0), 0);
}

function makeMonthlyArray(calc: (idx: number) => number | null): (number | null)[] {
  return Array.from({ length: 12 }, (_, idx) => calc(idx));
}

function sumMonthlySeries(series: Record<string, (number | null)[]>, accounts: string[]): (number | null)[] {
  return makeMonthlyArray((idx) => {
    let hasAny = false;
    let sum = 0;
    for (const account of accounts) {
      const v = series[account]?.[idx] ?? null;
      if (v !== null) {
        hasAny = true;
        sum += v;
      }
    }
    return hasAny ? sum : null;
  });
}

function deriveCalculated(
  rawMonthly: Record<string, (number | null)[]>,
  annualRaw2025: Record<string, number>,
): CalculatedSeries {
  const monthly: Record<string, (number | null)[]> = { ...rawMonthly };

  monthly['매출원가 합계'] = makeMonthlyArray((idx) => {
    const cogs = monthly['매출원가']?.[idx] ?? null;
    const evalLoss = monthly['평가감']?.[idx] ?? null;
    if (cogs === null && evalLoss === null) return null;
    return (cogs ?? 0) + (evalLoss ?? 0);
  });

  monthly['(Tag 대비 원가율)'] = makeMonthlyArray((idx) => {
    const tag = monthly['Tag매출']?.[idx] ?? null;
    const cogs = monthly['매출원가']?.[idx] ?? null;
    if (tag === null || tag === 0 || cogs === null) return null;
    return (cogs * 1.13) / tag;
  });

  monthly['매출총이익'] = makeMonthlyArray((idx) => {
    const sales = monthly['실판매출']?.[idx] ?? null;
    const cogsTotal = monthly['매출원가 합계']?.[idx] ?? null;
    if (sales === null && cogsTotal === null) return null;
    return (sales ?? 0) - (cogsTotal ?? 0);
  });

  monthly['직접비'] = sumMonthlySeries(monthly, DIRECT_EXPENSE_ACCOUNTS);
  monthly['영업비'] = sumMonthlySeries(monthly, OPERATING_EXPENSE_ACCOUNTS);

  monthly['영업이익'] = makeMonthlyArray((idx) => {
    const gp = monthly['매출총이익']?.[idx] ?? null;
    const direct = monthly['직접비']?.[idx] ?? null;
    const op = monthly['영업비']?.[idx] ?? null;
    if (gp === null && direct === null && op === null) return null;
    return (gp ?? 0) - (direct ?? 0) - (op ?? 0);
  });

  monthly['영업이익률'] = makeMonthlyArray((idx) => {
    const oi = monthly['영업이익']?.[idx] ?? null;
    const sales = monthly['실판매출']?.[idx] ?? null;
    if (oi === null || sales === null || sales === 0) return null;
    return oi / sales;
  });

  const annual2025: Record<string, number | null> = {};
  for (const account of RAW_ACCOUNTS) {
    annual2025[account] = annualRaw2025[account] ?? 0;
  }

  annual2025['매출원가 합계'] = (annual2025['매출원가'] ?? 0) + (annual2025['평가감'] ?? 0);
  annual2025['(Tag 대비 원가율)'] =
    (annual2025['Tag매출'] ?? 0) !== 0
      ? ((annual2025['매출원가'] ?? 0) * 1.13) / (annual2025['Tag매출'] as number)
      : null;
  annual2025['매출총이익'] = (annual2025['실판매출'] ?? 0) - (annual2025['매출원가 합계'] ?? 0);
  annual2025['직접비'] = DIRECT_EXPENSE_ACCOUNTS.reduce((sum, account) => sum + (annual2025[account] ?? 0), 0);
  annual2025['영업비'] = OPERATING_EXPENSE_ACCOUNTS.reduce((sum, account) => sum + (annual2025[account] ?? 0), 0);
  annual2025['영업이익'] = (annual2025['매출총이익'] ?? 0) - (annual2025['직접비'] ?? 0) - (annual2025['영업비'] ?? 0);
  annual2025['영업이익률'] =
    (annual2025['실판매출'] ?? 0) !== 0 ? (annual2025['영업이익'] ?? 0) / (annual2025['실판매출'] as number) : null;

  return { monthly, annual2025 };
}

function formatValue(value: number | null, format: 'number' | 'percent' = 'number'): string {
  if (value === null || Number.isNaN(value)) return '';
  if (format === 'percent') return `${(value * 100).toFixed(1)}%`;
  const kValue = Math.round(value / 1000);
  return new Intl.NumberFormat('ko-KR').format(kValue);
}

function formatYoYByAnnual(annual26: number | null, annual25: number | null): string {
  if (annual26 === null || annual25 === null || Number.isNaN(annual26) || Number.isNaN(annual25) || annual25 === 0) return '-';
  return `${((annual26 / annual25) * 100).toFixed(1)}%`;
}

function sumSeries(a: (number | null)[], b: (number | null)[]): (number | null)[] {
  return a.map((v, i) => {
    const x = v ?? null;
    const y = b[i] ?? null;
    if (x === null && y === null) return null;
    return (x ?? 0) + (y ?? 0);
  });
}

function applyRate(series: (number | null)[], percent: number): (number | null)[] {
  return series.map((v) => (v === null ? null : (v * percent) / 100 / 1.13));
}

function isSameSeries(a: (number | null)[], b: (number | null)[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if ((a[i] ?? null) !== (b[i] ?? null)) return false;
  }
  return true;
}

function splitByPlannedRatio(
  total: number | null,
  plannedA: number | null,
  plannedB: number | null,
): { a: number | null; b: number | null } {
  if (total === null) return { a: null, b: null };
  const pa = plannedA ?? 0;
  const pb = plannedB ?? 0;
  const sum = pa + pb;
  if (sum <= 0) {
    return { a: total / 2, b: total / 2 };
  }
  const a = (total * pa) / sum;
  return { a, b: total - a };
}

function readInventoryGrowthParams(): InventoryGrowthParams {
  if (typeof window === 'undefined') return { growthRate: 5, growthRateHq: 17 };
  const raw = window.localStorage.getItem(INVENTORY_GROWTH_PARAMS_KEY);
  if (!raw) return { growthRate: 5, growthRateHq: 17 };
  try {
    const parsed = JSON.parse(raw) as Partial<InventoryGrowthParams>;
    const growthRate = typeof parsed.growthRate === 'number' ? parsed.growthRate : 5;
    const growthRateHq = typeof parsed.growthRateHq === 'number' ? parsed.growthRateHq : 17;
    return { growthRate, growthRateHq };
  } catch {
    return { growthRate: 5, growthRateHq: 17 };
  }
}

export default function PLForecastTab() {
  const [activeBrand, setActiveBrand] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(['Tag매출', '실판매출', '매출원가 합계', '직접비', '영업비']));
  const [logicGuideCollapsed, setLogicGuideCollapsed] = useState<boolean>(true);
  const [monthlyInputs, setMonthlyInputs] = useState<MonthlyInputs>(emptyMonthlyInputs);
  const [salesSectionOpen, setSalesSectionOpen] = useState<boolean>(false);
  const [directExpenseRatioSectionOpen, setDirectExpenseRatioSectionOpen] = useState<boolean>(false);
  const [tagCostRatioSectionOpen, setTagCostRatioSectionOpen] = useState<boolean>(false);
  const [salesCollapsed, setSalesCollapsed] = useState<Set<string>>(new Set());
  const [otbLoading, setOtbLoading] = useState<boolean>(false);
  const [otbError, setOtbError] = useState<string | null>(null);
  const [otbData, setOtbData] = useState<Record<string, Record<string, number>> | null>(null);
  const [retailLoading, setRetailLoading] = useState<boolean>(false);
  const [retailError, setRetailError] = useState<string | null>(null);
  const [growthParams, setGrowthParams] = useState<InventoryGrowthParams>({ growthRate: 5, growthRateHq: 17 });
  const [directRetailByBrand, setDirectRetailByBrand] = useState<Record<SalesBrand, (number | null)[]>>({
    MLB: new Array(12).fill(null),
    'MLB KIDS': new Array(12).fill(null),
    DISCOVERY: new Array(12).fill(null),
  });
  const [shipmentProgressLoading, setShipmentProgressLoading] = useState<boolean>(false);
  const [shipmentProgressError, setShipmentProgressError] = useState<string | null>(null);
  const [shipmentProgressRows, setShipmentProgressRows] = useState<ShipmentProgressRow[]>([]);
  const [dealerAccOtbByBrand, setDealerAccOtbByBrand] = useState<Record<SalesBrand, number>>({
    MLB: 0,
    'MLB KIDS': 0,
    DISCOVERY: 0,
  });
  const [accRatioLoading, setAccRatioLoading] = useState<boolean>(false);
  const [accRatioError, setAccRatioError] = useState<string | null>(null);
  const [accRatioRows, setAccRatioRows] = useState<AccShipmentRatioRow[]>([]);
  const [brandActualLoading, setBrandActualLoading] = useState<boolean>(false);
  const [brandActualError, setBrandActualError] = useState<string | null>(null);
  const [brandActualAvailableMonths, setBrandActualAvailableMonths] = useState<number[]>([]);
  const [brandActualByBrand, setBrandActualByBrand] = useState<Record<SalesBrand, BrandActualData>>({
    MLB: { tag: { dealer: new Array(12).fill(null), direct: new Array(12).fill(null) }, sales: { dealer: new Array(12).fill(null), direct: new Array(12).fill(null) }, accounts: {} },
    'MLB KIDS': { tag: { dealer: new Array(12).fill(null), direct: new Array(12).fill(null) }, sales: { dealer: new Array(12).fill(null), direct: new Array(12).fill(null) }, accounts: {} },
    DISCOVERY: { tag: { dealer: new Array(12).fill(null), direct: new Array(12).fill(null) }, sales: { dealer: new Array(12).fill(null), direct: new Array(12).fill(null) }, accounts: {} },
  });
  const [opexForecastLoading, setOpexForecastLoading] = useState<boolean>(false);
  const [opexForecastError, setOpexForecastError] = useState<string | null>(null);
  const [opexForecastByBrand, setOpexForecastByBrand] = useState<Record<SalesBrand, Record<string, (number | null)[]>>>({
    MLB: {},
    'MLB KIDS': {},
    DISCOVERY: {},
  });
  const [directExpenseRatioLoading, setDirectExpenseRatioLoading] = useState<boolean>(false);
  const [directExpenseRatioError, setDirectExpenseRatioError] = useState<string | null>(null);
  const [directExpenseRatioByBrand, setDirectExpenseRatioByBrand] = useState<Record<SalesBrand, Record<string, (number | null)[]>>>({
    MLB: {},
    'MLB KIDS': {},
    DISCOVERY: {},
  });
  const [tagCostRatioLoading, setTagCostRatioLoading] = useState<boolean>(false);
  const [tagCostRatioError, setTagCostRatioError] = useState<string | null>(null);
  const [tagCostRatioByBrand, setTagCostRatioByBrand] = useState<Record<SalesBrand, (number | null)[]>>({
    MLB: new Array(12).fill(null),
    'MLB KIDS': new Array(12).fill(null),
    DISCOVERY: new Array(12).fill(null),
  });

  useEffect(() => {
    let mounted = true;
    const fetchOtb = async () => {
      setOtbLoading(true);
      setOtbError(null);
      try {
        const res = await fetch('/api/inventory/otb?year=2026', { cache: 'no-store' });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || 'OTB 데이터를 불러오지 못했습니다.');
        if (mounted) setOtbData(json?.data ?? null);
      } catch (err) {
        if (mounted) {
          setOtbError(err instanceof Error ? err.message : 'OTB 데이터를 불러오지 못했습니다.');
        }
      } finally {
        if (mounted) setOtbLoading(false);
      }
    };
    fetchOtb();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const fetchShipmentProgress = async () => {
      setShipmentProgressLoading(true);
      setShipmentProgressError(null);
      try {
        const res = await fetch('/api/inventory/shipment-progress', { cache: 'no-store' });
        const json = (await res.json()) as { rows?: ShipmentProgressRow[]; error?: string };
        if (!res.ok) throw new Error(json?.error || '출고진척률 데이터를 불러오지 못했습니다.');
        if (mounted) setShipmentProgressRows(json.rows ?? []);
      } catch (err) {
        if (mounted) {
          setShipmentProgressError(err instanceof Error ? err.message : '출고진척률 데이터를 불러오지 못했습니다.');
        }
      } finally {
        if (mounted) setShipmentProgressLoading(false);
      }
    };
    fetchShipmentProgress();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const fetchAccRatio = async () => {
      setAccRatioLoading(true);
      setAccRatioError(null);
      try {
        const res = await fetch('/api/inventory/acc-shipment-ratio', { cache: 'no-store' });
        const json = (await res.json()) as { rows?: AccShipmentRatioRow[]; error?: string };
        if (!res.ok) throw new Error(json?.error || 'ACC 출고비율 데이터를 불러오지 못했습니다.');
        if (mounted) setAccRatioRows(json.rows ?? []);
      } catch (err) {
        if (mounted) {
          setAccRatioError(err instanceof Error ? err.message : 'ACC 출고비율 데이터를 불러오지 못했습니다.');
        }
      } finally {
        if (mounted) setAccRatioLoading(false);
      }
    };
    fetchAccRatio();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const fetchBrandActual = async () => {
      setBrandActualLoading(true);
      setBrandActualError(null);
      try {
        const res = await fetch('/api/pl-forecast/brand-actual?year=2026', { cache: 'no-store' });
        const json = (await res.json()) as BrandActualApiResponse;
        if (!res.ok) throw new Error(json?.error || '브랜드 실적 데이터를 불러오지 못했습니다.');
        if (!mounted) return;
        setBrandActualAvailableMonths(json.availableMonths ?? []);
        setBrandActualByBrand(
          json.brands ?? {
            MLB: { tag: { dealer: new Array(12).fill(null), direct: new Array(12).fill(null) }, sales: { dealer: new Array(12).fill(null), direct: new Array(12).fill(null) }, accounts: {} },
            'MLB KIDS': { tag: { dealer: new Array(12).fill(null), direct: new Array(12).fill(null) }, sales: { dealer: new Array(12).fill(null), direct: new Array(12).fill(null) }, accounts: {} },
            DISCOVERY: { tag: { dealer: new Array(12).fill(null), direct: new Array(12).fill(null) }, sales: { dealer: new Array(12).fill(null), direct: new Array(12).fill(null) }, accounts: {} },
          },
        );
      } catch (err) {
        if (mounted) {
          setBrandActualAvailableMonths([]);
          setBrandActualError(err instanceof Error ? err.message : '브랜드 실적 데이터를 불러오지 못했습니다.');
        }
      } finally {
        if (mounted) setBrandActualLoading(false);
      }
    };
    fetchBrandActual();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const fetchOpexForecast = async () => {
      setOpexForecastLoading(true);
      setOpexForecastError(null);
      try {
        const res = await fetch('/api/pl-forecast/opex-forecast?year=2026', { cache: 'no-store' });
        const json = (await res.json()) as OpexForecastApiResponse;
        if (!res.ok) throw new Error(json?.error || '영업비 계획 데이터를 불러오지 못했습니다.');
        if (!mounted) return;
        setOpexForecastByBrand(
          json.brands ?? {
            MLB: {},
            'MLB KIDS': {},
            DISCOVERY: {},
          },
        );
      } catch (err) {
        if (mounted) {
          setOpexForecastError(err instanceof Error ? err.message : '영업비 계획 데이터를 불러오지 못했습니다.');
        }
      } finally {
        if (mounted) setOpexForecastLoading(false);
      }
    };
    fetchOpexForecast();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const fetchDirectExpenseRatio = async () => {
      setDirectExpenseRatioLoading(true);
      setDirectExpenseRatioError(null);
      try {
        const res = await fetch('/api/pl-forecast/direct-expense-ratio?year=2026', { cache: 'no-store' });
        const json = (await res.json()) as DirectExpenseRatioApiResponse;
        if (!res.ok) throw new Error(json?.error || '직접비율 데이터를 불러오지 못했습니다.');
        if (!mounted) return;
        setDirectExpenseRatioByBrand(
          json.brands ?? {
            MLB: {},
            'MLB KIDS': {},
            DISCOVERY: {},
          },
        );
      } catch (err) {
        if (mounted) {
          setDirectExpenseRatioError(err instanceof Error ? err.message : '직접비율 데이터를 불러오지 못했습니다.');
        }
      } finally {
        if (mounted) setDirectExpenseRatioLoading(false);
      }
    };
    fetchDirectExpenseRatio();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const fetchTagCostRatio = async () => {
      setTagCostRatioLoading(true);
      setTagCostRatioError(null);
      try {
        const res = await fetch('/api/pl-forecast/tag-cost-ratio?year=2026', { cache: 'no-store' });
        const json = (await res.json()) as TagCostRatioApiResponse;
        if (!res.ok) throw new Error(json?.error || 'Tag대비원가율 데이터를 불러오지 못했습니다.');
        if (!mounted) return;
        setTagCostRatioByBrand(
          json.brands ?? {
            MLB: new Array(12).fill(null),
            'MLB KIDS': new Array(12).fill(null),
            DISCOVERY: new Array(12).fill(null),
          },
        );
      } catch (err) {
        if (mounted) {
          setTagCostRatioError(err instanceof Error ? err.message : 'Tag대비원가율 데이터를 불러오지 못했습니다.');
        }
      } finally {
        if (mounted) setTagCostRatioLoading(false);
      }
    };
    fetchTagCostRatio();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const updateGrowthParams = () => {
      setGrowthParams(readInventoryGrowthParams());
    };

    updateGrowthParams();
    window.addEventListener('inventory-growth-updated', updateGrowthParams as EventListener);
    window.addEventListener('storage', updateGrowthParams);
    return () => {
      window.removeEventListener('inventory-growth-updated', updateGrowthParams as EventListener);
      window.removeEventListener('storage', updateGrowthParams);
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const fetchDirectRetail = async () => {
      setRetailLoading(true);
      setRetailError(null);
      try {
        const entries = await Promise.all(
          SALES_BRANDS.map(async (brand) => {
            const params = new URLSearchParams({
              year: '2026',
              brand,
              growthRate: String(growthParams.growthRate),
              growthRateHq: String(growthParams.growthRateHq),
            });
            const res = await fetch(`/api/inventory/retail-sales?${params}`, { cache: 'no-store' });
            const json = (await res.json()) as RetailSalesApiResponse & { error?: string };
            if (!res.ok) {
              throw new Error(json?.error || `${brand} 리테일 매출 데이터를 불러오지 못했습니다.`);
            }
            const totalRow = json?.hq?.rows?.find((row) => row.isTotal);
            const monthly = totalRow?.monthly ?? new Array(12).fill(null);
            return [brand, monthly] as const;
          }),
        );

        if (mounted) {
          const next: Record<SalesBrand, (number | null)[]> = {
            MLB: new Array(12).fill(null),
            'MLB KIDS': new Array(12).fill(null),
            DISCOVERY: new Array(12).fill(null),
          };
          for (const [brand, monthly] of entries) {
            next[brand] = monthly;
          }
          setDirectRetailByBrand(next);
        }
      } catch (err) {
        if (mounted) setRetailError(err instanceof Error ? err.message : '직영 매출 데이터를 불러오지 못했습니다.');
      } finally {
        if (mounted) setRetailLoading(false);
      }
    };

    fetchDirectRetail();
    return () => {
      mounted = false;
    };
  }, [growthParams]);

  useEffect(() => {
    const readDealerAccSellIn = () => {
      if (typeof window === 'undefined') return;
      const raw = window.localStorage.getItem(INVENTORY_DEALER_ACC_SELLIN_KEY);
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as DealerAccSellInPayload;
        const values = parsed.values ?? {};
        setDealerAccOtbByBrand({
          MLB: (Number(values.MLB) || 0) * 1000,
          'MLB KIDS': (Number(values['MLB KIDS']) || 0) * 1000,
          DISCOVERY: (Number(values.DISCOVERY) || 0) * 1000,
        });
      } catch {
        // ignore malformed localStorage payload
      }
    };

    readDealerAccSellIn();
    window.addEventListener('inventory-dealer-acc-sellin-updated', readDealerAccSellIn as EventListener);
    window.addEventListener('storage', readDealerAccSellIn);
    return () => {
      window.removeEventListener('inventory-dealer-acc-sellin-updated', readDealerAccSellIn as EventListener);
      window.removeEventListener('storage', readDealerAccSellIn);
    };
  }, []);

  const calculatedByBrand = useMemo(() => {
    const result: Record<ForecastLeafBrand, CalculatedSeries> = {
      mlb: deriveCalculated(monthlyInputs.mlb, ANNUAL_2025_RAW_BY_BRAND.mlb),
      kids: deriveCalculated(monthlyInputs.kids, ANNUAL_2025_RAW_BY_BRAND.kids),
      discovery: deriveCalculated(monthlyInputs.discovery, ANNUAL_2025_RAW_BY_BRAND.discovery),
    };
    return result;
  }, [monthlyInputs]);

  const corporateCalculated = useMemo(() => {
    const corporateRawMonthly: Record<string, (number | null)[]> = {};
    for (const account of RAW_ACCOUNTS) {
      corporateRawMonthly[account] = makeMonthlyArray((idx) => {
        const v1 = monthlyInputs.mlb[account]?.[idx] ?? null;
        const v2 = monthlyInputs.kids[account]?.[idx] ?? null;
        const v3 = monthlyInputs.discovery[account]?.[idx] ?? null;
        if (v1 === null && v2 === null && v3 === null) return null;
        return (v1 ?? 0) + (v2 ?? 0) + (v3 ?? 0);
      });
    }

    const annualRaw: Record<string, number> = {};
    for (const account of RAW_ACCOUNTS) {
      annualRaw[account] =
        (ANNUAL_2025_RAW_BY_BRAND.mlb[account] ?? 0) +
        (ANNUAL_2025_RAW_BY_BRAND.kids[account] ?? 0) +
        (ANNUAL_2025_RAW_BY_BRAND.discovery[account] ?? 0);
    }

    return deriveCalculated(corporateRawMonthly, annualRaw);
  }, [monthlyInputs]);

  const rowDefs = activeBrand === null ? ROWS_CORPORATE : ROWS_BRAND;

  const visibleRows = useMemo(() => {
    const rows: ForecastRowDef[] = [];
    let skipUntilLevel = -1;

    for (const row of rowDefs) {
      if (skipUntilLevel >= 0 && row.level > skipUntilLevel) {
        continue;
      }
      skipUntilLevel = -1;
      rows.push(row);
      if (row.isGroup && collapsed.has(row.account)) {
        skipUntilLevel = row.level;
      }
    }

    return rows;
  }, [rowDefs, collapsed]);

  const hasAnyExpanded = useMemo(
    () => rowDefs.some((row) => row.isGroup && !collapsed.has(row.account)),
    [rowDefs, collapsed],
  );

  const getRowSeries = (account: string): { monthly: (number | null)[]; annual2025: number | null } => {
    if (activeBrand === null) {
      if (account === 'Tag매출') {
        return {
          monthly: corporateTagSalesMonthly,
          annual2025: corporateCalculated.annual2025['Tag매출'] ?? null,
        };
      }
      if (account === 'Tag매출_대리상') {
        return {
          monthly: corporateSalesChannel.dealer,
          annual2025: null,
        };
      }
      if (account === 'Tag매출_의류') {
        return {
          monthly: corporateSalesChannel.dealerCloth,
          annual2025: null,
        };
      }
      if (account === 'Tag매출_ACC') {
        return {
          monthly: corporateSalesChannel.dealerAcc,
          annual2025: null,
        };
      }
      if (account === 'Tag매출_직영') {
        return {
          monthly: corporateSalesChannel.direct,
          annual2025: null,
        };
      }
      if (account === '실판매출') {
        return {
          monthly: corporateActualSalesChannel.total,
          annual2025: corporateCalculated.annual2025['실판매출'] ?? null,
        };
      }
      if (account === '실판매출_대리상') {
        return {
          monthly: corporateActualSalesChannel.dealer,
          annual2025: null,
        };
      }
      if (account === '실판매출_의류') {
        return {
          monthly: corporateActualSalesChannel.dealerCloth,
          annual2025: null,
        };
      }
      if (account === '실판매출_ACC') {
        return {
          monthly: corporateActualSalesChannel.dealerAcc,
          annual2025: null,
        };
      }
      if (account === '실판매출_직영') {
        return {
          monthly: corporateActualSalesChannel.direct,
          annual2025: null,
        };
      }

      return {
        monthly: corporateCalculated.monthly[account] ?? new Array(12).fill(null),
        annual2025: corporateCalculated.annual2025[account] ?? null,
      };
    }

    const brandKey = activeBrand as ForecastLeafBrand;
    const salesBrand = FORECAST_TO_SALES_BRAND[brandKey];
    if (account === 'Tag매출') {
      return {
        monthly: tagSalesMonthlyByBrand[salesBrand],
        annual2025: calculatedByBrand[brandKey].annual2025['Tag매출'] ?? null,
      };
    }
    if (account === 'Tag매출_대리상') {
      return { monthly: salesChannelByBrand[salesBrand].dealer, annual2025: null };
    }
    if (account === 'Tag매출_의류') {
      return { monthly: salesChannelByBrand[salesBrand].dealerCloth, annual2025: null };
    }
    if (account === 'Tag매출_ACC') {
      return { monthly: salesChannelByBrand[salesBrand].dealerAcc, annual2025: null };
    }
    if (account === 'Tag매출_직영') {
      return { monthly: salesChannelByBrand[salesBrand].direct, annual2025: null };
    }
    if (account === '실판매출') {
      return {
        monthly: salesActualByBrand[salesBrand].total,
        annual2025: calculatedByBrand[brandKey].annual2025['실판매출'] ?? null,
      };
    }
    if (account === '실판매출_대리상') {
      return { monthly: salesActualByBrand[salesBrand].dealer, annual2025: null };
    }
    if (account === '실판매출_의류') {
      return { monthly: salesActualByBrand[salesBrand].dealerCloth, annual2025: null };
    }
    if (account === '실판매출_ACC') {
      return { monthly: salesActualByBrand[salesBrand].dealerAcc, annual2025: null };
    }
    if (account === '실판매출_직영') {
      return { monthly: salesActualByBrand[salesBrand].direct, annual2025: null };
    }
    return {
      monthly: calculatedByBrand[brandKey].monthly[account] ?? new Array(12).fill(null),
      annual2025: calculatedByBrand[brandKey].annual2025[account] ?? null,
    };
  };

  const getAnnual26Value = (account: string): number | null => {
    if (account === '영업이익률') {
      const annualOi = sumOrNull(getRowSeries('영업이익').monthly);
      const annualSales = sumOrNull(getRowSeries('실판매출').monthly);
      if (annualOi === null || annualSales === null || annualSales === 0) return null;
      return annualOi / annualSales;
    }

    if (account === '(Tag 대비 원가율)') {
      const annualTag = sumOrNull(getRowSeries('Tag매출').monthly);
      const annualCogs = sumOrNull(getRowSeries('매출원가').monthly);
      if (annualTag === null || annualTag === 0 || annualCogs === null) return null;
      return (annualCogs * 1.13) / annualTag;
    }

    return sumOrNull(getRowSeries(account).monthly);
  };

  const updateInput = (brand: ForecastLeafBrand, account: string, monthIndex: number, raw: string) => {
    setMonthlyInputs((prev) => {
      const next = { ...prev, [brand]: { ...prev[brand] } };
      const nextArr = [...(next[brand][account] ?? new Array(12).fill(null))];
      if (raw.trim() === '') {
        nextArr[monthIndex] = null;
      } else {
        const parsed = Number(raw.replace(/,/g, ''));
        // PL table input unit is CNY K; internal calculations use base CNY.
        nextArr[monthIndex] = Number.isFinite(parsed) ? parsed * 1000 : nextArr[monthIndex];
      }
      next[brand][account] = nextArr;
      return next;
    });
  };

  const renderMonthInput = (row: ForecastRowDef, monthIndex: number) => {
    if (activeBrand === null) {
      return <span>{formatValue(getRowSeries(row.account).monthly[monthIndex], row.format)}</span>;
    }

    const brandKey = activeBrand as ForecastLeafBrand;
    const editable = RAW_ACCOUNTS.includes(row.account) && !row.isGroup && !row.isCalculated;
    const isActualLockedMonth = monthIndex === 0; // 1월은 실적월로 고정

    if (!editable || isActualLockedMonth) {
      return <span>{formatValue(getRowSeries(row.account).monthly[monthIndex], row.format)}</span>;
    }

    const value = monthlyInputs[brandKey][row.account]?.[monthIndex] ?? null;
    return (
      <input
        type="text"
        inputMode="numeric"
        value={value === null ? '' : String(Math.round(value / 1000))}
        onChange={(e) => updateInput(brandKey, row.account, monthIndex, e.target.value)}
        className="w-full rounded-md border border-transparent bg-white/80 px-1.5 py-1 text-right outline-none transition-all focus:border-sky-400 focus:bg-white focus:ring-2 focus:ring-sky-100"
      />
    );
  };

  const salesRows = useMemo(() => makeSalesRows(), []);

  const otbByBrand = useMemo(() => {
    const result: Record<SalesBrand, { currS: number; currF: number; total: number }> = {
      MLB: { currS: 0, currF: 0, total: 0 },
      'MLB KIDS': { currS: 0, currF: 0, total: 0 },
      DISCOVERY: { currS: 0, currF: 0, total: 0 },
    };

    for (const brand of SALES_BRANDS) {
      const currF = otbData?.['26F']?.[brand] ?? 0;
      const currS = otbData?.['26S']?.[brand] ?? 0;
      result[brand] = { currS, currF, total: currS + currF };
    }
    return result;
  }, [otbData]);

  const dealerSeasonMonthlyByBrand = useMemo(() => {
    const result: Record<SalesBrand, { 당년S: (number | null)[]; 당년F: (number | null)[] }> = {
      MLB: { 당년S: new Array(12).fill(0), 당년F: new Array(12).fill(0) },
      'MLB KIDS': { 당년S: new Array(12).fill(0), 당년F: new Array(12).fill(0) },
      DISCOVERY: { 당년S: new Array(12).fill(0), 당년F: new Array(12).fill(0) },
    };

    const progressMap = new Map<string, ShipmentProgressRow>();
    for (const row of shipmentProgressRows) {
      progressMap.set(`${row.brand}::${row.season}`, row);
    }

    for (const brand of SALES_BRANDS) {
      for (const season of ['당년S', '당년F'] as const) {
        const progress = progressMap.get(`${brand}::${season}`);
        const otb = season === '당년S' ? otbByBrand[brand].currS : otbByBrand[brand].currF;
        let prevCumulative = progress?.prevYearProgress ?? 0;
        const monthlyAmounts: (number | null)[] = new Array(12).fill(0);

        for (let i = 0; i < 12; i++) {
          const currentCumulative = progress?.monthly[i] ?? prevCumulative;
          const monthlyRate = Math.max(currentCumulative - prevCumulative, 0);
          monthlyAmounts[i] = otb * monthlyRate;
          prevCumulative = currentCumulative;
        }
        result[brand][season] = monthlyAmounts;
      }
    }

    return result;
  }, [shipmentProgressRows, otbByBrand]);

  const accRatioByBrand = useMemo(() => {
    const map: Record<SalesBrand, (number | null)[]> = {
      MLB: new Array(12).fill(null),
      'MLB KIDS': new Array(12).fill(null),
      DISCOVERY: new Array(12).fill(null),
    };
    for (const row of accRatioRows) {
      map[row.brand] = row.monthly;
    }
    return map;
  }, [accRatioRows]);

  const salesDerived = useMemo(() => {
    const rowMap: Record<string, { monthly: (number | null)[]; fy26: number | null; otb: number | null }> = {};

    for (const row of salesRows) {
      if (!row.isGroup && row.leafKind) {
        const monthly =
          row.leafKind === 'dealerCurrS'
            ? dealerSeasonMonthlyByBrand[row.brand].당년S
            : row.leafKind === 'dealerCurrF'
              ? dealerSeasonMonthlyByBrand[row.brand].당년F
              : row.leafKind === 'dealerAcc'
                ? makeMonthlyArray((idx) => dealerAccOtbByBrand[row.brand] * (accRatioByBrand[row.brand][idx] ?? 0))
                : row.leafKind === 'direct'
                ? directRetailByBrand[row.brand] ?? new Array(12).fill(null)
                : new Array(12).fill(null);
        rowMap[row.id] = {
          monthly,
          fy26: sumOrNull(monthly),
          otb:
            row.leafKind === 'dealerCurrS'
              ? otbByBrand[row.brand].currS
              : row.leafKind === 'dealerCurrF'
                ? otbByBrand[row.brand].currF
                : row.leafKind === 'dealerAcc'
                  ? dealerAccOtbByBrand[row.brand]
                  : null,
        };
      }
    }

    for (const brand of SALES_BRANDS) {
      const dealerS = rowMap[`dealerS:${brand}`]?.monthly ?? new Array(12).fill(null);
      const dealerF = rowMap[`dealerF:${brand}`]?.monthly ?? new Array(12).fill(null);
      const dealerClothingTotal = sumSeries(dealerS, dealerF);
      rowMap[`dealerCloth:${brand}`] = {
        monthly: dealerClothingTotal,
        fy26: sumOrNull(dealerClothingTotal),
        otb: otbByBrand[brand].total,
      };

      const dealerAcc = rowMap[`dealerACC:${brand}`]?.monthly ?? new Array(12).fill(null);
      const direct = rowMap[`direct:${brand}`]?.monthly ?? new Array(12).fill(null);
      const brandTotal = sumSeries(sumSeries(dealerClothingTotal, dealerAcc), direct);
      rowMap[`brand:${brand}`] = {
        monthly: brandTotal,
        fy26: sumOrNull(brandTotal),
        otb: null,
      };
    }

    return rowMap;
  }, [salesRows, otbByBrand, directRetailByBrand, dealerSeasonMonthlyByBrand, dealerAccOtbByBrand, accRatioByBrand]);

  const salesChannelByBrand = useMemo(() => {
    const buildEmpty = () => new Array(12).fill(null) as (number | null)[];
    const result: Record<SalesBrand, { dealerCloth: (number | null)[]; dealerAcc: (number | null)[]; dealer: (number | null)[]; direct: (number | null)[] }> = {
      MLB: { dealerCloth: buildEmpty(), dealerAcc: buildEmpty(), dealer: buildEmpty(), direct: buildEmpty() },
      'MLB KIDS': { dealerCloth: buildEmpty(), dealerAcc: buildEmpty(), dealer: buildEmpty(), direct: buildEmpty() },
      DISCOVERY: { dealerCloth: buildEmpty(), dealerAcc: buildEmpty(), dealer: buildEmpty(), direct: buildEmpty() },
    };
    for (const brand of SALES_BRANDS) {
      const plannedDealerCloth = salesDerived[`dealerCloth:${brand}`]?.monthly ?? buildEmpty();
      const plannedDealerAcc = salesDerived[`dealerACC:${brand}`]?.monthly ?? buildEmpty();
      const plannedDealer = sumSeries(plannedDealerCloth, plannedDealerAcc);
      const plannedDirect = salesDerived[`direct:${brand}`]?.monthly ?? buildEmpty();

      const dealerCloth = buildEmpty();
      const dealerAcc = buildEmpty();
      const dealer = buildEmpty();
      const direct = buildEmpty();
      for (let i = 0; i < 12; i += 1) {
        const actualDealer = brandActualByBrand[brand]?.tag?.dealer?.[i] ?? null;
        const actualDirect = brandActualByBrand[brand]?.tag?.direct?.[i] ?? null;

        const dealerValue = actualDealer ?? plannedDealer[i] ?? null;
        const directValue = actualDirect ?? plannedDirect[i] ?? null;
        const split = splitByPlannedRatio(dealerValue, plannedDealerCloth[i] ?? null, plannedDealerAcc[i] ?? null);

        dealer[i] = dealerValue;
        dealerCloth[i] = split.a;
        dealerAcc[i] = split.b;
        direct[i] = directValue;
      }
      result[brand] = {
        dealerCloth,
        dealerAcc,
        dealer,
        direct,
      };
    }
    return result;
  }, [salesDerived, brandActualByBrand]);

  const corporateSalesChannel = useMemo(() => {
    return {
      dealerCloth: sumSeries(
        sumSeries(salesChannelByBrand.MLB.dealerCloth, salesChannelByBrand['MLB KIDS'].dealerCloth),
        salesChannelByBrand.DISCOVERY.dealerCloth,
      ),
      dealerAcc: sumSeries(
        sumSeries(salesChannelByBrand.MLB.dealerAcc, salesChannelByBrand['MLB KIDS'].dealerAcc),
        salesChannelByBrand.DISCOVERY.dealerAcc,
      ),
      dealer: sumSeries(sumSeries(salesChannelByBrand.MLB.dealer, salesChannelByBrand['MLB KIDS'].dealer), salesChannelByBrand.DISCOVERY.dealer),
      direct: sumSeries(sumSeries(salesChannelByBrand.MLB.direct, salesChannelByBrand['MLB KIDS'].direct), salesChannelByBrand.DISCOVERY.direct),
    };
  }, [salesChannelByBrand]);

  const tagSalesMonthlyByBrand = useMemo(() => {
    return {
      MLB: sumSeries(salesChannelByBrand.MLB.dealer, salesChannelByBrand.MLB.direct),
      'MLB KIDS': sumSeries(salesChannelByBrand['MLB KIDS'].dealer, salesChannelByBrand['MLB KIDS'].direct),
      DISCOVERY: sumSeries(salesChannelByBrand.DISCOVERY.dealer, salesChannelByBrand.DISCOVERY.direct),
    } as Record<SalesBrand, (number | null)[]>;
  }, [salesChannelByBrand]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const values = {
      MLB: (() => {
        const annualTag = sumOrNull(tagSalesMonthlyByBrand.MLB);
        const annualCogs = sumOrNull(calculatedByBrand.mlb.monthly['매출원가'] ?? new Array(12).fill(null));
        if (annualTag === null || annualTag === 0 || annualCogs === null) return null;
        return (annualCogs * 1.13) / annualTag;
      })(),
      'MLB KIDS': (() => {
        const annualTag = sumOrNull(tagSalesMonthlyByBrand['MLB KIDS']);
        const annualCogs = sumOrNull(calculatedByBrand.kids.monthly['매출원가'] ?? new Array(12).fill(null));
        if (annualTag === null || annualTag === 0 || annualCogs === null) return null;
        return (annualCogs * 1.13) / annualTag;
      })(),
      DISCOVERY: (() => {
        const annualTag = sumOrNull(tagSalesMonthlyByBrand.DISCOVERY);
        const annualCogs = sumOrNull(calculatedByBrand.discovery.monthly['매출원가'] ?? new Array(12).fill(null));
        if (annualTag === null || annualTag === 0 || annualCogs === null) return null;
        return (annualCogs * 1.13) / annualTag;
      })(),
    };

    const payload = { values };
    window.localStorage.setItem(PL_TAG_COST_RATIO_KEY, JSON.stringify(payload));
    window.dispatchEvent(new CustomEvent('pl-tag-cost-ratio-updated', { detail: payload }));
  }, [calculatedByBrand, tagSalesMonthlyByBrand]);

  const corporateTagSalesMonthly = useMemo(() => {
    return sumSeries(sumSeries(tagSalesMonthlyByBrand.MLB, tagSalesMonthlyByBrand['MLB KIDS']), tagSalesMonthlyByBrand.DISCOVERY);
  }, [tagSalesMonthlyByBrand]);

  const salesActualByBrand = useMemo(() => {
    const buildEmpty = () => new Array(12).fill(null) as (number | null)[];
    const result: Record<SalesBrand, { dealerCloth: (number | null)[]; dealerAcc: (number | null)[]; dealer: (number | null)[]; direct: (number | null)[]; total: (number | null)[] }> = {
      MLB: { dealerCloth: buildEmpty(), dealerAcc: buildEmpty(), dealer: buildEmpty(), direct: buildEmpty(), total: buildEmpty() },
      'MLB KIDS': { dealerCloth: buildEmpty(), dealerAcc: buildEmpty(), dealer: buildEmpty(), direct: buildEmpty(), total: buildEmpty() },
      DISCOVERY: { dealerCloth: buildEmpty(), dealerAcc: buildEmpty(), dealer: buildEmpty(), direct: buildEmpty(), total: buildEmpty() },
    };
    for (const brand of SALES_BRANDS) {
      const plannedDealerCloth = applyRate(salesChannelByBrand[brand].dealerCloth, SHIPMENT_RATE_PERCENT_BY_CHANNEL.dealerCloth[brand]);
      const plannedDealerAcc = applyRate(salesChannelByBrand[brand].dealerAcc, SHIPMENT_RATE_PERCENT_BY_CHANNEL.dealerAcc[brand]);
      const plannedDealer = sumSeries(plannedDealerCloth, plannedDealerAcc);
      const plannedDirect = applyRate(salesChannelByBrand[brand].direct, SHIPMENT_RATE_PERCENT_BY_CHANNEL.direct[brand]);

      const dealerCloth = buildEmpty();
      const dealerAcc = buildEmpty();
      const dealer = buildEmpty();
      const direct = buildEmpty();
      for (let i = 0; i < 12; i += 1) {
        const actualDealer = brandActualByBrand[brand]?.sales?.dealer?.[i] ?? null;
        const actualDirect = brandActualByBrand[brand]?.sales?.direct?.[i] ?? null;
        const dealerValue = actualDealer ?? plannedDealer[i] ?? null;
        const directValue = actualDirect ?? plannedDirect[i] ?? null;
        const split = splitByPlannedRatio(dealerValue, plannedDealerCloth[i] ?? null, plannedDealerAcc[i] ?? null);
        dealer[i] = dealerValue;
        dealerCloth[i] = split.a;
        dealerAcc[i] = split.b;
        direct[i] = directValue;
      }
      result[brand] = {
        dealerCloth,
        dealerAcc,
        dealer,
        direct,
        total: sumSeries(dealer, direct),
      };
    }
    return result;
  }, [salesChannelByBrand, brandActualByBrand]);

  const corporateActualSalesChannel = useMemo(() => {
    return {
      dealerCloth: sumSeries(
        sumSeries(salesActualByBrand.MLB.dealerCloth, salesActualByBrand['MLB KIDS'].dealerCloth),
        salesActualByBrand.DISCOVERY.dealerCloth,
      ),
      dealerAcc: sumSeries(
        sumSeries(salesActualByBrand.MLB.dealerAcc, salesActualByBrand['MLB KIDS'].dealerAcc),
        salesActualByBrand.DISCOVERY.dealerAcc,
      ),
      dealer: sumSeries(sumSeries(salesActualByBrand.MLB.dealer, salesActualByBrand['MLB KIDS'].dealer), salesActualByBrand.DISCOVERY.dealer),
      direct: sumSeries(sumSeries(salesActualByBrand.MLB.direct, salesActualByBrand['MLB KIDS'].direct), salesActualByBrand.DISCOVERY.direct),
      total: sumSeries(sumSeries(salesActualByBrand.MLB.total, salesActualByBrand['MLB KIDS'].total), salesActualByBrand.DISCOVERY.total),
    };
  }, [salesActualByBrand]);

  const latestActualMonth = useMemo(() => {
    if (brandActualAvailableMonths.length === 0) return 0;
    return Math.max(...brandActualAvailableMonths);
  }, [brandActualAvailableMonths]);

  useEffect(() => {
    setMonthlyInputs((prev) => {
      let changed = false;
      const next: MonthlyInputs = {
        mlb: { ...prev.mlb },
        kids: { ...prev.kids },
        discovery: { ...prev.discovery },
      };

      (Object.entries(FORECAST_TO_SALES_BRAND) as [ForecastLeafBrand, SalesBrand][]).forEach(([forecastBrand, salesBrand]) => {
        const nextTag = [...tagSalesMonthlyByBrand[salesBrand]];
        const nextActual = [...salesActualByBrand[salesBrand].total];
        const currentTag = prev[forecastBrand]['Tag매출'] ?? new Array(12).fill(null);
        const currentActual = prev[forecastBrand]['실판매출'] ?? new Array(12).fill(null);

        if (!isSameSeries(currentTag, nextTag)) {
          next[forecastBrand]['Tag매출'] = nextTag;
          changed = true;
        }
        if (!isSameSeries(currentActual, nextActual)) {
          next[forecastBrand]['실판매출'] = nextActual;
          changed = true;
        }

        const accountOverrides = brandActualByBrand[salesBrand]?.accounts ?? {};
        for (const [account, overrideSeries] of Object.entries(accountOverrides)) {
          if (!RAW_ACCOUNTS.includes(account) || account === 'Tag매출' || account === '실판매출') continue;
          const current = prev[forecastBrand][account] ?? new Array(12).fill(null);
          const merged = [...current];
          let localChanged = false;
          for (let i = 0; i < 12; i += 1) {
            const v = overrideSeries?.[i] ?? null;
            if (v === null) continue;
            if ((merged[i] ?? null) !== v) {
              merged[i] = v;
              localChanged = true;
            }
          }
          if (localChanged) {
            next[forecastBrand][account] = merged;
            changed = true;
          }
        }

        const tagCostRatioSeries = tagCostRatioByBrand[salesBrand] ?? new Array(12).fill(null);
        const currentCogs = next[forecastBrand]['매출원가'] ?? new Array(12).fill(null);
        const mergedCogs = [...currentCogs];
        let cogsChanged = false;
        for (let i = 0; i < 12; i += 1) {
          if (i + 1 <= latestActualMonth) continue;
          if (accountOverrides['매출원가']?.[i] !== null && accountOverrides['매출원가']?.[i] !== undefined) continue;

          const tag = next[forecastBrand]['Tag매출']?.[i] ?? null;
          const ratio = tagCostRatioSeries[i] ?? null;
          if (tag === null || ratio === null) continue;

          const forecastCogs = (tag / 1.13) * ratio;
          if ((mergedCogs[i] ?? null) !== forecastCogs) {
            mergedCogs[i] = forecastCogs;
            cogsChanged = true;
          }
        }
        if (cogsChanged) {
          next[forecastBrand]['매출원가'] = mergedCogs;
          changed = true;
        }

        const directExpenseRatio = directExpenseRatioByBrand[salesBrand] ?? {};
        const salesSeries = next[forecastBrand]['실판매출'] ?? new Array(12).fill(null);
        for (const account of DIRECT_EXPENSE_ACCOUNTS) {
          const ratioSeries = directExpenseRatio[account];
          if (!ratioSeries) continue;

          const current = next[forecastBrand][account] ?? new Array(12).fill(null);
          const merged = [...current];
          let localChanged = false;
          for (let i = 0; i < 12; i += 1) {
            if (i + 1 <= latestActualMonth) continue;
            if (accountOverrides[account]?.[i] !== null && accountOverrides[account]?.[i] !== undefined) continue;

            const sales = salesSeries[i] ?? null;
            const ratio = ratioSeries[i] ?? null;
            if (sales === null || ratio === null) continue;

            const forecastValue = sales * ratio;
            if ((merged[i] ?? null) !== forecastValue) {
              merged[i] = forecastValue;
              localChanged = true;
            }
          }
          if (localChanged) {
            next[forecastBrand][account] = merged;
            changed = true;
          }
        }

        const opexForecast = opexForecastByBrand[salesBrand] ?? {};
        for (const account of OPERATING_EXPENSE_ACCOUNTS) {
          const forecastSeries = opexForecast[account];
          if (!forecastSeries) continue;
          const actualSeries = accountOverrides[account] ?? new Array(12).fill(null);
          const current = next[forecastBrand][account] ?? new Array(12).fill(null);
          const merged = [...current];
          let localChanged = false;
          for (let i = 1; i < 12; i += 1) {
            if (actualSeries[i] !== null && actualSeries[i] !== undefined) continue;
            const fv = forecastSeries[i] ?? null;
            if (fv === null) continue;
            if ((merged[i] ?? null) !== fv) {
              merged[i] = fv;
              localChanged = true;
            }
          }
          if (localChanged) {
            next[forecastBrand][account] = merged;
            changed = true;
          }
        }
      });

      return changed ? next : prev;
    });
  }, [tagSalesMonthlyByBrand, salesActualByBrand, brandActualByBrand, directExpenseRatioByBrand, latestActualMonth, opexForecastByBrand, tagCostRatioByBrand]);

  const visibleSalesRows = useMemo(() => {
    return salesRows.filter((row) => {
      let parent = row.parentId;
      while (parent) {
        if (salesCollapsed.has(parent)) return false;
        parent = salesRows.find((r) => r.id === parent)?.parentId ?? null;
      }
      return true;
    });
  }, [salesRows, salesCollapsed]);

  const shipmentProgressOrderedRows = useMemo(() => {
    const rowMap = new Map<string, ShipmentProgressRow>();
    for (const row of shipmentProgressRows) {
      rowMap.set(`${row.brand}::${row.season}`, row);
    }
    const ordered: ShipmentProgressRow[] = [];
    for (const brand of SALES_BRANDS) {
      for (const season of ['당년S', '당년F'] as const) {
        ordered.push(
          rowMap.get(`${brand}::${season}`) ?? {
            brand,
            season,
            prevYearProgress: null,
            monthly: new Array(12).fill(null),
          },
        );
      }
    }
    return ordered;
  }, [shipmentProgressRows]);

  const accRatioOrderedRows = useMemo(() => {
    const rowMap = new Map<string, AccShipmentRatioRow>();
    for (const row of accRatioRows) {
      rowMap.set(row.brand, row);
    }
    return SALES_BRANDS.map((brand) => rowMap.get(brand) ?? { brand, monthly: new Array(12).fill(null) });
  }, [accRatioRows]);

  const formatProgress = (value: number | null): string => {
    if (value === null || Number.isNaN(value)) return '';
    return `${value.toFixed(6)}`.replace(/\.?0+$/, '');
  };

  const formatPercent3 = (value: number | null): string => {
    if (value === null || Number.isNaN(value)) return '';
    return `${(value * 100).toFixed(3)}%`;
  };

  const isLoadingAny =
    otbLoading ||
    retailLoading ||
    shipmentProgressLoading ||
    accRatioLoading ||
    brandActualLoading ||
    opexForecastLoading ||
    directExpenseRatioLoading ||
    tagCostRatioLoading;
  const hasAnyLoadError =
    !!otbError ||
    !!retailError ||
    !!shipmentProgressError ||
    !!accRatioError ||
    !!brandActualError ||
    !!opexForecastError ||
    !!directExpenseRatioError ||
    !!tagCostRatioError;

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-[radial-gradient(1200px_500px_at_10%_-20%,#e0e7ff_0%,transparent_55%),radial-gradient(900px_420px_at_100%_0%,#dbeafe_0%,transparent_45%),linear-gradient(180deg,#f8fafc_0%,#f1f5f9_100%)]">
      <div className="sticky top-16 z-40 border-b border-slate-200/80 bg-white/80 backdrop-blur-md">
        <div className="px-6 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="mr-2 whitespace-nowrap text-sm font-semibold tracking-tight text-slate-800">
              PL Forecast (FY26)
            </div>
            <div className="inline-flex rounded-xl border border-slate-300/80 bg-slate-200/70 p-1 shadow-inner">
              {FORECAST_BRANDS.map((brand) => {
                const selected = activeBrand === brand.id;
                return (
                  <button
                    key={brand.id ?? 'corp'}
                    type="button"
                    onClick={() => setActiveBrand(brand.id)}
                    className={`rounded-lg px-4 py-2 text-sm font-semibold transition-all ${
                      selected
                        ? 'bg-gradient-to-b from-[#4a6694] to-[#3a5583] text-white shadow-[0_2px_8px_rgba(58,85,131,0.35)]'
                        : 'text-slate-600 hover:bg-white/90 hover:text-slate-800'
                    }`}
                  >
                    {brand.label}
                  </button>
                );
              })}
            </div>

            <div className="h-6 w-px bg-slate-300" />

            <button
              type="button"
              onClick={() => {
                const groups = rowDefs.filter((r) => r.isGroup).map((r) => r.account);
                if (hasAnyExpanded) {
                  setCollapsed(new Set(groups));
                } else {
                  setCollapsed(new Set());
                }
              }}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
            >
              {hasAnyExpanded ? '전체 접기' : '전체 펼치기'}
            </button>

            <div
              className={`rounded-full border px-3 py-1 text-xs shadow-sm ${
                isLoadingAny
                  ? 'border-red-300 bg-red-100 text-red-700'
                  : hasAnyLoadError
                    ? 'border-red-200 bg-red-50 text-red-600'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-700'
              }`}
            >
              {isLoadingAny ? '데이터 로딩중' : hasAnyLoadError ? '오류' : 'PL 계산완료'}
            </div>

            <div className="ml-auto rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-500 shadow-sm">
              단위: CNY K
            </div>
          </div>
        </div>
      </div>

      <div className="p-6">
        <div
          className="overflow-auto rounded-2xl border border-slate-200 bg-white/95 shadow-[0_10px_30px_rgba(15,23,42,0.08)]"
          style={{ maxHeight: 'calc(100vh - 220px)' }}
        >
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead className="sticky top-0 z-20">
              <tr>
                <th className="sticky left-0 z-30 min-w-[260px] border-b border-r border-slate-300 bg-gradient-to-r from-[#2f4f7f] to-[#3b5f93] px-4 py-3 text-center font-semibold text-white">
                  계정과목
                </th>
                <th className="min-w-[130px] border-b border-r border-slate-300 bg-gradient-to-r from-[#3b5f93] to-[#4b6fa3] px-3 py-3 text-center font-semibold text-slate-50">
                  25년(연간)
                </th>
                {MONTH_HEADERS.map((month) => (
                  <th
                    key={month}
                    className="min-w-[105px] border-b border-r border-slate-300 bg-gradient-to-r from-[#2f4f7f] to-[#3b5f93] px-3 py-3 text-center font-semibold text-slate-50"
                  >
                    {month}
                  </th>
                ))}
                <th className="min-w-[130px] border-b border-r border-slate-300 bg-gradient-to-r from-[#3b5f93] to-[#4b6fa3] px-3 py-3 text-center font-semibold text-slate-50">
                  26년(연간)
                </th>
                <th className="min-w-[100px] border-b border-slate-300 bg-gradient-to-r from-[#4b6fa3] to-[#5c80b1] px-3 py-3 text-center font-semibold text-slate-50">
                  YoY
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => {
                const series = getRowSeries(row.account);
                const annual26 = getAnnual26Value(row.account);
                const yoyText = formatYoYByAnnual(annual26, series.annual2025);
                const isGroupCollapsed = row.isGroup && collapsed.has(row.account);
                const accountLabel = ACCOUNT_LABEL_OVERRIDES[row.account] ?? row.account;
                const isProfitFocusRow = ['매출총이익', '영업이익', '영업이익률'].includes(row.account);
                const rowTone =
                  isProfitFocusRow
                    ? 'bg-sky-100'
                    : row.level === 0
                      ? (row.isBold ? 'bg-slate-50' : 'bg-white')
                      : row.level === 1
                        ? 'bg-white'
                        : 'bg-slate-50/40';

                return (
                  <tr key={row.account} className={`${rowTone} transition-colors hover:bg-sky-50/50`}>
                    <td className="sticky left-0 z-10 border-b border-r border-slate-200 px-4 py-2.5" style={{ paddingLeft: `${16 + row.level * 18}px` }}>
                      <div className="flex items-center gap-2">
                        <span className={row.isBold ? 'font-semibold text-slate-800' : 'text-slate-700'}>{accountLabel}</span>
                        {row.isGroup ? (
                          <button
                            type="button"
                            onClick={() => {
                              setCollapsed((prev) => {
                                const next = new Set(prev);
                                if (next.has(row.account)) next.delete(row.account);
                                else next.add(row.account);
                                return next;
                              });
                            }}
                            className="inline-flex h-5 w-5 items-center justify-center rounded border border-slate-300 bg-white text-[11px] text-slate-500"
                          >
                            {isGroupCollapsed ? '+' : '-'}
                          </button>
                        ) : (
                          <span className="inline-flex h-5 w-5" />
                        )}
                      </div>
                    </td>
                    <td className="border-b border-r border-slate-200 px-3 py-2.5 text-right text-slate-700">{formatValue(series.annual2025, row.format)}</td>
                    {MONTH_HEADERS.map((_, monthIndex) => (
                      <td key={`${row.account}-${monthIndex}`} className="border-b border-r border-slate-200 px-2.5 py-1.5 text-right text-slate-700">
                        {renderMonthInput(row, monthIndex)}
                      </td>
                    ))}
                    <td className={`border-b border-r border-slate-200 px-3 py-2.5 text-right font-medium text-slate-800 ${isProfitFocusRow ? 'bg-sky-100' : 'bg-slate-50'}`}>
                      {formatValue(annual26, row.format)}
                    </td>
                    <td className={`border-b border-slate-200 px-3 py-2.5 text-right text-slate-500 ${isProfitFocusRow ? 'bg-sky-100' : 'bg-slate-50'}`}>{yoyText}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-3 rounded-xl border border-slate-200 bg-white/85 px-4 py-3 text-xs text-slate-600 shadow-sm">
          <button
            type="button"
            onClick={() => setLogicGuideCollapsed((prev) => !prev)}
            className="flex w-full items-center justify-between text-left"
          >
            <span className="font-semibold text-slate-700">반영 로직 안내</span>
            <span className="text-slate-500">{logicGuideCollapsed ? '펼치기' : '접기'}</span>
          </button>
          {!logicGuideCollapsed && (
            <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2">
                <div>1. `m월` CSV 존재 여부 확인</div>
                <div className="mt-0.5">파일: `보조파일(simu)/pl_brand_actual_K/2026-mm.csv`</div>
                <div className="mt-1">2. `Tag매출` 계산</div>
                <div className="mt-0.5">`Tag(대리상,m) = CSV값 있으면 CSV, 없으면 계획값`</div>
                <div className="mt-0.5">`Tag(직영,m) = CSV값 있으면 CSV, 없으면 계획값`</div>
                <div className="mt-0.5">`Tag(의류,m) = Tag(대리상,m) × [계획의류(m)/(계획의류(m)+계획ACC(m))]`</div>
                <div className="mt-0.5">`Tag(ACC,m) = Tag(대리상,m) - Tag(의류,m)`</div>
                <div className="mt-0.5">`Tag(총,m) = Tag(대리상,m) + Tag(직영,m)`</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2">
                <div>3. `실판매출` 계산</div>
                <div className="mt-0.5">`실판(대리상,m) = CSV값 있으면 CSV, 없으면 [Tag(의류,m)×의류출고율 + Tag(ACC,m)×ACC출고율] ÷ 1.13`</div>
                <div className="mt-0.5">`실판(직영,m) = CSV값 있으면 CSV, 없으면 [Tag(직영,m)×직영출고율] ÷ 1.13`</div>
                <div className="mt-0.5">`실판(의류,m) = 실판(대리상,m) × [계획실판의류(m)/(계획실판의류(m)+계획실판ACC(m))]`</div>
                <div className="mt-0.5">`실판(ACC,m) = 실판(대리상,m) - 실판(의류,m)`</div>
                <div className="mt-0.5">`실판(총,m) = 실판(대리상,m) + 실판(직영,m)`</div>
                <div className="mt-1">4. 출고율(브랜드별 고정)</div>
                <div className="mt-0.5">의류: MLB 42%, MLB KIDS 42%, DISCOVERY 45%</div>
                <div className="mt-0.5">ACC: MLB 47%, MLB KIDS 42%, DISCOVERY 45%</div>
                <div className="mt-0.5">직영: 10%</div>
                <div className="mt-1">5. 비용계정(매출원가~기타(영업비))</div>
                <div className="mt-0.5">`계정(m) = CSV값 있으면 CSV, 없으면 기존 계획값`</div>
              </div>
            </div>
          )}
        </div>

        <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50/85 shadow-sm">
          <button
            type="button"
            onClick={() => setSalesSectionOpen((prev) => !prev)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left"
          >
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-[#3b5f93] text-white text-xs">
              매
            </span>
            <div className="flex-1">
              <div className="text-sm font-semibold text-slate-800">매출 보조지표</div>
              <div className="text-xs text-slate-500">브랜드/채널/시즌별 월 매출 계획 (OTB 연동)</div>
            </div>
            <span className="text-xs text-slate-500">{salesSectionOpen ? '접기' : '펼치기'}</span>
          </button>

          {salesSectionOpen && (
            <div className="border-t border-slate-200 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-xs text-slate-500">OTB 매핑: 당년F=26F, 당년S=26S, 대리상(의류)=당년S+당년F</div>
                <div className="flex items-center gap-3">
                  <div className="text-xs text-slate-500">
                    성장률 반영: 대리상 {growthParams.growthRate}% / 직영 {growthParams.growthRateHq}%
                  </div>
                  {otbLoading && <div className="text-xs text-slate-500">OTB 불러오는 중...</div>}
                  {retailLoading && <div className="text-xs text-slate-500">직영 매출 불러오는 중...</div>}
                  {brandActualLoading && <div className="text-xs text-slate-500">실적 CSV 불러오는 중...</div>}
                  {opexForecastLoading && <div className="text-xs text-slate-500">영업비 계획 CSV 불러오는 중...</div>}
                  {(otbError || retailError || brandActualError || opexForecastError) && (
                    <div className="text-xs text-red-500">{otbError || retailError || brandActualError || opexForecastError}</div>
                  )}
                </div>
              </div>

              <div className="overflow-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-full border-separate border-spacing-0 text-sm">
                  <thead className="sticky top-0 z-10">
                    <tr>
                      <th className="min-w-[130px] border-b border-r border-slate-300 bg-slate-800 px-3 py-2 text-center font-semibold text-slate-100">브랜드</th>
                      <th className="min-w-[220px] border-b border-r border-slate-300 bg-slate-800 px-3 py-2 text-center font-semibold text-slate-100">채널</th>
                      <th className="min-w-[120px] border-b border-r border-slate-300 bg-slate-700 px-3 py-2 text-center font-semibold text-slate-100">OTB</th>
                      {MONTH_HEADERS.map((month) => (
                        <th key={`sales-${month}`} className="min-w-[95px] border-b border-r border-slate-300 bg-slate-800 px-3 py-2 text-center font-semibold text-slate-100">
                          {month}
                        </th>
                      ))}
                      <th className="min-w-[120px] border-b border-slate-300 bg-slate-700 px-3 py-2 text-center font-semibold text-slate-100">FY26</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleSalesRows.map((row) => {
                      const series = salesDerived[row.id] ?? { monthly: new Array(12).fill(null), fy26: null, otb: null };
                      const isCollapsed = row.isGroup && salesCollapsed.has(row.id);
                      const rowBg = row.level === 1 ? 'bg-slate-100' : row.level === 2 ? 'bg-white' : 'bg-slate-50/70';

                      return (
                        <tr key={row.id} className={`${rowBg} hover:bg-sky-50/50`}>
                          <td className="border-b border-r border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800">
                            {row.level === 1 ? row.brand : ''}
                          </td>
                          <td className="border-b border-r border-slate-200 px-3 py-2" style={{ paddingLeft: `${10 + row.level * 16}px` }}>
                            <div className="flex items-center gap-2">
                              <span className={row.level <= 2 ? 'text-slate-700' : 'text-slate-600'}>{row.accountLabel}</span>
                              {row.isGroup ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSalesCollapsed((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(row.id)) next.delete(row.id);
                                      else next.add(row.id);
                                      return next;
                                    });
                                  }}
                                  className="inline-flex h-5 w-5 items-center justify-center rounded border border-slate-300 bg-white text-[11px] text-slate-500"
                                >
                                  {isCollapsed ? '+' : '-'}
                                </button>
                              ) : (
                                <span className="inline-flex h-5 w-5" />
                              )}
                            </div>
                          </td>
                          <td className="border-b border-r border-slate-200 px-3 py-2 text-right text-slate-700">
                            {row.id.startsWith('dealerCloth:') ||
                            row.id.startsWith('dealerS:') ||
                            row.id.startsWith('dealerF:') ||
                            row.id.startsWith('dealerACC:')
                              ? formatValue(series.otb, 'number')
                              : ''}
                          </td>
                          {MONTH_HEADERS.map((_, monthIndex) => (
                            <td key={`${row.id}-m${monthIndex}`} className="border-b border-r border-slate-200 px-2 py-1 text-right text-slate-700">
                              <span>{formatValue(series.monthly[monthIndex], 'number')}</span>
                            </td>
                          ))}
                          <td className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-right font-medium text-slate-800">
                            {formatValue(series.fy26, 'number')}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-5 rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-800">대리상 출고 진척률</div>
                    <div className="text-xs text-slate-500">CSV 원천값 반영 (파일 수정 시 재조회 반영)</div>
                  </div>
                  <div className="text-xs text-slate-500">
                    {shipmentProgressLoading ? '불러오는 중...' : shipmentProgressError ? '오류' : '최신값 반영'}
                  </div>
                </div>

                {shipmentProgressError ? (
                  <div className="px-4 py-4 text-sm text-red-500">{shipmentProgressError}</div>
                ) : (
                  <div className="overflow-auto">
                    <table className="w-full border-separate border-spacing-0 text-sm">
                      <thead className="sticky top-0 z-10">
                        <tr>
                          <th className="min-w-[140px] border-b border-r border-slate-300 bg-slate-800 px-3 py-2 text-center font-semibold text-slate-100">브랜드</th>
                          <th className="min-w-[110px] border-b border-r border-slate-300 bg-slate-800 px-3 py-2 text-center font-semibold text-slate-100">시즌</th>
                          <th className="min-w-[140px] border-b border-r border-slate-300 bg-slate-700 px-3 py-2 text-center font-semibold text-slate-100">전년까지진척률</th>
                          {MONTH_HEADERS.map((month) => (
                            <th key={`progress-${month}`} className="min-w-[92px] border-b border-r border-slate-300 bg-slate-800 px-3 py-2 text-center font-semibold text-slate-100">
                              {month}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {shipmentProgressOrderedRows.map((row, idx) => (
                          <tr key={`${row.brand}-${row.season}`} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                            <td className="border-b border-r border-slate-200 px-3 py-2 text-center font-medium text-slate-800">
                              {row.season === '당년S' ? row.brand : ''}
                            </td>
                            <td className="border-b border-r border-slate-200 px-3 py-2 text-center text-slate-700">{row.season}</td>
                            <td className="border-b border-r border-slate-200 px-3 py-2 text-right text-slate-700">
                              {formatProgress(row.prevYearProgress)}
                            </td>
                            {MONTH_HEADERS.map((_, monthIndex) => (
                              <td key={`${row.brand}-${row.season}-${monthIndex}`} className="border-b border-r border-slate-200 px-3 py-2 text-right text-slate-700">
                                {formatProgress(row.monthly[monthIndex] ?? null)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="mt-5 rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-800">ACC 출고비율</div>
                    <div className="text-xs text-slate-500">CSV 원천값 반영 (파일 수정 시 재조회 반영)</div>
                  </div>
                  <div className="text-xs text-slate-500">
                    {accRatioLoading ? '불러오는 중...' : accRatioError ? '오류' : '최신값 반영'}
                  </div>
                </div>

                {accRatioError ? (
                  <div className="px-4 py-4 text-sm text-red-500">{accRatioError}</div>
                ) : (
                  <div className="overflow-auto">
                    <table className="w-full border-separate border-spacing-0 text-sm">
                      <thead className="sticky top-0 z-10">
                        <tr>
                          <th className="min-w-[160px] border-b border-r border-slate-300 bg-slate-800 px-3 py-2 text-center font-semibold text-slate-100">브랜드</th>
                          {MONTH_HEADERS.map((month) => (
                            <th key={`acc-ratio-${month}`} className="min-w-[92px] border-b border-r border-slate-300 bg-slate-800 px-3 py-2 text-center font-semibold text-slate-100">
                              {month}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {accRatioOrderedRows.map((row, idx) => (
                          <tr key={`acc-ratio-${row.brand}`} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                            <td className="border-b border-r border-slate-200 px-3 py-2 text-center font-medium text-slate-800">{row.brand}</td>
                            {MONTH_HEADERS.map((_, monthIndex) => (
                              <td key={`acc-ratio-${row.brand}-${monthIndex}`} className="border-b border-r border-slate-200 px-3 py-2 text-right text-slate-700">
                                {formatProgress(row.monthly[monthIndex] ?? null)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="mt-5 rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-800">브랜드별 출고율</div>
                  </div>
                </div>
                <div className="overflow-auto">
                  <table className="w-full border-separate border-spacing-0 text-sm">
                    <thead>
                      <tr>
                        <th className="min-w-[160px] border-b border-r border-slate-300 bg-slate-800 px-3 py-2 text-center font-semibold text-slate-100">
                          대리상 출고율
                        </th>
                        {SALES_BRANDS.map((brand) => (
                          <th
                            key={`brand-rate-head-${brand}`}
                            className="min-w-[120px] border-b border-r border-slate-300 bg-slate-800 px-3 py-2 text-center font-semibold text-slate-100 last:border-r-0"
                          >
                            {brand}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {BRAND_SHIPMENT_RATE_ROWS.map((row, idx) => (
                        <tr key={`brand-rate-${row.category}`} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                          <td className="border-b border-r border-slate-200 px-3 py-2 text-left font-medium text-slate-800">
                            {row.category}
                          </td>
                          {SALES_BRANDS.map((brand) => (
                            <td
                              key={`brand-rate-${row.category}-${brand}`}
                              className="border-b border-r border-slate-200 px-3 py-2 text-center text-slate-700 last:border-r-0"
                            >
                              {row.rates[brand]}%
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50/85 shadow-sm">
          <button
            type="button"
            onClick={() => setDirectExpenseRatioSectionOpen((prev) => !prev)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left"
          >
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-[#6b7a8f] text-xs text-white">
              직
            </span>
            <div className="flex-1">
              <div className="text-sm font-semibold text-slate-800">직접비율 보조지표</div>
              <div className="text-xs text-slate-500">실적월까지 공백, 익월부터 12월까지 CSV 원천값 표시</div>
            </div>
            <div className="text-xs text-slate-500">
              {directExpenseRatioLoading
                ? '불러오는 중...'
                : directExpenseRatioError
                  ? '오류'
                  : latestActualMonth > 0
                    ? `실적월 ${latestActualMonth}월 기준`
                    : '실적 파일 없음'}
            </div>
            <span className="text-xs text-slate-500">{directExpenseRatioSectionOpen ? '접기' : '펼치기'}</span>
          </button>

          {directExpenseRatioSectionOpen && (
            <>
              {directExpenseRatioError ? (
                <div className="border-t border-slate-200 px-4 py-4 text-sm text-red-500">{directExpenseRatioError}</div>
              ) : (
                <div className="border-t border-slate-200 p-4">
                  <div className="overflow-auto rounded-xl border border-slate-200 bg-white">
                    <table className="w-full border-separate border-spacing-0 text-sm">
                      <thead className="sticky top-0 z-10">
                        <tr>
                          <th className="min-w-[180px] border-b border-r border-slate-300 bg-slate-800 px-3 py-2 text-center font-semibold text-slate-100">
                            구분
                          </th>
                          {MONTH_HEADERS.map((month) => (
                            <th
                              key={`direct-expense-ratio-${month}`}
                              className="min-w-[92px] border-b border-r border-slate-300 bg-slate-800 px-3 py-2 text-center font-semibold text-slate-100 last:border-r-0"
                            >
                              {month}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {SALES_BRANDS.map((brand) => (
                          <Fragment key={`direct-expense-ratio-group-${brand}`}>
                            <tr key={`direct-expense-ratio-brand-${brand}`} className="bg-slate-100">
                              <td className="border-b border-r border-slate-200 px-3 py-2 font-semibold text-slate-800">{brand}</td>
                              {MONTH_HEADERS.map((_, monthIndex) => (
                                <td
                                  key={`direct-expense-ratio-brand-${brand}-${monthIndex}`}
                                  className="border-b border-r border-slate-200 px-3 py-2 last:border-r-0"
                                />
                              ))}
                            </tr>
                            {DIRECT_EXPENSE_ACCOUNTS.map((account, accountIndex) => {
                              const series = directExpenseRatioByBrand[brand]?.[account] ?? new Array(12).fill(null);
                              return (
                                <tr
                                  key={`direct-expense-ratio-${brand}-${account}`}
                                  className={accountIndex % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}
                                >
                                  <td className="border-b border-r border-slate-200 px-3 py-2 pl-7 text-slate-700">{account}</td>
                                  {MONTH_HEADERS.map((_, monthIndex) => {
                                    const hiddenByActual = monthIndex + 1 <= latestActualMonth;
                                    const value = hiddenByActual ? null : (series[monthIndex] ?? null);
                                    return (
                                      <td
                                        key={`direct-expense-ratio-${brand}-${account}-${monthIndex}`}
                                        className="border-b border-r border-slate-200 px-3 py-2 text-right text-slate-700 last:border-r-0"
                                      >
                                        {formatPercent3(value)}
                                      </td>
                                    );
                                  })}
                                </tr>
                              );
                            })}
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50/85 shadow-sm">
          <button
            type="button"
            onClick={() => setTagCostRatioSectionOpen((prev) => !prev)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left"
          >
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-[#7b6a58] text-xs text-white">
              원
            </span>
            <div className="flex-1">
              <div className="text-sm font-semibold text-slate-800">Tag대비원가율 보조지표</div>
              <div className="text-xs text-slate-500">실적월까지 공백, 익월부터 12월까지 CSV 원천값 표시</div>
            </div>
            <div className="text-xs text-slate-500">
              {tagCostRatioLoading
                ? '불러오는 중...'
                : tagCostRatioError
                  ? '오류'
                  : latestActualMonth > 0
                    ? `실적월 ${latestActualMonth}월 기준`
                    : '실적 파일 없음'}
            </div>
            <span className="text-xs text-slate-500">{tagCostRatioSectionOpen ? '접기' : '펼치기'}</span>
          </button>

          {tagCostRatioSectionOpen && (
            <>
              {tagCostRatioError ? (
                <div className="border-t border-slate-200 px-4 py-4 text-sm text-red-500">{tagCostRatioError}</div>
              ) : (
                <div className="border-t border-slate-200 p-4">
                  <div className="overflow-auto rounded-xl border border-slate-200 bg-white">
                    <table className="w-full border-separate border-spacing-0 text-sm">
                      <thead className="sticky top-0 z-10">
                        <tr>
                          <th className="min-w-[180px] border-b border-r border-slate-300 bg-slate-800 px-3 py-2 text-center font-semibold text-slate-100">
                            구분
                          </th>
                          {MONTH_HEADERS.map((month) => (
                            <th
                              key={`tag-cost-ratio-${month}`}
                              className="min-w-[92px] border-b border-r border-slate-300 bg-slate-800 px-3 py-2 text-center font-semibold text-slate-100 last:border-r-0"
                            >
                              {month}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {SALES_BRANDS.map((brand, idx) => {
                          const series = tagCostRatioByBrand[brand] ?? new Array(12).fill(null);
                          return (
                            <tr key={`tag-cost-ratio-${brand}`} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                              <td className="border-b border-r border-slate-200 px-3 py-2 font-medium text-slate-800">{brand}</td>
                              {MONTH_HEADERS.map((_, monthIndex) => {
                                const hiddenByActual = monthIndex + 1 <= latestActualMonth;
                                const value = hiddenByActual ? null : (series[monthIndex] ?? null);
                                return (
                                  <td
                                    key={`tag-cost-ratio-${brand}-${monthIndex}`}
                                    className="border-b border-r border-slate-200 px-3 py-2 text-right text-slate-700 last:border-r-0"
                                  >
                                    {formatPercent3(value)}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
