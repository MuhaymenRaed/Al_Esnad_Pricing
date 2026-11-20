import { LOCALE_COOKIE } from "./core";

/** Runs before first paint: applies the saved language direction. */
export const LOCALE_SCRIPT = `(function(){try{var m=document.cookie.match(/(?:^|; )${LOCALE_COOKIE}=(ar|en)/);if(m&&m[1]==="ar"){document.documentElement.lang="ar";document.documentElement.dir="rtl"}}catch(e){}})();`;
