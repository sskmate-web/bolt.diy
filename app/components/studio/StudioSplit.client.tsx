import { useEffect, useRef, useState, useCallback } from 'react';
import { ClientOnly } from 'remix-utils/client-only';
import { BaseChat } from '~/components/chat/BaseChat';
import { workbenchStore } from '~/lib/stores/workbench';

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export default function StudioSplitClient() {
  // 왼쪽(채팅) 비율
  const [ratio, setRatio] = useState(0.5);
  const draggingRef = useRef(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(false);

  // ✅ BaseChat 렌더 함수 고정(리마운트/초기화 가능성 줄이기)
  const renderBaseChat = useCallback(() => <BaseChat />, []);

  // Studio 섹션이 화면에 들어왔을 때만 핸들 표시
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    const io = new IntersectionObserver(([entry]) => setActive(entry.isIntersecting), {
      threshold: 0.35,
    });

    io.observe(el);
    return () => io.disconnect();
  }, []);

  // ✅ CSS 변수 적용 함수: useCallback으로 고정 + r 인자 필수
  const applySplit = useCallback((r: number) => {
    const root = document.documentElement;

    const leftPx = Math.round(window.innerWidth * r);
    const rightPx = Math.round(window.innerWidth * (1 - r));

    root.style.setProperty('--workbench-left', `${leftPx}px`);
    root.style.setProperty('--workbench-width', `${rightPx}px`);
    root.style.setProperty('--workbench-inner-width', `${rightPx}px`);
    root.style.setProperty('--chat-width', `${leftPx}px`);
  }, []);

  // ratio가 바뀔 때마다 보정 적용
  useEffect(() => {
    applySplit(ratio);
  }, [ratio, applySplit]);

  // Studio가 활성화되면 Workbench를 "딱 1번만" 켬
  const didEnableWorkbenchRef = useRef(false);
  useEffect(() => {
    if (!active) return;
    if (didEnableWorkbenchRef.current) return;
    didEnableWorkbenchRef.current = true;

    try {
      const current = workbenchStore.showWorkbench.get();
      if (current !== true) {
        workbenchStore.showWorkbench.set(true);
      }
    } catch {
      // ignore
    }
  }, [active]);

  // Studio 활성 동안 CSS 변수만 주기적으로 재적용(덮어쓰기 방지)
  useEffect(() => {
    if (!active) return;

    const tick = () => applySplit(ratio);

    tick();
    const t = window.setInterval(tick, 150);

    const onResize = () => applySplit(ratio);
    window.addEventListener('resize', onResize);

    return () => {
      window.clearInterval(t);
      window.removeEventListener('resize', onResize);
    };
  }, [active, ratio, applySplit]);

  // 드래그 이벤트
  useEffect(() => {
    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      const r = clamp(ev.clientX / window.innerWidth, 0.25, 0.75);

      // ✅ 즉시 CSS 변수 반영(실제 분할 체감)
      applySplit(r);

      // ✅ 핸들 위치 업데이트용
      setRatio(r);
    };

    const onUp = () => {
      draggingRef.current = false;
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);

    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [applySplit]);

  return (
    <div ref={rootRef} className="relative h-full min-h-0">
      {/* BaseChat 안에 Chat + Workbench(코드/프리뷰)가 포함 */}
      <ClientOnly>{renderBaseChat}</ClientOnly>

      {/* Studio 섹션이 보일 때만 드래그 핸들 표시 */}
      {active && (
        <div
          onMouseDown={(e) => {
            e.preventDefault();
            draggingRef.current = true;
          }}
          title="Drag to resize"
          style={{
            position: 'fixed',
            top: 'var(--brand-header-height, 80px)',
            bottom: 0,
            left: `calc(${Math.round(ratio * 100)}vw - 3px)`,
            width: '6px',
            cursor: 'col-resize',
            zIndex: 9999,
            background: 'rgba(255,255,255,0.12)',
          }}
        />
      )}
    </div>
  );
}