// PL(sim)용 영업비 계획 — 파일/PL_brand/{brand}/{year}.csv 계획월 (BASE_MONTH+1~12) 컬럼 읽기
// (이전: 보조파일(simu)/pl_brand_forecast_영업비/{BRAND}.csv 천위안 단위)
// 통합 후: 1위안 단위, ×1000 변환 제거
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';
import { BASE_MONTH, BASE_YEAR } from '@/lib/base-month';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SalesBrand = 'MLB' | 'MLB KIDS' | 'DISCOVERY';
type CsvRow = Record<string, string>;

interface OpexForecastResponse {
  brands: Record<SalesBrand, Record<string, (number | null)[]>>;
}

const BRANDS: SalesBrand[] = ['MLB', 'MLB KIDS', 'DISCOVERY'];
const BRAND_TO_DIR: Record<SalesBrand, string> = {
  MLB: 'mlb',
  'MLB KIDS': 'kids',
  DISCOVERY: 'discovery',
};
const MONTH_KEYS = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];

// PL(sim)에서 사용하는 영업비 계정 (plForecastConfig.OPERATING_EXPENSE_ACCOUNTS와 일치)
const OPEX_ACCOUNTS: string[] = [
  '급여(사무실)',
  '복리후생비(사무실)',
  '광고비',
  '수주회',
  '지급수수료',
  '임차료',
  '감가상각비(영업비)',
  '세금과공과',
  '기타(영업비)',
];

function empty12(): (number | null)[] {
  return new Array(12).fill(null);
}

function toNullableNumber(value: string | undefined): number | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed || trimmed === '-') return null;
  const parsed = Number(trimmed.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

export async function GET(req: NextRequest) {
  try {
    const yearRaw = req.nextUrl.searchParams.get('year') ?? '2026';
    const year = Number(yearRaw);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return NextResponse.json({ error: '유효한 year 파라미터가 필요합니다.' }, { status: 400 });
    }

    // 계획월 = year === BASE_YEAR면 BASE_MONTH+1~12, 그 외는 전체 12
    const planStart = year === BASE_YEAR ? BASE_MONTH : 0; // 1-based exclusive

    const result: OpexForecastResponse = {
      brands: { MLB: {}, 'MLB KIDS': {}, DISCOVERY: {} },
    };

    for (const brand of BRANDS) {
      const csvPath = path.join(process.cwd(), '파일', 'PL_brand', BRAND_TO_DIR[brand], `${year}.csv`);
      if (!fs.existsSync(csvPath)) continue;
      const content = fs.readFileSync(csvPath, 'utf-8').replace(/^﻿/, '');
      const parsed = Papa.parse<CsvRow>(content, { header: true, skipEmptyLines: true });

      // 영업비 계정만 골라서 계획월 컬럼 채움
      const opexSet = new Set(OPEX_ACCOUNTS);
      for (const row of parsed.data) {
        const account = (row['계정과목'] ?? '').trim();
        if (!opexSet.has(account)) continue;
        const monthly = empty12();
        for (let i = 0; i < 12; i += 1) {
          if (i < planStart) continue; // 실적월은 미포함
          const v = toNullableNumber(row[MONTH_KEYS[i]]);
          if (v === null) continue;
          monthly[i] = v;
        }
        result.brands[brand][account] = monthly;
      }
    }

    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `영업비 계획 CSV 조회 오류: ${message}` }, { status: 500 });
  }
}
