/* =========================================================
   Tiny Planet Messenger — New York City edition
   Built with Three.js. Walk a pocket-sized Manhattan wrapped around
   a sphere: run deliveries for the locals, collect subway tokens,
   chase off rats, and explore six hand-built neighbourhoods.
   ========================================================= */
'use strict';

const THREE_OK = typeof THREE !== 'undefined';
const PLANET_R = 30;          // planet radius
const WALK_H   = 1.1;         // character feet offset above surface
const MOVE_SPEED = 0.9;       // radians-ish per second scaling
const TURN_SPEED = 2.4;

let scene, camera, renderer, clock;
let planet, sun;
let player;                   // {group, posDir(THREE.Vector3 unit), forward(unit tangent), name, ...}
let npcs = [], gems = [], bots = [], props = [];
let neonParts = [], _neonCached = false;
const SKY_DAY = 0xa6c2dc;     // hazy Manhattan daylight
let parcels = [];             // visible carried parcel meshes
const keys = {};
let camYaw = 0, camPitch = 0.35, camDist = 14;
let compassArrow = null;
let fireflies = null;
let dragging = false, lastX = 0, lastY = 0;
let joyVec = {x:0, y:0};
let gemCount = 0, playerLevel = 1, playerXP = 0;
let buildingsBuilt = 0, footstepTimer = 0;
let activeNPC = null;         // npc in interaction range
let quest = null;             // {from, to, item, stage:'toDeliver'}
let deliveriesDone = 0;
const visitedRegions = new Set();
const foundSecrets = new Set();
let secrets = [];

// Combat
let playerHP = 100;
let maxHP = 100;
let slimes = [];
let isAttacking = false;
let attackTimer = 0;
let weaponMesh = null;
const WEAPON_REST_X = 0.9;   // resting tilt: blade angled up and forward
const WEAPON_SWING = 1.0;    // extra rotation swept during an attack
const ATTACK_DUR = 0.25;

// networking
const net = { ws:null, connected:false, id:null, players:new Map() };
let chosenBody = '#7b68ee', chosenHat = '#ff7a59', playerName = 'Pip';
const tmpV = new THREE.Vector3 ? new THREE.Vector3() : null;

// ---- Regions (New York City neighbourhoods) ----
const REGIONS = [
  {name:'Midtown',   color:0x8e9199, dir:dir( 20,  10), emoji:'🏙️', road:0x3b3f46, mark:0xf0e6c8},
  {name:'Central Park',color:0x5aa055,dir:dir(-10,  70), emoji:'🌳', road:0xb08a5a, mark:0x6fb86a, park:true},
  {name:'Times Square',color:0x7c7f88,dir:dir( 55, -40), emoji:'🎭', road:0x33363d, mark:0xffe9a8},
  {name:'Wall Street',color:0x74787f, dir:dir(-45,-120), emoji:'🏦', road:0x35383f, mark:0xe8dcc0},
  {name:'Brooklyn',  color:0x9c8578, dir:dir(-60,  40), emoji:'🌉', road:0x44464c, mark:0xefe4cc},
  {name:'Harlem',    color:0xa08a76, dir:dir( 30, 160), emoji:'🎷', road:0x42444a, mark:0xefe4cc},
];

function dir(latDeg, lonDeg){
  const lat = latDeg*Math.PI/180, lon = lonDeg*Math.PI/180;
  return new THREE.Vector3(
    Math.cos(lat)*Math.cos(lon),
    Math.sin(lat),
    Math.cos(lat)*Math.sin(lon)
  ).normalize();
}
function regionAt(unitDir){
  let best=REGIONS[0], bd=-2;
  for(const r of REGIONS){const d=r.dir.dot(unitDir); if(d>bd){bd=d;best=r;}}
  return best;
}
// uniform random unit vector (version-independent; avoids relying on Vector3.randomDirection)
function randDir(){
  const u=(Math.random()-0.5)*2, th=Math.random()*Math.PI*2, f=Math.sqrt(Math.max(0,1-u*u));
  return new THREE.Vector3(f*Math.cos(th), f*Math.sin(th), u);
}
// surface any uncaught error to the player instead of a silent black screen
window.addEventListener('error', e=>{
  if(typeof showFatal==='function' && document.getElementById('fatal') && document.getElementById('fatal').classList.contains('hidden')){
    showFatal('Unexpected error', (e&&e.message)||'see console');
  }
});

/* ---------------- Customizer UI ---------------- */
const PALETTE = ['#7b68ee','#ff7a59','#46c2cb','#ff6b9d','#ffd36e','#9ad17a','#5a4a78','#ff9e6d'];
function buildSwatches(elId, initial, onPick){
  const el = document.getElementById(elId);
  el.innerHTML = '';
  PALETTE.forEach((c,i)=>{
    const s=document.createElement('div');
    const requiredLevel = i < 4 ? 1 : (i - 2);
    if (playerLevel < requiredLevel) {
      s.className = 'sw';
      s.style.background = '#555';
      s.style.opacity = '0.3';
      s.style.cursor = 'not-allowed';
      s.title = `Unlocks at Level ${requiredLevel}`;
      s.onclick = () => alert(`Reach Level ${requiredLevel} to unlock!`);
    } else {
      s.className='sw'+(c===initial?' active':'');
      s.style.background=c;
      s.onclick=()=>{[...el.children].forEach(x=>x.classList.remove('active'));s.classList.add('active');onPick(c);};
    }
    el.appendChild(s);
  });
}

function loadProgress() {
  const data = localStorage.getItem('tinyPlanetProgress');
  if (data) {
    try {
      const p = JSON.parse(data);
      playerXP = p.xp || 0;
      playerLevel = p.level || 1;
      gemCount = p.gems || 0;
      deliveriesDone = p.deliveries || 0;
    } catch(e){}
  }
}
function saveProgress() {
  localStorage.setItem('tinyPlanetProgress', JSON.stringify({xp: playerXP, level: playerLevel, gems: gemCount, deliveries: deliveriesDone}));
}
function addXP(amount) {
  playerXP += amount;
  const nextLevelXP = playerLevel * 100;
  if (playerXP >= nextLevelXP) {
    playerXP -= nextLevelXP;
    playerLevel++;
    toast(`Level Up! You are now Level ${playerLevel} 🎉`);
    sfx('pop');
    document.getElementById('levelCount').textContent = playerLevel;
    buildSwatches('bodySwatches', chosenBody, c=>{chosenBody=c; previewChar();});
    buildSwatches('hatSwatches',  chosenHat,  c=>{chosenHat=c; previewChar();});
  }
  saveProgress();
}

/* ---------------- Boot ---------------- */
window.addEventListener('load', ()=>{
  if(!THREE_OK){
    document.getElementById('loader').innerHTML =
      '<h1>Could not load 3D engine</h1><p>Please open this page with an internet connection (Three.js loads from a CDN).</p>';
    return;
  }
  loadProgress();
  document.getElementById('levelCount').textContent = playerLevel;
  document.getElementById('gemCount').textContent = gemCount;
  
  buildSwatches('bodySwatches', chosenBody, c=>{chosenBody=c; previewChar();});
  buildSwatches('hatSwatches',  chosenHat,  c=>{chosenHat=c; previewChar();});
  document.getElementById('nameInput').addEventListener('input', e=>playerName=e.target.value||'Pip');
  document.getElementById('startBtn').onclick = startGame;
  initPreview();
  initWorld(); // Build world in background
  setTimeout(()=>document.getElementById('loader').classList.add('hidden'), 900);
});

/* ---------------- Character preview (customizer) ---------------- */
let pRenderer,pScene,pCam,pChar,previewRunning=false;
function initPreview(){
  try{
    const host=document.getElementById('charPreview');
    pRenderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
    pRenderer.setSize(host.clientWidth,host.clientHeight);
    pRenderer.setPixelRatio(Math.min(devicePixelRatio,2));
    host.appendChild(pRenderer.domElement);
    pScene=new THREE.Scene();
    pCam=new THREE.PerspectiveCamera(40,host.clientWidth/host.clientHeight,.1,100);
    pCam.position.set(0,1.4,6);pCam.lookAt(0,1.1,0);
    pScene.add(new THREE.HemisphereLight(0xffffff,0x99aabb,1.1));
    const d=new THREE.DirectionalLight(0xffffff,.7);d.position.set(3,6,4);pScene.add(d);
    previewChar();
    previewRunning=true;
    (function loop(){ if(!previewRunning)return; requestAnimationFrame(loop); if(pChar)pChar.rotation.y+=0.012; pRenderer.render(pScene,pCam); })();
  }catch(e){ console.warn('preview unavailable',e); /* customizer still works without it */ }
}
function previewChar(){
  if(pChar)pScene.remove(pChar);
  pChar=makeCharacter(chosenBody,chosenHat);
  pScene.add(pChar);
}

/* ---------------- Cel-shading (toon) + outlines ----------------
   Matches Abeto's art direction: stepped toon lighting, custom
   outline pass (cheap inverted-hull), grain + watercolor grade.   */
