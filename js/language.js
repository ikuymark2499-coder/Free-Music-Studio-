/* ==========================================================================
   language.js — i18n loader & translator
   All UI text lives in /lang/*.json. Nothing is hard-coded in HTML/JS.
   Supports switching language at runtime without reloading the page.
   ========================================================================== */

import { getLanguagePreference, saveLanguagePreference } from "./storage.js";

const SUPPORTED_LANGUAGES = ["th", "en"];
let currentDictionary = {};
let currentLangCode = "th";
const changeListeners = [];

async function loadDictionary(langCode) {
  const response = await fetch(`lang/${langCode}.json`);
  if (!response.ok) throw new Error(`language: failed to load ${langCode}.json`);
  return response.json();
}

export async function initLanguage() {
  currentLangCode = getLanguagePreference();
  if (!SUPPORTED_LANGUAGES.includes(currentLangCode)) currentLangCode = "th";
  currentDictionary = await loadDictionary(currentLangCode);
  document.documentElement.lang = currentLangCode;
  applyTranslations();
}

export async function setLanguage(langCode) {
  if (!SUPPORTED_LANGUAGES.includes(langCode) || langCode === currentLangCode) return;
  currentDictionary = await loadDictionary(langCode);
  currentLangCode = langCode;
  saveLanguagePreference(langCode);
  document.documentElement.lang = langCode;
  applyTranslations();
  changeListeners.forEach((listener) => listener(langCode));
}

export function getCurrentLanguage() {
  return currentLangCode;
}

export function onLanguageChange(listener) {
  changeListeners.push(listener);
}

/**
 * Translate a key, optionally interpolating {placeholders}.
 */
export function t(key, vars) {
  let text = currentDictionary[key];
  if (text === undefined) return key;
  if (vars) {
    Object.entries(vars).forEach(([varName, varValue]) => {
      text = text.replace(new RegExp(`{${varName}}`, "g"), varValue);
    });
  }
  return text;
}

/**
 * Walk the given root (defaults to whole document) and translate every
 * element carrying data-i18n / data-i18n-placeholder / data-i18n-aria attrs.
 */
export function applyTranslations(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.setAttribute("placeholder", t(el.getAttribute("data-i18n-placeholder")));
  });
  root.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria")));
  });
  root.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.setAttribute("title", t(el.getAttribute("data-i18n-title")));
  });
}
