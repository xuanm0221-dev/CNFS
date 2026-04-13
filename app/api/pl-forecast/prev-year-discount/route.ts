import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SalesBrand = 'MLB' | 'MLB KIDS' | 'DISCOVERY';
type CsvRow = Record<string, string>;

interface DiscountRow {
  dealer: (number | null)[];
  direct: (number | null)[];
}

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

export async function GET() {
  try {
    const filePath = path.join(process.cwd(), '보조파일(simu)', '전년할인율.csv');
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ brands: {} }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = Papa.parse<CsvRow>(content, { header: true, skipEmptyLines: true });

    const brands: Record<SalesBrand, DiscountRow> = {
      MLB: { dealer: empty12(), direct: empty12() },
      'MLB KIDS': { dealer: empty12(), direct: empty12() },
      DISCOVERY: { dealer: empty12(), direct: empty12() },
    };

    const MONTH_KEYS = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];
    const headerKeys = Object.keys(parsed.data[0] ?? {});
    const brandKey = headerKeys[0] || '브랜드';
    const channelKey = headerKeys[1] || '';

    for (const row of parsed.data) {
      const brand = (row[brandKey] ?? '').trim() as SalesBrand;
      const channel = (row[channelKey] ?? '').trim();
      if (!brand || !(['MLB', 'MLB KIDS', 'DISCOVERY'] as string[]).includes(brand)) continue;

      const target = channel === '대리상' ? 'dealer' : channel === '직영' ? 'direct' : null;
      if (!target) continue;

      for (let i = 0; i < 12; i++) {
        brands[brand][target][i] = toNullableNumber(row[MONTH_KEYS[i]]);
      }
    }

    return NextResponse.json({ brands }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `전년할인율 CSV 조회 오류: ${message}` }, { status: 500 });
  }
}
