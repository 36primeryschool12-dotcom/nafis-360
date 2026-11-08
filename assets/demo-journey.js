(() => {
  "use strict";

  const batchCount = 3;
  const root = new URL("../", document.currentScript.src).pathname;
  const storageKey = `nafis360:demo-progress:v1:${root}`;
  const emptyProgress = { pre: false, batches: 0, post: false };

  function progress() {
    try {
      const data = JSON.parse(window.localStorage.getItem(storageKey));
      if (data?.pre !== true) return { ...emptyProgress };
      const batches = Number.isInteger(data.batches)
        ? Math.max(0, Math.min(batchCount, data.batches))
        : 0;
      return { pre: true, batches, post: batches === batchCount && data.post === true };
    } catch {
      return { ...emptyProgress };
    }
  }

  function canOpen(stage, state = progress()) {
    if (stage === "training") return state.pre;
    if (stage === "post") return state.batches === batchCount;
    return stage === "pre";
  }

  function complete(stage, batchIndex) {
    const state = progress();
    if (!canOpen(stage, state)) return false;

    if (stage === "pre") state.pre = true;
    if (stage === "training") {
      if (!Number.isInteger(batchIndex) || batchIndex < 0 ||
          batchIndex >= batchCount || batchIndex > state.batches) return false;
      state.batches = Math.max(state.batches, batchIndex + 1);
    }
    if (stage === "post") state.post = true;

    try {
      window.localStorage.setItem(storageKey, JSON.stringify(state));
      return true;
    } catch {
      return false;
    }
  }

  window.NafisDemoJourney = { batchCount, progress, canOpen, complete };

  const stageLinks = document.querySelectorAll("[data-journey-stage]");
  function updateLinks() {
    const state = progress();
    for (const link of stageLinks) {
      const unlocked = canOpen(link.dataset.journeyStage, state);
      if (unlocked) {
        link.setAttribute("href", link.dataset.path);
        link.removeAttribute("aria-disabled");
      } else {
        link.removeAttribute("href");
        link.setAttribute("aria-disabled", "true");
      }
      link.textContent = unlocked ? link.dataset.openLabel : link.dataset.lockedLabel;
    }
  }

  if (stageLinks.length) {
    updateLinks();
    window.addEventListener("pageshow", updateLinks);
    window.addEventListener("storage", updateLinks);
  }
})();
