// The transient line for external files that did not land where the person
// can see them (src/state/fileNotice.ts owns when it shows).

import { useEffect } from "react";

import { dismissFileNotice, useFileNoticeStore } from "../state/fileNotice";

const VISIBLE_MS = 6000;

export function FileNotice() {
  const notice = useFileNoticeStore((s) => s.notice);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => dismissFileNotice(notice.id), VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);
  if (!notice) return null;
  return <FileNoticeLine message={notice.message} onDismiss={() => dismissFileNotice(notice.id)} />;
}

export function FileNoticeLine({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="file-notice" role="status">
      <span className="file-notice-text">{message}</span>
      <button type="button" className="file-notice-x" aria-label="Dismiss" onClick={onDismiss}>
        ×
      </button>
    </div>
  );
}
