// 배포 준비 상태 점검 (dev 전용)
// 전처리 산출물의 기준월 · 저장 파일의 savedAt · git 미커밋 여부를 한 번에 모아 반환.
// production 에서는 403 — 배포본에 노출되지 않는다.
import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Category = '전처리' | '저장' | '자동' | 'CSV';

interface StatusItem {
  category: Category;
  label: string;
  /** 저장소 루트 기준 상대 경로 (전처리는 스크립트 1회로 생성되는 파일 전체) */
  files: string[];
  /** 실행/저장 방법 안내 (전처리는 스크립트 명령) */
  how?: string;
  /** 파일에서 읽은 기준월 마커 (closedThrough / throughMonth / baseMonth) */
  marker?: string | null;
  markerValue?: string | number | null;
  /** 묶인 파일들의 기준월이 서로 다를 때 true */
  mixed?: boolean;
  /** 파일 안의 savedAt (ISO, UTC) */
  savedAt?: string | null;
  /** 파일 수정 시각 (ISO) */
  mtime?: string | null;
  exists: boolean;
  /** git 기준 미커밋 변경 여부 */
  dirty?: boolean;
}

const BRANDS = ['MLB', 'MLB_KIDS', 'DISCOVERY'];

/** 브랜드 3종으로 펼치는 전처리 산출물 */
const PREPROCESS_SETS: { label: string; prefix: string; how: string }[] = [
  { label: '입고완료(실적)', prefix: 'actual-arrival', how: 'python scripts/refresh_2026_actual_arrival.py --baseMonth {M}' },
  { label: '재고', prefix: 'monthly-stock', how: 'python scripts/refresh_2026_monthly_stock.py --baseMonth {M}' },
  { label: '리테일', prefix: 'retail-sales', how: 'python scripts/refresh_2026_retail_sales.py --baseMonth {M}' },
  { label: '출고매출', prefix: 'shipment-sales', how: 'python scripts/refresh_2026_shipment_sales.py --baseMonth {M}' },
  { label: '매입', prefix: 'purchase', how: 'python scripts/refresh_2026_purchase.py --baseMonth {M}' },
];

/** 저장 버튼으로 갱신되는 파일 */
const SAVE_FILES: { label: string; file: string; how: string }[] = [
  { label: '운전자본 스냅샷', file: '파일/연말기준운전자본_snapshot.json', how: '현금흐름표 탭 → 운전자본 저장' },
  { label: '시나리오 기말재고', file: '보조파일(simu)/scenario_inventory_closing.json', how: '재고자산(sim) → 기본 스냅샷 저장(dev)' },
  { label: '본사 ACC 예산', file: 'data/inventory/hq-acc-budget.json', how: '재고자산(sim) → ACC 예산 저장 (브랜드 3개)' },
  { label: '리테일 계획', file: 'data/retail-plan.json', how: 'PL(sim) → 리테일 계획 저장' },
  { label: '연간 출고계획', file: 'data/inventory/annual-shipment-plan.json', how: '재고자산(sim) → 연간 출고계획 저장' },
];

/** 버튼 없이 자동 저장되지만 커밋은 필요한 파일 */
const AUTO_FILES: { label: string; file: string; how: string }[] = [
  { label: '대리상 ACC Sell-in', file: 'data/inventory/dealer-acc-sellin.json', how: '재고자산(sim) 탭을 열면 자동 갱신' },
  { label: '대리상 의류 Sell-in', file: 'data/inventory/dealer-clothing-sellin.json', how: '재고자산(sim) 탭을 열면 자동 갱신' },
];

/** 손으로 고쳐서 커밋하는 원본 CSV */
const CSV_FILES: { label: string; file: string }[] = [
  { label: '대리상 출고계획', file: '보조파일(simu)/26년대리상출고계획.csv' },
  { label: '자금월보 CF', file: '파일/cashflow/2026.csv' },
  { label: '자금월보 BS', file: '파일/BS/2026.csv' },
  { label: '현금·차입금 잔액', file: '파일/현금차입금잔액/2026.csv' },
];

