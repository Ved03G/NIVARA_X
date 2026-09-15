export function injectCanvasHook() {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('hook.js');
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
}
