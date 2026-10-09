(() => {
  const requested = new URLSearchParams(location.search).get("scoutTheme");
  const preferred = localStorage.getItem("ps-theme");
  const theme = [requested, preferred].find((value) => value === "light" || value === "dark")
    ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.dataset.theme = theme;
})();
