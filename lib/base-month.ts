// 대시보드 전역 기준월 (하드코딩). 이 한 곳만 바꾸면 Header·BS·PL(sim)·여신사용현황 모두 연동됨.
export const BASE_YEAR = 2026;
export const BASE_MONTH = 4;

// "26.04" 형식 (credit-recovery API 파라미터, CSV 파일명에 사용)
export const BASE_YEAR_MONTH = `${String(BASE_YEAR).slice(2)}.${String(BASE_MONTH).padStart(2, '0')}`;

// "2026년 4월" 형식 (UI 표시)
export const BASE_YEAR_MONTH_LABEL = `${BASE_YEAR}년 ${BASE_MONTH}월`;
