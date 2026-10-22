// Web Analytics solo en la web publicada; el visor incrustado pertenece a la visita de su ficha.
const dominios = new Set(['chessrival.net', 'www.chessrival.net']);

if (dominios.has(location.hostname) && window.self === window.top
    && !document.querySelector('script[data-cf-beacon]')) {
  const script = document.createElement('script');
  script.type = 'module';
  script.src = 'https://static.cloudflareinsights.com/beacon.min.js';
  script.dataset.cfBeacon = JSON.stringify({ token: '8c879b51eb47403992683dac0baf21ff' });
  document.body.appendChild(script);
}
