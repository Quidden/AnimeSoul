const sections = [
  ".section-head",
  ".home-library-heading",
  ".catalog-shelf-heading",
  ".anime-synopsis",
  ".franchise-parts-head",
  ".home-popular-row",
  ".anime-information",
  ".anime-characters > h2",
  ".anime-characters > p",
  ".anime-viewing-summary",
  ".anime-season-rating",
  ".content-section > h2",
  ".content-comments-heading",
  ".profile-section-heading",
  ".character-description",
  ".character-voice-actors",
  ".character-appearances > h2",
  ".subscription-gallery > h2",
  ".subscription-gallery-intro",
  ".subscription-intro",
  ".subscription-plans > h3",
].join(",");
const cards = [
  ".anime-card",
  ".profile-anime-tile",
  ".character-card",
  ".character-appearance",
  ".anime-episode-tile",
  ".franchise-grid > li",
  ".home-watch-card",
  ".content-card",
  ".subscription-shot",
  ".subscription-plan",
  ".anime-screenshot-track > button",
].join(",");
const targets = sections + "," + cards;
const excluded = '[role="dialog"], dialog, .anime-playback, .franchise-map, .franchise-board';

// Enhance the existing server-rendered content without wrappers or scroll handlers.
// Seen state belongs to each DOM element, so progress updates cannot replay it.
export function observeScrollReveals(root: HTMLElement) {
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const pending = new Set<HTMLElement>();
  const entering = new Set<HTMLElement>();
  let observer: IntersectionObserver | undefined;
  let mutations: MutationObserver | undefined;

  function show(element: HTMLElement) {
    observer?.unobserve(element);
    pending.delete(element);
    entering.delete(element);
    element.dataset.scrollRevealState = "shown";
  }
  function register(element: HTMLElement, initial: boolean) {
    if (!root.contains(element) || element.dataset.scrollRevealState || element.closest(excluded))
      return;
    element.dataset.scrollReveal = element.matches(cards) ? "card" : "section";
    if (initial) {
      const rect = element.getBoundingClientRect();
      if (
        rect.top < window.innerHeight &&
        rect.bottom > 0 &&
        rect.left < window.innerWidth &&
        rect.right > 0
      ) {
        show(element);
        return;
      }
    }
    element.dataset.scrollRevealState = "pending";
    pending.add(element);
    observer?.observe(element);
  }
  function scan(node: Element, initial: boolean) {
    if (node instanceof HTMLElement && node.matches(targets)) register(node, initial);
    node.querySelectorAll<HTMLElement>(targets).forEach((element) => register(element, initial));
  }
  function forget(node: Element) {
    if (node instanceof HTMLElement && node.dataset.scrollRevealState) show(node);
    node.querySelectorAll<HTMLElement>("[data-scroll-reveal-state]").forEach(show);
  }
  function stop() {
    observer?.disconnect();
    mutations?.disconnect();
    pending.forEach(show);
    entering.forEach(show);
  }
  function start() {
    if (motion.matches || !("IntersectionObserver" in window)) return;
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const element = entry.target as HTMLElement;
          if (!entry.isIntersecting || !pending.has(element)) continue;
          observer?.unobserve(element);
          pending.delete(element);
          entering.add(element);
          element.dataset.scrollRevealState = "entering";
        }
      },
      { rootMargin: "0px 0px -32px 0px", threshold: 0.06 },
    );
    scan(root, true);
    mutations = new MutationObserver((records) => {
      for (const record of records) {
        record.removedNodes.forEach((node) => {
          if (node instanceof Element && !root.contains(node)) forget(node);
        });
        record.addedNodes.forEach((node) => {
          if (node instanceof Element) scan(node, false);
        });
      }
    });
    mutations.observe(root, { childList: true, subtree: true });
  }
  function preferenceChanged() {
    stop();
    if (!motion.matches) start();
  }
  function animationEnded(event: AnimationEvent) {
    if (event.animationName === "scroll-reveal-rise" && event.target instanceof HTMLElement)
      show(event.target);
  }
  function focused(event: FocusEvent) {
    if (!(event.target instanceof Element)) return;
    const element = event.target.closest<HTMLElement>("[data-scroll-reveal-state]");
    if (element) show(element);
  }
  start();
  motion.addEventListener("change", preferenceChanged);
  root.addEventListener("animationend", animationEnded);
  root.addEventListener("animationcancel", animationEnded);
  root.addEventListener("focusin", focused);
  return () => {
    stop();
    motion.removeEventListener("change", preferenceChanged);
    root.removeEventListener("animationend", animationEnded);
    root.removeEventListener("animationcancel", animationEnded);
    root.removeEventListener("focusin", focused);
  };
}
