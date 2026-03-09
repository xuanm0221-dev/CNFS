import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';

export const runtime = 'nodejs';

type CsvRow = Record<string, string>;

function toNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const parsed = Number(String(raw).trim().replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

export async function GET() {
  try {
    const filePath = path.join(process.cwd(), '보조파일(simu)', 'CF_plan_year', 'cash,debt_2026_plan.csv');

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'cash,debt_2026_plan.csv 파일 없음' }, { status: 404 });
    }

    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = Papa.parse<CsvRow>(raw, { header: true, skipEmptyLines: true });

    let cash: number | null = null;
    let borrowing: number | null = null;

    for (const row of parsed.data) {
      const label = Object.values(row)[0]?.trim() ?? '';
      const value = toNumber(Object.values(row)[1]);
      if (label === '현금잔액') cash = value;
      if (label === '차입금잔액') borrowing = value;
    }

    return NextResponse.json({ cash, borrowing }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `현금/차입금 계획 조회 오류: ${msg}` }, { status: 500 });
  }
}
