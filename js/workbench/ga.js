window.dataLayer = window.dataLayer || [];
window.gtag = function () {
  window.dataLayer.push(arguments);
};
window.gtag("js", new Date());
// A single canonical page view. Never include query text, filenames, database bytes or results.
window.gtag("config", "G-H4VWQ8WK0L", {
  send_page_view: false,
  allow_google_signals: false,
});
window.gtag("event", "page_view", {
  page_location: "https://tablenest.137101.xyz/",
  page_title: "表间 TableNest",
});
