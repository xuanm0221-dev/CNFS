'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import type { CFExplanationContent } from '@/app/api/cf-explanation/route';
import type { CFExplanationNumbers } from '@/lib/cf-explanation-data';
import { generateCFExplanationContent } from '@/lib/cf-explanation-generator';

interface CFExplanationPanelProps {
  year?: number;
  rollingNumbers?: CFExplanationNumbers;
  storeKey?: string;
}

const SECTION_KEYS: (keyof CFExplanationContent)[] = [
  'keyInsights',
  'cashFlow',
  'workingCapital',
  'managementPoints',
];

const SECTION_LABELS: Record<keyof CFExplanationContent, { title: string; cardBg: string; ring: string; titleClass: string }> = {
  keyInsights: { title: '핵심 인사이트', cardBg: 'bg-blue-50/40', ring: 'ring-blue-100', titleClass: 'text-blue-700' },
  cashFlow: { title: '', cardBg: 'bg-emerald-50/40', ring: 'ring-emerald-100', titleClass: 'text-emerald-700' },
  workingCapital: { title: '', cardBg: 'bg-purple-50/40', ring: 'ring-purple-100', titleClass: 'text-purple-700' },
  managementPoints: { title: '관리 포인트', cardBg: 'bg-orange-50/40', ring: 'ring-orange-100', titleClass: 'text-orange-700' },
};