let _toonGrad=null;
function toonGradient(){
  if(_toonGrad)return _toonGrad;
  try{
    const steps=new Uint8Array([60,130,205,255]);              // 4 crisp light bands
    const tex=new THREE.DataTexture(steps,steps.length,1,THREE.RedFormat);
    tex.minFilter=THREE.NearestFilter; tex.magFilter=THREE.NearestFilter; tex.generateMipmaps=false;
    tex.needsUpdate=true; _toonGrad=tex;
  }catch(e){ _toonGrad=undefined; }
  return _toonGrad;
}
let _noiseTex = null;
function getNoiseTexture() {
  if (_noiseTex) return _noiseTex;
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(size, size);
  const data = imgData.data;
  // simple noise
  for (let i = 0; i < data.length; i += 4) {
    const val = 128 + (Math.random() - 0.5) * 60; // softer noise
    data[i] = val;
    data[i+1] = val;
    data[i+2] = val;
    data[i+3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
  _noiseTex = new THREE.CanvasTexture(canvas);
  _noiseTex.wrapS = THREE.RepeatWrapping;
  _noiseTex.wrapT = THREE.RepeatWrapping;
  _noiseTex.repeat.set(4, 4);
  return _noiseTex;
}

// toon material with graceful fallback to standard
function toonMat(c, opts={}){
  try{
    const m=new THREE.MeshToonMaterial(Object.assign({color:c},opts));
    const g=toonGradient(); if(g)m.gradientMap=g;
    m.bumpMap = getNoiseTexture();
    m.bumpScale = 0.015;
    return m;
  }catch(e){
    return new THREE.MeshStandardMaterial(Object.assign({color:c,flatShading:true,roughness:.9},opts));
  }
}
const OUTLINE_COL=0x2a2230;
const _outlineMat=()=>new THREE.MeshBasicMaterial({color:OUTLINE_COL, side:THREE.BackSide});
function addOutline(group, thickness=0.06){
  // snapshot existing meshes, then attach an inverted-hull child to each so
  // the outline inherits any animation (arm/leg swing) automatically.
  const meshes=[];
  group.traverse(o=>{ if(o.isMesh && o.geometry && !o.userData.isOutline) meshes.push(o); });
  meshes.forEach(o=>{
    const out=new THREE.Mesh(o.geometry, _outlineMat());
    out.scale.setScalar(1+thickness);   // child: local origin = part center
    out.userData.isOutline=true; out.castShadow=false; out.receiveShadow=false;
    o.add(out);
  });
  return group;
}

/* ---------------- Low-poly character ---------------- */
const HAIR_COLS=[0x3a2a1e,0x6b4423,0x111111,0xc9a227,0xb0413e,0x8a8f99,0x5a3e8a,0xff8fb1];
function makeCharacter(bodyCol, hatCol, seed){
  const rnd=mulberry(seed===undefined?Math.random()*1e9:seed);
  const g=new THREE.Group();
  const mat=c=>toonMat(c);
  // body
  const body=new THREE.Mesh(new THREE.CylinderGeometry(.42,.55,1.1,8),mat(bodyCol));
  body.position.y=.95;g.add(body);
  // head
  const head=new THREE.Mesh(new THREE.IcosahedronGeometry(.45,0),mat(0xffe0bd));
  head.position.y=1.75;g.add(head);
  // eyes
  const eyeMat=new THREE.MeshBasicMaterial({color:0x2a1f33});
  for(const s of [-1,1]){
    const e=new THREE.Mesh(new THREE.SphereGeometry(.07,8,8),eyeMat);
    e.position.set(.16*s,1.8,.4);g.add(e);
  }
  // randomized hair (Abeto-style cosmetic variety)
  const hairCol=HAIR_COLS[Math.floor(rnd()*HAIR_COLS.length)];
  const hairStyle=Math.floor(rnd()*3);
  const hairMat=mat(hairCol);
  const cap=new THREE.Mesh(new THREE.SphereGeometry(.47,10,8,0,Math.PI*2,0,Math.PI*0.55),hairMat);
  cap.position.y=1.82;g.add(cap);
  if(hairStyle===1){ for(let i=0;i<3;i++){const tuft=new THREE.Mesh(new THREE.ConeGeometry(.12,.3,5),hairMat);tuft.position.set((rnd()-.5)*.5,2.12,(rnd()-.5)*.4);g.add(tuft);} }
  if(hairStyle===2){ for(const s of[-1,1]){const pony=new THREE.Mesh(new THREE.SphereGeometry(.16,8,8),hairMat);pony.position.set(.42*s,1.78,-.1);g.add(pony);} }
  // hat (messenger cap) — worn by some
  if(rnd()<0.7){
    const hat=new THREE.Mesh(new THREE.ConeGeometry(.5,.45,8),mat(hatCol));
    hat.position.y=2.18;g.add(hat);
    const brim=new THREE.Mesh(new THREE.CylinderGeometry(.5,.5,.08,8),mat(hatCol));
    brim.position.y=1.98;g.add(brim);
  }
  // satchel
  const bag=new THREE.Mesh(new THREE.BoxGeometry(.5,.4,.25),mat(0x8a5a3a));
  bag.position.set(.5,.9,0);g.add(bag);
  // random cosmetic accessory
  const acc=Math.floor(rnd()*4);
  if(acc===0){const sc=new THREE.Mesh(new THREE.TorusGeometry(.2,.06,6,12),mat(0xff6b9d));sc.position.set(0,1.45,0);sc.rotation.x=Math.PI/2;g.add(sc);}
  else if(acc===1){const fl=new THREE.Mesh(new THREE.IcosahedronGeometry(.12,0),mat(0xffd36e));fl.position.set(.34,2.0,.18);g.add(fl);}
  else if(acc===2){const cape=new THREE.Mesh(new THREE.ConeGeometry(.55,1.0,8,1,true),mat(HAIR_COLS[Math.floor(rnd()*HAIR_COLS.length)]));cape.position.set(0,.95,-.18);g.add(cape);}
  // arms
  for(const s of [-1,1]){
    const arm=new THREE.Mesh(new THREE.CylinderGeometry(.13,.13,.8,6),mat(bodyCol));
    arm.position.set(.55*s,1.0,0);arm.rotation.z=.25*s;g.add(arm);
    arm.userData.swing=s; arm.name='arm';
  }
  // legs
  for(const s of [-1,1]){
    const leg=new THREE.Mesh(new THREE.CylinderGeometry(.16,.16,.7,6),mat(0x4a3f5a));
    leg.position.set(.2*s,.35,0);g.add(leg);
    leg.userData.swing=s; leg.name='leg';
  }
  g.userData.head=head;
  addOutline(g);
  return g;
}
// tiny seeded PRNG for stable per-character looks
function mulberry(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}

/* ---------------- Build the world ---------------- */
function hasWebGL(){
  try{
    const c=document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl')||c.getContext('experimental-webgl')));
  }catch(e){ return false; }
}
function showFatal(title, detail){
  const box=document.getElementById('fatal');
  if(!box)return;
  box.querySelector('#fatalTitle').textContent=title;
  box.querySelector('#fatalDetail').textContent=detail||'';
  box.classList.remove('hidden');
}
let gameStarted = false;
let idleCamAngle = 0;

function initWorld() {
  const steps=[
    ['checking WebGL', ()=>{ if(!hasWebGL()) throw new Error('WebGL is not available in this browser/tab.'); }],
    ['scene', setupScene],['planet', buildPlanet],['regions', decorateRegions],
    ['NPCs', spawnNPCs],['gems', spawnGems],['secrets', spawnSecrets],
    ['players', spawnBots],['weather', initWeather]
  ];
  for(const [label,fn] of steps){
    try{ fn(); }catch(err){ console.error('Failed: '+label, err); return; }
  }
  clock=new THREE.Clock();
  animate();
}

function startGame(){
  if(gameStarted) return;
  gameStarted = true;
  const steps=[
    ['you', spawnPlayer],['UI', buildEmojiBar],
    ['controls', bindControls],['mobile', setupMobile],
    ['audio', typeof initAudio==='function'?initAudio:()=>{}],
    ['journal', initJournal],['network', connectMultiplayer],
  ];
  document.getElementById('customizer').style.opacity = '0';
  setTimeout(()=>document.getElementById('customizer').classList.add('hidden'), 500);
  document.getElementById('hud').classList.remove('hidden');
  previewRunning=false; // stop customizer render loop
  try{ if(pRenderer){ pRenderer.forceContextLoss&&pRenderer.forceContextLoss(); pRenderer.dispose&&pRenderer.dispose(); pRenderer=null; } }catch(e){}
  
  for(const [label,fn] of steps){
    try{ fn(); }
    catch(err){
      console.error('Failed during: '+label, err);
      showFatal('Could not start the game (step: '+label+')', (err&&err.message)||String(err));
      return;
    }
  }
  toast('Welcome to Tiny New York! 🗽');
}

function setupScene(){
  scene=new THREE.Scene();
  scene.background=new THREE.Color(SKY_DAY);
  scene.fog=new THREE.FogExp2(SKY_DAY,0.008);
  camera=new THREE.PerspectiveCamera(55,innerWidth/innerHeight,.1,400);
  renderer=new THREE.WebGLRenderer({antialias:true});
  renderer.setSize(innerWidth,innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xe8f0ff,0x4a5560,0.85));
  sun=new THREE.DirectionalLight(0xfff0d8,1.05);
  sun.position.set(60,90,40);
  sun.castShadow=true;
  sun.shadow.mapSize.set(2048,2048);
  const s=70;Object.assign(sun.shadow.camera,{left:-s,right:s,top:s,bottom:-s,near:1,far:300});
  scene.add(sun);

  compassArrow = new THREE.Group();
  const arrMesh = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.5, 4), toonMat(0xff3333));
  arrMesh.position.z = -0.5;
  arrMesh.rotation.x = -Math.PI / 2;
  compassArrow.add(arrMesh);
  scene.add(compassArrow);

  // stars / distant clouds
  const starGeo=new THREE.BufferGeometry();
  const pts=[];for(let i=0;i<350;i++){const v=randDir().multiplyScalar(180+Math.random()*120);pts.push(v.x,v.y,v.z);}
  starGeo.setAttribute('position',new THREE.Float32BufferAttribute(pts,3));
  scene.add(new THREE.Points(starGeo,new THREE.PointsMaterial({color:0xffffff,size:1.2,transparent:true,opacity:.5})));

  // drifting city glow (street haze + lit windows catching the night air)
  const ffGeo = new THREE.BufferGeometry();
  const ffPts = [];
  for(let i=0;i<150;i++){
    const v = randDir().multiplyScalar(PLANET_R + 0.3 + Math.random()*2.5);
    ffPts.push(v.x, v.y, v.z);
  }
  ffGeo.setAttribute('position', new THREE.Float32BufferAttribute(ffPts, 3));
  fireflies = new THREE.Points(ffGeo, new THREE.PointsMaterial({color: 0xffd9a0, size: 0.45, transparent: true, opacity: 0}));
  scene.add(fireflies);

  // street rats
  for(let i=0; i<12; i++) {
    const s = makeSlime();
    const p = randDir();
    s.userData.dir = p.clone();
    s.userData.forward = randDir().cross(p).normalize();
    placeOnSurface(s, p);
    scene.add(s);
    slimes.push(s);
  }

  addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
}

/* The city surface is painted into an equirectangular canvas so the Manhattan
   street grid (avenues, cross streets, crosswalks, lane markings) stays crisp
   no matter how dense the geometry is. */
const STREET_TEX_W = 2048, STREET_TEX_H = 1024;
const AVENUE_EVERY = 52, STREET_EVERY = 26;   // pixels between roads
const AVENUE_W = 15, STREET_W = 9;            // road widths in pixels

function hash2(x,y){ const s=Math.sin(x*127.1+y*311.7)*43758.5453; return s-Math.floor(s); }

function buildCityTexture(){
  const c=document.createElement('canvas');
  c.width=STREET_TEX_W; c.height=STREET_TEX_H;
  const ctx=c.getContext('2d');
  const img=ctx.createImageData(STREET_TEX_W,STREET_TEX_H);
  const data=img.data;
  const n=new THREE.Vector3();
  // pre-split every palette entry into plain rgb bytes: 2M iterations is no
  // place for THREE.Color allocation or HSL round-trips
  const rgb=h=>[(h>>16)&255,(h>>8)&255,h&255];
  const regRGB=REGIONS.map(r=>rgb(r.color)), roadRGB=REGIONS.map(r=>rgb(r.road||0x3b3f46));
  const LANE=rgb(0xd8c979), ZEBRA=rgb(0xd9d9d4), PATH=rgb(0xb59a6d), POND=rgb(0x3f7d9c);
  let cr=0,cg=0,cb=0;

  for(let y=0;y<STREET_TEX_H;y++){
    const lat=Math.PI/2-(y/STREET_TEX_H)*Math.PI;
    const cosLat=Math.cos(lat), sinLat=Math.sin(lat);
    // roads converge at the poles, so widen the grid as the rows shrink
    const lonScale=Math.max(0.25,cosLat);
    const sy=y%STREET_EVERY;
    const onStreet=sy<STREET_W;
    for(let x=0;x<STREET_TEX_W;x++){
      const lon=(x/STREET_TEX_W)*Math.PI*2-Math.PI;
      n.set(cosLat*Math.cos(lon),sinLat,cosLat*Math.sin(lon));
      let ri=0,bd=-2;
      for(let k=0;k<REGIONS.length;k++){const d=REGIONS[k].dir.dot(n); if(d>bd){bd=d;ri=k;}}
      const reg=REGIONS[ri], rc=regRGB[ri], road=roadRGB[ri];
      const av=AVENUE_EVERY/lonScale;
      const sx=x%av;
      const onAvenue=sx<AVENUE_W/lonScale;
      const bx=Math.floor(x/av), by=Math.floor(y/STREET_EVERY);

      if(reg.park){
        // lawns, ponds and winding footpaths instead of a street grid
        const s=1+(hash2(bx*3.1,by*2.7)-0.5)*0.22;
        cr=rc[0]*s; cg=rc[1]*s; cb=rc[2]*s;
        const path=Math.abs(Math.sin(y*0.06+Math.cos(x*0.035)*3.0));
        if(path<0.06){ cr=PATH[0];cg=PATH[1];cb=PATH[2]; }
        const pond=Math.sin(x*0.02+1.7)*Math.cos(y*0.028-0.6);
        if(pond>0.93){ cr=POND[0];cg=POND[1];cb=POND[2]; }
      } else if(onAvenue||onStreet){
        const s=1+(hash2(x*0.5,y*0.5)-0.5)*0.18;
        cr=road[0]*s; cg=road[1]*s; cb=road[2]*s;
        const aw=AVENUE_W/lonScale;
        // dashed lane markings down the middle of every avenue
        if(!onStreet && Math.abs(sx-aw/2)<1.2 && (y%18)<10){ cr=LANE[0];cg=LANE[1];cb=LANE[2]; }
        // crosswalk zebra stripes across each intersection approach
        else if(onStreet && !onAvenue && sy>1 && sy<STREET_W-1 && (x%6)<3){ cr=ZEBRA[0];cg=ZEBRA[1];cb=ZEBRA[2]; }
        else if(onAvenue && !onStreet && sx>1 && sx<aw-1 && (y%6)<3 &&
                sy>STREET_W && sy<STREET_W+7){ cr=ZEBRA[0];cg=ZEBRA[1];cb=ZEBRA[2]; }
      } else {
        // city block: pale sidewalk border around a varied rooftop/lot interior
        const edge=sx<AVENUE_W/lonScale+4||sy<STREET_W+3||sx>av-4||sy>STREET_EVERY-3;
        if(edge){ cr=rc[0]*0.55+120; cg=rc[1]*0.55+120; cb=rc[2]*0.55+118; }
        else{ const s=0.78+hash2(bx*1.7,by*4.3)*0.42; cr=rc[0]*s; cg=rc[1]*s; cb=rc[2]*s; }
      }
      const i=(y*STREET_TEX_W+x)*4;
      data[i]=cr; data[i+1]=cg; data[i+2]=cb; data[i+3]=255;
    }
  }
  ctx.putImageData(img,0,0);
  const tex=new THREE.CanvasTexture(c);
  tex.anisotropy=4;
  return tex;
}

