import type { WebContainer } from '@webcontainer/api';
import type { ViteHotContext } from 'vite';
import { atom } from 'nanostores';
import { getWebContainer } from '~/lib/webcontainer';

// Extend Window interface to include our custom property
declare global {
  interface Window {
    _tabId?: string;
  }
}

export interface PreviewInfo {
  port: number;
  ready: boolean;
  baseUrl: string;
}

// Create a broadcast channel for preview updates
const PREVIEW_CHANNEL = 'preview-updates';

// HMR 중복 부착 방지용 플래그
const hot = import.meta.hot as (ViteHotContext & {
  data?: { previewsListenerAttached?: boolean };
}) | undefined;

export class PreviewsStore {
  #availablePreviews = new Map<number, PreviewInfo>();
  #broadcastChannel?: BroadcastChannel;
  #lastUpdate = new Map<string, number>();
  #watchedFiles = new Set<string>();
  #refreshTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  #REFRESH_DELAY = 300;
  #storageChannel?: BroadcastChannel;

  previews = atom<PreviewInfo[]>([]);

  constructor() {
    // 브라우저에서만 브로드캐스트 채널/스토리지 동기화 세팅
    if (typeof window !== 'undefined') {
      this.#broadcastChannel = new BroadcastChannel(PREVIEW_CHANNEL);
      this.#storageChannel = new BroadcastChannel('storage-sync-channel');

      // Listen for preview updates from other tabs
      this.#broadcastChannel.onmessage = (event) => {
        const { type, previewId } = event.data || {};
        if (type === 'file-change') {
          const timestamp = event.data.timestamp as number;
          const lastUpdate = this.#lastUpdate.get(previewId) || 0;
          if (timestamp > lastUpdate) {
            this.#lastUpdate.set(previewId, timestamp);
            this.refreshPreview(previewId);
          }
        }
      };

      // Listen for storage sync messages
      this.#storageChannel.onmessage = (event) => {
        const { storage, source } = event.data || {};
        if (storage && source !== this._getTabId()) {
          this._syncStorage(storage);
        }
      };

      // Override localStorage setItem to catch all changes
      try {
        const originalSetItem = localStorage.setItem.bind(localStorage);
        localStorage.setItem = (...args) => {
          originalSetItem(...args);
          this._broadcastStorageSync();
        };
      } catch {
        // noop
      }

