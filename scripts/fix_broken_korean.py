# -*- coding: utf-8 -*-

def fix_lines(filepath, line_fixes):
    """line_fixes: {line_number: new_content} (1-indexed)"""
    with open(filepath, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    for lineno, new_content in line_fixes.items():
        lines[lineno - 1] = new_content + '\n'
    with open(filepath, 'w', encoding='utf-8') as f:
        f.writelines(lines)
    print(f'수정 완료: {filepath}')

# ============================================================
# page.tsx 수정
# ============================================================
page_fixes = {
    61:  "  // 비고 데이터 타입",
    66:  "  // 비고 데이터 로드 (초기상태 진입 시 API에서 로드)",
    82:  "      console.error('비고 로드 실패:', error);",
    106: "  // 비고 저장 함수 (디바운스)",
    127: "            console.error('비고 저장 실패:', data.error || 'Unknown error');",
    128: "            // 오류가 발생해도 사용자 경험을 위해 무시 (디바운스 로그)",
    130: "            console.log('비고 저장 성공:', account);",
    133: "          console.error('비고 저장 실패:', error);",
    135: "      }, 1000); // 1초 디바운스",
    139: "  // 비고 초기상태로 저장 (KV 키값과 함께 로드)",
    170: "  // 비고 삭제 기능",
    192: "      alert('저장됩니다.');",
    219: "  // 데이터 로딩",
    251: "        throw new Error('데이터를 불러올 수 없습니다.');",
    264: "        // 전년도 데이터 로드 (2025, 2026년인 경우)",
    274: "          console.error('전년도 BS 데이터 로드 실패:', err);",
    293: "  // 경영요약 데이터 로드 (캐시 KV 1단계 후 fs/summary 또는 localStorage 또는 파일)",
    299: "      // 1단계: 캐시 경영요약 (GET /api/executive-summary) 또는 최근 5개 캐시에서 사용",
    318: "        console.log('경영요약 캐시 API 실패, 다음 단계 시도:', apiErr);",
    321: "      // 2단계: API에서 생성 (2026년 기준 계획)",
    334: "          console.error('경영요약 API 실패:', response.status, errBody);",
    337: "        console.log('경영요약 API 실패, 캐시/파일에서 로드 시도:', apiErr);",
    340: "      // 3단계: localStorage에서 확인",
    349: "          console.error('localStorage 파싱 실패:', parseErr);",
    353: "      // 4단계: 프로젝트 기본 파일에서 불러오기",
    376: "  // 경영요약 초기상태로 저장",
    379: "      // localStorage 초기화",
    382: "      // API에서 다시 불러오기",
    387: "        throw new Error('경영요약 데이터를 불러올 수 없습니다.');",
    391: "      // localStorage에도 저장",
    402: "  // CF 변경사항 데이터 로드",
    431: "  // 계도 변경사항 데이터 요청",
    496: "  // 특정년도 변경사항 데이터 요청(PL 2025/2026년)",
    507: "  // 대리상 변경사항 데이터 요청",
    511: "        // 빠른 응답 위해 대리상별 데이터 로드",
    519: "  // 대리상별 잔액 데이터 로드",
    532: "        const errorData = await response.json().catch(() => ({ error: '데이터를 불러올 수 없습니다.' }));",
    533: "        throw new Error(errorData.error || '데이터를 불러올 수 없습니다.');",
    558: "      {/* 탭 콘텐츠 - 탭 높이로 스크롤 영역 추가 */}",
    560: "        {/* 경영요약 */}",
}

fix_lines('app/page.tsx', page_fixes)

# ============================================================
# InventoryDashboard.tsx 수정
# ============================================================
inv_fixes = {
    912:  "      if (!res.ok) throw new Error('데이터 로드 실패');",
    941:  "        if (!res.ok) throw new Error('월별 데이터 로드 실패');",
    977:  "        if (!res.ok) throw new Error('출하매출 데이터 로드 실패');",
    1003: "        for (const j of jsons) if ((j as { error?: string }).error) throw new Error((j as { error?: string }).error ?? '출고매출 데이터 로드 실패');",
    1012: "        if (!res.ok || (json as { error?: string }).error) throw new Error((json as { error?: string }).error ?? '출고매출 데이터 로드 실패');",
    1035: "        for (const j of jsons) if ((j as { error?: string }).error) throw new Error((j as { error?: string }).error ?? '매입상품 데이터 로드 실패');",
    1044: "        if (!res.ok || (json as { error?: string }).error) throw new Error((json as { error?: string }).error ?? '매입상품 데이터 로드 실패');",
}

fix_lines('components/inventory/InventoryDashboard.tsx', inv_fixes)

print('모든 파일 수정 완료!')
