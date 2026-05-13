import { FinancialData, TableRow, ComparisonData, BrandComparisonData } from './types';

// 월별 데이터를 Map으로 변환
export function createMonthDataMap(data: FinancialData[]): Map<string, number[]> {
  const map = new Map<string, number[]>();
  
  data.forEach(({ account, month, value }) => {
    if (!map.has(account)) {
      map.set(account, new Array(12).fill(0));
    }
    const arr = map.get(account)!;
    arr[month - 1] = value;
  });
  
  return map;
}

// 계정 값 가져오기 (없으면 0으로 채워진 배열)
export function getAccountValues(map: Map<string, number[]>, account: string): number[] {
  return map.get(account) || new Array(12).fill(0);
}

// 법인 PL 합성용 브랜드 ID 목록
export const CORPORATE_PL_BRAND_IDS: string[] = ['mlb', 'kids', 'discovery', 'duvetica', 'supra'];

// 법인 PL의 5브랜드 합산 대상 계정 (calculatePL이 읽는 항목 전부)
const CORPORATE_SUM_ACCOUNTS: string[] = [
  // Tag매출 4-leaf (대리상/직영 × 의류/ACC)
  'Tag매출_대리상_APP', 'Tag매출_대리상_ACC', 'Tag매출_직영_APP', 'Tag매출_직영_ACC',
  // 실판매출 / 매출원가 / 평가감
  '실판매출', '매출원가', '평가감',
  // 직접비 10항목
  '급여(매장)', '복리후생비(매장)', '플랫폼수수료', 'TP수수료', '직접광고비',
  '대리상지원금', '물류비', '매장임차료', '감가상각비', '기타(직접비)',
  // 영업비 9항목
  '급여(사무실)', '복리후생비(사무실)', '광고비', '수주회', '지급수수료',
  '임차료', '감가상각비(영업비)', '세금과공과', '기타(영업비)',
];

/**
 * 5개 브랜드별 FinancialData를 법인 PL 형식으로 합성.
 * 모든 합산 대상 계정을 5브랜드 단순 합산.
 * calculatePL(synthData, false, adjustData) 호출 시 법인 PL 출력.
 */
export function synthesizeCorporatePLFromBrands(
  brandData: Record<string, FinancialData[]>,
  year: number,
): FinancialData[] {
  const out: FinancialData[] = [];

  for (const account of CORPORATE_SUM_ACCOUNTS) {
    const monthlySum: number[] = new Array(12).fill(0);
    const monthHasData: boolean[] = new Array(12).fill(false);
    for (const brandId of CORPORATE_PL_BRAND_IDS) {
      const rows = brandData[brandId];
      if (!rows) continue;
      for (const r of rows) {
        if (r.account === account && r.month >= 1 && r.month <= 12) {
          monthlySum[r.month - 1] += r.value;
          monthHasData[r.month - 1] = true;
        }
      }
    }
    for (let m = 1; m <= 12; m += 1) {
      if (monthHasData[m - 1]) {
        out.push({ year, month: m, account, value: monthlySum[m - 1] });
      }
    }
  }

  return out;
}

// 리테일매출 (Snowflake CHN.dw_sale 기반, 2025/2026만 전달됨)
//   1~latestActualMonth: leaf 분해 (의류/ACC) — Snowflake 실적
//   latestActualMonth+1~12: Level 1 (대리상/직영)만 PL(sim) 저장값 (leaf는 null/0)
export interface RetailPLData {
  대리상_의류: number[]; // 12개월 (계획월에는 0)
  대리상_ACC: number[];
  직영_의류: number[];
  직영_ACC: number[];
  /** 계획월(>latestActualMonth)에만 값, 그 외 null. Level 1 대리상 행 계획월 값으로 사용 */
  대리상_플랜?: (number | null)[];
  /** 계획월(>latestActualMonth)에만 값, 그 외 null. Level 1 직영 행 계획월 값으로 사용 */
  직영_플랜?: (number | null)[];
  /** 1-based 마지막 실적월. 이후 월은 plan 값 사용. 미지정 시 leaf 합산만 사용 */
  latestActualMonth?: number;
}

/** 5개 브랜드 RetailPLData를 합산하여 법인 RetailPLData 생성 */
export function aggregateRetailPLAcrossBrands(
  brandRetailMap: Partial<Record<string, RetailPLData>>,
): RetailPLData {
  const empty = (): number[] => new Array(12).fill(0);
  const emptyNullable = (): (number | null)[] => new Array(12).fill(null);
  const out: RetailPLData = {
    대리상_의류: empty(),
    대리상_ACC: empty(),
    직영_의류: empty(),
    직영_ACC: empty(),
    대리상_플랜: emptyNullable(),
    직영_플랜: emptyNullable(),
    latestActualMonth: 0,
  };
  for (const data of Object.values(brandRetailMap)) {
    if (!data) continue;
    for (const k of ['대리상_의류', '대리상_ACC', '직영_의류', '직영_ACC'] as const) {
      for (let i = 0; i < 12; i += 1) out[k][i] += data[k][i] ?? 0;
    }
    if (typeof data.latestActualMonth === 'number') {
      out.latestActualMonth = Math.max(out.latestActualMonth ?? 0, data.latestActualMonth);
    }
    for (const k of ['대리상_플랜', '직영_플랜'] as const) {
      const src = data[k];
      if (!src) continue;
      for (let i = 0; i < 12; i += 1) {
        const v = src[i];
        if (v == null) continue;
        out[k]![i] = (out[k]![i] ?? 0) + v;
      }
    }
  }
  return out;
}