function buildPlanet(){
  const geo=new THREE.SphereGeometry(PLANET_R,220,140);
  const pos=geo.attributes.position;
  const v=new THREE.Vector3();
  for(let i=0;i<pos.count;i++){
    v.set(pos.getX(i),pos.getY(i),pos.getZ(i));
    const n=v.clone().normalize();
    v.copy(n).multiplyScalar(surfaceHeight(n));
    pos.setXYZ(i,v.x,v.y,v.z);
  }
  geo.computeVertexNormals();

  let planetMat;
  const cityTex=buildCityTexture();
  try{
    planetMat=new THREE.MeshToonMaterial({map:cityTex});
    const g=toonGradient(); if(g)planetMat.gradientMap=g;
    planetMat.bumpMap=getNoiseTexture();
    planetMat.bumpScale=0.03;
  }
  catch(e){ planetMat=new THREE.MeshStandardMaterial({map:cityTex,roughness:.95}); }
  planet=new THREE.Mesh(geo,planetMat);
  planet.receiveShadow=true;
  scene.add(planet);

  // the harbour: a dark river shell peeking through the lowest ground
  const sea=new THREE.Mesh(new THREE.SphereGeometry(PLANET_R-0.16,64,48),
    new THREE.MeshStandardMaterial({color:0x2e5b7a,transparent:true,opacity:.75,roughness:.25,metalness:.2}));
  scene.add(sea);
}

// place an object on the planet surface oriented to the normal
const _q=new THREE.Quaternion();const _up=new THREE.Vector3(0,1,0);
function placeOnSurface(obj, unitDir, extra=0){
  const h=surfaceHeight(unitDir)+extra;
  obj.position.copy(unitDir).multiplyScalar(h);
  _q.setFromUnitVectors(_up,unitDir);
  obj.quaternion.copy(_q);
}
// A city is flat: the old rolling hills are damped down to gentle street camber,
// and only the deepest dips drop below the harbour shell to read as water.
function surfaceHeight(n){
  const bump=Math.sin(n.x*7)*Math.cos(n.y*6)*0.6+Math.sin(n.z*9+n.y*4)*0.4+Math.cos(n.x*13+n.z*5)*0.25;
  return PLANET_R+bump*0.2;
}
function isWater(n){ return surfaceHeight(n) < PLANET_R-0.14; }

function mat(c){return toonMat(c);}

/* ---------------- Region decorations ---------------- */
const pick=a=>a[Math.floor(Math.random()*a.length)];

// what fills the streets of each neighbourhood
const REGION_PROPS={
  'Midtown':      [[makeSkyscraper,5],[makeTaxi,1.4],[makeStreetLight,1.6],[makeHydrant,.8],[makeTrafficLight,.9],[makeSubwayEntrance,.6]],
  'Central Park': [[makeParkTree,6],[makeBench,1.6],[makeStreetLight,1.2],[makeRock,1],[makeHotDogCart,.6]],
  'Times Square': [[makeBillboardTower,3],[makeSkyscraper,2],[makeTaxi,2],[makeStreetLight,1.4],[makeHotDogCart,.8],[makeSubwayEntrance,.5]],
  'Wall Street':  [[makeSkyscraper,4],[makeColonnade,1.4],[makeStreetLight,1.4],[makeTrashCan,.9],[makeHydrant,.8],[makeTaxi,.9]],
  'Brooklyn':     [[makeBrownstone,4],[makeWaterTower,1.4],[makeParkTree,1.6],[makeStreetLight,1.2],[makeTrashCan,.9],[makeHydrant,.7]],
  'Harlem':       [[makeBrownstone,4],[makeParkTree,1.4],[makeStreetLight,1.3],[makeHotDogCart,.7],[makeTrashCan,.8],[makeMailbox,.6]],
};
function weightedProp(reg){
  const table=REGION_PROPS[reg.name]||REGION_PROPS['Midtown'];
  let total=0; for(const e of table) total+=e[1];
  let r=Math.random()*total;
  for(const e of table){ r-=e[1]; if(r<=0) return e[0](); }
  return table[0][0]();
}

// one hero landmark per neighbourhood, standing at its centre
const LANDMARKS={
  'Midtown':makeEmpireState, 'Central Park':makeParkFountain,
  'Times Square':makeTimesSquareSign, 'Wall Street':makeStatueOfLiberty,
  'Brooklyn':makeBridgeTower, 'Harlem':makeTheatreMarquee,
};

function decorateRegions(){
  for(let i=0;i<260;i++){
    const n=randDir();
    if(isWater(n)) continue;            // don't build in the harbour
    const reg=regionAt(n);
    // keep the landmark plaza clear
    if(reg.dir.dot(n)>0.995) continue;
    const obj=weightedProp(reg);
    if(!obj)continue;
    obj.rotateY(Math.round(Math.random()*4)*Math.PI/2+ (Math.random()-.5)*0.12); // align to the street grid
    placeOnSurface(obj,n);
    obj.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
    scene.add(obj);props.push(obj);
  }
  // landmarks + a street sign at each neighbourhood centre
  REGIONS.forEach(r=>{
    const make=LANDMARKS[r.name];
    if(make){
      const lm=make();
      placeOnSurface(lm,r.dir);
      lm.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
      scene.add(lm);props.push(lm);
    }
    const sign=makeStreetSign();
    const off=tangent(r.dir).multiplyScalar(0.09);
    placeOnSurface(sign,r.dir.clone().add(off).normalize());
    sign.traverse(o=>{if(o.isMesh)o.castShadow=true;});
    scene.add(sign);
  });
}
/* ---- glowing facades -------------------------------------------------
   Each tower gets a tiled window sheet plus a matching emissive sheet, so
   only the lit windows glow when the sun goes down over the city. */
const _facades={};
function facadeTextures(bodyHex, seed){
  const key=bodyHex+'_'+(seed%5);
  if(_facades[key])return _facades[key];
  const W=64,H=64,cols=8,rows=8,cw=W/cols,ch=H/rows;
  const mk=()=>{const c=document.createElement('canvas');c.width=W;c.height=H;return c;};
  const cm=mk(),ce=mk(),xm=cm.getContext('2d'),xe=ce.getContext('2d');
  xm.fillStyle='#'+('000000'+bodyHex.toString(16)).slice(-6);xm.fillRect(0,0,W,H);
  xe.fillStyle='#000000';xe.fillRect(0,0,W,H);
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
    const lit=hash2(c+seed*7.3,r+seed*13.1)<0.42;
    const x=c*cw+1.5,y=r*ch+1.5,w=cw-3,h=ch-3.5;
    xm.fillStyle=lit?'#ffe4a0':'#262c35';xm.fillRect(x,y,w,h);
    if(lit){xe.fillStyle='#ffd98c';xe.fillRect(x,y,w,h);}
  }
  const tm=new THREE.CanvasTexture(cm),te=new THREE.CanvasTexture(ce);
  [tm,te].forEach(t=>{t.wrapS=t.wrapT=THREE.RepeatWrapping;t.magFilter=THREE.NearestFilter;});
  _facades[key]={map:tm,emis:te};
  return _facades[key];
}
function facadeMat(bodyHex,seed,repU,repV){
  const f=facadeTextures(bodyHex,seed);
  const m=f.map.clone(),e=f.emis.clone();
  m.needsUpdate=e.needsUpdate=true;
  [m,e].forEach(t=>{t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(repU,repV);});
  try{
    const mt=new THREE.MeshToonMaterial({map:m,emissive:0xffffff,emissiveMap:e,emissiveIntensity:0.6});
    const g=toonGradient(); if(g)mt.gradientMap=g;
    return mt;
  }catch(err){
    return new THREE.MeshStandardMaterial({map:m,emissive:0xffffff,emissiveMap:e,emissiveIntensity:0.6,roughness:.85});
  }
}
function neonMat(c,i=1.0){
  return new THREE.MeshStandardMaterial({color:c,emissive:c,emissiveIntensity:i,roughness:.35});
}
// box with windows on the four walls and plain concrete on roof + floor
function towerBox(w,h,d,bodyHex,seed,roofHex=0x6d7076){
  const side=facadeMat(bodyHex,seed,Math.max(1,Math.round(w*1.6)),Math.max(1,Math.round(h*1.1)));
  const cap=mat(roofHex);
  const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),[side,side,cap,cap,side,side]);
  return m;
}

const TOWER_COLS=[0x8d939c,0x7b8189,0x9aa0a6,0x6f757e,0xa4998c,0x87909c];

function makeSkyscraper(){
  const g=new THREE.Group();
  const seed=Math.floor(Math.random()*1000);
  const col=pick(TOWER_COLS);
  const tiers=2+Math.floor(Math.random()*2);
  let w=1.4+Math.random()*1.1, d=w*(0.8+Math.random()*0.45), y=0;
  for(let i=0;i<tiers;i++){
    const h=2.2+Math.random()*3.4;
    const seg=towerBox(w,h,d,col,seed+i);
    seg.position.y=y+h/2;
    g.add(seg);
    // thin cornice between setbacks
    const lip=new THREE.Mesh(new THREE.BoxGeometry(w+0.14,0.12,d+0.14),mat(0x5f636a));
    lip.position.y=y+h; g.add(lip);
    y+=h; w*=0.72; d*=0.72;
  }
  if(Math.random()<0.45){
    const spire=new THREE.Mesh(new THREE.CylinderGeometry(0.03,0.09,1.4+Math.random()*1.6,6),mat(0x4c5058));
    spire.position.y=y+0.8; g.add(spire);
    const beacon=new THREE.Mesh(new THREE.SphereGeometry(0.11,8,8),neonMat(0xff4d4d,1.4));
    beacon.position.y=y+1.6; g.add(beacon);
  } else if(Math.random()<0.5){
    const wt=makeWaterTower(); wt.scale.setScalar(0.55); wt.position.y=y; g.add(wt);
  }
  g.userData.isBuilding=true;
  return g;
}

function makeBrownstone(){
  const g=new THREE.Group();
  const cols=[0x8a5a42,0x9c6b4c,0x7a4d38,0xa8785a,0x6f4b3a];
  const col=pick(cols);
  const seed=Math.floor(Math.random()*1000);
  const w=1.5,d=1.2,h=2.6+Math.random()*1.4;
  const body=towerBox(w,h,d,col,seed,col);
  body.position.y=h/2; g.add(body);
  // stoop
  for(let i=0;i<4;i++){
    const st=new THREE.Mesh(new THREE.BoxGeometry(0.7,0.12,0.22),mat(0xbdb3a4));
    st.position.set(0,0.12+i*0.16,d/2+0.34-i*0.11); g.add(st);
  }
  const door=new THREE.Mesh(new THREE.BoxGeometry(0.42,0.7,0.08),mat(0x3d2a20));
  door.position.set(0,0.95,d/2+0.02); g.add(door);
  const cornice=new THREE.Mesh(new THREE.BoxGeometry(w+0.2,0.18,d+0.2),mat(0x4a3327));
  cornice.position.y=h; g.add(cornice);
  // fire escape
  const fe=new THREE.Group();
  for(let i=1;i<3;i++){
    const p=new THREE.Mesh(new THREE.BoxGeometry(0.9,0.05,0.32),mat(0x2f2f33));
    p.position.set(0,i*0.9,d/2+0.18); fe.add(p);
    const rail=new THREE.Mesh(new THREE.BoxGeometry(0.9,0.3,0.04),mat(0x2f2f33));
    rail.position.set(0,i*0.9+0.16,d/2+0.34); fe.add(rail);
  }
  g.add(fe);
  g.userData.isBuilding=true;
  return g;
}
// legacy name kept so the build menu and remote-build sync keep working
function makeHouse(){ return makeBrownstone(); }

