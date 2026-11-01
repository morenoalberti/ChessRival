/* Seguimiento propio de PulseMetrics. Configuración pública, sin claves privadas. */
(function () {
  'use strict';
  var domains = ["chessrival.net","www.chessrival.net"];
  if (domains.indexOf(location.hostname) === -1 || location.protocol !== 'https:') return;
  if (navigator.doNotTrack === '1' || navigator.globalPrivacyControl === true) return;
  if (window.__pulseMetricsLoader) return;
  window.__pulseMetricsLoader = true;

  var pending=[];
  function emit(name, options) {
    try { if(window.pulsemetrics)window.pulsemetrics.track(name,options||{});else if(pending.length<100)pending.push([name,options||{}]); } catch(e) {}
  }
  window.pulseTrack=emit;
  window.pulseOperation=function(feature){
    try {
      if(!/^[a-z_]{1,45}$/.test(feature))return function(){};
      var key=crypto.randomUUID(),started=performance.now(),finished=false;
      emit(feature+'_inicio',{operationKey:key});
      return function(status){if(finished||['ok','error','sin_resultados','cancelado'].indexOf(status)<0)return;finished=true;emit(feature+'_'+status,{operationKey:key,durationMs:Math.min(86400000,Math.max(0,Math.round(performance.now()-started)))});};
    } catch(e) { return function(){}; }
  };
  var script = document.createElement('script');
  script.defer = true;
  script.src = 'https://pulsemetrics.chessrival.net/script.js?v=0.3.0';
  script.setAttribute('data-site-id', '5ef07ac4-6c43-4235-938d-dc7ff4375bcd');
  // Count use of features, without recording player names, searches or game data.
  var actions = {cargarBtn:'buscar_rival',megaBtn:'conectar_base_partidas',importarBtn:'abrir_importacion',analizarBtn:'analizar_partidas',guardarBtn:'guardar_partida'};
  Object.keys(actions).forEach(function(id){var button=document.getElementById(id);if(button){button.setAttribute('data-pulse-event',actions[id]);button.setAttribute('data-pulse-visible',actions[id]);}});
  script.onload=function(){pending.splice(0).forEach(function(item){emit(item[0],item[1]);});};
  // Retry a temporary DNS/network failure without adding a second tracker.
  var attempts=0;
  script.onerror=function(){if(attempts++<4)setTimeout(function(){script.remove();document.head.appendChild(script);},Math.min(15000,1000*Math.pow(2,attempts)));};
  document.head.appendChild(script);
})();