// ==================== PL (손익계산서) ====================
export function calculatePL(
  data: FinancialData[],
  isBrand: boolean = false,
  adjustData?: FinancialData[],
  retailData?: RetailPLData,
): TableRow[] {
  const map = createMonthDataMap(data);

  // Tag매출 3단계 분해 (브랜드/법인 동일)
  //   Level 2 leaf: 대리상_의류(_APP), 대리상_ACC, 직영_의류(_APP), 직영_ACC
  //   Level 1: 대리상 = 대리상_의류 + 대리상_ACC, 직영 = 직영_의류 + 직영_ACC
  //   Level 0: Tag매출 = 대리상 + 직영
  const Tag매출_대리상_APP = getAccountValues(map, 'Tag매출_대리상_APP');
  const Tag매출_대리상_ACC = getAccountValues(map, 'Tag매출_대리상_ACC');
  const Tag매출_직영_APP = getAccountValues(map, 'Tag매출_직영_APP');
  const Tag매출_직영_ACC = getAccountValues(map, 'Tag매출_직영_ACC');
  const Tag매출_대리상 = Tag매출_대리상_APP.map((v, i) => v + Tag매출_대리상_ACC[i]);
  const Tag매출_직영 = Tag매출_직영_APP.map((v, i) => v + Tag매출_직영_ACC[i]);
  const Tag매출 = Tag매출_대리상.map((v, i) => v + Tag매출_직영[i]);
  
  // 실판매출 (파일에서 직접 읽기)
  const 실판매출 = getAccountValues(map, '실판매출');
  
  // 매출원가
  const 매출원가 = getAccountValues(map, '매출원가');
  const 평가감 = getAccountValues(map, '평가감');
  const 매출원가합계 = 매출원가.map((v, i) => v + 평가감[i]);
  const Tag대비원가율 = Tag매출.map((v, i) => (v !== 0 ? (매출원가[i] * 1.13) / v : null));
  
  // 매출총이익
  const 매출총이익 = 실판매출.map((v, i) => v - 매출원가합계[i]);
  
  // 직접비
  const 직접비항목 = [
    '급여(매장)',
    '복리후생비(매장)',
    '플랫폼수수료',
    'TP수수료',
    '직접광고비',
    '대리상지원금',
    '물류비',
    '매장임차료',
    '감가상각비',
    '기타(직접비)'
  ];
  const 직접비values = 직접비항목.map(acc => getAccountValues(map, acc));
  const 직접비합계 = 직접비values[0].map((_, i) =>
    직접비values.reduce((sum, arr) => sum + arr[i], 0)
  );
  
  // 영업비
  const 영업비항목 = [
    '급여(사무실)',
    '복리후생비(사무실)',
    '광고비',
    '수주회',
    '지급수수료',
    '임차료',
    '감가상각비(영업비)',
    '세금과공과',
    '기타(영업비)'
  ];
  const 영업비values = 영업비항목.map(acc => getAccountValues(map, acc));
  const 영업비합계 = 영업비values[0].map((_, i) =>
    영업비values.reduce((sum, arr) => sum + arr[i], 0)
  );
  
  // 영업이익
  const 영업이익 = 매출총이익.map((v, i) => v - 직접비합계[i] - 영업비합계[i]);
  
  // 영업이익률
  const 영업이익률 = 실판매출.map((v, i) => (v !== 0 ? 영업이익[i] / v : null));
  
  // 리테일매출 (2025/2026만 전달, 그 외 연도는 undefined → 행 미생성)
  const 리테일매출Rows: TableRow[] = [];
  if (retailData) {
    const r대리상_의류 = retailData.대리상_의류;
    const r대리상_ACC = retailData.대리상_ACC;
    const r직영_의류 = retailData.직영_의류;
    const r직영_ACC = retailData.직영_ACC;
    const latestActual = retailData.latestActualMonth ?? 0; // 1-based
    // Level 1: 1~latestActual = leaf합, latestActual+1~12 = plan 값 (있으면) / null
    const r대리상 = r대리상_의류.map((v, i) => {
      if (i < latestActual) return v + r대리상_ACC[i];
      return retailData.대리상_플랜?.[i] ?? 0;
    });
    const r직영 = r직영_의류.map((v, i) => {
      if (i < latestActual) return v + r직영_ACC[i];
      return retailData.직영_플랜?.[i] ?? 0;
    });
    const r리테일매출 = r대리상.map((v, i) => v + r직영[i]);
    리테일매출Rows.push(
      { account: '리테일매출', level: 0, isGroup: true, isCalculated: true, isBold: true, isHighlight: 'mint', values: r리테일매출, format: 'number' as const },
      { account: '리테일_대리상', displayLabel: '대리상', level: 1, isGroup: true, isCalculated: true, values: r대리상, format: 'number' as const },
      { account: '리테일_대리상_의류', displayLabel: '의류', level: 2, isGroup: false, isCalculated: false, values: r대리상_의류, format: 'number' as const },
      { account: '리테일_대리상_ACC', displayLabel: 'ACC', level: 2, isGroup: false, isCalculated: false, values: r대리상_ACC, format: 'number' as const },
      { account: '리테일_직영', displayLabel: '직영', level: 1, isGroup: true, isCalculated: true, values: r직영, format: 'number' as const },
      { account: '리테일_직영_의류', displayLabel: '의류', level: 2, isGroup: false, isCalculated: false, values: r직영_의류, format: 'number' as const },
      { account: '리테일_직영_ACC', displayLabel: 'ACC', level: 2, isGroup: false, isCalculated: false, values: r직영_ACC, format: 'number' as const },
    );
  }
  void isBrand; // 향후 사용 위해 시그니처 유지

  const rows: TableRow[] = [
    ...리테일매출Rows,
    {
      account: 'Tag매출',
      level: 0,
      isGroup: true,
      isCalculated: true,
      isBold: true,
      isHighlight: 'sky',
      values: Tag매출,
      format: 'number',
    },
    // 3단계 분해: 대리상/직영 → 의류/ACC (브랜드·법인 동일)
    { account: '대리상', level: 1, isGroup: true, isCalculated: true, values: Tag매출_대리상, format: 'number' as const },
    { account: '대리상_의류', displayLabel: '의류', level: 2, isGroup: false, isCalculated: false, values: Tag매출_대리상_APP, format: 'number' as const },
    { account: '대리상_ACC', displayLabel: 'ACC', level: 2, isGroup: false, isCalculated: false, values: Tag매출_대리상_ACC, format: 'number' as const },
    { account: '직영', level: 1, isGroup: true, isCalculated: true, values: Tag매출_직영, format: 'number' as const },
    { account: '직영_의류', displayLabel: '의류', level: 2, isGroup: false, isCalculated: false, values: Tag매출_직영_APP, format: 'number' as const },
    { account: '직영_ACC', displayLabel: 'ACC', level: 2, isGroup: false, isCalculated: false, values: Tag매출_직영_ACC, format: 'number' as const },
    {
      account: '실판매출',
      level: 0,
      isGroup: false,
      isCalculated: false,
      isBold: true,
      isHighlight: 'sky',
      values: 실판매출,
      format: 'number',
    },
    {
      account: '매출원가 합계',
      level: 0,
      isGroup: true,
      isCalculated: true,
      isBold: true,
      isHighlight: 'none',
      values: 매출원가합계,
      format: 'number',
    },
    { account: '매출원가', level: 1, isGroup: false, isCalculated: false, values: 매출원가, format: 'number' },
    { account: '평가감', level: 1, isGroup: false, isCalculated: false, values: 평가감, format: 'number' },
    { account: '(Tag 대비 원가율)', level: 1, isGroup: false, isCalculated: true, values: Tag대비원가율, format: 'percent' },
    {
      account: '매출총이익',
      level: 0,
      isGroup: false,
      isCalculated: true,
      isBold: true,
      isHighlight: 'mint',
      values: 매출총이익,
      format: 'number',
    },
    {
      account: '직접비',
      level: 0,
      isGroup: true,
      isCalculated: true,
      isBold: true,
      isHighlight: 'none',
      values: 직접비합계,
      format: 'number',
    },
    ...직접비항목.map((acc, idx) => ({
      account: acc,
      level: 1,
      isGroup: false,
      isCalculated: false,
      values: 직접비values[idx],
      format: 'number' as const,
    })),
    {
      account: '영업비',
      level: 0,
      isGroup: true,
      isCalculated: true,
      isBold: true,
      isHighlight: 'none',
      values: 영업비합계,
      format: 'number',
    },
    ...영업비항목.map((acc, idx) => ({
      account: acc,
      level: 1,
      isGroup: false,
      isCalculated: false,
      values: 영업비values[idx],
      format: 'number' as const,
    })),
    {
      account: '영업이익(관리식)',
      level: 0,
      isGroup: false,
      isCalculated: true,
      isBold: true,
      isHighlight: 'mint',
      values: 영업이익,
      format: 'number',
    },
    {
      account: '영업이익률(관리식)',
      level: 0,
      isGroup: false,
      isCalculated: true,
      isBold: true,
      isHighlight: 'none',
      values: 영업이익률,
      format: 'percent',
    },
  ];

  // 재무조정 데이터가 있으면 재무&관리차이(-) + 영업이익(IFRS) 행 추가
  if (adjustData) {
    const adjMap = createMonthDataMap(adjustData);
    const 재무조정항목 = [
      '사용권자산', '재무비용', '이연수익', '반품충당부채',
      '매출원가조정(credit)', '기타', '리베이트', '정부보조금',
    ];
    const 재무조정values = 재무조정항목.map(acc => getAccountValues(adjMap, acc));
    const 재무관리차이 = 재무조정values[0].map((_, i) =>
      재무조정values.reduce((sum, arr) => sum + arr[i], 0)
    );
    const 영업이익재무식 = 영업이익.map((v, i) => v - 재무관리차이[i]);
    // 매출(IFRS) = 실판매출 + 매출조정(재무식) (CSV 2개 행은 readCSV에서 이미 합산됨)
    const 매출조정재무식 = getAccountValues(adjMap, '매출조정(재무식)');
    const 매출재무식 = 실판매출.map((v, i) => v + 매출조정재무식[i]);
    const 영업이익률재무식 = 매출재무식.map((v, i) => (v !== 0 ? 영업이익재무식[i] / v : null));

    rows.push(
      {
        account: '재무&관리차이(-)',
        level: 0,
        isGroup: true,
        isCalculated: true,
        isBold: true,
        isHighlight: 'orange',
        values: 재무관리차이,
        format: 'number',
      },
      ...재무조정항목.map((acc, idx) => ({
        account: acc,
        level: 1,
        isGroup: false,
        isCalculated: false,
        values: 재무조정values[idx],
        format: 'number' as const,
      })),
      {
        account: '매출(IFRS)',
        level: 0,
        isGroup: false,
        isCalculated: true,
        isBold: true,
        isHighlight: 'yellow' as const,
        values: 매출재무식,
        format: 'number',
      },
      {
        account: '영업이익(IFRS)',
        level: 0,
        isGroup: false,
        isCalculated: true,
        isBold: true,
        isHighlight: 'yellow' as const,
        values: 영업이익재무식,
        format: 'number',
      },
      {
        account: '영업이익률(IFRS)',
        level: 0,
        isGroup: false,
        isCalculated: true,
        isBold: true,
        isHighlight: 'yellow' as const,
        values: 영업이익률재무식,
        format: 'percent',
      },
    );
  }

  return rows;
}

