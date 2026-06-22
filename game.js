/* =========================================================
   Tiny Planet Messenger — a cozy 3D exploration prototype
   Built with Three.js. Walk around a small spherical planet,
   deliver letters/packages to NPCs, collect gems, emote,
   and explore handcrafted regions.
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
let parcels = [];             // visible carried parcel meshes
const keys = {};
let camYaw = 0, camPitch = 0.35, camDist = 14;
let compassArrow = null;
let fireflies = null;
let dragging = false, lastX = 0, lastY = 0;
let joyVec = {x:0, y:0};
let gemCount = 0;
let playerLevel = 1;
let playerXP = 0;
let activeNPC = null;         // npc in interaction range
let quest = null;             // {from, to, item, stage:'toDeliver'}
let deliveriesDone = 0;
const visitedRegions = new Set();
const foundSecrets = new Set();
let secrets = [];
// networking
const net = { ws:null, connected:false, id:null, players:new Map() };
let chosenBody = '#7b68ee', chosenHat = '#ff7a59', playerName = 'Pip';
const tmpV = new THREE.Vector3 ? new THREE.Vector3() : null;

// ---- Regions (themed biomes) ----
const REGIONS = [
  {name:'Town',      color:0x9ad17a, dir:dir( 20,  10), emoji:'🏘️'},
  {name:'Beach',     color:0xf4e2a8, dir:dir(-10,  70), emoji:'🏖️'},
  {name:'Forest',    color:0x4f9d69, dir:dir( 55, -40), emoji:'🌲'},
  {name:'Industrial',color:0xb9b2a6, dir:dir(-45,-120), emoji:'🏭'},
  {name:'Temple',    color:0xe8c98f, dir:dir(-60,  40), emoji:'⛩️'},
  {name:'Cemetery',  color:0x8fa0b0, dir:dir( 30, 160), emoji:'🪦'},
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
function startGame(){
  // run each build step guarded so any failure is shown, not silent-black
  const steps=[
    ['checking WebGL', ()=>{ if(!hasWebGL()) throw new Error('WebGL is not available in this browser/tab. Try a different browser, enable hardware acceleration, or open the file in a normal browser window.'); }],
    ['scene', setupScene],['planet', buildPlanet],['regions', decorateRegions],
    ['NPCs', spawnNPCs],['gems', spawnGems],['secrets', spawnSecrets],
    ['players', spawnBots],['you', spawnPlayer],['UI', buildEmojiBar],
    ['controls', bindControls],['mobile', setupMobile],['weather', initWeather],
    ['audio', initAudio],['journal', initJournal],['network', connectMultiplayer],
  ];
  document.getElementById('customizer').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  previewRunning=false; // stop customizer render loop
  // free the preview's WebGL context so the main renderer has resources
  try{ if(pRenderer){ pRenderer.forceContextLoss&&pRenderer.forceContextLoss(); pRenderer.dispose&&pRenderer.dispose(); pRenderer=null; } }catch(e){}
  for(const [label,fn] of steps){
    try{ fn(); }
    catch(err){
      console.error('Failed during: '+label, err);
      showFatal('Could not start the game (step: '+label+')', (err&&err.message)||String(err));
      return;
    }
  }
  try{
    clock=new THREE.Clock();
    animate();
    toast('Welcome to your tiny planet! 🌍');
  }catch(err){
    console.error('Render loop error', err);
    showFatal('Rendering error', (err&&err.message)||String(err));
  }
}

function setupScene(){
  scene=new THREE.Scene();
  scene.background=new THREE.Color(0xbfe3ff);
  scene.fog=new THREE.FogExp2(0xbfe3ff,0.006);
  camera=new THREE.PerspectiveCamera(55,innerWidth/innerHeight,.1,400);
  renderer=new THREE.WebGLRenderer({antialias:true});
  renderer.setSize(innerWidth,innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xfff4dd,0x6688aa,0.9));
  sun=new THREE.DirectionalLight(0xfff0d0,1.05);
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

  // fireflies
  const ffGeo = new THREE.BufferGeometry();
  const ffPts = [];
  for(let i=0;i<150;i++){
    const v = randDir().multiplyScalar(PLANET_R + 0.3 + Math.random()*2.5);
    ffPts.push(v.x, v.y, v.z);
  }
  ffGeo.setAttribute('position', new THREE.Float32BufferAttribute(ffPts, 3));
  fireflies = new THREE.Points(ffGeo, new THREE.PointsMaterial({color: 0xccee55, size: 0.4, transparent: true, opacity: 0}));
  scene.add(fireflies);

  addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
}

function buildPlanet(){
  const geo=new THREE.IcosahedronGeometry(PLANET_R,12);
  // displacement for gentle hills + vertex colors by region
  const pos=geo.attributes.position;
  const colors=[];
  const v=new THREE.Vector3();
  for(let i=0;i<pos.count;i++){
    v.set(pos.getX(i),pos.getY(i),pos.getZ(i));
    const n=v.clone().normalize();
    // bumpy noise
    const bump=
      Math.sin(n.x*7)*Math.cos(n.y*6)*0.6+
      Math.sin(n.z*9+n.y*4)*0.4+
      Math.cos(n.x*13+n.z*5)*0.25;
    const r=PLANET_R+bump;
    v.copy(n).multiplyScalar(r);
    pos.setXYZ(i,v.x,v.y,v.z);
    const reg=regionAt(n);
    const c=new THREE.Color(reg.color);
    // slight shade variation
    c.offsetHSL(0,0,(bump)*0.03);
    colors.push(c.r,c.g,c.b);
  }
  geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geo.computeVertexNormals();
  let planetMat;
  try{ 
    planetMat=new THREE.MeshToonMaterial({vertexColors:true}); 
    const g=toonGradient(); if(g)planetMat.gradientMap=g; 
    planetMat.bumpMap = getNoiseTexture();
    planetMat.bumpScale = 0.05;
  }
  catch(e){ planetMat=new THREE.MeshStandardMaterial({vertexColors:true,flatShading:true,roughness:.95}); }
  planet=new THREE.Mesh(geo,planetMat);
  planet.receiveShadow=true;
  scene.add(planet);

  // water shell (oceans show through low areas faintly) — simple translucent sphere
  const sea=new THREE.Mesh(new THREE.SphereGeometry(PLANET_R-0.35,48,48),
    new THREE.MeshStandardMaterial({color:0x66c4e8,transparent:true,opacity:.55,roughness:.3}));
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
function surfaceHeight(n){
  const bump=Math.sin(n.x*7)*Math.cos(n.y*6)*0.6+Math.sin(n.z*9+n.y*4)*0.4+Math.cos(n.x*13+n.z*5)*0.25;
  return PLANET_R+bump;
}

function mat(c){return toonMat(c);}

/* ---------------- Region decorations ---------------- */
function decorateRegions(){
  for(let i=0;i<140;i++){
    const n=randDir();
    const reg=regionAt(n);
    let obj=null;
    if(reg.name==='Forest')      obj=makeTree();
    else if(reg.name==='Town')   obj=Math.random()<.5?makeHouse():makeTree();
    else if(reg.name==='Beach')  obj=Math.random()<.4?makePalm():makeRock(0xf0dca0);
    else if(reg.name==='Industrial')obj=Math.random()<.5?makeCrate():makeChimney();
    else if(reg.name==='Temple') obj=Math.random()<.4?makePillar():makeRock(0xc8b48a);
    else if(reg.name==='Cemetery')obj=Math.random()<.6?makeGrave():makeTree(0x6a7a6a);
    if(!obj)continue;
    obj.rotateY(Math.random()*Math.PI*2);
    placeOnSurface(obj,n);
    obj.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
    scene.add(obj);props.push(obj);
  }
  // region marker signposts at each region center
  REGIONS.forEach(r=>{
    const grp=new THREE.Group();
    const post=new THREE.Mesh(new THREE.CylinderGeometry(.12,.12,2,6),mat(0x8a5a3a));post.position.y=1;grp.add(post);
    const sign=new THREE.Mesh(new THREE.BoxGeometry(1.6,.7,.12),mat(0xead7a6));sign.position.y=1.8;grp.add(sign);
    placeOnSurface(grp,r.dir);grp.rotateY(Math.random());
    grp.traverse(o=>{if(o.isMesh)o.castShadow=true;});
    scene.add(grp);
  });
}
function makeTree(leaf=0x3f9d54){
  const g=new THREE.Group();
  const t=new THREE.Mesh(new THREE.CylinderGeometry(.18,.26,1.1,6),mat(0x7a4a2a));t.position.y=.55;g.add(t);
  const l=new THREE.Mesh(new THREE.IcosahedronGeometry(.9,0),mat(leaf));l.position.y=1.55;g.add(l);
  const l2=new THREE.Mesh(new THREE.IcosahedronGeometry(.6,0),mat(leaf));l2.position.set(.2,2.1,0);g.add(l2);
  g.scale.setScalar(.8+Math.random()*.5);
  g.userData.isTree=true;
  return g;
}
function makePalm(){
  const g=new THREE.Group();
  const t=new THREE.Mesh(new THREE.CylinderGeometry(.12,.2,1.8,6),mat(0xb08456));t.position.y=.9;t.rotation.z=.15;g.add(t);
  for(let i=0;i<5;i++){const f=new THREE.Mesh(new THREE.ConeGeometry(.18,1.1,4),mat(0x4fb06a));
    f.position.set(0,1.8,0);f.rotation.z=Math.PI/2.4;f.rotation.y=i/5*Math.PI*2;g.add(f);}
  return g;
}
function makeHouse(){
  const g=new THREE.Group();
  const cols=[0xff9e6d,0x7b9bd1,0xf4c95d,0xe87a90];
  const base=new THREE.Mesh(new THREE.BoxGeometry(1.4,1.1,1.4),mat(cols[Math.floor(Math.random()*cols.length)]));
  base.position.y=.55;g.add(base);
  const roof=new THREE.Mesh(new THREE.ConeGeometry(1.15,.8,4),mat(0x9c4a3a));roof.position.y=1.5;roof.rotation.y=Math.PI/4;g.add(roof);
  return g;
}
function makeRock(c=0x9aa0a8){const r=new THREE.Mesh(new THREE.IcosahedronGeometry(.5+Math.random()*.5,0),mat(c));r.position.y=.4;const g=new THREE.Group();g.add(r);return g;}
function makeCrate(){const g=new THREE.Group();const b=new THREE.Mesh(new THREE.BoxGeometry(.8,.8,.8),mat(0xb88a4a));b.position.y=.4;g.add(b);return g;}
function makeChimney(){const g=new THREE.Group();const b=new THREE.Mesh(new THREE.CylinderGeometry(.4,.5,2.4,8),mat(0x9b938a));b.position.y=1.2;g.add(b);return g;}
function makePillar(){const g=new THREE.Group();const b=new THREE.Mesh(new THREE.CylinderGeometry(.3,.34,2.2,10),mat(0xe2d2a8));b.position.y=1.1;g.add(b);const top=new THREE.Mesh(new THREE.BoxGeometry(.9,.3,.9),mat(0xd8c69a));top.position.y=2.3;g.add(top);return g;}
function makeGrave(){const g=new THREE.Group();const b=new THREE.Mesh(new THREE.BoxGeometry(.5,.8,.15),mat(0x9aa6b0));b.position.y=.4;g.add(b);const top=new THREE.Mesh(new THREE.CylinderGeometry(.25,.25,.15,12,1,false,0,Math.PI),mat(0x9aa6b0));top.position.y=.8;top.rotation.x=Math.PI/2;g.add(top);return g;}
function makeMailbox(){
  const g=new THREE.Group();
  const post=new THREE.Mesh(new THREE.CylinderGeometry(.08,.08,.8,6),mat(0x7a4a2a));
  post.position.y=.4;g.add(post);
  const box=new THREE.Mesh(new THREE.BoxGeometry(.4,.3,.6),mat(0x3a6a9a));
  box.position.y=.8;box.position.z=.1;g.add(box);
  const flag=new THREE.Mesh(new THREE.BoxGeometry(.05,.2,.05),mat(0xff3333));
  flag.position.set(.22, .9, .2);g.add(flag);
  return g;
}

