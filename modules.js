
/* =========================================================
   NETWORKING — real multiplayer client (graceful fallback)
   ========================================================= */
function connectMultiplayer(){
  // Only works when served by server.js (http/https). file:// stays solo.
  if(!location.host){ setNetStatus("Solo (bots)"); return; }
  try{
    const proto = location.protocol==="https:" ? "wss" : "ws";
    const ws = new WebSocket(proto+"://"+location.host);
    net.ws = ws;
    setNetStatus("Connecting…");
    ws.onopen = ()=>{ net.connected=true; setNetStatus("Online ✓"); removeBots(); toast("Connected to other couriers! 🌐"); netSend(localState()); };
    ws.onclose = ()=>{ net.connected=false; setNetStatus("Solo (bots)"); clearRemotes(); };
    ws.onerror = ()=>{ setNetStatus("Solo (bots)"); };
    ws.onmessage = (ev)=>handleNet(JSON.parse(ev.data));
  }catch(e){ setNetStatus("Solo (bots)"); }
}
function setNetStatus(s){ const el=document.getElementById("netStatus"); if(el)el.textContent=s; }
function handleNet(m){
  switch(m.t){
    case "welcome": net.id=m.id; break;
    case "count": 
      const ot = document.getElementById("onlineText");
      if(ot) ot.innerHTML = m.n > 1 ? `Explorers online: <span id="onlineCount">${m.n}</span>` : `Walking solo`;
      break;
    case "roster": m.players.forEach(addRemote); break;
    case "move": updateRemote(m); break;
    case "emote": { const p=net.players.get(m.id); if(p) spawnEmote(p.group,m.e); break; }
    case "leave": removeRemote(m.id); break;
    case "delivery": if(m.id!==net.id) toast((m.name||"Someone")+" made a delivery! 💌"); break;
    case "build": if(m.id!==net.id) handleRemoteBuild(m); break;
    case "syncBuilds": m.builds.forEach(handleRemoteBuild); break;
    case "chat": { const p=net.players.get(m.id); if(p) spawnChatBubble(p.group, m.msg); break; }
  }
}
function addRemote(p){
  if(net.players.has(p.id))return updateRemote(p);
  const grp=makeCharacter(p.body||"#7b68ee",p.hat||"#ff7a59");
  scene.add(grp);
  const tag=document.createElement("div");tag.className="nameTag";tag.textContent=p.name||"Friend";
  document.body.appendChild(tag);
  const dir=new THREE.Vector3(p.dx,p.dy,p.dz).normalize();
  const fwd=new THREE.Vector3(p.fx,p.fy,p.fz).normalize();
  net.players.set(p.id,{group:grp,dir,forward:fwd,tdir:dir.clone(),tforward:fwd.clone(),tag,name:p.name,moving:p.moving,phase:0});
  orientGroup(grp,dir,fwd);
}
function updateRemote(p){
  const r=net.players.get(p.id); if(!r)return addRemote(p);
  r.tdir.set(p.dx,p.dy,p.dz).normalize();
  r.tforward.set(p.fx,p.fy,p.fz).normalize();
  r.moving=p.moving; r.name=p.name;
}
function removeRemote(id){
  const r=net.players.get(id); if(!r)return;
  scene.remove(r.group); r.tag.remove(); net.players.delete(id);
}
function clearRemotes(){ for(const id of [...net.players.keys()]) removeRemote(id); }
function updateRemotePlayers(dt){
  const k=1-Math.pow(0.0001,dt);
  net.players.forEach(r=>{
    r.dir.lerp(r.tdir,k).normalize();
    r.forward.lerp(r.tforward,k);
    r.forward.sub(r.dir.clone().multiplyScalar(r.forward.dot(r.dir))).normalize();
    orientGroup(r.group,r.dir,r.forward);
    if(r.moving){r.phase+=dt*10;animateLimbs(r.group,r.phase);} else animateLimbs(r.group,0);
    projectTag(r.group,r.tag,2.6);
  });
}
function removeBots(){
  bots.forEach(b=>{scene.remove(b.group);b.tag.remove();});
  bots.length=0;
}
function localState(){
  const d=player.dir,f=player.forward;
  return {t:"state",name:playerName,body:chosenBody,hat:chosenHat,
    dx:d.x,dy:d.y,dz:d.z,fx:f.x,fy:f.y,fz:f.z,
    moving:player._moving||false,carry:parcels.length>0};
}
function netSend(obj){ if(net.connected&&net.ws&&net.ws.readyState===1) net.ws.send(JSON.stringify(obj)); }
let _netAccum=0;
function netTick(dt){
  if(!net.connected)return;
  _netAccum+=dt;
  if(_netAccum>=0.1){_netAccum=0; netSend(localState());}
}

