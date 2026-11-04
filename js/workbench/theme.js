try {
  document.documentElement.classList.toggle(
    "dark",
    (localStorage.getItem("tablenest-theme") || "light") === "dark",
  );
} catch {}
