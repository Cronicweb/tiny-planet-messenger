// audio.js - Synthesized procedural audio system for Tiny Planet Messenger

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playTone(freq, type, duration, vol=1, slideFreq=0) {
  if(audioCtx.state === 'suspended') audioCtx.resume();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  
  osc.type = type;
  osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
  if(slideFreq) {
    osc.frequency.exponentialRampToValueAtTime(slideFreq, audioCtx.currentTime + duration);
  }
  
  gain.gain.setValueAtTime(vol, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
  
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  
  osc.start();
  osc.stop(audioCtx.currentTime + duration);
}

function playNoise(duration, vol) {
  if(audioCtx.state === 'suspended') audioCtx.resume();
  const bufferSize = audioCtx.sampleRate * duration;
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  const noise = audioCtx.createBufferSource();
  noise.buffer = buffer;
  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(vol, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
  
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 1000;

  noise.connect(filter);
  filter.connect(gain);
  gain.connect(audioCtx.destination);
  noise.start();
}

window.sounds = {
  footstepGrass: () => playNoise(0.1, 0.15),
  footstepStone: () => playTone(300, 'triangle', 0.05, 0.1),
  jump: () => playTone(150, 'sine', 0.3, 0.2, 400),
  land: () => {
    playTone(80, 'square', 0.1, 0.3, 20);
    playNoise(0.1, 0.3);
  },
  attack: () => {
    playNoise(0.2, 0.3);
    playTone(600, 'sine', 0.1, 0.1, 200);
  },
  hit: () => playTone(200, 'sawtooth', 0.1, 0.3, 50),
  pickup: () => {
    playTone(800, 'sine', 0.1, 0.2);
    setTimeout(() => playTone(1200, 'sine', 0.2, 0.2), 100);
  },
  questComplete: () => {
    playTone(400, 'square', 0.1, 0.2);
    setTimeout(() => playTone(500, 'square', 0.1, 0.2), 150);
    setTimeout(() => playTone(600, 'square', 0.3, 0.2), 300);
  },
  uiClick: () => playTone(1000, 'sine', 0.05, 0.1)
};

let ambientNoiseNode = null;
window.startAmbientSound = function() {
  if (ambientNoiseNode) return;
  if(audioCtx.state === 'suspended') audioCtx.resume();
  
  const bufferSize = audioCtx.sampleRate * 2;
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  
  ambientNoiseNode = audioCtx.createBufferSource();
  ambientNoiseNode.buffer = buffer;
  ambientNoiseNode.loop = true;
  
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 400; // soft wind
  
  const gain = audioCtx.createGain();
  gain.gain.value = 0.04;
  
  ambientNoiseNode.connect(filter);
  filter.connect(gain);
  gain.connect(audioCtx.destination);
  ambientNoiseNode.start();
};