function handleRemoteBuild(m) {
  const placeDir = new THREE.Vector3(m.dx, m.dy, m.dz);
  let obj = null;
  if (m.type === 'House') obj = makeHouse();
  else if (m.type === 'Tree') obj = makeTree();
  else if (m.type === 'Mailbox') obj = makeMailbox();
  
  if (obj) {
    obj.rotation.y = m.ry || 0;
    placeOnSurface(obj, placeDir);
    obj.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
    scene.add(obj);
    props.push(obj);
  }
}

/* =========================================================
   WEATHER — clear / cloudy / rain / snow with FX
   ========================================================= */
const WEATHER=[
  {name:"Clear", icon:"☀️", bg:0xa6c2dc, fog:0.008, particles:0},
  {name:"Smog",  icon:"🌧️", bg:0x9aa5ad, fog:0.014, particles:0},
  {name:"Rain",  icon:"☔", bg:0x6f7c8b, fog:0.018, particles:1, speed:34, color:0xaecbe0, lightning:true},
  {name:"Snow",  icon:"❄️", bg:0xcdd8e2, fog:0.014, particles:1, speed:7,  color:0xffffff},
];
let weather, weatherTimer=0, weatherIdx=0, precip=null, bgCur=new THREE.Color(0xa6c2dc), fogCur=0.008;
function initWeather(){ setWeather(0); }
function setWeather(i){
  weatherIdx=i; weather=WEATHER[i];
  document.getElementById("weatherName").textContent=weather.name;
  const pill=document.getElementById("weatherPill");
  pill.firstChild.textContent=weather.icon+" ";
  if(precip){scene.remove(precip);precip.geometry.dispose();precip=null;}
  if(weather.particles){
    const N=1400,arr=new Float32Array(N*3);
    for(let i=0;i<N;i++){arr[i*3]=(Math.random()-.5)*60;arr[i*3+1]=Math.random()*50;arr[i*3+2]=(Math.random()-.5)*60;}
    const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.BufferAttribute(arr,3));
    precip=new THREE.Points(g,new THREE.PointsMaterial({color:weather.color,size:weather.name==="Snow"?0.5:0.28,transparent:true,opacity:.8}));
    precip.frustumCulled=false;scene.add(precip);
  }
}
function updateWeather(dt,t){
  weatherTimer+=dt;
  if(weatherTimer>38){weatherTimer=0; setWeather((weatherIdx+1+Math.floor(Math.random()*2))%WEATHER.length);}
  bgCur.lerp(new THREE.Color(weather.bg),dt*0.5); scene.background.copy(bgCur); scene.fog.color.copy(bgCur);
  fogCur+=(weather.fog-fogCur)*dt*0.6; scene.fog.density=fogCur;
  if(precip){
    const base=player.group.position;
    const pos=precip.geometry.attributes.position; const arr=pos.array;
    for(let i=0;i<arr.length;i+=3){
      arr[i+1]-=weather.speed*dt;
      if(weather.name==="Snow"){arr[i]+=Math.sin(t*2+i)*dt*1.5;}
      if(arr[i+1]<0){arr[i+1]=50;arr[i]=(Math.random()-.5)*60;arr[i+2]=(Math.random()-.5)*60;}
    }
    pos.needsUpdate=true;
    precip.position.copy(base);
    precip.quaternion.copy(player.group.quaternion);
    if(weather.lightning&&Math.random()<dt*0.15){flash();}
  }
}
function flash(){const f=document.getElementById("flash");f.style.transition="none";f.style.opacity="0.7";
  requestAnimationFrame(()=>{f.style.transition="opacity .5s";f.style.opacity="0";});
  sfx("thunder");}

