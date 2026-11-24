(() => {
        try {
          const restoreKey = "chalin03-theme-restore-20261006-v1";
          if (window.localStorage.getItem(restoreKey) !== "1") {
            window.localStorage.setItem("chalin03-theme", "light");
            window.localStorage.setItem(restoreKey, "1");
          }

          const stored = window.localStorage.getItem("chalin03-theme");
          const mode =
            stored === "dark" || stored === "light" || stored === "system"
              ? stored
              : "light";
          const systemDark =
            window.matchMedia?.("(prefers-color-scheme: dark)")?.matches === true;
          const resolved =
            mode === "system" ? (systemDark ? "dark" : "light") : mode;
          document.documentElement.dataset.chalinTheme = resolved;
          document.documentElement.dataset.chalinThemeMode = mode;
          document.documentElement.style.colorScheme = resolved;
        } catch {
          document.documentElement.dataset.chalinTheme = "light";
          document.documentElement.dataset.chalinThemeMode = "light";
          document.documentElement.style.colorScheme = "light";
        }
      })();
