(() => {
  const STORAGE_KEY = "chalin03-theme";
  const DARK_CLASS = "c03-dark-mode";
  const root = document.documentElement;

  const stored = window.localStorage.getItem(STORAGE_KEY);
  const dark = stored === "dark";

  root.classList.toggle(DARK_CLASS, dark);
  root.style.colorScheme = dark ? "dark" : "light";

  const mountToggle = () => {
    if (document.getElementById("c03-theme-toggle")) return;

    const button = document.createElement("button");
    button.id = "c03-theme-toggle";
    button.type = "button";
    button.className = "c03-theme-toggle";
    button.setAttribute("aria-pressed", String(dark));
    button.title = dark ? "Switch to light mode" : "Switch to dark mode";

    const render = (isDark) => {
      button.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
      button.setAttribute("aria-pressed", String(isDark));
      button.title = isDark ? "Light mode" : "Dark mode";
      button.innerHTML = `<span aria-hidden="true">${isDark ? "☀" : "☾"}</span>`;
    };

    render(dark);

    button.addEventListener("click", () => {
      const nextDark = !root.classList.contains(DARK_CLASS);
      root.classList.toggle(DARK_CLASS, nextDark);
      root.style.colorScheme = nextDark ? "dark" : "light";
      window.localStorage.setItem(STORAGE_KEY, nextDark ? "dark" : "light");
      render(nextDark);
    });

    document.body.appendChild(button);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountToggle, { once: true });
  } else {
    mountToggle();
  }
})();
