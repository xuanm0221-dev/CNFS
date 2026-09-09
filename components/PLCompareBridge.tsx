'use client';

import { useState } from 'react';

// 지난달 보고 대비 — 영업이익 Bridge (전월 → 현재)
//
// 사업계획의 Waterfall 은 6요인 고정이라 그대로 못 쓴다. 여기선 단계 목록을 받아
// 그리는 작은 워터폴을 따로 둔다. 양끝(전월·현재)은 0 부터 그린 절대 막대,
// 가운데는 누적값 위에 얹는 증감 막대.
import type { BridgeStep } from '@/lib/pl-compare-analysis';

interface Props {
  steps: BridgeStep[];
  /** 패널 폭에 맞춘 SVG 크기 */
  width?: number;
  /** 기본 330 — 막대 안에 이름을 넣으려면 어느 정도 높이가 필요하다 */
  height?: number;
  /** 현재 펼쳐 둔 막대 라벨 */
  selected?: string | null;
  /** 막대 클릭 — 같은 걸 다시 누르면 null 로 접는다 */
  onSelect?: (label: string | null) => void;
}

const fmtK = (v: number, signed: boolean): string => {
  const n = Math.round(v / 1000);
  const s = Math.abs(n).toLocaleString('ko-KR');
  if (n < 0) return `△${s}`;
  return signed && n > 0 ? `+${s}` : s;
};

/** 막대 안에 항목명을 넣기 위한 최소 높이(px). 이보다 얇으면 축 라인에 쓴다 */
const NAME_MIN_H = 20;

export default function PLCompareBridge({ steps, width = 700, height = 330, selected, onSelect }: Props) {
  const [hovered, setHovered] = useState<string | null>(null);
  if (steps.length === 0) return null;

  const padL = 6;
  const padR = 6;
  const padTop = 22;   // 막대 위 값 라벨
  const padBottom = 20; // 항목명

  // 축은 '전월 대비 증감' — 0 에서 출발해 요인을 쌓고, 마지막 '합계' 는 0 기준 절대 막대.
  // 전월·현재 영업이익 절대금액은 자릿수가 요인의 수십 배라 차트에 넣지 않는다(숫자로 표기).
  const bars = steps.map((s) => ({ ...s, start: 0, end: 0 }));
  let acc = 0;
  for (const b of bars) {
    if (b.kind === 'total') {
      b.start = 0;
      b.end = b.value;
    } else {
      b.start = acc;
      acc += b.value;
      b.end = acc;
    }
  }

  // 증감만 그리므로 0 이 항상 축 안에 들어온다 — 절단축이 필요 없다
  let lo = 0;
  let hi = 0;
  for (const b of bars) {
    lo = Math.min(lo, b.start, b.end);
    hi = Math.max(hi, b.start, b.end);
  }
  if (hi === lo) hi = lo + 1;
  const pad = (hi - lo) * 0.16;
  const ymax = hi + pad;
  const ymin = lo - pad;
  const span = ymax - ymin;
  const plotH = height - padTop - padBottom;
  const y = (v: number) => padTop + ((ymax - v) / span) * plotH;
  const zeroY = y(0);

  const stepW = (width - padL - padR) / bars.length;
  // 칸이 넓어지면 막대만 뚱뚱해져 보기 나쁘다 → 상한을 둔다
  const barW = Math.min(56, Math.max(14, stepW * 0.42));

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="영업이익 Bridge">
      {/* 0 기준선 — 전월 영업이익 수준 */}
      <line x1={padL} x2={width - padR} y1={zeroY} y2={zeroY} stroke="#94a3b8" strokeWidth={1} />

      {bars.map((b, i) => {
        const cx = padL + stepW * i + stepW / 2;
        const isTotal = b.kind === 'total';
        const top = Math.min(y(b.start), y(b.end));
        const h = Math.max(1.5, Math.abs(y(b.end) - y(b.start)));
        // 증감은 이익 기준 색: 늘면 파랑, 줄면 빨강. 총계는 회색.
        const fill = isTotal ? '#334155' : b.value >= 0 ? '#3b82f6' : '#ef4444';
        const prev = bars[i - 1];
        const isSel = selected === b.label;
        const isHov = hovered === b.label && !isSel;
        const dimmed = selected != null && !isSel;
        return (
          <g
            key={b.label}
            onClick={onSelect ? () => onSelect(isSel ? null : b.label) : undefined}
            onMouseEnter={onSelect ? () => setHovered(b.label) : undefined}
            onMouseLeave={onSelect ? () => setHovered(null) : undefined}
            style={onSelect ? { cursor: 'pointer' } : undefined}
            opacity={dimmed ? 0.42 : 1}
          >
            {/* 클릭 영역 — 얇은 막대도 누를 수 있게 칸 전체를 덮는다 */}
            {onSelect && (
              <rect
                x={padL + stepW * i}
                y={padTop - 14}
                width={stepW}
                height={height - padTop + 8}
                fill={isSel ? '#e0e7ff' : isHov ? '#eef2ff' : 'transparent'}
                rx={4}
              />
            )}
            {/* 이전 막대 끝 → 현재 막대 시작 연결선 */}
            {i > 0 && (
              <line
                x1={padL + stepW * (i - 1) + stepW / 2 + barW / 2}
                x2={cx - barW / 2}
                y1={y(prev.end)}
                y2={y(prev.end)}
                stroke="#cbd5e1"
                strokeWidth={1}
                strokeDasharray="2 2"
              />
            )}
            <rect
              x={cx - barW / 2}
              y={top}
              width={barW}
              height={h}
              fill={fill}
              rx={1.5}
              stroke={isSel ? '#312e81' : isHov ? '#818cf8' : 'none'}
              strokeWidth={isSel || isHov ? 2 : 0}
            >
              {b.hint && <title>{`${b.label} · ${b.hint}`}</title>}
            </rect>
            <text
              x={cx}
              y={b.value >= 0 ? top - 5 : top + h + 10}
              textAnchor="middle"
              className="fill-slate-700"
              style={{ fontSize: 11, fontWeight: 700 }}
            >
              {fmtK(b.value, !isTotal)}
            </text>
            {/* 항목명은 막대 안에. 높이가 모자라면 축 라인으로 내린다 */}
            {h >= NAME_MIN_H ? (
              <text
                x={cx}
                y={top + h / 2}
                textAnchor="middle"
                dominantBaseline="central"
                className="fill-white"
                style={{ fontSize: 12, fontWeight: 700 }}
              >
                {b.label}
              </text>
            ) : (
              <text
                x={cx}
                y={height - 6}
                textAnchor="middle"
                className="fill-slate-500"
                style={{ fontSize: 11, fontWeight: 600 }}
              >
                {b.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
