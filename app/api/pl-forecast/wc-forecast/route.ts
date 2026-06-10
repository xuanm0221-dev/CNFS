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
    // 1순위: 파일/연말기준운전자본_snapshot.json (현금흐름표 탭 "운전자본 저장" 결과)
    // 2순위: 파일/연말기준운전자본.csv (legacy 수동 편집 fallback)
    const snapshotPath = path.join(process.cwd(), '파일', '연말기준운전자본_snapshot.json');
    if (fs.existsSync(snapshotPath)) {
      try {
        const raw = fs.readFileSync(snapshotPath, 'utf-8');
        const snap = JSON.parse(raw) as {
          wc_ar_direct?: number;
          wc_ar_dealer?: number;
          wc_ap_hq?: number;
          wc_ap_goods?: number;
          savedAt?: string;
        };
        const arDirect = Number(snap.wc_ar_direct ?? 0);
        const arDealer = Number(snap.wc_ar_dealer ?? 0);
        const apHq = Number(snap.wc_ap_hq ?? 0);
        const apGoods = Number(snap.wc_ap_goods ?? 0);
        const data: Record<string, number | string> = {
          wc_ar_direct: arDirect,
          wc_ar_dealer: arDealer,
          wc_ap_hq: apHq,
          wc_ap_goods: apGoods,
          wc_ar: arDirect + arDealer,
          wc_ap: apHq + apGoods,
          source: 'snapshot',
          savedAt: snap.savedAt ?? '',
        };
        return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
      } catch (e) {
        // snapshot 깨졌으면 CSV fallback
      }
    }

    const filePath = path.join(process.cwd(), '파일', '연말기준운전자본.csv');

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: '파일/연말기준운전자본.csv 없음' }, { status: 404 });
    }

    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = Papa.parse<CsvRow>(raw, { header: true, skipEmptyLines: true });

    const data: Record<string, number | string> = {};

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
    const arDirect = (data['wc_ar_direct'] as number) ?? 0;
    const arDealer = (data['wc_ar_dealer'] as number) ?? 0;
    const apHq = (data['wc_ap_hq'] as number) ?? 0;
    const apGoods = (data['wc_ap_goods'] as number) ?? 0;
    data['wc_ar'] = arDirect + arDealer;
    data['wc_ap'] = apHq + apGoods;
    data['source'] = 'csv';

    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `운전자본 Forecast 조회 오류: ${msg}` }, { status: 500 });
  }
}
