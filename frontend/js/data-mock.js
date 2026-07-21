/**
 * AROME MOCK DATA (secours)
 * -------------------------
 * Générateur de champs météo factices, utilisé UNIQUEMENT si le backend
 * réel (backend/server.py, qui sert les vraies données AROME décodées
 * des GRIB2) n'est pas joignable — voir js/data.js pour la logique de
 * bascule automatique. Ça permet à l'UI de toujours fonctionner, même
 * sans backend démarré, pendant le développement du front.
 */

window.AROME_MOCK_BUILD = function(){

  // ---- Domaine géographique (Corse + Méditerranée proche) ----
  const BOUNDS = { latMin: 41.0, latMax: 43.4, lonMin: 7.3, lonMax: 9.9 };
  const NX = 26, NY = 22;

  // ---- Échéances : run de 00Z, sorties 3-horaires jusqu'à 48h ----
  const STEP_HOURS = 3;
  const N_STEPS = 17; // 0..48h
  const now = new Date();
  const RUN_TIME = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));

  const STEPS = Array.from({length:N_STEPS}, (_,i)=> i*STEP_HOURS);

  // ---- Bruit pseudo-aléatoire déterministe (somme de sinusoïdes) ----
  function noise2(x, y, seed){
    return (
      Math.sin(x*1.7 + seed) * Math.cos(y*1.3 - seed*0.7) +
      Math.sin(x*0.6 - y*0.9 + seed*1.9) * 0.6 +
      Math.sin((x+y)*2.3 + seed*3.1) * 0.35
    ) / 1.95;
  }

  function lerp(a,b,t){ return a+(b-a)*t; }

  // ---- Quelques lieux repères pour la recherche ----
  const LOCATIONS = [
    {name:"Ajaccio", lat:41.9192, lon:8.7386},
    {name:"Bastia", lat:42.7028, lon:9.4508},
    {name:"Calvi", lat:42.5674, lon:8.7570},
    {name:"Bonifacio", lat:41.3888, lon:9.1596},
    {name:"Porto-Vecchio", lat:41.5910, lon:9.2795},
    {name:"Corte", lat:42.3059, lon:9.1500},
    {name:"Île-Rousse", lat:42.6333, lon:8.9333},
    {name:"Propriano", lat:41.6769, lon:8.9036},
    {name:"Golfe de Sagone", lat:42.1180, lon:8.7000},
    {name:"Bouches de Bonifacio", lat:41.3000, lon:9.2000},
  ];

  // ---- Construit le champ complet pour une échéance donnée ----
  function buildField(stepIndex){
    const hour = STEPS[stepIndex];
    const t = hour / 48; // 0..1 progression sur la fenêtre de prévision
    const u = new Float32Array(NX*NY);
    const v = new Float32Array(NX*NY);
    const gust = new Float32Array(NX*NY);
    const temp = new Float32Array(NX*NY);
    const precip = new Float32Array(NX*NY);

    // Un "système" qui glisse lentement du NO vers le SE sur 48h (ex: épisode de vent d'ouest à sirocco)
    const systemAngleStart = 300; // degrés, d'où souffle le vent (convention météo) au début
    const systemAngleEnd = 150;
    const systemAngle = lerp(systemAngleStart, systemAngleEnd, t);
    const rad = systemAngle * Math.PI/180;
    const baseU = Math.sin(rad) * -1; // composante vers laquelle ça souffle
    const baseV = Math.cos(rad) * -1;

    // Intensité générale : monte puis redescend (passage d'un coup de vent)
    const intensityCurve = 0.55 + 0.45*Math.sin(Math.PI * Math.min(t*1.4,1));

    const localHour = (RUN_TIME.getUTCHours() + hour) % 24;
    const diurnal = Math.sin(((localHour-6)/24) * Math.PI*2); // pic ~14h, creux ~2h

    for(let j=0;j<NY;j++){
      for(let i=0;i<NX;i++){
        const idx = j*NX+i;
        const lat = lerp(BOUNDS.latMax, BOUNDS.latMin, j/(NY-1)); // j=0 -> nord
        const lon = lerp(BOUNDS.lonMin, BOUNDS.lonMax, i/(NX-1));

        const n1 = noise2(i*0.35, j*0.35, t*6.0);
        const n2 = noise2(i*0.9+50, j*0.9+50, t*4.0+2.0);

        // Renforcement du vent dans les zones "canalisées" (caps, détroits) -> variation spatiale
        const channel = 1 + 0.35*Math.max(0, Math.sin((lat-41.0)*3.1)) ;

        let speed = (7 + 9*intensityCurve*channel) + n1*3.2;
        speed = Math.max(1, speed);

        const dirJitter = n2 * 28; // degrés de variabilité locale
        const localRad = rad + dirJitter*Math.PI/180;
        const uu = Math.sin(localRad) * -speed;
        const vv = Math.cos(localRad) * -speed;

        u[idx] = uu;
        v[idx] = vv;
        gust[idx] = speed * (1.35 + 0.25*Math.abs(n1)) ;

        // Température : gradient sud->nord doux + cycle diurne + bruit
        const latGrad = lerp(24, 19, (lat-BOUNDS.latMin)/(BOUNDS.latMax-BOUNDS.latMin));
        temp[idx] = latGrad + diurnal*3.2 + n1*1.1 - t*1.5; // léger refroidissement sur 48h (arrivée d'air plus frais)

        // Précipitations : bandes qui traversent le domaine avec le "système"
        const bandPos = (lon - BOUNDS.lonMin) - t*3.2 + n2*0.4;
        const band = Math.exp(-Math.pow(bandPos-1.0,2)*2.2);
        precip[idx] = Math.max(0, band*6.5*intensityCurve + (n1>0.6? n1*2:0));
      }
    }
    return {u,v,gust,temp,precip, hour};
  }

  // ---- Cache : on précalcule tous les pas une fois ----
  const FIELDS = STEPS.map((_,i)=> buildField(i));

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
    const field = FIELDS[i];
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
    const i0 = Math.max(0, Math.min(FIELDS.length-1, Math.floor(stepIndex)));
    const i1 = Math.min(FIELDS.length-1, i0+1);
    const t = Math.max(0, Math.min(1, stepIndex-i0));

    if(layer==='wind'){
      const a = sampleAtIndex('wind', lat, lon, i0);
      const b = sampleAtIndex('wind', lat, lon, i1);
      const uu = lerp(a.u, b.u, t), vv = lerp(a.v, b.v, t);
      const speed = Math.sqrt(uu*uu+vv*vv);
      const dirDeg = (Math.atan2(uu,vv)*180/Math.PI + 180) % 360; // direction d'où souffle le vent
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
    BOUNDS, NX, NY, STEPS, STEP_HOURS, N_STEPS, RUN_TIME,
    FIELDS, LOCATIONS,
    sample, gridIndexFor, bilinear, nearestLocationName,
    isMock: true,
  };
};
