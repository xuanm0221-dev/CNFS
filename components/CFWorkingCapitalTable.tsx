'use client';

import { useState, useMemo } from 'react';
import { formatNumber } from '@/lib/utils';
import type { TableRow } from '@/lib/types';

const WC_ACCOUNTS = [
  '운전자본',
  '외상매출금',
  '직영AR',
  '대리상AR',
  '재고자산',
  'MLB',
  'KIDS',
  'DISCOVERY',
  '외상매입금',
  '본사AP',
  '제품AP',
] as const;

interface CFWorkingCapitalTableProps {
  rows: TableRow[];
  monthsCollapsed?: boolean;
  onMonthsToggle?: () => void;
  planMonth?: number | null;
}

export default function CFWorkingCapitalTable({
  rows,
  monthsCollapsed = true,
  planMonth,
}: CFWorkingCapitalTableProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(['외상매출금', '외상매입금', '재고자산']));

  const filtered = useMemo(() => rows.filter((r) => WC_ACCOUNTS.includes(r.account as any)), [rows]);

  const getRow = (account: string) => filtered.find((r) => r.account === account);

  const columnLabels = useMemo(() => {
    const base = ['2025년(기말)', '1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월', '2026년(기말)', 'YoY'];
    return base;
  }, []);

  const hasPlan = planMonth != null;

  // collapsed 2026뷰 값: [2025기말, 전월연간계획, 계획-전년, 2026기말, 예상-전년, 계획대비, 계획대비%]
  const buildPlanValues = (row: TableRow | undefined): (number | null)[] => {
    if (!row) return new Array(7).fill(null);
    const prev2025Annual = row.comparisons?.prevYearAnnual ?? null;
    const curr2026Annual = row.comparisons?.currYearAnnual ?? null;
    const annualYoY = row.comparisons?.annualYoY ?? null;
    // 전월 연간 계획 = annualPlan (연간합계(계획) 컬럼)
    const annualPlan = row.comparisons?.annualPlan ?? null;
    // 계획-전년: 전월계획 - 2025년기말
    const planVsPrev = annualPlan != null && prev2025Annual != null ? annualPlan - prev2025Annual : null;
    // 계획 대비: 당월예상(기말) - 전월계획
    const nDiff = curr2026Annual != null && annualPlan != null ? curr2026Annual - annualPlan : null;
    const nPct = nDiff != null && annualPlan != null && annualPlan !== 0 ? (nDiff / Math.abs(annualPlan)) * 100 : null;
    return [prev2025Annual, annualPlan, planVsPrev, curr2026Annual, annualYoY, nDiff, nPct];
  };

  const buildRowValues = (row: TableRow | undefined): (number | null)[] => {
    if (!row) return columnLabels.map(() => null);
    const prev = row.comparisons?.prevYearAnnual ?? null;
    const curr = row.comparisons?.currYearAnnual ?? null;
    const yoy = row.comparisons?.annualYoY ?? null;
    const vals = row.values ?? [];
    return [
      prev,
      ...vals.slice(0, 12),
      curr,
      yoy,
    ];
  };

  const 운전자본Values = useMemo(() => buildRowValues(getRow('운전자본')), [filtered, getRow]);
  const year2024Value = getRow('운전자본')?.year2024Value ?? null; // 2024년(기말) — 2025년(기말) 전월대비용
  const 전월대비Values = useMemo(() => {
    const v = 운전자본Values;
    const out: (number | null)[] = [];
    for (let i = 0; i < 15; i++) {
      if (i === 0) {
        // 2025년(기말) 전월대비 = 2025년(기말) − 2024년(기말)
        if (v[0] != null && year2024Value != null) out.push(v[0] - year2024Value);
        else out.push(null);
      } else if (i >= 1 && i <= 12) {
        const prev = v[i - 1];
        const curr = v[i];
        if (prev != null && curr != null) out.push(curr - prev);
        else out.push(null);
      } else if (i === 13) {
        const prev = v[0]; // 2025년(기말)
        const curr = v[13]; // 2026년(기말)
        if (prev != null && curr != null) out.push(curr - prev);
        else out.push(null);
      } else {
        out.push(null); // YoY 컬럼
      }
    }
    return out;
  }, [운전자본Values, year2024Value]);

  const toggle = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const displayRows = useMemo(() => {
    const result: { account: string; displayName: string; level: number; isGroup: boolean; values: (number | null)[]; children?: { account: string; displayName: string; values: (number | null)[] }[] }[] = [];

    const wcRow = getRow('운전자본');
    if (wcRow) {
      result.push({
        account: '운전자본',
        displayName: '운전자본 합계',
        level: 0,
        isGroup: false,
        values: buildRowValues(wcRow),
        children: undefined,
      });
    }

    result.push({
      account: '_전월대비',
      displayName: '전월대비',
      level: 0,
      isGroup: false,
      values: 전월대비Values,
      children: undefined,
    });

    const 외상매출금Row = getRow('외상매출금');
    if (외상매출금Row) {
      result.push({
        account: '외상매출금',
        displayName: '매출채권',
        level: 1,
        isGroup: true,
        values: buildRowValues(외상매출금Row),
        children: [
          { account: '직영AR', displayName: '직영AR', values: buildRowValues(getRow('직영AR')) },
          { account: '대리상AR', displayName: '대리상AR', values: buildRowValues(getRow('대리상AR')) },
        ],
      });
    }

    const 재고Row = getRow('재고자산');
    if (재고Row) {
      const mlbRow = getRow('MLB');
      const kidsRow = getRow('KIDS');
      const discoveryRow = getRow('DISCOVERY');
      const children = [mlbRow, kidsRow, discoveryRow].filter(Boolean).map((row) => ({
        account: row!.account,
        displayName: row!.account,
        values: buildRowValues(row),
      }));
      result.push({
        account: '재고자산',
        displayName: '재고자산',
        level: 1,
        isGroup: true,
        values: buildRowValues(재고Row),
        children: children.length > 0 ? children : undefined,
      });
    }

    const 외상매입금Row = getRow('외상매입금');
    if (외상매입금Row) {
      result.push({
        account: '외상매입금',
        displayName: '매입채무',
        level: 1,
        isGroup: true,
        values: buildRowValues(외상매입금Row),
        children: [
          { account: '본사AP', displayName: '본사 AP', values: buildRowValues(getRow('본사AP')) },
          { account: '제품AP', displayName: '제품 AP', values: buildRowValues(getRow('제품AP')) },
        ],
      });
    }

    return result;
  }, [filtered, 전월대비Values]);

  const visibleRows = useMemo(() => {
    const list: { account: string; displayName: string; level: number; isGroup: boolean; values: (number | null)[]; isChild?: boolean }[] = [];
    for (const row of displayRows) {
      list.push({
        account: row.account,
        displayName: row.displayName,
        level: row.level,
        isGroup: row.isGroup,
        values: row.values,
        isChild: false,
      });
      if (row.isGroup && row.children && !collapsed.has(row.account)) {
        for (const ch of row.children) {
          list.push({
            account: ch.account,
            displayName: ch.displayName,
            level: row.level + 1,
            isGroup: false,
            values: ch.values,
            isChild: true,
          });
        }
      }
    }
    return list;
  }, [displayRows, collapsed]);

  const formatCell = (value: number | null, index: number, isDiff = false) => {
    if (value === null || value === undefined || (value === 0 && !isDiff && index < 14)) return '-';
    if (isDiff) {
      const sign = value >= 0 ? '+' : '-';
      return `${sign}${formatNumber(Math.abs(value), false, false)}`;
    }
    const isYoy = index === 14;
    if (isYoy) {
      const sign = value >= 0 ? '+' : '-';
      return `${sign}${formatNumber(Math.abs(value), false, false)}`;
    }
    return value < 0 ? `(${formatNumber(Math.abs(value), false, false)})` : formatNumber(value, false, false);
  };

  const cellClass = (value: number | null) => {
    const base = 'border border-gray-300 py-2 px-4 text-right';
    if (value == null) return base;
    return value < 0 ? `${base} text-red-600` : base;
  };

  if (filtered.length === 0) return null;

  return (
    <div className="mt-8">
      <h3 className="text-base font-semibold text-gray-800 mb-2">운전자본표</h3>
      <div className="overflow-x-auto border border-gray-300 rounded-lg shadow-sm">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-navy text-white">
            {monthsCollapsed && hasPlan ? (
              <>
                <tr>
                  <th rowSpan={2} className="border border-gray-300 py-3 px-4 text-left sticky left-0 z-20 bg-navy min-w-[200px]">
                    계정과목
                  </th>
                  <th rowSpan={2} className="border border-gray-300 py-3 px-4 text-center min-w-[120px]">2025년(기말)</th>
                  <th colSpan={2} className="border border-gray-300 py-3 px-4 text-center min-w-[110px] bg-gray-600">전월계획</th>
                  <th colSpan={4} className="border border-gray-300 py-3 px-4 text-center min-w-[110px]">2026년(예상)</th>
                </tr>
                <tr>
                  <th className="border border-gray-300 py-2 px-4 text-center min-w-[110px] bg-gray-600">연간계획</th>
                  <th className="border border-gray-300 py-2 px-4 text-center min-w-[110px] bg-gray-600">계획-전년</th>
                  <th className="border border-gray-300 py-2 px-4 text-center min-w-[110px]">2026년(기말)</th>
                  <th className="border border-gray-300 py-2 px-4 text-center min-w-[100px]">예상-전년</th>
                  <th className="border border-gray-300 py-2 px-4 text-center min-w-[110px]">계획 대비</th>
                  <th className="border border-gray-300 py-2 px-4 text-center min-w-[90px]">계획 대비%</th>
                </tr>
              </>
            ) : (
              <tr>
                <th className="border border-gray-300 py-3 px-4 text-left sticky left-0 z-20 bg-navy min-w-[200px]">
                  계정과목
                </th>
                {monthsCollapsed ? (
                  <>
                    <th className="border border-gray-300 py-3 px-4 text-center min-w-[120px]">
                      {columnLabels[0]}
                    </th>
                    <th className="border border-gray-300 py-3 px-4 text-center min-w-[120px]">
                      {columnLabels[13]}
                    </th>
                    <th className="border border-gray-300 py-3 px-4 text-center min-w-[100px]">{columnLabels[14]}</th>
                  </>
                ) : (
                  columnLabels.map((col, i) => (
                    <th key={i} className="border border-gray-300 py-3 px-4 text-center min-w-[100px]">
                      {col}
                    </th>
                  ))
                )}
              </tr>
            )}
          </thead>
          <tbody>
            {visibleRows.map((row, ri) => {
              const is합계 = row.account === '운전자본';
              const isLevel1 = is합계 || (row.level === 1 && !row.isChild);
              const is전월대비 = row.account === '_전월대비';
              const indentPx = row.isChild ? 36 : 12;
              const rowBg = is합계 ? 'bg-yellow-50 font-semibold' : isLevel1 ? 'bg-sky-100 font-semibold' : is전월대비 ? 'bg-gray-100' : row.isChild ? 'bg-white' : '';

              return (
                <tr key={ri} className={rowBg}>
                  <td
                    className={`border border-gray-300 py-2 px-4 sticky left-0 z-10 ${is합계 ? 'bg-yellow-50' : isLevel1 ? 'bg-sky-100' : is전월대비 ? 'bg-gray-100' : 'bg-white'}`}
                    style={{ paddingLeft: `${indentPx}px` }}
                  >
                    {row.isGroup ? (
                      <div className="flex items-center gap-1">
                        <span>{row.displayName}</span>
                        <button
                          type="button"
                          onClick={() => toggle(row.account)}
                          className="text-gray-600 hover:text-gray-900 p-0.5 leading-none"
                        >
                          {collapsed.has(row.account) ? '▶' : '▼'}
                        </button>
                      </div>
                    ) : (
                      row.displayName
                    )}
                  </td>
                  {monthsCollapsed && hasPlan
                    ? (() => {
                        const wcRow2 = filtered.find(r => r.account === row.account);
                        const pv = buildPlanValues(wcRow2);
                        const bg = is합계 ? 'bg-yellow-50' : '';
                        return [
                          <td key="p0" className={`${cellClass(pv[0])} ${bg}`}>{formatCell(pv[0], 0)}</td>,
                          <td key="p1" className={`${cellClass(pv[1])} ${bg}`}>{formatCell(pv[1], 0)}</td>,
                          <td key="p2" className={`${cellClass(pv[2])} ${bg}`}>{formatCell(pv[2], 14, true)}</td>,
                          <td key="p3" className={`${cellClass(pv[3])} ${bg}`}>{formatCell(pv[3], 0)}</td>,
                          <td key="p4" className={`${cellClass(pv[4])} ${bg}`}>{formatCell(pv[4], 14, true)}</td>,
                          <td key="p5" className={`${cellClass(pv[5])} ${bg}`}>{formatCell(pv[5], 14, true)}</td>,
                          <td key="p6" className={`${cellClass(pv[6])} ${bg} whitespace-nowrap`}>
                            {pv[6] != null && pv[6] !== 0 ? `${pv[6] >= 0 ? '+' : ''}${pv[6].toFixed(1)}%` : '-'}
                          </td>,
                        ];
                      })()
                    : monthsCollapsed
                      ? [
                          <td key="0" className={`${cellClass(row.values[0])} ${is합계 ? 'bg-yellow-50' : ''}`}>
                            {formatCell(row.values[0], 0)}
                          </td>,
                          <td key="13" className={`${cellClass(row.values[13])} ${is합계 ? 'bg-yellow-50' : ''}`}>
                            {formatCell(row.values[13], 13)}
                          </td>,
                          <td key="14" className={`${cellClass(row.values[14])} ${is합계 ? 'bg-yellow-50' : ''}`}>
                            {formatCell(row.values[14], 14)}
                          </td>,
                        ]
                      : row.values.map((v, vi) => (
                          <td key={vi} className={`${cellClass(v)} ${is합계 ? 'bg-yellow-50' : ''}`}>
                            {formatCell(v, vi)}
                          </td>
                        ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
