import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';

export const runtime = 'nodejs';

type CsvRow = Record<string, string>;

// CSV 행의 대분류|중분류|소분류 조합 → internal key 매핑
const KEY_MAP: Record<string, string> = {
  '영업활동|매출수금|MLB': 'operating_receipts_mlb',
  '영업활동|매출수금|MLB KIDS': 'operating_receipts_kids',
  '영업활동|매출수금|DISCOVERY': 'operating_receipts_discovery',
  '영업활동|매출수금|DUVETICA': 'operating_receipts_duvetica',
  '영업활동|매출수금|SUPRA': 'operating_receipts_supra',
  '영업활동|물품대|본사': 'operating_payments_hq',
  '영업활동|물품대|현지': 'operating_payments_local',
  '영업활동|본사선급금|': 'operating_advance',
  '영업활동|비용|광고비': 'operating_expenses_ad',
  '영업활동|비용|온라인 플랫폼비용': 'operating_expenses_platform',
  '영업활동|비용|오프라인 매장비용': 'operating_expenses_store',
  '영업활동|비용|수입관세': 'operating_expenses_duty',
  '영업활동|비용|인건비': 'operating_expenses_payroll',
  '영업활동|비용|보증금지급': 'operating_expenses_deposit',
  '영업활동|비용|기타': 'operating_expenses_other',
  '자산성지출|인테리어/VMD|': 'capex_interior',
  '자산성지출|비품취득|': 'capex_fixture',
  '기타수익||': 'other_income',
  '차입금||': 'borrowings',
};

function toNumber(raw: string | undefined): number {
  if (!raw) return 0;
  const parsed = Number(String(raw).trim().replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function sumKeys(data: Record<string, number>, keys: string[]): number {
  return keys.reduce((acc, k) => acc + (data[k] ?? 0), 0);
}

export async function GET() {
  try {
    const filePath = path.join(process.cwd(), '보조파일(simu)', 'CF_plan_year', 'CF_2026_plan.csv');

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'CF_2026_plan.csv 파일 없음' }, { status: 404 });
    }

    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = Papa.parse<CsvRow>(raw, { header: true, skipEmptyLines: true });

    const data: Record<string, number> = {};

    for (const row of parsed.data) {
      const l1 = (row['대분류'] ?? '').trim();
      const l2 = (row['중분류'] ?? '').trim();
      const l3 = (row['소분류'] ?? '').trim();
      const compositeKey = `${l1}|${l2}|${l3}`;
      const internalKey = KEY_MAP[compositeKey];
      if (internalKey) {
        const valueCol = Object.keys(row).find((k) => k.trim() === '합계');
        data[internalKey] = toNumber(valueCol ? row[valueCol] : undefined);
      }
    }

    // 부모 행 합산
    data['operating_receipts'] = sumKeys(data, [
      'operating_receipts_mlb',
      'operating_receipts_kids',
      'operating_receipts_discovery',
      'operating_receipts_duvetica',
      'operating_receipts_supra',
    ]);

    data['operating_payments'] = sumKeys(data, [
      'operating_payments_hq',
      'operating_payments_local',
    ]);

    data['operating_expenses'] = sumKeys(data, [
      'operating_expenses_ad',
      'operating_expenses_platform',
      'operating_expenses_store',
      'operating_expenses_duty',
      'operating_expenses_payroll',
      'operating_expenses_deposit',
      'operating_expenses_other',
    ]);

    data['operating'] = sumKeys(data, [
      'operating_receipts',
      'operating_payments',
      'operating_advance',
      'operating_expenses',
    ]);

    data['capex'] = sumKeys(data, ['capex_interior', 'capex_fixture']);

    data['net_cash'] = sumKeys(data, [
      'operating',
      'capex',
      'other_income',
      'borrowings',
    ]);

    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `CF 계획 조회 오류: ${msg}` }, { status: 500 });
  }
}