/* =========================================================
   AUDIO — ElevenLabs sample pack + synthesized fallback
   ========================================================= */
let actx,master,muted=false,noiseBuf,windGain,ambientGain;

/* Sample pack (generated with ElevenLabs sound effects). Each clip is keyed by
   the same cue name used by sfx(); if a file is missing or cannot be decoded
   (e.g. opened via file://) the original synthesized cue is used instead. */
const SFX_DIR="sounds/";
const SFX_GAIN={gem:0.7,deliver:0.75,pop:0.5,secret:0.7,thunder:0.9,footstep:0.3,jump:0.45,land:0.5,attack:0.45,hit:0.55};
const SFX_VARY={footstep:0.18,jump:0.08,land:0.08,attack:0.12,hit:0.12};
const sfxBuffers={};

function decodeAudio(bytes){
  return new Promise((res,rej)=>{ const p=actx.decodeAudioData(bytes,res,rej); if(p&&p.then)p.then(res,rej); });
}
async function loadSample(name){
  const r=await fetch(SFX_DIR+name+".mp3");
  if(!r.ok) throw new Error("missing "+name);
  return decodeAudio(await r.arrayBuffer());
}
function loadSfxSamples(){
  Object.keys(SFX_GAIN).forEach(async n=>{
    try{ sfxBuffers[n]=await loadSample(n); }catch(e){ /* keep synth fallback */ }
  });
}
async function loadAmbientBed(){
  try{
    const buf=await loadSample("ambient");
    const src=actx.createBufferSource();src.buffer=buf;src.loop=true;
    ambientGain=actx.createGain();ambientGain.gain.value=0;
    src.connect(ambientGain);ambientGain.connect(master);src.start();
    const t=actx.currentTime;
    ambientGain.gain.linearRampToValueAtTime(0.3,t+4);
    if(windGain){ // duck the synthesized wind so the two beds don't fight
      windGain.gain.cancelScheduledValues(t);
      windGain.gain.setValueAtTime(windGain.gain.value,t);
      windGain.gain.linearRampToValueAtTime(0.015,t+4);
    }
  }catch(e){ /* synthesized wind stays at full level */ }
}
function playSample(type){
  const buf=sfxBuffers[type];
  if(!buf)return false;
  const s=actx.createBufferSource();s.buffer=buf;
  const v=SFX_VARY[type];
  if(v)s.playbackRate.value=1+(Math.random()*2-1)*v;
  const g=actx.createGain();g.gain.value=SFX_GAIN[type]||0.6;
  s.connect(g);g.connect(master);s.start();
  return true;
}