// PL 비교 데이터 계산
export function calculateComparisonData(
  currentYearData: TableRow[],
  previousYearData: TableRow[],
  baseMonth: number
): TableRow[] {
  const prevAccountMap = new Map<string, TableRow>();
  previousYearData.forEach(row => {
    prevAccountMap.set(row.account, row);
  });
  
  // 관련 계정 데이터를 Map으로 저장 (비율 재계산용)
  const currAccountMap = new Map<string, TableRow>();
  currentYearData.forEach(row => {
    currAccountMap.set(row.account, row);
  });
  
  const calculateYoY = (curr: number | null, prev: number | null): number | null => {
    if (curr === null || prev === null) return null;
    return curr - prev;
  };
  
  // YTD 합계 계산 헬퍼
  const calculateYTD = (values: (number | null)[]): number => {
    let sum = 0;
    for (let i = 0; i < baseMonth; i++) {
      sum += values[i] || 0;
    }
    return sum;
  };
  
  // 연간 합계 계산 헬퍼
  const calculateAnnual = (values: (number | null)[]): number => {
    return values.reduce((sum: number, v) => sum + (v || 0), 0);
  };

  const result = currentYearData.map(row => {
    const prevRow = prevAccountMap.get(row.account);

    if (!prevRow) {
      return {
        ...row,
        comparisons: {
          prevYearMonth: null,
          currYearMonth: null,
          monthYoY: null,
          prevYearYTD: null,
          currYearYTD: null,
          ytdYoY: null,
          prevYearAnnual: null,
          currYearAnnual: null,
          annualYoY: null,
        },
      };
    }
    
    const prev2024 = prevRow.values;
    const curr2025 = row.values;
    
    // 월별 비교
    const prevYearMonth = prev2024[baseMonth - 1] ?? null;
    const currYearMonth = curr2025[baseMonth - 1] ?? null;
    const monthYoY = calculateYoY(currYearMonth, prevYearMonth);
    
    // 비율 항목인지 확인
    const isRatioAccount = row.account === '(Tag 대비 원가율)' || row.account === '영업이익률(관리식)' || row.account === '영업이익률(IFRS)';

    let prevYearYTD: number | null = null;
    let currYearYTD: number | null = null;
    let prevYearAnnual: number | null = null;
    let currYearAnnual: number | null = null;
    
    if (isRatioAccount) {
      // 비율 항목은 재계산 필요
      if (row.account === '(Tag 대비 원가율)') {
        // Tag 대비 원가율 = 매출원가 x 1.13 / Tag매출
        const curr매출원가 = currAccountMap.get('매출원가');
        const prev매출원가 = prevAccountMap.get('매출원가');
        const currTag매출 = currAccountMap.get('Tag매출');
        const prevTag매출 = prevAccountMap.get('Tag매출');
        
        if (curr매출원가 && prev매출원가 && currTag매출 && prevTag매출) {
          // YTD 재계산
          const currYTD매출원가 = calculateYTD(curr매출원가.values);
          const prevYTD매출원가 = calculateYTD(prev매출원가.values);
          const currYTDTag매출 = calculateYTD(currTag매출.values);
          const prevYTDTag매출 = calculateYTD(prevTag매출.values);
          
          currYearYTD = currYTDTag매출 !== 0 ? (currYTD매출원가 * 1.13) / currYTDTag매출 : null;
          prevYearYTD = prevYTDTag매출 !== 0 ? (prevYTD매출원가 * 1.13) / prevYTDTag매출 : null;
          
          // 연간 재계산
          const currAnnual매출원가 = calculateAnnual(curr매출원가.values);
          const prevAnnual매출원가 = calculateAnnual(prev매출원가.values);
          const currAnnualTag매출 = calculateAnnual(currTag매출.values);
          const prevAnnualTag매출 = calculateAnnual(prevTag매출.values);
          
          currYearAnnual = currAnnualTag매출 !== 0 ? (currAnnual매출원가 * 1.13) / currAnnualTag매출 : null;
          prevYearAnnual = prevAnnualTag매출 !== 0 ? (prevAnnual매출원가 * 1.13) / prevAnnualTag매출 : null;
        }
      } else if (row.account === '영업이익률(관리식)') {
        // 영업이익률 = 영업이익 / 실판매출
        const curr영업이익 = currAccountMap.get('영업이익(관리식)');
        const prev영업이익 = prevAccountMap.get('영업이익(관리식)');
        const curr실판매출 = currAccountMap.get('실판매출');
        const prev실판매출 = prevAccountMap.get('실판매출');
        
        if (curr영업이익 && prev영업이익 && curr실판매출 && prev실판매출) {
          // YTD 재계산
          const currYTD영업이익 = calculateYTD(curr영업이익.values);
          const prevYTD영업이익 = calculateYTD(prev영업이익.values);
          const currYTD실판매출 = calculateYTD(curr실판매출.values);
          const prevYTD실판매출 = calculateYTD(prev실판매출.values);
          
          currYearYTD = currYTD실판매출 !== 0 ? currYTD영업이익 / currYTD실판매출 : null;
          prevYearYTD = prevYTD실판매출 !== 0 ? prevYTD영업이익 / prevYTD실판매출 : null;
          
          // 연간 재계산
          const currAnnual영업이익 = calculateAnnual(curr영업이익.values);
          const prevAnnual영업이익 = calculateAnnual(prev영업이익.values);
          const currAnnual실판매출 = calculateAnnual(curr실판매출.values);
          const prevAnnual실판매출 = calculateAnnual(prev실판매출.values);
          
          currYearAnnual = currAnnual실판매출 !== 0 ? currAnnual영업이익 / currAnnual실판매출 : null;
          prevYearAnnual = prevAnnual실판매출 !== 0 ? prevAnnual영업이익 / prevAnnual실판매출 : null;
        }
      } else if (row.account === '영업이익률(IFRS)') {
        // 영업이익률(IFRS) = 영업이익(IFRS) / 매출(IFRS)
        const curr영업이익재무 = currAccountMap.get('영업이익(IFRS)');
        const prev영업이익재무 = prevAccountMap.get('영업이익(IFRS)');
        const curr매출재무 = currAccountMap.get('매출(IFRS)');
        const prev매출재무 = prevAccountMap.get('매출(IFRS)');

        if (curr영업이익재무 && prev영업이익재무 && curr매출재무 && prev매출재무) {
          const currYTD영업이익재무 = calculateYTD(curr영업이익재무.values);
          const prevYTD영업이익재무 = calculateYTD(prev영업이익재무.values);
          const currYTD매출재무 = calculateYTD(curr매출재무.values);
          const prevYTD매출재무 = calculateYTD(prev매출재무.values);

          currYearYTD = currYTD매출재무 !== 0 ? currYTD영업이익재무 / currYTD매출재무 : null;
          prevYearYTD = prevYTD매출재무 !== 0 ? prevYTD영업이익재무 / prevYTD매출재무 : null;

          const currAnnual영업이익재무 = calculateAnnual(curr영업이익재무.values);
          const prevAnnual영업이익재무 = calculateAnnual(prev영업이익재무.values);
          const currAnnual매출재무 = calculateAnnual(curr매출재무.values);
          const prevAnnual매출재무 = calculateAnnual(prev매출재무.values);

          currYearAnnual = currAnnual매출재무 !== 0 ? currAnnual영업이익재무 / currAnnual매출재무 : null;
          prevYearAnnual = prevAnnual매출재무 !== 0 ? prevAnnual영업이익재무 / prevAnnual매출재무 : null;
        }
      }
    } else {
      // 일반 항목은 단순 합산
      prevYearYTD = calculateYTD(prev2024);
      currYearYTD = calculateYTD(curr2025);
      prevYearAnnual = calculateAnnual(prev2024);
      currYearAnnual = calculateAnnual(curr2025);
    }
    
    const ytdYoY = calculateYoY(currYearYTD, prevYearYTD);
    const annualYoY = calculateYoY(currYearAnnual, prevYearAnnual);
    
    const comparisons: ComparisonData = {
      prevYearMonth,
      currYearMonth,
      monthYoY,
      prevYearYTD,
      currYearYTD,
      ytdYoY,
      prevYearAnnual,
      currYearAnnual,
      annualYoY,
      prevYearMonthly: prev2024.slice(0, 12),
    };

    return { ...row, comparisons };
  });

  return result;
}

