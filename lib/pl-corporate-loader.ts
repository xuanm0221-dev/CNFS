// 법인 PL — 5개 브랜드 CSV를 읽어 합성한 FinancialData를 반환 (서버 전용)
import path from 'path';
import { readCSV } from './csv';
import { synthesizeCorporatePLFromBrands, BRAND_ID_TO_CORP_TAG_ACCOUNT } from './fs-mapping';
import type { FinancialData } from './types';

const BRAND_IDS = Object.keys(BRAND_ID_TO_CORP_TAG_ACCOUNT);

/**
 * 5개 브랜드 PL CSV를 읽어 법인 PL 형식의 FinancialData[]로 합성.
 * 브랜드 CSV가 없는 경우 해당 브랜드는 누락 (sum에서 빠짐).
 */
export async function loadCorporatePLFromBrands(year: number): Promise<FinancialData[]> {
  const brandData: Record<string, FinancialData[]> = {};
  await Promise.all(
    BRAND_IDS.map(async (id) => {
      const filePath = path.join(process.cwd(), '파일', 'PL_brand', id, `${year}.csv`);
      try {
        brandData[id] = await readCSV(filePath, year);
      } catch {
        // 파일이 없으면 해당 브랜드 누락
      }
    }),
  );
  return synthesizeCorporatePLFromBrands(brandData, year);
}
