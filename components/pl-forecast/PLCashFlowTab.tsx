'use client';

import { useEffect, useMemo, useState } from 'react';
import { formatNumber, getRecoveryMonthLabelsAsN월 } from '@/lib/utils';
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

type CashBorrowingApiData = {
  cash: number[];
  borrowing: number[];
  prevCash?: number[];
  prevBorrowing?: number[];
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

const STATIC_CF_ROWS: StaticCFRow[] = [
  { key: 'operating', label: '영업활동', level: 0, isGroup: true, actual2025: -447126572 },
  { key: 'operating_receipts', label: '매출수금', level: 1, isGroup: true, actual2025: 5227741340 },
  { key: 'operating_receipts_mlb', label: 'MLB', level: 2, isGroup: false, actual2025: 5013366502 },
  { key: 'operating_receipts_kids', label: 'MLB KIDS', level: 2, isGroup: false, actual2025: 160399540 },
  { key: 'operating_receipts_discovery', label: 'DISCOVERY', level: 2, isGroup: false, actual2025: 40727371 },
  { key: 'operating_receipts_duvetica', label: 'DUVETICA', level: 2, isGroup: false, actual2025: 9232685 },
  { key: 'operating_receipts_supra', label: 'SUPRA', level: 2, isGroup: false, actual2025: 4015242 },
  { key: 'operating_payments', label: '물품대', level: 1, isGroup: true, actual2025: -3361214993 },
  { key: 'operating_payments_hq', label: '본사', level: 2, isGroup: false, actual2025: -2991224444 },
  { key: 'operating_payments_local', label: '현지', level: 2, isGroup: false, actual2025: -369990549 },
  { key: 'operating_advance', label: '본사선급금', level: 1, isGroup: false, actual2025: -700000000 },
  { key: 'operating_expenses', label: '비용', level: 1, isGroup: true, actual2025: -1613652919 },
  { key: 'operating_expenses_ad', label: '광고비', level: 2, isGroup: false, actual2025: -224166795 },
  { key: 'operating_expenses_platform', label: '온라인 플랫폼비용', level: 2, isGroup: false, actual2025: -274204282 },
  { key: 'operating_expenses_store', label: '오프라인 매장비용', level: 2, isGroup: false, actual2025: -256910016 },
  { key: 'operating_expenses_duty', label: '수입관세', level: 2, isGroup: false, actual2025: -524699762 },
  { key: 'operating_expenses_payroll', label: '인건비', level: 2, isGroup: false, actual2025: -127309323 },
  { key: 'operating_expenses_deposit', label: '보증금지급', level: 2, isGroup: false, actual2025: -5982822 },
  { key: 'operating_expenses_other', label: '기타', level: 2, isGroup: false, actual2025: -200379920 },
  { key: 'capex', label: '자산성지출', level: 0, isGroup: true, actual2025: -43236275 },
  { key: 'capex_interior', label: '인테리어/VMD', level: 1, isGroup: false, actual2025: -35983113 },
  { key: 'capex_fixture', label: '비품취득', level: 1, isGroup: false, actual2025: -7253162 },
  { key: 'other_income', label: '기타수익', level: 0, isGroup: false, actual2025: 45376018 },
  { key: 'borrowings', label: '차입금', level: 0, isGroup: false, actual2025: 409685078 },
  { key: 'net_cash', label: 'net cash', level: 0, isGroup: false, actual2025: -35301752 },
];

const STATIC_CASH_BORROWING = {
  cashOpening: 139543000,
  borrowingOpening: 909685000,
};

const STATIC_WORKING_CAPITAL_ROWS: StaticWorkingCapitalRow[] = [
  { key: 'wc_total', label: '운전자본 합계', level: 0, isGroup: false, actual2025: 1819059000 },
  { key: 'wc_mom', label: '전월대비', level: 0, isGroup: false, actual2025: 485491000 },
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
    baseYearMonth: '26.02',
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
    new Set(CF_GROUP_KEYS),
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
        const res = await fetch('/api/annual-plan/credit-recovery?baseYearMonth=26.02', { cache: 'no-store' });
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
          baseYearMonth: typeof payload.baseYearMonth === 'string' ? payload.baseYearMonth : '26.02',
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

  const [cfPlanByKey, setCfPlanByKey] = useState<Record<string, number>>({});
  const [cashDebtPlan, setCashDebtPlan] = useState<{ cash: number | null; borrowing: number | null }>({ cash: null, borrowing: null });
  const [wcPlanByKey, setWcPlanByKey] = useState<Record<string, number>>({});
  const [wcForecastByKey, setWcForecastByKey] = useState<Record<string, number>>({});

  useEffect(() => {
    fetch('/api/pl-forecast/cf-plan', { cache: 'no-store' })
      .then((res) => res.json())
      .then((data: Record<string, number>) => {
        if (data && !data.error) setCfPlanByKey(data);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch('/api/pl-forecast/cash-debt-plan', { cache: 'no-store' })
      .then((res) => res.json())
      .then((data: { cash: number | null; borrowing: number | null }) => {
        if (data && !('error' in data)) setCashDebtPlan(data);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch('/api/pl-forecast/wc-plan', { cache: 'no-store' })
      .then((res) => res.json())
      .then((data: Record<string, number>) => {
        if (data && !('error' in data)) setWcPlanByKey(data);
      })
      .catch(() => {});
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
      result.push(row);
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
        else if (row.level === 2 && level0 === '영업활동' && level1 === '비용' && row.account === '수입관세') key = 'operating_expenses_duty';
        else if (row.level === 2 && level0 === '영업활동' && level1 === '비용' && row.account === '인건비') key = 'operating_expenses_payroll';
        else if (row.level === 2 && level0 === '영업활동' && level1 === '비용' && row.account === '보증금지급') key = 'operating_expenses_deposit';
        else if (row.level === 2 && level0 === '영업활동' && level1 === '비용' && row.account === '기타') key = 'operating_expenses_other';
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

  const cfYoy = (row: StaticCFRow): number | null => {
    const values = cfValuesByKey[row.key];
    if (!values) return null;
    const raw = values[14];
    return Number.isFinite(raw) ? raw : null;
  };

  const cfPlan = (rowKey: string): number | null => {
    const v = cfPlanByKey[rowKey];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };

  const cfPlanVsPrev = (row: StaticCFRow): number | null => {
    const plan = cfPlan(row.key);
    if (plan == null || row.actual2025 == null) return null;
    return plan - row.actual2025;
  };

  const cfPlanVsRollingAmount = (rowKey: string): number | null => {
    const rolling = cf2026(rowKey);
    const plan = cfPlan(rowKey);
    if (rolling == null || plan == null) return null;
    return rolling - plan;
  };

  const cfPlanVsRollingPct = (rowKey: string): string => {
    const rolling = cf2026(rowKey);
    const plan = cfPlan(rowKey);
    if (rolling == null || plan == null || plan === 0) return '-';
    const pct = (rolling / plan) * 100;
    return `${Math.round(pct)}%`;
  };

  // 현금잔액/차입금잔액 계획 헬퍼
  const cashDebtPlanValue = (rowKey: 'cash' | 'borrowing'): number | null =>
    rowKey === 'cash' ? cashDebtPlan.cash : cashDebtPlan.borrowing;

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
    if (rolling == null || !plan) return '-';
    const pct = (rolling / plan) * 100;
    return `${Math.round(pct)}%`;
  };

  // 운전자본 계획 헬퍼 (CSV는 1위안, formatKValue는 K단위 → /1000)
  const wcPlan = (rowKey: string): number | null => {
    const v = wcPlanByKey[rowKey];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };

  const wcPlanK = (rowKey: string): number | null => {
    const v = wcPlan(rowKey);
    return v != null ? v / 1000 : null;
  };

  const wcPlanVsPrev = (row: StaticWorkingCapitalRow): number | null => {
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
      const baseActual = STATIC_WORKING_CAPITAL_ROWS.find((row) => row.key === 'wc_total')?.actual2025 ?? null;
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
        const baseActual = STATIC_WORKING_CAPITAL_ROWS.find((row) => row.key === 'wc_total')?.actual2025 ?? null;
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
    const staticCfRow = (key: string) => STATIC_CF_ROWS.find((r) => r.key === key)?.actual2025 ?? 0;
    const staticWcRowRaw = (key: string) => STATIC_WORKING_CAPITAL_ROWS.find((r) => r.key === key)?.actual2025 ?? 0;
    const wcK = (key: string) => workingCapital2026(key) ?? 0;
    const wcYoyK = (key: string) => {
      const curr = workingCapital2026(key);
      const prevK = toDisplayK(staticWcRowRaw(key));
      if (curr == null || prevK == null) return 0;
      return curr - prevK;
    };
    const opening = cashBorrowingOpening('borrowing');
    const end2026 = cashBorrowing2026('borrowing');
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
    <div className="h-[calc(100vh-64px)] overflow-auto bg-gray-50">
      <div className="sticky top-0 z-[60] bg-gray-100/95 border-b border-gray-300 shadow-sm backdrop-blur">
        <div className="flex items-center gap-3 px-6 py-3">
          <span className="text-sm font-medium text-gray-700">2026년 현금흐름표 양식</span>
          <button
            type="button"
            onClick={() => setMonthsCollapsed((prev) => !prev)}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-200 text-gray-700 hover:bg-gray-300 transition-colors shadow-sm"
          >
            {monthsCollapsed ? '월별 펼치기' : '월별 접기'}
          </button>
          <span className={`px-3 py-1 text-xs font-medium rounded-full ${loadStatusClassName}`}>{loadStatusLabel}</span>
          <span className="font-bold text-red-600" style={{ fontSize: '1.125rem' }}>
            ※ 성장률 변경 시 재고자산탭 방문 후 CF를 새로고침하세요
          </span>
        </div>
      </div>

        <div className="flex flex-1 min-h-0">
          <div className={`${monthsCollapsed ? 'w-1/2' : 'flex-1'} min-w-0 overflow-auto p-6`}>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-lg font-bold text-gray-900">현금흐름표</h2>
            <button
              type="button"
              onClick={toggleAllCF}
              className="px-3 py-1 text-xs font-medium rounded-md bg-gray-100 text-gray-700 border border-gray-300 hover:bg-gray-200 transition-colors"
            >
              {isCfAllCollapsed ? '전체 펼치기' : '전체 접기'}
            </button>
          </div>

          <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 220px)' }}>
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-20 bg-navy text-white">
                <tr>
                  <th rowSpan={2} className="border border-gray-300 py-3 px-4 text-left sticky left-0 z-30 bg-navy min-w-[220px]">
                    계정과목
                  </th>
                  <th rowSpan={2} className="border border-gray-300 py-3 px-4 text-center min-w-[120px]">2025년(합계)</th>
                  <th colSpan={2} className="border border-gray-300 py-2 px-4 text-center bg-gray-600">계획</th>
                  {!monthsCollapsed && PL_CF_MONTH_LABELS.map((month) => (
                    <th key={`cf-header-${month}`} rowSpan={2} className="border border-gray-300 py-3 px-4 text-center min-w-[84px]">
                      {month}
                    </th>
                  ))}
                  <th colSpan={4} className="border border-gray-300 py-2 px-4 text-center">2026년 Rolling</th>
                </tr>
                <tr>
                  <th className="border border-gray-300 py-2 px-4 text-center min-w-[120px] bg-gray-600">2026년(계획)</th>
                  <th className="border border-gray-300 py-2 px-4 text-center min-w-[100px] bg-gray-600">계획-전년</th>
                  <th className="border border-gray-300 py-2 px-4 text-center min-w-[120px]">2026년(합계)</th>
                  <th className="border border-gray-300 py-2 px-4 text-center min-w-[100px]">Rolling-전년</th>
                  <th className="border border-gray-300 py-2 px-4 text-center min-w-[120px]">계획대비증감(금액)</th>
                  <th className="border border-gray-300 py-2 px-4 text-center min-w-[100px]">계획대비(%)</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => {
                  const isNetCash = row.key === 'net_cash';
                  const isMajor = row.level === 0 && !isNetCash;
                  const isMedium = row.level === 1;
                  const indentPx = row.level === 0 ? 12 : row.level === 1 ? 36 : 60;

                  return (
                    <tr
                      key={row.key}
                      className={
                        isNetCash
                          ? 'bg-gray-100'
                          : isMajor
                            ? 'bg-sky-100 font-semibold'
                            : isMedium
                              ? 'bg-gray-50'
                              : ''
                      }
                    >
                      <td
                        className={`border border-gray-300 py-2 px-4 sticky left-0 z-10 ${
                          isNetCash ? 'bg-gray-100' : isMajor ? 'bg-sky-100' : isMedium ? 'bg-gray-50' : 'bg-white'
                        }`}
                        style={{ paddingLeft: `${indentPx}px` }}
                      >
                        {row.isGroup ? (
                          <div className="flex items-center gap-1">
                            <span>{row.label}</span>
                            <button
                              type="button"
                              onClick={() => toggle(row.key)}
                              className="text-gray-600 hover:text-gray-900 p-0.5 leading-none"
                            >
                              {collapsed.has(row.key) ? '▸' : '▾'}
                            </button>
                          </div>
                        ) : (
                          row.label
                        )}
                      </td>
                      <td className="border border-gray-300 py-2 px-4 text-right">{formatActual(row.actual2025)}</td>
                      <td className="border border-gray-300 py-2 px-4 text-right">{cfPlan(row.key) != null ? formatActual(cfPlan(row.key)) : '-'}</td>
                      <td className={`border border-gray-300 py-2 px-4 text-right ${(cfPlanVsPrev(row) ?? 0) < 0 ? 'text-red-500' : ''}`}>{formatDiffActual(cfPlanVsPrev(row))}</td>
                      {!monthsCollapsed && PL_CF_MONTH_LABELS.map((month, monthIndex) => {
                        const monthValue = cfMonthly(row.key, monthIndex);
                        return (
                          <td
                            key={`cf-cell-${row.key}-${month}`}
                            className={`border border-gray-300 py-2 px-4 text-right ${monthValue == null ? 'text-gray-300' : ''}`}
                          >
                            {monthValue == null ? '-' : formatActual(monthValue)}
                          </td>
                        );
                      })}
                      <td className="border border-gray-300 py-2 px-4 text-right">{formatActual(cf2026(row.key))}</td>
                      <td className={`border border-gray-300 py-2 px-4 text-right ${(cfYoy(row) ?? 0) < 0 ? 'text-red-500' : ''}`}>{formatDiffActual(cfYoy(row))}</td>
                      <td className={`border border-gray-300 py-2 px-4 text-right ${(cfPlanVsRollingAmount(row.key) ?? 0) < 0 ? 'text-red-500' : ''}`}>{formatDiffActual(cfPlanVsRollingAmount(row.key))}</td>
                      <td className="border border-gray-300 py-2 px-4 text-right">{cfPlanVsRollingPct(row.key)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-8">
            <h3 className="text-base font-semibold text-gray-800 mb-2">현금잔액과 차입금잔액표</h3>
            <div className="overflow-x-auto border border-gray-300 rounded-lg shadow-sm">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-navy text-white">
                  <tr>
                    <th rowSpan={2} className="border border-gray-300 py-2.5 px-4 text-left sticky left-0 z-10 bg-navy min-w-[200px]">구분</th>
                    <th rowSpan={2} className="border border-gray-300 py-2.5 px-4 text-center min-w-[120px]">기초잔액</th>
                    <th colSpan={2} className="border border-gray-300 py-1.5 px-4 text-center bg-gray-600">계획</th>
                    {!monthsCollapsed && PL_CF_MONTH_LABELS.map((month) => (
                      <th key={`balance-header-${month}`} rowSpan={2} className="border border-gray-300 py-2.5 px-4 text-center min-w-[84px]">
                        {month}
                      </th>
                    ))}
                    <th colSpan={4} className="border border-gray-300 py-1.5 px-4 text-center">2026년 Rolling</th>
                  </tr>
                  <tr>
                    <th className="border border-gray-300 py-1.5 px-4 text-center min-w-[120px] bg-gray-600">2026년(계획)</th>
                    <th className="border border-gray-300 py-1.5 px-4 text-center min-w-[100px] bg-gray-600">계획-전년</th>
                    <th className="border border-gray-300 py-1.5 px-4 text-center min-w-[120px]">기말잔액</th>
                    <th className="border border-gray-300 py-1.5 px-4 text-center min-w-[100px]">Rolling-전년</th>
                    <th className="border border-gray-300 py-1.5 px-4 text-center min-w-[120px]">계획대비증감(금액)</th>
                    <th className="border border-gray-300 py-1.5 px-4 text-center min-w-[100px]">계획대비(%)</th>
                  </tr>
                </thead>
                <tbody className="bg-gray-50">
                  <tr>
                    <td className="border border-gray-300 py-2 px-4 font-medium sticky left-0 z-10 bg-gray-100 text-gray-800">현금잔액</td>
                    <td className="border border-gray-300 py-2 px-4 text-right bg-gray-50">{formatActual(cashBorrowingOpening('cash'))}</td>
                    <td className="border border-gray-300 py-2 px-4 text-right bg-gray-50">{cashDebtPlanValue('cash') != null ? formatActual(cashDebtPlanValue('cash')) : '-'}</td>
                    <td className={`border border-gray-300 py-2 px-4 text-right bg-gray-50 ${(cashDebtPlanVsPrev('cash') ?? 0) < 0 ? 'text-red-500' : ''}`}>{formatDiffActual(cashDebtPlanVsPrev('cash'))}</td>
                    {!monthsCollapsed && PL_CF_MONTH_LABELS.map((month, monthIndex) => {
                      const monthValue = cashBorrowingMonthly('cash', monthIndex);
                      return (
                        <td key={`cash-cell-${month}`} className={`border border-gray-300 py-2 px-4 text-right bg-gray-50 ${monthValue == null ? 'text-gray-300' : ''}`}>
                          {monthValue == null ? '-' : formatActual(monthValue)}
                        </td>
                      );
                    })}
                    <td className="border border-gray-300 py-2 px-4 text-right bg-gray-50">{formatActual(cashBorrowing2026('cash'))}</td>
                    <td className={`border border-gray-300 py-2 px-4 text-right bg-gray-50 ${(cashBorrowingYoy('cash') ?? 0) < 0 ? 'text-red-500' : ''}`}>{formatDiffActual(cashBorrowingYoy('cash'))}</td>
                    <td className={`border border-gray-300 py-2 px-4 text-right bg-gray-50 ${(cashDebtVsRollingAmount('cash') ?? 0) < 0 ? 'text-red-500' : ''}`}>{formatDiffActual(cashDebtVsRollingAmount('cash'))}</td>
                    <td className="border border-gray-300 py-2 px-4 text-right bg-gray-50">{cashDebtVsRollingPct('cash')}</td>
                  </tr>
                  <tr>
                    <td className="border border-gray-300 py-2 px-4 font-medium sticky left-0 z-10 bg-gray-100 text-gray-800">차입금잔액</td>
                    <td className="border border-gray-300 py-2 px-4 text-right bg-gray-50">{formatActual(cashBorrowingOpening('borrowing'))}</td>
                    <td className="border border-gray-300 py-2 px-4 text-right bg-gray-50">{cashDebtPlanValue('borrowing') != null ? formatActual(cashDebtPlanValue('borrowing')) : '-'}</td>
                    <td className={`border border-gray-300 py-2 px-4 text-right bg-gray-50 ${(cashDebtPlanVsPrev('borrowing') ?? 0) < 0 ? 'text-red-500' : ''}`}>{formatDiffActual(cashDebtPlanVsPrev('borrowing'))}</td>
                    {!monthsCollapsed && PL_CF_MONTH_LABELS.map((month, monthIndex) => {
                      const monthValue = cashBorrowingMonthly('borrowing', monthIndex);
                      return (
                        <td
                          key={`borrowing-cell-${month}`}
                          className={`border border-gray-300 py-2 px-4 text-right bg-gray-50 ${monthValue == null ? 'text-gray-300' : ''}`}
                        >
                          {monthValue == null ? '-' : formatActual(monthValue)}
                        </td>
                      );
                    })}
                    <td className="border border-gray-300 py-2 px-4 text-right bg-gray-50">{formatActual(cashBorrowing2026('borrowing'))}</td>
                    <td className={`border border-gray-300 py-2 px-4 text-right bg-gray-50 ${(cashBorrowingYoy('borrowing') ?? 0) < 0 ? 'text-red-500' : ''}`}>{formatDiffActual(cashBorrowingYoy('borrowing'))}</td>
                    <td className={`border border-gray-300 py-2 px-4 text-right bg-gray-50 ${(cashDebtVsRollingAmount('borrowing') ?? 0) < 0 ? 'text-red-500' : ''}`}>{formatDiffActual(cashDebtVsRollingAmount('borrowing'))}</td>
                    <td className="border border-gray-300 py-2 px-4 text-right bg-gray-50">{cashDebtVsRollingPct('borrowing')}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-8">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-base font-semibold text-gray-800">운전자본표</h3>
              <button
                type="button"
                onClick={toggleAllWC}
                className="px-3 py-1 text-xs font-medium rounded-md bg-gray-100 text-gray-700 border border-gray-300 hover:bg-gray-200 transition-colors"
              >
                {isWcAllCollapsed ? '전체 펼치기' : '전체 접기'}
              </button>
            </div>
            <div className="overflow-x-auto border border-gray-300 rounded-lg shadow-sm">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-navy text-white">
                  <tr>
                    <th rowSpan={2} className="border border-gray-300 py-3 px-4 text-left sticky left-0 z-20 bg-navy min-w-[200px]">계정과목</th>
                    <th rowSpan={2} className="border border-gray-300 py-3 px-4 text-center min-w-[120px]">2025년(기말)</th>
                    <th colSpan={2} className="border border-gray-300 py-2 px-4 text-center bg-gray-600">계획</th>
                    {!monthsCollapsed && PL_CF_MONTH_LABELS.map((month, monthIndex) => (
                      <th key={`wc-header-${month}`} rowSpan={2} className="border border-gray-300 py-3 px-4 text-center min-w-[84px]">
                        {formatWorkingCapitalMonthHeader(month, monthIndex)}
                      </th>
                    ))}
                    <th colSpan={4} className="border border-gray-300 py-2 px-4 text-center">2026년 Rolling</th>
                  </tr>
                  <tr>
                    <th className="border border-gray-300 py-2 px-4 text-center min-w-[120px] bg-gray-600">2026년(계획)</th>
                    <th className="border border-gray-300 py-2 px-4 text-center min-w-[100px] bg-gray-600">계획-전년</th>
                    <th className="border border-gray-300 py-2 px-4 text-center min-w-[120px]">2026년(기말)</th>
                    <th className="border border-gray-300 py-2 px-4 text-center min-w-[100px]">Rolling-전년</th>
                    <th className="border border-gray-300 py-2 px-4 text-center min-w-[120px]">계획대비증감(금액)</th>
                    <th className="border border-gray-300 py-2 px-4 text-center min-w-[100px]">계획대비(%)</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleWorkingCapitalRows.map((row) => {
                    const isTotal = row.key === 'wc_total';
                    const isMonthDiff = row.key === 'wc_mom';
                    const isLevel1 = !isTotal && !isMonthDiff && row.level === 1;
                    const cellBg = isTotal ? 'bg-yellow-50' : isLevel1 ? 'bg-sky-100' : isMonthDiff ? 'bg-gray-100' : 'bg-white';
                    const indentPx = row.level === 2 ? 36 : 12;

                    return (
                      <tr key={row.key} className={cellBg + (isTotal || isLevel1 ? ' font-semibold' : '')}>
                        <td
                          className={`border border-gray-300 py-2 px-4 sticky left-0 z-10 ${cellBg}`}
                          style={{ paddingLeft: `${indentPx}px` }}
                        >
                          {row.isGroup ? (
                            <div className="flex items-center gap-1">
                              <span>{row.label}</span>
                              <button
                                type="button"
                                onClick={() => toggleWorkingCapital(row.key)}
                                className="text-gray-600 hover:text-gray-900 p-0.5 leading-none"
                              >
                                {wcCollapsed.has(row.key) ? '▸' : '▾'}
                              </button>
                            </div>
                          ) : (
                            row.label
                          )}
                        </td>
                        <td className={`border border-gray-300 py-2 px-4 text-right ${cellBg}`}>{formatActual(row.actual2025)}</td>
                        <td className={`border border-gray-300 py-2 px-4 text-right ${cellBg}`}>{wcPlanK(row.key) != null ? formatKValue(wcPlanK(row.key)) : '-'}</td>
                        <td className={`border border-gray-300 py-2 px-4 text-right ${cellBg} ${(wcPlanVsPrev(row) ?? 0) < 0 ? 'text-red-500' : ''}`}>{formatDiffK(wcPlanVsPrev(row))}</td>
                        {!monthsCollapsed && PL_CF_MONTH_LABELS.map((month, monthIndex) => {
                          const monthValue = workingCapitalMonthly(row.key, monthIndex);
                          return (
                            <td key={`wc-cell-${row.key}-${month}`} className={`border border-gray-300 py-2 px-4 text-right ${monthValue == null ? 'text-gray-300' : ''} ${cellBg}`}>
                              {monthValue == null ? '-' : formatKValue(monthValue)}
                            </td>
                          );
                        })}
                        <td className={`border border-gray-300 py-2 px-4 text-right ${cellBg}`}>{formatKValue(workingCapital2026(row.key))}</td>
                        <td className={`border border-gray-300 py-2 px-4 text-right ${cellBg} ${(workingCapitalYoy(row) ?? 0) < 0 ? 'text-red-500' : ''}`}>{formatDiffK(workingCapitalYoy(row))}</td>
                        <td className={`border border-gray-300 py-2 px-4 text-right ${cellBg} ${(wcPlanVsRollingAmount(row.key) ?? 0) < 0 ? 'text-red-500' : ''}`}>{formatDiffK(wcPlanVsRollingAmount(row.key))}</td>
                        <td className={`border border-gray-300 py-2 px-4 text-right ${cellBg}`}>{wcPlanVsRollingPct(row.key)}</td>
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
                className="px-3 py-1 text-xs font-medium rounded-md bg-gray-100 text-gray-700 border border-gray-300 hover:bg-gray-200 transition-colors"
              >
                {wcLegendCollapsed ? '범례 펼치기' : '범례 접기'}
              </button>
              <button
                type="button"
                onClick={() => setWcSupportCollapsed((prev) => !prev)}
                className="px-3 py-1 text-xs font-medium rounded-md bg-gray-100 text-gray-700 border border-gray-300 hover:bg-gray-200 transition-colors"
              >
                {wcSupportCollapsed ? '보조지표 펼치기' : '보조지표 접기'}
              </button>
            </div>
            {!wcSupportCollapsed && (
            <div className="mt-3 overflow-x-auto border border-gray-300 rounded-lg shadow-sm">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-slate-700 text-white">
                  <tr>
                    <th className="border border-gray-300 py-2.5 px-4 text-left min-w-[180px]">항목</th>
                    {PL_CF_MONTH_LABELS.map((month, monthIndex) => (
                      <th
                        key={`wc-support-header-${month}`}
                        className="border border-gray-300 py-2.5 px-4 text-center min-w-[84px]"
                      >
                        {formatWorkingCapitalMonthHeader(month, monthIndex)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="bg-slate-100 font-semibold">
                    <td className="border border-gray-300 py-2 px-4 text-slate-800">Tag재고 합계</td>
                    {PL_CF_MONTH_LABELS.map((month, monthIndex) => {
                      const total = TAG_COST_RATIO_BRANDS.reduce<number | null>((sum, brand) => {
                        const value = toDisplayK(inventoryMonthlyTotals[brand][monthIndex] ?? null);
                        if (value == null) return sum;
                        return (sum ?? 0) + value;
                      }, null);
                      return (
                        <td
                          key={`tag-inventory-group-${month}`}
                          className={`border border-gray-300 py-2 px-4 text-right ${total == null ? 'text-gray-300' : 'text-slate-800'}`}
                        >
                          {total == null ? '-' : formatKValue(total)}
                        </td>
                      );
                    })}
                  </tr>
                  {TAG_COST_RATIO_BRANDS.map((brand) => (
                    <tr key={`tag-inventory-row-${brand}`} className="bg-slate-50">
                      <td className="border border-gray-300 py-2 px-4 text-slate-800" style={{ paddingLeft: '28px' }}>
                        {brand}
                      </td>
                      {PL_CF_MONTH_LABELS.map((month, monthIndex) => {
                        const monthValue = toDisplayK(inventoryMonthlyTotals[brand][monthIndex] ?? null);
                        return (
                          <td
                            key={`tag-inventory-value-${brand}-${month}`}
                            className="border border-gray-300 py-2 px-4 text-right text-slate-700"
                          >
                            {monthValue == null ? '-' : formatKValue(monthValue)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr className="bg-slate-100 font-semibold">
                    <td className="border border-gray-300 py-2 px-4 text-slate-800">평가감율</td>
                    {PL_CF_MONTH_LABELS.map((month) => (
                      <td
                        key={`valuation-rate-group-${month}`}
                        className="border border-gray-300 py-2 px-4 text-center text-gray-300"
                      >
                        -
                      </td>
                    ))}
                  </tr>
                  {TAG_COST_RATIO_BRANDS.map((brand) => (
                    <tr key={`valuation-rate-row-${brand}`} className="bg-slate-50">
                      <td className="border border-gray-300 py-2 px-4 text-slate-800" style={{ paddingLeft: '28px' }}>
                        {brand}
                      </td>
                      {PL_CF_MONTH_LABELS.map((month) => (
                        <td
                          key={`valuation-rate-value-${brand}-${month}`}
                          className="border border-gray-300 py-2 px-4 text-right text-slate-700"
                        >
                          {formatPercent4(VALUATION_REDUCTION_RATE[brand])}
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr className="bg-slate-100 font-semibold">
                    <td className="border border-gray-300 py-2 px-4 text-slate-800">매출채권합계(대리상)</td>
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
                          className={`border border-gray-300 py-2 px-4 text-right ${displayK == null ? 'text-gray-300' : 'text-slate-800'}`}
                        >
                          {displayK == null ? '-' : formatKValue(displayK)}
                        </td>
                      );
                    })}
                  </tr>
                  {TAG_COST_RATIO_BRANDS.map((brand) => (
                    <tr key={`ar-total-row-${brand}`} className="bg-slate-50">
                      <td className="border border-gray-300 py-2 px-4 text-slate-800" style={{ paddingLeft: '28px' }}>
                        {brand}
                      </td>
                      {PL_CF_MONTH_LABELS.map((month, monthIndex) => {
                        const monthValue = shipmentMonthlyByBrand[brand][monthIndex];
                        const displayK = toDisplayK(monthValue);
                        return (
                          <td
                            key={`ar-total-value-${brand}-${month}`}
                            className={`border border-gray-300 py-2 px-4 text-right ${displayK == null ? 'text-gray-300' : 'text-slate-700'}`}
                          >
                            {displayK == null ? '-' : formatKValue(displayK)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr className="bg-slate-100 font-semibold">
                    <td className="border border-gray-300 py-2 px-4 text-slate-800">매입채무합계(HQ)</td>
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
                          className={`border border-gray-300 py-2 px-4 text-right ${displayK == null ? 'text-gray-300' : 'text-slate-800'}`}
                        >
                          {displayK == null ? '-' : formatKValue(displayK)}
                        </td>
                      );
                    })}
                  </tr>
                  {TAG_COST_RATIO_BRANDS.map((brand) => (
                    <tr key={`ap-total-row-${brand}`} className="bg-slate-50">
                      <td className="border border-gray-300 py-2 px-4 text-slate-800" style={{ paddingLeft: '28px' }}>
                        {brand}
                      </td>
                      {PL_CF_MONTH_LABELS.map((month, monthIndex) => {
                        const monthValue = purchaseMonthlyByBrand[brand][monthIndex];
                        const displayK = toDisplayK(monthValue);
                        return (
                          <td
                            key={`ap-total-value-${brand}-${month}`}
                            className={`border border-gray-300 py-2 px-4 text-right ${displayK == null ? 'text-gray-300' : 'text-slate-700'}`}
                          >
                            {displayK == null ? '-' : formatKValue(displayK)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr className="bg-white font-semibold">
                    <td className="border border-gray-300 py-2 px-4 text-slate-800">Tag대비원가율</td>
                    {PL_CF_MONTH_LABELS.map((month) => (
                      <td
                        key={`tag-cost-ratio-group-${month}`}
                        className="border border-gray-300 py-2 px-4 text-center text-gray-300"
                      >
                        -
                      </td>
                    ))}
                  </tr>
                  {TAG_COST_RATIO_BRANDS.map((brand) => (
                    <tr key={`tag-cost-ratio-row-${brand}`} className="bg-white">
                      <td className="border border-gray-300 py-2 px-4 text-slate-800" style={{ paddingLeft: '28px' }}>
                        {brand}
                      </td>
                      {PL_CF_MONTH_LABELS.map((month) => (
                        <td
                          key={`tag-cost-ratio-value-${brand}-${month}`}
                          className="border border-gray-300 py-2 px-4 text-right text-slate-700"
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
            <div className="overflow-x-auto border border-gray-300 rounded-lg shadow-sm">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-navy text-white">
                  <tr>
                    <th className="border border-gray-300 py-3 px-4 text-center min-w-[100px]">대리상선수금</th>
                    <th className="border border-gray-300 py-3 px-4 text-center min-w-[100px]">대리상 채권</th>
                    {creditRecoveryHeaders.map((header) => (
                      <th key={header} className="border border-gray-300 py-3 px-4 text-center min-w-[100px]">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-gray-50">
                  <tr>
                    <td className="border border-gray-300 py-2 px-4 text-right">{formatActual(creditRecovery.dealerAdvance)}</td>
                    <td className="border border-gray-300 py-2 px-4 text-right">{formatActual(creditRecovery.dealerReceivable)}</td>
                    {creditRecovery.recoveries.map((value, index) => (
                      <td key={`credit-recovery-${index}`} className="border border-gray-300 py-2 px-4 text-right">
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


