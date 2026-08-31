// FI기준 손익표 — 파일/재무조정/FI기준손익.csv
// 구조: 계정 | 브랜드 | 연도 | 1분기 | 2분기 | 3분기 | 4분기
//   매출은 브랜드별 행, 매출원가/평가감/판관비는 "법인" 한 행 (재무식에서 브랜드 구분 불가).
//   계정이 빈 행(검증용 영업이익 합계)은 무시한다.
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';
import iconv from 'iconv-lite';
import { loadDetailAdjust } from '@/lib/ifrs-adjust-loader';
import { isHqReturnItem } from '@/lib/ifrs-adjust';

export const dynamic = 'force-dynamic';

const FI_SALES_BRANDS = ['MLB', 'MLB KIDS', 'DISCOVERY', 'DUVETICA', 'SUPRA'] as const;
const CORPORATE_ACCOUNTS = ['매출원가', '평가감', '판관비'] as const;

export interface FIYearData {
  /** 브랜드별 매출 (분기 4개, 값 없으면 null) */
  매출: Record<string, (number | null)[]>;
  매출원가: (number | null)[];
  평가감: (number | null)[];
  판관비: (number | null)[];
}

export interface FIPLResponse {
  years: number[];
  data: Record<string, FIYearData>;
  /** 연도별 분기 누적평균환율 (CNY→KRW). 예: 2025 2분기 = 1~6월 평균 */
  rates: Record<string, (number | null)[]>;
  /**
   * 연도별 분기 본사반품 매출 인식액 (DISCOVERY). 재무조정/{year}_상세.csv 기준.
   * FI기준 매출의 DISCOVERY 행에 포함되어 있어, 정상매출과 구분해 보여주는 데 쓴다.
   */
  hqReturnSales: Record<string, (number | null)[]>;
}

// 빈 셀은 null (미결산 분기), 숫자는 쉼표·공백·괄호음수 처리
function parseCell(raw: string | undefined): number | null {
  if (raw === undefined || raw === null) return null;
  let t = String(raw).replace(/,/g, '').replace(/\s/g, '').trim();
  if (!t || t === '-') return null;
  if (/^\(.*\)$/.test(t)) t = '-' + t.slice(1, -1);
  const v = parseFloat(t);
  return Number.isFinite(v) ? v : null;
}

const emptyQuarters = (): (number | null)[] => [null, null, null, null];

function emptyYear(): FIYearData {
  const 매출: Record<string, (number | null)[]> = {};
  for (const b of FI_SALES_BRANDS) 매출[b] = emptyQuarters();
  return { 매출, 매출원가: emptyQuarters(), 평가감: emptyQuarters(), 판관비: emptyQuarters() };
}

export async function GET() {
  try {
    const filePath = path.join(process.cwd(), '파일', '재무조정', 'FI기준손익.csv');
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      content = iconv.decode(fs.readFileSync(filePath), 'cp949');
    }

    const rows = Papa.parse<string[]>(content, { header: false, skipEmptyLines: false }).data ?? [];
    const data: Record<string, FIYearData> = {};
    const rates: Record<string, (number | null)[]> = {};

    // 우측 환율 블록: [..., '환율', 연도, 1분기, 2분기, 3분기, 4분기]
    // 컬럼 위치가 바뀌어도 '환율' 셀을 찾아 그 뒤를 읽는다.
    for (const row of rows) {
      for (let c = 0; c < row.length; c++) {
        if ((row[c] ?? '').trim() !== '환율') continue;
        const y = (row[c + 1] ?? '').trim();
        if (!/^[0-9]{4}$/.test(y)) continue;
        rates[y] = [0, 1, 2, 3].map(i => parseCell(row[c + 2 + i]));
      }
    }

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] ?? [];
      const account = (row[0] ?? '').trim();
      const brand = (row[1] ?? '').trim();
      const year = (row[2] ?? '').trim();
      if (!account || !year) continue; // 검증용 합계 행 등 스킵

      const quarters = [3, 4, 5, 6].map(c => parseCell(row[c]));
      if (!data[year]) data[year] = emptyYear();

      if (account === '매출') {
        if (!(FI_SALES_BRANDS as readonly string[]).includes(brand)) continue;
        data[year].매출[brand] = quarters;
      } else if ((CORPORATE_ACCOUNTS as readonly string[]).includes(account)) {
        data[year][account as (typeof CORPORATE_ACCOUNTS)[number]] = quarters;
      }
    }

    const years = Object.keys(data).map(Number).sort((a, b) => a - b);

    // 본사반품 매출 인식액 (DISCOVERY) — 상세파일의 매출 섹션에서 뽑아 분기 합산
    const hqReturnSales: Record<string, (number | null)[]> = {};
    for (const y of years) {
      const detail = await loadDetailAdjust(y);
      if (!detail) continue;
      const monthly = new Array(12).fill(0);
      let found = false;
      for (const it of detail.items) {
        if (it.section !== '매출' || !isHqReturnItem(it)) continue;
        found = true;
        for (let i = 0; i < 12; i++) monthly[i] += it.values[i];
      }
      if (!found) continue;
      hqReturnSales[String(y)] = [0, 1, 2, 3].map(q => {
        const sum = monthly.slice(q * 3, q * 3 + 3).reduce((t, v) => t + v, 0);
        return sum === 0 ? null : sum;
      });
    }

    const payload: FIPLResponse = { years, data, rates, hqReturnSales };
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('FI기준 손익 API 에러:', error);
    return NextResponse.json({ error: 'FI기준손익.csv를 읽을 수 없습니다.' }, { status: 500 });
  }
}
