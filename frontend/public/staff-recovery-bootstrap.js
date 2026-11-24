(() => {
        const current = new URL(window.location.href);
        const isRetiredBuildAsset =
          current.pathname.startsWith("/assets/") ||
          /\.(?:js|mjs|css|wasm)$/i.test(current.pathname);

        if (isRetiredBuildAsset) return;

        [
          "__chalin03_recovery",
          "__chalin03_return",
          "__chalin03_sw_recovery",
          "__chalin03_sw_release",
        ].forEach((name) => current.searchParams.delete(name));

        const returnTarget = `${current.pathname}${current.search}${current.hash}` || "/";
        const recovery = new URL("/", window.location.origin);
        recovery.searchParams.set("__chalin03_recovery", String(Date.now()));
        recovery.searchParams.set("__chalin03_return", returnTarget);
        window.location.replace(recovery.toString());
      })();
