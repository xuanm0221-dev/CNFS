// IFRS 조정 상세 로더 (서버 전용) — 파일/재무조정/{year}_상세.csv
//
// 상세파일이 있는 연도만 신규 (IFRS) 행 블록을 쓴다. 2024년은 상세가 없어
// 기존 재무&관리차이(-) 방식이 그대로 유지된다.
import path from 'path';
import { readDetailAdjustCSV, type DetailAdjustData } from './csv';
import { buildIFRSAdjust, type IFRSAdjustSet } from './ifrs-adjust';

/** 상세파일을 지원하는 연도 (파일이 늘어나면 여기에 추가) */
export const DETAIL_ADJUST_YEARS = [2025, 2026];

function detailPath(year: number): string {
  return path.join(process.cwd(), '파일', '재무조정', `${year}_상세.csv`);
}

export async function loadDetailAdjust(year: number): Promise<DetailAdjustData | undefined> {
  if (!DETAIL_ADJUST_YEARS.includes(year)) return undefined;
  try {
    return await readDetailAdjustCSV(detailPath(year), year);
  } catch {
    return undefined;
  }
}

/**
 * 해당 연도의 IFRS 조정 세트. 상세파일이 없으면 undefined (→ 기존 로직 유지).
 * 항목 나열은 상세가 있는 전 연도의 합집합이라 25/26 어느 쪽에서 조정된 항목인지,
 * 전년비가 얼마인지 볼 수 있다.
 */
export async function loadIFRSAdjust(year: number, brand?: string | null): Promise<IFRSAdjustSet | undefined> {
  const current = await loadDetailAdjust(year);
  if (!current) return undefined;
  const others = await Promise.all(
    DETAIL_ADJUST_YEARS.filter(y => y !== year).map(y => loadDetailAdjust(y)),
  );
  return buildIFRSAdjust(current, others, brand ?? null);
}