async function readMeta(root: string, rel: string) {
  const abs = path.join(root, rel);
  try {
    const st = await fs.stat(abs);
    const out: Partial<StatusItem> = { exists: true, mtime: st.mtime.toISOString() };
    if (rel.endsWith('.json')) {
      try {
        const raw = await fs.readFile(abs, 'utf-8');
        const json = JSON.parse(raw) as Record<string, unknown>;
        for (const k of ['closedThrough', 'throughMonth', 'baseMonth'] as const) {
          if (json[k] != null) {
            out.marker = k;
            out.markerValue = json[k] as string | number;
            break;
          }
        }
        if (typeof json.savedAt === 'string') out.savedAt = json.savedAt;
      } catch {
        // JSON 파싱 실패는 무시 — mtime 만 사용
      }
    }
    return out;
  } catch {
    return { exists: false } as Partial<StatusItem>;
  }
}

/** git 기준 미커밋(수정/미추적) 파일 경로 집합 */
async function dirtyPaths(root: string): Promise<Set<string> | null> {
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain', '-z'], {
      cwd: root,
      maxBuffer: 4 * 1024 * 1024,
    });
    const set = new Set<string>();
    for (const chunk of stdout.split('\0')) {
      if (chunk.length < 4) continue;
      set.add(chunk.slice(3).trim());
    }
    return set;
  } catch {
    return null; // git 없음/저장소 아님 → 커밋 컬럼 비활성
  }
}

export async function GET() {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: '개발 모드에서만 사용 가능합니다.' }, { status: 403 });
  }

  const root = process.cwd();
  const items: StatusItem[] = [];
  const dirty = await dirtyPaths(root);
  const markDirty = (rel: string) => (dirty ? dirty.has(rel.split(path.sep).join('/')) : undefined);

  // 전처리는 스크립트 1회 실행으로 브랜드 3개 파일이 함께 생성된다 → 한 항목으로 묶어서 보여준다.
  for (const set of PREPROCESS_SETS) {
    const files = BRANDS.map((b) => `public/data/inventory/2026/${set.prefix}-${b}.json`);
    const metas = await Promise.all(files.map((rel) => readMeta(root, rel)));
    const values = metas.map((m) => (m.markerValue == null ? null : String(m.markerValue)));
    const distinct = Array.from(new Set(values.filter((v): v is string => v != null)));
    const times = metas
      .map((m) => m.savedAt ?? m.mtime)
      .filter((t): t is string => !!t)
      .sort(); // 가장 오래된 것 기준 (부분 실행 감지)
    items.push({
      category: '전처리',
      label: `${set.label} (MLB · MLB KIDS · DISCOVERY)`,
      files,
      how: set.how,
      marker: metas.find((m) => m.marker)?.marker ?? null,
      markerValue: distinct.length === 1 ? distinct[0] : distinct.join(' / ') || null,
      mixed: distinct.length > 1,
      savedAt: metas.every((m) => m.savedAt) ? times[0] : null,
      mtime: times[0] ?? null,
      exists: metas.every((m) => m.exists),
      dirty: dirty ? files.some((f) => markDirty(f)) : undefined,
    } as StatusItem);
  }

  {
    const rel = 'public/data/cumulative-cost-rate.json';
    items.push({
      category: '전처리',
      label: '누적 원가율 (손익계산서)',
      files: [rel],
      how: 'python scripts/refresh_2026_cumulative_cost_rate.py --baseMonth {M}',
      ...(await readMeta(root, rel)),
      dirty: markDirty(rel),
    } as StatusItem);
  }

  for (const f of SAVE_FILES) {
    items.push({
      category: '저장',
      label: f.label,
      files: [f.file],
      how: f.how,
      ...(await readMeta(root, f.file)),
      dirty: markDirty(f.file),
    } as StatusItem);
  }

  for (const f of AUTO_FILES) {
    items.push({
      category: '자동',
      label: f.label,
      files: [f.file],
      how: f.how,
      ...(await readMeta(root, f.file)),
      dirty: markDirty(f.file),
    } as StatusItem);
  }

  for (const f of CSV_FILES) {
    items.push({
      category: 'CSV',
      label: f.label,
      files: [f.file],
      how: '직접 편집 후 커밋',
      ...(await readMeta(root, f.file)),
      dirty: markDirty(f.file),
    } as StatusItem);
  }

  return NextResponse.json(
    { items, gitAvailable: dirty != null, checkedAt: new Date().toISOString() },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