function makeParkTree(leaf){
  const leaves=leaf||pick([0x3f8f4a,0x4fa356,0x357c42,0x62a94f]);
  const g=new THREE.Group();
  const t=new THREE.Mesh(new THREE.CylinderGeometry(.14,.22,1.3,6),mat(0x6a4a33));t.position.y=.65;g.add(t);
  const l=new THREE.Mesh(new THREE.IcosahedronGeometry(.85,0),mat(leaves));l.position.y=1.7;g.add(l);
  const l2=new THREE.Mesh(new THREE.IcosahedronGeometry(.58,0),mat(leaves));l2.position.set(.24,2.2,-.1);g.add(l2);
  // tree pit guard, like a Manhattan sidewalk tree
  const pit=new THREE.Mesh(new THREE.TorusGeometry(.52,.05,6,14),mat(0x36393f));
  pit.rotation.x=Math.PI/2;pit.position.y=.06;g.add(pit);
  g.scale.setScalar(.85+Math.random()*.5);
  g.userData.isTree=true;
  addOutline(g,0.03);
  return g;
}
// legacy name (build menu + remote sync)
function makeTree(leaf){ return makeParkTree(leaf); }

function makeTaxi(){
  const g=new THREE.Group();
  const yellow=0xf7c331;
  const body=new THREE.Mesh(new THREE.BoxGeometry(1.9,0.5,0.9),mat(yellow));body.position.y=.45;g.add(body);
  const cabin=new THREE.Mesh(new THREE.BoxGeometry(1.0,0.42,0.82),mat(yellow));cabin.position.set(-0.1,0.85,0);g.add(cabin);
  const glass=new THREE.Mesh(new THREE.BoxGeometry(1.02,0.26,0.86),
    new THREE.MeshStandardMaterial({color:0x2b3b4a,roughness:.2,metalness:.4}));
  glass.position.set(-0.1,0.9,0);g.add(glass);
  const light=new THREE.Mesh(new THREE.BoxGeometry(0.34,0.14,0.18),neonMat(0xfff0a8,0.9));
  light.position.set(-0.1,1.13,0);g.add(light);
  const stripe=new THREE.Mesh(new THREE.BoxGeometry(1.92,0.14,0.92),mat(0x2a2d33));
  stripe.position.y=0.3;g.add(stripe);
  [[0.62,0.46],[0.62,-0.46],[-0.62,0.46],[-0.62,-0.46]].forEach(([x,z])=>{
    const w=new THREE.Mesh(new THREE.CylinderGeometry(0.22,0.22,0.16,10),mat(0x1d1f24));
    w.rotation.x=Math.PI/2;w.position.set(x,0.22,z);g.add(w);
  });
  g.scale.setScalar(0.72);
  addOutline(g,0.03);
  return g;
}

function makeStreetLight(){
  const g=new THREE.Group();
  const pole=new THREE.Mesh(new THREE.CylinderGeometry(.07,.09,3.4,8),mat(0x2f3238));pole.position.y=1.7;g.add(pole);
  const arm=new THREE.Mesh(new THREE.BoxGeometry(0.9,0.08,0.08),mat(0x2f3238));arm.position.set(0.45,3.35,0);g.add(arm);
  const head=new THREE.Mesh(new THREE.BoxGeometry(0.42,0.14,0.24),mat(0x3a3d44));head.position.set(0.86,3.25,0);g.add(head);
  const bulb=new THREE.Mesh(new THREE.BoxGeometry(0.34,0.06,0.18),neonMat(0xffe9b0,1.2));bulb.position.set(0.86,3.15,0);g.add(bulb);
  return g;
}

function makeTrafficLight(){
  const g=new THREE.Group();
  const pole=new THREE.Mesh(new THREE.CylinderGeometry(.07,.08,2.8,8),mat(0x2f3238));pole.position.y=1.4;g.add(pole);
  const box=new THREE.Mesh(new THREE.BoxGeometry(0.28,0.8,0.24),mat(0x23262b));box.position.y=2.9;g.add(box);
  [[0.28,0xff4d4d],[0.0,0xffcc44],[-0.28,0x49d17a]].forEach(([dy,c],i)=>{
    const l=new THREE.Mesh(new THREE.CircleGeometry(0.08,10),neonMat(c,i===2?1.3:0.35));
    l.position.set(0,2.9+dy,0.13);g.add(l);
  });
  return g;
}

function makeHydrant(){
  const g=new THREE.Group();
  const b=new THREE.Mesh(new THREE.CylinderGeometry(.16,.19,.55,10),mat(0xd23b34));b.position.y=.28;g.add(b);
  const cap=new THREE.Mesh(new THREE.SphereGeometry(.16,10,8),mat(0xd23b34));cap.position.y=.56;g.add(cap);
  [-1,1].forEach(s=>{const a=new THREE.Mesh(new THREE.CylinderGeometry(.06,.06,.16,8),mat(0xb02f28));
    a.rotation.z=Math.PI/2;a.position.set(s*0.19,.36,0);g.add(a);});
  addOutline(g,0.05);
  return g;
}

function makeTrashCan(){
  const g=new THREE.Group();
  const b=new THREE.Mesh(new THREE.CylinderGeometry(.28,.24,.72,12,1,true),mat(0x3d4148));b.position.y=.36;g.add(b);
  const bag=new THREE.Mesh(new THREE.SphereGeometry(.24,8,6),mat(0x1f2126));bag.position.y=.74;bag.scale.y=.6;g.add(bag);
  addOutline(g,0.04);
  return g;
}

function makeBench(){
  const g=new THREE.Group();
  const seat=new THREE.Mesh(new THREE.BoxGeometry(1.3,0.09,0.42),mat(0x7a5535));seat.position.y=.44;g.add(seat);
  const back=new THREE.Mesh(new THREE.BoxGeometry(1.3,0.4,0.08),mat(0x7a5535));back.position.set(0,.66,-.18);g.add(back);
  [-1,1].forEach(s=>{const l=new THREE.Mesh(new THREE.BoxGeometry(0.09,0.44,0.4),mat(0x33363c));
    l.position.set(s*0.55,.22,0);g.add(l);});
  addOutline(g,0.04);
  return g;
}

function makeHotDogCart(){
  const g=new THREE.Group();
  const cart=new THREE.Mesh(new THREE.BoxGeometry(1.0,0.55,0.62),mat(0xdedad2));cart.position.y=.6;g.add(cart);
  const top=new THREE.Mesh(new THREE.BoxGeometry(1.04,0.08,0.66),mat(0x9aa0a8));top.position.y=.9;g.add(top);
  [-1,1].forEach(s=>{const w=new THREE.Mesh(new THREE.CylinderGeometry(.2,.2,.08,10),mat(0x2a2d33));
    w.rotation.x=Math.PI/2;w.position.set(s*0.38,.2,0);g.add(w);});
  const pole=new THREE.Mesh(new THREE.CylinderGeometry(.04,.04,1.1,6),mat(0x8a8f97));pole.position.y=1.45;g.add(pole);
  const umb=new THREE.Mesh(new THREE.ConeGeometry(0.95,0.42,10),mat(pick([0xf0c33c,0x3f7fd0,0xd8493f])));
  umb.position.y=2.1;g.add(umb);
  addOutline(g,0.03);
  return g;
}

function makeWaterTower(){
  const g=new THREE.Group();
  const barrel=new THREE.Mesh(new THREE.CylinderGeometry(.62,.68,1.15,12),mat(0x7a5a3c));barrel.position.y=1.55;g.add(barrel);
  const lid=new THREE.Mesh(new THREE.ConeGeometry(.74,.42,12),mat(0x5f452e));lid.position.y=2.3;g.add(lid);
  for(let i=0;i<4;i++){
    const a=i/4*Math.PI*2;
    const leg=new THREE.Mesh(new THREE.BoxGeometry(0.09,1.0,0.09),mat(0x5f452e));
    leg.position.set(Math.cos(a)*0.48,0.5,Math.sin(a)*0.48);g.add(leg);
  }
  const band=new THREE.Mesh(new THREE.TorusGeometry(.66,.04,6,16),mat(0x3f3226));
  band.rotation.x=Math.PI/2;band.position.y=1.55;g.add(band);
  return g;
}

function makeSubwayEntrance(){
  const g=new THREE.Group();
  const mouth=new THREE.Mesh(new THREE.BoxGeometry(1.5,0.12,1.1),mat(0x25282d));mouth.position.y=.06;g.add(mouth);
  for(let i=0;i<4;i++){
    const st=new THREE.Mesh(new THREE.BoxGeometry(1.3,0.1,0.22),mat(0x4a4e55));
    st.position.set(0,0.02-i*0.05,0.4-i*0.24);g.add(st);
  }
  [-1,1].forEach(s=>{
    const r=new THREE.Mesh(new THREE.BoxGeometry(0.08,0.9,1.1),mat(0x2f6b3f));
    r.position.set(s*0.72,0.45,0);g.add(r);
  });
  const post=new THREE.Mesh(new THREE.CylinderGeometry(.06,.06,2.0,8),mat(0x2f6b3f));post.position.set(0.85,1.0,0.5);g.add(post);
  const globe=new THREE.Mesh(new THREE.SphereGeometry(.2,10,10),neonMat(0x6be07a,1.1));globe.position.set(0.85,2.1,0.5);g.add(globe);
  const sign=new THREE.Mesh(new THREE.BoxGeometry(0.7,0.34,0.05),neonMat(0xf0f0f0,0.35));sign.position.set(0,1.2,-0.6);g.add(sign);
  return g;
}

function makeBillboardTower(){
  const g=new THREE.Group();
  const seed=Math.floor(Math.random()*1000);
  const h=4.5+Math.random()*3;
  const core=towerBox(1.5,h,1.2,0x5e636b,seed,0x4a4e55);core.position.y=h/2;g.add(core);
  const neons=[0xff3b6b,0x3bd7ff,0xffd23b,0x7a5bff,0x49f08a,0xff7a2f];
  for(let i=0;i<3+Math.floor(Math.random()*3);i++){
    const bw=0.9+Math.random()*0.9, bh=0.6+Math.random()*0.9;
    const panel=new THREE.Mesh(new THREE.BoxGeometry(bw,bh,0.09),neonMat(pick(neons),1.5));
    const face=Math.floor(Math.random()*4), a=face*Math.PI/2;
    panel.position.set(Math.sin(a)*0.66,0.9+Math.random()*(h-1.6),Math.cos(a)*0.66);
    panel.rotation.y=a;
    panel.userData.neon=true;
    g.add(panel);
  }
  const crown=new THREE.Mesh(new THREE.BoxGeometry(1.7,0.16,1.4),mat(0x3d4148));crown.position.y=h;g.add(crown);
  g.userData.isBuilding=true;
  return g;
}

function makeColonnade(){
  const g=new THREE.Group();
  const stone=0xd8d2c2;
  const base=new THREE.Mesh(new THREE.BoxGeometry(3.2,0.4,1.6),mat(0xc4bdac));base.position.y=.2;g.add(base);
  for(let i=0;i<5;i++){
    const c=new THREE.Mesh(new THREE.CylinderGeometry(.16,.18,2.2,12),mat(stone));
    c.position.set(-1.3+i*0.65,1.5,0.5);g.add(c);
  }
  const arch=new THREE.Mesh(new THREE.BoxGeometry(3.2,0.35,1.6),mat(stone));arch.position.y=2.75;g.add(arch);
  const ped=new THREE.Mesh(new THREE.ConeGeometry(1.9,0.7,4),mat(stone));
  ped.rotation.y=Math.PI/4;ped.position.y=3.25;ped.scale.z=0.5;g.add(ped);
  const wall=new THREE.Mesh(new THREE.BoxGeometry(3.0,2.4,0.3),mat(0xbfb8a8));wall.position.set(0,1.6,-0.5);g.add(wall);
  const flag=new THREE.Mesh(new THREE.BoxGeometry(1.1,0.7,0.04),mat(0x2f4b8f));
  flag.position.set(0,2.1,0.72);g.add(flag);
  return g;
}

