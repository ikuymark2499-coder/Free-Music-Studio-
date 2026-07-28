/* ==========================================================================
   pwa.js — PWA install/update lifecycle.
   -----------------------------------------------------------------------
   Wires up:
   1. Service worker registration (app-shell caching, see /sw.js).
   2. The "Add to Home Screen" install prompt (Android/desktop Chrome),
      exposed to the Settings page as an "Install app" row.
   3. An "update available" toast when a new version has been cached and
      is ready to take over.

   iOS Safari doesn't fire beforeinstallprompt — there's no programmatic
   install there, only the native Share -> "Add to Home Screen" flow — so
   isInstallable() simply stays false on iOS and the UI can point users to
   that flow with instructions instead (see isIOS()/isStandalone() below).
   ========================================================================== */

import { showToast } from "../ui.js";
import { t } from "../language.js";

let deferredInstallPrompt = null;
let updateReadyCallback = null;

// Multiple UI rows (native install row, APK fallback row, ...) all need to
// re-render whenever installability changes. Kept as a simple listener list
// so bindInstallRow and bindApkFallbackRow can both subscribe without
// stepping on each other — no new event system, just a small fan-out on top
// of the existing beforeinstallprompt/appinstalled wiring below.
const installabilityListeners = [];

function notifyInstallabilityChange(canInstall) {
  installabilityListeners.forEach((listener) => listener(canInstall));
}

/* ---------------------------------------------------------------------- */
/* Service worker registration                                            */
/* ---------------------------------------------------------------------- */

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("./sw.js");

      registration.addEventListener("updatefound", () => {
        const installingWorker = registration.installing;
        if (!installingWorker) return;
        installingWorker.addEventListener("statechange", () => {
          const hasExistingController = Boolean(navigator.serviceWorker.controller);
          if (installingWorker.state === "installed" && hasExistingController) {
            // A new version was precached and is waiting — surface it.
            if (updateReadyCallback) {
              updateReadyCallback(registration);
            } else {
              showToast(t("pwa_update_ready") || "Update ready — refresh to apply");
            }
          }
        });
      });
    } catch (err) {
      console.error("pwa: service worker registration failed", err);
    }
  });
}

/** Register a callback fired when a new SW version has installed and is
 *  waiting to activate. Caller decides how to prompt the user (toast,
 *  banner, etc.) and can call applyUpdate() to activate it immediately. */
export function onUpdateReady(callback) {
  updateReadyCallback = callback;
}

/** Tell the waiting service worker to activate now, then reload once it
 *  takes control. Safe to call even if there's nothing waiting. */
export function applyUpdate(registration) {
  const waiting = registration?.waiting;
  if (!waiting) {
    window.location.reload();
    return;
  }
  waiting.postMessage({ type: "SKIP_WAITING" });
  navigator.serviceWorker.addEventListener(
    "controllerchange",
    () => window.location.reload(),
    { once: true }
  );
}

/* ---------------------------------------------------------------------- */
/* Install prompt (Android / desktop Chrome, Edge, etc.)                  */
/* ---------------------------------------------------------------------- */

export function initInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    notifyInstallabilityChange(true);
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    notifyInstallabilityChange(false);
    showToast(t("pwa_install_success") || "Installed! Find it on your home screen.");
  });
}

export function isInstallable() {
  return Boolean(deferredInstallPrompt);
}

export function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true // iOS Safari
  );
}

export function isIOS() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

/** Trigger the native install prompt. Resolves to the user's choice
 *  ("accepted" | "dismissed"), or null if there's no prompt available. */
export async function promptInstall() {
  if (!deferredInstallPrompt) return null;
  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  notifyInstallabilityChange(false);
  return outcome;
}

/** Wire up a "Install app" settings row: shows/hides it based on whether
 *  installing is currently possible, and hooks the button to promptInstall(). */
export function bindInstallRow({ row, button, iosHint }) {
  function render() {
    if (isStandalone()) {
      row?.classList.add("is-hidden");
      return;
    }
    if (isInstallable()) {
      row?.classList.remove("is-hidden");
      iosHint?.classList.add("is-hidden");
      return;
    }
    if (isIOS()) {
      row?.classList.remove("is-hidden");
      iosHint?.classList.remove("is-hidden");
      return;
    }
    row?.classList.add("is-hidden");
  }

  installabilityListeners.push(render);
  render();

  button?.addEventListener("click", async () => {
    if (isIOS()) {
      iosHint?.classList.remove("is-hidden");
      return;
    }
    await promptInstall();
  });
}

/* ---------------------------------------------------------------------- */
/* APK fallback (Android browsers that don't support beforeinstallprompt) */
/* ---------------------------------------------------------------------- */

/** True whenever downloading the APK makes sense as an option: the app
 *  isn't already installed/standalone, and it's not iOS (no APK exists for
 *  iOS — that platform uses its own Share -> "Add to Home Screen" flow
 *  instead). Unlike the native install button, this does NOT depend on
 *  isInstallable() — it stays available even when the PWA install prompt
 *  also works, so people who specifically want the APK can still get it;
 *  the two options are meant to sit side by side. */
export function shouldShowApkFallback() {
  return !isStandalone() && !isIOS();
}

/** Wire up the "Download APK" settings row: shows/hides it based on
 *  shouldShowApkFallback(), re-checking on every installability change so it
 *  stays in sync with the native install row (e.g. hides itself once the
 *  app is actually installed). */
export function bindApkFallbackRow({ row, hint }) {
  function render() {
    const show = shouldShowApkFallback();
    row?.classList.toggle("is-hidden", !show);
    hint?.classList.toggle("is-hidden", !show);
  }

  installabilityListeners.push(render);
  render();
}

/** Register an extra callback to re-run whenever installability changes
 *  (beforeinstallprompt fires, appinstalled fires, promptInstall resolves).
 *  Lets callers keep other bits of UI (e.g. a shared section wrapper) in
 *  sync without duplicating the install/appinstalled listeners themselves. */
export function onInstallabilityChange(callback) {
  installabilityListeners.push(callback);
  callback();
}
