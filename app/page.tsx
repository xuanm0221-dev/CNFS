'use client';

import { useState, useEffect, useMemo } from 'react';
import Tabs from '@/components/Tabs';
import YearTabs from '@/components/YearTabs';
import BrandTabs from '@/components/BrandTabs';
import BaseMonthSelector from '@/components/BaseMonthSelector';
import FinancialTable from '@/components/FinancialTable';
import CashFlowHierarchyTable from '@/components/CashFlowHierarchyTable';
import CashBorrowingBalance from '@/components/CashBorrowingBalance';
import CFWorkingCapitalTable from '@/components/CFWorkingCapitalTable';
import DealerCreditRecoveryTable from '@/components/DealerCreditRecoveryTable';
import CFExplanationPanel from '@/components/CFExplanationPanel';
import CreditStatus from '@/components/CreditStatus';
import BSAnalysis from '@/components/BSAnalysis';
import ExecutiveSummary from '@/components/ExecutiveSummary';
import { TableRow, CreditData, CreditRecoveryData, TabType, ExecutiveSummaryData } from '@/lib/types';
import type { CFExplanationNumbers } from '@/lib/cf-explanation-data';
import InventoryDashboard from '@/components/inventory/InventoryDashboard';
import PLForecastTab from '@/components/pl-forecast/PLForecastTab';
import PLCashFlowTab from '@/components/pl-forecast/PLCashFlowTab';