function makeRock(c=0x8f8c86){
  const r=new THREE.Mesh(new THREE.IcosahedronGeometry(.5+Math.random()*.5,0),mat(c));
  r.position.y=.35;r.rotation.set(Math.random(),Math.random(),Math.random());
  const g=new THREE.Group();g.add(r);return g;
}

function makeMailbox(){
  const g=new THREE.Group();
  const box=new THREE.Mesh(new THREE.BoxGeometry(.6,.75,.5),mat(0x2f5fa8));
  box.position.y=.55;g.add(box);
  const lid=new THREE.Mesh(new THREE.CylinderGeometry(.25,.25,.6,12,1,false,0,Math.PI),mat(0x2f5fa8));
  lid.rotation.z=Math.PI/2;lid.position.y=.93;g.add(lid);
  [-1,1].forEach(s=>{const l=new THREE.Mesh(new THREE.BoxGeometry(0.07,0.22,0.07),mat(0x1e3f70));
    l.position.set(s*0.2,.11,0);g.add(l);});
  const slot=new THREE.Mesh(new THREE.BoxGeometry(.34,.06,.04),mat(0x16305a));slot.position.set(0,.72,.26);g.add(slot);
  addOutline(g,0.04);
  return g;
}

function makeStreetSign(){
  const g=new THREE.Group();
  const post=new THREE.Mesh(new THREE.CylinderGeometry(.06,.06,3.0,8),mat(0x2f7a4a));post.position.y=1.5;g.add(post);
  const blade=new THREE.Mesh(new THREE.BoxGeometry(1.7,.34,.06),mat(0x2f7a4a));blade.position.y=2.85;g.add(blade);
  const blade2=new THREE.Mesh(new THREE.BoxGeometry(.06,.34,1.4),mat(0x2f7a4a));blade2.position.y=2.5;g.add(blade2);
  addOutline(g,0.03);
  return g;
}

/* ---- landmarks ---- */
function makeEmpireState(){
  const g=new THREE.Group();
  const seed=7;
  const stone=0xb9b2a2;
  const tiers=[[3.4,3.2,3.0],[2.6,4.4,2.4],[1.9,4.6,1.8],[1.3,3.4,1.2]];
  let y=0;
  tiers.forEach((t,i)=>{
    const seg=towerBox(t[0],t[1],t[2],stone,seed+i,0xa79f8f);
    seg.position.y=y+t[1]/2;g.add(seg);
    const lip=new THREE.Mesh(new THREE.BoxGeometry(t[0]+0.2,0.18,t[2]+0.2),mat(0x8f8878));
    lip.position.y=y+t[1];g.add(lip);
    y+=t[1];
  });
  const crown=new THREE.Mesh(new THREE.CylinderGeometry(0.45,0.75,1.8,12),mat(0xa79f8f));
  crown.position.y=y+0.9;g.add(crown);
  const mast=new THREE.Mesh(new THREE.CylinderGeometry(0.06,0.16,3.4,8),mat(0x6e6a62));
  mast.position.y=y+3.5;g.add(mast);
  const beacon=new THREE.Mesh(new THREE.SphereGeometry(0.2,10,10),neonMat(0xff4d6d,1.6));
  beacon.position.y=y+5.3;g.add(beacon);
  g.userData.isBuilding=true;
  return g;
}

function makeStatueOfLiberty(){
  const g=new THREE.Group();
  const copper=0x76bfa5;
  const base=new THREE.Mesh(new THREE.BoxGeometry(3.0,1.2,3.0),mat(0xa79b88));base.position.y=.6;g.add(base);
  const ped=new THREE.Mesh(new THREE.CylinderGeometry(1.0,1.3,2.6,8),mat(0xbdb1a0));ped.position.y=2.5;g.add(ped);
  const robe=new THREE.Mesh(new THREE.CylinderGeometry(0.42,0.8,3.0,10),mat(copper));robe.position.y=5.3;g.add(robe);
  const torso=new THREE.Mesh(new THREE.CylinderGeometry(0.34,0.44,1.0,10),mat(copper));torso.position.y=7.2;g.add(torso);
  const head=new THREE.Mesh(new THREE.SphereGeometry(0.32,12,12),mat(copper));head.position.y=7.95;g.add(head);
  for(let i=0;i<7;i++){
    const a=(i/6-0.5)*Math.PI*1.15;
    const sp=new THREE.Mesh(new THREE.ConeGeometry(0.07,0.55,4),mat(copper));
    sp.position.set(Math.sin(a)*0.34,8.28,Math.cos(a)*0.34);
    sp.rotation.set(Math.cos(a)*0.5,0,-Math.sin(a)*0.5);g.add(sp);
  }
  const arm=new THREE.Mesh(new THREE.CylinderGeometry(0.13,0.15,1.9,8),mat(copper));
  arm.position.set(0.62,8.2,0);arm.rotation.z=-0.35;g.add(arm);
  const torch=new THREE.Mesh(new THREE.CylinderGeometry(0.22,0.12,0.4,8),mat(0xd9b45a));
  torch.position.set(0.98,9.2,0);g.add(torch);
  const flame=new THREE.Mesh(new THREE.ConeGeometry(0.24,0.62,8),neonMat(0xffd257,1.8));
  flame.position.set(0.98,9.7,0);g.add(flame);
  const tablet=new THREE.Mesh(new THREE.BoxGeometry(0.5,0.66,0.14),mat(copper));
  tablet.position.set(-0.5,7.1,0.24);tablet.rotation.z=0.3;g.add(tablet);
  return g;
}

function makeBridgeTower(){
  const g=new THREE.Group();
  const stone=0xa08c76;
  const pier=new THREE.Mesh(new THREE.BoxGeometry(2.6,3.0,1.5),mat(stone));pier.position.y=1.5;g.add(pier);
  // two gothic arch openings
  [-0.65,0.65].forEach(x=>{
    const hole=new THREE.Mesh(new THREE.BoxGeometry(0.75,1.5,1.7),mat(0x2c3038));
    hole.position.set(x,1.3,0);g.add(hole);
    const top=new THREE.Mesh(new THREE.ConeGeometry(0.55,0.9,4),mat(0x2c3038));
    top.rotation.y=Math.PI/4;top.position.set(x,2.4,0);top.scale.z=1.1;g.add(top);
  });
  const upper=new THREE.Mesh(new THREE.BoxGeometry(2.6,2.6,1.5),mat(stone));upper.position.y=4.3;g.add(upper);
  const cap=new THREE.Mesh(new THREE.BoxGeometry(2.9,0.3,1.8),mat(0x8b7862));cap.position.y=5.7;g.add(cap);
  // suspension cables sweeping away on both sides
  [-1,1].forEach(s=>{
    for(let i=0;i<2;i++){
      const cable=new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.05,7.5,6),mat(0x4d5158));
      cable.position.set(s*3.4,4.0,-0.5+i*1.0);
      cable.rotation.z=s*1.02;g.add(cable);
    }
  });
  const deck=new THREE.Mesh(new THREE.BoxGeometry(11,0.22,2.4),mat(0x55585f));deck.position.y=1.9;g.add(deck);
  g.userData.isBuilding=true;
  return g;
}

function makeTimesSquareSign(){
  const g=new THREE.Group();
  const seed=21;
  const core=towerBox(2.2,7.5,2.0,0x4e535b,seed,0x3d4148);core.position.y=3.75;g.add(core);
  const neons=[0xff2e63,0x2ee6ff,0xffe02e,0x8a2eff,0x2eff8a,0xff8a2e];
  for(let i=0;i<12;i++){
    const bw=1.1+Math.random()*0.8,bh=0.7+Math.random()*1.0;
    const p=new THREE.Mesh(new THREE.BoxGeometry(bw,bh,0.1),neonMat(neons[i%neons.length],1.6));
    const a=Math.floor(Math.random()*4)*Math.PI/2;
    p.position.set(Math.sin(a)*1.06,0.8+Math.random()*6.2,Math.cos(a)*1.06);
    p.rotation.y=a;p.userData.neon=true;g.add(p);
  }
  const ticker=new THREE.Mesh(new THREE.CylinderGeometry(1.25,1.25,0.5,16,1,true),neonMat(0xff3b3b,1.4));
  ticker.position.y=0.9;g.add(ticker);
  const mast=new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.1,2.4,6),mat(0x3d4148));mast.position.y=8.6;g.add(mast);
  const ball=new THREE.Mesh(new THREE.IcosahedronGeometry(0.42,1),neonMat(0xdff3ff,1.8));ball.position.y=9.9;g.add(ball);
  g.userData.isBuilding=true;
  return g;
}

function makeParkFountain(){
  const g=new THREE.Group();
  const basin=new THREE.Mesh(new THREE.CylinderGeometry(2.4,2.6,0.5,20),mat(0xc9c2b2));basin.position.y=.25;g.add(basin);
  const water=new THREE.Mesh(new THREE.CylinderGeometry(2.2,2.2,0.12,20),
    new THREE.MeshStandardMaterial({color:0x4f9fc4,roughness:.15,metalness:.3,transparent:true,opacity:.9}));
  water.position.y=.5;g.add(water);
  const col=new THREE.Mesh(new THREE.CylinderGeometry(0.3,0.45,1.5,12),mat(0xd6cfbe));col.position.y=1.2;g.add(col);
  const dish=new THREE.Mesh(new THREE.CylinderGeometry(1.0,0.3,0.28,16),mat(0xd6cfbe));dish.position.y=2.0;g.add(dish);
  const angel=new THREE.Mesh(new THREE.CylinderGeometry(0.18,0.26,1.1,10),mat(0x7fbfa8));angel.position.y=2.7;g.add(angel);
  const head=new THREE.Mesh(new THREE.SphereGeometry(0.22,10,10),mat(0x7fbfa8));head.position.y=3.4;g.add(head);
  [-1,1].forEach(s=>{const w=new THREE.Mesh(new THREE.BoxGeometry(0.1,0.9,0.5),mat(0x8fcfb8));
    w.position.set(s*0.3,2.9,-0.2);w.rotation.z=s*0.35;g.add(w);});
  // ring of park trees around the plaza
  for(let i=0;i<8;i++){
    const a=i/8*Math.PI*2;
    const t=makeParkTree();
    t.position.set(Math.cos(a)*4.6,0,Math.sin(a)*4.6);
    g.add(t);
  }
  return g;
}

function makeTheatreMarquee(){
  const g=new THREE.Group();
  const seed=31;
  const body=towerBox(3.4,4.2,2.2,0x8a5a42,seed,0x6f4b3a);body.position.y=2.1;g.add(body);
  const canopy=new THREE.Mesh(new THREE.BoxGeometry(4.0,0.5,1.5),mat(0x3a2c24));
  canopy.position.set(0,2.0,1.5);g.add(canopy);
  const sign=new THREE.Mesh(new THREE.BoxGeometry(3.6,0.9,0.12),neonMat(0xff3b6b,1.5));
  sign.position.set(0,2.9,2.2);sign.userData.neon=true;g.add(sign);
  // bulb border
  for(let i=0;i<14;i++){
    const b=new THREE.Mesh(new THREE.SphereGeometry(0.09,6,6),neonMat(0xffe9a8,1.6));
    b.position.set(-1.9+i*0.29,1.78,2.2);b.userData.neon=true;g.add(b);
  }
  const vert=new THREE.Mesh(new THREE.BoxGeometry(0.7,3.0,0.12),neonMat(0x2ee6ff,1.4));
  vert.position.set(-2.0,4.2,1.3);vert.userData.neon=true;g.add(vert);
  const sax=new THREE.Mesh(new THREE.TorusGeometry(0.5,0.12,8,16,Math.PI*1.4),neonMat(0xffd257,1.4));
  sax.position.set(2.0,4.2,1.3);sax.userData.neon=true;g.add(sax);
  g.userData.isBuilding=true;
  return g;
}

