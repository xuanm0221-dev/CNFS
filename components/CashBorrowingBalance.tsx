'use client';

import { formatNumber } from '@/lib/utils';

interface CashBorrowingBalanceProps {
  year: number;
  columns: string[];
  cash: number[];
  borrowing: number[];
  prevCash?: number[];
  prevBorrowing?: number[];
  monthsCollapsed?: boolean;
  cashNMonthPlan?: number;
  borrowingNMonthPlan?: number;
}

export default function CashBorrowingBalance({
  year,
  columns,
  cash,
  borrowing,
  prevCash = [],
  prevBorrowing = [],
  monthsCollapsed = true,
  cashNMonthPlan,
  borrowingNMonthPlan,
}: CashBorrowingBalanceProps) {
  const is2026 = year === 2026 && prevCash.length > 0;
  const hasPlan = is2026 && cashNMonthPlan != null;

  if (cash.length === 0 && borrowing.length === 0) return null;

  const formatCell = (v: number) =>
    v < 0 ? `(${formatNumber(Math.abs(v), false, false)})` : formatNumber(v, false, false);
  const formatDiff = (v: number) => {
    const sign = v >= 0 ? '+' : '-';
    return `${sign}${formatNumber(Math.abs(v), false, false)}`;
  };
  const cellClass = (v: number, options?: { isDiff?: boolean; rowType?: 'cash' | 'borrowing' }) => {
    const base = 'border border-gray-300 py-2 px-4 text-right';
    if (v >= 0) return base;
    if (options?.isDiff && options?.rowType === 'borrowing') return `${base} text-blue-600`;
    return `${base} text-red-600`;
  };

  const 기초Cash = is2026 ? prevCash[13] : 0;
  const 기초Borrowing = is2026 ? prevBorrowing[13] : 0;
  const 기말Cash = cash[13] ?? 0;
  const 기말Borrowing = borrowing[13] ?? 0;

  // 2026 collapsed + 계획: 기초잔액 | N-1계획 | N-1계획-전년 | 기말잔액 | 예상-전년 | N-1차이 | N-1%
  const renderPlanCollapsed = is2026 && monthsCollapsed && hasPlan;

  let displayCols: string[];
  let cashValues: number[];
  let borrowingValues: number[];

  if (renderPlanCollapsed) {
    displayCols = [];
    cashValues = [];
    borrowingValues = [];
  } else if (is2026) {
    const yoyCash = 기말Cash - 기초Cash;
    const yoyBorrowing = 기말Borrowing - 기초Borrowing;
    displayCols = monthsCollapsed
      ? ['기초잔액', '기말잔액', 'YoY']
      : ['기초잔액', '1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월', '기말잔액', 'YoY'];
    if (monthsCollapsed) {
      cashValues = [기초Cash, 기말Cash, yoyCash];
      borrowingValues = [기초Borrowing, 기말Borrowing, yoyBorrowing];
    } else {
      cashValues = [기초Cash, ...cash.slice(1, 13), 기말Cash, yoyCash];
      borrowingValues = [기초Borrowing, ...borrowing.slice(1, 13), 기말Borrowing, yoyBorrowing];
    }
  } else {
    displayCols = monthsCollapsed ? ['기말잔액'] : columns;
    cashValues = monthsCollapsed ? [cash[13]] : cash;
    borrowingValues = monthsCollapsed ? [borrowing[13]] : borrowing;
  }

  // 전월 연간 계획 (기말잔액 기준)
  const cashPlan = cashNMonthPlan ?? 0;
  const borrowPlan = borrowingNMonthPlan ?? 0;

  // 계획-전년: 전월계획 - 전년기말
  const cashPlanVsPrev = cashPlan - 기초Cash;
  const borrowPlanVsPrev = borrowPlan - 기초Borrowing;
  // 예상-전월계획: 당월예상(기말) - 전월계획
  const cashNDiff = 기말Cash - cashPlan;
  const borrowNDiff = 기말Borrowing - borrowPlan;
  const cashNPct = cashPlan !== 0 ? (cashNDiff / Math.abs(cashPlan)) * 100 : 0;
  const borrowNPct = borrowPlan !== 0 ? (borrowNDiff / Math.abs(borrowPlan)) * 100 : 0;
  const cashYoY = 기말Cash - 기초Cash;
  const borrowYoY = 기말Borrowing - 기초Borrowing;

  const renderPlanCells = (
    base: number,
    nPlan: number,
    planVsPrev: number,
    end: number,
    yoy: number,
    nDiff: number,
    nPct: number,
    rowType: 'cash' | 'borrowing'
  ) => [
    <td key="base" className={`${cellClass(base)} bg-gray-50`}>{formatCell(base)}</td>,
    <td key="nplan" className={`${cellClass(nPlan)} bg-gray-50`}>{formatCell(nPlan)}</td>,
    <td key="nplanvs" className={`${cellClass(planVsPrev, { isDiff: true, rowType })} bg-gray-50`}>{formatDiff(planVsPrev)}</td>,
    <td key="end" className={`${cellClass(end)} bg-gray-50`}>{formatCell(end)}</td>,
    <td key="yoy" className={`${cellClass(yoy, { isDiff: true, rowType })} bg-gray-50`}>{formatDiff(yoy)}</td>,
    <td key="ndiff" className={`${cellClass(nDiff, { isDiff: true, rowType })} bg-gray-50`}>{formatDiff(nDiff)}</td>,
    <td key="npct" className={`${cellClass(nPct)} bg-gray-50 whitespace-nowrap`}>
      {nPct !== 0 ? `${nPct >= 0 ? '+' : ''}${nPct.toFixed(1)}%` : '-'}
    </td>,
  ];

  return (
    <div className="mt-8">
      <h3 className="text-base font-semibold text-gray-800 mb-2">현금잔액과 차입금잔액표</h3>
      <div className="overflow-x-auto border border-gray-300 rounded-lg shadow-sm">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-navy text-white">
            {renderPlanCollapsed ? (
              <>
                <tr>
                  <th rowSpan={2} className="border border-gray-300 py-2.5 px-4 text-left sticky left-0 z-10 bg-navy min-w-[200px]">
                    구분
                  </th>
                  <th rowSpan={2} className="border border-gray-300 py-2.5 px-4 text-center min-w-[120px]">전년기말</th>
                  <th colSpan={2} className="border border-gray-300 py-2.5 px-4 text-center min-w-[120px] bg-gray-600">전월계획</th>
                  <th colSpan={4} className="border border-gray-300 py-2.5 px-4 text-center min-w-[120px]">2026년(예상)</th>
                </tr>
                <tr>
                  <th className="border border-gray-300 py-2 px-4 text-center min-w-[110px] bg-gray-600">연간계획</th>
                  <th className="border border-gray-300 py-2 px-4 text-center min-w-[110px] bg-gray-600">계획-전년</th>
                  <th className="border border-gray-300 py-2 px-4 text-center min-w-[110px]">기말잔액</th>
                  <th className="border border-gray-300 py-2 px-4 text-center min-w-[100px]">예상-전년</th>
                  <th className="border border-gray-300 py-2 px-4 text-center min-w-[110px]">계획 대비</th>
                  <th className="border border-gray-300 py-2 px-4 text-center min-w-[90px]">계획 대비%</th>
                </tr>
              </>
            ) : (
              <tr>
                <th className="border border-gray-300 py-2.5 px-4 text-left sticky left-0 z-10 bg-navy min-w-[200px]">
                  구분
                </th>
                {displayCols.map((col, i) => (
                  <th
                    key={i}
                    className={`border border-gray-300 py-2.5 px-4 text-center ${
                      monthsCollapsed && is2026 && i < 2 ? 'min-w-[120px]' : 'min-w-[100px]'
                    }`}
                  >
                    {col}
                  </th>
                ))}
              </tr>
            )}
          </thead>
          <tbody className="bg-gray-50">
            <tr className="bg-gray-50">
              <td className="border border-gray-300 py-2 px-4 font-medium sticky left-0 z-10 bg-gray-100 text-gray-800">
                현금잔액
              </td>
              {renderPlanCollapsed
                ? renderPlanCells(기초Cash, cashPlan, cashPlanVsPrev, 기말Cash, cashYoY, cashNDiff, cashNPct, 'cash')
                : cashValues.map((v, i) => {
                    const isYoyCol = is2026 && i === cashValues.length - 1;
                    return (
                      <td key={i} className={`${cellClass(v, { isDiff: isYoyCol, rowType: 'cash' })} bg-gray-50`}>
                        {isYoyCol ? formatDiff(v) : formatCell(v)}
                      </td>
                    );
                  })}
            </tr>
            <tr className="bg-gray-50">
              <td className="border border-gray-300 py-2 px-4 font-medium sticky left-0 z-10 bg-gray-100 text-gray-800">
                차입금잔액
              </td>
              {renderPlanCollapsed
                ? renderPlanCells(기초Borrowing, borrowPlan, borrowPlanVsPrev, 기말Borrowing, borrowYoY, borrowNDiff, borrowNPct, 'borrowing')
                : borrowingValues.map((v, i) => {
                    const isYoyCol = is2026 && i === borrowingValues.length - 1;
                    return (
                      <td key={i} className={`${cellClass(v, { isDiff: isYoyCol, rowType: 'borrowing' })} bg-gray-50`}>
                        {isYoyCol ? formatDiff(v) : formatCell(v)}
                      </td>
                    );
                  })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
