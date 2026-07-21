(function(){

  window.AROME_READY.then(runApp);

  function runApp(){

  const A = window.AROME;
  const B = A.BOUNDS;

  // Reflète dans le bandeau si on affiche des données réelles ou de secours
  const badge = document.querySelector('.data-badge');
  if(badge){
    if(A.isMock){
      badge.innerHTML = '<span class="dot"></span> DONNÉES FACTICES — BACKEND INDISPONIBLE';
    } else {
      badge.innerHTML = '<span class="dot"></span> AROME — RUN RÉEL';
      badge.style.background = 'rgba(79,224,212,0.12)';
      badge.style.borderColor = 'rgba(79,224,212,0.35)';
      badge.style.color = 'var(--accent-wind)';
      const dot = badge.querySelector('.dot');
      if(dot){ dot.style.background='var(--accent-wind)'; dot.style.boxShadow='0 0 6px var(--accent-wind)'; }
    }
  }

  // ============ CARTE ============
  const map = L.map('map', {
    zoomControl:false,
    minZoom:6,
    maxZoom:12,
    attributionControl:true,
  }).setView([42.15, 9.0], 8);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    subdomains:'abcd',
    maxZoom:19,
    attribution:'&copy; OpenStreetMap &copy; CARTO'
  }).addTo(map);

  // ============ ÉCHELLES DE COULEUR ============
  function colorForWindKt(kt){
    const stops = [
      [0,   [58, 82, 105]],
      [8,   [58,140,170]],
      [16,  [79,224,212]],
      [24,  [242,200,90]],
      [32,  [242,166,90]],
      [42,  [230,96,80]],
      [55,  [176,68,168]],
    ];
    return colorFromStops(stops, kt);
  }
  function colorForTemp(c){
    const stops = [
      [8,  [90,155,255]],
      [15, [79,224,212]],
      [21, [140,214,120]],
      [26, [242,200,90]],
      [31, [242,140,80]],
      [36, [230,80,70]],
    ];
    return colorFromStops(stops, c);
  }
  function colorForPrecip(mm){
    const stops = [
      [0,   [16,30,48,0]],
      [0.3, [78,140,255,90]],
      [2,   [78,110,255,150]],
      [5,   [130,90,240,190]],
      [9,   [190,70,210,220]],
    ];
    return colorFromStopsAlpha(stops, mm);
  }
  function colorFromStops(stops, v){
    for(let i=0;i<stops.length-1;i++){
      const [v0,c0]=stops[i], [v1,c1]=stops[i+1];
      if(v>=v0 && v<=v1){
        const t=(v-v0)/(v1-v0);
        const c = c0.map((c,i)=>Math.round(c+(c1[i]-c)*t));
        return `rgba(${c[0]},${c[1]},${c[2]},0.65)`;
      }
    }
    const last = stops[stops.length-1][1];
    return v < stops[0][0] ? `rgba(${stops[0][1].join(',')},0.5)` : `rgba(${last.join(',')},0.7)`;
  }
  function colorFromStopsAlpha(stops, v){
    for(let i=0;i<stops.length-1;i++){
      const [v0,c0]=stops[i], [v1,c1]=stops[i+1];
      if(v>=v0 && v<=v1){
        const t=(v-v0)/(v1-v0);
        const r=Math.round(c0[0]+(c1[0]-c0[0])*t);
        const g=Math.round(c0[1]+(c1[1]-c0[1])*t);
        const b=Math.round(c0[2]+(c1[2]-c0[2])*t);
        const a=(c0[3]+(c1[3]-c0[3])*t)/255;
        return `rgba(${r},${g},${b},${a.toFixed(2)})`;
      }
    }
    const last = stops[stops.length-1][1];
    return `rgba(${last[0]},${last[1]},${last[2]},${(last[3]/255).toFixed(2)})`;
  }

  // ============ CALQUE COULEUR (canvas overlay) ============
  // Attaché au <body>, PAS à l'intérieur de #map : un enfant de #map ne
  // peut jamais dépasser visuellement #particles (sibling de #map) quel
  // que soit son z-index interne, car #map crée son propre contexte
  // d'empilement CSS. En le sortant au niveau racine, on contrôle
  // l'ordre réel : carte (0) < couleur (1) < particules (2).
  const overlayCanvas = document.createElement('canvas');
  overlayCanvas.style.position='absolute';
  overlayCanvas.style.top='0';
  overlayCanvas.style.right='0';
  overlayCanvas.style.bottom='0';
  overlayCanvas.style.left='0';
  overlayCanvas.style.zIndex='1';
  overlayCanvas.style.pointerEvents='none';
  overlayCanvas.style.mixBlendMode='color';
  document.body.appendChild(overlayCanvas);
  const octx = overlayCanvas.getContext('2d');

  function resizeOverlay(){
    const dpr = Math.min(window.devicePixelRatio||1,2);
    const rect = document.getElementById('map').getBoundingClientRect();
    overlayCanvas.width = rect.width*dpr;
    overlayCanvas.height = rect.height*dpr;
    overlayCanvas.style.width = rect.width+'px';
    overlayCanvas.style.height = rect.height+'px';
    overlayCanvas.style.top = rect.top+'px';
    overlayCanvas.style.left = rect.left+'px';
    octx.setTransform(dpr,0,0,dpr,0,0);
  }

  const STEP_PX = 7;
  function renderOverlay(){
    const rect = document.getElementById('map').getBoundingClientRect();
    octx.clearRect(0,0,rect.width, rect.height);

    try{
      for(let y=0;y<rect.height;y+=STEP_PX){
        for(let x=0;x<rect.width;x+=STEP_PX){
          const ll = map.containerPointToLatLng([x,y]);
          let color=null;
          if(state.layer==='wind'){
            const s = A.sample('wind', ll.lat, ll.lng, state.step);
            color = colorForWindKt(s.speedKt);
          } else if(state.layer==='gust'){
            const g = A.sample('gust', ll.lat, ll.lng, state.step);
            color = colorForWindKt(g);
          } else if(state.layer==='temp'){
            const tC = A.sample('temp', ll.lat, ll.lng, state.step);
            color = colorForTemp(tC);
          } else if(state.layer==='precip'){
            if(ll.lat<B.latMin-0.5||ll.lat>B.latMax+0.5||ll.lng<B.lonMin-0.5||ll.lng>B.lonMax+0.5) continue;
            const mm = A.sample('precip', ll.lat, ll.lng, state.step);
            if(mm<0.15) continue;
            color = colorForPrecip(mm);
          }
          if(color){
            octx.fillStyle=color;
            octx.fillRect(x,y,STEP_PX+0.5,STEP_PX+0.5);
          }
        }
      }
    } catch(err){
      console.error('[AROME] erreur pendant renderOverlay (calque couleur) :', err);
    }
  }

  // ============ PARTICULES DE VENT ============
  const particleCanvas = document.getElementById('particles');
  const particles = createWindParticleSystem(particleCanvas, map);
  particles.setSampler((lat,lon)=>{
    if(lat<B.latMin-0.3||lat>B.latMax+0.3||lon<B.lonMin-0.3||lon>B.lonMax+0.3) return null;
    const s = A.sample('wind', lat, lon, state.step);
    return {u:s.u, v:s.v, speedKt:s.speedKt};
  });
  particles.setColorFn((kt)=> `rgba(234,240,245,${Math.min(0.85,0.35+kt/45)})`);
  particles.start();

  // ============ ÉTAT ============
  // state.tick = position brute du curseur (unité = 15 minutes)
  // state.step = index d'échéance fractionnaire correspondant (utilisé
  // pour interroger AROME.sample, qui interpole entre deux heures modèle)
  const SUB_PER_STEP = Math.max(1, Math.round((A.STEP_HOURS*60)/15));
  const MAX_TICK = (A.N_STEPS-1)*SUB_PER_STEP;
  const state = { layer:'wind', tick:0, step:0, playing:false, playTimer:null };

  function setLayer(name){
    state.layer = name;
    document.querySelectorAll('.layer-btn').forEach(b=> b.classList.toggle('active', b.dataset.layer===name));
    particles.setActive(name==='wind');
    updateLegend();
    renderOverlay();
  }

  document.querySelectorAll('.layer-btn').forEach(btn=>{
    btn.addEventListener('click', ()=> setLayer(btn.dataset.layer));
  });

  // ============ LÉGENDE ============
  const LEGENDS = {
    wind:  {title:'Vent moyen — nœuds', stops:[0,8,16,24,32,42], colorFn:colorForWindKt},
    gust:  {title:'Rafales — nœuds',    stops:[0,8,16,24,32,42], colorFn:colorForWindKt},
    temp:  {title:'Température — °C',   stops:[8,15,21,26,31,36], colorFn:colorForTemp},
    precip:{title:'Précipitations — mm/h', stops:[0,0.3,2,5,9], colorFn:(v)=>colorForPrecip(v).replace(/,[0-9.]+\)$/,',0.9)')},
  };
  function updateLegend(){
    const L_ = LEGENDS[state.layer];
    document.getElementById('legend-title').textContent = L_.title;
    const grad = L_.stops.map((s,i)=> `${L_.colorFn(s).replace(/rgba\(([^)]+),[^,]+\)/,'rgb($1)')} ${ (i/(L_.stops.length-1))*100 }%`).join(', ');
    const scaleEl = document.getElementById('legend-scale');
    scaleEl.style.background = `linear-gradient(90deg, ${grad})`;
    scaleEl.innerHTML='';
    const ticks = document.createElement('div');
    ticks.className='ticks';
    L_.stops.forEach(s=>{
      const sp = document.createElement('span');
      sp.textContent = Number.isInteger(s)? s : s.toFixed(1);
      ticks.appendChild(sp);
    });
    scaleEl.appendChild(ticks);
  }

  // ============ TIMELINE ============
  const slider = document.getElementById('timeline-slider');
  slider.min = 0;
  slider.max = MAX_TICK;
  slider.step = 1;
  const rulerEl = document.getElementById('timeline-ruler');
  const daynightEl = document.getElementById('timeline-daynight');
  const fineGridEl = document.getElementById('timeline-fine-grid');
  const cursorEl = document.getElementById('timeline-cursor');
  const runValueEl = document.getElementById('run-value');
  const validTimeEl = document.getElementById('valid-time');
  const compassNeedle = document.getElementById('compass-needle');

  runValueEl.textContent = A.RUN_TIME.toISOString().slice(0,13).replace('T',' ')+'Z';

  function buildRuler(){
    rulerEl.innerHTML='';
    let gradStops=[];
    A.STEPS.forEach((h,i)=>{
      const major = h%6===0;
      const validDate = new Date(A.RUN_TIME.getTime()+h*3600*1000);
      const localHour = validDate.getUTCHours();

      if(major){
        const tick = document.createElement('div');
        tick.className = 'tick';
        tick.style.left = ((i/(A.N_STEPS-1))*100)+'%';
        const label = document.createElement('div');
        label.className='tick-hour';
        const hh = String(localHour).padStart(2,'0');
        label.textContent = localHour===0 ? `${hh}h ${String(validDate.getUTCDate()).padStart(2,'0')}/${String(validDate.getUTCMonth()+1).padStart(2,'0')}` : `${hh}h`;
        tick.appendChild(label);
        rulerEl.appendChild(tick);
      }

      const isNight = localHour<6 || localHour>=21;
      const isDusk = localHour===6||localHour===20||localHour===5||localHour===21;
      const pct = (i/(A.N_STEPS-1))*100;
      gradStops.push(`${isNight? 'rgba(10,16,28,0.55)': isDusk? 'rgba(40,50,70,0.4)':'rgba(255,220,150,0.06)'} ${pct}%`);
    });
    daynightEl.style.background = `linear-gradient(90deg, ${gradStops.join(', ')})`;
    updateFineGrid();
  }

  function updateFineGrid(){
    const widthPx = rulerEl.clientWidth || rulerEl.parentElement.clientWidth;
    const pxPerTick = widthPx / MAX_TICK;
    const pxPerHour = pxPerTick * SUB_PER_STEP / A.STEP_HOURS; // repère toutes les heures pleines
    fineGridEl.style.backgroundImage =
      `repeating-linear-gradient(90deg, rgba(255,255,255,0.16) 0px, rgba(255,255,255,0.16) 1px, transparent 1px, transparent ${pxPerHour}px),` +
      `repeating-linear-gradient(90deg, rgba(255,255,255,0.07) 0px, rgba(255,255,255,0.07) 1px, transparent 1px, transparent ${pxPerTick}px)`;
  }
  buildRuler();
  window.addEventListener('resize', updateFineGrid);

  function updateCursor(){
    const pct = state.tick/MAX_TICK;
    cursorEl.style.left = (pct*100)+'%';
    const validDate = new Date(A.RUN_TIME.getTime() + state.step*A.STEP_HOURS*3600*1000);
    const opts = {weekday:'short', day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'};
    const isExactModelStep = (state.tick % SUB_PER_STEP) === 0;
    validTimeEl.textContent = validDate.toLocaleString('fr-FR',{...opts, timeZone:'UTC'})+' UTC'
      + (isExactModelStep ? '' : ' (interpolé)');
  }

  function updateCompass(){
    const center = map.getCenter();
    const s = A.sample('wind', center.lat, center.lng, state.step);
    compassNeedle.style.transformOrigin='20px 20px';
    compassNeedle.style.transform = `rotate(${s.dirDeg}deg)`;
  }

  function setStep(tick){
    state.tick = Math.max(0, Math.min(MAX_TICK, tick));
    state.step = state.tick / SUB_PER_STEP;
    slider.value = state.tick;
    updateCursor();
    updateCompass();
    renderOverlay();
    if(pointState.active) updatePointNow();
  }

  slider.addEventListener('input', (e)=> setStep(parseInt(e.target.value,10)));

  const playBtn = document.getElementById('play-btn');
  const iconPlay = document.getElementById('icon-play');
  const iconPause = document.getElementById('icon-pause');
  playBtn.addEventListener('click', ()=>{
    state.playing = !state.playing;
    iconPlay.classList.toggle('hidden', state.playing);
    iconPause.classList.toggle('hidden', !state.playing);
    if(state.playing){
      state.playTimer = setInterval(()=>{
        let next = state.tick+SUB_PER_STEP;
        if(next>MAX_TICK) next=0;
        setStep(next);
      }, 1100);
    } else {
      clearInterval(state.playTimer);
    }
  });

  // ============ REDRAW SUR MOUVEMENT CARTE ============
  map.on('moveend zoomend', ()=>{ resizeOverlay(); renderOverlay(); updateCompass(); });
  window.addEventListener('resize', ()=>{ resizeOverlay(); renderOverlay(); });

  // ============ RECHERCHE ============
  const searchInput = document.getElementById('search-input');
  const searchResults = document.getElementById('search-results');
  searchInput.addEventListener('input', ()=>{
    const q = searchInput.value.trim().toLowerCase();
    searchResults.innerHTML='';
    if(q.length<1){ searchResults.classList.add('hidden'); return; }
    const matches = A.LOCATIONS.filter(l=> l.name.toLowerCase().includes(q)).slice(0,6);
    if(matches.length===0){ searchResults.classList.add('hidden'); return; }
    matches.forEach(loc=>{
      const btn = document.createElement('button');
      btn.textContent = loc.name;
      btn.addEventListener('click', ()=>{
        map.flyTo([loc.lat, loc.lon], 10, {duration:0.8});
        searchInput.value = loc.name;
        searchResults.classList.add('hidden');
        openPointPanel(loc.lat, loc.lon, loc.name);
      });
      searchResults.appendChild(btn);
    });
    searchResults.classList.remove('hidden');
  });
  document.addEventListener('click', (e)=>{
    if(!e.target.closest('.search')) searchResults.classList.add('hidden');
  });

  // ============ PANNEAU POINT ============
  const pointPanel = document.getElementById('point-panel');
  const pointState = { active:false, lat:null, lon:null };
  let clickMarker = null;

  function openPointPanel(lat, lon, forcedName){
    pointState.active = true; pointState.lat=lat; pointState.lon=lon;
    pointPanel.classList.remove('hidden');
    const name = forcedName || A.nearestLocationName(lat,lon) || 'Point sélectionné';
    document.getElementById('point-name').textContent = name;
    document.getElementById('point-coords').textContent = `${lat.toFixed(3)}°N, ${lon.toFixed(3)}°E`;

    if(clickMarker) map.removeLayer(clickMarker);
    clickMarker = L.circleMarker([lat,lon], {radius:5, color:'#4FE0D4', weight:2, fillColor:'#4FE0D4', fillOpacity:0.5}).addTo(map);

    updatePointNow();
    drawPointChart();
  }
  document.getElementById('point-close').addEventListener('click', ()=>{
    pointState.active=false;
    pointPanel.classList.add('hidden');
    if(clickMarker){ map.removeLayer(clickMarker); clickMarker=null; }
  });

  function updatePointNow(){
    if(!pointState.active) return;
    const s = A.sample('wind', pointState.lat, pointState.lon, state.step);
    const gustKt = A.sample('gust', pointState.lat, pointState.lon, state.step);
    const tempC = A.sample('temp', pointState.lat, pointState.lon, state.step);
    document.getElementById('point-now-value').innerHTML = `${s.speedKt.toFixed(0)} <span class="unit">nds</span>`;
    document.getElementById('point-now-gust-value').innerHTML = `${gustKt.toFixed(0)} <span class="unit">nds</span>`;
    document.getElementById('point-now-temp-value').innerHTML = `${tempC.toFixed(0)} <span class="unit">°C</span>`;
    document.getElementById('point-now-dir').style.setProperty('--dir', s.dirDeg+'deg');
  }

  function drawPointChart(){
    const canvas = document.getElementById('point-chart');
    const ctx = canvas.getContext('2d');
    const W=canvas.width, H=canvas.height;
    ctx.clearRect(0,0,W,H);

    const winds = A.STEPS.map((_,i)=> A.sample('wind', pointState.lat, pointState.lon, i).speedKt);
    const gusts = A.STEPS.map((_,i)=> A.sample('gust', pointState.lat, pointState.lon, i));
    const maxV = Math.max(...gusts, 10)*1.1;

    function toXY(arr,i){ return [ (i/(arr.length-1))*W, H - (arr[i]/maxV)*H ]; }

    function drawLine(arr, color){
      ctx.beginPath();
      arr.forEach((v,i)=>{
        const [x,y] = toXY(arr,i);
        i===0? ctx.moveTo(x,y): ctx.lineTo(x,y);
      });
      ctx.strokeStyle=color; ctx.lineWidth=1.8; ctx.stroke();
    }
    // grille légère
    ctx.strokeStyle='rgba(255,255,255,0.06)';
    ctx.lineWidth=1;
    for(let i=1;i<4;i++){ const y=H*i/4; ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }

    drawLine(gusts, 'rgba(242,166,90,0.85)');
    drawLine(winds, 'rgba(79,224,212,0.95)');

    // curseur temporel
    const [cx] = toXY(winds, state.step);
    ctx.strokeStyle='rgba(234,240,245,0.5)';
    ctx.beginPath(); ctx.moveTo(cx,0); ctx.lineTo(cx,H); ctx.stroke();
  }

  map.on('click', (e)=> openPointPanel(e.latlng.lat, e.latlng.lng));

  // ============ INIT ============
  resizeOverlay();
  setLayer('wind');
  setStep(0);
  updateLegend();

  map.whenReady(()=>{ resizeOverlay(); renderOverlay(); updateCompass(); });

  } // fin runApp

})();
