import { WebContainer } from '@webcontainer/api';
import type { ViteHotContext } from 'vite';
import { WORK_DIR_NAME } from '~/utils/constants';
import { cleanStackTrace } from '~/utils/stacktrace';

interface WebContainerContext {
  loaded: boolean;
  booting: boolean;
  lastError?: string;
}

type HotData = {
  webcontainer?: Promise<WebContainer>;
  webcontainerContext?: WebContainerContext;
  previewListenerAttached?: boolean;
};

const hot = import.meta.hot as (ViteHotContext & { data: HotData }) | undefined;

// HMR 간 상태 유지(없으면 새로 생성)
export const webcontainerContext: WebContainerContext =
  hot?.data.webcontainerContext ?? {
    loaded: false,
    booting: false,
  };

if (hot) {
  hot.data.webcontainerContext = webcontainerContext;
}

/**
 * WebContainer 싱글톤 Promise를 가져옵니다.
 * - CSR에서만 boot
 * - SSR에서는 즉시 reject (pending 방지)
 * - HMR에서는 hot.data에 저장해 재사용
 */
export function getWebContainer(): Promise<WebContainer> {
  // SSR: 절대 WebContainer를 boot하지 않음 (pending noop 방지)
  if (import.meta.env.SSR) {
    return Promise.reject(new Error('WebContainer is not available during SSR'));
  }

  // HMR 캐시가 있으면 재사용
  if (hot?.data.webcontainer) {
    return hot.data.webcontainer;
  }

  // 처음 boot 시작
  webcontainerContext.booting = true;
  webcontainerContext.lastError = undefined;

  const promise = Promise.resolve()
    .then(() => {
      return WebContainer.boot({
        coep: 'credentialless',
        workdirName: WORK_DIR_NAME,
        forwardPreviewErrors: true, // Enable error forwarding from iframes
      });
    })
    .then(async (wc) => {
      webcontainerContext.loaded = true;
      webcontainerContext.booting = false;

      // preview-message 리스너는 HMR에서도 1회만 부착 (중복 등록 방지)
      if (!hot?.data.previewListenerAttached) {
        if (hot) hot.data.previewListenerAttached = true;

        const { workbenchStore } = await import('~/lib/stores/workbench');

        wc.on('preview-message', (message) => {
          try {
            if (
              message.type === 'PREVIEW_UNCAUGHT_EXCEPTION' ||
              message.type === 'PREVIEW_UNHANDLED_REJECTION'
            ) {
              const isPromise = message.type === 'PREVIEW_UNHANDLED_REJECTION';
              const title = isPromise ? 'Unhandled Promise Rejection' : 'Uncaught Exception';

              workbenchStore.actionAlert.set({
                type: 'preview',
                title,
                description: 'message' in message ? message.message : 'Unknown error',
                content: `Error occurred at ${message.pathname}${message.search}${message.hash}
Port: ${message.port}

Stack trace:
${cleanStackTrace(message.stack || '')}`,
                source: 'preview',
              });
            }
          } catch (err) {
            console.error('[WebContainer] Failed to handle preview-message', err);
          }
        });
      }

      return wc;
    })
    .catch((err) => {
      webcontainerContext.loaded = false;
      webcontainerContext.booting = false;
      webcontainerContext.lastError = err?.message ? String(err.message) : String(err);

      console.error('[WebContainer] boot failed:', err);
      throw err;
    });

  // HMR 캐시 저장
  if (hot) {
    hot.data.webcontainer = promise;
  }

  return promise;
}