// 브랜드별 비교 데이터 계산 (브랜드별 손익 보기 전용)
export function calculateBrandBreakdown(
  corporateRows: TableRow[],
  brandRowsMap: Map<string, TableRow[]>, // brand -> TableRow[]
  baseMonth: number
): TableRow[] {
  const brands = ['MLB', 'KIDS', 'DISCOVERY', 'DUVETICA', 'SUPRA'];
  
  return corporateRows.map(row => {
    const brandComparisons: BrandComparisonData = {
      month: {
        prevYear: {},
        currYear: {},
      },
      ytd: {
        prevYear: {},
        currYear: {},
      },
      annual: {
        prevYear: {},
        currYear: {},
      },
    };

    // 각 브랜드별 데이터 추출
    brands.forEach(brand => {
      const brandKey = brand.toLowerCase(); // 소문자 키 사용
      const brandRows = brandRowsMap.get(brandKey);
      if (!brandRows) {
        brandComparisons.month.prevYear[brandKey] = null;
        brandComparisons.month.currYear[brandKey] = null;
        brandComparisons.ytd.prevYear[brandKey] = null;
        brandComparisons.ytd.currYear[brandKey] = null;
        brandComparisons.annual.prevYear[brandKey] = null;
        brandComparisons.annual.currYear[brandKey] = null;
        return;
      }

      // 해당 계정 찾기
      const brandRow = brandRows.find(r => r.account === row.account);
      if (!brandRow || !brandRow.comparisons) {
        brandComparisons.month.prevYear[brandKey] = null;
        brandComparisons.month.currYear[brandKey] = null;
        brandComparisons.ytd.prevYear[brandKey] = null;
        brandComparisons.ytd.currYear[brandKey] = null;
        brandComparisons.annual.prevYear[brandKey] = null;
        brandComparisons.annual.currYear[brandKey] = null;
        return;
      }

      const comp = brandRow.comparisons;
      
      // 월별 데이터
      brandComparisons.month.prevYear[brandKey] = comp.prevYearMonth;
      brandComparisons.month.currYear[brandKey] = comp.currYearMonth;
      
      // YTD 데이터
      brandComparisons.ytd.prevYear[brandKey] = comp.prevYearYTD;
      brandComparisons.ytd.currYear[brandKey] = comp.currYearYTD;
      
      // 연간 데이터
      brandComparisons.annual.prevYear[brandKey] = comp.prevYearAnnual;
      brandComparisons.annual.currYear[brandKey] = comp.currYearAnnual;
    });

    return {
      ...row,
      brandComparisons,
    };
  });
}

// ==================== BS (재무상태표) ====================
export function calculateBS(data: FinancialData[]): TableRow[] {
  const map = createMonthDataMap(data);
  
  // 기본 계정
  const 현금및현금성자산 = getAccountValues(map, '현금 및 현금성자산');
  const 직영AR = getAccountValues(map, '직영AR');
  const 대리상AR = getAccountValues(map, '대리상AR');
  const hasInventoryBreakdown = map.has('MLB') || map.has('KIDS') || map.has('DISCOVERY');
  const MLB = getAccountValues(map, 'MLB');
  const KIDS = getAccountValues(map, 'KIDS');
  const DISCOVERY = getAccountValues(map, 'DISCOVERY');
  const 재고자산 = hasInventoryBreakdown
    ? MLB.map((v, i) => v + KIDS[i] + DISCOVERY[i])
    : getAccountValues(map, '재고자산');
  const 선급금본사 = getAccountValues(map, '선급금(본사)');
  const 선급금기타 = getAccountValues(map, '선급금(기타)');
  const 기타유동자산 = getAccountValues(map, '기타 유동자산');
  const 사용권자산 = getAccountValues(map, '사용권자산');
  const 이연법인세자산 = getAccountValues(map, '이연법인세자산');
  const 유무형자산 = getAccountValues(map, '유,무형자산');
  const 본사AP = getAccountValues(map, '본사 AP');
  const 제품AP = getAccountValues(map, '제품 AP');
  const 미착품BS = getAccountValues(map, '미착품');
  const 차입금 = getAccountValues(map, '차입금');
  const 대리상선수금 = getAccountValues(map, '대리상선수금');
  const 대리상지원금 = getAccountValues(map, '대리상지원금');
  const 기타유동부채 = getAccountValues(map, '기타 유동부채');
  const 리스부채 = getAccountValues(map, '리스부채(장,단기)');
  const 장기보증금 = getAccountValues(map, '장기보증금');
  const 자본금 = getAccountValues(map, '자본금');
  const 이익잉여금 = getAccountValues(map, '이익잉여금');
  
  // 계산
  const 외상매출금 = 직영AR.map((v, i) => v + 대리상AR[i]);
  const 유동자산 = 현금및현금성자산.map((v, i) => 
    v + 외상매출금[i] + 재고자산[i] + 선급금본사[i] + 선급금기타[i] + 기타유동자산[i]
  );
  const 비유동자산 = 사용권자산.map((v, i) => v + 이연법인세자산[i] + 유무형자산[i]);
  const 자산 = 유동자산.map((v, i) => v + 비유동자산[i]);
  
  const 외상매입금 = 본사AP.map((v, i) => v + 제품AP[i] + 미착품BS[i]);
  const 유동부채 = 외상매입금.map((v, i) => 
    v + 차입금[i] + 대리상선수금[i] + 대리상지원금[i] + 기타유동부채[i]
  );
  const 비유동부채 = 리스부채.map((v, i) => v + 장기보증금[i]);
  const 부채 = 유동부채.map((v, i) => v + 비유동부채[i]);
  
  const 자본 = 자본금.map((v, i) => v + 이익잉여금[i]);
  
  const rows: TableRow[] = [
    {
      account: '자산',
      level: 0,
      isGroup: true,
      isCalculated: true,
      isBold: true,
      isHighlight: 'sky',
      values: 자산,
      format: 'number',
    },
    {
      account: '유동자산',
      level: 1,
      isGroup: true,
      isCalculated: true,
      isBold: true,
      isHighlight: 'yellow',
      values: 유동자산,
      format: 'number',
    },
    { account: '현금 및 현금성자산', level: 2, isGroup: false, isCalculated: false, values: 현금및현금성자산, format: 'number' },
    {
      account: '외상매출금',
      level: 2,
      isGroup: true,
      isCalculated: true,
      isBold: true,
      values: 외상매출금,
      format: 'number',
    },
    { account: '직영AR', level: 3, isGroup: false, isCalculated: false, values: 직영AR, format: 'number' },
    { account: '대리상AR', level: 3, isGroup: false, isCalculated: false, values: 대리상AR, format: 'number' },
    ...(hasInventoryBreakdown
      ? [
          { account: '재고자산', level: 2, isGroup: true, isCalculated: true, isBold: true, values: 재고자산, format: 'number' as const },
          { account: 'MLB', level: 3, isGroup: false, isCalculated: false, values: MLB, format: 'number' as const },
          { account: 'KIDS', level: 3, isGroup: false, isCalculated: false, values: KIDS, format: 'number' as const },
          { account: 'DISCOVERY', level: 3, isGroup: false, isCalculated: false, values: DISCOVERY, format: 'number' as const },
        ]
      : [{ account: '재고자산', level: 2, isGroup: false, isCalculated: false, values: 재고자산, format: 'number' as const }]),
    { account: '선급금(본사)', level: 2, isGroup: false, isCalculated: false, values: 선급금본사, format: 'number' },
    { account: '선급금(기타)', level: 2, isGroup: false, isCalculated: false, values: 선급금기타, format: 'number' },
    { account: '기타 유동자산', level: 2, isGroup: false, isCalculated: false, values: 기타유동자산, format: 'number' },
    {
      account: '비유동자산',
      level: 1,
      isGroup: true,
      isCalculated: true,
      isBold: true,
      isHighlight: 'yellow',
      values: 비유동자산,
      format: 'number',
    },
    { account: '사용권자산', level: 2, isGroup: false, isCalculated: false, values: 사용권자산, format: 'number' },
    { account: '이연법인세자산', level: 2, isGroup: false, isCalculated: false, values: 이연법인세자산, format: 'number' },
    { account: '유,무형자산', level: 2, isGroup: false, isCalculated: false, values: 유무형자산, format: 'number' },
    {
      account: '부채',
      level: 0,
      isGroup: true,
      isCalculated: true,
      isBold: true,
      isHighlight: 'pink',
      values: 부채,
      format: 'number',
    },
    {
      account: '유동부채',
      level: 1,
      isGroup: true,
      isCalculated: true,
      isBold: true,
      isHighlight: 'yellow',
      values: 유동부채,
      format: 'number',
    },
    {
      account: '외상매입금',
      level: 2,
      isGroup: true,
      isCalculated: true,
      isBold: true,
      values: 외상매입금,
      format: 'number',
    },
    { account: '본사 AP', level: 3, isGroup: false, isCalculated: false, values: 본사AP, format: 'number' },
    { account: '제품 AP', level: 3, isGroup: false, isCalculated: false, values: 제품AP, format: 'number' },
    { account: '미착품', level: 3, isGroup: false, isCalculated: false, values: 미착품BS, format: 'number' },
    { account: '차입금', level: 2, isGroup: false, isCalculated: false, values: 차입금, format: 'number' },
    { account: '대리상선수금', level: 2, isGroup: false, isCalculated: false, values: 대리상선수금, format: 'number' },
    { account: '대리상지원금', level: 2, isGroup: false, isCalculated: false, values: 대리상지원금, format: 'number' },
    { account: '기타 유동부채', level: 2, isGroup: false, isCalculated: false, values: 기타유동부채, format: 'number' },
    {
      account: '비유동부채',
      level: 1,
      isGroup: true,
      isCalculated: true,
      isBold: true,
      isHighlight: 'yellow',
      values: 비유동부채,
      format: 'number',
    },
    { account: '리스부채(장,단기)', level: 2, isGroup: false, isCalculated: false, values: 리스부채, format: 'number' },
    { account: '장기보증금', level: 2, isGroup: false, isCalculated: false, values: 장기보증금, format: 'number' },
    {
      account: '자본',
      level: 0,
      isGroup: true,
      isCalculated: true,
      isBold: true,
      isHighlight: 'mint',
      values: 자본,
      format: 'number',
    },
    { account: '자본금', level: 1, isGroup: false, isCalculated: false, values: 자본금, format: 'number' },
    { account: '이익잉여금', level: 1, isGroup: false, isCalculated: false, values: 이익잉여금, format: 'number' },
  ];
  
  return rows;
}

