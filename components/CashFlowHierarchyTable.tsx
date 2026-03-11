'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { formatNumber } from '@/lib/utils';
import type { CFHierarchyApiRow } from '@/app/api/fs/cf-hierarchy/route';

interface CashFlowHierarchyTableProps {
  rows: CFHierarchyApiRow[];
  columns: string[];
  monthsCollapsed?: boolean;
  onMonthsToggle?: () => void;
  hasPlan?: boolean;
}

export default function CashFlowHierarchyTable({
  rows,
  columns,
  monthsCollapsed = true,
  onMonthsToggle,
  hasPlan: hasPlanProp,
}: CashFlowHierarchyTableProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(['자산성지출']));
  const [allCollapsed, setAllCollapsed] = useState(true);
  const prevRowsLengthRef = useRef(0);

  useEffect(() => {
    if (rows.length > 0) {
      if (prevRowsLengthRef.current === 0) {
        const groups = rows.filter((r) => r.isGroup).map((r) => r.account);
        if (groups.length) {
          const collapsedExcept영업활동 = new Set(groups.filter((g) => g !== '영업활동'));
          collapsedExcept영업활동.add('자산성지출');
          setCollapsed(collapsedExcept영업활동);
        }
      }
      prevRowsLengthRef.current = rows.length;
    } else {
      prevRowsLengthRef.current = 0;
    }
  }, [rows.length]);

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
    } else {
      const groups = rows.filter((r) => r.isGroup).map((r) => r.account);
      const toCollapse = new Set(groups);
      toCollapse.add('자산성지출');
      setCollapsed(toCollapse);
      setAllCollapsed(true);
    }
  };

  const visibleRows = useMemo(() => {
    const result: CFHierarchyApiRow[] = [];
    let skipLevel = -1;

    for (const row of rows) {
      if (row.level <= skipLevel) {
        skipLevel = -1;
      }
      // 접힌 그룹 안의 자식 행은 표시하지 않음
      if (skipLevel >= 0 && row.level > skipLevel) {
        continue;
      }
      if (row.isGroup && collapsed.has(row.account)) {
        // 대분류(0) 접힌 상태: 하위(level 1, 2) 전부 숨김. 중분류(1) 접힌 상태: 소분류(2)만 숨김.
        skipLevel = row.level === 0 ? 0 : row.level;
        result.push(row);
        continue;
      }
      result.push(row);
    }
    return result;
  }, [rows, collapsed]);

  const valueLen = rows[0]?.values?.length ?? 15;
  const is2025Layout = valueLen === 16; // 2025탭: 2023, 2024, 1~12, 2025, YoY
  const hasPlanCols = hasPlanProp ?? valueLen === 19; // 2026탭 계획 포함: +계획,계획-전년,차이,%
  const yoyIndex = hasPlanCols ? 14 : valueLen - 1;
  const currTotalIndex = hasPlanCols ? 13 : valueLen - 2;

  const formatCell = (value: number, index: number) => {
    if (value === 0 && index < yoyIndex) return '-';
    const isYoy = index === yoyIndex;
    if (isYoy) {
      const sign = value >= 0 ? '+' : '-';
      return `${sign}${formatNumber(Math.abs(value), false, false)}`;
    }
    return value < 0 ? `(${formatNumber(Math.abs(value), false, false)})` : formatNumber(value, false, false);
  };

  const cellClass = (value: number) =>
    value < 0 ? 'border border-gray-300 py-2 px-4 text-right text-red-600' : 'border border-gray-300 py-2 px-4 text-right';

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-lg font-bold text-gray-900">현금흐름표</h2>
        <button
          type="button"
          onClick={toggleAll}
          className="px-3 py-1.5 text-sm font-medium rounded-lg bg-gray-200 text-gray-700 hover:bg-gray-300"
        >
          {allCollapsed ? '펼치기 ▼' : '접기 ▲'}
        </button>
      </div>
      <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 220px)' }}>
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-20 bg-navy text-white">
            {monthsCollapsed && hasPlanCols ? (
              <>
                <tr>
                  <th rowSpan={2} className="border border-gray-300 py-3 px-4 text-left sticky left-0 z-30 bg-navy min-w-[200px]">
                    계정과목
                  </th>
                  <th rowSpan={2} className="border border-gray-300 py-3 px-4 text-center min-w-[120px]">2025년(합계)</th>
                  <th colSpan={2} className="border border-gray-300 py-3 px-4 text-center min-w-[120px] bg-gray-600">전월계획</th>
                  <th colSpan={4} className="border border-gray-300 py-3 px-4 text-center min-w-[120px]">2026년(예상)</th>
                </tr>
                <tr>
                  <th className="border border-gray-300 py-2 px-4 text-center min-w-[110px] bg-gray-600">연간계획</th>
                  <th className="border border-gray-300 py-2 px-4 text-center min-w-[110px] bg-gray-600">계획-전년</th>
                  <th className="border border-gray-300 py-2 px-4 text-center min-w-[110px]">2026년합계</th>
                  <th className="border border-gray-300 py-2 px-4 text-center min-w-[100px]">전년비</th>
                  <th className="border border-gray-300 py-2 px-4 text-center min-w-[110px]">계획 대비</th>
                  <th className="border border-gray-300 py-2 px-4 text-center min-w-[90px]">계획 대비%</th>
                </tr>
              </>
            ) : (
              <tr>
                <th className="border border-gray-300 py-3 px-4 text-left sticky left-0 z-30 bg-navy min-w-[200px]">
                  계정과목
                </th>
                {monthsCollapsed ? (
                  is2025Layout ? (
                    <>
                      <th className="border border-gray-300 py-3 px-4 text-center min-w-[120px]">{columns[0]}</th>
                      <th className="border border-gray-300 py-3 px-4 text-center min-w-[120px]">{columns[1]}</th>
                      <th className="border border-gray-300 py-3 px-4 text-center min-w-[120px]">{columns[14]}</th>
                      <th className="border border-gray-300 py-3 px-4 text-center min-w-[100px]">{columns[15]}</th>
                    </>
                  ) : (
                    <>
                      <th className="border border-gray-300 py-3 px-4 text-center min-w-[120px]">{columns[0]}</th>
                      <th className="border border-gray-300 py-3 px-4 text-center min-w-[120px]">{columns[13]}</th>
                      <th className="border border-gray-300 py-3 px-4 text-center min-w-[100px]">{columns[14]}</th>
                    </>
                  )
                ) : (
                  columns.map((col, i) => (
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
              const isNetCash = row.account === 'net cash';
              const isMajor = row.level === 0 && !isNetCash;
              const isMedium = row.level === 1;
              // 대분류 0, 중분류 1칸, 소분류 2칸(중분류보다 한 칸 더). net cash는 대분류와 동일 배경
              const indentPx = row.level === 0 ? 12 : row.level === 1 ? 36 : 60;
              const label = row.account;

              // values: [2025합계, 1~12월, 2026합계, YoY] -> indices 0, 13, 14 when collapsed

              return (
                <tr
                  key={ri}
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
                        <span>{label}</span>
                        <button
                          type="button"
                          onClick={() => toggle(row.account)}
                          className="text-gray-600 hover:text-gray-900 p-0.5 leading-none"
                        >
                          {collapsed.has(row.account) ? '▶' : '▼'}
                        </button>
                      </div>
                    ) : (
                      label
                    )}
                  </td>
                  {monthsCollapsed
                    ? hasPlanCols
                      ? [
                          // 2025년 합계
                          <td key="y25" className={cellClass(row.values[0])}>
                            {formatCell(row.values[0], 0)}
                          </td>,
                          // N-1월 계획
                          <td key="plan" className={cellClass(row.values[15])}>
                            {formatCell(row.values[15], 15)}
                          </td>,
                          // N-1월 계획-전년
                          <td key="plan-prev" className={cellClass(row.values[16])}>
                            {formatCell(row.values[16], yoyIndex)}
                          </td>,
                          // 2026년 합계
                          <td key="y26" className={cellClass(row.values[13])}>
                            {formatCell(row.values[13], 13)}
                          </td>,
                          // 전년비 (YoY)
                          <td key="yoy" className={cellClass(row.values[14])}>
                            {formatCell(row.values[14], yoyIndex)}
                          </td>,
                          // N-1차이금액
                          <td key="ndiff" className={cellClass(row.values[17])}>
                            {formatCell(row.values[17], yoyIndex)}
                          </td>,
                          // N-1%
                          <td key="npct" className={`${cellClass(row.values[18])} whitespace-nowrap`}>
                            {row.values[18] !== 0 ? `${row.values[18] >= 0 ? '+' : ''}${row.values[18].toFixed(1)}%` : '-'}
                          </td>,
                        ]
                      : is2025Layout
                        ? [
                            <td key="y23" className={cellClass(row.values[0])}>
                              {formatCell(row.values[0], 0)}
                            </td>,
                            <td key="y24" className={cellClass(row.values[1])}>
                              {formatCell(row.values[1], 1)}
                            </td>,
                            <td key="y25" className={cellClass(row.values[14])}>
                              {formatCell(row.values[14], 14)}
                            </td>,
                            <td key="yoy" className={cellClass(row.values[15])}>
                              {formatCell(row.values[15], 15)}
                            </td>,
                          ]
                        : [
                            <td key="y25" className={cellClass(row.values[0])}>
                              {formatCell(row.values[0], 0)}
                            </td>,
                            <td key="y26" className={cellClass(row.values[13])}>
                              {formatCell(row.values[13], 13)}
                            </td>,
                            <td key="yoy" className={cellClass(row.values[14])}>
                              {formatCell(row.values[14], 14)}
                            </td>,
                          ]
                    : row.values.slice(0, hasPlanCols ? 19 : undefined).map((v, vi) => (
                        <td key={vi} className={cellClass(v)}>
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