function initAudio(){
  try{
    actx=new (window.AudioContext||window.webkitAudioContext)();
    master=actx.createGain();master.gain.value=0.5;master.connect(actx.destination);
    noiseBuf=actx.createBuffer(1,actx.sampleRate*2,actx.sampleRate);
    const d=noiseBuf.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;
    const wind=actx.createBufferSource();wind.buffer=noiseBuf;wind.loop=true;
    const lp=actx.createBiquadFilter();lp.type="lowpass";lp.frequency.value=420;
    const wg=actx.createGain();wg.gain.value=0.06;windGain=wg;
    const lfo=actx.createOscillator();lfo.frequency.value=0.08;const lfoG=actx.createGain();lfoG.gain.value=0.04;
    lfo.connect(lfoG);lfoG.connect(wg.gain);
    wind.connect(lp);lp.connect(wg);wg.connect(master);wind.start();lfo.start();
    [110,164.81,220].forEach((f,i)=>{const o=actx.createOscillator();o.type="sine";o.frequency.value=f;
      const g=actx.createGain();g.gain.value=0.025;o.connect(g);g.connect(master);o.start();
      const dt=actx.createOscillator();dt.frequency.value=0.05+i*0.03;const dg=actx.createGain();dg.gain.value=3;
      dt.connect(dg);dg.connect(o.frequency);dt.start();});
      
    const resumeAudio = () => {
      if(actx.state==="suspended") actx.resume();
    };
    window.addEventListener('mousedown', resumeAudio, {once:true});
    window.addEventListener('touchstart', resumeAudio, {once:true});
    resumeAudio();
    loadSfxSamples();
    loadAmbientBed();
  }catch(e){console.warn("audio off",e);}
}
function sfx(type){
  if(!actx||muted)return;
  if(playSample(type))return;
  sfxSynth(type);
}
function sfxSynth(type){
  const t=actx.currentTime;
  const ping=(freq,dur,when,gain=0.25,wave="triangle")=>{
    const o=actx.createOscillator();o.type=wave;o.frequency.value=freq;
    const g=actx.createGain();g.gain.setValueAtTime(0,t+when);g.gain.linearRampToValueAtTime(gain,t+when+0.01);
    g.gain.exponentialRampToValueAtTime(0.0001,t+when+dur);
    o.connect(g);g.connect(master);o.start(t+when);o.stop(t+when+dur+0.02);
  };
  if(type==="gem"){[880,1318].forEach((f,i)=>ping(f,0.25,i*0.05));}
  else if(type==="deliver"){[523,659,784,1046].forEach((f,i)=>ping(f,0.3,i*0.08,0.16));}
  else if(type==="pop"){ping(660,0.12,0,0.14,"square");}
  else if(type==="secret"){[659,988,1318,1568].forEach((f,i)=>ping(f,0.4,i*0.1,0.18,"sine"));}
  else if(type==="thunder"){const s=actx.createBufferSource();s.buffer=noiseBuf;
    const lp=actx.createBiquadFilter();lp.type="lowpass";lp.frequency.value=200;
    const g=actx.createGain();g.gain.setValueAtTime(0.4,t);g.gain.exponentialRampToValueAtTime(0.001,t+0.8);
    s.connect(lp);lp.connect(g);g.connect(master);s.start(t);s.stop(t+0.9);}
  else if(type==="footstep"){
    const s=actx.createBufferSource();s.buffer=noiseBuf;
    const lp=actx.createBiquadFilter();lp.type="lowpass";lp.frequency.value=1200;
    const g=actx.createGain();g.gain.setValueAtTime(0.12,t);g.gain.exponentialRampToValueAtTime(0.001,t+0.08);
    s.connect(lp);lp.connect(g);g.connect(master);s.start(t);s.stop(t+0.1);
  }
  else if(type==="jump"){
    const o=actx.createOscillator();o.type="sine";o.frequency.setValueAtTime(150,t);o.frequency.exponentialRampToValueAtTime(400,t+0.2);
    const g=actx.createGain();g.gain.setValueAtTime(0.1,t);g.gain.exponentialRampToValueAtTime(0.001,t+0.2);
    o.connect(g);g.connect(master);o.start(t);o.stop(t+0.25);
  }
  else if(type==="land"){
    ping(80,0.1,0,0.15,"square");
    const s=actx.createBufferSource();s.buffer=noiseBuf;
    const g=actx.createGain();g.gain.setValueAtTime(0.1,t);g.gain.exponentialRampToValueAtTime(0.001,t+0.1);
    s.connect(g);g.connect(master);s.start(t);s.stop(t+0.12);
  }
  else if(type==="attack"){
    const s=actx.createBufferSource();s.buffer=noiseBuf;
    const g=actx.createGain();g.gain.setValueAtTime(0.15,t);g.gain.exponentialRampToValueAtTime(0.001,t+0.15);
    s.connect(g);g.connect(master);s.start(t);s.stop(t+0.16);
    ping(600,0.1,0,0.08,"sine");
  }
  else if(type==="hit"){ping(200,0.1,0,0.2,"sawtooth");}
}

