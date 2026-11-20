/* Cloudflare Web Analytics: identificador público del sitio, sin claves de administración. */
(function () {
  "use strict";
  if (location.protocol !== "https:" || ["chessrival.net", "www.chessrival.net"].indexOf(location.hostname) < 0) return;
  if (navigator.doNotTrack === "1" || window.doNotTrack === "1" || navigator.globalPrivacyControl === true) return;
  if (window.__chessrivalAnalytics) return;
  // Cloudflare > Web Analytics > chessrival.net > Gestionar sitio > data-cf-beacon.token.
  var token = "906b3eadbb4d456e87c97a4366f1590a";
  if (!/^[a-f0-9]{32}$/i.test(token)) return;
  if (document.querySelector('script[data-cf-beacon], script[src^="https://static.cloudflareinsights.com/beacon.min.js"]')) return;

  window.__chessrivalAnalytics = true;
  var script = document.createElement("script");
  script.type = "module";
  script.src = "https://static.cloudflareinsights.com/beacon.min.js";
  script.setAttribute("data-cf-beacon", JSON.stringify({ token: token }));
  document.head.appendChild(script);
})();