// 운전자본 계산
export function calculateWorkingCapital(data: FinancialData[]): TableRow[] {
  const map = createMonthDataMap(data);
  
  // 기본 계정 (재무상태표에서 가져옴)
  const 직영AR = getAccountValues(map, '직영AR');
  const 대리상AR = getAccountValues(map, '대리상AR');
  const hasInventoryBreakdown = map.has('MLB') || map.has('KIDS') || map.has('DISCOVERY');
  const MLB = getAccountValues(map, 'MLB');
  const KIDS = getAccountValues(map, 'KIDS');
  const DISCOVERY = getAccountValues(map, 'DISCOVERY');
  const 재고자산 = hasInventoryBreakdown
    ? MLB.map((v, i) => v + KIDS[i] + DISCOVERY[i])
    : getAccountValues(map, '재고자산');
  const 선급금본사 = getAccountValues(map, '선급금(본사)');
  const 본사AP = getAccountValues(map, '본사 AP');
  const 제품AP = getAccountValues(map, '제품 AP');
  const 미착품WC = getAccountValues(map, '미착품');
  const 대리상선수금 = getAccountValues(map, '대리상선수금');
  const 대리상지원금 = getAccountValues(map, '대리상지원금');
  const 현금및현금성자산 = getAccountValues(map, '현금 및 현금성자산');
  const 차입금 = getAccountValues(map, '차입금');
  const 이익잉여금 = getAccountValues(map, '이익잉여금');
  const 선급금기타 = getAccountValues(map, '선급금(기타)');
  const 이연법인세자산 = getAccountValues(map, '이연법인세자산');
  const 유무형자산 = getAccountValues(map, '유,무형자산');
  const 장기보증금 = getAccountValues(map, '장기보증금');
  const 기타유동자산 = getAccountValues(map, '기타 유동자산');
  const 기타유동부채 = getAccountValues(map, '기타 유동부채');
  const 사용권자산 = getAccountValues(map, '사용권자산');
  const 리스부채 = getAccountValues(map, '리스부채(장,단기)');
  const 자본금 = getAccountValues(map, '자본금');
  
  // 계산
  const 외상매출금 = 직영AR.map((v, i) => v + 대리상AR[i]);
  const 외상매입금 = 본사AP.map((v, i) => -(v + 제품AP[i] + 미착품WC[i])); // 마이너스
  const 운전자본 = 외상매출금.map((v, i) => v + 재고자산[i] + 선급금본사[i] + 외상매입금[i]);
  
  const from대리상 = 대리상선수금.map((v, i) => -(v + 대리상지원금[i])); // 마이너스
  const from현금차입금 = 현금및현금성자산.map((v, i) => v - 차입금[i]);
  const from이익창출 = 이익잉여금.map((v, i) => -v); // 마이너스
  
  const 선급비용 = 선급금기타.map((v, i) => v + 이연법인세자산[i]);
  const 고정자산보증금 = 유무형자산.map((v, i) => v - 장기보증금[i]);
  const 미수금미지급금 = 기타유동자산.map((v, i) => v - 기타유동부채[i]);
  const 기타운전자본 = 선급비용.map((v, i) => v + 고정자산보증금[i] + 미수금미지급금[i]);
  
  const 리스관련 = 사용권자산.map((v, i) => v - 리스부채[i]);
  
  const balanceCheck = 운전자본.map((v, i) => 
    v + from대리상[i] + from현금차입금[i] + from이익창출[i] + 기타운전자본[i] + 리스관련[i] - 자본금[i]
  );
  
  const rows: TableRow[] = [
    {
      account: '운전자본',
      level: 0,
      isGroup: true,
      isCalculated: true,
      isBold: true,
      isHighlight: 'sky',
      values: 운전자본,
      format: 'number',
    },
    {
      account: '외상매출금',
      level: 1,
      isGroup: true,
      isCalculated: true,
      isBold: true,
      values: 외상매출금,
      format: 'number',
    },
    { account: '직영AR', level: 2, isGroup: false, isCalculated: false, values: 직영AR, format: 'number' },
    { account: '대리상AR', level: 2, isGroup: false, isCalculated: false, values: 대리상AR, format: 'number' },
    ...(hasInventoryBreakdown
      ? [
          { account: '재고자산', level: 1, isGroup: true, isCalculated: true, isBold: true, values: 재고자산, format: 'number' as const },
          { account: 'MLB', level: 2, isGroup: false, isCalculated: false, values: MLB, format: 'number' as const },
          { account: 'KIDS', level: 2, isGroup: false, isCalculated: false, values: KIDS, format: 'number' as const },
          { account: 'DISCOVERY', level: 2, isGroup: false, isCalculated: false, values: DISCOVERY, format: 'number' as const },
        ]
      : [{ account: '재고자산', level: 1, isGroup: false, isCalculated: false, values: 재고자산, format: 'number' as const }]),
    { account: '본사선급금', level: 1, isGroup: false, isCalculated: false, values: 선급금본사, format: 'number' },
    {
      account: '외상매입금',
      level: 1,
      isGroup: true,
      isCalculated: true,
      isBold: true,
      values: 외상매입금,
      format: 'number',
    },
    { account: '본사AP', level: 2, isGroup: false, isCalculated: false, values: 본사AP.map(v => -v), format: 'number' },
    { account: '제품AP', level: 2, isGroup: false, isCalculated: false, values: 제품AP.map(v => -v), format: 'number' },
    { account: '미착품', level: 2, isGroup: false, isCalculated: false, values: 미착품WC.map(v => -v), format: 'number' },
    {
      account: 'from대리상',
      level: 0,
      isGroup: true,
      isCalculated: true,
      isBold: true,
      isHighlight: 'sky',
      values: from대리상,
      format: 'number',
    },
    { account: '대리상선수금', level: 1, isGroup: false, isCalculated: false, values: 대리상선수금.map(v => -v), format: 'number' },
    { account: '대리상지원금', level: 1, isGroup: false, isCalculated: false, values: 대리상지원금.map(v => -v), format: 'number' },
    {
      account: 'from 현금/차입금',
      level: 0,
      isGroup: true,
      isCalculated: true,
      isBold: true,
      isHighlight: 'sky',
      values: from현금차입금,
      format: 'number',
    },
    { account: '현금', level: 1, isGroup: false, isCalculated: false, values: 현금및현금성자산, format: 'number' },
    { account: '차입금', level: 1, isGroup: false, isCalculated: false, values: 차입금.map(v => -v), format: 'number' },
    {
      account: 'from 이익창출',
      level: 0,
      isGroup: true,
      isCalculated: true,
      isBold: true,
      isHighlight: 'sky',
      values: from이익창출,
      format: 'number',
    },
    { account: '이익잉여금', level: 1, isGroup: false, isCalculated: false, values: 이익잉여금.map(v => -v), format: 'number' },
    {
      account: '기타운전자본',
      level: 0,
      isGroup: true,
      isCalculated: true,
      isBold: true,
      isHighlight: 'sky',
      values: 기타운전자본,
      format: 'number',
    },
    { account: '선급비용', level: 1, isGroup: false, isCalculated: true, values: 선급비용, format: 'number' },
    { account: '고정자산/보증금', level: 1, isGroup: false, isCalculated: true, values: 고정자산보증금, format: 'number' },
    { account: '미수금/미지급금', level: 1, isGroup: false, isCalculated: true, values: 미수금미지급금, format: 'number' },
    {
      account: '리스관련',
      level: 0,
      isGroup: true,
      isCalculated: true,
      isBold: true,
      isHighlight: 'sky',
      values: 리스관련,
      format: 'number',
    },
    { account: '사용권자산', level: 1, isGroup: false, isCalculated: false, values: 사용권자산, format: 'number' },
    { account: '리스부채', level: 1, isGroup: false, isCalculated: false, values: 리스부채.map(v => -v), format: 'number' },
    {
      account: 'Balance Check',
      level: 0,
      isGroup: false,
      isCalculated: true,
      isBold: true,
      isHighlight: 'none',
      values: balanceCheck,
      format: 'number',
    },
  ];
  
  return rows;
}

