'use client';

import { useState, useMemo, useEffect } from 'react';
import { ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Eye, EyeOff } from 'lucide-react';
import { TableRow } from '@/lib/types';
import { formatNumber, formatPercent } from '@/lib/utils';

interface FinancialTableProps {
  data: TableRow[];
  columns: string[]; // ["계정과목", "1월", ..., "12월"] 또는 [..., "2025년(합계)"]
  showTotal?: boolean; // CF에서 합계 컬럼 표시 여부
  showComparisons?: boolean; // PL 2025년 또는 BS 2025/2026에서 비교 컬럼 표시 여부
  baseMonth?: number; // 기준월 (1~12)
  isBalanceSheet?: boolean; // 재무상태표 여부
  isCashFlow?: boolean; // 현금흐름표 여부 (2024년 컬럼 표시)
  currentYear?: number; // 현재 년도 (BS 기말 컬럼 헤더에 사용)
  monthsCollapsed?: boolean; // 월별 데이터 접기 상태 (외부 제어)
  onMonthsToggle?: () => void; // 월별 데이터 토글 핸들러
  compactLayout?: boolean; // CF 전용 컴팩트 레이아웃 활성화
  showRemarks?: boolean; // 비고 열 표시 여부
  remarks?: Map<string, string>; // 비고 데이터
  onRemarkChange?: (account: string, remark: string) => void; // 비고 변경 핸들러
  autoRemarks?: { [key: string]: string }; // 자동 생성된 비고 (운전자본용)
  showBrandBreakdown?: boolean; // 브랜드별 손익 보기 모드 (법인 선택 시 항상 true)
  hideYtd?: boolean; // YTD 숨기기
  onHideYtdToggle?: () => void; // YTD 숨기기 토글 핸들러
  planMonth?: number | null; // BS 2026 계획 기준월
  allRowsCollapsed?: boolean; // 모든 행 접기 상태 (외부 제어)
  onAllRowsToggle?: () => void; // 모든 행 접기 토글 핸들러
  hideInternalControls?: boolean; // 내부 컨트롤 버튼(펼치기/월별/YTD) 숨김 — 부모가 외부에서 렌더할 때
  quarterlyMode?: boolean; // 분기보기 (월별 12개 컬럼 대신 1Q~4Q 4개 컬럼으로 교체, 셀 내부 YoY 인라인)
}

