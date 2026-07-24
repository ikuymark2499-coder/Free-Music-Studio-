/* ==========================================================================
   settings.js — Theme, language, animation, blur, cover visibility
   ========================================================================== */

import { getSettings, saveSettings } from "./storage.js";
import { setLanguage, getCurrentLanguage, t } from "./language.js";
import { showToast } from "./ui.js";

const mediaQueryDark = window.matchMedia("(prefers-color-scheme: dark)");

export function applySettingsToDocument(settings) {
  const root = document.documentElement;

  const resolvedTheme = settings.theme === "system" ? (mediaQueryDark.matches ? "dark" : "light") : settings.theme;
  root.setAttribute("data-theme", resolvedTheme);
  root.setAttribute("data-animation", settings.animation ? "on" : "off");
  root.setAttribute("data-blur", settings.blur ? "on" : "off");
  root.setAttribute("data-showcover", settings.showCover ? "on" : "off");
}

export function initSettingsSystem() {
  const settings = getSettings();
  applySettingsToDocument(settings);
  mediaQueryDark.addEventListener("change", () => {
    const latest = getSettings();
    if (latest.theme === "system") applySettingsToDocument(latest);
  });
  return settings;
}

export function updateSetting(key, value) {
  const settings = { ...getSettings(), [key]: value };
  saveSettings(settings);
  applySettingsToDocument(settings);
  return settings;
}

export function initSettingsPage(container) {
  const settings = getSettings();

  const themeButtons = container.querySelectorAll("[data-theme-option]");
  const languageButtons = container.querySelectorAll("[data-lang-option]");
  const animationToggle = container.querySelector("#toggle-animation");
  const blurToggle = container.querySelector("#toggle-blur");
  const coverToggle = container.querySelector("#toggle-showcover");

  function syncThemeButtons() {
    const current = getSettings().theme;
    themeButtons.forEach((btn) => btn.classList.toggle("is-active", btn.dataset.themeOption === current));
  }
  function syncLanguageButtons() {
    const current = getCurrentLanguage();
    languageButtons.forEach((btn) => btn.classList.toggle("is-active", btn.dataset.langOption === current));
  }

  themeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      updateSetting("theme", btn.dataset.themeOption);
      syncThemeButtons();
      showToast(t("toast_settings_saved"));
    });
  });

  languageButtons.forEach((btn) => {
    btn.addEventListener("click", async () => {
      await setLanguage(btn.dataset.langOption);
      syncLanguageButtons();
      showToast(t("toast_settings_saved"));
    });
  });

  animationToggle.checked = settings.animation;
  animationToggle.addEventListener("change", () => {
    updateSetting("animation", animationToggle.checked);
    showToast(t("toast_settings_saved"));
  });

  blurToggle.checked = settings.blur;
  blurToggle.addEventListener("change", () => {
    updateSetting("blur", blurToggle.checked);
    showToast(t("toast_settings_saved"));
  });

  coverToggle.checked = settings.showCover;
  coverToggle.addEventListener("change", () => {
    updateSetting("showCover", coverToggle.checked);
    showToast(t("toast_settings_saved"));
  });

  syncThemeButtons();
  syncLanguageButtons();
}