      // CSR에서만 초기화
      void this.#init();
    }
  }

  // Generate a unique ID for this tab
  private _getTabId(): string {
    if (typeof window !== 'undefined') {
      if (!window._tabId) {
        window._tabId = Math.random().toString(36).substring(2, 15);
      }
      return window._tabId;
    }
    return '';
  }

  // Sync storage data between tabs
  private _syncStorage(storage: Record<string, string>) {
    if (typeof window === 'undefined') return;
    try {
      Object.entries(storage).forEach(([key, value]) => {
        const originalSetItem = Object.getPrototypeOf(localStorage).setItem;
        originalSetItem.call(localStorage, key, value);
      });

      // Force a refresh after syncing storage
      const previews = this.previews.get();
      previews.forEach((preview) => {
        const previewId = this.getPreviewId(preview.baseUrl);
        if (previewId) this.refreshPreview(previewId);
      });

      // Reload the page content in the preview iframe (if present)
      const iframe = document.querySelector('iframe') as HTMLIFrameElement | null;
      if (iframe) {
        iframe.src = iframe.src;
      }
    } catch (error) {
      console.error('[Preview] Error syncing storage:', error);
    }
  }

  // Broadcast storage state to other tabs
  private _broadcastStorageSync() {
    if (typeof window === 'undefined' || !this.#storageChannel) return;
    try {
      const storage: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) storage[key] = localStorage.getItem(key) || '';
      }

      this.#storageChannel.postMessage({
        type: 'storage-sync',
        storage,
        source: this._getTabId(),
        timestamp: Date.now(),
      });
    } catch {
      // noop
    }
  }

  async #init() {
    // HMR 중복 방지
    if (hot?.data?.previewsListenerAttached) return;

    try {
      const wc = await getWebContainer();

      // Listen for server ready events
      wc.on('server-ready', (port, url) => {
        console.log('[Preview] Server ready on port:', port, url);
        this.broadcastUpdate(url);
        // Initial storage sync when preview is ready
        this._broadcastStorageSync();
      });

      try {
        // Watch for file changes
        await wc.internal.watchPaths(
          {
            include: ['**/*.html', '**/*.css', '**/*.js', '**/*.jsx', '**/*.ts', '**/*.tsx', '**/*.json'],
            exclude: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**', '**/coverage/**'],
          },
          async (_events) => {
            const previews = this.previews.get();
            for (const preview of previews) {
              const previewId = this.getPreviewId(preview.baseUrl);
              if (previewId) this.broadcastFileChange(previewId);
            }
          },
        );

        // Watch for DOM changes that might affect storage
        if (typeof window !== 'undefined') {
          const observer = new MutationObserver((_mutations) => {
            this._broadcastStorageSync();
          });
          observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
          });
        }
      } catch (error) {
        console.error('[Preview] Error setting up watchers:', error);
      }

      // Listen for port events
      wc.on('port', (port, type, url) => {
        let previewInfo = this.#availablePreviews.get(port);

        if (type === 'close' && previewInfo) {
          this.#availablePreviews.delete(port);
          this.previews.set(this.previews.get().filter((preview) => preview.port !== port));
          return;
        }

        const previews = this.previews.get();

        if (!previewInfo) {
          previewInfo = { port, ready: type === 'open', baseUrl: url };
          this.#availablePreviews.set(port, previewInfo);
          previews.push(previewInfo);
        }

        previewInfo.ready = type === 'open';
        previewInfo.baseUrl = url;

        this.previews.set([...previews]);

        if (type === 'open') {
          this.broadcastUpdate(url);
        }
      });

      // HMR 플래그 설정(리스너 1회만 부착)
      if (hot) {
        hot.data = hot.data || {};
        hot.data.previewsListenerAttached = true;
      }
    } catch (err) {
      console.error('[Preview] webcontainer init failed:', err);
    }
  }

  // Helper to extract preview ID from URL
  getPreviewId(url: string): string | null {
    const match = url.match(/^https?:\/\/([^.]+)\.local-credentialless\.webcontainer-api\.io/);
    return match ? match[1] : null;
  }

  // Broadcast state change to all tabs
  broadcastStateChange(previewId: string) {
    const timestamp = Date.now();
    this.#lastUpdate.set(previewId, timestamp);
    this.#broadcastChannel?.postMessage({
      type: 'state-change',
      previewId,
      timestamp,
    });
  }

  // Broadcast file change to all tabs
  broadcastFileChange(previewId: string) {
    const timestamp = Date.now();
    this.#lastUpdate.set(previewId, timestamp);
    this.#broadcastChannel?.postMessage({
      type: 'file-change',
      previewId,
      timestamp,
    });
  }

  // Broadcast update to all tabs
  broadcastUpdate(url: string) {
    const previewId = this.getPreviewId(url);
    if (previewId) {
      const timestamp = Date.now();
      this.#lastUpdate.set(previewId, timestamp);
      this.#broadcastChannel?.postMessage({
        type: 'file-change',
        previewId,
        timestamp,
      });
    }
  }

  // Method to refresh a specific preview
  refreshPreview(previewId: string) {
    const existingTimeout = this.#refreshTimeouts.get(previewId);
    if (existingTimeout) clearTimeout(existingTimeout);

    const timeout = setTimeout(() => {
      const previews = this.previews.get();
      const preview = previews.find((p) => this.getPreviewId(p.baseUrl) === previewId);
      if (preview) {
        preview.ready = false;
        this.previews.set([...previews]);
        requestAnimationFrame(() => {
          preview.ready = true;
          this.previews.set([...previews]);
        });
      }
      this.#refreshTimeouts.delete(previewId);
    }, this.#REFRESH_DELAY);

    this.#refreshTimeouts.set(previewId, timeout);
  }

  refreshAllPreviews() {
    const previews = this.previews.get();
    for (const preview of previews) {
      const previewId = this.getPreviewId(preview.baseUrl);
      if (previewId) this.broadcastFileChange(previewId);
    }
  }
}

// Create a singleton instance
let previewsStore: PreviewsStore | null = null;

export function usePreviewStore() {
  if (!previewsStore) {
    previewsStore = new PreviewsStore();
  }
  return previewsStore;
}