/* ---- street critters: the city's finest sewer rats ---- */
function makeSlime() {
  const g = new THREE.Group();
  const fur = pick([0x6c6a66,0x585652,0x7a736a]);
  // children[0] stays the body: the hop animation drives its local Y
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), mat(fur));
  body.scale.set(1.0,0.8,1.35);
  body.position.y = 0.35;
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), mat(fur));
  head.position.set(0,0.4,0.42); g.add(head);
  const snout = new THREE.Mesh(new THREE.ConeGeometry(0.1,0.24,8), mat(fur));
  snout.rotation.x=Math.PI/2; snout.position.set(0,0.36,0.63); g.add(snout);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.055,6,6), mat(0xff9db1));
  nose.position.set(0,0.36,0.75); g.add(nose);
  [-1,1].forEach(s=>{
    const ear = new THREE.Mesh(new THREE.CircleGeometry(0.15,10), mat(0xd98fa0));
    ear.position.set(s*0.17,0.56,0.36); ear.rotation.y=s*0.5; g.add(ear);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05,6,6), mat(0x101014));
    eye.position.set(s*0.1,0.45,0.6); g.add(eye);
  });
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.02,0.9,6), mat(0xc9a0a8));
  tail.position.set(0,0.3,-0.55); tail.rotation.x=1.15; g.add(tail);
  addOutline(g,0.04);
  g.userData = { hp: 30, state: 'idle', timer: 0, isSlime: true };
  return g;
}

/* ---------------- NPCs & quests ---------------- */
const NPC_DATA=[
  { id:'Deli Owner', color:0xdca34a, d:['Hey, walkin\' here!','Run this bagel order uptown for me?'], q:{type:'delivery', target:1} },
  { id:'Cab Driver', color:0xf7c331, d:['Traffic is murder today.','Rats are chewing my tires — clear three out!'], q:{type:'hunt', target:'Slime', count:3} },
  { id:'Street Artist', color:0x8a5bd6, d:['Spray can\'s empty, kid.','Nice hat though.'] },
  { id:'Beat Cop', color:0x2f4b8f, d:['Keep it moving.','Five rats off my block and we\'re square.'], q:{type:'hunt', target:'Slime', count:5} }
];

function makeNpcDir(i){
  const r=REGIONS[i%REGIONS.length];
  const offset=randDir().multiplyScalar(0.4);
  return r.dir.clone().add(offset).normalize();
}

function spawnNPCs(){
  NPC_DATA.forEach((d,i)=>{
    const grp=makeCharacter(d.color,0xffffff);
    grp.scale.setScalar(1.0);
    const nd=makeNpcDir(i);
    placeOnSurface(grp,nd,0);
    grp.traverse(o=>{if(o.isMesh)o.castShadow=true;});
    const ring=new THREE.Mesh(new THREE.TorusGeometry(1.3,.08,8,24), new THREE.MeshBasicMaterial({color:0xffe07a}));
    ring.rotation.x=Math.PI/2;ring.position.y=.05;grp.add(ring);
    scene.add(grp);
    npcs.push({...d,group:grp,dir:nd,ring,index:i});
  });
}

function tryInteract(){
  const pPos = player.dir.clone().multiplyScalar(PLANET_R);
  let closest = null, minD = 2.0;
  npcs.forEach((b,i)=>{
    const bPos = b.dir.clone().multiplyScalar(PLANET_R);
    if(pPos.distanceTo(bPos)<minD){closest=i; minD=pPos.distanceTo(bPos);}
  });
  if(closest!==null){
    const n = npcs[closest];
    if(quest && quest.type==='delivery' && quest.target===closest) {
      showDialogue(n.id, ["Ah, the letter! Thank you!"]);
      finishQuest();
    } else if (quest && quest.type==='hunt' && quest.npcIndex===closest && quest.progress>=quest.count) {
      showDialogue(n.id, ["You did it! The town is safer now!"]);
      finishQuest();
    } else if (!quest && n.q) {
      showDialogue(n.id, n.d, ()=>{
        quest = { ...n.q, npcIndex:closest, progress:0 };
        toast(`New Quest: ${quest.type==='hunt'? 'Hunt '+quest.count+' '+quest.target+'s' : 'Deliver to NPC '+(quest.target+1)}!`);
        if(quest.type === 'delivery') carryParcel();
        updateJournal();
      });
    } else {
      showDialogue(n.id, n.d);
    }
  }
}

function checkHuntProgress(target) {
  if (quest && quest.type === 'hunt' && quest.target === target && quest.progress < quest.count) {
    quest.progress++;
    toast(`Quest Progress: ${quest.progress}/${quest.count} ${target}s`);
    if (quest.progress >= quest.count) {
      toast(`Quest complete! Return to NPC ${quest.npcIndex+1}`);
    }
    updateJournal();
  }
}

function finishQuest() {
  if(quest && quest.type === 'delivery') dropParcel();
  quest = null;
  compassArrow.visible = false;
  deliveriesDone++;
  addXP(50);
  addGems(5);
  sfx('secret');
  updateJournal();
  saveProgress();
}

function updateJournal(){
  document.getElementById('jLevel').textContent=playerLevel;
  document.getElementById('jVillageLevel').textContent=Math.floor(buildingsBuilt / 3) + 1;
  document.getElementById('jBuildings').textContent=buildingsBuilt;
  document.getElementById('jXP').textContent=playerXP+' / '+(playerLevel*100);
  document.getElementById('jDeliveries').textContent=deliveriesDone;
  document.getElementById('jGems').textContent=gemCount;
}

function showDialogue(name, lines, onComplete) {
  document.getElementById('dialogue').classList.remove('hidden');
  document.getElementById('dlgName').textContent=name;
  let i=0;
  document.getElementById('dlgText').textContent=lines[i];
  document.getElementById('dlgAction').onclick=()=>{
    i++;
    if(i<lines.length) document.getElementById('dlgText').textContent=lines[i];
    else { hideDialogue(); if(onComplete)onComplete(); }
  };
}
function hideDialogue(){document.getElementById('dialogue').classList.add('hidden');}

/* ---------------- Gems / collectibles ---------------- */
function spawnGems(){
  for(let i=0;i<24;i++){
    const n=randDir();
    // subway tokens: spinning brass coins instead of crystals
    const g=new THREE.Group();
    const coinMat=new THREE.MeshStandardMaterial({color:0xffc93c,emissive:0xff9a1f,emissiveIntensity:.5,metalness:.55,roughness:.3});
    const coin=new THREE.Mesh(new THREE.CylinderGeometry(.34,.34,.09,18),coinMat);
    coin.rotation.x=Math.PI/2;g.add(coin);
    const rim=new THREE.Mesh(new THREE.TorusGeometry(.34,.05,6,18),coinMat);g.add(rim);
    const hole=new THREE.Mesh(new THREE.CylinderGeometry(.1,.1,.14,10),
      new THREE.MeshStandardMaterial({color:0x8a5f16,emissive:0x4a3208,emissiveIntensity:.4}));
    hole.rotation.x=Math.PI/2;g.add(hole);
    placeOnSurface(g,n,1.0);
    g.castShadow=true;
    g.userData.dir=n;
    scene.add(g);gems.push(g);
  }
  gemsTotal=gems.length;
}
let gemsTotal=0;

/* ---------------- Simulated multiplayer bots ---------------- */
const BOT_NAMES=['Luna','Koa','Mira','Bramble','Echo','Sora','Pixel','Wren'];
const BOT_EMOTES=['👋','😄','💖','✨','🎉','🌸'];
function spawnBots(){
  const n=4+Math.floor(Math.random()*3);
  for(let i=0;i<n;i++){
    const grp=makeCharacter(PALETTE[i%PALETTE.length],PALETTE[(i+3)%PALETTE.length]);
    const d=randDir();
    const fwd=tangent(d);
    const tag=document.createElement('div');tag.className='nameTag';tag.textContent=BOT_NAMES[i%BOT_NAMES.length];
    document.body.appendChild(tag);
    scene.add(grp);
    bots.push({group:grp,dir:d,forward:fwd,turn:(Math.random()-.5),speed:.4+Math.random()*.4,tag,emoteTimer:3+Math.random()*6,name:BOT_NAMES[i%BOT_NAMES.length]});
  }
  const totalBots = bots.length + 1;
  const ot = document.getElementById('onlineText');
  if(ot) ot.innerHTML = totalBots > 1 ? `Explorers online: <span id="onlineCount">${totalBots}</span>` : `Exploring solo`;
}

/* ---------------- Player ---------------- */
function tangent(d){
  // any vector tangent to sphere at d
  const t=new THREE.Vector3(0,1,0);
  if(Math.abs(d.y)>.9)t.set(1,0,0);
  return t.sub(d.clone().multiplyScalar(t.dot(d))).normalize();
}
function spawnPlayer(){
  const grp=makeCharacter(chosenBody,chosenHat);
  const d=REGIONS[0].dir.clone();
  scene.add(grp);

  const gliderGrp = new THREE.Group();
  const wing = new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 1), mat(0xffd36e));
  wing.position.y = 2.5;
  wing.position.z = 0.2;
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1), mat(0x8a5a3a));
  handle.position.y = 2.0;
  handle.position.z = 0.2;
  gliderGrp.add(wing);
  gliderGrp.add(handle);
  gliderGrp.visible = false;
  grp.add(gliderGrp);

  const tag=document.createElement('div');tag.className='nameTag';tag.textContent=playerName+' (you)';tag.style.background='rgba(123,104,238,.9)';
  document.body.appendChild(tag);
  const totalBots = typeof bots !== 'undefined' ? bots.length + 1 : 1;
  const ot = document.getElementById('onlineText');
  if(ot) ot.innerHTML = totalBots > 1 ? `Explorers online: <span id="onlineCount">${totalBots}</span>` : `Exploring solo`;
  // Messenger's blade. Parented to the right arm so it follows the walk cycle,
  // with the group origin at the grip so attacks swing from the hand.
  weaponMesh = new THREE.Group();
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(.06,.06,.28,6), mat(0x6b4423));
  const guard = new THREE.Mesh(new THREE.BoxGeometry(.34,.08,.2), mat(0xb08d57));
  guard.position.y = .18;
  const blade = new THREE.Mesh(new THREE.BoxGeometry(.09,.85,.16), mat(0xdcdfe6));
  blade.position.y = .62;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(.09,.22,4), mat(0xdcdfe6));
  tip.position.y = 1.14; tip.rotation.y = Math.PI/4;
  weaponMesh.add(grip, guard, blade, tip);
  addOutline(weaponMesh);
  weaponMesh.rotation.x = WEAPON_REST_X;
  const rightArm = grp.children.find(o=>o.name==='arm' && o.userData.swing===1);
  if(rightArm){ weaponMesh.position.set(0,-.45,.08); rightArm.add(weaponMesh); }
  else { weaponMesh.position.set(.66,.56,.08); grp.add(weaponMesh); }

  player={group:grp,dir:d,forward:tangent(d),tag,walkPhase:0, altitude:0, velocity_y:0, isGliding:false, glider:gliderGrp};
  document.getElementById('nameInput').value=playerName;
}

