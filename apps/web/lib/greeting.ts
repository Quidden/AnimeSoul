export const greetingSeenKey = "animesoul:greeted";
export const greetingSettingKey = "animesoul:greeting";
export const greetingQuery = "greeting";

export const greetingWords = [
  { text: "Привет", font: '"Marck Script", "Segoe Script", cursive', hue: 262 },
  { text: "こんにちは", font: '"Yomogi", "Yu Gothic", cursive', hue: 330 },
  { text: "Hello", font: '"Marck Script", "Segoe Script", cursive', hue: 200 },
] as const;

// Only the glyphs of the three words are requested from the font service.
export const greetingFontsHref =
  "https://fonts.googleapis.com/css2?family=Marck+Script&family=Yomogi&display=swap&text=" +
  encodeURIComponent([...new Set(greetingWords.map((word) => word.text).join(""))].join(""));

export function greetingEnabled() {
  try {
    return localStorage.getItem(greetingSettingKey) !== "off";
  } catch {
    return true;
  }
}

export function setGreetingEnabled(enabled: boolean) {
  localStorage.setItem(greetingSettingKey, enabled ? "on" : "off");
}

// Runs before paint: the first visit to the home page (or ?greeting=1) holds the page
// behind the greeting. A timeout releases the page if the greeting script never starts.
export const greetingBootstrap = `(()=>{try{var d=document.documentElement,q=new URLSearchParams(location.search).get(${JSON.stringify(greetingQuery)})==="1";if(!q&&(location.pathname!=="/"||localStorage.getItem(${JSON.stringify(greetingSettingKey)})==="off"||localStorage.getItem(${JSON.stringify(greetingSeenKey)})==="1"))return;d.setAttribute("data-greeting","pending");setTimeout(function(){if(d.getAttribute("data-greeting")==="pending")d.removeAttribute("data-greeting")},6000)}catch(e){}})();`;
