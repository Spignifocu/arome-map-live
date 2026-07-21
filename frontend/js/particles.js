/**
 * Animation du vent par particules advectées sur un canvas superposé à la carte Leaflet.
 * Chaque particule vit en coordonnées lat/lon réelles ; on la reprojette en pixels
 * à chaque frame via le state courant de la carte (pan/zoom pris en compte automatiquement).
 */
(function(){

  const SIM_SECONDS_PER_FRAME = 55; // "vitesse" d'advection simulée par frame, réglé pour le rendu
  const M_PER_DEG_LAT = 111320;

  function createWindParticleSystem(canvas, map){
    const ctx = canvas.getContext('2d');
    let particles = [];
    let running = false;
    let rafId = null;
    let sampler = null;      // (lat,lon) => {u,v,speedKt} | null
    let colorFn = (kt)=> `rgba(79,224,212,${Math.min(0.9, 0.25+kt/40)})`;
    let particleCount = 260;
    let active = false;

    function resize(){
      const dpr = Math.min(window.devicePixelRatio||1, 2);
      canvas.width = canvas.clientWidth*dpr;
      canvas.height = canvas.clientHeight*dpr;
      ctx.setTransform(dpr,0,0,dpr,0,0);
      clearHard();
    }

    function clearHard(){
      ctx.clearRect(0,0,canvas.clientWidth, canvas.clientHeight);
    }

    function randomLatLngInView(){
      const b = map.getBounds();
      const lat = b.getSouth() + Math.random()*(b.getNorth()-b.getSouth());
      const lon = b.getWest() + Math.random()*(b.getEast()-b.getWest());
      return {lat, lon};
    }

    function spawnParticle(){
      const {lat,lon} = randomLatLngInView();
      return { lat, lon, age: Math.random()*60, maxAge: 60+Math.random()*50, px:null, py:null };
    }

    function ensurePopulation(){
      while(particles.length < particleCount) particles.push(spawnParticle());
      if(particles.length > particleCount) particles.length = particleCount;
    }

    function step(){
      if(!running) return;
      // Fondu des traînées : on ATTÉNUE l'alpha existant (destination-out)
      // plutôt que de peindre par-dessus (source-over), qui accumulerait
      // vers l'opaque au bout de quelques secondes et masquerait tout ce
      // qui est en dessous (carte, calque couleur).
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(0,0,canvas.clientWidth, canvas.clientHeight);
      ctx.globalCompositeOperation = 'source-over';

      if(active && sampler){
        ctx.lineWidth = 1.4;
        ctx.lineCap = 'round';

        for(const p of particles){
          const sample = sampler(p.lat, p.lon);
          const pt0 = map.latLngToContainerPoint([p.lat, p.lon]);

          if(!sample || p.age > p.maxAge || pt0.x<-20||pt0.x>canvas.clientWidth+20||pt0.y<-20||pt0.y>canvas.clientHeight+20){
            Object.assign(p, spawnParticle());
            continue;
          }

          const dtSec = SIM_SECONDS_PER_FRAME;
          const dLat = (sample.v * dtSec) / M_PER_DEG_LAT;
          const dLon = (sample.u * dtSec) / (M_PER_DEG_LAT * Math.cos(p.lat*Math.PI/180));

          const newLat = p.lat + dLat;
          const newLon = p.lon + dLon;
          const pt1 = map.latLngToContainerPoint([newLat, newLon]);

          ctx.strokeStyle = colorFn(sample.speedKt);
          ctx.beginPath();
          ctx.moveTo(pt0.x, pt0.y);
          ctx.lineTo(pt1.x, pt1.y);
          ctx.stroke();

          p.lat = newLat; p.lon = newLon; p.age += 1;
        }
      }

      rafId = requestAnimationFrame(step);
    }

    function start(){
      if(running) return;
      running = true;
      ensurePopulation();
      rafId = requestAnimationFrame(step);
    }
    function stop(){
      running = false;
      if(rafId) cancelAnimationFrame(rafId);
    }
    function setActive(v){
      active = v;
      if(!v) clearHard();
    }
    function setSampler(fn){ sampler = fn; }
    function setColorFn(fn){ colorFn = fn; }

    window.addEventListener('resize', resize);
    window.addEventListener('load', resize);
    map.on('move zoom', ()=>{ /* particules reprojetées automatiquement à la frame suivante */ });

    resize();
    ensurePopulation();

    return { start, stop, resize, setActive, setSampler, setColorFn };
  }

  window.createWindParticleSystem = createWindParticleSystem;
})();
