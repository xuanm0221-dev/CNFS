// PL(sim)용 직접비율 — 파일/PL_brand/{brand}/{year}.csv 단일 소스
// (이전: 보조파일(simu)/pl_brand_forecast_직접비율/{BRAND}.csv)
// 변동비 7개: PL_brand_cost[i] / PL_brand_실판매출[i] 비율로 변환 (PL(sim)에서 ratio × salesSeries 적용)
// 고정비 3개: PL_brand 절대 금액 그대로 (PL(sim)에서 FIXED_COST_ACCOUNTS 분기로 ratio 자리에 절대값 사용)
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';
import { BASE_MONTH, BASE_YEAR } from '@/lib/base-month';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SalesBrand = 'MLB' | 'MLB KIDS' | 'DISCOVERY';
type CsvRow = Record<string, string>;

interface DirectExpenseRatioResponse {
  brands: Record<SalesBrand, Record<string, (number | null)[]>>;
}

const BRANDS: SalesBrand[] = ['MLB', 'MLB KIDS', 'DISCOVERY'];
const BRAND_TO_DIR: Record<SalesBrand, string> = {
  MLB: 'mlb',
  'MLB KIDS': 'kids',
  DISCOVERY: 'discovery',
};
const MONTH_KEYS = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];

const VARIABLE_COST_ACCOUNTS = new Set<string>([
  '급여(매장)',
  '복리후생비(매장)',
  '플랫폼수수료',
  'TP수수료',
  '직접광고비',
  '물류비',
  '매장임차료',
]);

const FIXED_COST_ACCOUNTS = new Set<string>([
  '기타(직접비)',
  '대리상지원금',
  '감가상각비',
]);

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
    const planStart = year === BASE_YEAR ? BASE_MONTH : 0; // 0-based exclusive

    const result: DirectExpenseRatioResponse = {
      brands: { MLB: {}, 'MLB KIDS': {}, DISCOVERY: {} },
    };

    for (const brand of BRANDS) {
      const csvPath = path.join(process.cwd(), '파일', 'PL_brand', BRAND_TO_DIR[brand], `${year}.csv`);
      if (!fs.existsSync(csvPath)) continue;
      const content = fs.readFileSync(csvPath, 'utf-8').replace(/^﻿/, '');
      const parsed = Papa.parse<CsvRow>(content, { header: true, skipEmptyLines: true });

      // 실판매출 행 먼저 찾기 (변동비 비율 분모)
      const salesRow = parsed.data.find((row) => (row['계정과목'] ?? '').trim() === '실판매출');
      const salesByMonth = empty12();
      if (salesRow) {
        for (let i = 0; i < 12; i += 1) {
          salesByMonth[i] = toNullableNumber(salesRow[MONTH_KEYS[i]]);
        }
      }

      for (const row of parsed.data) {
        const account = (row['계정과목'] ?? '').trim();
        if (!VARIABLE_COST_ACCOUNTS.has(account) && !FIXED_COST_ACCOUNTS.has(account)) continue;

        const monthly = empty12();
        for (let i = 0; i < 12; i += 1) {
          if (i < planStart) continue; // 실적월은 ratio 산출 대상 외
          const cost = toNullableNumber(row[MONTH_KEYS[i]]);
          if (cost === null) continue;

          if (FIXED_COST_ACCOUNTS.has(account)) {
            // 고정비: 절대 금액 그대로
            monthly[i] = cost;
          } else {
            // 변동비: cost / 실판매출 비율
            const sales = salesByMonth[i];
            if (sales === null || sales === 0) continue;
            monthly[i] = cost / sales;
          }
        }
        result.brands[brand][account] = monthly;
      }
    }

    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `직접비율 조회 오류: ${message}` }, { status: 500 });
  }
}
