// 원본 CSV 데이터 (롱 포맷)
export interface FinancialData {
  year: number;
  month: number; // 1~12
  account: string;
  value: number;
}

// 테이블 행 데이터
export interface TableRow {
  account: string;
  level: number; // 인덴트 레벨 (0=최상위)
  isGroup: boolean; // 그룹(접기/펼치기 가능)인지
  isCalculated: boolean; // 계산된 값인지
  isHighlight?: 'sky' | 'yellow' | 'gray' | 'mint' | 'orange' | 'pink' | 'none'; // 배경색 강조
  isBold?: boolean; // 볼드 처리
  values: (number | null)[]; // 12개월 또는 13개(합계 포함)
  children?: TableRow[];
  format?: 'number' | 'percent'; // 표시 형식
  comparisons?: ComparisonData; // 비교 데이터 (PL 2025년 전용)
  year2024Value?: number | null; // CF용 2024년 값
  brandComparisons?: BrandComparisonData; // 브랜드별 비교 데이터 (브랜드별 손익 보기 전용)
}

// 비교 데이터 (PL 2025년 전용)
export interface ComparisonData {
  prevYearMonth: number | null; // 전년(기준월)
  currYearMonth: number | null; // 당년(기준월)
  monthYoY: number | null; // 월 YoY
  prevYearYTD: number | null; // 전년 YTD
  currYearYTD: number | null; // 당년 YTD
  ytdYoY: number | null; // YTD YoY
  prevYearAnnual: number | null; // 24년 연간
  currYearAnnual: number | null; // 25년 연간
  annualYoY: number | null; // 연간 YoY
  prevYearMonthly?: (number | null)[]; // 전년 12개월 값 (분기보기에서 사용)
  // BS 2026 계획 관련 필드
  currMonthPlan?: number | null; // 당월 계획값
  annualPlan?: number | null; // 연간 계획값
  monthYoYActual?: number | null; // 당월YoY = 당월실적 - 전년동월실적
  planVsActual?: number | null; // 계획비 = 기말예상 - 기말계획
  planMonth?: number | null; // 계획 기준월 (동적 헤더용)
}

// 브랜드별 비교 데이터 (브랜드별 손익 보기 전용)
export interface BrandComparisonData {
  month: {
    prevYear: { [brand: string]: number | null }; // 전년(12월) 브랜드별
    currYear: { [brand: string]: number | null }; // 당년(12월) 브랜드별
  };
  ytd: {
    prevYear: { [brand: string]: number | null }; // 전년YTD 브랜드별
    currYear: { [brand: string]: number | null }; // 당년YTD 브랜드별
  };
  annual: {
    prevYear: { [brand: string]: number | null }; // 24년연간 브랜드별
    currYear: { [brand: string]: number | null }; // 25년연간 브랜드별
  };
}

// 재무제표 타입
export type StatementType = 'PL' | 'BS' | 'CF';
export type TabType = 'SUMMARY' | 'PL' | 'BS' | 'CF' | 'CREDIT' | 'INVENTORY' | 'PL_CF';

// 월 데이터 맵
export type MonthDataMap = Map<string, number[]>; // account -> [month1, month2, ..., month12]

// 여신사용현황 타입
export interface CreditDealer {
  name: string;
  외상매출금: number;
  선수금: number;
  순여신: number;
}

export interface CreditData {
  total: {
    외상매출금: number;
    선수금: number;
    순여신: number;
  };
  dealers: CreditDealer[];
  top17: CreditDealer[];
  others: {
    count: number;
    외상매출금: number;
    선수금: number;
    순여신: number;
  };
  othersList: CreditDealer[];
  analysis: {
    top17Ratio: number; // 상위 17개 비율
    top1Ratio: number; // 최대 거래처 비율
    riskLevel: '높음' | '낮음';
  };
}

// 재무 분석 타입
export interface FinancialAnalysis {
  ratios: {
    부채비율: { current: number; previous: number };
    차입금비율: { current: number; previous: number };
    유동비율: { current: number };
    ROE: { current: number };
    rawData: {
      유동자산: number;
      유동부채: number;
      자본증가: number;
    };
  };
  wcRemarksAuto: { [key: string]: string }; // 자동 생성된 운전자본 비고
}

// 차입 한도 타입
export interface LoanLimitsData {
  [bank: string]: {
    current: number;
    total: number;
  };
}

// 경영요약 타입
export interface ExecutiveSummaryData {
  title: string;
  baseMonth: number; // 기준월
  sections: {
    수익성분석: {
      매출성장: string[];
      비용증가: string[];
    };
    재무현황: {
      자산규모: string[];
      부채증가: string[];
      재고자산: string[];
      자본안정: string[];
    };
    실적분석: {
      주요지표: string[];
      부채비율: string[];
    };
    심층분석: {
      수익성악화원인: string[];
      재고관리이슈: string[];
      여신리스크개선: string[];
      재무건전성: string[];
      긍정적요소: string[];
      재무구조개선: string[];
    };
    주요성과: string[];
    핵심분석: string[];
    핵심인사이트: string[];
    핵심이슈권고사항: string[];
    결론: string[];
  };
}

// 연간계획 분석 데이터 타입
export interface EditableAnalysis {
  year: number;
  keyInsights: string[];
  cfCategories: EditableCategoryAnalysis[];
  wcCategories: EditableCategoryAnalysis[];
  wcInsights: { [key: string]: string };
  riskFactors: string[];
  actionItems: string[];
  lastModified: string;
}

// 현금차입금잔액 데이터 타입
export interface BalanceData {
  현금잔액: {
    기초잔액: number;
    monthly: number[];
    기말잔액: number;
  };
  차입금잔액: {
    기초잔액: number;
    monthly: number[];
    기말잔액: number;
  };
}

// 현금흐름표 설명과 분석 콘텐츠 (KV 저장·편집용)
export interface CFExplanationContent {
  keyInsights: string[];
  cashFlow: string[];
  workingCapital: string[];
  managementPoints: string[];
}

// 여신회수계획 데이터 타입
export interface CreditRecoveryData {
  baseYearMonth: string;
  대리상선수금: number;
  대리상채권: number;
  recoveries: number[];
  headers: string[];
}

// 카테고리 분석 데이터 타입 (연간계획용)
export interface EditableCategoryAnalysis {
  account: string;
  monthlyValues?: (number | null)[];
  annualTotal: number;
  yoyAbsolute: number | null;
  yoyPercent: number | null;
  prevYearTotal?: number | null;
  year2023Total?: number | null;
  customText?: string;
}