/* ---------------- NPCs & quests ---------------- */
const NPC_DATA=[
  {name:'Mabel',  emoji:'🧓', col:0xff7a59, lines:["Oh hello, little messenger!","Could you take this warm pie to Tobias by the beach?"], item:'🥧 Pie'},
  {name:'Tobias', emoji:'🧑‍🦱', col:0x46c2cb, lines:["A package for me? Lovely!","Would you carry this seashell letter to Old Finn at the temple?"], item:'🐚 Shell letter'},
  {name:'Old Finn',emoji:'🧙', col:0xe8c98f, lines:["The winds told me you'd come.","Bring this lantern to Greta in the forest, will you?"], item:'🏮 Lantern'},
  {name:'Greta',  emoji:'👩‍🌾', col:0x3f9d54, lines:["You found me among the trees!","Please deliver these seeds to Rusty at the workshop."], item:'🌱 Seed pouch'},
  {name:'Rusty',  emoji:'🧑‍🔧', col:0xb9b2a6, lines:["Grease and gears, a visitor!","Take this gizmo to Vesper at the old cemetery."], item:'⚙️ Gizmo'},
  {name:'Vesper', emoji:'🧛', col:0x8fa0b0, lines:["Quiet here, isn't it?","Carry my thank-you note all the way back to Mabel in town."], item:'💌 Note'},
];
function makeNpcDir(i){
  // scatter NPCs roughly near different regions
  const r=REGIONS[i%REGIONS.length];
  const offset=randDir().multiplyScalar(0.4);
  return r.dir.clone().add(offset).normalize();
}
function spawnNPCs(){
  NPC_DATA.forEach((d,i)=>{
    const grp=makeCharacter(d.col,0xffffff);
    grp.scale.setScalar(1.0);
    const nd=makeNpcDir(i);
    placeOnSurface(grp,nd,0);
    grp.traverse(o=>{if(o.isMesh)o.castShadow=true;});
    // glow ring
    const ring=new THREE.Mesh(new THREE.TorusGeometry(1.3,.08,8,24),
      new THREE.MeshBasicMaterial({color:0xffe07a}));
    ring.rotation.x=Math.PI/2;ring.position.y=.05;grp.add(ring);
    scene.add(grp);
    npcs.push({...d,group:grp,dir:nd,ring,index:i});
  });
  startQuestFrom(0);
}
function startQuestFrom(i){
  const from=npcs[i], to=npcs[(i+1)%npcs.length];
  quest={fromIdx:i,toIdx:(i+1)%npcs.length,item:from.item,stage:'pickup',from,to};
  updateQuestPanel();
  highlightTargets();
}
function highlightTargets(){
  npcs.forEach((n,i)=>{
    const isTarget = quest && ((quest.stage==='pickup'&&i===quest.fromIdx)||(quest.stage==='deliver'&&i===quest.toIdx));
    n.ring.visible=isTarget;
    n.ring.material.color.set(quest&&quest.stage==='deliver'&&i===quest.toIdx?0x8ef0a0:0xffe07a);
  });
}
function updateQuestPanel(){
  const t=document.getElementById('questText'), h=document.getElementById('questHint');
  if(!quest){t.textContent='All caught up! Wander and collect 💎.';h.textContent='';return;}
  if(quest.stage==='pickup'){
    t.innerHTML=`Visit <b>${quest.from.name}</b> ${quest.from.emoji} to pick up a delivery.`;
    h.textContent=`Look for the golden glow.`;
  }else{
    t.innerHTML=`Deliver ${quest.item} to <b>${quest.to.name}</b> ${quest.to.emoji}.`;
    h.textContent=`Carried in your satchel — follow the green glow.`;
  }
}

