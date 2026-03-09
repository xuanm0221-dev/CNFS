import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';

export const runtime = 'nodejs';

type CsvRow = Record<string, string>;

const ACCOUNT_KEY_MAP: Record<string, string> = {
  '직영AR': 'wc_ar_direct',
  '대리상AR': 'wc_ar_dealer',
  '본사 AP': 'wc_ap_hq',
  '제품 AP': 'wc_ap_goods',
};

function toNumber(raw: string | undefined): number {
  if (!raw) return 0;
  const parsed = Number(String(raw).trim().replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function GET() {
  try {
    const filePath = path.join(process.cwd(), '보조파일(simu)', 'CF_forecast_year', 'workingcapital_2026_forecast.csv');

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'workingcapital_2026_forecast.csv 파일 없음' }, { status: 404 });
    }

    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = Papa.parse<CsvRow>(raw, { header: true, skipEmptyLines: true });

    const data: Record<string, number> = {};

    for (const row of parsed.data) {
      const accountRaw = Object.keys(row).find((k) => k.trim() === '계정과목');
      const account = accountRaw ? (row[accountRaw] ?? '').trim() : '';
      const internalKey = ACCOUNT_KEY_MAP[account];
      if (internalKey) {
        const valueCol = Object.keys(row).find((k) => k.trim() !== '계정과목');
        data[internalKey] = toNumber(valueCol ? row[valueCol] : undefined);
      }
    }

    // 부모 행 합산
    const arDirect = data['wc_ar_direct'] ?? 0;
    const arDealer = data['wc_ar_dealer'] ?? 0;
    const apHq = data['wc_ap_hq'] ?? 0;
    const apGoods = data['wc_ap_goods'] ?? 0;
    data['wc_ar'] = arDirect + arDealer;
    data['wc_ap'] = apHq + apGoods;

    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `운전자본 Forecast 조회 오류: ${msg}` }, { status: 500 });
  }
}