export default function Home() {
  const [activeTab, setActiveTab] = useState<number>(2);
  const [inventoryTabMounted, setInventoryTabMounted] = useState<boolean>(true);
  const [plYear, setPlYear] = useState<number>(2026);
  const [plBrand, setPlBrand] = useState<string | null>(null); // null=踰뺤씤, 'mlb', 'kids' ??
  const [bsYear, setBsYear] = useState<number>(2026);
  const [cfYear, setCfYear] = useState<number>(2026);
  const [baseMonth, setBaseMonth] = useState<number>(3); // 기준월 (기본 3월, 2026년 기준달)
  const [bsMonthsCollapsed, setBsMonthsCollapsed] = useState<boolean>(true); // 재무상태표 & 운전자본분석 월별 접기
  const [cfMonthsCollapsed, setCfMonthsCollapsed] = useState<boolean>(true); // 현금흐름표 월별 접기 (2025년 기준달 미정)
  // 브랜드별 손익 비교컬럼 표시 여부 (법인 상단용)
  const [hideYtd, setHideYtd] = useState<boolean>(true); // YTD 숨기기 (기준월 12월일 때 기본값 숨김)
  const [summaryData, setSummaryData] = useState<ExecutiveSummaryData | null>(null);
  const [plData, setPlData] = useState<TableRow[] | null>(null);
  const [bsData, setBsData] = useState<TableRow[] | null>(null);
  const [previousBsData, setPreviousBsData] = useState<TableRow[] | null>(null);
  const [workingCapitalData, setWorkingCapitalData] = useState<TableRow[] | null>(null);
  const [bsPlanMonth, setBsPlanMonth] = useState<number | null>(null);
  const [cfData, setCfData] = useState<TableRow[] | null>(null);
  const [cfHierarchyData, setCfHierarchyData] = useState<{ rows: import('@/app/api/fs/cf-hierarchy/route').CFHierarchyApiRow[]; columns: string[]; hasPlan?: boolean } | null>(null);
  const [cfHierarchyLoading, setCfHierarchyLoading] = useState(false);
  const [cashBorrowingData, setCashBorrowingData] = useState<{
    year: number;
    columns: string[];
    cash: number[];
    borrowing: number[];
    prevCash?: number[];
    prevBorrowing?: number[];
    cashNMonthPlan?: number;
    borrowingNMonthPlan?: number;
  } | null>(null);
  const [cfWorkingCapitalData, setCfWorkingCapitalData] = useState<TableRow[] | null>(null);
  const [creditRecoveryData, setCreditRecoveryData] = useState<CreditRecoveryData | null>(null);
  const [creditData, setCreditData] = useState<CreditData | null>(null);
  const [cfSummaryNumbers, setCfSummaryNumbers] = useState<CFExplanationNumbers | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [bsLoadStep, setBsLoadStep] = useState<number>(0);
  const [bsTotalSteps, setBsTotalSteps] = useState<number>(1);
  const [cfLoadStep, setCfLoadStep] = useState<number>(0);
  const [cfTotalSteps, setCfTotalSteps] = useState<number>(2);
  const [cfLoadingLabel, setCfLoadingLabel] = useState<string>('');
  
  // 비고 데이터 타입
  const [bsRemarks, setBsRemarks] = useState<Map<string, string>>(new Map());
  const [wcRemarks, setWcRemarks] = useState<Map<string, string>>(new Map());
  const [wcRemarksAuto, setWcRemarksAuto] = useState<{ [key: string]: string } | null>(null);

  // 비고 데이터 로드 (초기상태 진입 시 API에서 로드)
  const loadRemarks = async (type: 'bs' | 'wc') => {
    try {
      const response = await fetch(`/api/remarks?type=${type}`);
      if (response.ok) {
        const data = await response.json();
        if (data.remarks) {
          const remarksMap = new Map<string, string>(Object.entries(data.remarks) as [string, string][]);
          if (type === 'bs') {
            setBsRemarks(remarksMap);
          } else {
            setWcRemarks(remarksMap);
          }
        }
      }
    } catch (error) {
      console.error('비고 로드 실패:', error);
    }
  };

  useEffect(() => {
    if (activeTab === 2) {
      loadRemarks('bs');
      loadRemarks('wc');
    }
  }, [activeTab]);

  useEffect(() => {
    fetch('/api/cf-explanation/numbers')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data) setCfSummaryNumbers(data as CFExplanationNumbers); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (activeTab === 5) {
      setInventoryTabMounted(true);
    }
  }, [activeTab]);

  // 비고 저장 함수 (디바운스)
  const saveRemarkDebounced = useMemo(() => {
    const timeouts: { [key: string]: NodeJS.Timeout } = {};
    
    return async (account: string, remark: string, type: 'bs' | 'wc') => {
      const key = `${type}-${account}`;
      if (timeouts[key]) {
        clearTimeout(timeouts[key]);
      }
      
      timeouts[key] = setTimeout(async () => {
        try {
          const response = await fetch('/api/remarks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ account, remark, type })
          });
          
          const data = await response.json();
          
          if (!data.success) {
            console.error('비고 저장 실패:', data.error || 'Unknown error');
            // 오류가 발생해도 사용자 경험을 위해 무시 (디바운스 로그)
          } else {
            console.log('비고 저장 성공:', account);
          }
        } catch (error) {
          console.error('비고 저장 실패:', error);
        }
      }, 1000); // 1초 디바운스
    };
  }, []);

  // 비고 초기상태로 저장 (KV 키값과 함께 로드)
  const resetRemarksData = async () => {
    try {
      setError(null);
      const [resBs, resWc] = await Promise.all([
        fetch('/api/remarks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'bs', reset: true }),
        }),
        fetch('/api/remarks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'wc', reset: true }),
        }),
      ]);
      const dataBs = await resBs.json();
      const dataWc = await resWc.json();
      if (!dataBs.success || !dataWc.success) {
        setError('비고 초기값 불러오기에 실패했습니다.');
        return;
      }
      await loadRemarks('bs');
      await loadRemarks('wc');
      alert('초기값으로 리셋했습니다.');
    } catch (err) {
      console.error(err);
      setError('비고 초기값 불러오기에 실패했습니다.');
    }
  };

  // 비고 삭제 기능
  const saveRemarksToServer = async () => {
    try {
      setError(null);
      const [resBs, resWc] = await Promise.all([
        fetch('/api/remarks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'bs', remarks: Object.fromEntries(bsRemarks) }),
        }),
        fetch('/api/remarks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'wc', remarks: Object.fromEntries(wcRemarks) }),
        }),
      ]);
      const dataBs = await resBs.json();
      const dataWc = await resWc.json();
      if (!dataBs.success || !dataWc.success) {
        setError('비고 저장에 실패했습니다.');
        return;
      }
      alert('저장됩니다.');
    } catch (err) {
      console.error(err);
      setError('비고 저장에 실패했습니다.');
    }
  };

  // 釉뚮옖??紐⑸줉
  const brands = [
    { id: null, label: '전체' },
    { id: 'mlb', label: 'MLB' },
    { id: 'kids', label: 'KIDS' },
    { id: 'discovery', label: 'DISCOVERY' },
    { id: 'duvetica', label: 'DUVETICA' },
    { id: 'supra', label: 'SUPRA' },
  ];

  const tabs = ['경영요약', '손익계산서', '재무상태표', '현금흐름표', '여신사용현황', '재고자산 (sim)', 'PL (sim)', 'CF (sim)'];
  const tabGroups = useMemo(
    () => [
      { id: 'group1', label: '재무제표', tabIndexes: [0, 1, 2, 3] },
      { id: 'group2', label: '자금월보', tabIndexes: [5, 6, 7] },
    ],
    []
  );
  const tabTypes: TabType[] = ['SUMMARY', 'PL', 'BS', 'CF', 'CREDIT', 'INVENTORY', 'PL', 'PL_CF'];

  // 데이터 로딩
  const loadData = async (type: TabType, year?: number, month?: number, brand?: string | null) => {
    setLoading(true);
    setError(null);
    if (type === 'BS') {
      const total = (year === 2025 || year === 2026) ? 2 : 1;
      setBsTotalSteps(total);
      setBsLoadStep(1);
    }

    try {
      let url = '';
      if (type === 'PL') {
        // 釉뚮옖?쒕퀎 ?먮뒗 踰뺤씤 PL
        if (brand) {
          url = `/api/fs/pl/brand?brand=${brand}&year=${year}`;
          if ((year === 2025 || year === 2026) && month !== undefined) {
            url += `&baseMonth=${month}`;
          }
        } else {
          url = `/api/fs/pl?year=${year}`;
          if ((year === 2025 || year === 2026) && month !== undefined) {
            url += `&baseMonth=${month}`;
          }
        }
      } else if (type === 'BS') {
        url = `/api/fs/bs?year=${year}`;
      } else if (type === 'CF') {
        url = `/api/fs/cf?year=${year}`;
      } else if (type === 'CREDIT') {
        url = `/api/fs/credit`;
      }

      if (!url) return;

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('데이터를 불러올 수 없습니다.');
      }

      const result = await response.json();

      if (type === 'PL') {
        setPlData(result.rows);
      } else if (type === 'BS') {
        setBsData(result.rows);
        setWorkingCapitalData(result.workingCapital || null);
        setWcRemarksAuto(result.wcRemarksAuto || null);
        setBsPlanMonth(result.planMonth ?? null);
        
        // 전년도 데이터 로드 (2025, 2026년인 경우)
        if (year === 2025 || year === 2026) {
          const prevYear = year - 1;
          setBsLoadStep(2);
          try {
            const prevResponse = await fetch(`/api/fs/bs?year=${prevYear}`);
            if (prevResponse.ok) {
              const prevResult = await prevResponse.json();
              setPreviousBsData(prevResult.rows);
            }
          } catch (err) {
          console.error('전년도 BS 데이터 로드 실패:', err);
            setPreviousBsData(null);
          }
        } else {
          setPreviousBsData(null);
        }
      } else if (type === 'CF') {
        setCfData(result.rows);
      } else if (type === 'CREDIT') {
        setCreditData(result);
      }
    } catch (err) {
      console.error(err);
      setError('데이터를 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 경영요약 데이터 로드 (캐시 KV 1단계 후 fs/summary 또는 localStorage 또는 파일)
  const loadSummaryData = async () => {
    try {
      setLoading(true);
      setError(null);

      // 1단계: 캐시 경영요약 (GET /api/executive-summary) 또는 최근 5개 캐시에서 사용
      try {
        const response = await fetch('/api/executive-summary');
        if (response.ok) {
          const result = await response.json();
          const d = result?.data;
          const hasRightSections =
            d?.sections &&
            typeof d.sections === 'object' &&
            Array.isArray((d.sections as Record<string, unknown>)['주요성과']) &&
            Array.isArray((d.sections as Record<string, unknown>)['결론']);
          if (d?.title && hasRightSections) {
            setSummaryData(d);
            localStorage.setItem('executive-summary', JSON.stringify(d));
            setLoading(false);
            return;
          }
        }
      } catch (apiErr) {
        console.log('경영요약 캐시 API 실패, 다음 단계 시도:', apiErr);
      }

      // 2단계: API에서 생성 (2026년 기준 계획)
      try {
        const response = await fetch('/api/fs/summary');
        if (response.ok) {
          const result = await response.json();
          if (result && result.title) {
            setSummaryData(result);
            localStorage.setItem('executive-summary', JSON.stringify(result));
            setLoading(false);
            return;
          }
        } else {
          const errBody = await response.json().catch(() => ({}));
          console.error('경영요약 API 실패:', response.status, errBody);
        }
      } catch (apiErr) {
        console.log('경영요약 API 실패, 캐시/파일에서 로드 시도:', apiErr);
      }

      // 3단계: localStorage에서 확인
      const savedData = localStorage.getItem('executive-summary');
      if (savedData) {
        try {
          const parsed = JSON.parse(savedData);
          setSummaryData(parsed);
          setLoading(false);
          return;
        } catch (parseErr) {
          console.error('localStorage 파싱 실패:', parseErr);
        }
      }

      // 4단계: 프로젝트 기본 파일에서 불러오기
      try {
        const fileResponse = await fetch('/data/executive-summary.json');
        if (fileResponse.ok) {
          const fileData = await fileResponse.json();
          setSummaryData(fileData);
          localStorage.setItem('executive-summary', JSON.stringify(fileData));
          setLoading(false);
          return;
        }
      } catch (fileErr) {
        console.log('프로젝트 기본 파일 없음.');
      }

      setError('경영요약 데이터를 불러올 수 없습니다.');
    } catch (err) {
      console.error(err);
      setError('경영요약 데이터를 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 경영요약 초기상태로 저장
  const resetSummaryData = async () => {
    try {
      // localStorage 초기화
      localStorage.removeItem('executive-summary');
      
      // API에서 다시 불러오기
      setSummaryData(null);
      setLoading(true);
      const response = await fetch('/api/fs/summary');
      if (!response.ok) {
        throw new Error('경영요약 데이터를 불러올 수 없습니다.');
      }
      const result = await response.json();
      setSummaryData(result);
      // localStorage에도 저장
      localStorage.setItem('executive-summary', JSON.stringify(result));
      alert('초기값으로 리셋했습니다.');
    } catch (err) {
      console.error(err);
      setError('초기값 불러오기에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // CF 변경사항 데이터 로드
  useEffect(() => {
    const currentType = tabTypes[activeTab];
    
    if (currentType === 'SUMMARY' && !summaryData) {
      loadSummaryData();
    } else if (currentType === 'PL' && !plData) {
      if (plBrand === null) {
        loadBrandBreakdownData();
      } else {
        loadData('PL', plYear, baseMonth, plBrand);
      }
    } else if (currentType === 'BS' && !bsData) {
      loadData('BS', bsYear);
    } else if (currentType === 'CF') {
      setCfMonthsCollapsed(true);
    } else if (currentType === 'CREDIT') {
      if (!creditData) loadData('CREDIT');
      if (!creditRecoveryData) {
        fetch('/api/annual-plan/credit-recovery?baseYearMonth=26.03')
          .then((r) => (r.ok ? r.json() : null))
          .then((res: { data?: CreditRecoveryData } | null) => {
            if (res?.data) setCreditRecoveryData(res.data);
          })
          .catch(() => {});
      }
    }
  }, [activeTab]);

  // 계도 변경사항 데이터 요청
  useEffect(() => {
    if (tabTypes[activeTab] === 'PL') {
      if (plBrand === null) {
        loadBrandBreakdownData();
      } else {
        loadData('PL', plYear, baseMonth, plBrand);
      }
    }
  }, [plYear]);

  useEffect(() => {
    if (tabTypes[activeTab] === 'BS') {
      loadData('BS', bsYear);
    }
  }, [bsYear]);

  useEffect(() => {
    if (tabTypes[activeTab] === 'CF') {
      setCfMonthsCollapsed(true);
      setCfHierarchyLoading(true);
      if (cfYear !== 2026) {
        setCfWorkingCapitalData(null);
        setCreditRecoveryData(null);
      }
      const cfTotal = cfYear === 2026 ? 4 : 2;
      setCfTotalSteps(cfTotal);
      setCfLoadStep(0);
      setCfLoadingLabel('');
      const makeCfFetch = (promise: Promise<Response>, label: string) =>
        promise.then((r) => r.ok ? r.json() : null).then((data) => {
          setCfLoadStep((prev) => prev + 1);
          setCfLoadingLabel(label);
          return data;
        });
      const fetches: Promise<unknown>[] = [
        makeCfFetch(fetch(`/api/fs/cf-hierarchy?year=${cfYear}`), '현금흐름 계층 데이터'),
        makeCfFetch(fetch(`/api/fs/cash-borrowing?year=${cfYear}`), '현금차입 잔액'),
      ];
      if (cfYear === 2026) {
        fetches.push(makeCfFetch(fetch('/api/fs/bs?year=2026'), '재무상태표(2026)'));
        fetches.push(makeCfFetch(fetch('/api/annual-plan/credit-recovery?baseYearMonth=26.03'), '여신회수 데이터'));
      }
      Promise.all(fetches)
        .then((results) => {
          type CFHierarchyApiRow = import('@/app/api/fs/cf-hierarchy/route').CFHierarchyApiRow;
          const hierarchy = results[0] as { rows?: CFHierarchyApiRow[]; columns?: string[]; hasPlan?: boolean } | null;
          const cashBorrowing = results[1] as { year?: number; columns?: string[]; cash?: number[]; borrowing?: number[]; prevCash?: number[]; prevBorrowing?: number[]; cashNMonthPlan?: number; borrowingNMonthPlan?: number } | null;
          if (hierarchy?.rows) {
            setCfHierarchyData({ rows: hierarchy.rows, columns: hierarchy.columns || [], hasPlan: hierarchy.hasPlan });
          }
          if (cashBorrowing && ((cashBorrowing.cash?.length ?? 0) > 0 || (cashBorrowing.borrowing?.length ?? 0) > 0)) {
            setCashBorrowingData({
              year: cashBorrowing.year ?? cfYear,
              columns: cashBorrowing.columns || [],
              cash: cashBorrowing.cash || [],
              borrowing: cashBorrowing.borrowing || [],
              prevCash: cashBorrowing.prevCash,
              prevBorrowing: cashBorrowing.prevBorrowing,
              cashNMonthPlan: cashBorrowing.cashNMonthPlan,
              borrowingNMonthPlan: cashBorrowing.borrowingNMonthPlan,
            });
          } else setCashBorrowingData(null);
          if (cfYear === 2026) {
            const bsResult = results[2] as { workingCapital?: TableRow[] } | null;
            const creditRecoveryRes = results[3] as { data?: CreditRecoveryData } | null;
            setCfWorkingCapitalData(bsResult?.workingCapital ?? null);
            setCreditRecoveryData(creditRecoveryRes?.data ?? null);
          }
        })
        .catch(() => {})
        .finally(() => setCfHierarchyLoading(false));
    }
  }, [cfYear, activeTab]);

  // 특정년도 변경사항 데이터 요청(PL 2025/2026년)
  useEffect(() => {
    if (tabTypes[activeTab] === 'PL' && (plYear === 2025 || plYear === 2026)) {
      if (plBrand === null) {
        loadBrandBreakdownData();
      } else {
        loadData('PL', plYear, baseMonth, plBrand);
      }
    }
  }, [baseMonth]);

  // 대리상 변경사항 데이터 요청
  useEffect(() => {
    if (tabTypes[activeTab] === 'PL') {
      if (plBrand === null) {
        // 빠른 응답 위해 대리상별 데이터 로드
        loadBrandBreakdownData();
      } else {
        loadData('PL', plYear, baseMonth, plBrand);
      }
    }
  }, [plBrand]);

  // 대리상별 잔액 데이터 로드
  const loadBrandBreakdownData = async () => {
    setLoading(true);
    setError(null);

    try {
      let url = `/api/fs/pl/breakdown?year=${plYear}`;
      if (plYear === 2025 || plYear === 2026) {
        url += `&baseMonth=${baseMonth}`;
      }

      const response = await fetch(url);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: '데이터를 불러올 수 없습니다.' }));
        throw new Error(errorData.error || '데이터를 불러올 수 없습니다.');
      }

      const result = await response.json();
      if (result.error) {
        throw new Error(result.error);
      }
      setPlData(result.rows);
    } catch (err) {
      console.error(err);
      const errorMessage = err instanceof Error ? err.message : '브랜드별 손익 데이터를 불러오는데 실패했습니다.';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  // ??而щ읆 (1??12??
  const monthColumns = ['계정과목', '1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];

  return (
    <main className="min-h-screen bg-gray-50">
      {/* ?곷떒 ??*/}
      <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} groups={tabGroups} />

      {/* 탭 콘텐츠 - 탭 높이로 스크롤 영역 추가 */}
      <div className="p-0 pt-16">
        {/* 경영요약 */}
        {activeTab === 0 && (
          <ExecutiveSummary 
            data={summaryData}
            loadError={error}
            onChange={setSummaryData}
            onReset={resetSummaryData}
            onSaveToServer={async (data, password) => {
              const res = await fetch('/api/executive-summary', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data, password }),
              });
              if (res.status === 401) return { ok: false, requirePassword: true };
              return { ok: res.ok };
            }}
          />
        )}

        {/* PL - 손익계산서 */}
        {activeTab === 1 && (
          <div>
            <div className="sticky top-16 z-30 bg-gray-100 border-b border-gray-300">
              <div className="flex items-center gap-4 px-6 py-3">
                <YearTabs years={[2024, 2025, 2026]} activeYear={plYear} onChange={setPlYear} />
                {(plYear === 2025 || plYear === 2026) && (
                  <BaseMonthSelector baseMonth={baseMonth} onChange={setBaseMonth} />
                )}
                <div className="h-8 w-px bg-gray-400 mx-2"></div>
                <BrandTabs brands={brands} activeBrand={plBrand} onChange={setPlBrand} />
              </div>
            </div>
            {loading && <div className="p-6 text-center">로딩 중...</div>}
            {error && <div className="p-6 text-center text-red-500">{error}</div>}
            {plData && !loading && (
              <div className="p-6">
                <FinancialTable 
                  data={plData} 
                  columns={monthColumns}
                  showComparisons={plYear === 2025 || plYear === 2026}
                  baseMonth={baseMonth}
                  currentYear={plYear}
                  showBrandBreakdown={plBrand === null}
                  hideYtd={hideYtd}
                  onHideYtdToggle={(plYear === 2025 || plYear === 2026) ? () => setHideYtd(!hideYtd) : undefined}
                />
              </div>
            )}
          </div>
        )}

        {/* BS - ?щТ?곹깭??*/}
        {activeTab === 2 && (
          <div>
            <div className="bg-gray-100 border-b border-gray-300">
              <div className="flex justify-between items-center gap-4 px-6 py-3">
                <YearTabs years={[2024, 2025, 2026]} activeYear={bsYear} onChange={setBsYear} />
                {(bsYear === 2025 || bsYear === 2026) && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={saveRemarksToServer}
                      className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors shadow-sm"
                    >
                      저장
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm('비고를 초기값으로 초기화하시겠습니까?')) {
                          resetRemarksData();
                        }
                      }}
                      className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-600 text-white hover:bg-gray-700 transition-colors shadow-sm"
                    >
                      초기값으로
                    </button>
                  </div>
                )}
              </div>
            </div>
            {loading && (
              <div className="p-6 text-center font-mono text-sm text-slate-600">
                {(() => {
                  const filled = Math.max(1, Math.round((bsLoadStep / bsTotalSteps) * 8));
                  const empty = 8 - filled;
                  const bar = '█'.repeat(filled) + '░'.repeat(empty);
                  const labels = ['재무상태표 불러오는 중...', '전년도 재무상태표 불러오는 중...'];
                  return `${bar} ${bsLoadStep}/${bsTotalSteps}  ${labels[(bsLoadStep - 1)] ?? '불러오는 중...'}`;
                })()}
              </div>
            )}
            {error && <div className="p-6 text-center text-red-500">{error}</div>}
            {bsData && !loading && (
              <>
                <div className="p-6">
                  <FinancialTable 
                    data={bsData} 
                    columns={monthColumns} 
                    showComparisons={bsYear === 2025 || bsYear === 2026}
                    baseMonth={3}
                    isBalanceSheet={true}
                    currentYear={bsYear}
                    monthsCollapsed={bsMonthsCollapsed}
                    onMonthsToggle={() => setBsMonthsCollapsed(!bsMonthsCollapsed)}
                    showRemarks={bsYear === 2025 || bsYear === 2026}
                    remarks={bsRemarks}
                    onRemarkChange={(account, remark) => {
                      const newRemarks = new Map(bsRemarks);
                      newRemarks.set(account, remark);
                      setBsRemarks(newRemarks);
                      saveRemarkDebounced(account, remark, 'bs');
                    }}
                    planMonth={bsYear === 2026 ? bsPlanMonth : null}
                  />
                </div>
                
                {/* ?댁쟾?먮낯 ??*/}
                {workingCapitalData && (
                  <div className="px-6 pb-6">
                    <div className="mb-4 border-t-2 border-gray-400 pt-6">
                      <h2 className="text-lg font-bold text-gray-800 mb-4">운전자본 분석</h2>
                    </div>
                    <FinancialTable 
                      data={workingCapitalData} 
                      columns={monthColumns} 
                      showComparisons={bsYear === 2025 || bsYear === 2026}
                      baseMonth={3}
                      isBalanceSheet={true}
                      currentYear={bsYear}
                      monthsCollapsed={bsMonthsCollapsed}
                      onMonthsToggle={() => setBsMonthsCollapsed(!bsMonthsCollapsed)}
                      showRemarks={bsYear === 2025 || bsYear === 2026}
                      remarks={wcRemarks}
                      autoRemarks={wcRemarksAuto || undefined}
                      onRemarkChange={(account, remark) => {
                        const newRemarks = new Map(wcRemarks);
                        newRemarks.set(account, remark);
                        setWcRemarks(newRemarks);
                        saveRemarkDebounced(account, remark, 'wc');
                      }}
                      planMonth={bsYear === 2026 ? bsPlanMonth : null}
                    />
                  </div>
                )}
                
                {/* 비교분석 (2025년 2026년만) */}
                {workingCapitalData && bsData && (bsYear === 2025 || bsYear === 2026) && (
                  <BSAnalysis 
                    bsData={bsData}
                    year={bsYear}
                    previousYearData={previousBsData || undefined}
                  />
                )}
              </>
            )}
          </div>
        )}

        {/* CF - ?꾧툑?먮쫫??*/}
        {activeTab === 3 && (
          <div>
            <div className="bg-gray-100 border-b border-gray-300">
              <div className="flex items-center gap-3 px-6 py-3">
                <YearTabs years={[2025, 2026]} activeYear={cfYear} onChange={setCfYear} />
                <button
                  onClick={() => setCfMonthsCollapsed(!cfMonthsCollapsed)}
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-200 text-gray-700 hover:bg-gray-300 transition-colors shadow-sm"
                >
                  {cfMonthsCollapsed ? '월별 데이터 펼치기 ▶' : '월별 데이터 접기 ◀'}
                </button>
              </div>
            </div>
            {cfHierarchyLoading && (
              <div className="p-6 text-center font-mono text-sm text-slate-600">
                {(() => {
                  const filled = cfLoadStep === 0 ? 1 : Math.round((cfLoadStep / cfTotalSteps) * 8);
                  const empty = 8 - filled;
                  const bar = '█'.repeat(filled) + '░'.repeat(empty);
                  return cfLoadStep === 0
                    ? `${bar}  불러오는 중...`
                    : `${bar} ${cfLoadStep}/${cfTotalSteps}  ${cfLoadingLabel} 완료`;
                })()}
              </div>
            )}
            {error && <div className="p-6 text-center text-red-500">{error}</div>}
            {cfHierarchyData && cfHierarchyData.rows.length > 0 && !cfHierarchyLoading && (
              cfMonthsCollapsed ? (
                <div className="flex flex-1 min-h-0">
                  <div className="w-[70%] min-w-0 overflow-auto p-6">
                    <CashFlowHierarchyTable
                      rows={cfHierarchyData.rows}
                      columns={cfHierarchyData.columns}
                      monthsCollapsed={cfMonthsCollapsed}
                      onMonthsToggle={() => setCfMonthsCollapsed(!cfMonthsCollapsed)}
                      hasPlan={cfYear === 2026 ? cfHierarchyData.hasPlan : false}
                    />
                    {cashBorrowingData && (
                      <CashBorrowingBalance
                        year={cashBorrowingData.year}
                        columns={cashBorrowingData.columns}
                        cash={cashBorrowingData.cash}
                        borrowing={cashBorrowingData.borrowing}
                        prevCash={cashBorrowingData.prevCash}
                        prevBorrowing={cashBorrowingData.prevBorrowing}
                        monthsCollapsed={cfMonthsCollapsed}
                        cashNMonthPlan={cashBorrowingData.cashNMonthPlan}
                        borrowingNMonthPlan={cashBorrowingData.borrowingNMonthPlan}
                      />
                    )}
                    {cfYear === 2026 && cfWorkingCapitalData && cfWorkingCapitalData.length > 0 && (
                      <CFWorkingCapitalTable
                        rows={cfWorkingCapitalData}
                        monthsCollapsed={cfMonthsCollapsed}
                        onMonthsToggle={() => setCfMonthsCollapsed(!cfMonthsCollapsed)}
                        planMonth={bsPlanMonth}
                      />
                    )}
                    {cfYear === 2026 && creditRecoveryData && (
                      <DealerCreditRecoveryTable data={creditRecoveryData} />
                    )}
                  </div>
                  <div className="w-[30%] min-w-0 overflow-auto p-6 border-l border-gray-200">
                    <CFExplanationPanel year={cfYear} rollingNumbers={cfSummaryNumbers ?? undefined} />
                  </div>
                </div>
              ) : (
                <div className="p-6">
                  <CashFlowHierarchyTable
                    rows={cfHierarchyData.rows}
                    columns={cfHierarchyData.columns}
                    monthsCollapsed={cfMonthsCollapsed}
                    onMonthsToggle={() => setCfMonthsCollapsed(!cfMonthsCollapsed)}
                  />
                  {cashBorrowingData && (
                    <CashBorrowingBalance
                      year={cashBorrowingData.year}
                      columns={cashBorrowingData.columns}
                      cash={cashBorrowingData.cash}
                      borrowing={cashBorrowingData.borrowing}
                      prevCash={cashBorrowingData.prevCash}
                      prevBorrowing={cashBorrowingData.prevBorrowing}
                      monthsCollapsed={cfMonthsCollapsed}
                    />
                  )}
                  {cfYear === 2026 && cfWorkingCapitalData && cfWorkingCapitalData.length > 0 && (
                    <CFWorkingCapitalTable
                      rows={cfWorkingCapitalData}
                      monthsCollapsed={cfMonthsCollapsed}
                      onMonthsToggle={() => setCfMonthsCollapsed(!cfMonthsCollapsed)}
                    />
                  )}
                  {cfYear === 2026 && creditRecoveryData && (
                    <DealerCreditRecoveryTable data={creditRecoveryData} />
                  )}
                </div>
              )
            )}
          </div>
        )}

        {/* ?ъ떊?ъ슜?꾪솴 */}
        {activeTab === 4 && (
          <div>
            <div className="bg-gray-100 border-b border-gray-300 px-6 py-3">
              <span className="text-sm font-medium text-gray-700">2026년 3월 기준</span>
            </div>
            {loading && <div className="p-6 text-center">로딩 중...</div>}
            {error && <div className="p-6 text-center text-red-500">{error}</div>}
            {creditData && !loading && (
              <div className="p-6">
                <CreditStatus data={creditData} creditRecoveryData={creditRecoveryData} />
              </div>
            )}
          </div>
        )}

        {/* 재고자산 */}
        {inventoryTabMounted && <div className={activeTab === 5 ? '' : 'hidden'}><InventoryDashboard /></div>}
        <div className={activeTab === 6 ? '' : 'hidden'}><PLForecastTab /></div>
        {activeTab === 7 && <PLCashFlowTab />}
      </div>
    </main>
  );
}


