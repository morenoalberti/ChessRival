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
  script.src = 'https://pulsemetrics.chessrival.net/script.js?v=0.2.6';
  script.setAttribute('data-site-id', '5ef07ac4-6c43-4235-938d-dc7ff4375bcd');
  // Count use of features, without recording player names, searches or game data.
  var actions = {cargarBtn:'buscar_rival',megaBtn:'conectar_base_partidas',importarBtn:'abrir_importacion',analizarBtn:'analizar_partidas',guardarBtn:'guardar_partida'};
  Object.keys(actions).forEach(function(id) { var button=document.getElementById(id); if(button)button.setAttribute('data-pulse-event',actions[id]); });
  // Retry a temporary DNS/network failure without adding a second tracker.
  var attempts=0;
  script.onerror=function(){if(attempts++<4)setTimeout(function(){script.remove();document.head.appendChild(script);},Math.min(15000,1000*Math.pow(2,attempts)));};
  document.head.appendChild(script);
})();
