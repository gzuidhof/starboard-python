import { sleepPath } from "./service-worker-utils";

// TODO: Maybe starboard should provide this service worker for all plugins.
// At the same time, I should note that this is a pretty horrible hack
// Features
// - Blocking web workers
// - Enable SharedArrayBuffer
// Note
// Please only install this service worker for a very granular, local scope.
// Otherwise you might block other service workers

// Typescript isn't as smart as it should be
const sw: ServiceWorkerGlobalScope & typeof globalThis = self as any;

const enableCrossOriginIsolated = false;

sw.addEventListener("install", function (event) {
  sw.skipWaiting();
});

sw.addEventListener("activate", (event) => {
  event.waitUntil(sw.clients.claim());
});

sw.addEventListener("fetch", function (event) {
  const url = new URL(event.request.url);
  if (url.pathname.endsWith(sleepPath)) {
    // Source https://glitch.com/edit/#!/sleep-sw?path=sw.js%3A17%3A3
    let duration = +(url.searchParams.get("duration") || 1);
    // TODO: This needs to be able to return some info as well
    event.respondWith(sleep(duration).then(() => new Response(null, { status: 304 })));
    return;
  }

  // A rather special hack. The service worker intercepts everything and adds custom headers
  // Disabled by default
  if (enableCrossOriginIsolated) {
    event.respondWith(
      fetch(event.request).then(function (response) {
        const newHeaders = new Headers(response.headers);
        newHeaders.append("Cross-Origin-Embedder-Policy", "require-corp");
        newHeaders.append("Cross-Origin-Opener-Policy", "same-origin");

        const moddedResponse = new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: newHeaders,
        });

        return moddedResponse;
      })
    );
  }
});

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
