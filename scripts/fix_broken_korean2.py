# -*- coding: utf-8 -*-

def fix_lines(filepath, line_fixes):
    with open(filepath, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    for lineno, new_content in line_fixes.items():
        lines[lineno - 1] = new_content + '\n'
    with open(filepath, 'w', encoding='utf-8') as f:
        f.writelines(lines)
    print(f'수정 완료: {filepath}')

inv_fixes = {
    893: "  // 재고 데이터 fetch 함수",
    895: "    // 2025/2026 재고자산 데이터는 탭별로 월별/출하/출고/매입 각각으로 나뉘어 로드됩니다.",
    896: "    // (기존 /api/inventory fallback이 있어도 초기 데이터타입 불일치가 발생)",
}

fix_lines('components/inventory/InventoryDashboard.tsx', inv_fixes)
print('완료')
