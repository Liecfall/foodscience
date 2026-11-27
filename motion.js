const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let animeWaapi = null;
let categoryFeedback = null;

window.FoodLabMotion = {
  selectCategory(button) {
    if (!animeWaapi || reducedMotion.matches || !button) return;
    categoryFeedback?.cancel();
    categoryFeedback = animeWaapi.animate(button, {
      transform: ["scale(.97)", "scale(1)"],
      duration: 220,
      ease: "outExpo"
    });
  }
};

if (!reducedMotion.matches && document.querySelector(".hero-page-left")) {
  const animeModule = await import("https://cdn.jsdelivr.net/npm/animejs@4.5.0/dist/modules/waapi/index.js/+esm").catch(() => null);
  if (animeModule && !reducedMotion.matches) {
    animeWaapi = animeModule.waapi;
    const leftPage = document.querySelector(".hero-page-left");
    const rightPage = document.querySelector(".hero-page-right");
    const food = document.querySelector(".hero-food-assembly");

    animeWaapi.animate(leftPage, {
      transform: ["scaleX(.94)", "scaleX(1)"],
      opacity: [.78, 1],
      duration: 640,
      ease: "outExpo"
    });
    animeWaapi.animate(rightPage, {
      transform: ["scaleX(.94)", "scaleX(1)"],
      opacity: [.78, 1],
      duration: 640,
      delay: 70,
      ease: "outExpo"
    });
    animeWaapi.animate(food, {
      transform: ["translateY(7px) scale(.97)", "translateY(0) scale(1)"],
      opacity: [0, 1],
      duration: 520,
      delay: 150,
      ease: "outExpo"
    });
  }
}
