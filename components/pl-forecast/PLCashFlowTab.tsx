'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, ChevronRight, ChevronLeft } from 'lucide-react';
import { formatNumber, getRecoveryMonthLabelsAsN월 } from '@/lib/utils';
import { buildWcPlanByKeyFromBsWorkingCapital } from '@/lib/wc-plan-from-bs';
import { BASE_YEAR_MONTH } from '@/lib/base-month';
import type { TableRow } from '@/lib/types';
import CFExplanationPanel from '@/components/CFExplanationPanel';
import type { CFExplanationNumbers } from '@/lib/cf-explanation-data';

type StaticCFRow = {
  key: string;
  label: string;
  level: 0 | 1 | 2;
  isGroup: boolean;
  actual2025: number | null;
};

type StaticWorkingCapitalRow = {
  key: string;
  label: string;
  level: 0 | 1 | 2;
  isGroup: boolean;
  actual2025: number | null;
};

type InventoryHqClosingMap = {
  MLB: number;
  'MLB KIDS': number;
  DISCOVERY: number;
};

type InventoryMonthlyTotalMap = {
  MLB: (number | null)[];
  'MLB KIDS': (number | null)[];
  DISCOVERY: (number | null)[];
};

type TagCostRatioMap = {
  MLB: number | null;
  'MLB KIDS': number | null;
  DISCOVERY: number | null;
};

type PurchaseMonthlyMap = {
  MLB: (number | null)[];
  'MLB KIDS': (number | null)[];
  DISCOVERY: (number | null)[];
};

type CFSummaryApiRow = {
  level: 0 | 1 | 2;
  account: string;
  values: number[];
};

type CFHierarchyCsvSource = { year: number; relative: string; absolute: string };

type CashBorrowingApiData = {
  cash: number[];
  borrowing: number[];
  prevCash?: number[];
  prevBorrowing?: number[];
  cashNMonthPlan?: number;
  borrowingNMonthPlan?: number;
};

type PLCreditRecoveryData = {
  baseYearMonth: string;
  dealerAdvance: number;
  dealerReceivable: number;
  recoveries: number[];
};

const INVENTORY_HQ_CLOSING_KEY = 'inventory_hq_closing_totals';
const INVENTORY_MONTHLY_TOTAL_KEY = 'inventory_monthly_total_closing';
const INVENTORY_PURCHASE_MONTHLY_KEY = 'inventory_purchase_monthly_by_brand';
const INVENTORY_SHIPMENT_MONTHLY_KEY = 'inventory_shipment_monthly_by_brand';
const PL_TAG_COST_RATIO_KEY = 'pl_tag_cost_ratio_annual';

// 2025년(합계)는 cf-hierarchy 라이브 응답 values[0]에서 자동 추출.
// 하드코딩 actual2025는 더 이상 사용 안 함 — null 로 통일 (옛 stale 값 보관 안 함).
const STATIC_CF_ROWS: StaticCFRow[] = [
  { key: 'operating', label: '영업활동', level: 0, isGroup: true, actual2025: null },
  { key: 'operating_receipts', label: '매출수금', level: 1, isGroup: true, actual2025: null },
  { key: 'operating_receipts_mlb', label: 'MLB', level: 2, isGroup: false, actual2025: null },
  { key: 'operating_receipts_kids', label: 'MLB KIDS', level: 2, isGroup: false, actual2025: null },
  { key: 'operating_receipts_discovery', label: 'DISCOVERY', level: 2, isGroup: false, actual2025: null },
  { key: 'operating_receipts_duvetica', label: 'DUVETICA', level: 2, isGroup: false, actual2025: null },
  { key: 'operating_receipts_supra', label: 'SUPRA', level: 2, isGroup: false, actual2025: null },
  { key: 'operating_payments', label: '물품대', level: 1, isGroup: true, actual2025: null },
  { key: 'operating_payments_hq', label: '본사', level: 2, isGroup: false, actual2025: null },
  { key: 'operating_payments_local', label: '현지', level: 2, isGroup: false, actual2025: null },
  { key: 'operating_advance', label: '본사선급금', level: 1, isGroup: false, actual2025: null },
  { key: 'operating_expenses', label: '비용', level: 1, isGroup: true, actual2025: null },
  { key: 'operating_expenses_ad', label: '광고비', level: 2, isGroup: false, actual2025: null },
  { key: 'operating_expenses_platform', label: '온라인 플랫폼비용', level: 2, isGroup: false, actual2025: null },
  { key: 'operating_expenses_store', label: '오프라인 매장비용', level: 2, isGroup: false, actual2025: null },
  { key: 'operating_expenses_duty', label: '수입증치세', level: 2, isGroup: false, actual2025: null },
  { key: 'operating_expenses_payroll', label: '인건비', level: 2, isGroup: false, actual2025: null },
  { key: 'operating_expenses_deposit', label: '보증금지급', level: 2, isGroup: false, actual2025: null },
  { key: 'operating_expenses_rent', label: '사무실임차료', level: 2, isGroup: false, actual2025: null },
  { key: 'operating_expenses_service_fee', label: '지급수수료', level: 2, isGroup: false, actual2025: null },
  { key: 'operating_expenses_interest', label: '이자비용', level: 2, isGroup: false, actual2025: null },
  { key: 'operating_expenses_withholding_vat', label: 'Withholding/VAT', level: 2, isGroup: false, actual2025: null },
  { key: 'operating_expenses_corporate_tax', label: '법인세', level: 2, isGroup: false, actual2025: null },
  { key: 'operating_expenses_other_cost', label: '기타비용', level: 2, isGroup: false, actual2025: null },
  { key: 'capex', label: '자산성지출', level: 0, isGroup: true, actual2025: null },
  { key: 'capex_interior', label: '인테리어/VMD', level: 1, isGroup: false, actual2025: null },
  { key: 'capex_fixture', label: '비품취득', level: 1, isGroup: false, actual2025: null },
  { key: 'other_income', label: '기타수익', level: 0, isGroup: false, actual2025: null },
  { key: 'borrowings', label: '차입금', level: 0, isGroup: false, actual2025: null },
  { key: 'net_cash', label: 'net cash', level: 0, isGroup: false, actual2025: null },
];

const STATIC_CASH_BORROWING = {
  cashOpening: 139543000,
  borrowingOpening: 909685000,
};

const STATIC_WORKING_CAPITAL_ROWS: StaticWorkingCapitalRow[] = [
  { key: 'wc_total', label: '운전자본 합계', level: 0, isGroup: false, actual2025: 0 },
  { key: 'wc_mom', label: '전년대비', level: 0, isGroup: false, actual2025: 605491000 },
  { key: 'wc_ar', label: '매출채권', level: 1, isGroup: true, actual2025: 725184000 },
  { key: 'wc_ar_direct', label: '직영AR', level: 2, isGroup: false, actual2025: 52193080 },
  { key: 'wc_ar_dealer', label: '대리상AR', level: 2, isGroup: false, actual2025: 672991268 },
  { key: 'wc_inventory', label: '재고자산', level: 1, isGroup: true, actual2025: 1497796000 },
  { key: 'wc_inventory_mlb', label: 'MLB', level: 2, isGroup: false, actual2025: 1260042373 },
  { key: 'wc_inventory_kids', label: 'MLB KIDS', level: 2, isGroup: false, actual2025: 66326475 },
  { key: 'wc_inventory_discovery', label: 'DISCOVERY', level: 2, isGroup: false, actual2025: 171427142 },
  { key: 'wc_ap', label: '매입채무', level: 1, isGroup: true, actual2025: -753922000 },
  { key: 'wc_ap_hq', label: '본사 AP', level: 2, isGroup: false, actual2025: -732511214 },
  { key: 'wc_ap_goods', label: '상품 AP', level: 2, isGroup: false, actual2025: -21410471 },
];

const WC_TOTAL_ACTUAL2025 = (() => {
  const ar = STATIC_WORKING_CAPITAL_ROWS.find((r) => r.key === 'wc_ar')?.actual2025 ?? 0;
  const inv = STATIC_WORKING_CAPITAL_ROWS.find((r) => r.key === 'wc_inventory')?.actual2025 ?? 0;
  const ap = STATIC_WORKING_CAPITAL_ROWS.find((r) => r.key === 'wc_ap')?.actual2025 ?? 0;
  return ar + inv + ap;
})();

const TAG_COST_RATIO_BRANDS = ['MLB', 'MLB KIDS', 'DISCOVERY'] as const;
const PL_CF_MONTH_LABELS = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'] as const;
const HARDCODED_WC_MONTHLY_K = {
  wc_ar_direct: [84280.01, 54085.5, null, null, null, null, null, null, null, null, null, null] as (number | null)[],
  wc_ar_dealer: [801026.483, 542417.643, null, null, null, null, null, null, null, null, null, null] as (number | null)[],
  wc_ap_hq: [-632178.265, -340434.89, null, null, null, null, null, null, null, null, null, null] as (number | null)[],
  wc_ap_goods: [-33077.305, -19565.995, null, null, null, null, null, null, null, null, null, null] as (number | null)[],
} as const;
const WC_AR_DIRECT_SHARE_OF_DEALER_AR = 52193 / 672991;
const WC_AP_GOODS_SHARE_OF_HQ_AP = 21410 / 732511;
const CF_GROUP_KEYS = ['operating', 'operating_receipts', 'operating_payments', 'operating_expenses', 'capex'] as const;
const WC_GROUP_KEYS = ['wc_ar', 'wc_inventory', 'wc_ap'] as const;
const VALUATION_REDUCTION_RATE: { MLB: number; 'MLB KIDS': number; DISCOVERY: number } = {
  MLB: 0.133924,
  'MLB KIDS': 0.276843,
  DISCOVERY: 0.02253,
};