// BS 비교 데이터 계산 (2025 vs 2024, 2026 vs 2025)
export function calculateComparisonDataBS(
  currentYearData: TableRow[],
  previousYearData: TableRow[],
  currentYear: number,
  planData?: {
    planMonthValue: Map<string, number>;
    planAnnualValue: Map<string, number>;
    planMonth: number;
  } | null,
): TableRow[] {
  const baseMonth = 12; // 고정: 12월
  
  // 계정별 매핑
  const prevAccountMap = new Map<string, TableRow>();
  previousYearData.forEach(row => {
    prevAccountMap.set(row.account, row);
  });
  
  const calculateYoY = (curr: number | null, prev: number | null): number | null => {
    if (curr === null || prev === null) return null;
    return curr - prev; // 차이값
  };
  
  const result = currentYearData.map(row => {
    const prevRow = prevAccountMap.get(row.account);
    
    if (!prevRow) {
      return {
        ...row,
        comparisons: {
          prevYearMonth: null,
          currYearMonth: null,
          monthYoY: null,
          prevYearYTD: null,
          currYearYTD: null,
          ytdYoY: null,
          prevYearAnnual: null,
          currYearAnnual: null,
          annualYoY: null,
          currMonthPlan: null,
          annualPlan: null,
          monthYoYActual: null,
          planVsActual: null,
          planMonth: planData?.planMonth ?? null,
        },
      };
    }
    
    const prevValues = prevRow.values;
    const currValues = row.values;
    
    let comparisons: ComparisonData;
    
    if (currentYear === 2026) {
      // 2026년: 25년기말 vs 26년기말(12월)
      const prevYearAnnual = prevValues[11] ?? null; // 25년 12월 (index 11)
      const currYearAnnual = currValues[11] ?? null; // 26년 12월 (index 11)
      const annualYoY = calculateYoY(currYearAnnual, prevYearAnnual);

      // 계획 데이터
      const pm = planData?.planMonth ?? null;
      const currMonthActual = pm !== null ? (currValues[pm - 1] ?? null) : null;
      const currMonthPlan = planData ? (planData.planMonthValue.get(row.account) ?? null) : null;
      // 당월 계획비 = 실적 - 계획
      const monthYoYActual = calculateYoY(currMonthActual, currMonthPlan);
      const annualPlan = planData ? (planData.planAnnualValue.get(row.account) ?? null) : null;
      const planVsActual = calculateYoY(currYearAnnual, annualPlan);
      
      comparisons = {
        prevYearMonth: pm !== null ? (prevValues[pm - 1] ?? null) : null, // 전년 N-1월 실적
        currYearMonth: currMonthActual, // 당월 실적
        monthYoY: null,
        prevYearYTD: null,
        currYearYTD: null,
        ytdYoY: null,
        prevYearAnnual, // 25년기말
        currYearAnnual, // 26년기말 예상
        annualYoY,
        currMonthPlan,
        annualPlan,
        monthYoYActual,
        planVsActual,
        planMonth: pm,
      };
    } else {
      // 2025년: 전년(11월) 당년(11월) + 24년기말 25년기말
      const prevYearMonth = prevValues[baseMonth - 1] ?? null;
      const currYearMonth = currValues[baseMonth - 1] ?? null;
      const monthYoY = calculateYoY(currYearMonth, prevYearMonth);
      
      const prevYearAnnual = prevValues[11] ?? null; // 12월 (index 11)
      const currYearAnnual = currValues[11] ?? null;
      const annualYoY = calculateYoY(currYearAnnual, prevYearAnnual);
      
      comparisons = {
        prevYearMonth,
        currYearMonth,
        monthYoY,
        prevYearYTD: null, // BS는 YTD 없음
        currYearYTD: null,
        ytdYoY: null,
        prevYearAnnual,
        currYearAnnual,
        annualYoY,
      };
    }
    
    return { ...row, comparisons };
  });
  
  return result;
}