/* ---------------- Controls ---------------- */
function bindControls(){
  addEventListener('mousedown', e => {
    if(e.button === 0 && document.getElementById('chatInputBox').classList.contains('hidden') && document.getElementById('buildMenu').classList.contains('hidden') && document.getElementById('dialogue').classList.contains('hidden') && document.getElementById('customizer').classList.contains('hidden')) {
      attack();
    }
  });
  addEventListener('keydown',e=>{
    const chatBox = document.getElementById('chatInputBox');
    if (chatBox && !chatBox.classList.contains('hidden')) {
      if (e.code === 'Enter') {
        const txt = document.getElementById('chatInput').value;
        if (txt.trim()) {
           spawnChatBubble(player.group, txt);
           netSend({t: 'chat', msg: txt});
        }
        document.getElementById('chatInput').value = '';
        chatBox.classList.add('hidden');
        renderer.domElement.focus();
      }
      if (e.code === 'Escape') {
        chatBox.classList.add('hidden');
        renderer.domElement.focus();
      }
      return; // prevent movement keys
    }

    if (e.code === 'Enter') {
      chatBox.classList.remove('hidden');
      document.getElementById('chatInput').focus();
      e.preventDefault();
      return;
    }

    keys[e.code]=true;
    if(e.code==='KeyE')tryInteract();
    if(e.code==='KeyF')attack();
    if(e.code==='KeyB')document.getElementById('buildMenu').classList.toggle('hidden');
    if(/Digit[1-6]/.test(e.code))doEmote(EMOJIS[+e.code.slice(5)-1]);
  });
  addEventListener('keyup',e=>keys[e.code]=false);

  const cv=renderer.domElement;
  cv.addEventListener('mousedown',e=>{dragging=true;lastX=e.clientX;lastY=e.clientY;});
  addEventListener('mouseup',()=>dragging=false);
  addEventListener('mousemove',e=>{
    if(!dragging)return;
    camYaw   -= (e.clientX-lastX)*0.005;
    camPitch = Math.min(1.2,Math.max(-.2,camPitch+(e.clientY-lastY)*0.004));
    lastX=e.clientX;lastY=e.clientY;
  });
  cv.addEventListener('wheel',e=>{camDist=Math.min(26,Math.max(7,camDist+e.deltaY*0.01));});

  // touch camera (right side of screen)
  let tId=null;
  cv.addEventListener('touchstart',e=>{const t=e.changedTouches[0];if(t.clientX>innerWidth*0.45){tId=t.identifier;lastX=t.clientX;lastY=t.clientY;}},{passive:true});
  cv.addEventListener('touchmove',e=>{for(const t of e.changedTouches){if(t.identifier===tId){
    camYaw-=(t.clientX-lastX)*0.006;camPitch=Math.min(1.2,Math.max(-.2,camPitch+(t.clientY-lastY)*0.005));lastX=t.clientX;lastY=t.clientY;}}},{passive:true});
  cv.addEventListener('touchend',()=>tId=null);

  document.getElementById('helpBtn').onclick=()=>document.getElementById('helpCard').classList.toggle('hidden');
  document.getElementById('closeHelp').onclick=()=>document.getElementById('helpCard').classList.add('hidden');
  document.getElementById('interactBtn').onclick=tryInteract;
  
  const bBtn = document.getElementById('openBuildBtn');
  if(bBtn) bBtn.onclick = () => document.getElementById('buildMenu').classList.toggle('hidden');
}

const EMOJIS=['👋','😄','💖','🎉','✨','😮'];
function buildEmojiBar(){
  const bar=document.getElementById('emojiBar');
  EMOJIS.forEach(e=>{const b=document.createElement('button');b.textContent=e;b.onclick=()=>doEmote(e);bar.appendChild(b);});
}

/* ---------------- Mobile joystick ---------------- */
function setupMobile(){
  const touch=('ontouchstart'in window)||navigator.maxTouchPoints>0;
  if(!touch)return;
  document.getElementById('joystick').style.display='block';
  document.getElementById('interactBtn').style.display='block';
  const joy=document.getElementById('joystick'),stick=document.getElementById('stick');
  let jId=null;const R=35;
  function set(cx,cy,t){const r=joy.getBoundingClientRect();let dx=t.clientX-(r.left+r.width/2),dy=t.clientY-(r.top+r.height/2);
    const d=Math.hypot(dx,dy)||1;const cl=Math.min(d,R);dx=dx/d*cl;dy=dy/d*cl;
    stick.style.transform=`translate(${dx}px,${dy}px)`;joyVec.x=dx/R;joyVec.y=dy/R;}
  joy.addEventListener('touchstart',e=>{const t=e.changedTouches[0];jId=t.identifier;set(0,0,t);},{passive:true});
  joy.addEventListener('touchmove',e=>{for(const t of e.changedTouches)if(t.identifier===jId)set(0,0,t);},{passive:true});
  joy.addEventListener('touchend',()=>{jId=null;joyVec.x=joyVec.y=0;stick.style.transform='translate(0,0)';});
}

function buildProp(type, cost) {
  if (gemCount < cost) {
    toast(`Not enough tokens! Need ${cost} 🪙`);
    return;
  }
  addGems(-cost);
  document.getElementById('buildMenu').classList.add('hidden');
  
  const placeDir = player.dir.clone().add(player.forward.clone().multiplyScalar(-0.25)).normalize();
  let obj = null;
  if (type === 'House') obj = makeHouse();
  else if (type === 'Tree') obj = makeTree();
  else if (type === 'Mailbox') obj = makeMailbox();
  
  if(obj) {
    obj.rotateY(Math.random()*Math.PI*2);
    placeOnSurface(obj, placeDir);
    obj.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
    scene.add(obj);
    props.push(obj);
    spawnEmote(obj, '✨');
    buildingsBuilt++;
    updateJournal();
    
    // Sync to server
    const msg = {
      t: 'build',
      type: type,
      dx: placeDir.x, dy: placeDir.y, dz: placeDir.z,
      ry: obj.rotation.y
    };
    netSend(msg);
    sfx('pop');
    toast(`Built a ${type}!`);
    addXP(10);
  }
}

function updateHP(amt) {
  if (amt < 0) sfx('hit');
  playerHP = Math.min(maxHP, Math.max(0, playerHP + amt));
  const hpBar = document.getElementById('hpBar');
  if(hpBar) {
    hpBar.style.width = (playerHP / maxHP * 100) + '%';
    document.getElementById('hpText').textContent = `${playerHP} / ${maxHP} HP`;
  }
  
  if (playerHP <= 0) {
    toast("You were defeated! Respawning...");
    player.dir.copy(randDir());
    player.forward.copy(randDir()).cross(player.dir).normalize();
    playerHP = maxHP;
    updateHP(0);
    if(gemCount > 0) addGems(-Math.min(gemCount, 5));
  }
}

function attack() {
  if (isAttacking) return;
  isAttacking = true;
  attackTimer = ATTACK_DUR;
  sfx('attack');
  
  const hitDist = 1.8;
  const attackDir = player.forward.clone().normalize();
  const playerPos = player.dir.clone().multiplyScalar(PLANET_R);
  
  slimes.forEach(s => {
    if (s.userData.hp <= 0) return;
    const sPos = s.userData.dir.clone().multiplyScalar(PLANET_R);
    const dist = playerPos.distanceTo(sPos);
    if (dist < hitDist) {
      const toSlime = sPos.clone().sub(playerPos).normalize();
      if (attackDir.dot(toSlime) > 0.4) {
        s.userData.hp -= 15;
        sfx('hit');
        s.children[0].material.color.setHex(0xffffff);
        setTimeout(() => { if(s.children[0]) s.children[0].material.color.setHex(0x44ffaa); }, 100);
        
        if (s.userData.hp <= 0) {
          scene.remove(s);
          addGems(1);
          addXP(10);
          toast("Chased off a subway rat! 🐀");
          checkHuntProgress('Slime');
        }
      }
    }
  });
}

function carryParcel(){
  dropParcel();
  const box=new THREE.Mesh(new THREE.BoxGeometry(.5,.5,.5),mat(0xc98a4a));
  const tie=new THREE.Mesh(new THREE.BoxGeometry(.52,.1,.52),mat(0xfff3d0));box.add(tie);
  box.position.set(0,1.2,.6);player.group.add(box);parcels.push(box);
}
function dropParcel(){parcels.forEach(p=>p.parent&&p.parent.remove(p));parcels=[];}

function addGems(n){gemCount+=n;document.getElementById('gemCount').textContent=gemCount;sfx('gem');saveProgress();updateJournal();}

/* ---------------- Emotes ---------------- */
function doEmote(e){spawnEmote(player.group,e);sfx('pop');netSend({t:'emote',e});}
function spawnEmote(group,e){
  const b=document.createElement('div');b.className='emoteBubble';b.textContent=e;document.body.appendChild(b);
  const wp=new THREE.Vector3();group.getWorldPosition(wp);wp.y+=0;
  group.userData._emote={el:b,born:performance.now()};
  // position updated in loop; remove after animation
  setTimeout(()=>{b.remove();if(group.userData._emote&&group.userData._emote.el===b)group.userData._emote=null;},1800);
}

/* ---------------- Toast ---------------- */
let toastT;
function toast(msg){const el=document.getElementById('toast');el.textContent=msg;el.classList.add('show');clearTimeout(toastT);toastT=setTimeout(()=>el.classList.remove('show'),2200);}

/* ---------------- Movement on sphere ---------------- */
const _axis=new THREE.Vector3(),_right=new THREE.Vector3();
function moveOnSphere(state,dt,fwdInput,turnInput,speed){
  // turn: rotate forward around current up
  if(turnInput){
    const q=new THREE.Quaternion().setFromAxisAngle(state.dir,-turnInput*TURN_SPEED*dt);
    state.forward.applyQuaternion(q).normalize();
  }
  if(fwdInput){
    _right.crossVectors(state.forward,state.dir).normalize();
    const ang=fwdInput*speed*dt;
    const q=new THREE.Quaternion().setFromAxisAngle(_right,-ang);
    state.dir.applyQuaternion(q).normalize();
    state.forward.applyQuaternion(q).normalize();
  }
  // re-orthonormalize forward against new up
  state.forward.sub(state.dir.clone().multiplyScalar(state.forward.dot(state.dir))).normalize();
  orientGroup(state.group,state.dir,state.forward, state.altitude||0);
}
function orientGroup(group,up,forward, alt=0){
  const h=surfaceHeight(up)+alt;
  group.position.copy(up).multiplyScalar(h);
  _right.crossVectors(forward,up).normalize();
  const m=new THREE.Matrix4().makeBasis(_right,up,forward.clone().negate());
  group.quaternion.setFromRotationMatrix(m);
}

