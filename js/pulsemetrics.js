/* Seguimiento propio de PulseMetrics. Configuración pública, sin claves privadas. */
(function () {
  'use strict';
  var domains = ["chessrival.net","www.chessrival.net"];
  if (domains.indexOf(location.hostname) === -1 || location.protocol !== 'https:') return;
  if (navigator.doNotTrack === '1' || navigator.globalPrivacyControl === true) return;
  if (window.__pulseMetricsLoader) return;
  window.__pulseMetricsLoader = true;
  var script = document.createElement('script');
  script.defer = true;
  script.src = 'https://pulsemetrics.chessrival.net/script.js';
  script.setAttribute('data-site-id', '5ef07ac4-6c43-4235-938d-dc7ff4375bcd');
  document.head.appendChild(script);
})();
