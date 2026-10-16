import { useEffect } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";

interface UpdateNoticeProps {
  /** Says once that the page now opens without a network. */
  onOfflineReady(): void;
  onError(message: string): void;
  /** Keeps the running game for Continue; the reload waits for it. */
  beforeReload(): Promise<void>;
}

/**
 * Registers the service worker that keeps the page for offline play. A new
 * version waits until the player chooses Reload, so a running game never has
 * its files replaced under it.
 */
export function UpdateNotice({ onOfflineReady, onError, beforeReload }: UpdateNoticeProps) {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError: (error: unknown) => onError(`The page could not be kept for offline play: ${error instanceof Error ? error.message : String(error)}`),
  });

  useEffect(() => {
    if (offlineReady) onOfflineReady();
  }, [offlineReady, onOfflineReady]);

  if (!needRefresh) return null;
  return (
    <p className="notice info update-notice">
      <span>A new version is ready: reload to use it. Your game is kept for Continue.</span>
      <span className="notice-actions">
        <button type="button" className="update-reload" onClick={() => void beforeReload().then(() => updateServiceWorker(true))}>
          Reload
        </button>
        <button type="button" aria-label="Dismiss" onClick={() => setNeedRefresh(false)}>
          ×
        </button>
      </span>
    </p>
  );
}
