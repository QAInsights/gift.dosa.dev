/* Gift Cabinet motion collection · lifecycle controller. One-shot entrances:
   play once on first visibility, pause offscreen or when hidden, never replay
   within a session, and stay static under reduced motion. No timers or loops. */
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

function liveAnimations(figure: HTMLElement): Animation[] {
  try {
    return figure.getAnimations({ subtree: true }).filter((a) => a.playState !== "finished");
  } catch {
    return [];
  }
}

function seenInSession(scene: string): boolean {
  try {
    return sessionStorage.getItem(`gc-motion:${scene}`) === "1";
  } catch {
    return false;
  }
}

function markSeen(scene: string): void {
  try {
    sessionStorage.setItem(`gc-motion:${scene}`, "1");
  } catch {}
}

function arm(figure: HTMLElement): void {
  const scene = figure.dataset.scene ?? "figure";
  const play = (): void => {
    if (reduceMotion.matches || seenInSession(scene)) return;
    markSeen(scene);
    figure.classList.add("motion-run");
  };
  const trigger = new IntersectionObserver(
    (entries, observer) => {
      if (entries[0]?.isIntersecting) {
        observer.disconnect();
        play();
      }
    },
    { threshold: 0.1 },
  );
  trigger.observe(figure);
  const visibility = new IntersectionObserver((entries) => {
    const visible = entries[0]?.isIntersecting ?? true;
    for (const animation of liveAnimations(figure)) {
      if (visible && !document.hidden) animation.play();
      else animation.pause();
    }
  });
  visibility.observe(figure);
  document.addEventListener("visibilitychange", () => {
    for (const animation of liveAnimations(figure)) {
      if (document.hidden) animation.pause();
      else animation.play();
    }
  });
  reduceMotion.addEventListener("change", () => {
    if (reduceMotion.matches) figure.classList.remove("motion-run");
  });
}

function initMotion(): void {
  if (document.documentElement.hasAttribute("data-motion")) return;
  document.documentElement.setAttribute("data-motion", "");
  for (const figure of document.querySelectorAll<HTMLElement>(".motion-fig[data-scene]")) arm(figure);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initMotion, { once: true });
} else {
  initMotion();
}