// ==================== CF (현금흐름표) ====================
export function calculateCF(
  data: FinancialData[], 
  year2024Values: Map<string, number>,
  year: number = 2025,
  previousYearTotals?: Map<string, number>
): TableRow[] {
  const map = createMonthDataMap(data);
  
  const INITIAL_CASH = 140853827.859988;
  
  // 2024년 값 가져오기 헬퍼
  const get2024Value = (account: string): number | null => {
    return year2024Values.get(account) ?? null;
  };
  
  const sum2024Values = (accounts: string[]): number | null => {
    let sum = 0;
    let hasValue = false;
    for (const acc of accounts) {
      const val = year2024Values.get(acc);
      if (val !== undefined) {
        sum += val;
        hasValue = true;
      }
    }
    return hasValue ? sum : null;
  };
  
  // 매출수금
  const MLB = getAccountValues(map, 'MLB');
  const KIDS = getAccountValues(map, 'KIDS');
  const Discovery = getAccountValues(map, 'Discovery');
  const Duvetica = getAccountValues(map, 'Duvetica');
  const Supra = getAccountValues(map, 'Supra');
  const 매출수금 = MLB.map((v, i) => v + KIDS[i] + Discovery[i] + Duvetica[i] + Supra[i]);
  
  // 기타수익
  const 대리상선금 = getAccountValues(map, '대리상선금');
  const 대리상보증금 = getAccountValues(map, '대리상보증금');
  const 정부보조금 = getAccountValues(map, '정부보조금');
  const 기타수익 = getAccountValues(map, '기타수익');
  const 기타수익합계 = 대리상선금.map((v, i) => v + 대리상보증금[i] + 정부보조금[i] + 기타수익[i]);
  
  const 입금 = 매출수금.map((v, i) => v + 기타수익합계[i]);
  
  // 상품대
  const 본사 = getAccountValues(map, '본사');
  const 위탁생산 = getAccountValues(map, '위탁생산');
  const 상품대 = 본사.map((v, i) => v + 위탁생산[i]);
  
  const 본사선급금 = getAccountValues(map, '본사선급금');
  const 운영비 = getAccountValues(map, '운영비');
  const 출금 = 상품대.map((v, i) => v + 본사선급금[i] + 운영비[i]);
  
  const 영업활동 = 입금.map((v, i) => v + 출금[i]);
  
  // 재무활동
  const 차입금입금 = getAccountValues(map, '차입금입금');
  const 차입금상환 = getAccountValues(map, '차입금상환');
  const 재무활동 = 차입금입금.map((v, i) => v + 차입금상환[i]);
  
  // 투자활동
  const 자산성지출 = getAccountValues(map, '자산성지출');
  const 투자활동 = 자산성지출;
  
  // 합계 계산 (12개월)
  const sumArray = (arr: number[]) => arr.reduce((sum: number, v) => sum + v, 0);
  
  // 2024년 데이터 계산
  const 기초현금2024 = year2024Values.get('기초현금') ?? 140853827.859988; // CSV에서 읽거나 기본값
  const 영업활동2024 = sum2024Values(['MLB', 'KIDS', 'Discovery', 'Duvetica', 'Supra', '대리상선금', '대리상보증금', '정부보조금', '기타수익', '본사', '위탁생산', '본사선급금', '운영비']);
  const 입금2024 = sum2024Values(['MLB', 'KIDS', 'Discovery', 'Duvetica', 'Supra', '대리상선금', '대리상보증금', '정부보조금', '기타수익']);
  const 매출수금2024 = sum2024Values(['MLB', 'KIDS', 'Discovery', 'Duvetica', 'Supra']);
  const 기타수익2024 = sum2024Values(['대리상선금', '대리상보증금', '정부보조금', '기타수익']);
  const 출금2024 = sum2024Values(['본사', '위탁생산', '본사선급금', '운영비']);
  const 상품대2024 = sum2024Values(['본사', '위탁생산']);
  const 재무활동2024 = sum2024Values(['차입금입금', '차입금상환']);
  const 투자활동2024 = sum2024Values(['자산성지출']);
  // 2024년 기말현금 계산 (기초현금 + 영업활동 + 재무활동 + 투자활동)
  const 기말현금2024 = 기초현금2024 + (영업활동2024 ?? 0) + (재무활동2024 ?? 0) + (투자활동2024 ?? 0);
  
  // 현재년도 기말현금 계산
  // 2025년 1월 기초현금 = 2024년 기말현금
  // 2026년 1월 기초현금 = 2025년 기말현금 (previousYearTotals에서 가져옴)
  const 기초현금 = new Array(12).fill(0);
  const 기말현금 = new Array(12).fill(0);
  
  if (year === 2025) {
    기초현금[0] = 기말현금2024; // 2024년 기말현금을 2025년 1월 기초현금으로
  } else if (year === 2026 && previousYearTotals) {
    const 기말현금2025 = previousYearTotals.get('기말현금') ?? 기말현금2024;
    기초현금[0] = 기말현금2025; // 2025년 기말현금을 2026년 1월 기초현금으로
  }
  
  기말현금[0] = 기초현금[0] + 영업활동[0] + 재무활동[0] + 투자활동[0];
  
  for (let i = 1; i < 12; i++) {
    기초현금[i] = 기말현금[i - 1];
    기말현금[i] = 기초현금[i] + 영업활동[i] + 재무활동[i] + 투자활동[i];
  }

  // YoY 계산 헬퍼 함수
  // 2026년일 때: 현재년도 합계 - 전년도 합계
  // 2025년일 때: 현재년도 합계 - 2024년 값
  const calculateYoY = (currentYearTotal: number | null, previousValue: number | null): number | null => {
    if (currentYearTotal === null || previousValue === null) return null;
    return currentYearTotal - previousValue;
  };

  // 전년도 값 가져오기 헬퍼 (2026년일 때 전년도 합계, 2025년일 때 2024년 값)
  const getPreviousValue = (account: string, currentTotal: number): number | null => {
    if (year === 2026 && previousYearTotals) {
      return previousYearTotals.get(account) ?? null;
    } else {
      // 2025년일 때는 2024년 값 사용
      return get2024Value(account);
    }
  };

  // 전년도 합계 가져오기 헬퍼 (2026년일 때 전년도 합계, 2025년일 때 2024년 합계)
  const getPreviousTotal = (accounts: string[], currentTotal: number): number | null => {
    if (year === 2026 && previousYearTotals) {
      // 전년도 합계는 이미 계산되어 있으므로 여러 계정의 합계를 계산
      let sum = 0;
      let hasValue = false;
      for (const acc of accounts) {
        const val = previousYearTotals.get(acc);
        if (val !== undefined) {
          sum += val;
          hasValue = true;
        }
      }
      return hasValue ? sum : null;
    } else {
      // 2025년일 때는 2024년 합계 사용
      return sum2024Values(accounts);
    }
  };

  const rows: TableRow[] = [
    {
      account: '기초현금',
      level: 0,
      isGroup: false,
      isCalculated: true,
      isBold: true,
      isHighlight: 'yellow',
      values: [...기초현금, year === 2025 ? 기말현금2024 : (previousYearTotals?.get('기말현금') ?? 기말현금2024), calculateYoY(기초현금[0], year === 2025 ? 기초현금2024 : (previousYearTotals?.get('기초현금') ?? 기초현금2024))],
      format: 'number',
      year2024Value: year === 2025 ? 기초현금2024 : (previousYearTotals?.get('기초현금') ?? 기초현금2024),
    },
    {
      account: '1. 영업활동',
      level: 0,
      isGroup: true,
      isCalculated: true,
      isBold: true,
      isHighlight: 'sky',
      values: [...영업활동, sumArray(영업활동), calculateYoY(sumArray(영업활동), getPreviousTotal(['MLB', 'KIDS', 'Discovery', 'Duvetica', 'Supra', '대리상선금', '대리상보증금', '정부보조금', '기타수익', '본사', '위탁생산', '본사선급금', '운영비'], sumArray(영업활동)))],
      format: 'number',
      year2024Value: getPreviousTotal(['MLB', 'KIDS', 'Discovery', 'Duvetica', 'Supra', '대리상선금', '대리상보증금', '정부보조금', '기타수익', '본사', '위탁생산', '본사선급금', '운영비'], sumArray(영업활동)),
    },
    {
      account: '입금',
      level: 1,
      isGroup: true,
      isCalculated: true,
      isBold: true,
      isHighlight: 'gray',
      values: [...입금, sumArray(입금), calculateYoY(sumArray(입금), getPreviousTotal(['MLB', 'KIDS', 'Discovery', 'Duvetica', 'Supra', '대리상선금', '대리상보증금', '정부보조금', '기타수익'], sumArray(입금)))],
      format: 'number',
      year2024Value: getPreviousTotal(['MLB', 'KIDS', 'Discovery', 'Duvetica', 'Supra', '대리상선금', '대리상보증금', '정부보조금', '기타수익'], sumArray(입금)),
    },
    {
      account: '매출수금',
      level: 2,
      isGroup: true,
      isCalculated: true,
      isBold: true,
      values: [...매출수금, sumArray(매출수금), calculateYoY(sumArray(매출수금), getPreviousTotal(['MLB', 'KIDS', 'Discovery', 'Duvetica', 'Supra'], sumArray(매출수금)))],
      format: 'number',
      year2024Value: getPreviousTotal(['MLB', 'KIDS', 'Discovery', 'Duvetica', 'Supra'], sumArray(매출수금)),
    },
    { account: 'MLB', level: 3, isGroup: false, isCalculated: false, values: [...MLB, sumArray(MLB), calculateYoY(sumArray(MLB), getPreviousValue('MLB', sumArray(MLB)))], format: 'number', year2024Value: getPreviousValue('MLB', sumArray(MLB)) },
    { account: 'KIDS', level: 3, isGroup: false, isCalculated: false, values: [...KIDS, sumArray(KIDS), calculateYoY(sumArray(KIDS), getPreviousValue('KIDS', sumArray(KIDS)))], format: 'number', year2024Value: getPreviousValue('KIDS', sumArray(KIDS)) },
    { account: 'Discovery', level: 3, isGroup: false, isCalculated: false, values: [...Discovery, sumArray(Discovery), calculateYoY(sumArray(Discovery), getPreviousValue('Discovery', sumArray(Discovery)))], format: 'number', year2024Value: getPreviousValue('Discovery', sumArray(Discovery)) },
    { account: 'Duvetica', level: 3, isGroup: false, isCalculated: false, values: [...Duvetica, sumArray(Duvetica), calculateYoY(sumArray(Duvetica), getPreviousValue('Duvetica', sumArray(Duvetica)))], format: 'number', year2024Value: getPreviousValue('Duvetica', sumArray(Duvetica)) },
    { account: 'Supra', level: 3, isGroup: false, isCalculated: false, values: [...Supra, sumArray(Supra), calculateYoY(sumArray(Supra), getPreviousValue('Supra', sumArray(Supra)))], format: 'number', year2024Value: getPreviousValue('Supra', sumArray(Supra)) },
    {
      account: '기타수익',
      level: 2,
      isGroup: true,
      isCalculated: true,
      isBold: true,
      values: [...기타수익합계, sumArray(기타수익합계), calculateYoY(sumArray(기타수익합계), 기타수익2024)],
      format: 'number',
      year2024Value: getPreviousTotal(['대리상선금', '대리상보증금', '정부보조금', '기타수익'], sumArray(기타수익합계)),
    },
    { account: '대리상선금', level: 3, isGroup: false, isCalculated: false, values: [...대리상선금, sumArray(대리상선금), calculateYoY(sumArray(대리상선금), getPreviousValue('대리상선금', sumArray(대리상선금)))], format: 'number', year2024Value: getPreviousValue('대리상선금', sumArray(대리상선금)) },
    { account: '대리상보증금', level: 3, isGroup: false, isCalculated: false, values: [...대리상보증금, sumArray(대리상보증금), calculateYoY(sumArray(대리상보증금), getPreviousValue('대리상보증금', sumArray(대리상보증금)))], format: 'number', year2024Value: getPreviousValue('대리상보증금', sumArray(대리상보증금)) },
    { account: '정부보조금', level: 3, isGroup: false, isCalculated: false, values: [...정부보조금, sumArray(정부보조금), calculateYoY(sumArray(정부보조금), getPreviousValue('정부보조금', sumArray(정부보조금)))], format: 'number', year2024Value: getPreviousValue('정부보조금', sumArray(정부보조금)) },
    { account: '기타수익', level: 3, isGroup: false, isCalculated: false, values: [...기타수익, sumArray(기타수익), calculateYoY(sumArray(기타수익), getPreviousValue('기타수익', sumArray(기타수익)))], format: 'number', year2024Value: getPreviousValue('기타수익', sumArray(기타수익)) },
    {
      account: '출금',
      level: 1,
      isGroup: true,
      isCalculated: true,
      isBold: true,
      isHighlight: 'gray',
      values: [...출금, sumArray(출금), calculateYoY(sumArray(출금), 출금2024)],
      format: 'number',
      year2024Value: getPreviousTotal(['본사', '위탁생산', '본사선급금', '운영비'], sumArray(출금)),
    },
    {
      account: '상품대',
      level: 2,
      isGroup: true,
      isCalculated: true,
      isBold: true,
      values: [...상품대, sumArray(상품대), calculateYoY(sumArray(상품대), getPreviousTotal(['본사', '위탁생산'], sumArray(상품대)))],
      format: 'number',
      year2024Value: getPreviousTotal(['본사', '위탁생산'], sumArray(상품대)),
    },
    { account: '본사', level: 3, isGroup: false, isCalculated: false, values: [...본사, sumArray(본사), calculateYoY(sumArray(본사), getPreviousValue('본사', sumArray(본사)))], format: 'number', year2024Value: getPreviousValue('본사', sumArray(본사)) },
    { account: '위탁생산', level: 3, isGroup: false, isCalculated: false, values: [...위탁생산, sumArray(위탁생산), calculateYoY(sumArray(위탁생산), getPreviousValue('위탁생산', sumArray(위탁생산)))], format: 'number', year2024Value: getPreviousValue('위탁생산', sumArray(위탁생산)) },
    { account: '본사선급금', level: 2, isGroup: false, isCalculated: false, values: [...본사선급금, sumArray(본사선급금), calculateYoY(sumArray(본사선급금), getPreviousValue('본사선급금', sumArray(본사선급금)))], format: 'number', year2024Value: getPreviousValue('본사선급금', sumArray(본사선급금)) },
    { account: '운영비', level: 2, isGroup: false, isCalculated: false, values: [...운영비, sumArray(운영비), calculateYoY(sumArray(운영비), getPreviousValue('운영비', sumArray(운영비)))], format: 'number', year2024Value: getPreviousValue('운영비', sumArray(운영비)) },
    {
      account: '2. 재무활동',
      level: 0,
      isGroup: true,
      isCalculated: true,
      isBold: true,
      isHighlight: 'sky',
      values: [...재무활동, sumArray(재무활동), calculateYoY(sumArray(재무활동), getPreviousTotal(['차입금입금', '차입금상환'], sumArray(재무활동)))],
      format: 'number',
      year2024Value: getPreviousTotal(['차입금입금', '차입금상환'], sumArray(재무활동)),
    },
    { account: '차입금입금', level: 1, isGroup: false, isCalculated: false, values: [...차입금입금, sumArray(차입금입금), calculateYoY(sumArray(차입금입금), getPreviousValue('차입금입금', sumArray(차입금입금)))], format: 'number', year2024Value: getPreviousValue('차입금입금', sumArray(차입금입금)) },
    { account: '차입금상환', level: 1, isGroup: false, isCalculated: false, values: [...차입금상환, sumArray(차입금상환), calculateYoY(sumArray(차입금상환), getPreviousValue('차입금상환', sumArray(차입금상환)))], format: 'number', year2024Value: getPreviousValue('차입금상환', sumArray(차입금상환)) },
    {
      account: '3. 투자활동',
      level: 0,
      isGroup: true,
      isCalculated: true,
      isBold: true,
      isHighlight: 'sky',
      values: [...투자활동, sumArray(투자활동), calculateYoY(sumArray(투자활동), getPreviousTotal(['자산성지출'], sumArray(투자활동)))],
      format: 'number',
      year2024Value: getPreviousTotal(['자산성지출'], sumArray(투자활동)),
    },
    { account: '자산성지출', level: 1, isGroup: false, isCalculated: false, values: [...자산성지출, sumArray(자산성지출), calculateYoY(sumArray(자산성지출), getPreviousValue('자산성지출', sumArray(자산성지출)))], format: 'number', year2024Value: getPreviousValue('자산성지출', sumArray(자산성지출)) },
    {
      account: '기말현금',
      level: 0,
      isGroup: false,
      isCalculated: true,
      isBold: true,
      isHighlight: 'yellow',
      values: [...기말현금, 기말현금[11], calculateYoY(기말현금[11], year === 2026 && previousYearTotals ? (previousYearTotals.get('기말현금') ?? 기말현금2024) : 기말현금2024)],
      format: 'number',
      year2024Value: year === 2026 && previousYearTotals ? (previousYearTotals.get('기말현금') ?? 기말현금2024) : 기말현금2024,
    },
  ];
  
  return rows;
}

