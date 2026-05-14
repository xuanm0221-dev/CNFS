// 손익계산서 — 누적원가율 표 (MLB, MLB KIDS)
// 데이터 소스: 파일/누적원가율.csv
// 컬럼: 25년1월~26년4월 + 전체, 행: CN원가율, IMP원가율, CN비중, 가중평균
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Brand = 'MLB' | 'MLB KIDS';
type CsvRow = Record<string, string>;

export interface CumulativeCostRateBrandData {
  months: string[]; // 25년1월, ..., 26년4월, 전체
  rows: {
    CN원가율: (number | null)[];
    IMP원가율: (number | null)[];
    CN비중: (number | null)[];
    가중평균: (number | null)[];
  };
}

export interface CumulativeCostRateResponse {
  brands: Record<Brand, CumulativeCostRateBrandData>;
}

const BRANDS: Brand[] = ['MLB', 'MLB KIDS'];
const RATE_KEYS = ['CN원가율', 'IMP원가율', 'CN비중', '가중평균'] as const;

function toNullableNumber(value: string | undefined): number | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed || trimmed === '-') return null;
  const parsed = Number(trimmed.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function emptyBrand(): CumulativeCostRateBrandData {
  return {
    months: [],
    rows: { CN원가율: [], IMP원가율: [], CN비중: [], 가중평균: [] },
  };
}

export async function GET() {
  try {
    const csvPath = path.join(process.cwd(), '파일', '누적원가율.csv');
    if (!fs.existsSync(csvPath)) {
      return NextResponse.json({ error: '누적원가율.csv 파일을 찾을 수 없습니다.' }, { status: 404 });
    }
    const content = fs.readFileSync(csvPath, 'utf-8').replace(/^﻿/, '');
    const parsed = Papa.parse<CsvRow>(content, { header: true, skipEmptyLines: true });

    const result: CumulativeCostRateResponse = {
      brands: { MLB: emptyBrand(), 'MLB KIDS': emptyBrand() },
    };

    for (const row of parsed.data) {
      const brand = (row['브랜드'] ?? '').trim() as Brand;
      const month = (row['월'] ?? '').trim();
      if (!BRANDS.includes(brand) || !month) continue;

      const bd = result.brands[brand];
      bd.months.push(month);
      for (const key of RATE_KEYS) {
        bd.rows[key].push(toNullableNumber(row[key]));
      }
    }

    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `누적원가율 조회 오류: ${message}` }, { status: 500 });
  }
}