export default function FinancialTable({ 
  data, 
  columns, 
  showTotal = false,
  showComparisons = false,
  baseMonth = 11,
  isBalanceSheet = false,
  isCashFlow = false,
  currentYear,
  monthsCollapsed: externalMonthsCollapsed,
  onMonthsToggle,
  compactLayout = false,
  showRemarks = false,
  remarks,
  onRemarkChange,
  autoRemarks,
  showBrandBreakdown = false,
  hideYtd = false,
  onHideYtdToggle,
  planMonth,
  allRowsCollapsed: externalAllRowsCollapsed,
  onAllRowsToggle,
  hideInternalControls = false,
  quarterlyMode = false,
}: FinancialTableProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [internalMonthsCollapsed, setInternalMonthsCollapsed] = useState<boolean>(true);
  const [internalAllRowsCollapsed, setInternalAllRowsCollapsed] = useState<boolean>(true);
  const allRowsCollapsed = externalAllRowsCollapsed !== undefined ? externalAllRowsCollapsed : internalAllRowsCollapsed;
  
  // 브랜드별 컬럼 접기/펼치기 상태 (3가지 독립적)
  const [brandMonthCollapsed, setBrandMonthCollapsed] = useState<boolean>(true); // 당월
  const [brandYtdCollapsed, setBrandYtdCollapsed] = useState<boolean>(true); // YTD
  const [brandAnnualCollapsed, setBrandAnnualCollapsed] = useState<boolean>(true); // 연간
  
  const brands = ['MLB', 'KIDS', 'DISCOVERY', 'DUVETICA', 'SUPRA'];
  
  // 외부에서 monthsCollapsed를 제어하는 경우와 내부에서 제어하는 경우 모두 지원
  const monthsCollapsed = externalMonthsCollapsed !== undefined ? externalMonthsCollapsed : internalMonthsCollapsed;
  const toggleMonths = onMonthsToggle || (() => setInternalMonthsCollapsed(!internalMonthsCollapsed));

  // 초기 마운트 시 모든 그룹 행 접기
  useEffect(() => {
    const allGroups = data.filter(row => row.isGroup).map(row => row.account);
    setCollapsed(new Set(allGroups));
  }, []); // 빈 의존성 배열로 초기 마운트 시에만 실행

  // 그룹 접기/펼치기 토글
  const toggleCollapse = (account: string) => {
    const newCollapsed = new Set(collapsed);
    if (newCollapsed.has(account)) {
      newCollapsed.delete(account);
    } else {
      newCollapsed.add(account);
    }
    setCollapsed(newCollapsed);
  };

  // 모든 행 접기/펼치기
  const toggleAllRows = () => {
    if (onAllRowsToggle) {
      onAllRowsToggle();
      return;
    }
    if (allRowsCollapsed) {
      setCollapsed(new Set());
      setInternalAllRowsCollapsed(false);
    } else {
      const allGroups = data.filter(row => row.isGroup).map(row => row.account);
      setCollapsed(new Set(allGroups));
      setInternalAllRowsCollapsed(true);
    }
  };

  // 외부에서 allRowsCollapsed가 변경되면 collapsed Set도 동기화
  useEffect(() => {
    if (externalAllRowsCollapsed === undefined) return;
    if (externalAllRowsCollapsed) {
      const allGroups = data.filter(row => row.isGroup).map(row => row.account);
      setCollapsed(new Set(allGroups));
    } else {
      setCollapsed(new Set());
    }
  }, [externalAllRowsCollapsed, data]);

  // 표시할 행 필터링 (접힌 그룹의 자식은 숨김)
  const visibleRows = useMemo(() => {
    const result: TableRow[] = [];
    let skipUntilLevel = -1;

    for (const row of data) {
      // 접힌 그룹의 자식인지 확인
      if (skipUntilLevel >= 0 && row.level > skipUntilLevel) {
        // YOY 행은 부모 접힘과 무관하게 항상 표시 (PL(sim) 스타일)
        if (!row.isYoyRow) continue;
      } else {
        skipUntilLevel = -1; // 스킵 종료
      }

      result.push(row);

      // 이 행이 접힌 그룹이면 다음 행부터 스킵
      if (row.isGroup && collapsed.has(row.account)) {
        skipUntilLevel = row.level;
      }
    }

    return result;
  }, [data, collapsed]);

  // 값 포맷팅
  const formatValue = (
    value: number | null, 
    format?: 'number' | 'percent', 
    showSign: boolean = false,
    useParentheses: boolean = false,
    decimalPlaces: number = 1
  ) => {
    if (format === 'percent') {
      return formatPercent(value, showSign, useParentheses, decimalPlaces);
    }
    return formatNumber(value, showSign, useParentheses);
  };

  // 음수 값인지 확인
  const isNegative = (value: number | null | undefined): boolean => {
    return value !== null && value !== undefined && value < 0;
  };

  // 배경색 클래스
  const getHighlightClass = (highlight?: 'sky' | 'yellow' | 'gray' | 'mint' | 'orange' | 'pink' | 'none') => {
    if (highlight === 'sky') return 'bg-highlight-sky';
    if (highlight === 'yellow') return 'bg-highlight-yellow';
    if (highlight === 'gray') return 'bg-highlight-gray';
    if (highlight === 'mint') return 'bg-highlight-mint';
    if (highlight === 'orange') return 'bg-highlight-orange';
    if (highlight === 'pink') return 'bg-highlight-pink';
    return '';
  };

  // 비교 컬럼 정의
  const comparisonColumns = useMemo(() => {
    if (!showComparisons) return [];
    
    if (isBalanceSheet) {
      // 재무상태표
      const prevYear = currentYear ? currentYear - 1 : 24;
      const currYear = currentYear ? currentYear % 100 : 25;
      
      if (currentYear === 2026) {
        // 2026년: 접힌 뷰는 2행 헤더(7 리프 컬럼), 펼침은 25년기말|1~12월|26년기말|전년비
        const pm = planMonth ?? 2;
        return [
          '2025년기말',   // [0] 2025년(기말) - rowspan=2
          '당월계획',     // [1] 당월 > 계획
          '당월실적',     // [2] 당월 > 실적
          '당월YoY',      // [3] 당월 > YoY
          '기말계획',     // [4] 2026년기말 > 계획
          '기말실적',     // [5] 2026년기말 > 실적(예상)
          '계획비',       // [6] 2026년기말 > 계획비
          '전년비',       // [7] 2026년기말 > 전년비
        ];
      } else {
        // 2025년: 월별 + 기말 비교
        return [
          `전년(${baseMonth}월)`,
          `당년(${baseMonth}월)`,
          'YoY(기준월)',
          `${prevYear}년기말`,
          `${currYear}년기말`,
          'YoY(연간)',
        ];
      }
    } else {
      // 손익계산서: 월별, YTD, 연간 (선택 연도에 따라 전년/당년 연간 라벨)
      const prevYear = currentYear != null ? currentYear - 1 : 25;
      const currYear = currentYear != null ? currentYear : 26;
      return [
        `전년(${baseMonth}월)`,
        `당년(${baseMonth}월)`,
        '전년YTD',
        '당년YTD',
        `${prevYear}년연간`,
        `${currYear}년연간`,
      ];
    }
  }, [showComparisons, isBalanceSheet, baseMonth, currentYear]);

  // 분기보기 컬럼 라벨 (당년 4개만 — 전년 비교는 셀 내부 YoY 인라인으로 표시)
  const quarterlyColumns = useMemo(() => ([
    '1Q', '2Q', '3Q', '4Q',
  ]), []);

  // 분기값 계산용 lookup 맵 (비율 행 재계산에 필요)
  // account → { curr: 12개월, prev: 12개월 }
  const accountMonthlyMap = useMemo(() => {
    const m = new Map<string, { curr: (number | null)[]; prev: (number | null)[] }>();
    for (const row of data) {
      const prev = row.comparisons?.prevYearMonthly ?? Array(12).fill(null);
      m.set(row.account, { curr: row.values.slice(0, 12), prev });
    }
    return m;
  }, [data]);

  // 단일 분기 합산: 3개월 합 (null은 0으로 취급하되, 전부 null이면 null)
  const sumQuarter = (vals: (number | null)[], q: number): number | null => {
    const start = q * 3;
    let sum = 0;
    let hasValue = false;
    for (let i = start; i < start + 3; i++) {
      const v = vals[i];
      if (v !== null && v !== undefined && !Number.isNaN(v)) {
        sum += v;
        hasValue = true;
      }
    }
    return hasValue ? sum : null;
  };

  // 비율 행의 분기 재계산 (분자/분모 account name 매핑)
  // calculateComparisonData의 로직과 일치시킴
  const RATIO_RULES: Record<string, { numerator: string; denominator: string; multiplier?: number }> = {
    '(Tag 대비 원가율)': { numerator: '매출원가', denominator: 'Tag매출', multiplier: 1.13 },
    '영업이익률(관리식)': { numerator: '영업이익(관리식)', denominator: '실판매출' },
    '영업이익률(IFRS)': { numerator: '영업이익(IFRS)', denominator: '매출(IFRS)' },
  };

  // 분기값 산출: 일반 행은 단순 합, 비율 행은 분자/분모 합산 후 비율 재계산
  const getQuarterValue = (row: TableRow, q: number, useCurrYear: boolean): number | null => {
    // YOY 행: 부모 행의 분기 합산 비율 (current quarter sum / prev quarter sum)
    if (row.isYoyRow && row.yoyParent) {
      const parent = accountMonthlyMap.get(row.yoyParent);
      if (!parent) return null;
      const numSum = sumQuarter(parent.curr, q);
      const denSum = sumQuarter(parent.prev, q);
      if (numSum === null || denSum === null || denSum === 0) return null;
      // useCurrYear=true(당년) → 비율 그대로, false(전년) → 1 (자기 자신 = 100%)
      return useCurrYear ? numSum / denSum : 1;
    }
    const rule = RATIO_RULES[row.account];
    if (rule) {
      const num = accountMonthlyMap.get(rule.numerator);
      const den = accountMonthlyMap.get(rule.denominator);
      if (!num || !den) return null;
      const numVals = useCurrYear ? num.curr : num.prev;
      const denVals = useCurrYear ? den.curr : den.prev;
      const numSum = sumQuarter(numVals, q);
      const denSum = sumQuarter(denVals, q);
      if (numSum === null || denSum === null || denSum === 0) return null;
      return ((rule.multiplier ?? 1) * numSum) / denSum;
    }
    const vals = useCurrYear ? row.values.slice(0, 12) : (row.comparisons?.prevYearMonthly ?? []);
    return sumQuarter(vals, q);
  };

  // 실제 표시할 컬럼 (월 토글 고려, 빈 컬럼 포함)
  const displayColumns = useMemo(() => {
    const accountCol = [columns[0]]; // "계정과목"
    
    if (isCashFlow) {
      // 현금흐름표: 계정과목 | 2024년(합계) or 2025년(합계) | 1월~12월 | {currentYear}년(합계) | YoY
      const totalColumnHeader = currentYear ? `${currentYear}년(합계)` : '2025년(합계)';
      const prevYearHeader = currentYear === 2026 ? '2025년(합계)' : '2024년(합계)';
      if (monthsCollapsed) {
        return [
          ...accountCol,
          prevYearHeader,
          '', // 빈 컬럼
          totalColumnHeader,
          'YoY',
        ];
      } else {
        const monthCols = columns.slice(1, 13); // 1월~12월
        return [
          ...accountCol,
          prevYearHeader,
          ...monthCols,
          totalColumnHeader,
          'YoY',
        ];
      }
    } else if (showComparisons) {
      if (isBalanceSheet) {
        // 재무상태표
        if (currentYear === 2026) {
          // 접힌: 8개 리프 컬럼 (2행 헤더로 렌더링)
          if (monthsCollapsed) {
            return [
              ...accountCol,
              ...comparisonColumns, // 2025년기말, 당월계획, 당월실적, 당월YoY, 기말계획, 기말실적, 계획비, 전년비
            ];
          } else {
            // 펼침: 25년기말 | 1~12월 | 26년기말 | 전년비
            const monthCols = columns.slice(1, 13); // 1월~12월 (index 1~12)
            return [
              ...accountCol,
              comparisonColumns[0], // 2025년기말
              ...monthCols,
              comparisonColumns[5], comparisonColumns[7], // 기말실적(예상), 전년비
            ];
          }
        } else {
          // 2025년: 1~12월 + 전년(11월) 당년(11월) + 기말
          if (monthsCollapsed) {
            return [
              ...accountCol,
              '', // 빈 컬럼
              comparisonColumns[0], comparisonColumns[1], comparisonColumns[2],
              '', // 빈 컬럼
              comparisonColumns[3], comparisonColumns[4], comparisonColumns[5],
            ];
          } else {
            const monthCols = columns.slice(1);
            return [
              ...accountCol,
              ...monthCols,
              '', // 빈 컬럼 (12월 뒤)
              comparisonColumns[0], comparisonColumns[1], comparisonColumns[2],
              '', // 빈 컬럼
              comparisonColumns[3], comparisonColumns[4], comparisonColumns[5],
            ];
          }
        }
      } else {
        // 손익계산서: YTD 포함 (hideYtd가 true이면 YTD 제외, 연간은 항상 표시)
        // YoY 컬럼은 제거되었고 당년 컬럼에 통합됨

        // 브랜드별 컬럼 추가
        if (showBrandBreakdown) {
          const result: string[] = [];

          // 계정과목
          result.push(accountCol[0]);

          // 분기보기: 1Q~4Q 4개 컬럼 (당년만, 셀 내부 YoY 인라인)
          if (quarterlyMode) {
            result.push(...quarterlyColumns);
          } else if (!monthsCollapsed) {
            // 월별 데이터 (monthsCollapsed가 false일 때)
            result.push(...columns.slice(1)); // 1월~12월
          }

          // 당월 그룹: 월별 펼치기 상태에서는 12개월 안에 이미 N월이 있으므로 생략
          const isMonthlyExpanded = !monthsCollapsed && !quarterlyMode;
          if (!isMonthlyExpanded) {
            result.push(''); // 빈 컬럼
            result.push(comparisonColumns[0]); // 전년(N월)
            result.push(comparisonColumns[1]); // 당년(N월) - YoY 통합 표시
            if (!brandMonthCollapsed) {
              brands.forEach(brand => {
                result.push(`${brand}`); // 브랜드별 통합 컬럼 (금액 + YoY)
              });
            }
          }
          
          // YTD 그룹 (hideYtd가 false일 때만)
          if (!hideYtd) {
            result.push(''); // 빈 컬럼
            result.push(comparisonColumns[2]); // 전년YTD
            result.push(comparisonColumns[3]); // 당년YTD - YoY 통합 표시
            if (!brandYtdCollapsed) {
              brands.forEach(brand => {
                result.push(`${brand}`); // 브랜드별 통합 컬럼 (금액 + YoY)
              });
            }
          }
          
          // 빈 컬럼
          result.push('');
          
          // 연간 그룹: 24년연간, 25년연간, 브랜드별 컬럼 (항상 표시)
          result.push(comparisonColumns[4]); // 24년연간
          result.push(comparisonColumns[5]); // 25년연간 - YoY 통합 표시
          if (!brandAnnualCollapsed) {
            brands.forEach(brand => {
              result.push(`${brand}`); // 브랜드별 통합 컬럼 (금액 + YoY)
            });
          }
          
          return result;
        }
        
        // 브랜드별 컬럼이 없을 때 (일반 모드)
        const baseCols = quarterlyMode ? [
            ...accountCol,
            ...quarterlyColumns, // 1Q, 2Q, 3Q, 4Q (당년 + YoY 인라인)
            '', // 빈 컬럼
            comparisonColumns[0], comparisonColumns[1], // 전년(N월), 당년(N월)
          ...(hideYtd ? [] : ['', comparisonColumns[2], comparisonColumns[3]]), // 전년YTD, 당년YTD
            '', // 빈 컬럼
          comparisonColumns[4], comparisonColumns[5], // 전년연간, 당년연간
        ] : monthsCollapsed ? [
            ...accountCol,
            '', // 빈 컬럼
            comparisonColumns[0], comparisonColumns[1], // 전년(N월), 당년(N월)
          ...(hideYtd ? [] : ['', comparisonColumns[2], comparisonColumns[3]]), // 전년YTD, 당년YTD
            '', // 빈 컬럼
          comparisonColumns[4], comparisonColumns[5], // 24년연간, 25년연간
        ] : [
            // 월별 데이터 펼치기 — 12개월 안에 이미 N월이 있으므로 가운데 전년(N월)/당년(N월) 생략
            ...accountCol,
          ...columns.slice(1),
          ...(hideYtd ? [] : ['', comparisonColumns[2], comparisonColumns[3]]), // 전년YTD, 당년YTD
          '', // 빈 컬럼
          comparisonColumns[4], comparisonColumns[5], // 24년연간, 25년연간
        ];

        return baseCols;
      }
    } else {
      // 기본: 모든 컬럼
      return columns;
    }
  }, [columns, showComparisons, monthsCollapsed, comparisonColumns, isBalanceSheet, isCashFlow, showBrandBreakdown, brandMonthCollapsed, brandYtdCollapsed, brandAnnualCollapsed, hideYtd, quarterlyMode, quarterlyColumns]);

  return (
    <div>
      {/* 컨트롤 버튼들 (부모가 외부에서 렌더하면 숨김) */}
      {!hideInternalControls && (
        <div className="mb-4 flex items-center gap-1.5">
          <button
            onClick={toggleAllRows}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50"
          >
            {allRowsCollapsed ? '펼치기' : '접기'}
            {allRowsCollapsed
              ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
              : <ChevronUp className="h-3.5 w-3.5 text-slate-400" />}
          </button>

          {showComparisons && (
            <>
              <button
                onClick={toggleMonths}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50"
              >
                {monthsCollapsed ? '월별 데이터 펼치기' : '월별 데이터 접기'}
                {monthsCollapsed
                  ? <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                  : <ChevronLeft className="h-3.5 w-3.5 text-slate-400" />}
              </button>
              <span className="text-xs text-slate-500">
                (비교 컬럼은 항상 표시됩니다)
              </span>
            </>
          )}

          {onHideYtdToggle && (
            <button
              onClick={onHideYtdToggle}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50"
            >
              {hideYtd ? 'YTD 보기' : 'YTD 숨기기'}
              {hideYtd
                ? <Eye className="h-3.5 w-3.5 text-slate-400" />
                : <EyeOff className="h-3.5 w-3.5 text-slate-400" />}
            </button>
          )}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-gray-200 shadow-sm">
        <div 
          className={`relative overflow-auto ${compactLayout ? 'flex justify-center' : ''}`} 
          style={{ maxHeight: 'calc(100vh - 250px)' }}
        >
          <table 
            className={`border-collapse text-sm ${compactLayout ? '' : 'w-full'}`}
          style={compactLayout ? { 
            tableLayout: 'fixed',
            width: 'fit-content'
          } : undefined}
        >
          <thead className="sticky top-0 z-30 bg-navy text-white">
            {/* 2026 BS 접힌 뷰: 2행 헤더 */}
            {isBalanceSheet && currentYear === 2026 && monthsCollapsed ? (
              <>
                <tr>
                  <th
                    rowSpan={2}
                    className="border border-gray-200 py-3 px-4 text-center font-semibold sticky top-0 left-0 z-40 bg-navy min-w-[200px]"
                  >
                    계정과목
                  </th>
                  <th
                    rowSpan={2}
                    className="border border-gray-200 py-3 px-4 text-center font-semibold bg-navy min-w-[100px]"
                  >
                    2025년(기말)
                  </th>
                  <th
                    colSpan={3}
                    className="border border-gray-200 py-3 px-4 text-center font-semibold bg-navy min-w-[100px]"
                  >
                    당월({planMonth ?? 2}월)
                  </th>
                  <th
                    colSpan={4}
                    className="border border-gray-200 py-3 px-4 text-center font-semibold bg-navy min-w-[100px]"
                  >
                    2026년기말
                  </th>
                  {showRemarks && (
                    <th
                      rowSpan={2}
                      className="border border-gray-200 py-3 px-4 text-center font-semibold bg-navy min-w-[200px]"
                    >
                      비고
                    </th>
                  )}
                </tr>
                <tr>
                  <th className="border border-gray-200 py-2 px-4 text-center font-semibold bg-navy min-w-[100px]">계획</th>
                  <th className="border border-gray-200 py-2 px-4 text-center font-semibold bg-navy min-w-[100px]">실적</th>
                  <th className="border border-gray-200 py-2 px-4 text-center font-semibold bg-navy min-w-[100px]">계획비</th>
                  <th className="border border-gray-200 py-2 px-4 text-center font-semibold bg-navy min-w-[100px]">계획</th>
                  <th className="border border-gray-200 py-2 px-4 text-center font-semibold bg-navy min-w-[100px]">실적(예상)</th>
                  <th className="border border-gray-200 py-2 px-4 text-center font-semibold bg-navy min-w-[100px]">계획비</th>
                  <th className="border border-gray-200 py-2 px-4 text-center font-semibold bg-navy min-w-[100px]">전년비</th>
                </tr>
              </>
            ) : (
              <tr>
                {displayColumns.map((col, index) => {
                  const isAccountCol = index === 0;
                  const isSpacer = col === ''; // 빈 컬럼인지 확인
                  
                  // 빈 컬럼이면 특별한 스타일 적용
                  if (isSpacer) {
                    return (
                      <th
                        key={index}
                        className="bg-white border-0 w-4"
                        style={{ minWidth: '16px', maxWidth: '16px', padding: 0 }}
                      >
                      </th>
                    );
                  }
                  
                  const isComparisonCol = showComparisons && (comparisonColumns.includes(col) || quarterlyColumns.includes(col));
                  const isBrandCol = showBrandBreakdown && brands.includes(col);
                  
                  // CF: 기준월 개념 없음 (모든 월 동일하게 표시)
                  const isMonthCol = col.includes('월') && !col.includes('합계');
                  const isNonBaseMonthCol = false;
                  
                  // 브랜드별 컬럼 접기/펼치기 버튼이 필요한 헤더인지 확인
                  const isMonthGroupHeader = showBrandBreakdown && col === comparisonColumns[1]; // 당년(12월)만
                  const isYtdGroupHeader = showBrandBreakdown && !hideYtd && col === comparisonColumns[3]; // 당년YTD만
                  const isAnnualGroupHeader = showBrandBreakdown && col === comparisonColumns[5]; // 25년연간만
                  
                  // CF 컴팩트 레이아웃: 컬럼별 고정 폭 설정
                  const getColumnWidth = () => {
                    if (!compactLayout) return undefined;
                    if (isAccountCol) return { width: '280px', minWidth: '280px' };
                    const isTotalCol = col.includes('년(합계)');
                    const isPrevYearCol = col === '2024년' || col === '2025년';
                    if (isPrevYearCol || isTotalCol || col === 'YoY') {
                      return { width: '160px', minWidth: '160px' };
                    }
                    if (isMonthCol) return { width: '120px', minWidth: '120px' };
                    return undefined;
                  };
                  
                  return (
                    <th
                      key={index}
                      className={`
                        border border-gray-200 py-3 text-center font-semibold
                        text-white
                        ${isAccountCol ? 'sticky top-0 left-0 z-40 bg-navy min-w-[200px] px-4' : 'min-w-[100px] px-4'}
                        ${isNonBaseMonthCol ? 'bg-gray-600' : ''}
                        ${!isNonBaseMonthCol && isComparisonCol ? 'bg-navy' : ''}
                        ${!isNonBaseMonthCol && !isComparisonCol && !isAccountCol && !isBrandCol ? 'bg-navy' : ''}
                        ${isBrandCol ? 'bg-gray-700' : ''}
                        ${(isMonthGroupHeader || isYtdGroupHeader || isAnnualGroupHeader) ? 'cursor-pointer hover:bg-gray-700' : ''}
                      `}
                      style={getColumnWidth()}
                      onClick={() => {
                        if (isMonthGroupHeader) setBrandMonthCollapsed(!brandMonthCollapsed);
                        if (isYtdGroupHeader) setBrandYtdCollapsed(!brandYtdCollapsed);
                        if (isAnnualGroupHeader) setBrandAnnualCollapsed(!brandAnnualCollapsed);
                      }}
                    >
                      <div className="flex items-center justify-center gap-1">
                      {col}
                        {(isMonthGroupHeader || isYtdGroupHeader || isAnnualGroupHeader) && (
                          ((isMonthGroupHeader && brandMonthCollapsed) ||
                            (isYtdGroupHeader && brandYtdCollapsed) ||
                            (isAnnualGroupHeader && brandAnnualCollapsed))
                            ? <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.5} />
                            : <ChevronDown className="h-3.5 w-3.5" strokeWidth={2.5} />
                        )}
                      </div>
                    </th>
                  );
                })}
                
                {/* 비고 열 헤더 */}
                {showRemarks && (
                  <th className="border border-gray-200 py-3 px-4 text-center font-semibold text-white bg-navy min-w-[200px]">
                    비고
                  </th>
                )}
              </tr>
            )}
          </thead>
          <tbody>
            {visibleRows.map((row, rowIndex) => {
              // Balance Check 행 스타일링 (절대값 10 미만이면 정합)
              const isBalanceCheck = row.account === 'Balance Check';
              const isBalanceOk = isBalanceCheck && row.values.every(v => v === null || Math.abs(v) < 10);
              // 매출총이익 / 영업이익(관리식) 아래 굵은 회색 구분선
              const hasThickDivider = row.account === '매출총이익' || row.account === '영업이익(관리식)';
              // 재무&관리차이(-) 행: 오렌지 텍스트
              const isOrangeText = row.isHighlight === 'orange';

              return (
              <tr
                key={rowIndex}
                className={`
                  ${isBalanceCheck && isBalanceOk ? 'bg-green-100' : ''}
                  ${isBalanceCheck && !isBalanceOk ? 'bg-red-100' : ''}
                  ${!isBalanceCheck ? getHighlightClass(row.isHighlight) : ''}
                  ${row.isBold ? 'font-semibold' : ''}
                  ${hasThickDivider ? '[&>td]:!border-b-[3px] [&>td]:!border-b-slate-400' : ''}
                  ${isOrangeText ? '[&>td]:!text-orange-700' : ''}
                  ${row.isYoyRow ? 'italic text-slate-500 [&>td]:!text-slate-500' : ''}
                  hover:bg-gray-50
                `}
              >
                {/* 계정과목 열 (고정) */}
                <td
                  className={`
                    border border-gray-200 px-4 py-2 sticky left-0 z-20
                    ${isBalanceCheck && isBalanceOk ? 'bg-green-100' : ''}
                    ${isBalanceCheck && !isBalanceOk ? 'bg-red-100' : ''}
                    ${!isBalanceCheck && (getHighlightClass(row.isHighlight))}
                    ${!isBalanceCheck && (!row.isHighlight || row.isHighlight === 'none') ? 'bg-white' : ''}
                    ${row.isGroup ? 'cursor-pointer' : ''}
                    ${row.isBold ? 'font-semibold' : ''}
                    ${compactLayout ? 'overflow-hidden text-ellipsis' : ''}
                  `}
                  style={compactLayout ? {
                    paddingLeft: `${8 + row.level * 16}px`,
                    maxWidth: '280px',
                    whiteSpace: 'nowrap'
                  } : { paddingLeft: `${8 + row.level * 16}px` }}
                  onClick={() => row.isGroup && toggleCollapse(row.account)}
                >
                  <div className="flex items-center gap-2">
                    <span className={compactLayout ? 'overflow-hidden text-ellipsis' : ''}>
                      {isBalanceCheck ? (
                        isBalanceOk ? 'Balance Check ✓ 정합' : 'Balance Check (차대변 불일치)'
                      ) : (
                        row.account === '실판매출' ? '실판매출(V-)' : (row.displayLabel ?? row.account)
                      )}
                    </span>
                    {row.isGroup && (
                      <span className="inline-flex items-center text-slate-400 flex-shrink-0">
                        {collapsed.has(row.account)
                          ? <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.5} />
                          : <ChevronDown className="h-3.5 w-3.5" strokeWidth={2.5} />}
                      </span>
                    )}
                  </div>
                </td>

                {/* CF: 2024년 값 */}
                {isCashFlow && (
                  <>
                    <td
                      className={`
                        border border-gray-200 px-4 py-2 text-right
                        ${getHighlightClass(row.isHighlight)}
                        ${row.isBold ? 'font-semibold' : ''}
                        ${isNegative(row.year2024Value ?? null) ? 'text-red-600' : ''}
                      `}
                    >
                      {formatValue(row.year2024Value ?? null, row.format, false, !row.isCalculated)}
                    </td>
                    {/* 빈 컬럼 (2024년 뒤) */}
                    {monthsCollapsed && <td className="bg-white border-0" style={{ minWidth: '16px', maxWidth: '16px', padding: 0 }}></td>}
                  </>
                )}

                {/* 2026년 재무상태표: 월별 데이터 전에 25년기말 컬럼 먼저 렌더링 */}
                {isBalanceSheet && currentYear === 2026 && !monthsCollapsed && row.comparisons && (
                  <td className={`border border-gray-200 px-4 py-2 text-right ${isBalanceCheck ? (row.comparisons.prevYearAnnual === null || Math.abs(row.comparisons.prevYearAnnual) < 10 ? 'bg-green-100' : 'bg-red-100') : getHighlightClass(row.isHighlight)} ${row.isBold ? 'font-semibold' : ''} ${isNegative(row.comparisons.prevYearAnnual) ? 'text-red-600' : ''}`}>
                    {formatValue(row.comparisons.prevYearAnnual, row.format, false, true)}
                  </td>
                )}

                {/* 월별 값 (토글에 따라 표시/숨김) */}
                {!monthsCollapsed && row.values.map((value, colIndex) => {
                  // CF: 합계 컬럼(index 12)과 YoY(index 13)는 여기서 제외 (나중에 따로 렌더링)
                  if (isCashFlow && colIndex >= 12) {
                    return null;
                  }
                  // 2026년 재무상태표: 1~12월 표시 (index 12 이상만 스킵)
                  if (isBalanceSheet && currentYear === 2026 && colIndex > 11) {
                    return null;
                  }
                  const isValueOk = value === null || Math.abs(value) < 10;
                  // 손익계산서: 월 셀에 전년대비 증감(금액·%) 인라인 표시 — 분기 셀과 동일 패턴
                  const isPL = !isBalanceSheet && !isCashFlow;
                  if (isPL && row.comparisons) {
                    const prevValue = row.comparisons.prevYearMonthly?.[colIndex] ?? null;
                    const monthYoY = (value !== null && prevValue !== null) ? value - prevValue : null;
                    const monthYoYPercent = (value !== null && prevValue !== null && prevValue !== 0)
                      ? value / prevValue
                      : null;
                    const isProfitTurnaroundMonth = row.account === '영업이익(관리식)'
                      && value !== null && prevValue !== null
                      && value > 0 && prevValue < 0;
                    const isRatioRow = row.account === '영업이익률(관리식)' || row.account === '영업이익률(재무식)' || row.account === '영업이익률(IFRS)' || row.account === '(Tag 대비 원가율)';
                    return (
                      <td
                        key={`month-${colIndex}`}
                        className={`border border-gray-200 px-4 py-2 text-right ${getHighlightClass(row.isHighlight)} ${row.isBold ? 'font-semibold' : ''}`}
                      >
                        <div className="flex flex-col items-end">
                          <div className={isNegative(value) ? 'text-red-600' : ''}>
                            {formatValue(value, row.format, false, !row.isCalculated)}
                          </div>
                          <div className="text-xs leading-tight mt-0.5">
                            <span className={isNegative(monthYoY) ? 'text-red-600' : monthYoY !== null && monthYoY > 0 ? 'text-green-600' : ''}>
                              {formatValue(monthYoY, row.format, true, false)}
                            </span>
                            {isProfitTurnaroundMonth ? (
                              <>
                                <span className="mx-1">,</span>
                                <span className="text-green-600 font-semibold">흑자전환</span>
                              </>
                            ) : monthYoYPercent !== null && !isRatioRow && (
                              <>
                                <span className="mx-1">,</span>
                                <span className={monthYoYPercent < 1 ? 'text-red-600' : monthYoYPercent > 1 ? 'text-green-600' : ''}>
                                  {formatPercent(monthYoYPercent, false, false, 0)}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </td>
                    );
                  }
                  return (
                    <td
                      key={`month-${colIndex}`}
                      className={`
                        border border-gray-200 px-4 py-2 text-right
                        ${isBalanceCheck && isValueOk ? 'bg-green-100' : ''}
                        ${isBalanceCheck && !isValueOk ? 'bg-red-100' : ''}
                        ${!isBalanceCheck ? getHighlightClass(row.isHighlight) : ''}
                        ${row.isBold ? 'font-semibold' : ''}
                        ${isNegative(value) ? 'text-red-600' : ''}
                      `}
                    >
                      {formatValue(value, row.format, false, isBalanceSheet ? true : !row.isCalculated)}
                    </td>
                  );
                })}

                {/* CF: 합계 컬럼 (2025년) */}
                {isCashFlow && (
                  <>
                    <td
                      className={`
                        border border-gray-200 px-4 py-2 text-right
                        ${getHighlightClass(row.isHighlight)}
                        ${row.isBold ? 'font-semibold' : ''}
                        ${isNegative(row.values[12]) ? 'text-red-600' : ''}
                      `}
                    >
                      {formatValue(row.values[12], row.format, false, !row.isCalculated)}
                    </td>
                    {/* CF: YoY 컬럼 (25년 - 24년) */}
                    <td
                      className={`
                        border border-gray-200 px-4 py-2 text-right
                        ${getHighlightClass(row.isHighlight)}
                        ${row.isBold ? 'font-semibold' : ''}
                        ${isNegative(row.values[13]) ? 'text-red-600' : ''}
                      `}
                    >
                      {formatValue(row.values[13], row.format, true, false)}
                    </td>
                  </>
                )}

                {/* 빈 컬럼들 및 비교 컬럼 (PL 2025년 또는 BS 2025/2026, 항상 표시) */}
                {showComparisons && row.comparisons && (() => {
                  // displayColumns를 순회하면서 비교 컬럼 부분 렌더링
                  // 계정과목과 월별 데이터는 이미 렌더링되었으므로 건너뛰기
                  let startIndex = 1; // 계정과목 다음부터
                  if (!monthsCollapsed) {
                    // 월별 데이터가 있으면 건너뛰기
                    while (startIndex < displayColumns.length && displayColumns[startIndex] !== '' && !comparisonColumns.includes(displayColumns[startIndex])) {
                      startIndex++;
                    }
                  }
                  
                  const renderComparisonCells = () => {
                    const cells: JSX.Element[] = [];
                    
                    // 브랜드 컬럼의 섹션을 판별하는 헬퍼 함수 (명시적 앵커 기반 역순 탐색)
                    const getSectionForBrand = (colIndex: number, displayColumns: string[]): 'month' | 'ytd' | 'annual' => {
                      // colIndex 이전의 컬럼을 역순으로 탐색
                      for (let i = colIndex - 1; i >= 0; i--) {
                        const prevCol = displayColumns[i];
                        // 앵커: 당년 컬럼만 사용 (YoY 컬럼은 제외)
                        if (prevCol === comparisonColumns[1]) {
                          return 'month'; // 당년(기준월)
                        }
                        if (prevCol === comparisonColumns[3]) {
                          return 'ytd'; // 당년YTD (손익계산서는 [3])
                        }
                        if (prevCol === comparisonColumns[5]) {
                          return 'annual'; // 25년연간 (손익계산서는 [5])
                        }
                      }
                      return 'month'; // 기본값 (안전장치)
                    };
                    
                    // 2026년 재무상태표
                    if (isBalanceSheet && currentYear === 2026 && row.comparisons) {
                      const cellClass = (val: number | null) =>
                        `border border-gray-200 px-4 py-2 text-right ${isBalanceCheck ? (val === null || Math.abs(val) < 10 ? 'bg-green-100' : 'bg-red-100') : getHighlightClass(row.isHighlight)} ${row.isBold ? 'font-semibold' : ''} ${isNegative(val) ? 'text-red-600' : ''}`;
                      const compCellClass = (val: number | null) =>
                        `border border-gray-200 px-4 py-2 text-right bg-navy/10 ${isBalanceCheck ? (val === null || Math.abs(val) < 10 ? 'bg-green-100' : 'bg-red-100') : getHighlightClass(row.isHighlight)} ${row.isBold ? 'font-semibold' : ''} ${isNegative(val) ? 'text-red-600' : ''}`;
                      if (monthsCollapsed) {
                        // 접힌 2행 헤더 뷰: 2025년기말 | 당월계획 | 당월실적 | 당월YoY | 기말계획 | 기말실적 | 계획비 | 전년비
                        cells.push(
                          <td key="prev-annual" className={cellClass(row.comparisons.prevYearAnnual)}>
                            {formatValue(row.comparisons.prevYearAnnual, row.format, false, true)}
                          </td>
                        );
                        cells.push(
                          <td key="month-plan" className={cellClass(row.comparisons.currMonthPlan ?? null)}>
                            {formatValue(row.comparisons.currMonthPlan ?? null, row.format, false, true)}
                          </td>
                        );
                        cells.push(
                          <td key="month-actual" className={cellClass(row.comparisons.currYearMonth ?? null)}>
                            {formatValue(row.comparisons.currYearMonth ?? null, row.format, false, true)}
                          </td>
                        );
                        cells.push(
                          <td key="month-yoy" className={cellClass(row.comparisons.monthYoYActual ?? null)}>
                            {formatValue(row.comparisons.monthYoYActual ?? null, row.format, true, false)}
                          </td>
                        );
                        cells.push(
                          <td key="annual-plan" className={compCellClass(row.comparisons.annualPlan ?? null)}>
                            {formatValue(row.comparisons.annualPlan ?? null, row.format, false, true)}
                          </td>
                        );
                        cells.push(
                          <td key="annual-actual" className={compCellClass(row.comparisons.currYearAnnual)}>
                            {formatValue(row.comparisons.currYearAnnual, row.format, false, true)}
                          </td>
                        );
                        cells.push(
                          <td key="plan-vs-actual" className={compCellClass(row.comparisons.planVsActual ?? null)}>
                            {formatValue(row.comparisons.planVsActual ?? null, row.format, true, false)}
                          </td>
                        );
                        cells.push(
                          <td key="annual-yoy" className={compCellClass(row.comparisons.annualYoY)}>
                            {formatValue(row.comparisons.annualYoY, row.format, true, false)}
                          </td>
                        );
                      } else {
                        // 펼침: 25년기말·12개월은 이미 위에서 렌더됨 → 기말실적(예상), 전년비
                        cells.push(
                          <td key="curr-annual" className={cellClass(row.comparisons.currYearAnnual)}>
                            {formatValue(row.comparisons.currYearAnnual, row.format, false, true)}
                          </td>
                        );
                        cells.push(
                          <td key="annual-yoy" className={cellClass(row.comparisons.annualYoY)}>
                            {formatValue(row.comparisons.annualYoY, row.format, true, false)}
                          </td>
                        );
                      }
                      return cells;
                    }
                    
                    // displayColumns를 순회하면서 비교 컬럼 렌더링
                    // row.comparisons가 존재하는지 확인
                    if (!row.comparisons) {
                      return cells;
                    }
                    
                    for (let i = startIndex; i < displayColumns.length; i++) {
                      const col = displayColumns[i];

                      if (col === '') {
                        cells.push(
                          <td key={`spacer-${i}`} className="bg-white border-0" style={{ minWidth: '16px', maxWidth: '16px', padding: 0 }}></td>
                        );
                        continue;
                      }

                      // 분기보기 컬럼 (1Q, 2Q, 3Q, 4Q — 당년만 + YoY 인라인)
                      if (quarterlyMode && quarterlyColumns.includes(col)) {
                        const q = quarterlyColumns.indexOf(col); // 0..3
                        const currQ = getQuarterValue(row, q, true);
                        const prevQ = getQuarterValue(row, q, false);
                        const qYoY = (currQ !== null && prevQ !== null) ? currQ - prevQ : null;
                        const qYoYPercent = (currQ !== null && prevQ !== null && prevQ !== 0)
                          ? currQ / prevQ
                          : null;
                        const isProfitTurnaround = row.account === '영업이익(관리식)'
                          && currQ !== null && prevQ !== null
                          && currQ > 0 && prevQ < 0;
                        const isRatioRow = row.account === '영업이익률(관리식)' || row.account === '영업이익률(재무식)' || row.account === '영업이익률(IFRS)' || row.account === '(Tag 대비 원가율)';
                        cells.push(
                          <td key={`q-${i}`} className={`border border-gray-200 px-4 py-2 text-right ${getHighlightClass(row.isHighlight)} ${row.isBold ? 'font-semibold' : ''}`}>
                            <div className="flex flex-col items-end">
                              <div className={isNegative(currQ) ? 'text-red-600' : ''}>
                                {formatValue(currQ, row.format, false, true)}
                              </div>
                              <div className="text-xs leading-tight mt-0.5">
                                <span className={isNegative(qYoY) ? 'text-red-600' : qYoY !== null && qYoY > 0 ? 'text-green-600' : ''}>
                                  {formatValue(qYoY, row.format, true, false)}
                                </span>
                                {isProfitTurnaround ? (
                                  <>
                                    <span className="mx-1">,</span>
                                    <span className="text-green-600 font-semibold">흑자전환</span>
                                  </>
                                ) : qYoYPercent !== null && !isRatioRow && (
                                  <>
                                    <span className="mx-1">,</span>
                                    <span className={qYoYPercent < 1 ? 'text-red-600' : qYoYPercent > 1 ? 'text-green-600' : ''}>
                                      {formatPercent(qYoYPercent, false, false, 0)}
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>
                          </td>
                        );
                        continue;
                      }

                      if (col === comparisonColumns[0]) {
                        // 전년(12월) - 브랜드별 컬럼 없음
                        cells.push(
                          <td key={`prev-month-${i}`} className={`border border-gray-200 px-4 py-2 text-right ${isBalanceCheck ? (row.comparisons.prevYearMonth === null || Math.abs(row.comparisons.prevYearMonth) < 10 ? 'bg-green-100' : 'bg-red-100') : getHighlightClass(row.isHighlight)} ${row.isBold ? 'font-semibold' : ''} ${isNegative(row.comparisons.prevYearMonth) ? 'text-red-600' : ''}`}>
                          {formatValue(row.comparisons.prevYearMonth, row.format, false, true)}
                        </td>
                        );
                      } else if (col === comparisonColumns[1]) {
                        // 당년(12월) - YoY 통합 표시 (손익계산서만)
                        if (isBalanceSheet) {
                          // 재무상태표는 기존대로
                          cells.push(
                            <td key={`curr-month-${i}`} className={`border border-gray-200 px-4 py-2 text-right ${isBalanceCheck ? (row.comparisons.currYearMonth === null || Math.abs(row.comparisons.currYearMonth) < 10 ? 'bg-green-100' : 'bg-red-100') : getHighlightClass(row.isHighlight)} ${row.isBold ? 'font-semibold' : ''} ${isNegative(row.comparisons.currYearMonth) ? 'text-red-600' : ''}`}>
                              {formatValue(row.comparisons.currYearMonth, row.format, false, true)}
                            </td>
                          );
                        } else {
                          // 손익계산서: YoY 통합 표시
                          const monthYoY = row.comparisons.monthYoY;
                          const monthYoYPercent = (row.comparisons.currYearMonth !== null && row.comparisons.prevYearMonth !== null && row.comparisons.prevYearMonth !== 0) 
                            ? row.comparisons.currYearMonth / row.comparisons.prevYearMonth 
                            : null;
                          // 영업이익 흑자전환 체크
                          const isProfitTurnaround = row.account === '영업이익(관리식)' 
                            && row.comparisons.currYearMonth !== null 
                            && row.comparisons.prevYearMonth !== null
                            && row.comparisons.currYearMonth > 0 
                            && row.comparisons.prevYearMonth < 0;
                          cells.push(
                            <td key={`curr-month-${i}`} className={`border border-gray-200 px-4 py-2 text-right ${getHighlightClass(row.isHighlight)} ${row.isBold ? 'font-semibold' : ''}`}>
                              <div className="flex flex-col items-end">
                                {/* 첫 줄: 금액 (현재 크기) */}
                                <div className={isNegative(row.comparisons.currYearMonth) ? 'text-red-600' : ''}>
                                  {formatValue(row.comparisons.currYearMonth, row.format, false, true)}
                                </div>
                                {/* 둘째 줄: YoY 금액, YoY 퍼센트 (2/3 크기) */}
                                <div className="text-xs leading-tight mt-0.5">
                                  <span className={isNegative(monthYoY) ? 'text-red-600' : monthYoY !== null && monthYoY > 0 ? 'text-green-600' : ''}>
                                    {formatValue(monthYoY, row.format, true, false)}
                                  </span>
                                  {isProfitTurnaround ? (
                                    <>
                                      <span className="mx-1">,</span>
                                      <span className="text-green-600 font-semibold">흑자전환</span>
                                    </>
                                  ) : monthYoYPercent !== null && row.account !== '영업이익률(관리식)' && row.account !== '영업이익률(재무식)' && row.account !== '(Tag 대비 원가율)' && (
                                    <>
                                      <span className="mx-1">,</span>
                                      <span className={monthYoYPercent < 1 ? 'text-red-600' : monthYoYPercent > 1 ? 'text-green-600' : ''}>
                                        {formatPercent(monthYoYPercent, false, false, 0)}
                                      </span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </td>
                          );
                        }
                      } else if (col === 'YoY(기준월)' && isBalanceSheet) {
                        // YoY(기준월) - 재무상태표만 (손익계산서는 당년 컬럼에 통합됨)
                        cells.push(
                          <td key={`month-yoy-${i}`} className={`border border-gray-200 px-4 py-2 text-right ${isBalanceCheck ? (row.comparisons.monthYoY === null || Math.abs(row.comparisons.monthYoY) < 10 ? 'bg-green-100' : 'bg-red-100') : getHighlightClass(row.isHighlight)} ${row.isBold ? 'font-semibold' : ''} ${isNegative(row.comparisons.monthYoY) ? 'text-red-600' : ''}`}>
                            {formatValue(row.comparisons.monthYoY, row.format, true, false)}
                          </td>
                        );
                      } else if (col === 'YoY(연간)' && isBalanceSheet) {
                        // YoY(연간) - 재무상태표만 (손익계산서는 당년 컬럼에 통합됨)
                        cells.push(
                          <td key={`annual-yoy-${i}`} className={`border border-gray-200 px-4 py-2 text-right ${isBalanceCheck ? (row.comparisons.annualYoY === null || Math.abs(row.comparisons.annualYoY) < 10 ? 'bg-green-100' : 'bg-red-100') : getHighlightClass(row.isHighlight)} ${row.isBold ? 'font-semibold' : ''} ${isNegative(row.comparisons.annualYoY) ? 'text-red-600' : ''}`}>
                            {formatValue(row.comparisons.annualYoY, row.format, true, false)}
                          </td>
                        );
                      } else if (col === comparisonColumns[2] && !isBalanceSheet) {
                        // 손익계산서: 전년YTD - 브랜드별 컬럼 없음
                        if (!hideYtd) {
                          cells.push(
                            <td key={`prev-ytd-${i}`} className={`border border-gray-200 px-4 py-2 text-right ${getHighlightClass(row.isHighlight)} ${row.isBold ? 'font-semibold' : ''} ${isNegative(row.comparisons.prevYearYTD) ? 'text-red-600' : ''}`}>
                              {formatValue(row.comparisons.prevYearYTD, row.format, false, true)}
                            </td>
                          );
                        }
                      } else if (col === comparisonColumns[3] && !isBalanceSheet) {
                        // 손익계산서: 당년YTD - YoY 통합 표시
                        if (!hideYtd) {
                          const ytdYoY = row.comparisons.ytdYoY;
                          const ytdYoYPercent = (row.comparisons.currYearYTD !== null && row.comparisons.prevYearYTD !== null && row.comparisons.prevYearYTD !== 0) 
                            ? row.comparisons.currYearYTD / row.comparisons.prevYearYTD 
                            : null;
                          // 영업이익 흑자전환 체크
                          const isProfitTurnaround = row.account === '영업이익(관리식)' 
                            && row.comparisons.currYearYTD !== null 
                            && row.comparisons.prevYearYTD !== null
                            && row.comparisons.currYearYTD > 0 
                            && row.comparisons.prevYearYTD < 0;
                          cells.push(
                            <td key={`curr-ytd-${i}`} className={`border border-gray-200 px-4 py-2 text-right ${getHighlightClass(row.isHighlight)} ${row.isBold ? 'font-semibold' : ''}`}>
                              <div className="flex flex-col items-end">
                                {/* 첫 줄: 금액 (현재 크기) */}
                                <div className={isNegative(row.comparisons.currYearYTD) ? 'text-red-600' : ''}>
                                  {formatValue(row.comparisons.currYearYTD, row.format, false, true)}
                                </div>
                                {/* 둘째 줄: YoY 금액, YoY 퍼센트 (2/3 크기) */}
                                <div className="text-xs leading-tight mt-0.5">
                                  <span className={isNegative(ytdYoY) ? 'text-red-600' : ytdYoY !== null && ytdYoY > 0 ? 'text-green-600' : ''}>
                                    {formatValue(ytdYoY, row.format, true, false)}
                                  </span>
                                  {isProfitTurnaround ? (
                                    <>
                                      <span className="mx-1">,</span>
                                      <span className="text-green-600 font-semibold">흑자전환</span>
                                    </>
                                  ) : ytdYoYPercent !== null && row.account !== '영업이익률(관리식)' && row.account !== '영업이익률(재무식)' && row.account !== '(Tag 대비 원가율)' && (
                                    <>
                                      <span className="mx-1">,</span>
                                      <span className={ytdYoYPercent < 1 ? 'text-red-600' : ytdYoYPercent > 1 ? 'text-green-600' : ''}>
                                        {formatPercent(ytdYoYPercent, false, false, 0)}
                                      </span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </td>
                          );
                        }
                      } else if (col === comparisonColumns[isBalanceSheet ? 3 : 4]) {
                        // 재무상태표: 24년기말 ([3]), 손익계산서: 24년연간 ([4])
                        cells.push(
                          <td key={`prev-annual-${i}`} className={`border border-gray-200 px-4 py-2 text-right ${isBalanceCheck ? (row.comparisons.prevYearAnnual === null || Math.abs(row.comparisons.prevYearAnnual) < 10 ? 'bg-green-100' : 'bg-red-100') : getHighlightClass(row.isHighlight)} ${row.isBold ? 'font-semibold' : ''} ${isNegative(row.comparisons.prevYearAnnual) ? 'text-red-600' : ''}`}>
                          {formatValue(row.comparisons.prevYearAnnual, row.format, false, true)}
                        </td>
                        );
                      } else if (col === comparisonColumns[isBalanceSheet ? 4 : 5]) {
                        // 재무상태표: 25년기말 ([4]), 손익계산서: 25년연간 ([5])
                        if (isBalanceSheet) {
                          // 재무상태표는 기존대로
                          cells.push(
                            <td key={`curr-annual-${i}`} className={`border border-gray-200 px-4 py-2 text-right ${isBalanceCheck ? (row.comparisons.currYearAnnual === null || Math.abs(row.comparisons.currYearAnnual) < 10 ? 'bg-green-100' : 'bg-red-100') : getHighlightClass(row.isHighlight)} ${row.isBold ? 'font-semibold' : ''} ${isNegative(row.comparisons.currYearAnnual) ? 'text-red-600' : ''}`}>
                              {formatValue(row.comparisons.currYearAnnual, row.format, false, true)}
                            </td>
                          );
                        } else {
                          // 손익계산서: 25년연간 - YoY 통합 표시
                          const annualYoY = row.comparisons.annualYoY;
                          const annualYoYPercent = (row.comparisons.currYearAnnual !== null && row.comparisons.prevYearAnnual !== null && row.comparisons.prevYearAnnual !== 0) 
                            ? row.comparisons.currYearAnnual / row.comparisons.prevYearAnnual 
                            : null;
                          // 영업이익 흑자전환 체크
                          const isProfitTurnaround = row.account === '영업이익(관리식)' 
                            && row.comparisons.currYearAnnual !== null 
                            && row.comparisons.prevYearAnnual !== null
                            && row.comparisons.currYearAnnual > 0 
                            && row.comparisons.prevYearAnnual < 0;
                          cells.push(
                            <td key={`curr-annual-${i}`} className={`border border-gray-200 px-4 py-2 text-right ${getHighlightClass(row.isHighlight)} ${row.isBold ? 'font-semibold' : ''}`}>
                              <div className="flex flex-col items-end">
                                {/* 첫 줄: 금액 (현재 크기) */}
                                <div className={isNegative(row.comparisons.currYearAnnual) ? 'text-red-600' : ''}>
                                  {formatValue(row.comparisons.currYearAnnual, row.format, false, true)}
                                </div>
                                {/* 둘째 줄: YoY 금액, YoY 퍼센트 (2/3 크기) */}
                                <div className="text-xs leading-tight mt-0.5">
                                  <span className={isNegative(annualYoY) ? 'text-red-600' : annualYoY !== null && annualYoY > 0 ? 'text-green-600' : ''}>
                                    {formatValue(annualYoY, row.format, true, false)}
                                  </span>
                                  {isProfitTurnaround ? (
                                    <>
                                      <span className="mx-1">,</span>
                                      <span className="text-green-600 font-semibold">흑자전환</span>
                                    </>
                                  ) : annualYoYPercent !== null && row.account !== '영업이익률(관리식)' && row.account !== '영업이익률(재무식)' && row.account !== '(Tag 대비 원가율)' && (
                                    <>
                                      <span className="mx-1">,</span>
                                      <span className={annualYoYPercent < 1 ? 'text-red-600' : annualYoYPercent > 1 ? 'text-green-600' : ''}>
                                        {formatPercent(annualYoYPercent, false, false, 0)}
                                      </span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </td>
                          );
                        }
                      } else if (brands.includes(col)) {
                        // 브랜드별 통합 컬럼 (금액 + YoY 한 셀에 두 줄)
                        const brand = col;
                        let currValue: number | null = null;
                        let prevValue: number | null = null;
                        
                        // 명시적 앵커 기반으로 섹션 판별
                        const section = getSectionForBrand(i, displayColumns);
                        if (row.brandComparisons) {
                          if (section === 'month') {
                            currValue = row.brandComparisons.month.currYear[brand.toLowerCase()] ?? null;
                            prevValue = row.brandComparisons.month.prevYear[brand.toLowerCase()] ?? null;
                          } else if (section === 'ytd') {
                            currValue = row.brandComparisons.ytd.currYear[brand.toLowerCase()] ?? null;
                            prevValue = row.brandComparisons.ytd.prevYear[brand.toLowerCase()] ?? null;
                          } else if (section === 'annual') {
                            currValue = row.brandComparisons.annual.currYear[brand.toLowerCase()] ?? null;
                            prevValue = row.brandComparisons.annual.prevYear[brand.toLowerCase()] ?? null;
                          }
                        }
                        
                        // YoY 계산
                        const brandYoY = (currValue !== null && prevValue !== null) ? currValue - prevValue : null;
                        
                        // YoY 퍼센트 계산 (비율 방식: 당년 / 전년)
                        let brandYoYPercent: number | null = null;
                        if (currValue !== null && prevValue !== null && prevValue !== 0) {
                          brandYoYPercent = currValue / prevValue; // 1.11 = 111%
                        }
                        
                        // 마지막 브랜드(SUPRA)가 아닌 경우 오른쪽에 구분선 추가
                        const isLastBrand = brand.toUpperCase() === 'SUPRA';
                        const borderClass = isLastBrand ? 'border-r border-gray-200' : 'border-r-2 border-gray-200';
                        
                        cells.push(
                          <td key={`brand-${brand}-${i}`} className={`border border-gray-200 ${borderClass} px-4 py-2 text-right bg-white ${getHighlightClass(row.isHighlight)} ${row.isBold ? 'font-semibold' : ''}`}>
                            <div className="flex flex-col items-end">
                              {/* 첫 줄: 금액 (현재 크기) */}
                              <div className={isNegative(currValue) ? 'text-red-600' : ''}>
                                {formatValue(currValue, row.format, false, true)}
                              </div>
                              {/* 둘째 줄: YoY 금액, YoY 퍼센트 (2/3 크기) */}
                              <div className="text-xs leading-tight mt-0.5">
                                <span className={isNegative(brandYoY) ? 'text-red-600' : brandYoY !== null && brandYoY > 0 ? 'text-green-600' : ''}>
                                  {formatValue(brandYoY, row.format, true, false)}
                                </span>
                                {brandYoYPercent !== null && (
                                  <>
                                    <span className="mx-1">,</span>
                                    <span className={brandYoYPercent < 1 ? 'text-red-600' : brandYoYPercent > 1 ? 'text-green-600' : ''}>
                                      {formatPercent(brandYoYPercent, false, false, 0)}
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>
                          </td>
                        );
                      }
                    }
                    
                    return cells;
                  };
                  
                  return <>{renderComparisonCells()}</>;
                })()}

                {/* 비고 열 */}
                {showRemarks && (
                  <td className={`border border-gray-200 px-3 py-2 ${getHighlightClass(row.isHighlight)}`}>
                    <input
                      type="text"
                      value={remarks?.get(row.account) || autoRemarks?.[row.account] || ''}
                      onChange={(e) => onRemarkChange?.(row.account, e.target.value)}
                      placeholder="비고 입력..."
                      className="w-full px-2 py-1 text-xs bg-transparent focus:outline-none focus:bg-white/50 focus:border focus:border-blue-300 focus:rounded transition-colors"
                    />
                  </td>
                )}
              </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
