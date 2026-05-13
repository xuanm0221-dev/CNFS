import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';
import iconv from 'iconv-lite';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface TagRecoveryRateRow {
  category: string;
  season: string;
  monthly: (number | null)[];
}

export interface TagRecoveryRateResponse {
  rows: TagRecoveryRateRow[];
}

function toNullableNumber(raw: string | undefined): number | null {
  if (raw == null) return null;
  const trimmed = raw.replace(/,/g, '').trim();
  if (trimmed === '' || trimmed === '-') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function GET() {
  try {
    const filePath = path.join(process.cwd(), '파일', 'Tag대비회수율_26년.csv');
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ rows: [] }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const buffer = fs.readFileSync(filePath);
    let content = buffer.toString('utf-8');
    if (!content.includes('월')) {
      content = iconv.decode(buffer, 'cp949');
    }
    const parsed = Papa.parse<string[]>(content, { skipEmptyLines: true });
    const rows = parsed.data ?? [];
    if (!Array.isArray(rows) || rows.length < 2) {
      return NextResponse.json({ rows: [] }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const header = rows[0].map((v) => (v ?? '').trim());
    const monthColIdx: number[] = [];
    for (let m = 1; m <= 12; m += 1) {
      monthColIdx.push(header.findIndex((h) => h === `${m}월`));
    }

    const out: TagRecoveryRateRow[] = [];
    for (let r = 1; r < rows.length; r += 1) {
      const row = rows[r];
      if (!row || row.length < 2) continue;
      const category = (row[0] ?? '').trim();
      const season = (row[1] ?? '').trim();
      if (!category && !season) continue;
      const monthly: (number | null)[] = new Array(12).fill(null);
      for (let m = 0; m < 12; m += 1) {
        const colIdx = monthColIdx[m];
        if (colIdx < 0) continue;
        monthly[m] = toNullableNumber(row[colIdx]);
      }
      out.push({ category, season, monthly });
    }

    return NextResponse.json({ rows: out } satisfies TagRecoveryRateResponse, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Tag대비회수율 조회 오류: ${message}` }, { status: 500 });
  }
}
