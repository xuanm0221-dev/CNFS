import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';
import iconv from 'iconv-lite';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PlanBrand = 'MLB' | 'MLB KIDS' | 'DISCOVERY' | 'DUVETICA' | 'SUPRA';
type PlanSeason = '당년S' | '당년F' | '1년차' | '차기시즌' | 'ACC';

export interface DealerShipmentPlanResponse {
  brands: Record<PlanBrand, Record<PlanSeason, (number | null)[]>>;
}

const BRANDS: PlanBrand[] = ['MLB', 'MLB KIDS', 'DISCOVERY', 'DUVETICA', 'SUPRA'];
const SEASONS: PlanSeason[] = ['당년S', '당년F', '1년차', '차기시즌', 'ACC'];

function empty12(): (number | null)[] {
  return new Array(12).fill(null);
}

function emptyByBrand(): Record<PlanSeason, (number | null)[]> {
  return {
    당년S: empty12(),
    당년F: empty12(),
    '1년차': empty12(),
    차기시즌: empty12(),
    ACC: empty12(),
  };
}

function toNullableNumber(raw: string | undefined): number | null {
  if (raw == null) return null;
  const trimmed = raw.replace(/,/g, '').trim();
  if (trimmed === '' || trimmed === '-') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeBrand(raw: string): PlanBrand | null {
  const v = raw.trim().toUpperCase();
  if (v === 'MLB') return 'MLB';
  if (v === 'MLB KIDS') return 'MLB KIDS';
  if (v === 'DISCOVERY' || v === 'DX') return 'DISCOVERY';
  if (v === 'DUVETICA') return 'DUVETICA';
  if (v === 'SUPRA') return 'SUPRA';
  return null;
}

function normalizeSeason(raw: string): PlanSeason | null {
  const v = raw.trim();
  if (v === '당년S') return '당년S';
  if (v === '당년F') return '당년F';
  if (v === '1년차') return '1년차';
  if (v === '차기시즌') return '차기시즌';
  if (v.toUpperCase() === 'ACC') return 'ACC';
  return null; // 과시즌 등은 무시
}

export async function GET() {
  try {
    const filePath = path.join(process.cwd(), '보조파일(simu)', '26년대리상출고계획.csv');
    const result: DealerShipmentPlanResponse = {
      brands: {
        MLB: emptyByBrand(),
        'MLB KIDS': emptyByBrand(),
        DISCOVERY: emptyByBrand(),
        DUVETICA: emptyByBrand(),
        SUPRA: emptyByBrand(),
      },
    };

    if (!fs.existsSync(filePath)) {
      return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
    }

    // 파일 인코딩 자동 감지: UTF-8로 읽어 헤더에 "브랜드" 가 보이면 UTF-8, 아니면 cp949(EUC-KR)
    const buffer = fs.readFileSync(filePath);
    let content = buffer.toString('utf-8');
    if (!content.includes('브랜드')) {
      content = iconv.decode(buffer, 'cp949');
    }
    const parsed = Papa.parse<string[]>(content, { skipEmptyLines: true });
    const rows = parsed.data ?? [];
    if (!Array.isArray(rows) || rows.length < 2) {
      return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
    }

    const header = rows[0].map((v) => (v ?? '').trim());
    const monthColIdx: number[] = [];
    for (let m = 1; m <= 12; m += 1) {
      monthColIdx.push(header.findIndex((h) => h === `${m}월`));
    }

    for (let r = 1; r < rows.length; r += 1) {
      const row = rows[r];
      if (!row || row.length < 2) continue;
      const brand = normalizeBrand(row[0] ?? '');
      const season = normalizeSeason(row[1] ?? '');
      if (!brand || !season) continue;
      for (let m = 0; m < 12; m += 1) {
        const colIdx = monthColIdx[m];
        if (colIdx < 0) continue;
        const value = toNullableNumber(row[colIdx]);
        if (value === null) continue;
        // CSV unit is CNY K → internal uses CNY (× 1000)
        result.brands[brand][season][m] = value * 1000;
      }
    }

    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `대리상 출고계획 조회 오류: ${message}` }, { status: 500 });
  }
}
