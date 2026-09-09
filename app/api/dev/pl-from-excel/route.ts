// 최신 엑셀 → 파일/PL_brand/*.csv 갱신 (dev 전용)
//
// 손익계산서 탭의 "최신엑셀로 PL업뎃" 버튼이 호출한다.
// scripts/excel_to_pl_csv.py 를 그대로 돌리므로, 터미널에서 직접 실행한 것과 결과가 같다.
//   - dryRun(기본): --apply 없이 차이만 뽑는다
//   - dryRun=false: --apply 로 실제 CSV 를 갱신한다
// 엑셀은 git 에 없으므로 이 API 는 로컬에서만 의미가 있다. production 에서는 403.
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EXCEL_ROOT = '엑셀파일(git푸시제외)';
const SCRIPT = path.join('scripts', 'excel_to_pl_csv.py');
/** 월 폴더 이름 형식: 26.08 */
const MONTH_DIR = /^\d{2}\.\d{2}$/;

/** 엑셀 폴더에서 월 폴더를 최신순으로 (26.08, 26.07, …) */
async function listMonths(root: string): Promise<string[]> {
  const dir = path.join(root, EXCEL_ROOT);
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && MONTH_DIR.test(e.name))
    .map((e) => e.name)
    .sort()
    .reverse();
}

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: '개발 모드에서만 사용 가능합니다.' }, { status: 403 });
  }

  const root = process.cwd();
  const body = (await req.json().catch(() => ({}))) as { dryRun?: boolean; year?: string };
  const dryRun = body.dryRun !== false; // 기본은 미리보기
  const year = body.year ?? '2026';

  const months = await listMonths(root);
  if (months.length === 0) {
    return NextResponse.json(
      { error: `${EXCEL_ROOT} 아래에 월 폴더(예: 26.08)가 없습니다.` },
      { status: 400 },
    );
  }
  const [month, prev] = months;

  const args = [SCRIPT, '--month', month, '--year', year];
  if (prev) args.push('--prev', prev);
  if (!dryRun) args.push('--apply');

  try {
    const { stdout, stderr } = await execFileAsync('python', args, {
      cwd: root,
      // 스크립트가 한글을 출력하므로 Windows 기본 코드페이지(cp949)로 깨지지 않게 고정
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      maxBuffer: 8 * 1024 * 1024,
      timeout: 10 * 60 * 1000,
    });
    const output = (stdout || '') + (stderr ? `\n[stderr]\n${stderr}` : '');
    // "전체 차이 셀 N개" 에서 N 을 뽑아 버튼 쪽에서 쓰게 한다
    const m = output.match(/전체 차이 셀 (\d+)개/);
    return NextResponse.json(
      { ok: true, month, prev: prev ?? null, dryRun, changed: m ? Number(m[1]) : null, output },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return NextResponse.json(
      {
        error: '스크립트 실행 실패',
        detail: (e.stderr || e.stdout || e.message || '').slice(0, 4000),
        month,
        prev: prev ?? null,
      },
      { status: 500 },
    );
  }
}
