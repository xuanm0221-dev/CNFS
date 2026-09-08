// Tag대비원가율 — PL 원본(파일/PL_brand/{brand}/{year}.csv)에서 직접 계산
//   원가율 = 매출원가 × 1.13 ÷ Tag매출   (평가감 미포함)
// 손익계산서의 (Tag 대비 원가율) 계산행(lib/fs-mapping.ts)과 동일한 산식이라,
// PL 을 고치면 원가율이 자동으로 따라온다. (이전: 보조파일(simu)/Tag대비원가율.csv 수기 갱신)
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SalesBrand = 'MLB' | 'MLB KIDS' | 'DISCOVERY';

interface TagCostRatioResponse {
  brands: Record<SalesBrand, (number | null)[]>;
}

const BRANDS: SalesBrand[] = ['MLB', 'MLB KIDS', 'DISCOVERY'];
const BRAND_TO_DIR: Record<SalesBrand, string> = {
  MLB: 'mlb',
  'MLB KIDS': 'kids',
  DISCOVERY: 'discovery',
};

/** VAT 제외 환산 계수 — Tag매출은 부가세 포함, 매출원가는 제외 기준 */
const VAT_FACTOR = 1.13;

function empty12(): (number | null)[] {
  return new Array(12).fill(null);
}

function toNullableNumber(value: string | undefined): number | null {
  if (value == null) return null;
  const trimmed = String(value).trim().replace(/,/g, '');
  if (!trimmed || trimmed === '-') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** PL CSV 를 계정과목명 → 12개월 배열로 (1열=계정과목, 2~13열=1~12월) */
function readAccountSeries(filePath: string, accounts: string[]): Record<string, (number | null)[]> {
  const out: Record<string, (number | null)[]> = {};
  if (!fs.existsSync(filePath)) return out;

  const content = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '');
  const parsed = Papa.parse<string[]>(content, { header: false, skipEmptyLines: true });

  for (const row of parsed.data) {
    if (!Array.isArray(row) || row.length === 0) continue;
    const account = (row[0] ?? '').trim();
    if (!accounts.includes(account) || out[account]) continue; // 첫 등장만 사용
    const monthly = empty12();
    for (let i = 0; i < 12; i += 1) monthly[i] = toNullableNumber(row[i + 1]);
    out[account] = monthly;
  }
  return out;
}

export async function GET(req: NextRequest) {
  try {
    const yearRaw = req.nextUrl.searchParams.get('year') ?? '2026';
    const year = Number(yearRaw);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return NextResponse.json({ error: '유효한 year 파라미터가 필요합니다.' }, { status: 400 });
    }

    const result: TagCostRatioResponse = {
      brands: { MLB: empty12(), 'MLB KIDS': empty12(), DISCOVERY: empty12() },
    };

    for (const brand of BRANDS) {
      const filePath = path.join(process.cwd(), '파일', 'PL_brand', BRAND_TO_DIR[brand], `${year}.csv`);
      const series = readAccountSeries(filePath, ['Tag매출', '매출원가']);
      const tag = series['Tag매출'];
      const cogs = series['매출원가'];
      if (!tag || !cogs) continue; // 파일/행 없으면 null 유지 — 소비처가 건너뛴다

      const monthly = empty12();
      for (let i = 0; i < 12; i += 1) {
        const t = tag[i];
        const c = cogs[i];
        if (t === null || t === 0 || c === null) continue;
        monthly[i] = (c * VAT_FACTOR) / t;
      }
      result.brands[brand] = monthly;
    }

    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Tag대비원가율 계산 오류: ${message}` }, { status: 500 });
  }
}
