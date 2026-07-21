/**
 * AROME DATA LOADER
 * -----------------
 * Essaie de charger les vraies données produites par le backend
 * (backend/server.py, qui décode les GRIB2 AROME téléchargés via
 * l'API Météo-France). Si le backend n'est pas joignable ou n'a pas
 * encore de données en cache, on bascule silencieusement sur le
 * générateur factice (data-mock.js) pour que l'UI reste utilisable.
 *
 * Contrat consommé par le reste du front (app.js, particles.js) :
 *   window.AROME_READY   -> Promise résolue quand window.AROME est prêt
 *   window.AROME.sample(layer, lat, lon, stepIndex)
 *   window.AROME.{BOUNDS, NX, NY, STEPS, N_STEPS, RUN_TIME, LOCATIONS, isMock}
 */

(function(){

  const META_URL = 'data/meta.json';
  const STEP_URL = (runId, step) => `data/${encodeURIComponent(runId)}/${step}.json`;

  function lerp(a,b,t){ return a+(b-a)*t; }

  function buildFromRealMeta(meta, fields){
    const BOUNDS = meta.bounds;
    const NX = meta.nx, NY = meta.ny;
    const STEPS = meta.steps;
    const RUN_TIME = new Date(meta.run);
    const LOCATIONS = meta.locations && meta.locations.length ? meta.locations : DEFAULT_LOCATIONS;

    function gridIndexFor(lat, lon){
      const fx = (lon-BOUNDS.lonMin)/(BOUNDS.lonMax-BOUNDS.lonMin) * (NX-1);
      const fy = (BOUNDS.latMax-lat)/(BOUNDS.latMax-BOUNDS.latMin) * (NY-1);
      return {fx: Math.min(Math.max(fx,0),NX-1-0.0001), fy: Math.min(Math.max(fy,0),NY-1-0.0001)};
    }
    function bilinear(arr, fx, fy){
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const x1 = Math.min(x0+1, NX-1), y1 = Math.min(y0+1, NY-1);
      const tx = fx-x0, ty = fy-y0;
      const v00 = arr[y0*NX+x0], v10 = arr[y0*NX+x1];
      const v01 = arr[y1*NX+x0], v11 = arr[y1*NX+x1];
      return lerp(lerp(v00,v10,tx), lerp(v01,v11,tx), ty);
    }
    function sampleAtIndex(layer, lat, lon, i){
      const field = fields[i];
      const {fx,fy} = gridIndexFor(lat,lon);
      if(layer==='wind'){
        return {u: bilinear(field.u, fx, fy), v: bilinear(field.v, fx, fy)};
      }
      if(layer==='gust') return bilinear(field.gust, fx, fy);
      if(layer==='temp') return bilinear(field.temp, fx, fy);
      if(layer==='precip') return bilinear(field.precip, fx, fy);
      return null;
    }
    function sample(layer, lat, lon, stepIndex){
      const i0 = Math.max(0, Math.min(fields.length-1, Math.floor(stepIndex)));
      const i1 = Math.min(fields.length-1, i0+1);
      const t = Math.max(0, Math.min(1, stepIndex-i0));

      if(layer==='wind'){
        const a = sampleAtIndex('wind', lat, lon, i0);
        const b = sampleAtIndex('wind', lat, lon, i1);
        // Interpolation sur les composantes (u,v) plutôt que sur
        // vitesse/direction directement, pour éviter les artefacts de
        // rotation quand la direction change beaucoup entre deux heures.
        const uu = lerp(a.u, b.u, t), vv = lerp(a.v, b.v, t);
        const speed = Math.sqrt(uu*uu+vv*vv);
        const dirDeg = (Math.atan2(uu,vv)*180/Math.PI + 180) % 360;
        return {u:uu, v:vv, speedMs:speed, speedKt: speed*1.94384, dirDeg};
      }
      const v0 = sampleAtIndex(layer, lat, lon, i0);
      const v1 = sampleAtIndex(layer, lat, lon, i1);
      const v = lerp(v0, v1, t);
      return layer==='gust' ? v*1.94384 : v;
    }
    function nearestLocationName(lat, lon){
      let best=null, bd=Infinity;
      for(const l of LOCATIONS){
        const d = Math.hypot(l.lat-lat, l.lon-lon);
        if(d<bd){bd=d; best=l;}
      }
      return bd < 0.35 ? best.name : null;
    }

    return {
      BOUNDS, NX, NY, STEPS, STEP_HOURS: STEPS[1]-STEPS[0], N_STEPS: STEPS.length, RUN_TIME,
      FIELDS: fields, LOCATIONS,
      sample, gridIndexFor, bilinear, nearestLocationName,
      isMock:false,
    };
  }

  const DEFAULT_LOCATIONS = [
    {name:"Ajaccio", lat:41.9192, lon:8.7386},
    {name:"Bastia", lat:42.7028, lon:9.4508},
    {name:"Calvi", lat:42.5674, lon:8.7570},
    {name:"Bonifacio", lat:41.3888, lon:9.1596},
    {name:"Porto-Vecchio", lat:41.5910, lon:9.2795},
    {name:"Corte", lat:42.3059, lon:9.1500},
  ];

  async function tryLoadReal(){
    const metaResp = await fetch(META_URL, {cache:'no-store'});
    if(!metaResp.ok) throw new Error('meta.json introuvable (backend pas encore lancé / pas de run en cache)');
    const meta = await metaResp.json();
    if(!meta.steps || !meta.steps.length) throw new Error('meta.json ne contient aucune échéance');

    const runId = meta.run_id || meta.run;
    const fields = await Promise.all(meta.steps.map(async (step)=>{
      const r = await fetch(STEP_URL(runId, step), {cache:'no-store'});
      if(!r.ok) throw new Error(`données manquantes pour l'échéance +${step}h`);
      const j = await r.json();
      return {
        u:new Float32Array(j.u), v:new Float32Array(j.v),
        gust:new Float32Array(j.gust), temp:new Float32Array(j.temp), precip:new Float32Array(j.precip),
        hour:step,
      };
    }));

    return buildFromRealMeta(meta, fields);
  }

  window.AROME_READY = (async function(){
    try{
      const real = await tryLoadReal();
      window.AROME = real;
      console.info('[AROME] données réelles chargées — run', real.RUN_TIME.toISOString());
    } catch(err){
      console.warn('[AROME] backend indisponible, bascule sur les données factices :', err.message);
      window.AROME = window.AROME_MOCK_BUILD();
    }
  })();

})();
