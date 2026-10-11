import { useEffect, useState } from "react";

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const CHECK_TIMEOUT_MS = 15 * 1000;
const MAX_HTML_LENGTH = 256 * 1024;

function entryScript(document: Document, baseUrl: URL): URL | null {
  const entries = Array.from(
    document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]'),
  ).flatMap((script) => {
    try {
      const url = new URL(script.getAttribute("src")!, baseUrl);
      // Only built Vite entries identify a version. /@vite/client and source
      // modules in development must never create an update notification.
      return url.origin === baseUrl.origin &&
        /\/assets\/index-[A-Za-z0-9_-]{6,}\.js$/.test(url.pathname)
        ? [url]
        : [];
    } catch {
      return [];
    }
  });
  return entries.length === 1 ? entries[0] : null;
}

/** An update is advisory: the caller decides when a user-requested reload is safe. */
export function useAppUpdate(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    const current = entryScript(document, new URL(window.location.href));
    if (!current) return;
    // Derive the deployed HTML directory from its entry, including recovery or
    // nested application paths. Do not compare the recovery build with /.
    const base = new URL(
      current.pathname.replace(/assets\/[^/]+$/, ""),
      current,
    );
    let disposed = false;
    let found = false;
    let pending: AbortController | null = null;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    async function check() {
      if (
        disposed ||
        found ||
        pending ||
        document.visibilityState !== "visible"
      )
        return;
      const controller = new AbortController();
      pending = controller;
      timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
      try {
        const response = await fetch(base, {
          cache: "no-store",
          credentials: "omit",
          redirect: "error",
          signal: controller.signal,
          headers: { Accept: "text/html" },
        });
        if (
          response.status !== 200 ||
          Number(response.headers.get("Content-Length")) > MAX_HTML_LENGTH ||
          response.headers.get("Content-Type")?.split(";")[0].trim() !==
            "text/html"
        )
          return;
        const html = await response.text();
        if (html.length > MAX_HTML_LENGTH) return;
        const next = entryScript(
          new DOMParser().parseFromString(html, "text/html"),
          base,
        );
        if (
          !disposed &&
          !controller.signal.aborted &&
          next &&
          next.pathname.startsWith(`${base.pathname}assets/`) &&
          next.pathname !== current!.pathname
        ) {
          found = true;
          setAvailable(true);
        }
      } catch {
        // A failed update check says nothing about chat or payment availability.
      } finally {
        clearTimeout(timeout);
        pending = null;
      }
    }

    const onVisible = () => void check();
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    const interval = setInterval(onVisible, CHECK_INTERVAL_MS);
    void check();
    return () => {
      disposed = true;
      clearInterval(interval);
      clearTimeout(timeout);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
      pending?.abort();
    };
  }, []);
  return available;
}
