'use client';

import { useState, useEffect, useMemo } from 'react';
import YearTabs from '@/components/YearTabs';
import FinancialTable from '@/components/FinancialTable';
import { TableRow, CreditRecoveryData, EditableAnalysis, EditableCategoryAnalysis, BalanceData } from '@/lib/types';
import {
  analyzeCashFlowData,
  analyzeWorkingCapitalData,
  generateCashFlowInsights,
} from '@/lib/analysis';
import { formatNumber, formatMillionYuan } from '@/lib/utils';

export default function AnnualCashPlan() {
  const [wcYear, setWcYear] = useState<number>(2026);
  const [workingCapitalMonthsCollapsed, setWorkingCapitalMonthsCollapsed] = useState<boolean>(true);
  const [wcAllRowsCollapsed, setWcAllRowsCollapsed] = useState<boolean>(true);
  const [wcStatementAllRowsCollapsed, setWcStatementAllRowsCollapsed] = useState<boolean>(true);
  const [cfData, setCfData] = useState<TableRow[] | null>(null);
  const [wcStatementData, setWcStatementData] = useState<TableRow[] | null>(null);
  const [creditRecoveryData, setCreditRecoveryData] = useState<CreditRecoveryData | null>(null);
  const [balanceData, setBalanceData] = useState<BalanceData | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // 편집 모드 관련 상태
  const [editMode, setEditMode] = useState<boolean>(false);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [showPinModal, setShowPinModal] = useState<boolean>(false);
  const [pinInput, setPinInput] = useState<string>('');
  const [pinError, setPinError] = useState<string>('');
  const [savedAnalysis, setSavedAnalysis] = useState<EditableAnalysis | null>(null);
  const [editedAnalysis, setEditedAnalysis] = useState<EditableAnalysis | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);


  // 데이터 로딩
  const loadCFData = async (year: number) => {
    try {
      const response = await fetch(`/api/fs/cf?year=${year}`);
      const result = await response.json();
      if (response.ok) {
        setCfData(result.rows);
      } else {
        throw new Error(result.error || 'CF 데이터를 불러올 수 없습니다.');
      }
    } catch (err) {
      console.error('CF 데이터 로드 실패:', err);
      setCfData(null);
    }
  };

  const loadWCStatementData = async (year: number) => {
    try {
      const response = await fetch(`/api/annual-plan/working-capital?year=${year}`);
      const result = await response.json();
      if (response.ok) {
        setWcStatementData(result.rows);
      } else {
        throw new Error(result.error || '운전자본표 데이터를 불러올 수 없습니다.');
      }
    } catch (err) {
      console.error('운전자본표 데이터 로드 실패:', err);
      setWcStatementData(null);
    }
  };

  const loadBalanceData = async (year: number) => {
    try {
      const response = await fetch(`/api/annual-plan/balance?year=${year}`);
      const result = await response.json();
      if (response.ok) {
        setBalanceData(result.data);
      } else {
        setBalanceData(null);
      }
    } catch (err) {
      console.error('현금차입금잔액 데이터 로드 실패:', err);
      setBalanceData(null);
    }
  };

  const loadCreditRecoveryData = async () => {
    try {
      const response = await fetch(`/api/annual-plan/credit-recovery?baseYearMonth=26.01`);
      const result = await response.json();
      if (response.ok) {
        setCreditRecoveryData(result.data);
      } else {
        throw new Error(result.error || '여신회수계획 데이터를 불러올 수 없습니다.');
      }
    } catch (err) {
      console.error('여신회수계획 데이터 로드 실패:', err);
      setCreditRecoveryData(null);
    }
  };

  // 초기 데이터 로드
  useEffect(() => {
    setLoading(true);
    setError(null);

    Promise.all([
      loadCFData(wcYear),
      loadWCStatementData(wcYear),
      loadBalanceData(wcYear),
      loadCreditRecoveryData(),
    ])
      .catch(err => {
        setError(err.message || '데이터를 불러오는데 실패했습니다.');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [wcYear]);


  // 저장된 분석 데이터 로드
  useEffect(() => {
    const loadSavedAnalysis = async () => {
      try {
        const response = await fetch(`/api/annual-plan/analysis?year=${wcYear}`);
        const result = await response.json();
        if (result.data) {
          setSavedAnalysis(result.data);
        } else {
          setSavedAnalysis(null);
        }
      } catch (err) {
        console.error('저장된 분석 조회 실패:', err);
      }
    };

    loadSavedAnalysis();
  }, [wcYear]);

  // PIN 인증 처리
  const handlePinSubmit = async () => {
    setPinError('');
    try {
      const response = await fetch('/api/annual-plan/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pinInput })
      });
      const result = await response.json();

      if (result.success) {
        setIsAuthenticated(true);
        setShowPinModal(false);
        setPinInput('');
        localStorage.setItem('editTokenAnnualPlan', 'authenticated');
      } else {
        setPinError(result.error || 'PIN이 올바르지 않습니다.');
      }
    } catch (err) {
      setPinError('인증 중 오류가 발생했습니다.');
    }
  };

  // 편집 모드 토글
  const toggleEditMode = () => {
    if (!isAuthenticated) {
      setShowPinModal(true);
      return;
    }
    
    if (!editMode) {
      // 편집 모드 진입
      if (analysisResults) {
        const editable: EditableAnalysis = {
          year: wcYear,
          keyInsights: savedAnalysis?.keyInsights || analysisResults.insights.keyInsights,
          cfCategories: savedAnalysis?.cfCategories || analysisResults.cfAnalysis.categories.map(c => ({
            account: c.account,
            annualTotal: c.annualTotal,
            yoyAbsolute: c.yoyAbsolute,
            yoyPercent: c.yoyPercent,
            customText: undefined
          })),
          wcCategories: savedAnalysis?.wcCategories || analysisResults.wcAnalysis.categories.map(c => ({
            account: c.account,
            annualTotal: c.annualTotal,
            yoyAbsolute: c.yoyAbsolute,
            yoyPercent: c.yoyPercent,
            customText: undefined
          })),
          wcInsights: savedAnalysis?.wcInsights || {
            arInsight: analysisResults.wcAnalysis.arInsight,
            inventoryInsight: analysisResults.wcAnalysis.inventoryInsight,
            apInsight: analysisResults.wcAnalysis.apInsight
          },
          riskFactors: savedAnalysis?.riskFactors || analysisResults.insights.riskFactors,
          actionItems: savedAnalysis?.actionItems || analysisResults.insights.actionItems,
          lastModified: new Date().toISOString()
        };
        setEditedAnalysis(editable);
      }
      setEditMode(true);
    } else {
      setEditMode(false);
      setEditedAnalysis(null);
    }
  };

  // 저장 처리
  const handleSave = async () => {
    if (!editedAnalysis) return;
    
    setIsSaving(true);
    try {
      const response = await fetch('/api/annual-plan/analysis', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(editedAnalysis)
      });

      const result = await response.json();

      if (result.success) {
        setSavedAnalysis(result.data);
        setEditMode(false);
        setEditedAnalysis(null);
        alert('저장되었습니다.');
      } else {
        alert(result.error || '저장 실패');
      }
    } catch (err) {
      alert('저장 중 오류가 발생했습니다.');
    } finally {
      setIsSaving(false);
    }
  };

  // 초기화 처리
  const handleReset = async () => {
    if (!confirm('저장된 내용을 삭제하고 자동 생성된 내용으로 초기화하시겠습니까?')) {
      return;
    }

    setSavedAnalysis(null);
    setEditedAnalysis(null);
    setEditMode(false);
    alert('초기화되었습니다.');
  };

  // 분석 결과 계산
  const analysisResults = useMemo(() => {
    if (!cfData && !wcStatementData) {
      return null;
    }

    const cfAnalysis = analyzeCashFlowData(cfData, wcYear);
    const wcAnalysis = analyzeWorkingCapitalData(wcStatementData, wcYear);
    const insights = generateCashFlowInsights(cfData, wcStatementData, wcYear);

    return { cfAnalysis, wcAnalysis, insights };
  }, [cfData, wcStatementData, wcYear]);

  // 최종 표시할 분석 결과
  const displayAnalysis = useMemo(() => {
    if (editMode && editedAnalysis) {
      return editedAnalysis;
    }
    if (savedAnalysis) {
      return savedAnalysis;
    }
    if (analysisResults) {
      return {
        year: wcYear,
        keyInsights: analysisResults.insights.keyInsights,
        cfCategories: analysisResults.cfAnalysis.categories.map(c => ({
          account: c.account,
          annualTotal: c.annualTotal,
          yoyAbsolute: c.yoyAbsolute,
          yoyPercent: c.yoyPercent,
          customText: undefined
        })),
        wcCategories: analysisResults.wcAnalysis.categories.map(c => ({
          account: c.account,
          annualTotal: c.annualTotal,
          yoyAbsolute: c.yoyAbsolute,
          yoyPercent: c.yoyPercent,
          customText: undefined
        })),
        wcInsights: {
          arInsight: analysisResults.wcAnalysis.arInsight,
          inventoryInsight: analysisResults.wcAnalysis.inventoryInsight,
          apInsight: analysisResults.wcAnalysis.apInsight
        },
        riskFactors: analysisResults.insights.riskFactors,
        actionItems: analysisResults.insights.actionItems,
        lastModified: new Date().toISOString()
      };
    }
    return null;
  }, [editMode, editedAnalysis, savedAnalysis, analysisResults, wcYear]);

  // 카테고리 텍스트 자동 생성
  const generateCategoryText = (cat: EditableCategoryAnalysis, isCashFlow: boolean = true): string => {
    let text = `연간 ${formatMillionYuan(cat.annualTotal)}`;
    
    if (cat.yoyAbsolute !== null) {
      text += ` (전년 대비 ${formatMillionYuan(Math.abs(cat.yoyAbsolute))}`;
      
      if (cat.yoyPercent !== null) {
        text += `, ${cat.yoyPercent > 0 ? '+' : ''}${cat.yoyPercent.toFixed(1)}%)`;
      } else {
        text += ')';
      }
    }
    
    return text;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* PIN 모달 */}
      {showPinModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
            <h3 className="text-xl font-bold mb-2">편집 모드 인증</h3>
            <p className="text-sm text-gray-600 mb-4">편집 모드를 활성화하려면 PIN을 입력하세요.</p>
            <input
              type="password"
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handlePinSubmit()}
              placeholder="PIN 입력"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg mb-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {pinError && <p className="text-sm text-red-600 mb-3">{pinError}</p>}
            <div className="flex gap-3">
              <button
                onClick={handlePinSubmit}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
              >
                확인
              </button>
              <button
                onClick={() => {
                  setShowPinModal(false);
                  setPinInput('');
                  setPinError('');
                }}
                className="flex-1 px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition-colors"
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 상단 바 */}
      <div className="bg-white shadow-sm border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-gray-800">연간 자금계획</h2>
          <YearTabs years={[2025, 2026]} activeYear={wcYear} onChange={setWcYear} />
        </div>
        
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => setWorkingCapitalMonthsCollapsed(!workingCapitalMonthsCollapsed)}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-200 text-gray-700 hover:bg-gray-300 transition-colors shadow-sm"
          >
            {workingCapitalMonthsCollapsed ? '월별 데이터 펼치기 ▶' : '월별 데이터 접기 ◀'}
          </button>

          {editMode && (
            <>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors shadow-sm disabled:opacity-50"
              >
                {isSaving ? '저장 중...' : '저장'}
              </button>
              <button
                onClick={handleReset}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors shadow-sm"
              >
                초기화
              </button>
            </>
          )}
          <button
            onClick={toggleEditMode}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors shadow-sm"
          >
            {editMode ? '편집 모드 끄기 🔒' : '편집 모드 켜기 🔓'}
          </button>
        </div>
      </div>

      {/* 내용 */}
      <div className="p-6">
        {loading && <div className="text-center py-8 text-gray-600">로딩 중...</div>}
        {error && <div className="text-center py-8 text-red-600">{error}</div>}
        {(cfData || wcStatementData) && !loading && (
          <div className="space-y-6">
            {workingCapitalMonthsCollapsed ? (
              <div className="space-y-6">
                {/* 현금흐름표 (접힌 상태) */}
                {cfData && (
                  <div className="bg-white rounded-lg shadow-sm p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-xl font-bold text-gray-800">현금흐름표</h3>
                      <button
                        onClick={() => setWcAllRowsCollapsed(!wcAllRowsCollapsed)}
                        className="px-4 py-2 text-sm font-medium rounded bg-gray-600 text-white hover:bg-gray-700 transition-colors"
                      >
                        {wcAllRowsCollapsed ? '펼치기 ▼' : '접기 ▲'}
                      </button>
                    </div>
                    <FinancialTable
                      data={cfData}
                      columns={['계정과목', '합계']}
                      isCashFlow={true}
                      showTotal={true}
                      showComparisons={true}
                      monthsCollapsed={workingCapitalMonthsCollapsed}
                      onMonthsToggle={() => setWorkingCapitalMonthsCollapsed(!workingCapitalMonthsCollapsed)}
                      currentYear={wcYear}
                    />
                  </div>
                )}
                
                {/* 현금잔액과 차입금잔액표 */}
                {balanceData && (
                  <div className="bg-white rounded-lg shadow-sm p-6">
                    <h3 className="text-xl font-bold text-gray-800 mb-4">현금잔액과 차입금잔액표</h3>
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse">
                        <thead>
                          <tr className="bg-gray-100">
                            <th className="border border-gray-300 px-4 py-2 text-left font-semibold text-sm">구분</th>
                            <th className="border border-gray-300 px-4 py-2 text-right font-semibold text-sm">기초잔액</th>
                            {!workingCapitalMonthsCollapsed && (
                              <>
                                {['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'].map((month) => (
                                  <th key={month} className="border border-gray-300 px-4 py-2 text-right font-semibold text-sm">{month}</th>
                                ))}
                              </>
                            )}
                            {workingCapitalMonthsCollapsed && (
                              <th className="border border-gray-300 px-4 py-2 text-right font-semibold text-sm">...</th>
                            )}
                            <th className="border border-gray-300 px-4 py-2 text-right font-semibold text-sm">기말잔액</th>
                            <th className="border border-gray-300 px-4 py-2 text-right font-semibold text-sm">YoY</th>
                          </tr>
                        </thead>
                        <tbody>
                          {/* 현금잔액 */}
                          <tr>
                            <td className="border border-gray-300 px-4 py-2 font-medium">현금잔액</td>
                            <td className="border border-gray-300 px-4 py-2 text-right">{formatNumber(balanceData.현금잔액.기초잔액, false, false)}</td>
                            {!workingCapitalMonthsCollapsed && (
                              <>
                                {balanceData.현금잔액.monthly.map((value, idx) => (
                                  <td key={idx} className="border border-gray-300 px-4 py-2 text-right">{formatNumber(value, false, false)}</td>
                                ))}
                              </>
                            )}
                            {workingCapitalMonthsCollapsed && (
                              <td className="border border-gray-300 px-4 py-2 text-right text-gray-400">...</td>
                            )}
                            <td className="border border-gray-300 px-4 py-2 text-right font-semibold">{formatNumber(balanceData.현금잔액.기말잔액, false, false)}</td>
                            <td className={`border border-gray-300 px-4 py-2 text-right font-semibold ${balanceData.현금잔액.기말잔액 - balanceData.현금잔액.기초잔액 >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
                              {formatNumber(balanceData.현금잔액.기말잔액 - balanceData.현금잔액.기초잔액, true, false)}
                            </td>
                          </tr>
                          
                          {/* 차입금잔액 */}
                          <tr>
                            <td className="border border-gray-300 px-4 py-2 font-medium">차입금잔액</td>
                            <td className="border border-gray-300 px-4 py-2 text-right">{formatNumber(balanceData.차입금잔액.기초잔액, false, false)}</td>
                            {!workingCapitalMonthsCollapsed && (
                              <>
                                {balanceData.차입금잔액.monthly.map((value, idx) => (
                                  <td key={idx} className="border border-gray-300 px-4 py-2 text-right">{formatNumber(value, false, false)}</td>
                                ))}
                              </>
                            )}
                            {workingCapitalMonthsCollapsed && (
                              <td className="border border-gray-300 px-4 py-2 text-right text-gray-400">...</td>
                            )}
                            <td className="border border-gray-300 px-4 py-2 text-right font-semibold">{formatNumber(balanceData.차입금잔액.기말잔액, false, false)}</td>
                            <td className={`border border-gray-300 px-4 py-2 text-right font-semibold ${balanceData.차입금잔액.기말잔액 - balanceData.차입금잔액.기초잔액 <= 0 ? 'text-blue-600' : 'text-red-600'}`}>
                              {formatNumber(balanceData.차입금잔액.기말잔액 - balanceData.차입금잔액.기초잔액, true, false)}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                
                {/* 운전자본표 (접힌 상태) */}
                {wcStatementData && (
                  <div className="bg-white rounded-lg shadow-sm p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-xl font-bold text-gray-800">운전자본표</h3>
                      <button
                        onClick={() => setWcStatementAllRowsCollapsed(!wcStatementAllRowsCollapsed)}
                        className="px-4 py-2 text-sm font-medium rounded bg-gray-600 text-white hover:bg-gray-700 transition-colors"
                      >
                        {wcStatementAllRowsCollapsed ? '펼치기 ▼' : '접기 ▲'}
                      </button>
                    </div>
                    <FinancialTable
                      data={wcStatementData}
                      columns={['계정과목', '합계']}
                      showTotal={true}
                      showComparisons={true}
                      monthsCollapsed={workingCapitalMonthsCollapsed}
                      onMonthsToggle={() => setWorkingCapitalMonthsCollapsed(!workingCapitalMonthsCollapsed)}
                      currentYear={wcYear}
                    />
                  </div>
                )}
                
                {/* 대리상 여신회수 계획 */}
                {creditRecoveryData && (
                  <div className="bg-white rounded-lg shadow-sm p-6">
                    <h3 className="text-xl font-bold text-gray-800 mb-4">대리상 여신회수 계획 ({creditRecoveryData.baseYearMonth} 기준)</h3>
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse">
                        <thead>
                          <tr className="bg-gray-100">
                            <th className="border border-gray-300 px-4 py-2 text-left font-semibold text-sm">대리상선수금</th>
                            <th className="border border-gray-300 px-4 py-2 text-left font-semibold text-sm">대리상 채권</th>
                            {creditRecoveryData.headers.map((header, idx) => (
                              <th key={idx} className="border border-gray-300 px-4 py-2 text-right font-semibold text-sm">{header}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td className="border border-gray-300 px-4 py-2 text-right">{formatNumber(creditRecoveryData.대리상선수금, false, false)}</td>
                            <td className="border border-gray-300 px-4 py-2 text-right">{formatNumber(creditRecoveryData.대리상채권, false, false)}</td>
                            {creditRecoveryData.recoveries.map((amount, idx) => (
                              <td key={idx} className="border border-gray-300 px-4 py-2 text-right">{formatNumber(amount, true, false)}</td>
                            ))}
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                
                {/* 설명과 분석 */}
                <div className="bg-white rounded-lg shadow-sm p-6">
                  <h3 className="text-xl font-bold text-gray-800 mb-4">설명과 분석</h3>
                  
                  {displayAnalysis ? (
                    <div className="space-y-6">
                      {/* 핵심 인사이트 */}
                      <div className="border-l-4 border-blue-500 pl-4">
                        <h4 className="font-bold text-lg mb-3 text-blue-900">핵심 인사이트</h4>
                        <ul className="space-y-2">
                          {displayAnalysis.keyInsights.map((insight, idx) => (
                            <li key={idx} className="text-sm text-gray-700 leading-relaxed">
                              {editMode ? (
                                <div className="flex gap-2">
                                  <textarea
                                    value={insight}
                                    onChange={(e) => {
                                      const newInsights = [...displayAnalysis.keyInsights];
                                      newInsights[idx] = e.target.value;
                                      setEditedAnalysis({ ...displayAnalysis, keyInsights: newInsights });
                                    }}
                                    className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    rows={3}
                                  />
                                  <button
                                    onClick={() => {
                                      const newInsights = displayAnalysis.keyInsights.filter((_, i) => i !== idx);
                                      setEditedAnalysis({ ...displayAnalysis, keyInsights: newInsights });
                                    }}
                                    className="px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600"
                                  >
                                    삭제
                                  </button>
                                </div>
                              ) : (
                                <span>• {insight}</span>
                              )}
                            </li>
                          ))}
                        </ul>
                        {editMode && (
                          <button
                            onClick={() => {
                              const newInsights = [...displayAnalysis.keyInsights, '새 인사이트'];
                              setEditedAnalysis({ ...displayAnalysis, keyInsights: newInsights });
                            }}
                            className="mt-3 px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
                          >
                            + 추가
                          </button>
                        )}
                      </div>

                      {/* 리스크 요인 */}
                      {displayAnalysis.riskFactors.length > 0 && (
                        <div className="border-l-4 border-yellow-500 pl-4">
                          <h4 className="font-bold text-lg mb-3 text-yellow-900">리스크 요인</h4>
                          <ul className="space-y-2">
                            {displayAnalysis.riskFactors.map((risk, idx) => (
                              <li key={idx} className="text-sm text-gray-700 leading-relaxed">
                                {editMode ? (
                                  <div className="flex gap-2">
                                    <textarea
                                      value={risk}
                                      onChange={(e) => {
                                        const newRisks = [...displayAnalysis.riskFactors];
                                        newRisks[idx] = e.target.value;
                                        setEditedAnalysis({ ...displayAnalysis, riskFactors: newRisks });
                                      }}
                                      className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-yellow-500"
                                      rows={2}
                                    />
                                    <button
                                      onClick={() => {
                                        const newRisks = displayAnalysis.riskFactors.filter((_, i) => i !== idx);
                                        setEditedAnalysis({ ...displayAnalysis, riskFactors: newRisks });
                                      }}
                                      className="px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600"
                                    >
                                      삭제
                                    </button>
                                  </div>
                                ) : (
                                  <span>⚠ {risk}</span>
                                )}
                              </li>
                            ))}
                          </ul>
                          {editMode && (
                            <button
                              onClick={() => {
                                const newRisks = [...displayAnalysis.riskFactors, '새 리스크 요인'];
                                setEditedAnalysis({ ...displayAnalysis, riskFactors: newRisks });
                              }}
                              className="mt-3 px-3 py-1 text-sm bg-yellow-500 text-white rounded hover:bg-yellow-600"
                            >
                              + 추가
                            </button>
                          )}
                        </div>
                      )}

                      {/* 관리 포인트 */}
                      {displayAnalysis.actionItems.length > 0 && (
                        <div className="border-l-4 border-orange-500 pl-4">
                          <h4 className="font-bold text-lg mb-3 text-orange-900">관리 포인트</h4>
                          <ul className="space-y-2">
                            {displayAnalysis.actionItems.map((action, idx) => (
                              <li key={idx} className="text-sm text-gray-700 leading-relaxed">
                                {editMode ? (
                                  <div className="flex gap-2">
                                    <textarea
                                      value={action}
                                      onChange={(e) => {
                                        const newActions = [...displayAnalysis.actionItems];
                                        newActions[idx] = e.target.value;
                                        setEditedAnalysis({ ...displayAnalysis, actionItems: newActions });
                                      }}
                                      className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                                      rows={2}
                                    />
                                    <button
                                      onClick={() => {
                                        const newActions = displayAnalysis.actionItems.filter((_, i) => i !== idx);
                                        setEditedAnalysis({ ...displayAnalysis, actionItems: newActions });
                                      }}
                                      className="px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600"
                                    >
                                      삭제
                                    </button>
                                  </div>
                                ) : (
                                  <span>→ {action}</span>
                                )}
                              </li>
                            ))}
                          </ul>
                          {editMode && (
                            <button
                              onClick={() => {
                                const newActions = [...displayAnalysis.actionItems, '새 관리 포인트'];
                                setEditedAnalysis({ ...displayAnalysis, actionItems: newActions });
                              }}
                              className="mt-3 px-3 py-1 text-sm bg-orange-500 text-white rounded hover:bg-orange-600"
                            >
                              + 추가
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-gray-600">데이터를 불러오는 중이거나 표시할 분석 내용이 없습니다.</p>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                {/* 월별 펼친 상태 - 기존 로직 재사용 */}
                {/* (간략화를 위해 생략, 필요시 추가) */}
                <p className="text-center text-gray-600">월별 펼친 상태 UI (추가 개발 필요)</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
