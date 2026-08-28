// PL(sim)용 평가감 — 파일/PL_brand/{brand}/{year}.csv 단일 소스
// 평가감 = 평가감(설정) + 평가감(환입). set/rev 를 그대로 내려주고 합계도 함께 제공한다.
// (이전: 보조파일(simu)/3개브랜드평가감.csv, 천위안 단위)
// PL_brand는 1위안 단위 → PL(sim) UI/로직이 천위안 기반이므로 /1000 변환 후 반환
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';
import { BASE_MONTH, BASE_YEAR } from '@/lib/base-month';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SalesBrand = 'MLB' | 'MLB KIDS' | 'DISCOVERY';
type CsvRow = Record<string, string>;

const BRANDS: SalesBrand[] = ['MLB', 'MLB KIDS', 'DISCOVERY'];
const BRAND_TO_DIR: Record<SalesBrand, string> = {
  MLB: 'mlb',
  'MLB KIDS': 'kids',
  DISCOVERY: 'discovery',
};
const MONTH_KEYS = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];

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

    // 계획월 = year === BASE_YEAR면 BASE_MONTH+1~12만 반환 (실적월 평가감은 PL_brand 그대로 사용)
    const planStart = year === BASE_YEAR ? BASE_MONTH : 0;

    const brands: Record<SalesBrand, (number | null)[]> = {
      MLB: empty12(),
      'MLB KIDS': empty12(),
      DISCOVERY: empty12(),
    };
    const brandsSet: Record<SalesBrand, (number | null)[]> = {
      MLB: empty12(), 'MLB KIDS': empty12(), DISCOVERY: empty12(),
    };
    const brandsRev: Record<SalesBrand, (number | null)[]> = {
      MLB: empty12(), 'MLB KIDS': empty12(), DISCOVERY: empty12(),
    };

    for (const brand of BRANDS) {
      const csvPath = path.join(process.cwd(), '파일', 'PL_brand', BRAND_TO_DIR[brand], `${year}.csv`);
      if (!fs.existsSync(csvPath)) continue;
      const content = fs.readFileSync(csvPath, 'utf-8').replace(/^﻿/, '');
      const parsed = Papa.parse<CsvRow>(content, { header: true, skipEmptyLines: true });

      const findRow = (name: string) =>
        parsed.data.find((row) => (row['계정과목'] ?? '').trim() === name);
      const setRow = findRow('평가감(설정)');
      const revRow = findRow('평가감(환입)');
      if (!setRow && !revRow) continue;

      for (let i = 0; i < 12; i += 1) {
        if (i < planStart) continue;
        // PL_brand는 위안 → 천위안으로 변환 (PL(sim) UI/머지 로직이 천위안 기반)
        const sv = setRow ? toNullableNumber(setRow[MONTH_KEYS[i]]) : null;
        const rv = revRow ? toNullableNumber(revRow[MONTH_KEYS[i]]) : null;
        if (sv !== null) brandsSet[brand][i] = sv / 1000;
        if (rv !== null) brandsRev[brand][i] = rv / 1000;
        if (sv !== null || rv !== null) brands[brand][i] = ((sv ?? 0) + (rv ?? 0)) / 1000;
      }
    }

    return NextResponse.json(
      { brands, brandsSet, brandsRev },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `평가감 조회 오류: ${message}` }, { status: 500 });
  }
}
