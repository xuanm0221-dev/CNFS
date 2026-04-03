import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';

export const runtime = 'nodejs';

type CsvRow = Record<string, string>;

const ACCOUNT_KEY_MAP: Record<string, string> = {
  '직영AR': 'wc_ar_direct',
  '대리상AR': 'wc_ar_dealer',
  'MLB': 'wc_inventory_mlb',
  'KIDS': 'wc_inventory_kids',
  'DISCOVERY': 'wc_inventory_discovery',
  '본사 AP': 'wc_ap_hq',
  '제품 AP': 'wc_ap_goods',
};

function toNumber(raw: string | undefined): number {
  if (!raw) return 0;
  const parsed = Number(String(raw).trim().replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function sumKeys(data: Record<string, number>, keys: string[]): number {
  return keys.reduce((acc, k) => acc + (data[k] ?? 0), 0);
}

/** BS와 동일: YYYY년연간계획(N-1) 우선, 레거시 YYYY년합계(계획) · 단일 값 열 폴백 */
function resolvePlanValueColumnKey(fields: string[] | undefined): string | undefined {
  if (!fields?.length) return undefined;
  for (const f of fields) {
    const t = f.trim();
    if (t === '계정과목') continue;
    if (/^\d+년연간계획\(N-1\)$/.test(t)) return f;
  }
  for (const f of fields) {
    const t = f.trim();
    if (t === '계정과목') continue;
    if (/^\d+년합계\(계획\)$/.test(t)) return f;
  }
  const rest = fields.filter((f) => f.trim() !== '계정과목');
  return rest.length >= 1 ? rest[0] : undefined;
}

export async function GET() {
  try {
    const filePath = path.join(process.cwd(), '보조파일(simu)', 'CF_plan_year', 'workingcapital_2026_plan.csv');

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'workingcapital_2026_plan.csv 파일 없음' }, { status: 404 });
    }

    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = Papa.parse<CsvRow>(raw, { header: true, skipEmptyLines: true });

    const valueColKey = resolvePlanValueColumnKey(parsed.meta.fields);
    if (!valueColKey) {
      return NextResponse.json(
        { error: 'workingcapital_2026_plan.csv: 계획 값 열을 찾을 수 없습니다.' },
        { status: 400 },
      );
    }

    const data: Record<string, number> = {};

    for (const row of parsed.data) {
      const account = (row['계정과목'] ?? '').trim();
      const internalKey = ACCOUNT_KEY_MAP[account];
      if (internalKey) {
        data[internalKey] = toNumber(row[valueColKey]);
      }
    }

    // 부모 행 합산
    data['wc_ar'] = sumKeys(data, ['wc_ar_direct', 'wc_ar_dealer']);
    data['wc_inventory'] = sumKeys(data, ['wc_inventory_mlb', 'wc_inventory_kids', 'wc_inventory_discovery']);
    data['wc_ap'] = sumKeys(data, ['wc_ap_hq', 'wc_ap_goods']);
    data['wc_total'] = sumKeys(data, ['wc_ar', 'wc_inventory', 'wc_ap']);

    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `운전자본 계획 조회 오류: ${msg}` }, { status: 500 });
  }
}
