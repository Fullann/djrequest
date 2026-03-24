(() => {
  function getCookie(name) {
    const cookies = document.cookie ? document.cookie.split("; ") : [];
    for (const cookie of cookies) {
      const [key, ...valueParts] = cookie.split("=");
      if (key === name) {
        return decodeURIComponent(valueParts.join("="));
      }
    }
    return "";
  }

  const originalFetch = window.fetch.bind(window);

  window.fetch = (input, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    const isSafeMethod = method === "GET" || method === "HEAD" || method === "OPTIONS";

    if (isSafeMethod) {
      return originalFetch(input, init);
    }

    const headers = new Headers(init.headers || {});
    const csrfToken = getCookie("XSRF-TOKEN");

    if (csrfToken && !headers.has("x-csrf-token")) {
      headers.set("x-csrf-token", csrfToken);
    }

    return originalFetch(input, {
      ...init,
      headers,
    });
  };
})();