/* ---------------- Gems / collectibles ---------------- */
function spawnGems(){
  for(let i=0;i<24;i++){
    const n=randDir();
    const g=new THREE.Mesh(new THREE.OctahedronGeometry(.4,0),
      new THREE.MeshStandardMaterial({color:0x6be0ff,emissive:0x1a8cff,emissiveIntensity:.5,flatShading:true,roughness:.2}));
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
  document.getElementById('onlineCount').textContent=bots.length+1;
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
  player={group:grp,dir:d,forward:tangent(d),tag,walkPhase:0, altitude:0, velocity_y:0, isGliding:false, glider:gliderGrp};
  document.getElementById('nameInput').value=playerName;
}

/* ---------------- Controls ---------------- */
function bindControls(){
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

/* ---------------- Interaction ---------------- */
function tryInteract(){
  if(!activeNPC)return;
  const n=activeNPC;
  if(quest&&quest.stage==='pickup'&&n.index===quest.fromIdx){
    showDialogue(n,()=>{
      quest.stage='deliver';
      carryParcel(quest.item);
      updateQuestPanel();highlightTargets();hideDialogue();
      toast('Picked up '+quest.item+'!');
    },'Accept ▶');
  }else if(quest&&quest.stage==='deliver'&&n.index===quest.toIdx){
    showDialogue(n,()=>{
      dropParcel();
      toast('Delivered! +1 💎 +50 XP');
      addGems(1);
      deliveriesDone++;
      addXP(50);
      sfx('deliver');
      netSend({t:'delivery'});
      hideDialogue();
      updateJournal();
      // next quest in the chain
      startQuestFrom(quest.toIdx);
    },'Hand over ✦', "Thank you, messenger! That means a lot.");
  }else{
    // idle chatter
    showDialogue(n,hideDialogue,'Bye 👋', n.lines[0]);
  }
}
function showDialogue(n,action,label,overrideText){
  document.getElementById('dlgAvatar').textContent=n.emoji;
  document.getElementById('dlgName').textContent=n.name;
  document.getElementById('dlgText').textContent=overrideText||n.lines.join(' ');
  const btn=document.getElementById('dlgAction');btn.textContent=label;btn.onclick=action;
  document.getElementById('dialogue').classList.remove('hidden');
}
function hideDialogue(){document.getElementById('dialogue').classList.add('hidden');}

function buildProp(type, cost) {
  if (gemCount < cost) {
    toast(`Not enough gems! Need ${cost} 💎`);
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
  const dt=Math.min(clock.getDelta(),0.05);
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
      sfx('pop');
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
    }
  }
  if(player.glider) player.glider.visible = player.isGliding;

  player._moving=moving;
  moveOnSphere(player,dt,fwd,turn,curSpeed);

  // walk animation
  if(moving){player.walkPhase+=dt*10;}
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
  
  const nightColor = new THREE.Color(0x0a1020);
  const skyColor = new THREE.Color().copy(scene.background);
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
         if (c.geometry.type === 'IcosahedronGeometry') {
            c.rotation.z = Math.sin(t*2 + p.position.x)*0.05;
            c.rotation.x = Math.cos(t*1.5 + p.position.y)*0.05;
         }
       });
    }
  });

  // ---- Target Compass ----
  if (quest && compassArrow) {
    compassArrow.visible = true;
    const targetNPC = quest.stage === 'pickup' ? quest.from : quest.to;
    compassArrow.position.copy(player.group.position).add(player.dir.clone().multiplyScalar(3.0));
    compassArrow.lookAt(targetNPC.group.position);
    compassArrow.position.add(player.dir.clone().multiplyScalar(Math.sin(t*4)*0.1));
  } else if (compassArrow) {
    compassArrow.visible = false;
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

function spawnChatBubble(group, text) {
  const b=document.createElement('div');b.className='chatBubble';b.textContent=text;document.body.appendChild(b);
  group.userData._chat={el:b, born:performance.now()};
  setTimeout(()=>{b.remove();if(group.userData._chat&&group.userData._chat.el===b)group.userData._chat=null;}, 4000);
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
      scene.remove(gems[i]);gems.splice(i,1);addGems(1);toast('Found a gem! 💎');spawnEmote(player.group,'✨');
    }
  }
}
function updateQuestPanelHintOnly(){
  const h=document.getElementById('questHint');
  if(quest.stage==='pickup')h.textContent='Look for the golden glow.';
  else h.textContent='Follow the green glow.';
}