/* ---------------- Main loop ---------------- */
function animate(){
  requestAnimationFrame(animate);
  const dt=Math.min(clock.getDelta(),0.1);
  const now=performance.now();

  if(!gameStarted) {
    idleCamAngle += dt * 0.2;
    camera.position.set(Math.sin(idleCamAngle)*18, 12, Math.cos(idleCamAngle)*18);
    camera.lookAt(0,0,0);
    renderer.render(scene,camera);
    return;
  }

  // --- Player logic below (only if gameStarted) ---
  const t=clock.elapsedTime;

  // ---- player input ----
  let fwd=0,turn=0;
  if(keys['KeyW']||keys['ArrowUp'])fwd+=1;
  if(keys['KeyS']||keys['ArrowDown'])fwd-=1;
  if(keys['KeyA']||keys['ArrowLeft'])turn-=1;
  if(keys['KeyD']||keys['ArrowRight'])turn+=1;
  if(joyVec.x||joyVec.y){fwd+=-joyVec.y;turn+=joyVec.x;}
  const moving=Math.abs(fwd)>0.05||Math.abs(turn)>0.05;
  
  // Sprint
  let curSpeed = MOVE_SPEED;
  if((keys['ShiftLeft']||keys['ShiftRight']) && fwd > 0) curSpeed *= 1.8;
  
  // Jump & Glide
  if(keys['Space']){
    if(player.altitude <= 0){
      player.velocity_y = 6;
      player.altitude = 0.01;
      sfx('jump');
    } else if(player.velocity_y < 0){
      player.isGliding = true;
    }
  } else {
    player.isGliding = false;
  }
  
  if(player.altitude > 0 || player.velocity_y !== 0){
    const grav = player.isGliding ? 2 : 15;
    player.velocity_y -= grav * dt;
    player.altitude += player.velocity_y * dt;
    if(player.altitude <= 0){
      player.altitude = 0;
      player.velocity_y = 0;
      player.isGliding = false;
      sfx('land');
    }
  }
  if(player.glider) player.glider.visible = player.isGliding;

  player._moving=moving;
  moveOnSphere(player,dt,fwd,turn,curSpeed);

  // walk animation
  if(moving && player.altitude <= 0){
    player.walkPhase+=dt*10;
    footstepTimer += dt;
    if(footstepTimer > 0.35) {
      sfx('footstep');
      footstepTimer = 0;
    }
  } else {
    footstepTimer = 0.35;
  }
  animateLimbs(player.group,moving?player.walkPhase:0);

  // ---- camera follow (orbit behind player) ----
  updateCamera(dt);

  // ---- bots (local ambience, removed when real multiplayer connects) ----
  bots.forEach(b=>{
    b.turn+=(Math.random()-.5)*dt*2; b.turn=Math.max(-1,Math.min(1,b.turn));
    moveOnSphere(b,dt,1,b.turn,MOVE_SPEED*b.speed);
    animateLimbs(b.group,t*9);
    b.emoteTimer-=dt;if(b.emoteTimer<=0){b.emoteTimer=4+Math.random()*7;spawnEmote(b.group,BOT_EMOTES[Math.floor(Math.random()*BOT_EMOTES.length)]);}
    projectTag(b.group,b.tag,2.6);
  });

  // ---- NPC bobbing & rings ----
  npcs.forEach(n=>{if(n.ring.visible)n.ring.rotation.z=t*1.5;n.group.userData.head&&(n.group.userData.head.position.y=1.75+Math.sin(t*2+n.index)*0.04);});

  // ---- gems spin/float ----
  gems.forEach(g=>{g.rotation.y+=dt*2;g.position.copy(g.userData.dir).multiplyScalar(surfaceHeight(g.userData.dir)+1.0+Math.sin(t*2+g.id)*0.1);});

  // ---- proximity checks ----
  checkProximity();

  // ---- player tag + emote ----
  projectTag(player.group,player.tag,2.6);
  updateEmoteBubbles();

  // ---- region label + visit tracking ----
  const reg=regionAt(player.dir);
  document.getElementById('regionName').textContent=reg.name;
  if(!visitedRegions.has(reg.name)){visitedRegions.add(reg.name);toast('Discovered '+reg.name+' '+reg.emoji);updateJournal();}

  // ---- secrets, weather, remote players, net sync ----
  checkSecrets();
  updateWeather(dt,t);
  updateRemotePlayers(dt);
  netTick(dt);

  // ---- sun gentle day cycle & sky color ----
  const timeOfDay = t * 0.05;
  const sunHeight = Math.sin(timeOfDay);
  sun.position.set(Math.cos(timeOfDay)*100, sunHeight*100, Math.sin(timeOfDay)*40);
  sun.intensity = Math.max(0, sunHeight) * 1.05 + 0.1;
  
  const nightColor = new THREE.Color(0x141a2e); // city light pollution keeps the sky from going black
  const skyColor = new THREE.Color(SKY_DAY);
  const factor = Math.max(0, -sunHeight);
  skyColor.lerp(nightColor, factor);
  scene.background.copy(skyColor);
  scene.fog.color.copy(skyColor);

  // ---- Fireflies ----
  if (fireflies) {
     const ffOp = Math.max(0, -sunHeight * 1.8);
     fireflies.material.opacity = ffOp;
     if (ffOp > 0) {
        fireflies.rotation.y += dt * 0.05;
        const pos = fireflies.geometry.attributes.position.array;
        for(let i=0; i<pos.length; i+=3) {
           pos[i] += Math.sin(t*3+i)*0.01;
           pos[i+1] += Math.cos(t*4+i)*0.01;
           pos[i+2] += Math.sin(t*2.5+i)*0.01;
        }
        fireflies.geometry.attributes.position.needsUpdate = true;
     }
  }

  // ---- Wind Animation for Trees ----
  props.forEach(p => {
    if (p.userData.isTree) {
       p.children.forEach(c => {
         if (c.geometry && c.geometry.type === 'IcosahedronGeometry') {
            c.rotation.z = Math.sin(t*2 + p.position.x)*0.05;
            c.rotation.x = Math.cos(t*1.5 + p.position.y)*0.05;
         }
       });
    }
  });

  // ---- Neon signs flicker, and burn brighter after dark ----
  if(!_neonCached){
    _neonCached=true;
    props.forEach(p=>p.traverse(o=>{ if(o.userData.neon) neonParts.push(o); }));
  }
  const nightMix = 0.55 + Math.max(0,-sunHeight)*1.1;
  for(let i=0;i<neonParts.length;i++){
    const o=neonParts[i];
    o.material.emissiveIntensity = nightMix*(1.15 + Math.sin(t*(3+i%5)+i)*0.28);
  }

  // ---- Target Compass ----
  if (quest && compassArrow) {
    let targetIdx = quest.target; 
    if (quest.type === 'hunt' && quest.progress >= quest.count) targetIdx = quest.npcIndex;
    
    if (quest.type === 'delivery' || (quest.type === 'hunt' && quest.progress >= quest.count)) {
      compassArrow.visible = true;
      const b = npcs[targetIdx];
      const pPos = player.dir.clone().multiplyScalar(PLANET_R);
      const bPos = b.dir.clone().multiplyScalar(PLANET_R);
      const toB = bPos.clone().sub(pPos).normalize();
      
      const arrPos = player.dir.clone().multiplyScalar(PLANET_R + 1.5).add(player.forward.clone().multiplyScalar(-1.5));
      compassArrow.position.copy(arrPos);
      
      const flatToB = toB.clone().projectOnPlane(player.dir).normalize();
      compassArrow.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,-1), flatToB);
      const upQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0), player.dir);
      compassArrow.quaternion.premultiply(upQ);
    } else {
      compassArrow.visible = false;
    }
  } else if (compassArrow) {
    compassArrow.visible = false;
  }

  // ---- Slime AI ----
  const pPos = player.dir.clone().multiplyScalar(PLANET_R);
  slimes.forEach(s => {
    if (s.userData.hp <= 0) return;
    const sPos = s.userData.dir.clone().multiplyScalar(PLANET_R);
    const dist = pPos.distanceTo(sPos);
    
    s.userData.timer -= dt;
    if (s.userData.timer <= 0) {
      s.userData.timer = 1 + Math.random();
      if (dist < 8) s.userData.forward = pPos.clone().sub(sPos).normalize();
      else s.userData.forward.applyAxisAngle(s.userData.dir, (Math.random()-0.5)*2).normalize();
      s.userData.state = 'hop';
    }
    
    if (s.userData.state === 'hop') {
      const speed = 2 * dt;
      s.userData.dir.add(s.userData.forward.clone().multiplyScalar(speed)).normalize();
      placeOnSurface(s, s.userData.dir);
      
      const tNorm = 1 - s.userData.timer / 1.0; 
      s.children[0].position.y = 0.35 + Math.sin(tNorm * Math.PI) * 0.5;
      
      const targetVec = s.userData.dir.clone().multiplyScalar(PLANET_R).add(s.userData.forward);
      s.lookAt(targetVec);
      
      if (dist < 1.0 && tNorm > 0.5 && !s.userData.hitPlayer) {
        s.userData.hitPlayer = true;
        updateHP(-10);
        sfx('pop');
      }
      if (tNorm > 0.9) {
        s.userData.state = 'idle';
        s.userData.hitPlayer = false;
        s.children[0].position.y = 0.35;
      }
    }
  });

  // ---- Player Attack Animation ----
  if (isAttacking && weaponMesh) {
    attackTimer -= dt;
    const p = Math.min(1, Math.max(0, 1 - attackTimer / ATTACK_DUR));
    weaponMesh.rotation.x = WEAPON_REST_X + Math.sin(p * Math.PI) * WEAPON_SWING;
    if (attackTimer <= 0) {
      isAttacking = false;
      weaponMesh.rotation.x = WEAPON_REST_X;
    }
  }

  renderer.render(scene,camera);
}

function animateLimbs(group,phase){
  group.traverse(o=>{
    if(o.name==='leg')o.rotation.x=Math.sin(phase)*0.5*o.userData.swing;
    if(o.name==='arm')o.rotation.x=-Math.sin(phase)*0.5*o.userData.swing;
  });
}

function updateCamera(dt){
  const up=player.dir;
  // build a frame: camera sits behind the player's forward, elevated along up
  const back=player.forward.clone().negate();
  // apply yaw around up
  const qy=new THREE.Quaternion().setFromAxisAngle(up,camYaw);
  back.applyQuaternion(qy);
  const right=new THREE.Vector3().crossVectors(player.forward,up).normalize();
  const dirToCam=back.clone().multiplyScalar(Math.cos(camPitch)).add(up.clone().multiplyScalar(Math.sin(camPitch))).normalize();
  const target=player.group.position.clone().add(up.clone().multiplyScalar(1.5));
  const desired=target.clone().add(dirToCam.multiplyScalar(camDist));
  camera.position.lerp(desired,1-Math.pow(0.001,dt));
  camera.up.copy(up);
  camera.lookAt(target);
}

function projectTag(group,tag,yOff){
  const wp=new THREE.Vector3();group.getWorldPosition(wp);
  wp.add(player.dir===undefined?new THREE.Vector3():new THREE.Vector3());
  const local=new THREE.Vector3(0,yOff,0).applyQuaternion(group.quaternion).add(group.position);
  local.project(camera);
  if(local.z>1){tag.style.display='none';return;}
  tag.style.display='block';
  tag.style.left=((local.x*.5+.5)*innerWidth)+'px';
  tag.style.top=((-local.y*.5+.5)*innerHeight)+'px';
}
function updateEmoteBubbles(){
  [player,...bots,...net.players.values()].forEach(o=>{
    if(!o||!o.group)return;
    const em=o.group.userData._emote;
    if(em){
      const local=new THREE.Vector3(0,3.2,0).applyQuaternion(o.group.quaternion).add(o.group.position);
      local.project(camera);
      em.el.style.left=((local.x*.5+.5)*innerWidth)+'px';
      em.el.style.top=((-local.y*.5+.5)*innerHeight)+'px';
    }
    const ch=o.group.userData._chat;
    if(ch){
      const local=new THREE.Vector3(0,2.5,0).applyQuaternion(o.group.quaternion).add(o.group.position);
      local.project(camera);
      ch.el.style.left=((local.x*.5+.5)*innerWidth)+'px';
      ch.el.style.top=((-local.y*.5+.5)*innerHeight)+'px';
    }
  });
}

function appendChatLog(name, text) {
  const log = document.getElementById('chatLog');
  if(!log) return;
  const d = document.createElement('div');
  d.className = 'logMsg';
  d.innerHTML = `<span class="name">${name}:</span> ${text}`;
  log.appendChild(d);
  if (log.children.length > 20) log.removeChild(log.firstChild);
  log.scrollTop = log.scrollHeight;
}

function spawnChatBubble(group, text) {
  const b=document.createElement('div');b.className='chatBubble';b.textContent=text;document.body.appendChild(b);
  group.userData._chat={el:b, born:performance.now()};
  setTimeout(()=>{b.remove();if(group.userData._chat&&group.userData._chat.el===b)group.userData._chat=null;}, 4000);
  
  const name = group === player.group ? (player.name || "You") : (group.userData.name || "Someone");
  appendChatLog(name, text);
}

function checkProximity(){
  // NPC interaction
  let near=null,nd=3.0;
  npcs.forEach(n=>{const d=n.group.position.distanceTo(player.group.position);if(d<nd){nd=d;near=n;}});
  activeNPC=near;
  const ib=document.getElementById('interactBtn');
  if(ib.style.display==='block')ib.style.opacity=near?1:.4;
  // auto hint
  if(near&&!document.getElementById('dialogue').classList.contains('hidden')===false){
    document.getElementById('questHint').textContent=`Press E / ✋ to talk to ${near.name}.`;
  }else if(quest){updateQuestPanelHintOnly();}

  // gems pickup
  for(let i=gems.length-1;i>=0;i--){
    if(gems[i].position.distanceTo(player.group.position)<1.6){
      scene.remove(gems[i]);gems.splice(i,1);addGems(1);toast('Found a subway token! 🪙');spawnEmote(player.group,'✨');
    }
  }
}
function updateQuestPanelHintOnly(){
  const h=document.getElementById('questHint');
  if(quest.stage==='pickup')h.textContent='Look for the golden glow.';
  else h.textContent='Follow the green glow.';
}