/* =========================================================
   SECRETS — hidden discoverable spots
   ========================================================= */
const SECRET_DATA=[
  {dir:dir(80,-30),  emoji:"🗽", name:"Liberty Torch Spark", desc:"A green ember off the old lady's torch."},
  {dir:dir(-78,90),  emoji:"🗾", name:"Faded Subway Map", desc:"Half the lines on it don't exist anymore."},
  {dir:dir(5,-95),   emoji:"🔑", name:"Super's Master Key", desc:"Opens every boiler room in the borough."},
  {dir:dir(40,118),  emoji:"🐦", name:"Pizza Pigeon", desc:"It stared you down, then took the slice."},
  {dir:dir(-25,-150),emoji:"🎨", name:"Fresh Mural", desc:"Still tacky. Somebody just left."},
  {dir:dir(62,15),   emoji:"🎷", name:"Platform Saxophonist", desc:"Playing to an empty express track."},
];
function spawnSecrets(){
  SECRET_DATA.forEach((s,i)=>{
    const grp=new THREE.Group();
    const m=new THREE.Mesh(new THREE.OctahedronGeometry(0.45,0),
      new THREE.MeshStandardMaterial({color:0xffe07a,emissive:0xffb84d,emissiveIntensity:.6,flatShading:true}));
    m.position.y=0.6;grp.add(m);
    placeOnSurface(grp,s.dir,0.4);
    scene.add(grp);
    secrets.push({...s,group:grp,mesh:m,index:i});
  });
}
function checkSecrets(){
  const t=clock.elapsedTime;
  secrets.forEach(s=>{
    s.mesh.rotation.y+=0.02; s.mesh.position.y=0.6+Math.sin(t*2+s.index)*0.12;
    if(foundSecrets.has(s.index))return;
    if(s.group.position.distanceTo(player.group.position)<2.4){
      foundSecrets.add(s.index);
      addGems(2);
      sfx("secret");
      spawnEmote(player.group,s.emoji);
      toast("✦ Found: "+s.name+" "+s.emoji+" (+2 🪙)");
      s.mesh.material.color.set(0x9ad17a);
      s.mesh.material.emissive.set(0x4f9d69);
      updateJournal();
    }
  });
}

/* =========================================================
   JOURNAL — collectibles & progress
   ========================================================= */
function initJournal(){
  document.getElementById("journalBtn").onclick=()=>{const j=document.getElementById("journal");j.classList.toggle("hidden");if(!j.classList.contains("hidden"))updateJournal();};
  document.getElementById("closeJournal").onclick=()=>document.getElementById("journal").classList.add("hidden");
  document.getElementById("muteBtn").onclick=()=>{muted=!muted;if(master)master.gain.value=muted?0:0.5;document.getElementById("muteBtn").textContent=muted?"🔇":"🔊";};
  addEventListener("keydown",e=>{if(e.code==="KeyJ")document.getElementById("journalBtn").onclick();});
}
function updateJournal(){
  if(document.getElementById("journal").classList.contains("hidden"))return;
  document.getElementById("jDeliveries").textContent=deliveriesDone;
  document.getElementById("jGems").textContent=gemCount+" / "+(gemsTotal+SECRET_DATA.length*2);
  document.getElementById("jRegions").textContent=visitedRegions.size+" / "+REGIONS.length;
  document.getElementById("jRegionList").innerHTML=REGIONS.map(r=>
    '<span class="'+(visitedRegions.has(r.name)?"visited":"")+'">'+r.emoji+' '+r.name+(visitedRegions.has(r.name)?" ✓":"")+'</span>').join("");
  const sec=[...foundSecrets].map(i=>{const s=SECRET_DATA[i];return '<div>'+s.emoji+' <b>'+s.name+'</b> — '+s.desc+'</div>';});
  document.getElementById("jSecrets").innerHTML=sec.length?sec.join(""):"<i>None yet — try the side streets…</i>";
}
