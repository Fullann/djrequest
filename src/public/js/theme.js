(() => {
  const KEY = "djq-theme";

  function getTheme() {
    return localStorage.getItem(KEY) || "dark";
  }

  function applyTheme(theme) {
    document.documentElement.classList.toggle("light", theme === "light");
    localStorage.setItem(KEY, theme);
  }

  function toggleTheme() {
    const next = getTheme() === "dark" ? "light" : "dark";
    applyTheme(next);
    syncButtons();
  }

  function syncButtons() {
    const isLight = getTheme() === "light";
    document.querySelectorAll("[data-theme-toggle]").forEach((btn) => {
      btn.querySelector(".icon-sun")?.classList.toggle("hidden", isLight);
      btn.querySelector(".icon-moon")?.classList.toggle("hidden", !isLight);
      btn.title = isLight ? "Passer en mode sombre" : "Passer en mode clair";
    });
  }

  // Apply immediately to avoid flash
  applyTheme(getTheme());

  window.DJQTheme = { toggle: toggleTheme, apply: applyTheme, get: getTheme };

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-theme-toggle]").forEach((btn) => {
      btn.addEventListener("click", toggleTheme);
    });
    syncButtons();
  });
})();