export default function PLCashFlowTab() {
  const [cfValuesByKey, setCfValuesByKey] = useState<Record<string, number[]>>({});
  const [cfLoaded, setCfLoaded] = useState(false);
  const [cashBorrowingData, setCashBorrowingData] = useState<CashBorrowingApiData>({ cash: [], borrowing: [] });
  const [cashBorrowingLoaded, setCashBorrowingLoaded] = useState(false);
  const [creditRecovery, setCreditRecovery] = useState<PLCreditRecoveryData>({
    baseYearMonth: BASE_YEAR_MONTH,
    dealerAdvance: 0,
    dealerReceivable: 0,
    recoveries: [],
  });
  const [creditRecoveryLoaded, setCreditRecoveryLoaded] = useState(false);
  const [inventoryHqClosing, setInventoryHqClosing] = useState<InventoryHqClosingMap>({
    MLB: 0,
    'MLB KIDS': 0,
    DISCOVERY: 0,
  });
  const [inventoryHqLoaded, setInventoryHqLoaded] = useState(false);
  const [inventoryMonthlyTotals, setInventoryMonthlyTotals] = useState<InventoryMonthlyTotalMap>({
    MLB: new Array(12).fill(null),
    'MLB KIDS': new Array(12).fill(null),
    DISCOVERY: new Array(12).fill(null),
  });
  const [inventoryMonthlyLoaded, setInventoryMonthlyLoaded] = useState(false);
  const [tagCostRatioLoaded, setTagCostRatioLoaded] = useState(false);
  const [tagCostRatio, setTagCostRatio] = useState<TagCostRatioMap>({
    MLB: null,
    'MLB KIDS': null,
    DISCOVERY: null,
  });
  const [collapsed, setCollapsed] = useState<Set<string>>(
    // 영업활동은 기본 펼침
    new Set(CF_GROUP_KEYS.filter((k) => k !== 'operating')),
  );
  const [monthsCollapsed, setMonthsCollapsed] = useState(true);
  const [wcCollapsed, setWcCollapsed] = useState<Set<string>>(new Set(WC_GROUP_KEYS));
  const [wcLegendCollapsed, setWcLegendCollapsed] = useState(true);
  const [wcSupportCollapsed, setWcSupportCollapsed] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let mounted = true;

    const readStored = (payload?: unknown) => {
      const source = payload ?? window.localStorage.getItem(INVENTORY_HQ_CLOSING_KEY);
      if (!source) return false;
      try {
        const parsed = typeof source === 'string' ? JSON.parse(source) : source;
        if (!parsed || typeof parsed !== 'object' || !('values' in parsed)) return false;
        const values = (parsed as { values?: Record<string, unknown> }).values;
        if (!values) return false;
        setInventoryHqClosing({
          MLB: Number(values.MLB) || 0,
          'MLB KIDS': Number(values['MLB KIDS']) || 0,
          DISCOVERY: Number(values.DISCOVERY) || 0,
        });
        setInventoryHqLoaded(true);
        return true;
      } catch {
        // ignore malformed payloads
        return false;
      }
    };

    const hasStored = readStored();
    if (!hasStored) {
      const fetchFallback = async () => {
        const year = 2026;
        const results = await Promise.all(
          (TAG_COST_RATIO_BRANDS as readonly string[]).map(async (brand) => {
            try {
              const res = await fetch(`/api/inventory/monthly-stock?${new URLSearchParams({ year: String(year), brand, includeFuture: 'true' })}`, {
                cache: 'no-store',
              });
              const json = await res.json();
              const rows = Array.isArray(json?.hq?.rows) ? json.hq.rows : [];
              const totalRow =
                rows.find((row: { isTotal?: boolean }) => row?.isTotal) ??
                rows.find((row: { key?: string }) => row?.key === '재고자산합계');
              const monthly = Array.isArray(totalRow?.monthly)
                ? (totalRow.monthly as (number | null)[])
                : new Array(12).fill(null);
              return { brand, monthly };
            } catch {
              return { brand, monthly: new Array(12).fill(null) as (number | null)[] };
            }
          }),
        );
        if (!mounted) return;
        const nextMonthly: InventoryMonthlyTotalMap = {
          MLB: new Array(12).fill(null),
          'MLB KIDS': new Array(12).fill(null),
          DISCOVERY: new Array(12).fill(null),
        };
        const nextClosing: InventoryHqClosingMap = {
          MLB: 0,
          'MLB KIDS': 0,
          DISCOVERY: 0,
        };
        for (const { brand, monthly } of results) {
          if (brand in nextMonthly) {
            (nextMonthly as Record<string, (number | null)[]>)[brand] = monthly;
            const closing = monthly[11];
            (nextClosing as Record<string, number>)[brand] = typeof closing === 'number' ? closing : 0;
          }
        }
        setInventoryMonthlyTotals(nextMonthly);
        setInventoryMonthlyLoaded(true);
        setInventoryHqClosing(nextClosing);
        setInventoryHqLoaded(true);
      };
      fetchFallback();
    }
    const handleUpdate = (event: Event) => {
      readStored((event as CustomEvent).detail);
    };

    window.addEventListener('inventory-hq-closing-updated', handleUpdate as EventListener);
    return () => {
      mounted = false;
      window.removeEventListener('inventory-hq-closing-updated', handleUpdate as EventListener);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let mounted = true;

    const loadCreditRecovery = async () => {
      try {
        const res = await fetch(`/api/annual-plan/credit-recovery?baseYearMonth=${BASE_YEAR_MONTH}`, { cache: 'no-store' });
        const json = await res.json();
        if (!mounted || !res.ok || !json?.data) return;
        const payload = json.data as Record<string, unknown>;
        const dealerAdvance = Number(payload['대리상선수금'] ?? 0);
        const dealerReceivable = Number(payload['대리상채권'] ?? 0);
        const recoveriesSource = Array.isArray(payload.recoveries) ? payload.recoveries : [];
        const recoveries = recoveriesSource
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value));
        setCreditRecovery({
          baseYearMonth: typeof payload.baseYearMonth === 'string' ? payload.baseYearMonth : BASE_YEAR_MONTH,
          dealerAdvance,
          dealerReceivable,
          recoveries,
        });
      } catch {
        // ignore
      } finally {
        if (mounted) setCreditRecoveryLoaded(true);
      }
    };

    loadCreditRecovery();
    const intervalId = window.setInterval(loadCreditRecovery, 15000);
    const onFocus = () => {
      loadCreditRecovery();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      mounted = false;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let mounted = true;

    const loadCashBorrowing = async () => {
      try {
        const res = await fetch('/api/fs/cash-borrowing?year=2026', { cache: 'no-store' });
        const json = await res.json();
        if (!mounted || !res.ok) return;
        setCashBorrowingData({
          cash: Array.isArray(json?.cash) ? json.cash : [],
          borrowing: Array.isArray(json?.borrowing) ? json.borrowing : [],
          prevCash: Array.isArray(json?.prevCash) ? json.prevCash : undefined,
          prevBorrowing: Array.isArray(json?.prevBorrowing) ? json.prevBorrowing : undefined,
          cashNMonthPlan:
            typeof json?.cashNMonthPlan === 'number' && Number.isFinite(json.cashNMonthPlan)
              ? json.cashNMonthPlan
              : undefined,
          borrowingNMonthPlan:
            typeof json?.borrowingNMonthPlan === 'number' && Number.isFinite(json.borrowingNMonthPlan)
              ? json.borrowingNMonthPlan
              : undefined,
        });
      } catch {
        // ignore
      } finally {
        if (mounted) setCashBorrowingLoaded(true);
      }
    };

    loadCashBorrowing();
    const intervalId = window.setInterval(loadCashBorrowing, 15000);
    const onFocus = () => {
      loadCashBorrowing();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      mounted = false;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let mounted = true;

    const readStored = (payload?: unknown) => {
      const source = payload ?? window.localStorage.getItem(INVENTORY_MONTHLY_TOTAL_KEY);
      if (!source) return false;
      try {
        const parsed = typeof source === 'string' ? JSON.parse(source) : source;
        if (!parsed || typeof parsed !== 'object' || !('values' in parsed)) return false;
        const values = (parsed as { values?: Record<string, unknown> }).values;
        if (!values) return false;
        setInventoryMonthlyTotals({
          MLB: Array.isArray(values.MLB) ? (values.MLB as (number | null)[]) : new Array(12).fill(null),
          'MLB KIDS': Array.isArray(values['MLB KIDS']) ? (values['MLB KIDS'] as (number | null)[]) : new Array(12).fill(null),
          DISCOVERY: Array.isArray(values.DISCOVERY) ? (values.DISCOVERY as (number | null)[]) : new Array(12).fill(null),
        });
        const hasAnyValue = [values.MLB, values['MLB KIDS'], values.DISCOVERY]
          .filter(Array.isArray)
          .some((series) => (series as unknown[]).some((v) => v != null));
        if (!hasAnyValue) return false;
        setInventoryMonthlyLoaded(true);
        return true;
      } catch {
        // ignore malformed payloads
        return false;
      }
    };

    const hasStored = readStored();
    if (!hasStored) {
      const fetchFallback = async () => {
        const year = 2026;
        const results = await Promise.all(
          (TAG_COST_RATIO_BRANDS as readonly string[]).map(async (brand) => {
            try {
              const res = await fetch(
                `/api/inventory/monthly-stock?${new URLSearchParams({ year: String(year), brand, includeFuture: 'true' })}`,
                {
                  cache: 'no-store',
                },
              );
              const json = await res.json();
              const rows = Array.isArray(json?.hq?.rows) ? json.hq.rows : [];
              const totalRow =
                rows.find((row: { isTotal?: boolean }) => row?.isTotal) ??
                rows.find((row: { key?: string }) => row?.key === '재고자산합계');
              const monthly = Array.isArray(totalRow?.monthly)
                ? (totalRow.monthly as (number | null)[])
                : new Array(12).fill(null);
              return { brand, monthly };
            } catch {
              return { brand, monthly: new Array(12).fill(null) as (number | null)[] };
            }
          }),
        );
        if (!mounted) return;
        const nextMonthly: InventoryMonthlyTotalMap = {
          MLB: new Array(12).fill(null),
          'MLB KIDS': new Array(12).fill(null),
          DISCOVERY: new Array(12).fill(null),
        };
        for (const { brand, monthly } of results) {
          if (brand in nextMonthly) (nextMonthly as Record<string, (number | null)[]>)[brand] = monthly;
        }
        setInventoryMonthlyTotals(nextMonthly);
        setInventoryMonthlyLoaded(true);
      };
      fetchFallback();
    }
    const handleUpdate = (event: Event) => {
      readStored((event as CustomEvent).detail);
    };

    window.addEventListener('inventory-monthly-total-updated', handleUpdate as EventListener);
    return () => {
      mounted = false;
      window.removeEventListener('inventory-monthly-total-updated', handleUpdate as EventListener);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let mounted = true;

    const readStored = (payload?: unknown) => {
      const source = payload ?? window.localStorage.getItem(PL_TAG_COST_RATIO_KEY);
      if (!source) return false;
      try {
        const parsed = typeof source === 'string' ? JSON.parse(source) : source;
        if (!parsed || typeof parsed !== 'object' || !('values' in parsed)) return false;
        const values = (parsed as { values?: Record<string, unknown> }).values;
        if (!values) return false;
        setTagCostRatio({
          MLB: values.MLB == null ? null : Number(values.MLB),
          'MLB KIDS': values['MLB KIDS'] == null ? null : Number(values['MLB KIDS']),
          DISCOVERY: values.DISCOVERY == null ? null : Number(values.DISCOVERY),
        });
        setTagCostRatioLoaded(true);
        return true;
      } catch {
        // ignore malformed payloads
        return false;
      }
    };

    const hasStored = readStored();
    if (!hasStored) {
      const fetchFallback = async () => {
        try {
          const res = await fetch('/api/pl-forecast/tag-cost-ratio?year=2026', { cache: 'no-store' });
          const json = await res.json();
          if (!mounted || !res.ok) return;
          const values = ((json?.values ?? json?.brands ?? {}) as Record<string, number | null | undefined | (number | null)[]>);
          const pickAnnual = (value: number | null | undefined | (number | null)[]) =>
            Array.isArray(value) ? value[11] : value;
          setTagCostRatio({
            MLB: pickAnnual(values.MLB) == null ? null : Number(pickAnnual(values.MLB)),
            'MLB KIDS': pickAnnual(values['MLB KIDS']) == null ? null : Number(pickAnnual(values['MLB KIDS'])),
            DISCOVERY: pickAnnual(values.DISCOVERY) == null ? null : Number(pickAnnual(values.DISCOVERY)),
          });
          setTagCostRatioLoaded(true);
        } catch {
          // ignore
        }
      };
      fetchFallback();
    }
    const handleUpdate = (event: Event) => {
      readStored((event as CustomEvent).detail);
    };

    window.addEventListener('pl-tag-cost-ratio-updated', handleUpdate as EventListener);
    return () => {
      mounted = false;
      window.removeEventListener('pl-tag-cost-ratio-updated', handleUpdate as EventListener);
    };
  }, []);

  const [purchaseMonthlyByBrand, setPurchaseMonthlyByBrand] = useState<PurchaseMonthlyMap>({
    MLB: new Array(12).fill(null),
    'MLB KIDS': new Array(12).fill(null),
    DISCOVERY: new Array(12).fill(null),
  });
  const [purchaseLoaded, setPurchaseLoaded] = useState(false);
  const [shipmentMonthlyByBrand, setShipmentMonthlyByBrand] = useState<PurchaseMonthlyMap>({
    MLB: new Array(12).fill(null),
    'MLB KIDS': new Array(12).fill(null),
    DISCOVERY: new Array(12).fill(null),
  });
  const [shipmentLoaded, setShipmentLoaded] = useState(false);

  const [cfHierarchyCsvSources, setCfHierarchyCsvSources] = useState<CFHierarchyCsvSource[]>([]);
  const [cfSourcesLegendOpen, setCfSourcesLegendOpen] = useState(false);
  const [wcPlanByKey, setWcPlanByKey] = useState<Record<string, number>>({});
  const [wcForecastByKey, setWcForecastByKey] = useState<Record<string, number>>({});

  useEffect(() => {
    fetch('/api/fs/bs?year=2026', { cache: 'no-store' })
      .then((res) => res.json())
      .then((data: { workingCapital?: TableRow[]; error?: string }) => {
        if (!data || 'error' in data || !Array.isArray(data.workingCapital)) {
          setWcPlanByKey({});
          return;
        }
        setWcPlanByKey(buildWcPlanByKeyFromBsWorkingCapital(data.workingCapital));
      })
      .catch(() => setWcPlanByKey({}));
  }, []);

  useEffect(() => {
    fetch('/api/pl-forecast/wc-forecast', { cache: 'no-store' })
      .then((res) => res.json())
      .then((data: Record<string, number>) => {
        if (data && !('error' in data)) setWcForecastByKey(data);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let mounted = true;

    const readStored = (payload?: unknown) => {
      const source = payload ?? window.localStorage.getItem(INVENTORY_PURCHASE_MONTHLY_KEY);
      if (!source) return false;
      try {
        const parsed = typeof source === 'string' ? JSON.parse(source) : source;
        if (!parsed || typeof parsed !== 'object' || !('values' in parsed)) return false;
        const values = (parsed as { values?: Record<string, unknown> }).values;
        if (!values) return false;
        const next = {
          MLB: Array.isArray(values.MLB) ? (values.MLB as (number | null)[]) : new Array(12).fill(null),
          'MLB KIDS': Array.isArray(values['MLB KIDS']) ? (values['MLB KIDS'] as (number | null)[]) : new Array(12).fill(null),
          DISCOVERY: Array.isArray(values.DISCOVERY) ? (values.DISCOVERY as (number | null)[]) : new Array(12).fill(null),
        };
        setPurchaseMonthlyByBrand(next);
        const hasAnyValue = Object.values(next).some((series) => series.some((v) => v != null));
        if (!hasAnyValue) return false;
        setPurchaseLoaded(true);
        return true;
      } catch {
        return false;
      }
    };

    const hasStored = readStored();
    if (!hasStored) {
      const fetchPurchase = async () => {
        const year = 2026;
        const results = await Promise.all(
          (TAG_COST_RATIO_BRANDS as readonly string[]).map(async (brand) => {
            const res = await fetch(`/api/inventory/purchase?${new URLSearchParams({ year: String(year), brand, includeFuture: 'true' })}`, {
              cache: 'no-store',
            });
            const json = await res.json();
            if (!res.ok || json?.error) return { brand, monthly: new Array(12).fill(null) as (number | null)[] };
            const row = json?.data?.rows?.find((r: { key: string }) => r.key === '매입합계');
            const monthly = Array.isArray(row?.monthly) ? row.monthly : new Array(12).fill(null);
            return { brand, monthly };
          }),
        );
        if (!mounted) return;
        const next: PurchaseMonthlyMap = {
          MLB: new Array(12).fill(null),
          'MLB KIDS': new Array(12).fill(null),
          DISCOVERY: new Array(12).fill(null),
        };
        for (const { brand, monthly } of results) {
          if (brand in next) (next as Record<string, (number | null)[]>)[brand] = monthly;
        }
        setPurchaseMonthlyByBrand(next);
        setPurchaseLoaded(true);
      };
      fetchPurchase();
    }

    const handleUpdate = (event: Event) => {
      readStored((event as CustomEvent).detail);
    };

    window.addEventListener('inventory-purchase-monthly-updated', handleUpdate as EventListener);
    return () => {
      mounted = false;
      window.removeEventListener('inventory-purchase-monthly-updated', handleUpdate as EventListener);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let mounted = true;

    const readStored = (payload?: unknown) => {
      const source = payload ?? window.localStorage.getItem(INVENTORY_SHIPMENT_MONTHLY_KEY);
      if (!source) return false;
      try {
        const parsed = typeof source === 'string' ? JSON.parse(source) : source;
        if (!parsed || typeof parsed !== 'object' || !('values' in parsed)) return false;
        const values = (parsed as { values?: Record<string, unknown> }).values;
        if (!values) return false;
        const next = {
          MLB: Array.isArray(values.MLB) ? (values.MLB as (number | null)[]) : new Array(12).fill(null),
          'MLB KIDS': Array.isArray(values['MLB KIDS']) ? (values['MLB KIDS'] as (number | null)[]) : new Array(12).fill(null),
          DISCOVERY: Array.isArray(values.DISCOVERY) ? (values.DISCOVERY as (number | null)[]) : new Array(12).fill(null),
        };
        setShipmentMonthlyByBrand(next);
        const hasAnyValue = Object.values(next).some((series) => series.some((v) => v != null));
        if (!hasAnyValue) return false;
        setShipmentLoaded(true);
        return true;
      } catch {
        return false;
      }
    };

    const hasStored = readStored();
    if (!hasStored) {
      const fetchShipment = async () => {
        const year = 2026;
        const results = await Promise.all(
          (TAG_COST_RATIO_BRANDS as readonly string[]).map(async (brand) => {
            const res = await fetch(`/api/inventory/shipment-sales?${new URLSearchParams({ year: String(year), brand, includeFuture: 'true' })}`, {
              cache: 'no-store',
            });
            const json = await res.json();
            if (!res.ok || json?.error) return { brand, monthly: new Array(12).fill(null) as (number | null)[] };
            const row = json?.data?.rows?.find((r: { key: string }) => r.key === '출고매출합계');
            const monthly = Array.isArray(row?.monthly) ? row.monthly : new Array(12).fill(null);
            return { brand, monthly };
          }),
        );
        if (!mounted) return;
        const next: PurchaseMonthlyMap = {
          MLB: new Array(12).fill(null),
          'MLB KIDS': new Array(12).fill(null),
          DISCOVERY: new Array(12).fill(null),
        };
        for (const { brand, monthly } of results) {
          if (brand in next) (next as Record<string, (number | null)[]>)[brand] = monthly;
        }
        setShipmentMonthlyByBrand(next);
        setShipmentLoaded(true);
      };
      fetchShipment();
    }

    const handleUpdate = (event: Event) => {
      readStored((event as CustomEvent).detail);
    };

    window.addEventListener('inventory-shipment-monthly-updated', handleUpdate as EventListener);
    return () => {
      mounted = false;
      window.removeEventListener('inventory-shipment-monthly-updated', handleUpdate as EventListener);
    };
  }, []);

  const visibleRows = useMemo(() => {
    const result: StaticCFRow[] = [];
    let skipLevel = -1;

    for (const row of STATIC_CF_ROWS) {
      if (row.level <= skipLevel) skipLevel = -1;
      if (skipLevel >= 0 && row.level > skipLevel) continue;
      if (row.isGroup && collapsed.has(row.key)) {
        skipLevel = row.level === 0 ? 0 : row.level;
        result.push(row);
        continue;
      }
      result.push(row);
    }

    return result;
  }, [collapsed]);

  const visibleWorkingCapitalRows = useMemo(() => {
    const result: StaticWorkingCapitalRow[] = [];
    let skipLevel = -1;

    for (const row of STATIC_WORKING_CAPITAL_ROWS) {
      if (row.level <= skipLevel) skipLevel = -1;
      if (skipLevel >= 0 && row.level > skipLevel) continue;
      if (row.isGroup && wcCollapsed.has(row.key)) {
        skipLevel = row.level;
        result.push(row);
        continue;
      }
      const resolved = row.key === 'wc_total' ? { ...row, actual2025: WC_TOTAL_ACTUAL2025 } : row;
      result.push(resolved);
    }

    return result;
  }, [wcCollapsed]);

  const toggle = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const isCfAllCollapsed = CF_GROUP_KEYS.every((key) => collapsed.has(key));
  const isWcAllCollapsed = WC_GROUP_KEYS.every((key) => wcCollapsed.has(key));

  const toggleAllCF = () => {
    if (isCfAllCollapsed) {
      setCollapsed(new Set());
      return;
    }

    setCollapsed(new Set(CF_GROUP_KEYS));
  };

  const toggleAllWC = () => {
    if (isWcAllCollapsed) {
      setWcCollapsed(new Set());
      return;
    }
    setWcCollapsed(new Set(WC_GROUP_KEYS));
  };

  const toggleWorkingCapital = (key: string) => {
    setWcCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const formatActual = (value: number | null | undefined) => {
    if (value == null) return '';
    if (value === 0) return '-';
    if (value < 0) return `(${formatNumber(Math.abs(value), false, false)})`;
    return formatNumber(value, false, false);
  };

  const formatKValue = (value: number | null | undefined) => {
    if (value == null || value === 0) return '';
    const absValue = Math.abs(Math.round(value));
    const formatted = new Intl.NumberFormat('ko-KR').format(absValue);
    return value < 0 ? `(${formatted})` : formatted;
  };

  // 계획-전년 컬럼: +/- 기호 형식 (1위안→K 변환)
  const formatDiffActual = (value: number | null | undefined) => {
    if (value == null || value === 0) return '-';
    const k = Math.round(Math.abs(value) / 1000);
    const formatted = new Intl.NumberFormat('ko-KR').format(k);
    return value > 0 ? `+${formatted}` : `-${formatted}`;
  };

  // 계획-전년 컬럼: +/- 기호 형식 (K단위 그대로)
  const formatDiffK = (value: number | null | undefined) => {
    if (value == null || value === 0) return '-';
    const abs = Math.round(Math.abs(value));
    const formatted = new Intl.NumberFormat('ko-KR').format(abs);
    return value > 0 ? `+${formatted}` : `-${formatted}`;
  };

  const formatPercent4 = (value: number | null | undefined) => {
    if (value == null) return '';
    return `${(value * 100).toFixed(4)}%`;
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let mounted = true;

    const buildCFValueMap = (rows: CFSummaryApiRow[]): Record<string, number[]> => {
      const result: Record<string, number[]> = {};
      let level0 = '';
      let level1 = '';

      for (const row of rows) {
        if (row.level === 0) {
          level0 = row.account;
          level1 = '';
        } else if (row.level === 1) {
          level1 = row.account;
        }

        let key: string | null = null;
        if (row.level === 0 && row.account === '영업활동') key = 'operating';
        else if (row.level === 1 && level0 === '영업활동' && row.account === '매출수금') key = 'operating_receipts';
        else if (row.level === 2 && level0 === '영업활동' && level1 === '매출수금' && row.account === 'MLB') key = 'operating_receipts_mlb';
        else if (row.level === 2 && level0 === '영업활동' && level1 === '매출수금' && row.account === 'MLB KIDS') key = 'operating_receipts_kids';
        else if (row.level === 2 && level0 === '영업활동' && level1 === '매출수금' && row.account === 'DISCOVERY') key = 'operating_receipts_discovery';
        else if (row.level === 2 && level0 === '영업활동' && level1 === '매출수금' && row.account === 'DUVETICA') key = 'operating_receipts_duvetica';
        else if (row.level === 2 && level0 === '영업활동' && level1 === '매출수금' && row.account === 'SUPRA') key = 'operating_receipts_supra';
        else if (row.level === 1 && level0 === '영업활동' && row.account === '물품대') key = 'operating_payments';
        else if (row.level === 2 && level0 === '영업활동' && level1 === '물품대' && row.account === '본사') key = 'operating_payments_hq';
        else if (row.level === 2 && level0 === '영업활동' && level1 === '물품대' && row.account === '현지') key = 'operating_payments_local';
        else if (row.level === 1 && level0 === '영업활동' && row.account === '본사선급금') key = 'operating_advance';
        else if (row.level === 1 && level0 === '영업활동' && row.account === '비용') key = 'operating_expenses';
        else if (row.level === 2 && level0 === '영업활동' && level1 === '비용' && row.account === '광고비') key = 'operating_expenses_ad';
        else if (row.level === 2 && level0 === '영업활동' && level1 === '비용' && row.account === '온라인 플랫폼비용') key = 'operating_expenses_platform';
        else if (row.level === 2 && level0 === '영업활동' && level1 === '비용' && row.account === '오프라인 매장비용') key = 'operating_expenses_store';
        else if (row.level === 2 && level0 === '영업활동' && level1 === '비용' && row.account === '수입증치세') key = 'operating_expenses_duty';
        else if (row.level === 2 && level0 === '영업활동' && level1 === '비용' && row.account === '인건비') key = 'operating_expenses_payroll';
        else if (row.level === 2 && level0 === '영업활동' && level1 === '비용' && row.account === '보증금지급') key = 'operating_expenses_deposit';
        else if (row.level === 2 && level0 === '영업활동' && level1 === '비용' && row.account === '사무실임차료') key = 'operating_expenses_rent';
        else if (row.level === 2 && level0 === '영업활동' && level1 === '비용' && row.account === '지급수수료') key = 'operating_expenses_service_fee';
        else if (row.level === 2 && level0 === '영업활동' && level1 === '비용' && row.account === '이자비용') key = 'operating_expenses_interest';
        else if (row.level === 2 && level0 === '영업활동' && level1 === '비용' && row.account === 'Withholding/VAT') key = 'operating_expenses_withholding_vat';
        else if (row.level === 2 && level0 === '영업활동' && level1 === '비용' && row.account === '법인세') key = 'operating_expenses_corporate_tax';
        else if (row.level === 2 && level0 === '영업활동' && level1 === '비용' && row.account === '기타비용') key = 'operating_expenses_other_cost';
        else if (row.level === 0 && row.account === '자산성지출') key = 'capex';
        else if (row.level === 1 && level0 === '자산성지출' && row.account === '인테리어/VMD') key = 'capex_interior';
        else if (row.level === 1 && level0 === '자산성지출' && row.account === '비품취득') key = 'capex_fixture';
        else if (row.level === 0 && row.account === '기타수익') key = 'other_income';
        else if (row.level === 0 && row.account === '차입금') key = 'borrowings';
        else if (row.level === 0 && row.account === 'net cash') key = 'net_cash';

        if (key) result[key] = row.values;
      }

      return result;
    };

    const loadCF = async () => {
      try {
        const res = await fetch('/api/fs/cf-hierarchy?year=2026', { cache: 'no-store' });
        const json = await res.json();
        if (!mounted || !res.ok || !Array.isArray(json?.rows)) return;
        setCfValuesByKey(buildCFValueMap(json.rows as CFSummaryApiRow[]));
        const hierarchy = Array.isArray(json.hierarchyCsvSources) ? json.hierarchyCsvSources : [];
        setCfHierarchyCsvSources(
          hierarchy.filter(
            (item: unknown): item is CFHierarchyCsvSource =>
              !!item &&
              typeof item === 'object' &&
              typeof (item as CFHierarchyCsvSource).year === 'number' &&
              typeof (item as CFHierarchyCsvSource).relative === 'string' &&
              typeof (item as CFHierarchyCsvSource).absolute === 'string',
          ),
        );
      } catch {
        // ignore
      } finally {
        if (mounted) setCfLoaded(true);
      }
    };

    loadCF();
    const intervalId = window.setInterval(loadCF, 15000);
    const onFocus = () => {
      loadCF();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      mounted = false;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  const toDisplayK = (value: number | null | undefined) => {
    if (value == null) return null;
    return Math.round(value / 1000);
  };

  const cfMonthly = (rowKey: string, monthIndex: number): number | null => {
    const values = cfValuesByKey[rowKey];
    if (!values) return null;
    const raw = values[monthIndex + 1];
    return Number.isFinite(raw) ? raw : null;
  };

  const cf2026 = (rowKey: string): number | null => {
    const values = cfValuesByKey[rowKey];
    if (!values) return null;
    const raw = values[13];
    return Number.isFinite(raw) ? raw : null;
  };

  // cf-hierarchy year=2026 응답의 values[0] = 2025년(합계) 컬럼 — 현금흐름표 탭과 동일 라이브 데이터
  // STATIC_CF_ROWS.actual2025 (하드코딩) 대신 이걸 우선 사용
  const cf2025Annual = (rowKey: string): number | null => {
    const values = cfValuesByKey[rowKey];
    if (!values || values.length < 1) return null;
    const raw = values[0];
    return Number.isFinite(raw) ? raw : null;
  };
  const getActual2025 = (row: StaticCFRow): number => {
    const live = cf2025Annual(row.key);
    return live != null ? live : (row.actual2025 ?? 0);
  };

  const cfYoy = (row: StaticCFRow): number | null => {
    const values = cfValuesByKey[row.key];
    if (!values) return null;
    const raw = values[14];
    return Number.isFinite(raw) ? raw : null;
  };

  // 메인 현금흐름표와 동일: cf-hierarchy가 2026.csv N년계획(N-1) 열로 채운 values[15]~[18]
  const cfPlan = (rowKey: string): number | null => {
    const values = cfValuesByKey[rowKey];
    if (!values || values.length < 19) return null;
    const raw = values[15];
    return Number.isFinite(raw) ? raw : null;
  };

  const cfPlanVsPrev = (row: StaticCFRow): number | null => {
    const values = cfValuesByKey[row.key];
    if (!values || values.length < 19) return null;
    const raw = values[16];
    return Number.isFinite(raw) ? raw : null;
  };

  const cfPlanVsRollingAmount = (rowKey: string): number | null => {
    const values = cfValuesByKey[rowKey];
    if (!values || values.length < 19) return null;
    const raw = values[17];
    return Number.isFinite(raw) ? raw : null;
  };

  const cfPlanVsRollingPct = (rowKey: string): string => {
    const values = cfValuesByKey[rowKey];
    if (!values || values.length < 19) return '-';
    const raw = values[18];
    if (!Number.isFinite(raw) || raw === 0) return '-';
    return `${raw >= 0 ? '+' : ''}${raw.toFixed(1)}%`;
  };

  const cashDebtPlanValue = (rowKey: 'cash' | 'borrowing'): number | null =>
    rowKey === 'cash'
      ? (cashBorrowingData.cashNMonthPlan ?? null)
      : (cashBorrowingData.borrowingNMonthPlan ?? null);

  const cashDebtPlanVsPrev = (rowKey: 'cash' | 'borrowing'): number | null => {
    const plan = cashDebtPlanValue(rowKey);
    const prev = cashBorrowingOpening(rowKey);
    if (plan == null || prev == null) return null;
    return plan - prev;
  };

  const cashDebtVsRollingAmount = (rowKey: 'cash' | 'borrowing'): number | null => {
    const rolling = cashBorrowing2026(rowKey);
    const plan = cashDebtPlanValue(rowKey);
    if (rolling == null || plan == null) return null;
    return rolling - plan;
  };

  const cashDebtVsRollingPct = (rowKey: 'cash' | 'borrowing'): string => {
    const rolling = cashBorrowing2026(rowKey);
    const plan = cashDebtPlanValue(rowKey);
    if (rolling == null || plan == null) return '-';
    const nDiff = rolling - plan;
    const nPct = plan !== 0 ? (nDiff / Math.abs(plan)) * 100 : 0;
    if (nPct !== 0) return `${nPct >= 0 ? '+' : ''}${nPct.toFixed(1)}%`;
    return '-';
  };

  // 운전자본 계획: BS workingCapital annualPlan(원), 표시 K단위 → /1000
  const wcPlan = (rowKey: string): number | null => {
    const v = wcPlanByKey[rowKey];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };

  const wcPlanK = (rowKey: string): number | null => {
    const v = wcPlan(rowKey);
    return v != null ? v / 1000 : null;
  };

  const wcPlanVsPrev = (row: StaticWorkingCapitalRow): number | null => {
    if (row.key === 'wc_mom') return null;
    const planK = wcPlanK(row.key);
    const prevK = toDisplayK(row.actual2025);
    if (planK == null || prevK == null) return null;
    return planK - prevK;
  };

  const wcPlanVsRollingAmount = (rowKey: string): number | null => {
    const rollingK = workingCapital2026(rowKey);
    const planK = wcPlanK(rowKey);
    if (rollingK == null || planK == null) return null;
    return rollingK - planK;
  };

  const wcPlanVsRollingPct = (rowKey: string): string => {
    const rollingK = workingCapital2026(rowKey);
    const planK = wcPlanK(rowKey);
    if (rollingK == null || !planK) return '-';
    const pct = (rollingK / planK) * 100;
    return `${Math.round(pct)}%`;
  };

  const cashBorrowingSeries = (rowKey: 'cash' | 'borrowing') =>
    rowKey === 'cash'
      ? { current: cashBorrowingData.cash, previous: cashBorrowingData.prevCash }
      : { current: cashBorrowingData.borrowing, previous: cashBorrowingData.prevBorrowing };
  const cashBorrowingOpening = (rowKey: 'cash' | 'borrowing'): number | null => {
    const series = cashBorrowingSeries(rowKey);
    const prevEnd = series.previous?.[13];
    if (typeof prevEnd === 'number' && Number.isFinite(prevEnd)) return prevEnd;
    const currentStart = series.current?.[0];
    if (typeof currentStart === 'number' && Number.isFinite(currentStart)) return currentStart;
    return rowKey === 'cash' ? STATIC_CASH_BORROWING.cashOpening : STATIC_CASH_BORROWING.borrowingOpening;
  };
  const cashBorrowingMonthly = (rowKey: 'cash' | 'borrowing', monthIndex: number): number | null => {
    const series = cashBorrowingSeries(rowKey);
    const raw = series.current?.[monthIndex + 1];
    return Number.isFinite(raw) ? raw : null;
  };
  const cashBorrowing2026 = (rowKey: 'cash' | 'borrowing'): number | null => {
    const series = cashBorrowingSeries(rowKey);
    const raw = series.current?.[13];
    return Number.isFinite(raw) ? raw : null;
  };
  const cashBorrowingYoy = (rowKey: 'cash' | 'borrowing'): number | null => {
    const currentEnd = cashBorrowing2026(rowKey);
    const opening = cashBorrowingOpening(rowKey);
    if (currentEnd == null || opening == null) return null;
    return currentEnd - opening;
  };

  const workingCapital2026 = (rowKey: string): number | null => {
    const monthEndIndex = 11;
    // CSV forecast 값이 있으면 우선 사용 (1위안 → K단위 변환)
    const forecastArDealer = wcForecastByKey['wc_ar_dealer'] != null ? wcForecastByKey['wc_ar_dealer'] / 1000 : null;
    const forecastArDirect = wcForecastByKey['wc_ar_direct'] != null ? wcForecastByKey['wc_ar_direct'] / 1000 : null;
    const forecastApHq = wcForecastByKey['wc_ap_hq'] != null ? wcForecastByKey['wc_ap_hq'] / 1000 : null;
    const forecastApGoods = wcForecastByKey['wc_ap_goods'] != null ? wcForecastByKey['wc_ap_goods'] / 1000 : null;
    const arDealer =
      forecastArDealer ??
      HARDCODED_WC_MONTHLY_K.wc_ar_dealer[monthEndIndex] ??
      TAG_COST_RATIO_BRANDS.reduce<number | null>((sum, brand) => {
        const shipmentK = toDisplayK(shipmentMonthlyByBrand[brand][monthEndIndex]);
        const ratio = tagCostRatio[brand];
        if (shipmentK == null || shipmentK === 0 || ratio == null) return sum;
        const planned = (shipmentK / 1.13) * ratio;
        return (sum ?? 0) + planned;
      }, null) ??
      0;
    const arDirect = forecastArDirect ?? HARDCODED_WC_MONTHLY_K.wc_ar_direct[monthEndIndex] ?? arDealer * WC_AR_DIRECT_SHARE_OF_DEALER_AR;
    const inventoryMlbTag = inventoryHqClosing.MLB || 0;
    const inventoryKidsTag = inventoryHqClosing['MLB KIDS'] || 0;
    const inventoryDiscoveryTag = inventoryHqClosing.DISCOVERY || 0;
    const inventoryMlb =
      inventoryMlbTag === 0 || tagCostRatio.MLB == null
        ? 0
        : (inventoryMlbTag / 1.13) * tagCostRatio.MLB * (1 - VALUATION_REDUCTION_RATE.MLB);
    const inventoryKids =
      inventoryKidsTag === 0 || tagCostRatio['MLB KIDS'] == null
        ? 0
        : (inventoryKidsTag / 1.13) * tagCostRatio['MLB KIDS'] * (1 - VALUATION_REDUCTION_RATE['MLB KIDS']);
    const inventoryDiscovery =
      inventoryDiscoveryTag === 0 || tagCostRatio.DISCOVERY == null
        ? 0
        : (inventoryDiscoveryTag / 1.13) * tagCostRatio.DISCOVERY * (1 - VALUATION_REDUCTION_RATE.DISCOVERY);
    const apHq =
      forecastApHq ??
      HARDCODED_WC_MONTHLY_K.wc_ap_hq[monthEndIndex] ??
      TAG_COST_RATIO_BRANDS.reduce<number | null>((sum, brand) => {
        const purchaseK = toDisplayK(purchaseMonthlyByBrand[brand][monthEndIndex]);
        const ratio = tagCostRatio[brand];
        if (purchaseK == null || purchaseK === 0 || ratio == null) return sum;
        const planned = -((purchaseK / 1.13) * ratio);
        return (sum ?? 0) + planned;
      }, null) ??
      0;
    const apGoods = forecastApGoods ?? HARDCODED_WC_MONTHLY_K.wc_ap_goods[monthEndIndex] ?? apHq * WC_AP_GOODS_SHARE_OF_HQ_AP;

    if (rowKey === 'wc_total') {
      return arDirect + arDealer + inventoryMlb + inventoryKids + inventoryDiscovery + apHq + apGoods;
    }
    if (rowKey === 'wc_mom') {
      const currentTotal = arDirect + arDealer + inventoryMlb + inventoryKids + inventoryDiscovery + apHq + apGoods;
      const baseActual = WC_TOTAL_ACTUAL2025;
      const baseActualK = toDisplayK(baseActual);
      if (baseActualK == null) return null;
      return currentTotal - baseActualK;
    }
    if (rowKey === 'wc_ar') return arDirect + arDealer;
    if (rowKey === 'wc_inventory') return inventoryMlb + inventoryKids + inventoryDiscovery;
    if (rowKey === 'wc_inventory_mlb') return inventoryMlb;
    if (rowKey === 'wc_inventory_kids') return inventoryKids;
    if (rowKey === 'wc_inventory_discovery') return inventoryDiscovery;
    if (rowKey === 'wc_ap') return apHq + apGoods;
    if (rowKey === 'wc_ar_direct') return arDirect;
    if (rowKey === 'wc_ar_dealer') return arDealer;
    if (rowKey === 'wc_ap_hq') return apHq;
    if (rowKey === 'wc_ap_goods') return apGoods;
    return null;
  };

  const workingCapitalYoy = (row: StaticWorkingCapitalRow): number | null => {
    const current = workingCapital2026(row.key);
    const actualK = toDisplayK(row.actual2025);
    if (current == null || actualK == null) return null;
    return current - actualK;
  };

  const workingCapitalMonthly = (rowKey: string, monthIndex: number): number | null => {
    const valuationMultiplier = (brand: keyof typeof VALUATION_REDUCTION_RATE) => (monthIndex >= 2 ? 1 - VALUATION_REDUCTION_RATE[brand] : 1);
    const mlbTag = toDisplayK(inventoryMonthlyTotals.MLB[monthIndex] ?? null);
    const kidsTag = toDisplayK(inventoryMonthlyTotals['MLB KIDS'][monthIndex] ?? null);
    const discoveryTag = toDisplayK(inventoryMonthlyTotals.DISCOVERY[monthIndex] ?? null);
    const mlb =
      mlbTag == null || mlbTag === 0 || tagCostRatio.MLB == null
        ? null
        : (mlbTag / 1.13) * tagCostRatio.MLB * valuationMultiplier('MLB');
    const kids =
      kidsTag == null || kidsTag === 0 || tagCostRatio['MLB KIDS'] == null
        ? null
        : (kidsTag / 1.13) * tagCostRatio['MLB KIDS'] * valuationMultiplier('MLB KIDS');
    const discovery =
      discoveryTag == null || discoveryTag === 0 || tagCostRatio.DISCOVERY == null
        ? null
        : (discoveryTag / 1.13) * tagCostRatio.DISCOVERY * valuationMultiplier('DISCOVERY');
    const total = [mlb, kids, discovery].reduce<number | null>((sum, value) => {
      if (value == null) return sum;
      return (sum ?? 0) + value;
    }, null);
    // 12월(monthIndex=11)은 forecast CSV 값 우선 적용 (1위안 → K단위)
    const isForecastMonth = monthIndex === 11;
    const forecastArDealer = isForecastMonth && wcForecastByKey['wc_ar_dealer'] != null ? wcForecastByKey['wc_ar_dealer'] / 1000 : null;
    const forecastArDirect = isForecastMonth && wcForecastByKey['wc_ar_direct'] != null ? wcForecastByKey['wc_ar_direct'] / 1000 : null;
    const forecastApHq = isForecastMonth && wcForecastByKey['wc_ap_hq'] != null ? wcForecastByKey['wc_ap_hq'] / 1000 : null;
    const forecastApGoods = isForecastMonth && wcForecastByKey['wc_ap_goods'] != null ? wcForecastByKey['wc_ap_goods'] / 1000 : null;
    const arDealer = forecastArDealer ?? HARDCODED_WC_MONTHLY_K.wc_ar_dealer[monthIndex] ?? TAG_COST_RATIO_BRANDS.reduce<number | null>((sum, brand) => {
      const shipmentK = toDisplayK(shipmentMonthlyByBrand[brand][monthIndex]);
      const ratio = tagCostRatio[brand];
      if (shipmentK == null || shipmentK === 0 || ratio == null) return sum;
      const planned = (shipmentK / 1.13) * ratio;
      return (sum ?? 0) + planned;
    }, null);
    const apHq =
      forecastApHq ??
      HARDCODED_WC_MONTHLY_K.wc_ap_hq[monthIndex] ??
      TAG_COST_RATIO_BRANDS.reduce<number | null>((sum, brand) => {
        const purchaseK = toDisplayK(purchaseMonthlyByBrand[brand][monthIndex]);
        const ratio = tagCostRatio[brand];
        if (purchaseK == null || purchaseK === 0 || ratio == null) return sum;
        const planned = -((purchaseK / 1.13) * ratio);
        return (sum ?? 0) + planned;
      }, null);
    const arDirect = forecastArDirect ?? HARDCODED_WC_MONTHLY_K.wc_ar_direct[monthIndex] ?? (arDealer == null ? null : arDealer * WC_AR_DIRECT_SHARE_OF_DEALER_AR);
    const apGoods = forecastApGoods ?? HARDCODED_WC_MONTHLY_K.wc_ap_goods[monthIndex] ?? (apHq == null ? null : apHq * WC_AP_GOODS_SHARE_OF_HQ_AP);
    const arTotal = [arDirect, arDealer].reduce<number | null>((sum, value) => {
      if (value == null) return sum;
      return (sum ?? 0) + value;
    }, null);
    const apTotal = [apHq, apGoods].reduce<number | null>((sum, value) => {
      if (value == null) return sum;
      return (sum ?? 0) + value;
    }, null);
    const grandTotal = [arTotal, total, apTotal].reduce<number | null>((sum, value) => {
      if (value == null) return sum;
      return (sum ?? 0) + value;
    }, null);

    if (rowKey === 'wc_total') return grandTotal;
    if (rowKey === 'wc_ar') return arTotal;
    if (rowKey === 'wc_ar_direct') return arDirect;
    if (rowKey === 'wc_ar_dealer') return arDealer;
    if (rowKey === 'wc_inventory') return total;
    if (rowKey === 'wc_inventory_mlb') return mlb;
    if (rowKey === 'wc_inventory_kids') return kids;
    if (rowKey === 'wc_inventory_discovery') return discovery;
    if (rowKey === 'wc_ap') return apTotal;
    if (rowKey === 'wc_ap_hq') return apHq;
    if (rowKey === 'wc_ap_goods') return apGoods;
    if (rowKey === 'wc_mom') {
      if (grandTotal == null) return null;
      if (monthIndex === 0) {
        const baseActual = WC_TOTAL_ACTUAL2025;
        const baseActualK = toDisplayK(baseActual);
        if (baseActualK == null) return null;
        return grandTotal - baseActualK;
      }
      const prevMonthTotal = workingCapitalMonthly('wc_total', monthIndex - 1);
      if (prevMonthTotal == null) return null;
      return grandTotal - prevMonthTotal;
    }
    return null;
  };

  const cfExplanationNumbers = useMemo<CFExplanationNumbers>(() => {
    // 2025년(합계): cf-hierarchy 라이브 응답 우선, 없으면 STATIC_CF_ROWS 하드코딩 fallback
    const staticCfRow = (key: string) => {
      const live = cf2025Annual(key);
      if (live != null) return live;
      return STATIC_CF_ROWS.find((r) => r.key === key)?.actual2025 ?? 0;
    };
    const staticWcRowRaw = (key: string) => key === 'wc_total' ? WC_TOTAL_ACTUAL2025 : (STATIC_WORKING_CAPITAL_ROWS.find((r) => r.key === key)?.actual2025 ?? 0);
    const wcK = (key: string) => workingCapital2026(key) ?? 0;
    const wcYoyK = (key: string) => {
      const curr = workingCapital2026(key);
      const prevK = toDisplayK(staticWcRowRaw(key));
      if (curr == null || prevK == null) return 0;
      return curr - prevK;
    };
    const opening = cashBorrowingOpening('borrowing');
    const end2026 = cashBorrowing2026('borrowing');

    // 비용증가 분석 TOP 3: 영업활동 > 비용 하위 12개 중 "계획대비증감(금액)" 가 가장 음수인 3개
    //   계획대비증감 = Rolling - 계획(N-1). 비용은 음수이므로:
    //     - 음수 → Rolling이 계획보다 더 음수 → 비용 더 많이 사용 (= 계획 대비 비용 증가)
    //     - 양수 → 계획보다 비용 덜 씀 (= 계획 대비 비용 절감)
    const EXPENSE_ITEMS: Array<{ key: string; name: string }> = [
      { key: 'operating_expenses_ad', name: '광고비' },
      { key: 'operating_expenses_platform', name: '온라인 플랫폼비용' },
      { key: 'operating_expenses_store', name: '오프라인 매장비용' },
      { key: 'operating_expenses_duty', name: '수입증치세' },
      { key: 'operating_expenses_payroll', name: '인건비' },
      { key: 'operating_expenses_deposit', name: '보증금지급' },
      { key: 'operating_expenses_rent', name: '사무실임차료' },
      { key: 'operating_expenses_service_fee', name: '지급수수료' },
      { key: 'operating_expenses_interest', name: '이자비용' },
      { key: 'operating_expenses_withholding_vat', name: 'Withholding/VAT' },
      { key: 'operating_expenses_corporate_tax', name: '법인세' },
      { key: 'operating_expenses_other_cost', name: '기타비용' },
    ];
    const expenseTop3 = EXPENSE_ITEMS
      .map((item) => {
        const planVsRolling = cfPlanVsRollingAmount(item.key) ?? 0;
        return { name: item.name, yoy: planVsRolling, curr: 0, prev: 0 };
      })
      .filter((e) => e.yoy < 0) // 음수 = Rolling이 계획보다 비용 더 많이 사용 (= 계획 대비 비용 증가)
      .sort((a, b) => a.yoy - b.yoy) // 가장 음수 (계획 대비 가장 많이 증가) 순
      .slice(0, 3);

    return {
      영업활동_25: staticCfRow('operating'),
      영업활동_26: cf2026('operating') ?? 0,
      영업활동_yoy: (cf2026('operating') ?? 0) - staticCfRow('operating'),
      매출수금_yoy: (cf2026('operating_receipts') ?? 0) - staticCfRow('operating_receipts'),
      물품대_yoy: (cf2026('operating_payments') ?? 0) - staticCfRow('operating_payments'),
      자산성지출_26: cf2026('capex') ?? 0,
      자산성지출_yoy: (cf2026('capex') ?? 0) - staticCfRow('capex'),
      기타수익_26: cf2026('other_income') ?? 0,
      기타수익_yoy: (cf2026('other_income') ?? 0) - staticCfRow('other_income'),
      차입금_26: cf2026('borrowings') ?? 0,
      차입금_yoy: (cf2026('borrowings') ?? 0) - staticCfRow('borrowings'),
      netCash_26: cf2026('net_cash') ?? 0,
      netCash_yoy: (cf2026('net_cash') ?? 0) - staticCfRow('net_cash'),
      차입금_기말_25: opening ?? 0,
      차입금_기말_26: end2026 ?? 0,
      차입금_기말_yoy: (end2026 ?? 0) - (opening ?? 0),
      운전자본_25: staticWcRowRaw('wc_total'),
      운전자본_26: wcK('wc_total') * 1000,
      운전자본_yoy: wcYoyK('wc_total') * 1000,
      매출채권_25: staticWcRowRaw('wc_ar'),
      매출채권_26: wcK('wc_ar') * 1000,
      매출채권_yoy: wcYoyK('wc_ar') * 1000,
      재고자산_25: staticWcRowRaw('wc_inventory'),
      재고자산_26: wcK('wc_inventory') * 1000,
      재고자산_yoy: wcYoyK('wc_inventory') * 1000,
      매입채무_25: staticWcRowRaw('wc_ap'),
      매입채무_26: wcK('wc_ap') * 1000,
      매입채무_yoy: wcYoyK('wc_ap') * 1000,
      대리상AR_26: wcK('wc_ar_dealer') * 1000,
      대리상AR_yoy: wcYoyK('wc_ar_dealer') * 1000,
      비용증감_top3: expenseTop3,
      매출수금_planVs: cfPlanVsRollingAmount('operating_receipts') ?? 0,
      물품대_planVs: cfPlanVsRollingAmount('operating_payments') ?? 0,
      영업활동_planVs: cfPlanVsRollingAmount('operating') ?? 0,
      자산성지출_planVs: cfPlanVsRollingAmount('capex') ?? 0,
      기타수익_planVs: cfPlanVsRollingAmount('other_income') ?? 0,
      차입금_planVs: cfPlanVsRollingAmount('borrowings') ?? 0,
      netCash_planVs: cfPlanVsRollingAmount('net_cash') ?? 0,
    };
  }, [cfValuesByKey, cashBorrowingData, inventoryHqClosing, tagCostRatio, shipmentMonthlyByBrand, purchaseMonthlyByBrand, wcForecastByKey]);

  const cfInputsLoaded =
    tagCostRatioLoaded &&
    inventoryHqLoaded &&
    inventoryMonthlyLoaded &&
    purchaseLoaded &&
    shipmentLoaded &&
    cfLoaded &&
    cashBorrowingLoaded &&
    creditRecoveryLoaded;
  const loadStatusLabel = cfInputsLoaded ? '로딩완료' : '로딩중';
  const loadStatusClassName = cfInputsLoaded
    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
    : 'bg-amber-50 text-amber-700 border border-amber-200';
  const creditRecoveryHeaders = useMemo(
    () => getRecoveryMonthLabelsAsN월(creditRecovery.baseYearMonth, creditRecovery.recoveries.length),
    [creditRecovery.baseYearMonth, creditRecovery.recoveries.length],
  );
  const hasWorkingCapitalActualMonth = (monthIndex: number) =>
    [HARDCODED_WC_MONTHLY_K.wc_ar_direct, HARDCODED_WC_MONTHLY_K.wc_ar_dealer, HARDCODED_WC_MONTHLY_K.wc_ap_hq, HARDCODED_WC_MONTHLY_K.wc_ap_goods]
      .some((series) => series[monthIndex] != null);
  const formatWorkingCapitalMonthHeader = (month: string, monthIndex: number) =>
    hasWorkingCapitalActualMonth(monthIndex) ? month : `${month}(F)`;

  return (
    <div className="h-[calc(100vh-112px)] overflow-auto bg-gray-50">
        <div className="flex flex-1 min-h-0">
          <div className={`${monthsCollapsed ? 'w-1/2' : 'flex-1'} min-w-0 overflow-auto p-6`}>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <button
              type="button"
              onClick={() => setMonthsCollapsed((prev) => !prev)}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50"
            >
              {monthsCollapsed ? '월별 펼치기' : '월별 접기'}
              {monthsCollapsed
                ? <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                : <ChevronLeft className="h-3.5 w-3.5 text-slate-400" />}
            </button>
            <span className={`inline-flex items-center px-3 py-1 text-xs font-medium rounded-full ${loadStatusClassName}`}>{loadStatusLabel}</span>
            <span className="text-xs font-semibold text-red-600">
              ※ 필수 방문순서: 재고자산(sim) → PL(sim) 순차적으로 방문후 데이터 참고해주세요
            </span>
          </div>

          <div className="overflow-auto rounded-2xl border border-slate-200 shadow-sm" style={{ maxHeight: 'calc(100vh - 220px)' }}>
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-20 bg-navy text-white">
                <tr>
                  <th rowSpan={2} className="border-b border-r border-slate-200 py-3 px-4 text-left sticky left-0 z-30 bg-navy min-w-[220px]">
                    <button
                      type="button"
                      onClick={toggleAllCF}
                      className="inline-flex items-center gap-1.5 text-white hover:text-yellow-300 transition-colors"
                      title={isCfAllCollapsed ? '전체 펼치기' : '전체 접기'}
                    >
                      현금흐름표
                      {isCfAllCollapsed
                        ? <ChevronRight className="h-4 w-4" strokeWidth={2.5} />
                        : <ChevronDown className="h-4 w-4" strokeWidth={2.5} />}
                    </button>
                  </th>
                  <th rowSpan={2} className="border-b border-r border-slate-200 py-3 px-4 text-center min-w-[120px]">2025년(합계)</th>
                  <th colSpan={2} className="border-b border-r border-slate-200 py-2 px-4 text-center bg-slate-500">전월계획</th>
                  {!monthsCollapsed && PL_CF_MONTH_LABELS.map((month) => (
                    <th key={`cf-header-${month}`} rowSpan={2} className="border-b border-r border-slate-200 py-3 px-4 text-center min-w-[84px]">
                      {month}
                    </th>
                  ))}
                  <th colSpan={4} className="border-b border-r border-slate-200 py-2 px-4 text-center bg-navy-light">2026년 Rolling</th>
                </tr>
                <tr>
                  <th className="border-b border-r border-slate-200 py-2 px-4 text-center min-w-[120px] bg-slate-500">2026년계획(N-1)</th>
                  <th className="border-b border-r border-slate-200 py-2 px-4 text-center min-w-[100px] bg-slate-500">계획-전년</th>
                  <th className="border-b border-r border-slate-200 py-2 px-4 text-center min-w-[120px] bg-navy-light">2026년(합계)</th>
                  <th className="border-b border-r border-slate-200 py-2 px-4 text-center min-w-[100px] bg-navy-light">Rolling-전년</th>
                  <th className="border-b border-r border-slate-200 py-2 px-4 text-center min-w-[120px] bg-navy-light">계획대비증감(금액)</th>
                  <th className="border-b border-r border-slate-200 py-2 px-4 text-center min-w-[100px] bg-navy-light">계획대비(%)</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => {
                  const isNetCash = row.key === 'net_cash';
                  const isMajor = row.level === 0 && !isNetCash;
                  const isMedium = row.level === 1;
                  const indentPx = row.level === 0 ? 12 : row.level === 1 ? 36 : 60;
                  // 대분류 행 배경색: 계정별 분기 (현금흐름표 탭과 동일)
                  const majorBg =
                    row.key === 'operating' ? 'bg-highlight-sky'
                    : row.key === 'capex' ? 'bg-highlight-pink'
                    : row.key === 'borrowings' ? 'bg-highlight-mint'
                    : row.key === 'other_income' ? 'bg-highlight-yellow'
                    : 'bg-sky-100';
                  const cellBg = isNetCash
                    ? 'bg-gray-100'
                    : isMajor ? majorBg
                    : isMedium ? 'bg-gray-50'
                    : 'bg-white';

                  return (
                    <tr
                      key={row.key}
                      className={
                        isNetCash
                          ? 'bg-gray-100'
                          : isMajor
                            ? `${majorBg} font-semibold`
                            : isMedium
                              ? 'bg-gray-50'
                              : ''
                      }
                    >
                      <td
                        className={`border-b border-r border-slate-200 py-2 px-4 sticky left-0 z-10 ${cellBg}`}
                        style={{ paddingLeft: `${indentPx}px` }}
                      >
                        {row.isGroup ? (
                          <div className="flex items-center gap-1">
                            <span>{row.label}</span>
                            <button
                              type="button"
                              onClick={() => toggle(row.key)}
                              className="inline-flex items-center text-slate-400 hover:text-slate-700 p-0.5 leading-none"
                            >
                              {collapsed.has(row.key)
                                ? <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.5} />
                                : <ChevronDown className="h-3.5 w-3.5" strokeWidth={2.5} />}
                            </button>
                          </div>
                        ) : (
                          row.label
                        )}
                      </td>
                      <td className="border-b border-r border-slate-200 py-2 px-4 text-right">{formatActual(getActual2025(row))}</td>
                      <td className="border-b border-r border-slate-200 py-2 px-4 text-right">{cfPlan(row.key) != null ? formatActual(cfPlan(row.key)) : '-'}</td>
                      <td className={`border-b border-r border-slate-200 py-2 px-4 text-right ${(cfPlanVsPrev(row) ?? 0) < 0 ? 'text-red-500' : ''}`}>{formatDiffActual(cfPlanVsPrev(row))}</td>
                      {!monthsCollapsed && PL_CF_MONTH_LABELS.map((month, monthIndex) => {
                        const monthValue = cfMonthly(row.key, monthIndex);
                        return (
                          <td
                            key={`cf-cell-${row.key}-${month}`}
                            className={`border-b border-r border-slate-200 py-2 px-4 text-right ${monthValue == null ? 'text-gray-300' : ''}`}
                          >
                            {monthValue == null ? '-' : formatActual(monthValue)}
                          </td>
                        );
                      })}
                      <td className="border-b border-r border-slate-200 py-2 px-4 text-right">{formatActual(cf2026(row.key))}</td>
                      <td className={`border-b border-r border-slate-200 py-2 px-4 text-right ${(cfYoy(row) ?? 0) < 0 ? 'text-red-500' : ''}`}>{formatDiffActual(cfYoy(row))}</td>
                      <td className={`border-b border-r border-slate-200 py-2 px-4 text-right ${(cfPlanVsRollingAmount(row.key) ?? 0) < 0 ? 'text-red-500' : ''}`}>{formatDiffActual(cfPlanVsRollingAmount(row.key))}</td>
                      <td className="border-b border-r border-slate-200 py-2 px-4 text-right">{cfPlanVsRollingPct(row.key)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-2 border border-gray-200 rounded-md bg-white/80">
            <button
              type="button"
              onClick={() => setCfSourcesLegendOpen((open) => !open)}
              className="flex items-center gap-1 w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-md transition-colors"
            >
              <span className="text-gray-600 select-none w-4 text-center">{cfSourcesLegendOpen ? '▾' : '▸'}</span>
              <span className="font-medium">데이터 출처 (CSV)</span>
            </button>
            {cfSourcesLegendOpen && (
              <div className="px-3 pb-3 pt-0 text-xs text-gray-600 space-y-3 border-t border-gray-100">
                <p className="font-sans text-gray-500 mt-2 leading-relaxed">
                  숫자는 화면에서 K(천) 단위로 표시됩니다(원본 ÷ 1000).
                  <br />
                  「2025년(합계)」열은 이 양식에 맞춘 <span className="font-medium text-gray-700">고정 표기값</span>이며 CSV가
                  아닙니다.
                </p>
                {cfHierarchyCsvSources.length > 0 && (
                  <div>
                    <p className="font-medium text-gray-700">월별·전월계획·2026 Rolling·계획대비</p>
                    <p className="font-sans text-gray-500 mb-1">
                      메인 현금흐름표와 동일하게 <span className="font-medium text-gray-700">파일/cashflow</span> 연도별 CSV와{' '}
                      <span className="font-medium text-gray-700">/api/fs/cf-hierarchy</span>를 사용합니다. 전월계획 블록은
                      2026.csv의 <span className="font-medium text-gray-700">2026년계획(N-1)</span> 열 기준입니다.
                    </p>
                    <ul className="list-disc pl-4 space-y-2 font-mono break-all">
                      {cfHierarchyCsvSources.map((s) => (
                        <li key={s.year}>
                          <span className="font-sans text-gray-500">{s.year}.csv — 상대 </span>
                          {s.relative}
                          <br />
                          <span className="font-sans text-gray-500">절대 </span>
                          {s.absolute}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {cfHierarchyCsvSources.length === 0 && (
                  <p className="text-gray-400 pt-2">출처 정보를 불러오지 못했습니다.</p>
                )}
              </div>
            )}
          </div>

          <div className="mt-8">
            <div className="overflow-x-auto border border-slate-200 rounded-2xl shadow-sm">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-navy text-white">
                  <tr>
                    <th rowSpan={2} className="border-b border-r border-slate-200 py-2.5 px-4 text-left sticky left-0 z-10 bg-navy min-w-[200px]">현금잔액과 차입금잔액표</th>
                    <th rowSpan={2} className="border-b border-r border-slate-200 py-2.5 px-4 text-center min-w-[120px]">기초잔액</th>
                    <th colSpan={2} className="border-b border-r border-slate-200 py-1.5 px-4 text-center bg-slate-500">전월계획</th>
                    {!monthsCollapsed && PL_CF_MONTH_LABELS.map((month) => (
                      <th key={`balance-header-${month}`} rowSpan={2} className="border-b border-r border-slate-200 py-2.5 px-4 text-center min-w-[84px]">
                        {month}
                      </th>
                    ))}
                    <th colSpan={4} className="border-b border-r border-slate-200 py-1.5 px-4 text-center bg-navy-light">2026년 Rolling</th>
                  </tr>
                  <tr>
                    <th className="border-b border-r border-slate-200 py-1.5 px-4 text-center min-w-[120px] bg-slate-500">2026년계획(N-1)</th>
                    <th className="border-b border-r border-slate-200 py-1.5 px-4 text-center min-w-[100px] bg-slate-500">계획-전년</th>
                    <th className="border-b border-r border-slate-200 py-1.5 px-4 text-center min-w-[120px] bg-navy-light">기말잔액</th>
                    <th className="border-b border-r border-slate-200 py-1.5 px-4 text-center min-w-[100px] bg-navy-light">Rolling-전년</th>
                    <th className="border-b border-r border-slate-200 py-1.5 px-4 text-center min-w-[120px] bg-navy-light">계획대비증감(금액)</th>
                    <th className="border-b border-r border-slate-200 py-1.5 px-4 text-center min-w-[100px] bg-navy-light">계획대비(%)</th>
                  </tr>
                </thead>
                <tbody className="bg-gray-50">
                  <tr>
                    <td className="border-b border-r border-slate-200 py-2 px-4 font-medium sticky left-0 z-10 bg-gray-100 text-gray-800">현금잔액</td>
                    <td className="border-b border-r border-slate-200 py-2 px-4 text-right bg-gray-50">{formatActual(cashBorrowingOpening('cash'))}</td>
                    <td className="border-b border-r border-slate-200 py-2 px-4 text-right bg-gray-50">{cashDebtPlanValue('cash') != null ? formatActual(cashDebtPlanValue('cash')) : '-'}</td>
                    <td className={`border-b border-r border-slate-200 py-2 px-4 text-right bg-gray-50 ${(cashDebtPlanVsPrev('cash') ?? 0) < 0 ? 'text-red-500' : ''}`}>{formatDiffActual(cashDebtPlanVsPrev('cash'))}</td>
                    {!monthsCollapsed && PL_CF_MONTH_LABELS.map((month, monthIndex) => {
                      const monthValue = cashBorrowingMonthly('cash', monthIndex);
                      return (
                        <td key={`cash-cell-${month}`} className={`border-b border-r border-slate-200 py-2 px-4 text-right bg-gray-50 ${monthValue == null ? 'text-gray-300' : ''}`}>
                          {monthValue == null ? '-' : formatActual(monthValue)}
                        </td>
                      );
                    })}
                    <td className="border-b border-r border-slate-200 py-2 px-4 text-right bg-gray-50">{formatActual(cashBorrowing2026('cash'))}</td>
                    <td className={`border-b border-r border-slate-200 py-2 px-4 text-right bg-gray-50 ${(cashBorrowingYoy('cash') ?? 0) < 0 ? 'text-red-500' : ''}`}>{formatDiffActual(cashBorrowingYoy('cash'))}</td>
                    <td className={`border-b border-r border-slate-200 py-2 px-4 text-right bg-gray-50 ${(cashDebtVsRollingAmount('cash') ?? 0) < 0 ? 'text-red-500' : ''}`}>{formatDiffActual(cashDebtVsRollingAmount('cash'))}</td>
                    <td className="border-b border-r border-slate-200 py-2 px-4 text-right bg-gray-50">{cashDebtVsRollingPct('cash')}</td>
                  </tr>
                  <tr>
                    <td className="border-b border-r border-slate-200 py-2 px-4 font-medium sticky left-0 z-10 bg-gray-100 text-gray-800">차입금잔액</td>
                    <td className="border-b border-r border-slate-200 py-2 px-4 text-right bg-gray-50">{formatActual(cashBorrowingOpening('borrowing'))}</td>
                    <td className="border-b border-r border-slate-200 py-2 px-4 text-right bg-gray-50">{cashDebtPlanValue('borrowing') != null ? formatActual(cashDebtPlanValue('borrowing')) : '-'}</td>
                    <td className={`border-b border-r border-slate-200 py-2 px-4 text-right bg-gray-50 ${(cashDebtPlanVsPrev('borrowing') ?? 0) < 0 ? 'text-red-500' : ''}`}>{formatDiffActual(cashDebtPlanVsPrev('borrowing'))}</td>
                    {!monthsCollapsed && PL_CF_MONTH_LABELS.map((month, monthIndex) => {
                      const monthValue = cashBorrowingMonthly('borrowing', monthIndex);
                      return (
                        <td
                          key={`borrowing-cell-${month}`}
                          className={`border-b border-r border-slate-200 py-2 px-4 text-right bg-gray-50 ${monthValue == null ? 'text-gray-300' : ''}`}
                        >
                          {monthValue == null ? '-' : formatActual(monthValue)}
                        </td>
                      );
                    })}
                    <td className="border-b border-r border-slate-200 py-2 px-4 text-right bg-gray-50">{formatActual(cashBorrowing2026('borrowing'))}</td>
                    <td className={`border-b border-r border-slate-200 py-2 px-4 text-right bg-gray-50 ${(cashBorrowingYoy('borrowing') ?? 0) < 0 ? 'text-red-500' : ''}`}>{formatDiffActual(cashBorrowingYoy('borrowing'))}</td>
                    <td className={`border-b border-r border-slate-200 py-2 px-4 text-right bg-gray-50 ${(cashDebtVsRollingAmount('borrowing') ?? 0) < 0 ? 'text-red-500' : ''}`}>{formatDiffActual(cashDebtVsRollingAmount('borrowing'))}</td>
                    <td className="border-b border-r border-slate-200 py-2 px-4 text-right bg-gray-50">{cashDebtVsRollingPct('borrowing')}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-8">
            <div className="overflow-x-auto border border-slate-200 rounded-2xl shadow-sm">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-navy text-white">
                  <tr>
                    <th rowSpan={2} className="border-b border-r border-slate-200 py-3 px-4 text-left sticky left-0 z-20 bg-navy min-w-[200px]">
                      <button
                        type="button"
                        onClick={toggleAllWC}
                        className="inline-flex items-center gap-1.5 text-white hover:text-yellow-300 transition-colors"
                        title={isWcAllCollapsed ? '전체 펼치기' : '전체 접기'}
                      >
                        운전자본표
                        {isWcAllCollapsed
                          ? <ChevronRight className="h-4 w-4" strokeWidth={2.5} />
                          : <ChevronDown className="h-4 w-4" strokeWidth={2.5} />}
                      </button>
                    </th>
                    <th rowSpan={2} className="border-b border-r border-slate-200 py-3 px-4 text-center min-w-[120px]">2025년(기말)</th>
                    <th colSpan={2} className="border-b border-r border-slate-200 py-2 px-4 text-center bg-slate-500">전월계획</th>
                    {!monthsCollapsed && PL_CF_MONTH_LABELS.map((month, monthIndex) => (
                      <th key={`wc-header-${month}`} rowSpan={2} className="border-b border-r border-slate-200 py-3 px-4 text-center min-w-[84px]">
                        {formatWorkingCapitalMonthHeader(month, monthIndex)}
                      </th>
                    ))}
                    <th colSpan={4} className="border-b border-r border-slate-200 py-2 px-4 text-center bg-navy-light">2026년 Rolling</th>
                  </tr>
                  <tr>
                    <th className="border-b border-r border-slate-200 py-2 px-4 text-center min-w-[120px] bg-slate-500">2026년연간계획(N-1)</th>
                    <th className="border-b border-r border-slate-200 py-2 px-4 text-center min-w-[100px] bg-slate-500">계획-전년</th>
                    <th className="border-b border-r border-slate-200 py-2 px-4 text-center min-w-[120px] bg-navy-light">2026년(기말)</th>
                    <th className="border-b border-r border-slate-200 py-2 px-4 text-center min-w-[100px] bg-navy-light">Rolling-전년</th>
                    <th className="border-b border-r border-slate-200 py-2 px-4 text-center min-w-[120px] bg-navy-light">계획대비증감(금액)</th>
                    <th className="border-b border-r border-slate-200 py-2 px-4 text-center min-w-[100px] bg-navy-light">계획대비(%)</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleWorkingCapitalRows.map((row) => {
                    const isTotal = row.key === 'wc_total';
                    const isMonthDiff = row.key === 'wc_mom';
                    const isLevel1 = !isTotal && !isMonthDiff && row.level === 1;
                    // 계정별 색상 분기 (운전자본표 탭과 동일)
                    const level1Bg =
                      row.key === 'wc_ar' ? 'bg-highlight-sky'
                      : row.key === 'wc_inventory' ? 'bg-highlight-pink'
                      : row.key === 'wc_ap' ? 'bg-highlight-mint'
                      : 'bg-sky-100';
                    const cellBg = isTotal
                      ? 'bg-highlight-yellow'
                      : isLevel1 ? level1Bg
                      : isMonthDiff ? 'bg-white'
                      : 'bg-white';
                    const indentPx = row.level === 2 ? 36 : 12;

                    return (
                      <tr key={row.key} className={cellBg + (isTotal || isLevel1 ? ' font-semibold' : '')}>
                        <td
                          className={`border-b border-r border-slate-200 py-2 px-4 sticky left-0 z-10 ${cellBg}`}
                          style={{ paddingLeft: `${indentPx}px` }}
                        >
                          {row.isGroup ? (
                            <div className="flex items-center gap-1">
                              <span>{row.label}</span>
                              <button
                                type="button"
                                onClick={() => toggleWorkingCapital(row.key)}
                                className="inline-flex items-center text-slate-400 hover:text-slate-700 p-0.5 leading-none"
                              >
                                {wcCollapsed.has(row.key)
                                  ? <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.5} />
                                  : <ChevronDown className="h-3.5 w-3.5" strokeWidth={2.5} />}
                              </button>
                            </div>
                          ) : (
                            row.label
                          )}
                        </td>
                        <td className={`border-b border-r border-slate-200 py-2 px-4 text-right ${cellBg}`}>{formatActual(row.actual2025)}</td>
                        <td className={`border-b border-r border-slate-200 py-2 px-4 text-right ${cellBg}`}>{wcPlanK(row.key) != null ? formatKValue(wcPlanK(row.key)) : '-'}</td>
                        <td className={`border-b border-r border-slate-200 py-2 px-4 text-right ${cellBg} ${(wcPlanVsPrev(row) ?? 0) < 0 ? 'text-red-500' : ''}`}>{formatDiffK(wcPlanVsPrev(row))}</td>
                        {!monthsCollapsed && PL_CF_MONTH_LABELS.map((month, monthIndex) => {
                          const monthValue = workingCapitalMonthly(row.key, monthIndex);
                          return (
                            <td key={`wc-cell-${row.key}-${month}`} className={`border-b border-r border-slate-200 py-2 px-4 text-right ${monthValue == null ? 'text-gray-300' : ''} ${cellBg}`}>
                              {monthValue == null ? '-' : formatKValue(monthValue)}
                            </td>
                          );
                        })}
                        <td className={`border-b border-r border-slate-200 py-2 px-4 text-right ${cellBg}`}>{formatKValue(workingCapital2026(row.key))}</td>
                        <td className={`border-b border-r border-slate-200 py-2 px-4 text-right ${cellBg} ${(workingCapitalYoy(row) ?? 0) < 0 ? 'text-red-500' : ''}`}>{isMonthDiff ? '-' : formatDiffK(workingCapitalYoy(row))}</td>
                        <td className={`border-b border-r border-slate-200 py-2 px-4 text-right ${cellBg} ${(wcPlanVsRollingAmount(row.key) ?? 0) < 0 ? 'text-red-500' : ''}`}>{formatDiffK(wcPlanVsRollingAmount(row.key))}</td>
                        <td className={`border-b border-r border-slate-200 py-2 px-4 text-right ${cellBg}`}>{wcPlanVsRollingPct(row.key)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!wcLegendCollapsed && (
              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <div className="font-semibold mb-1">운전자본 계산 범례</div>
                <div>매출채권: 직영AR + 대리상AR</div>
                <div>직영AR: (실적월) 실적값, (계획월) 대리상AR × (2025년 기말 직영AR/대리상AR 비중)</div>
                <div>대리상AR: (실적월) 실적값, (계획월) 매출채권합계(대리상) ÷ 1.13 × Tag대비원가율</div>
                <div>재고자산: Tag재고 ÷ 1.13 × Tag대비원가율 × (3월부터 (1-평가감율), 1~2월은 평가감율 미적용)</div>
                <div>매입채무: 본사AP + 상품AP</div>
                <div>본사AP: (실적월) 실적값, (계획월) 매입채무합계(HQ) ÷ 1.13 × Tag대비원가율</div>
                <div>상품AP: (실적월) 실적값, (계획월) 본사AP × (2025년 기말 상품AP/본사AP 비중)</div>
              </div>
            )}
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setWcLegendCollapsed((prev) => !prev)}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50"
              >
                {wcLegendCollapsed ? '범례 펼치기' : '범례 접기'}
                {wcLegendCollapsed
                  ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                  : <ChevronUp className="h-3.5 w-3.5 text-slate-400" />}
              </button>
              <button
                type="button"
                onClick={() => setWcSupportCollapsed((prev) => !prev)}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50"
              >
                {wcSupportCollapsed ? '보조지표 펼치기' : '보조지표 접기'}
                {wcSupportCollapsed
                  ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                  : <ChevronUp className="h-3.5 w-3.5 text-slate-400" />}
              </button>
            </div>
            {!wcSupportCollapsed && (
            <div className="mt-3 overflow-x-auto border border-slate-200 rounded-2xl shadow-sm">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-slate-700 text-white">
                  <tr>
                    <th className="border-b border-r border-slate-200 py-2.5 px-4 text-left min-w-[180px]">항목</th>
                    {PL_CF_MONTH_LABELS.map((month, monthIndex) => (
                      <th
                        key={`wc-support-header-${month}`}
                        className="border-b border-r border-slate-200 py-2.5 px-4 text-center min-w-[84px]"
                      >
                        {formatWorkingCapitalMonthHeader(month, monthIndex)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="bg-slate-100 font-semibold">
                    <td className="border-b border-r border-slate-200 py-2 px-4 text-slate-800">Tag재고 합계</td>
                    {PL_CF_MONTH_LABELS.map((month, monthIndex) => {
                      const total = TAG_COST_RATIO_BRANDS.reduce<number | null>((sum, brand) => {
                        const value = toDisplayK(inventoryMonthlyTotals[brand][monthIndex] ?? null);
                        if (value == null) return sum;
                        return (sum ?? 0) + value;
                      }, null);
                      return (
                        <td
                          key={`tag-inventory-group-${month}`}
                          className={`border-b border-r border-slate-200 py-2 px-4 text-right ${total == null ? 'text-gray-300' : 'text-slate-800'}`}
                        >
                          {total == null ? '-' : formatKValue(total)}
                        </td>
                      );
                    })}
                  </tr>
                  {TAG_COST_RATIO_BRANDS.map((brand) => (
                    <tr key={`tag-inventory-row-${brand}`} className="bg-slate-50">
                      <td className="border-b border-r border-slate-200 py-2 px-4 text-slate-800" style={{ paddingLeft: '28px' }}>
                        {brand}
                      </td>
                      {PL_CF_MONTH_LABELS.map((month, monthIndex) => {
                        const monthValue = toDisplayK(inventoryMonthlyTotals[brand][monthIndex] ?? null);
                        return (
                          <td
                            key={`tag-inventory-value-${brand}-${month}`}
                            className="border-b border-r border-slate-200 py-2 px-4 text-right text-slate-700"
                          >
                            {monthValue == null ? '-' : formatKValue(monthValue)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr className="bg-slate-100 font-semibold">
                    <td className="border-b border-r border-slate-200 py-2 px-4 text-slate-800">평가감율</td>
                    {PL_CF_MONTH_LABELS.map((month) => (
                      <td
                        key={`valuation-rate-group-${month}`}
                        className="border-b border-r border-slate-200 py-2 px-4 text-center text-gray-300"
                      >
                        -
                      </td>
                    ))}
                  </tr>
                  {TAG_COST_RATIO_BRANDS.map((brand) => (
                    <tr key={`valuation-rate-row-${brand}`} className="bg-slate-50">
                      <td className="border-b border-r border-slate-200 py-2 px-4 text-slate-800" style={{ paddingLeft: '28px' }}>
                        {brand}
                      </td>
                      {PL_CF_MONTH_LABELS.map((month) => (
                        <td
                          key={`valuation-rate-value-${brand}-${month}`}
                          className="border-b border-r border-slate-200 py-2 px-4 text-right text-slate-700"
                        >
                          {formatPercent4(VALUATION_REDUCTION_RATE[brand])}
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr className="bg-slate-100 font-semibold">
                    <td className="border-b border-r border-slate-200 py-2 px-4 text-slate-800">매출채권합계(대리상)</td>
                    {PL_CF_MONTH_LABELS.map((month, monthIndex) => {
                      const total = TAG_COST_RATIO_BRANDS.reduce<number | null>((sum, brand) => {
                        const value = shipmentMonthlyByBrand[brand][monthIndex];
                        if (value == null) return sum;
                        return (sum ?? 0) + value;
                      }, null);
                      const displayK = toDisplayK(total);
                      return (
                        <td
                          key={`ar-total-group-${month}`}
                          className={`border-b border-r border-slate-200 py-2 px-4 text-right ${displayK == null ? 'text-gray-300' : 'text-slate-800'}`}
                        >
                          {displayK == null ? '-' : formatKValue(displayK)}
                        </td>
                      );
                    })}
                  </tr>
                  {TAG_COST_RATIO_BRANDS.map((brand) => (
                    <tr key={`ar-total-row-${brand}`} className="bg-slate-50">
                      <td className="border-b border-r border-slate-200 py-2 px-4 text-slate-800" style={{ paddingLeft: '28px' }}>
                        {brand}
                      </td>
                      {PL_CF_MONTH_LABELS.map((month, monthIndex) => {
                        const monthValue = shipmentMonthlyByBrand[brand][monthIndex];
                        const displayK = toDisplayK(monthValue);
                        return (
                          <td
                            key={`ar-total-value-${brand}-${month}`}
                            className={`border-b border-r border-slate-200 py-2 px-4 text-right ${displayK == null ? 'text-gray-300' : 'text-slate-700'}`}
                          >
                            {displayK == null ? '-' : formatKValue(displayK)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr className="bg-slate-100 font-semibold">
                    <td className="border-b border-r border-slate-200 py-2 px-4 text-slate-800">매입채무합계(HQ)</td>
                    {PL_CF_MONTH_LABELS.map((month, monthIndex) => {
                      const total = TAG_COST_RATIO_BRANDS.reduce<number | null>((sum, brand) => {
                        const value = purchaseMonthlyByBrand[brand][monthIndex];
                        if (value == null) return sum;
                        return (sum ?? 0) + value;
                      }, null);
                      const displayK = toDisplayK(total);
                      return (
                        <td
                          key={`ap-total-group-${month}`}
                          className={`border-b border-r border-slate-200 py-2 px-4 text-right ${displayK == null ? 'text-gray-300' : 'text-slate-800'}`}
                        >
                          {displayK == null ? '-' : formatKValue(displayK)}
                        </td>
                      );
                    })}
                  </tr>
                  {TAG_COST_RATIO_BRANDS.map((brand) => (
                    <tr key={`ap-total-row-${brand}`} className="bg-slate-50">
                      <td className="border-b border-r border-slate-200 py-2 px-4 text-slate-800" style={{ paddingLeft: '28px' }}>
                        {brand}
                      </td>
                      {PL_CF_MONTH_LABELS.map((month, monthIndex) => {
                        const monthValue = purchaseMonthlyByBrand[brand][monthIndex];
                        const displayK = toDisplayK(monthValue);
                        return (
                          <td
                            key={`ap-total-value-${brand}-${month}`}
                            className={`border-b border-r border-slate-200 py-2 px-4 text-right ${displayK == null ? 'text-gray-300' : 'text-slate-700'}`}
                          >
                            {displayK == null ? '-' : formatKValue(displayK)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr className="bg-white font-semibold">
                    <td className="border-b border-r border-slate-200 py-2 px-4 text-slate-800">Tag대비원가율</td>
                    {PL_CF_MONTH_LABELS.map((month) => (
                      <td
                        key={`tag-cost-ratio-group-${month}`}
                        className="border-b border-r border-slate-200 py-2 px-4 text-center text-gray-300"
                      >
                        -
                      </td>
                    ))}
                  </tr>
                  {TAG_COST_RATIO_BRANDS.map((brand) => (
                    <tr key={`tag-cost-ratio-row-${brand}`} className="bg-white">
                      <td className="border-b border-r border-slate-200 py-2 px-4 text-slate-800" style={{ paddingLeft: '28px' }}>
                        {brand}
                      </td>
                      {PL_CF_MONTH_LABELS.map((month) => (
                        <td
                          key={`tag-cost-ratio-value-${brand}-${month}`}
                          className="border-b border-r border-slate-200 py-2 px-4 text-right text-slate-700"
                        >
                          {formatPercent4(tagCostRatio[brand])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}
          </div>

          <div className="mt-8">
            <h3 className="text-base font-semibold text-gray-800 mb-2">대리상 여신회수 계획 ({creditRecovery.baseYearMonth} 기준)</h3>
            <div className="overflow-x-auto border border-slate-200 rounded-2xl shadow-sm">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-navy text-white">
                  <tr>
                    <th className="border-b border-r border-slate-200 py-3 px-4 text-center min-w-[100px]">대리상선수금</th>
                    <th className="border-b border-r border-slate-200 py-3 px-4 text-center min-w-[100px]">대리상 채권</th>
                    {creditRecoveryHeaders.map((header) => (
                      <th key={header} className="border-b border-r border-slate-200 py-3 px-4 text-center min-w-[100px]">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-gray-50">
                  <tr>
                    <td className="border-b border-r border-slate-200 py-2 px-4 text-right">{formatActual(creditRecovery.dealerAdvance)}</td>
                    <td className="border-b border-r border-slate-200 py-2 px-4 text-right">{formatActual(creditRecovery.dealerReceivable)}</td>
                    {creditRecovery.recoveries.map((value, index) => (
                      <td key={`credit-recovery-${index}`} className="border-b border-r border-slate-200 py-2 px-4 text-right">
                        {formatActual(value)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

          {monthsCollapsed && (
            <div className="w-1/2 min-w-0 overflow-auto p-6 border-l border-gray-200">
              <CFExplanationPanel year={2026} rollingNumbers={cfExplanationNumbers} storeKey="pl-cf-explanation" />
            </div>
          )}
        </div>
    </div>
  );
}


