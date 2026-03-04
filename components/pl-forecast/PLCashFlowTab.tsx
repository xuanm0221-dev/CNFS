'use client';

import { useEffect, useMemo, useState } from 'react';
import { formatNumber } from '@/lib/utils';
import CFExplanationPanel from '@/components/CFExplanationPanel';

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

const INVENTORY_HQ_CLOSING_KEY = 'inventory_hq_closing_totals';
const INVENTORY_MONTHLY_TOTAL_KEY = 'inventory_monthly_total_closing';
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

const STATIC_CREDIT_RECOVERY = {
  baseYearMonth: '26.01',
  dealerAdvance: 394146000,
  dealerReceivable: 801026000,
  headers: ['2월', '3월', '4월'],
};

const TAG_COST_RATIO_BRANDS = ['MLB', 'MLB KIDS', 'DISCOVERY'] as const;
const PL_CF_MONTH_LABELS = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'] as const;

export default function PLCashFlowTab() {
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
    new Set(['operating', 'operating_receipts', 'operating_payments', 'operating_expenses', 'capex']),
  );
  const [allCollapsed, setAllCollapsed] = useState(true);
  const [monthsCollapsed, setMonthsCollapsed] = useState(true);
  const [wcCollapsed, setWcCollapsed] = useState<Set<string>>(new Set(['wc_ar', 'wc_inventory', 'wc_ap']));
  const [wcSupportCollapsed, setWcSupportCollapsed] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const readStored = (payload?: unknown) => {
      const source = payload ?? window.localStorage.getItem(INVENTORY_HQ_CLOSING_KEY);
      if (!source) return;
      try {
        const parsed = typeof source === 'string' ? JSON.parse(source) : source;
        if (!parsed || typeof parsed !== 'object' || !('values' in parsed)) return;
        const values = (parsed as { values?: Record<string, unknown> }).values;
        if (!values) return;
        setInventoryHqClosing({
          MLB: Number(values.MLB) || 0,
          'MLB KIDS': Number(values['MLB KIDS']) || 0,
          DISCOVERY: Number(values.DISCOVERY) || 0,
        });
        setInventoryHqLoaded(true);
      } catch {
        // ignore malformed payloads
      }
    };

    readStored();
    const handleUpdate = (event: Event) => {
      readStored((event as CustomEvent).detail);
    };

    window.addEventListener('inventory-hq-closing-updated', handleUpdate as EventListener);
    return () => {
      window.removeEventListener('inventory-hq-closing-updated', handleUpdate as EventListener);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const readStored = (payload?: unknown) => {
      const source = payload ?? window.localStorage.getItem(INVENTORY_MONTHLY_TOTAL_KEY);
      if (!source) return;
      try {
        const parsed = typeof source === 'string' ? JSON.parse(source) : source;
        if (!parsed || typeof parsed !== 'object' || !('values' in parsed)) return;
        const values = (parsed as { values?: Record<string, unknown> }).values;
        if (!values) return;
        setInventoryMonthlyTotals({
          MLB: Array.isArray(values.MLB) ? (values.MLB as (number | null)[]) : new Array(12).fill(null),
          'MLB KIDS': Array.isArray(values['MLB KIDS']) ? (values['MLB KIDS'] as (number | null)[]) : new Array(12).fill(null),
          DISCOVERY: Array.isArray(values.DISCOVERY) ? (values.DISCOVERY as (number | null)[]) : new Array(12).fill(null),
        });
        setInventoryMonthlyLoaded(true);
      } catch {
        // ignore malformed payloads
      }
    };

    readStored();
    const handleUpdate = (event: Event) => {
      readStored((event as CustomEvent).detail);
    };

    window.addEventListener('inventory-monthly-total-updated', handleUpdate as EventListener);
    return () => {
      window.removeEventListener('inventory-monthly-total-updated', handleUpdate as EventListener);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const readStored = (payload?: unknown) => {
      const source = payload ?? window.localStorage.getItem(PL_TAG_COST_RATIO_KEY);
      if (!source) return;
      try {
        const parsed = typeof source === 'string' ? JSON.parse(source) : source;
        if (!parsed || typeof parsed !== 'object' || !('values' in parsed)) return;
        const values = (parsed as { values?: Record<string, unknown> }).values;
        if (!values) return;
        setTagCostRatio({
          MLB: values.MLB == null ? null : Number(values.MLB),
          'MLB KIDS': values['MLB KIDS'] == null ? null : Number(values['MLB KIDS']),
          DISCOVERY: values.DISCOVERY == null ? null : Number(values.DISCOVERY),
        });
        setTagCostRatioLoaded(true);
      } catch {
        // ignore malformed payloads
      }
    };

    readStored();
    const handleUpdate = (event: Event) => {
      readStored((event as CustomEvent).detail);
    };

    window.addEventListener('pl-tag-cost-ratio-updated', handleUpdate as EventListener);
    return () => {
      window.removeEventListener('pl-tag-cost-ratio-updated', handleUpdate as EventListener);
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

  const toggleAll = () => {
    if (allCollapsed) {
      setCollapsed(new Set());
      setAllCollapsed(false);
      return;
    }

    setCollapsed(new Set(['operating', 'operating_receipts', 'operating_payments', 'operating_expenses', 'capex']));
    setAllCollapsed(true);
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

  const formatPercent4 = (value: number | null | undefined) => {
    if (value == null) return '';
    return `${(value * 100).toFixed(4)}%`;
  };

  const toDisplayK = (value: number | null | undefined) => {
    if (value == null) return null;
    return Math.round(value / 1000);
  };

  const cf2026 = (_rowKey: string): number | null => null;

  const cfYoy = (row: StaticCFRow): number | null => {
    const current = cf2026(row.key);
    const actualK = toDisplayK(row.actual2025);
    if (current == null || actualK == null) return null;
    return current - actualK;
  };

  const cashBorrowing2026 = (_rowKey: 'cash' | 'borrowing'): number | null => null;

  const cashBorrowingYoy = (rowKey: 'cash' | 'borrowing', actual2025: number): number | null => {
    const current = cashBorrowing2026(rowKey);
    const actualK = toDisplayK(actual2025);
    if (current == null || actualK == null) return null;
    return current - actualK;
  };

  const workingCapital2026 = (rowKey: string): number | null => {
    const arDirect = 0;
    const arDealer = 0;
    const inventoryMlbTag = inventoryHqClosing.MLB || 0;
    const inventoryKidsTag = inventoryHqClosing['MLB KIDS'] || 0;
    const inventoryDiscoveryTag = inventoryHqClosing.DISCOVERY || 0;
    const inventoryMlb = inventoryMlbTag === 0 || tagCostRatio.MLB == null ? 0 : (inventoryMlbTag / 1.13) * tagCostRatio.MLB;
    const inventoryKids =
      inventoryKidsTag === 0 || tagCostRatio['MLB KIDS'] == null ? 0 : (inventoryKidsTag / 1.13) * tagCostRatio['MLB KIDS'];
    const inventoryDiscovery =
      inventoryDiscoveryTag === 0 || tagCostRatio.DISCOVERY == null ? 0 : (inventoryDiscoveryTag / 1.13) * tagCostRatio.DISCOVERY;
    const apHq = 0;
    const apGoods = 0;

    if (rowKey === 'wc_total') {
      return arDirect + arDealer + inventoryMlb + inventoryKids + inventoryDiscovery + apHq + apGoods;
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
    const mlbTag = toDisplayK(inventoryMonthlyTotals.MLB[monthIndex] ?? null);
    const kidsTag = toDisplayK(inventoryMonthlyTotals['MLB KIDS'][monthIndex] ?? null);
    const discoveryTag = toDisplayK(inventoryMonthlyTotals.DISCOVERY[monthIndex] ?? null);
    const mlb =
      mlbTag == null || mlbTag === 0 || tagCostRatio.MLB == null
        ? null
        : (mlbTag / 1.13) * tagCostRatio.MLB;
    const kids =
      kidsTag == null || kidsTag === 0 || tagCostRatio['MLB KIDS'] == null
        ? null
        : (kidsTag / 1.13) * tagCostRatio['MLB KIDS'];
    const discovery =
      discoveryTag == null || discoveryTag === 0 || tagCostRatio.DISCOVERY == null
        ? null
        : (discoveryTag / 1.13) * tagCostRatio.DISCOVERY;
    const total = [mlb, kids, discovery].reduce<number | null>((sum, value) => {
      if (value == null) return sum;
      return (sum ?? 0) + value;
    }, null);

    if (rowKey === 'wc_inventory') return total;
    if (rowKey === 'wc_inventory_mlb') return mlb;
    if (rowKey === 'wc_inventory_kids') return kids;
    if (rowKey === 'wc_inventory_discovery') return discovery;
    return null;
  };

  const cfInputsLoaded = tagCostRatioLoaded && inventoryHqLoaded && inventoryMonthlyLoaded;
  const loadStatusLabel = cfInputsLoaded ? '로딩완료' : '로딩중';
  const loadStatusClassName = cfInputsLoaded
    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
    : 'bg-amber-50 text-amber-700 border border-amber-200';

  return (
    <div>
      <div className="bg-gray-100 border-b border-gray-300">
        <div className="flex items-center gap-3 px-6 py-3">
          <span className="text-sm font-medium text-gray-700">2026년 현금흐름표 양식</span>
          <button
            type="button"
            onClick={toggleAll}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-200 text-gray-700 hover:bg-gray-300 transition-colors shadow-sm"
          >
            {allCollapsed ? '전체 펼치기' : '전체 접기'}
          </button>
          <button
            type="button"
            onClick={() => setMonthsCollapsed((prev) => !prev)}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-200 text-gray-700 hover:bg-gray-300 transition-colors shadow-sm"
          >
            {monthsCollapsed ? '월별 펼치기' : '월별 접기'}
          </button>
          <span className={`px-3 py-1 text-xs font-medium rounded-full ${loadStatusClassName}`}>{loadStatusLabel}</span>
        </div>
      </div>

        <div className="flex flex-1 min-h-0">
          <div className={`${monthsCollapsed ? 'w-1/3' : 'flex-1'} min-w-0 overflow-auto p-6`}>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-lg font-bold text-gray-900">현금흐름표</h2>
          </div>

          <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 220px)' }}>
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-20 bg-navy text-white">
                <tr>
                  <th className="border border-gray-300 py-3 px-4 text-left sticky left-0 z-30 bg-navy min-w-[220px]">
                    계정과목
                  </th>
                  <th className="border border-gray-300 py-3 px-4 text-center min-w-[120px]">2025년(합계)</th>
                  {!monthsCollapsed && PL_CF_MONTH_LABELS.map((month) => (
                    <th key={`cf-header-${month}`} className="border border-gray-300 py-3 px-4 text-center min-w-[84px]">
                      {month}
                    </th>
                  ))}
                  <th className="border border-gray-300 py-3 px-4 text-center min-w-[120px]">2026년(합계)</th>
                  <th className="border border-gray-300 py-3 px-4 text-center min-w-[100px]">YoY</th>
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
                      {!monthsCollapsed && PL_CF_MONTH_LABELS.map((month) => (
                        <td key={`cf-cell-${row.key}-${month}`} className="border border-gray-300 py-2 px-4 text-right text-gray-300">
                          -
                        </td>
                      ))}
                      <td className="border border-gray-300 py-2 px-4 text-right">{formatKValue(cf2026(row.key))}</td>
                      <td className="border border-gray-300 py-2 px-4 text-right">{formatKValue(cfYoy(row))}</td>
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
                    <th className="border border-gray-300 py-2.5 px-4 text-left sticky left-0 z-10 bg-navy min-w-[200px]">구분</th>
                    <th className="border border-gray-300 py-2.5 px-4 text-center min-w-[120px]">기초잔액</th>
                    {!monthsCollapsed && PL_CF_MONTH_LABELS.map((month) => (
                      <th key={`balance-header-${month}`} className="border border-gray-300 py-2.5 px-4 text-center min-w-[84px]">
                        {month}
                      </th>
                    ))}
                    <th className="border border-gray-300 py-2.5 px-4 text-center min-w-[120px]">기말잔액</th>
                    <th className="border border-gray-300 py-2.5 px-4 text-center min-w-[100px]">YoY</th>
                  </tr>
                </thead>
                <tbody className="bg-gray-50">
                  <tr>
                    <td className="border border-gray-300 py-2 px-4 font-medium sticky left-0 z-10 bg-gray-100 text-gray-800">현금잔액</td>
                    <td className="border border-gray-300 py-2 px-4 text-right bg-gray-50">{formatActual(STATIC_CASH_BORROWING.cashOpening)}</td>
                    {!monthsCollapsed && PL_CF_MONTH_LABELS.map((month) => (
                      <td key={`cash-cell-${month}`} className="border border-gray-300 py-2 px-4 text-right bg-gray-50 text-gray-300">
                        -
                      </td>
                    ))}
                    <td className="border border-gray-300 py-2 px-4 text-right bg-gray-50">{formatKValue(cashBorrowing2026('cash'))}</td>
                    <td className="border border-gray-300 py-2 px-4 text-right bg-gray-50">{formatKValue(cashBorrowingYoy('cash', STATIC_CASH_BORROWING.cashOpening))}</td>
                  </tr>
                  <tr>
                    <td className="border border-gray-300 py-2 px-4 font-medium sticky left-0 z-10 bg-gray-100 text-gray-800">차입금잔액</td>
                    <td className="border border-gray-300 py-2 px-4 text-right bg-gray-50">{formatActual(STATIC_CASH_BORROWING.borrowingOpening)}</td>
                    {!monthsCollapsed && PL_CF_MONTH_LABELS.map((month) => (
                      <td key={`borrowing-cell-${month}`} className="border border-gray-300 py-2 px-4 text-right bg-gray-50 text-gray-300">
                        -
                      </td>
                    ))}
                    <td className="border border-gray-300 py-2 px-4 text-right bg-gray-50">{formatKValue(cashBorrowing2026('borrowing'))}</td>
                    <td className="border border-gray-300 py-2 px-4 text-right bg-gray-50">{formatKValue(cashBorrowingYoy('borrowing', STATIC_CASH_BORROWING.borrowingOpening))}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-8">
            <h3 className="text-base font-semibold text-gray-800 mb-2">운전자본표</h3>
            <div className="overflow-x-auto border border-gray-300 rounded-lg shadow-sm">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-navy text-white">
                  <tr>
                    <th className="border border-gray-300 py-3 px-4 text-left sticky left-0 z-20 bg-navy min-w-[200px]">계정과목</th>
                    <th className="border border-gray-300 py-3 px-4 text-center min-w-[120px]">2025년(기말)</th>
                    {!monthsCollapsed && PL_CF_MONTH_LABELS.map((month) => (
                      <th key={`wc-header-${month}`} className="border border-gray-300 py-3 px-4 text-center min-w-[84px]">
                        {month}
                      </th>
                    ))}
                    <th className="border border-gray-300 py-3 px-4 text-center min-w-[120px]">2026년(기말)</th>
                    <th className="border border-gray-300 py-3 px-4 text-center min-w-[100px]">YoY</th>
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
                        {!monthsCollapsed && PL_CF_MONTH_LABELS.map((month, monthIndex) => {
                          const monthValue = workingCapitalMonthly(row.key, monthIndex);
                          return (
                            <td key={`wc-cell-${row.key}-${month}`} className={`border border-gray-300 py-2 px-4 text-right ${monthValue == null ? 'text-gray-300' : ''} ${cellBg}`}>
                              {monthValue == null ? '-' : formatKValue(monthValue)}
                            </td>
                          );
                        })}
                        <td className={`border border-gray-300 py-2 px-4 text-right ${cellBg}`}>{formatKValue(workingCapital2026(row.key))}</td>
                        <td className={`border border-gray-300 py-2 px-4 text-right ${cellBg}`}>{formatKValue(workingCapitalYoy(row))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex justify-end">
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
                    {PL_CF_MONTH_LABELS.map((month) => (
                      <th
                        key={`wc-support-header-${month}`}
                        className="border border-gray-300 py-2.5 px-4 text-center min-w-[84px]"
                      >
                        {month}
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
            <h3 className="text-base font-semibold text-gray-800 mb-2">대리상 여신회수 계획 ({STATIC_CREDIT_RECOVERY.baseYearMonth} 기준)</h3>
            <div className="overflow-x-auto border border-gray-300 rounded-lg shadow-sm">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-navy text-white">
                  <tr>
                    <th className="border border-gray-300 py-3 px-4 text-center min-w-[100px]">대리상선수금</th>
                    <th className="border border-gray-300 py-3 px-4 text-center min-w-[100px]">대리상 채권</th>
                    {STATIC_CREDIT_RECOVERY.headers.map((header) => (
                      <th key={header} className="border border-gray-300 py-3 px-4 text-center min-w-[100px]">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-gray-50">
                  <tr>
                    <td className="border border-gray-300 py-2 px-4 text-right">{formatActual(STATIC_CREDIT_RECOVERY.dealerAdvance)}</td>
                    <td className="border border-gray-300 py-2 px-4 text-right">{formatActual(STATIC_CREDIT_RECOVERY.dealerReceivable)}</td>
                    {STATIC_CREDIT_RECOVERY.headers.map((header) => (
                      <td key={header} className="border border-gray-300 py-2 px-4 text-right"></td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

          {monthsCollapsed && (
            <div className="flex-1 min-w-0 overflow-auto p-6 border-l border-gray-200">
              <CFExplanationPanel year={2026} />
            </div>
          )}
        </div>
    </div>
  );
}
