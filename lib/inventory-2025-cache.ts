/**
 * 2025년 재고 데이터 파일 캐시
 * - data/inventory/2025/{type}-{brand}.json 에 저장
 * - 로컬: 파일 없으면 Snowflake 조회 후 저장, 이후 파일에서 즉시 반환
 * - Vercel: 커밋된 JSON 파일을 읽기만 함 (파일시스템 read-only)
 * - 재조회: cache-clear API가 파일 삭제 → 다음 요청 시 Snowflake 재조회
 */

import { promises as fs } from 'fs';
import path from 'path';

const CACHE_DIR = path.join(process.cwd(), 'data', 'inventory', '2025');

function cacheFilePath(type: string, brand: string): string {
  const safeBrand = brand.replace(/\s+/g, '_');
  return path.join(CACHE_DIR, `${type}-${safeBrand}.json`);
}

async function ensureCacheDir(): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
}

export async function get2025Cache<T>(type: string, brand: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(cacheFilePath(type, brand), 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function set2025Cache<T>(type: string, brand: string, data: T): Promise<void> {
  try {
    await ensureCacheDir();
    await fs.writeFile(cacheFilePath(type, brand), JSON.stringify(data), 'utf8');
  } catch (e) {
    // Vercel 등 read-only 환경에서는 무시
    console.warn('[2025 cache] 파일 저장 실패 (read-only 환경일 수 있음):', e);
  }
}

export async function clear2025Cache(): Promise<number> {
  try {
    const files = await fs.readdir(CACHE_DIR);
    await Promise.all(files.map((f) => fs.unlink(path.join(CACHE_DIR, f))));
    return files.length;
  } catch {
    return 0;
  }
}

export async function get2025CacheSize(): Promise<number> {
  try {
    const files = await fs.readdir(CACHE_DIR);
    return files.length;
  } catch {
    return 0;
  }
}
