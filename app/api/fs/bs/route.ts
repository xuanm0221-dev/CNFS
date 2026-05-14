import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { readCSV, readBSPlanData } from '@/lib/csv';
import { calculateBS, calculateComparisonDataBS, calculateWorkingCapital } from '@/lib/fs-mapping';
import { TableRow, FinancialData } from '@/lib/types';

export const dynamic = 'force-dynamic';

// 운전자본 비고 자동 생성 함수
function generateWCRemarks(
  currentBSData: TableRow[], 
  previousBSData: TableRow[],
  currentYear: number
): { [key: string]: string } {
  
  // YoY 값 가져오기 (이미 계산된 값)
  const getYoYValue = (data: TableRow[], account: string) => {
    const row = data.find(r => r.account === account);
    // annualYoY: 24년기말 vs 25년기말 (또는 25년기말 vs 26년기말)
    return row?.comparisons?.annualYoY || 0;
  };
  
  // 변동 포맷팅 (YoY 값은 원본 단위이므로 M(백만) 단위로 변환)
  const formatChange = (label: string, yoyValueOriginal: number) => {
    // 원본 → M 단위로 변환 (1,000,000으로 나누기)
    const valueInM = Math.round(yoyValueOriginal / 1000000);
    
    // 디버깅용 로그
    console.log(`[WC 비고] ${label}: ${yoyValueOriginal} → ${valueInM}M`);
    
    // 1M 미만은 무시
    if (Math.abs(valueInM) < 1) return null;
    
    // 부호 결정
    const sign = valueInM > 0 ? '+' : '△';
    const absValue = Math.abs(valueInM);
    
    // 최종 포맷: "라벨 +123M" 또는 "라벨 △123M"
    return `${label} ${sign}${absValue}M`;
  };
  
  const remarks: { [key: string]: string } = {};
  const yearLabel = currentYear === 2026 ? '26.12월 vs 25.12월' : '25.12월 vs 24.12월';
  
  // 1. 운전자본
  const wcChanges: string[] = [];
  
  // AR = 직영AR + 대리상AR 통합
  const 직영ARYoY = getYoYValue(currentBSData, '직영AR');
  const 대리상ARYoY = getYoYValue(currentBSData, '대리상AR');
  const ARYoY = 직영ARYoY + 대리상ARYoY;
  
  const ARChange = formatChange('AR', ARYoY);
  if (ARChange) wcChanges.push(ARChange);
  
  // 재고자산
  const 재고YoY = getYoYValue(currentBSData, '재고자산');
  const 재고Change = formatChange('재고자산', 재고YoY);
  if (재고Change) wcChanges.push(재고Change);
  
  // 본사선급금
  const 선급금YoY = getYoYValue(currentBSData, '선급금(본사)');
  const 선급금Change = formatChange('선급금', 선급금YoY);
  if (선급금Change) wcChanges.push(선급금Change);
  
  // AP = 본사 AP + 제품 AP 통합
  const 본사APYoY = getYoYValue(currentBSData, '본사 AP');
  const 제품APYoY = getYoYValue(currentBSData, '제품 AP');
  const APYoY = 본사APYoY + 제품APYoY;
  
  const APChange = formatChange('AP', APYoY);
  if (APChange) wcChanges.push(APChange);
  
  if (wcChanges.length > 0) {
    remarks['운전자본'] = `${yearLabel}: ${wcChanges.join(', ')}`;
  }
  
  // 2. from대리상
  const fromDealerChanges: string[] = [];
  [
    { key: '대리상선수금', label: '선수금' },
    { key: '대리상지원금', label: '지원금' }
  ].forEach(({ key, label }) => {
    const yoy = getYoYValue(currentBSData, key);
    const change = formatChange(label, yoy);
    if (change) fromDealerChanges.push(change);
  });
  
  if (fromDealerChanges.length > 0) {
    remarks['from대리상'] = fromDealerChanges.join(', ');
  }
  
  // 3. from 현금/차입금
  const fromCashChanges: string[] = [];
  [
    { key: '현금 및 현금성자산', label: '현금' },
    { key: '차입금', label: '차입금' }
  ].forEach(({ key, label }) => {
    const yoy = getYoYValue(currentBSData, key);
    const change = formatChange(label, yoy);
    if (change) fromCashChanges.push(change);
  });
  
  if (fromCashChanges.length > 0) {
    remarks['from 현금/차입금'] = fromCashChanges.join(', ');
  }
  
  // 4. from 이익창출
  const 이익잉여금YoY = getYoYValue(currentBSData, '이익잉여금');
  const 이익잉여금Change = formatChange('이익잉여금', 이익잉여금YoY);
  if (이익잉여금Change) {
    remarks['from 이익창출'] = 이익잉여금Change;
  }
  
  // 5. 기타운전자본
  const otherChanges: string[] = [];
  [
    { key: '선급금(기타)', label: '선급' },
    { key: '이연법인세자산', label: '선급' },
    { key: '유,무형자산', label: '고정자산' },
    { key: '장기보증금', label: '고정자산' },
    { key: '기타 유동자산', label: '미수금' },
    { key: '기타 유동부채', label: '미지급금' }
  ].forEach(({ key, label }) => {
    const yoy = getYoYValue(currentBSData, key);
    const change = formatChange(label, yoy);
    if (change) otherChanges.push(change);
  });
  
  if (otherChanges.length > 0) {
    remarks['기타운전자본'] = otherChanges.join(', ');
  }
  
  // 6. 리스관련
  const leaseChanges: string[] = [];
  [
    { key: '사용권자산', label: '사용권자산' },
    { key: '리스부채(장,단기)', label: '리스부채' }
  ].forEach(({ key, label }) => {
    const yoy = getYoYValue(currentBSData, key);
    const change = formatChange(label, yoy);
    if (change) leaseChanges.push(change);
  });
  
  if (leaseChanges.length > 0) {
    remarks['리스관련'] = leaseChanges.join(', ');
  } else {
    remarks['리스관련'] = '사용권 변동 없음, 리스부채 변동 없음';
  }
  
  return remarks;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const yearParam = searchParams.get('year');
    const year = yearParam ? parseInt(yearParam, 10) : 2024;
    
    if (![2024, 2025, 2026].includes(year)) {
      return NextResponse.json(
        { error: '유효하지 않은 연도입니다. 2024, 2025 또는 2026을 선택하세요.' },
        { status: 400 }
      );
    }
    
    const filePath = path.join(process.cwd(), '파일', 'BS', `${year}.csv`);
    const data = await readCSV(filePath, year);
    let tableRows = calculateBS(data);
    let workingCapitalRows = calculateWorkingCapital(data);
    let wcRemarksAuto: { [key: string]: string } | null = null;
    
    // 2025년 또는 2026년인 경우 전년 데이터와 비교
    if (year === 2025 || year === 2026) {
      const prevYear = year - 1;
      const prevFilePath = path.join(process.cwd(), '파일', 'BS', `${prevYear}.csv`);
      const prevData = await readCSV(prevFilePath, prevYear);
      const prevTableRows = calculateBS(prevData);
      const prevWorkingCapitalRows = calculateWorkingCapital(prevData);
      
      const rawPlanData = year === 2026 ? readBSPlanData(filePath) : null;

      // planMonthValue/planAnnualValue를 FinancialData[]로 변환 후 calculateBS/WC 통과
      // → 자산, 유동자산 등 계산행(합계)도 자동 집계됨
      // BS와 WC는 동일 account명 (이익잉여금 등) 에 대해 부호 규칙이 다름 → 별도 map 사용
      let bsAggregatedPlanData: {
        planMonthValue: Map<string, number>;
        planAnnualValue: Map<string, number>;
        planMonth: number;
      } | null = null;
      let wcAggregatedPlanData: {
        planMonthValue: Map<string, number>;
        planAnnualValue: Map<string, number>;
        planMonth: number;
      } | null = null;

      if (rawPlanData) {
        const pm = rawPlanData.planMonth;
        const planFinancialData: FinancialData[] = [];

        for (const [account, value] of rawPlanData.planMonthValue) {
          planFinancialData.push({ year, month: pm, account, value });
        }
        // planMonth가 12가 아닐 때만 annual을 별도 월(12월)로 추가 (중복 방지)
        for (const [account, value] of rawPlanData.planAnnualValue) {
          planFinancialData.push({ year, month: 12, account, value });
        }

        const planBSRows = calculateBS(planFinancialData);
        const planWCRows = calculateWorkingCapital(planFinancialData);

        // BS 표용: BS 행에서만 plan 추출 (이익잉여금 등 양수 그대로)
        const bsAggMonth = new Map<string, number>();
        const bsAggAnnual = new Map<string, number>();
        for (const row of planBSRows) {
          bsAggMonth.set(row.account, row.values[pm - 1] ?? 0);
          bsAggAnnual.set(row.account, row.values[11] ?? 0);
        }

        // WC 표용: BS plan을 베이스로 깔고 WC 행으로 덮어쓰기 (부호 반전 반영)
        const wcAggMonth = new Map<string, number>(bsAggMonth);
        const wcAggAnnual = new Map<string, number>(bsAggAnnual);
        for (const row of planWCRows) {
          wcAggMonth.set(row.account, row.values[pm - 1] ?? 0);
          wcAggAnnual.set(row.account, row.values[11] ?? 0);
        }

        bsAggregatedPlanData = { planMonthValue: bsAggMonth, planAnnualValue: bsAggAnnual, planMonth: pm };
        wcAggregatedPlanData = { planMonthValue: wcAggMonth, planAnnualValue: wcAggAnnual, planMonth: pm };
      }

      tableRows = calculateComparisonDataBS(tableRows, prevTableRows, year, bsAggregatedPlanData);
      workingCapitalRows = calculateComparisonDataBS(workingCapitalRows, prevWorkingCapitalRows, year, wcAggregatedPlanData);
      
      // 2026년일 때 운전자본표에 2024년(기말) 부여 (2025년(기말) 전월대비용)
      if (year === 2026) {
        const twoYearsBackFilePath = path.join(process.cwd(), '파일', 'BS', '2024.csv');
        try {
          const data2024 = await readCSV(twoYearsBackFilePath, 2024);
          const wc2024 = calculateWorkingCapital(data2024);
          const wc2024ByAccount = new Map(wc2024.map((r) => [r.account, r]));
          workingCapitalRows = workingCapitalRows.map((row) => {
            const row2024 = wc2024ByAccount.get(row.account);
            const year2024Value = row2024?.values?.[11] ?? null;
            return { ...row, year2024Value };
          });
        } catch {
          // 2024 파일 없으면 year2024Value 없이 유지
        }
      }
      
      // 운전자본 비고 자동 생성 (BS 데이터 기반)
      wcRemarksAuto = generateWCRemarks(tableRows, prevTableRows, year);
    }
    
    const planMonth = year === 2026
      ? (tableRows[0]?.comparisons?.planMonth ?? null)
      : null;

    return NextResponse.json({
      year,
      type: 'BS',
      rows: tableRows,
      workingCapital: workingCapitalRows,
      wcRemarksAuto: wcRemarksAuto,
      planMonth,
    });
  } catch (error) {
    console.error('BS API 에러:', error);
    return NextResponse.json(
      { error: 'BS 데이터를 불러오는데 실패했습니다.' },
      { status: 500 }
    );
  }
}