export default function CFExplanationPanel({ year = 2026, rollingNumbers, storeKey = 'cf-explanation' }: CFExplanationPanelProps) {
  // KV에 저장된 사용자 편집 내용 (없으면 null)
  const [kvContent, setKvContent] = useState<CFExplanationContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [requirePassword, setRequirePassword] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState<CFExplanationContent | null>(null);
  const [passwordInput, setPasswordInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const passwordRef = useRef<string>('');

  // Rolling 데이터로 자동 생성된 내용 (props 변경시 자동 업데이트)
  const rollingContent = useMemo(
    () => (rollingNumbers ? generateCFExplanationContent(rollingNumbers) : null),
    [rollingNumbers],
  );

  // 최종 표시 내용: rollingNumbers가 있으면 rolling 우선(CF 탭), 없으면 서버 fetch 우선(현금흐름표 탭)
  const content = rollingNumbers ? (rollingContent ?? kvContent) : (kvContent ?? rollingContent);

  const loadKvContent = () => {
    setLoading(true);
    setLoadError(null);
    fetch(`/api/cf-explanation?key=${storeKey}`)
      .then((res) => res.json())
      .then((data) => {
        setRequirePassword(!!data.requirePassword);
        if (data.error || data.content == null) {
          setKvContent(null);
          if (!rollingContent) setLoadError(data.error || '데이터를 불러올 수 없습니다.');
          else setLoadError(null);
        } else {
          setKvContent(data.content);
          setLoadError(null);
        }
      })
      .catch(() => {
        setKvContent(null);
        if (!rollingContent) setLoadError('데이터를 불러올 수 없습니다.');
        else setLoadError(null);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/cf-explanation?key=${storeKey}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setRequirePassword(!!data.requirePassword);
        if (data.error || data.content == null) {
          setKvContent(null);
        } else {
          setKvContent(data.content);
          setLoadError(null);
        }
      })
      .catch(() => {
        if (!cancelled) setKvContent(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [storeKey]);

  const handleEdit = () => {
    if (requirePassword) {
      if (passwordInput.trim() === '') {
        setError('비밀번호를 입력하세요.');
        return;
      }
      fetch(`/api/cf-explanation?key=${storeKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: passwordInput, key: storeKey }),
      }).then((res) => {
        if (res.ok) {
          passwordRef.current = passwordInput;
          setError(null);
          setEditMode(true);
          setEditContent(content ? { ...content } : null);
        } else {
          setError('비밀번호가 올바르지 않습니다.');
        }
      });
    } else {
      setEditMode(true);
      setEditContent(content ? { ...content } : null);
    }
  };

  const handleSave = () => {
    if (!editContent) return;
    setSaving(true);
    setError(null);
    const body: { password?: string; content: CFExplanationContent; key: string } = { content: editContent, key: storeKey };
    if (requirePassword && passwordRef.current) body.password = passwordRef.current;
    fetch(`/api/cf-explanation?key=${storeKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then((res) => {
        if (res.ok) {
          setKvContent(editContent);
          setEditMode(false);
          setEditContent(null);
          setPasswordInput('');
          passwordRef.current = '';
        } else {
          return res.json().then((d) => {
            setError(d?.error || '저장에 실패했습니다.');
          });
        }
      })
      .catch(() => setError('저장에 실패했습니다.'))
      .finally(() => setSaving(false));
  };

  const handleCancel = () => {
    setEditMode(false);
    setEditContent(null);
    setPasswordInput('');
    setError(null);
    passwordRef.current = '';
  };

  const setSectionLines = (key: keyof CFExplanationContent, lines: string[]) => {
    if (editContent) setEditContent({ ...editContent, [key]: lines });
  };

  if (loading && !content) {
    return (
      <div className="bg-white rounded-2xl shadow-sm p-6 ring-1 ring-slate-200">
        <div className="text-gray-500 text-sm">로딩 중...</div>
      </div>
    );
  }

  const display = editMode ? editContent : content;
  if (!display) {
    return (
      <div className="bg-white rounded-2xl shadow-sm p-6 ring-1 ring-slate-200">
        <div className="text-red-600 text-sm mb-2">{loadError || '내용을 불러올 수 없습니다.'}</div>
        <button
          type="button"
          onClick={loadKvContent}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
        >
          초기값 불러오기
        </button>
      </div>
    );
  }

  const getSectionTitle = (key: keyof CFExplanationContent) => {
    if (key === 'keyInsights') return '핵심 인사이트';
    if (key === 'cashFlow') return `${year}년 현금흐름표 (계획대비)`;
    if (key === 'workingCapital') return `${year}년 운전자본표`;
    return '관리 포인트';
  };

  return (
    <div className="rounded-2xl bg-white shadow-sm p-6 ring-1 ring-slate-200">
      <div className="flex justify-between items-center mb-5">
        <h3 className="bg-gradient-to-r from-slate-900 to-slate-600 bg-clip-text text-xl font-bold tracking-tight text-transparent">설명과 분석</h3>
        {!editMode ? (
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => {
                if (rollingNumbers) {
                  setKvContent(null);
                } else {
                  setLoading(true);
                  fetch(`/api/cf-explanation?refresh=1&key=${storeKey}`)
                    .then((res) => res.json())
                    .then((data) => {
                      if (data.content) setKvContent(data.content);
                    })
                    .finally(() => setLoading(false));
                }
              }}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
              title="Rolling 데이터 기준 자동 생성 내용으로 되돌리기"
            >
              초기값
            </button>
            <button
              type="button"
              onClick={loadKvContent}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
              title="KV에 저장된 내용 불러오기"
            >
              저장된 내용 불러오기
            </button>
            {requirePassword && (
              <input
                type="password"
                placeholder="비밀번호"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                className="px-3 py-1.5 border border-slate-200 rounded-md text-xs w-28"
              />
            )}
            <button
              type="button"
              onClick={handleEdit}
              className="inline-flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-100"
            >
              수정
            </button>
          </div>
        ) : (
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={handleCancel}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-50"
            >
              {saving ? '저장 중...' : '저장'}
            </button>
          </div>
        )}
      </div>
      {error && (
        <div className="mb-3 text-sm text-red-600">{error}</div>
      )}

      <div className="space-y-4">
        {SECTION_KEYS.map((key) => {
          const meta = SECTION_LABELS[key];
          const lines = display[key] || [];
          const title = getSectionTitle(key);
          return (
            <div key={key} className={`rounded-2xl ${meta.cardBg} ring-1 ${meta.ring} shadow-sm p-5`}>
              <h4 className={`font-bold text-base mb-3 ${meta.titleClass}`}>{title}</h4>
              {editMode && editContent ? (
                <textarea
                  value={lines.join('\n')}
                  onChange={(e) => setSectionLines(key, e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))}
                  className="w-full p-2 border border-slate-200 rounded-md text-sm leading-relaxed bg-white"
                  rows={Math.max(3, lines.length + 1)}
                />
              ) : (
                <ul className="space-y-1.5 text-sm text-slate-700 leading-relaxed">
                  {lines.map((line, i) => {
                    // 'ㄴ ' 시작 → 1단계 하위 (동그라미 제거, 들여쓰기)
                    if (line.startsWith('ㄴ ') || line.startsWith('ㄴ\t')) {
                      return (
                        <li key={i} className="pl-6 list-none text-slate-600">{line}</li>
                      );
                    }
                    // 전각공백/공백 시작 → 2단계 하위 (동그라미 제거, 더 깊은 들여쓰기)
                    if (/^[　\s]/.test(line)) {
                      return (
                        <li key={i} className="pl-12 list-none text-slate-500">{line.replace(/^[　\s]+/, '')}</li>
                      );
                    }
                    return <li key={i}>• {line}</li>;
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
