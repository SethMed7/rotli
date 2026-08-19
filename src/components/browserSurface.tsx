import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

import {
  PRIVATE_BROWSER_SEARCH_ENGINE_PRESENTATIONS,
  forgetPrivateBrowserTab,
  normalizePrivateBrowserInput,
  privateBrowserInitialUrl,
  rememberPrivateBrowserUrl,
  seedPrivateBrowserTab,
} from "../lib/privateBrowser";
import {
  isTauri,
  onPrivateBrowserNewWindow,
  onPrivateBrowserState,
  privateBrowserBack,
  privateBrowserClose,
  privateBrowserCreate,
  privateBrowserForward,
  privateBrowserNavigate,
  privateBrowserReload,
  privateBrowserSetBounds,
  privateBrowserSetVisible,
  type PrivateBrowserBounds,
} from "../lib/tauri";
import { useUiStore } from "../state/ui";
import { BrowserGlyph, ChevronRight, LockGlyph, RefreshGlyph } from "./glyphs";

function boundsOf(element: HTMLElement): PrivateBrowserBounds {
  const rect = element.getBoundingClientRect();
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
  };
}

export function BrowserSurface({ tabId, active }: { tabId: string; active: boolean }) {
  const [initialUrl] = useState(() => privateBrowserInitialUrl(tabId));
  const privateBrowserSearchEngine = useUiStore((s) => s.privateBrowserSearchEngine);
  const engine =
    PRIVATE_BROWSER_SEARCH_ENGINE_PRESENTATIONS.find(
      (candidate) => candidate.id === privateBrowserSearchEngine,
    ) ?? PRIVATE_BROWSER_SEARCH_ENGINE_PRESENTATIONS[0]!;
  const hostRef = useRef<HTMLDivElement>(null);
  const editingAddress = useRef(false);
  const webviewCreated = useRef(false);
  const activeRef = useRef(active);
  activeRef.current = active;
  const [started, setStarted] = useState(initialUrl !== null);
  const [url, setUrl] = useState(initialUrl ?? "");
  const [address, setAddress] = useState(initialUrl ?? "");
  const [title, setTitle] = useState("Private browser");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const native = isTauri();

  const syncBounds = useCallback(() => {
    const host = hostRef.current;
    if (!host || !activeRef.current || !native || !webviewCreated.current) return;
    void privateBrowserSetBounds(tabId, boundsOf(host)).catch((reason: unknown) =>
      setError(reason instanceof Error ? reason.message : String(reason)),
    );
  }, [native, tabId]);

  const openNativePage = useCallback(
    async (next: string) => {
      const host = hostRef.current;
      if (!native || !host) throw new Error("Private browsing opens in the desktop app.");
      if (webviewCreated.current) {
        await privateBrowserNavigate(tabId, next);
      } else {
        webviewCreated.current = true;
        try {
          await privateBrowserCreate(tabId, next, boundsOf(host));
          await privateBrowserSetVisible(tabId, activeRef.current);
          if (activeRef.current) syncBounds();
        } catch (reason) {
          webviewCreated.current = false;
          throw reason;
        }
      }
    },
    [native, syncBounds, tabId],
  );

  useEffect(() => {
    if (!native) return;
    let disposed = false;
    const unlistenState = onPrivateBrowserState((event) => {
      if (disposed || !webviewCreated.current || event.tabId !== tabId) return;
      setUrl(event.url);
      rememberPrivateBrowserUrl(tabId, event.url);
      if (!editingAddress.current) setAddress(event.url);
      if (event.title !== undefined) setTitle(event.title || "Private browser");
      if (event.loading !== undefined) setLoading(event.loading);
      setError("");
    });
    const unlistenWindow = onPrivateBrowserNewWindow((event) => {
      if (disposed || !webviewCreated.current || event.tabId !== tabId) return;
      setAddress(event.url);
      void privateBrowserNavigate(tabId, event.url).catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      );
    });

    const frame =
      initialUrl === null
        ? null
        : requestAnimationFrame(() => {
            const host = hostRef.current;
            if (!host || disposed) return;
            webviewCreated.current = true;
            void privateBrowserCreate(tabId, initialUrl, boundsOf(host))
              .then(() => {
                if (disposed) return privateBrowserClose(tabId);
                return privateBrowserSetVisible(tabId, activeRef.current);
              })
              .then(() => {
                if (!disposed && activeRef.current) syncBounds();
              })
              .catch((reason: unknown) => {
                webviewCreated.current = false;
                if (!disposed) setError(reason instanceof Error ? reason.message : String(reason));
              });
          });
    return () => {
      disposed = true;
      if (frame !== null) cancelAnimationFrame(frame);
      void unlistenState.then((unlisten) => unlisten());
      void unlistenWindow.then((unlisten) => unlisten());
      if (webviewCreated.current) void privateBrowserClose(tabId).catch(() => {});
      webviewCreated.current = false;
      forgetPrivateBrowserTab(tabId);
    };
  }, [initialUrl, native, syncBounds, tabId]);

  useEffect(() => {
    if (!native || !webviewCreated.current) return;
    void privateBrowserSetVisible(tabId, active)
      .then(() => {
        if (active) syncBounds();
      })
      .catch((reason: unknown) => {
        // Creation and visibility effects can cross during StrictMode's
        // development remount. Only surface a real active-tab failure.
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      });
  }, [active, native, syncBounds, tabId]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !native) return;
    const observer = new ResizeObserver(syncBounds);
    observer.observe(host);
    window.addEventListener("resize", syncBounds);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncBounds);
    };
  }, [native, syncBounds]);

  const navigate = (event: FormEvent) => {
    event.preventDefault();
    const next = normalizePrivateBrowserInput(address, privateBrowserSearchEngine);
    if (!next) {
      setError("Enter an http(s) address or a search.");
      return;
    }
    setLoading(true);
    setError("");
    void openNativePage(next)
      .then(() => {
        setStarted(true);
        setUrl(next);
        setAddress(next);
        rememberPrivateBrowserUrl(tabId, next);
      })
      .catch((reason: unknown) => {
        setLoading(false);
        setError(reason instanceof Error ? reason.message : String(reason));
      });
  };

  const showStartPage = () => {
    if (webviewCreated.current) void privateBrowserClose(tabId).catch(() => {});
    webviewCreated.current = false;
    seedPrivateBrowserTab(tabId);
    setStarted(false);
    setUrl("");
    setAddress("");
    setTitle("Private browser");
    setLoading(false);
    setError("");
  };

  return (
    <section className="browser-surface" aria-label={title}>
      <div className="browser-toolbar">
        <button
          type="button"
          className="browser-nav browser-home"
          aria-label="Private browser start page"
          onClick={showStartPage}
        >
          <BrowserGlyph size={13} />
        </button>
        <button
          type="button"
          className="browser-nav back"
          aria-label="Back"
          disabled={!native || !started || !url}
          onClick={() => void privateBrowserBack(tabId)}
        >
          <ChevronRight size={13} />
        </button>
        <button
          type="button"
          className="browser-nav"
          aria-label="Forward"
          disabled={!native || !started || !url}
          onClick={() => void privateBrowserForward(tabId)}
        >
          <ChevronRight size={13} />
        </button>
        <button
          type="button"
          className={loading ? "browser-reload loading" : "browser-reload"}
          aria-label={loading ? "Page loading" : "Reload"}
          disabled={!native || !started || !url}
          onClick={() => void privateBrowserReload(tabId)}
        >
          <RefreshGlyph size={13} />
        </button>
        <form className="browser-address" onSubmit={navigate}>
          <LockGlyph size={12} />
          <input
            aria-label="Address or search"
            value={address}
            placeholder={`Search with ${engine.label} or enter an address`}
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            onFocus={(event) => {
              editingAddress.current = true;
              event.currentTarget.select();
            }}
            onBlur={() => {
              editingAddress.current = false;
              setAddress(url);
            }}
            onChange={(event) => setAddress(event.target.value)}
          />
        </form>
        <span className="browser-private" title="Cookies and history are discarded when the tab closes">
          <LockGlyph size={11} /> Private
        </span>
      </div>
      {error && (
        <div className="browser-error" role="alert">
          {error}
        </div>
      )}
      <div ref={hostRef} className="browser-native-host">
        {!started && (
          <div className="browser-start">
            <div className="browser-start-mark" aria-hidden="true">
              <BrowserGlyph size={22} />
            </div>
            <span className="browser-start-provider">{engine.label}</span>
            <h2>Search without leaving Rotli</h2>
            <p>Private, temporary research in the environment you already chose.</p>
            <form className="browser-start-search" onSubmit={navigate}>
              <input
                aria-label={`Search with ${engine.label}`}
                value={address}
                placeholder={`Search with ${engine.label}`}
                spellCheck={false}
                autoCapitalize="none"
                autoCorrect="off"
                autoFocus={active}
                onChange={(event) => setAddress(event.target.value)}
              />
              <button type="submit">Search</button>
            </form>
            <span className="browser-start-private">
              <LockGlyph size={11} /> History and site data disappear when this tab closes
            </span>
          </div>
        )}
      </div>
      {!native && started && (
        <div className="browser-twin-empty">
          <BrowserGlyph size={30} />
          <strong>Private browsing opens in the desktop app.</strong>
          <span>The browser twin cannot host a native, non-persistent webview.</span>
        </div>
      )}
    </section>
  );
}
