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

/**
 * 파일/BS/2026.csv 의 "자금보고시점" 컬럼 = 자금월보 시점 임시 AR/AP (실적 확정 전).
 * 값이 있으면 Rolling AR/AP 를 임시로 override, 비어있으면 override 없음(→ snapshot 사용).
 * AP(본사 AP·제품 AP)는 CSV엔 양수로 적혀 있으나 내부적으론 음수(-)로 저장하므로 부호 반전.
 * 반환: internalKey → 값 (override 있는 계정만). 하나도 없으면 null.
 */
function readCashReportPointOverride(): Partial<Record<string, number>> | null {
  const bsPath = path.join(process.cwd(), '파일', 'BS', '2026.csv');
  if (!fs.existsSync(bsPath)) return null;
  try {
    const raw = fs.readFileSync(bsPath, 'utf-8').replace(/^﻿/, '');
    const parsed = Papa.parse<CsvRow>(raw, { header: true, skipEmptyLines: true });
    const cols = parsed.meta.fields ?? [];
    const acctCol = cols.find((c) => c.replace(/^﻿/, '').trim() === '계정과목');
    const reportCol = cols.find((c) => c.trim() === '자금보고시점');
    if (!acctCol || !reportCol) return null;

    const out: Partial<Record<string, number>> = {};
    for (const row of parsed.data) {
      const account = (row[acctCol] ?? '').trim();
      const internalKey = ACCOUNT_KEY_MAP[account];
      if (!internalKey) continue;
      const cell = (row[reportCol] ?? '').trim();
      if (cell === '') continue; // 빈칸 → 임시값 없음 (snapshot 사용)
      const num = Number(cell.replace(/,/g, ''));
      if (!Number.isFinite(num)) continue;
      // AP는 음수로 저장 (CSV 양수 → -abs)
      out[internalKey] = internalKey.startsWith('wc_ap') ? -Math.abs(num) : num;
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    // ── base: 파일/연말기준운전자본_snapshot.json(1순위) → 파일/연말기준운전자본.csv(2순위) ──
    let arDirect = 0;
    let arDealer = 0;
    let apHq = 0;
    let apGoods = 0;
    let source = '';
    let savedAt = '';
    let baseFound = false;

    const snapshotPath = path.join(process.cwd(), '파일', '연말기준운전자본_snapshot.json');
    if (fs.existsSync(snapshotPath)) {
      try {
        const snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8')) as {
          wc_ar_direct?: number;
          wc_ar_dealer?: number;
          wc_ap_hq?: number;
          wc_ap_goods?: number;
          savedAt?: string;
        };
        arDirect = Number(snap.wc_ar_direct ?? 0);
        arDealer = Number(snap.wc_ar_dealer ?? 0);
        apHq = Number(snap.wc_ap_hq ?? 0);
        apGoods = Number(snap.wc_ap_goods ?? 0);
        source = 'snapshot';
        savedAt = snap.savedAt ?? '';
        baseFound = true;
      } catch {
        // snapshot 깨졌으면 CSV fallback
      }
    }

    if (!baseFound) {
      const filePath = path.join(process.cwd(), '파일', '연말기준운전자본.csv');
      if (fs.existsSync(filePath)) {
        const parsed = Papa.parse<CsvRow>(fs.readFileSync(filePath, 'utf-8'), { header: true, skipEmptyLines: true });
        for (const row of parsed.data) {
          const accountRaw = Object.keys(row).find((k) => k.trim() === '계정과목');
          const account = accountRaw ? (row[accountRaw] ?? '').trim() : '';
          const internalKey = ACCOUNT_KEY_MAP[account];
          if (!internalKey) continue;
          const valueCol = Object.keys(row).find((k) => k.trim() !== '계정과목');
          const v = toNumber(valueCol ? row[valueCol] : undefined);
          if (internalKey === 'wc_ar_direct') arDirect = v;
          else if (internalKey === 'wc_ar_dealer') arDealer = v;
          else if (internalKey === 'wc_ap_hq') apHq = v;
          else if (internalKey === 'wc_ap_goods') apGoods = v;
        }
        source = 'csv';
        baseFound = true;
      }
    }

    // ── 자금보고시점 임시 override (있으면 우선) ──
    const override = readCashReportPointOverride();
    const overridden: string[] = [];
    if (override) {
      if (override.wc_ar_direct != null) { arDirect = override.wc_ar_direct; overridden.push('직영AR'); }
      if (override.wc_ar_dealer != null) { arDealer = override.wc_ar_dealer; overridden.push('대리상AR'); }
      if (override.wc_ap_hq != null) { apHq = override.wc_ap_hq; overridden.push('본사AP'); }
      if (override.wc_ap_goods != null) { apGoods = override.wc_ap_goods; overridden.push('제품AP'); }
    }

    if (!baseFound && overridden.length === 0) {
      return NextResponse.json(
        { error: '운전자본 데이터 없음 (snapshot·연말기준운전자본.csv·BS 자금보고시점 모두 없음)' },
        { status: 404 },
      );
    }

    if (overridden.length > 0) {
      source = source ? `${source}+자금보고시점(임시)` : '자금보고시점(임시)';
    }

    const data: Record<string, number | string | string[]> = {
      wc_ar_direct: arDirect,
      wc_ar_dealer: arDealer,
      wc_ap_hq: apHq,
      wc_ap_goods: apGoods,
      wc_ar: arDirect + arDealer,
      wc_ap: apHq + apGoods,
      source,
      savedAt,
      cashReportPointOverride: overridden, // 자금보고시점으로 임시 override된 계정
    };
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `운전자본 Forecast 조회 오류: ${msg}` }, { status: 500 });
  }
}
