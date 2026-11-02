import React, { useState, useEffect, useRef } from "react";
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";
import {
  getDatabase,
  ref,
  set,
  get,
  update,
  push,
  remove,
  onValue,
  onChildAdded,
  onChildChanged,
  onDisconnect,
  query,
  limitToLast,
  orderByChild,
  endAt,
  increment,
} from "firebase/database";
import {
  Trophy,
  Users,
  Send,
  Play,
  Copy,
  Check,
  Volume2,
  VolumeX,
  RotateCcw,
  Flame,
  LogOut,
  Crown,
  Timer,
} from "lucide-react";

// ----------------------------------------------------
// Firebase
// ----------------------------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyB1zyPU8qR6bkfVBq9A2l2TLFh0YTHk5zs",
  authDomain: "haxballturbo.firebaseapp.com",
  databaseURL:
    "https://haxballturbo-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "haxballturbo",
  storageBucket: "haxballturbo.firebasestorage.app",
  messagingSenderId: "642562260545",
  appId: "1:642562260545:web:5e6d1afdd86b6dd82190c0",
  measurementId: "G-H3LQB3H6VW",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// Hora del servidor de Firebase (igual para todos, aunque cada PC tenga su reloj)
let serverOffset = 0;
onValue(ref(db, ".info/serverTimeOffset"), (snap) => {
  serverOffset = snap.val() || 0;
});
const serverNow = () => Date.now() + serverOffset;

// ----------------------------------------------------
// Campo (medidas parecidas al estadio "Classic" de Haxball)
// ----------------------------------------------------
const CW = 900; // tamaño del canvas
const CH = 480;
const PITCH = { left: 30, right: 870, top: 40, bottom: 440 }; // 840 x 400
const CX = CW / 2;
const CY = CH / 2;
const GOAL_HALF = 64;
const GOAL_TOP = CY - GOAL_HALF;
const GOAL_BOTTOM = CY + GOAL_HALF;
const GOAL_DEPTH = 28;
const POST_R = 8;
const PLAYER_R = 16; // un pelín más grandes que en Haxball (15)
const BALL_R = 9.5; // un pelín más pequeño que en Haxball (10) para controlar mejor

// ----------------------------------------------------
// Física (valores de Haxball, por "tick" a 60 ticks/s)
// ----------------------------------------------------
const PLAYER_ACCEL = 0.1;
const PLAYER_ACCEL_KICKING = 0.07; // vas más lento mientras mantienes chutar
const PLAYER_DAMPING = 0.96;
const BALL_DAMPING = 0.99;
const KICK_STRENGTH = 5;
const KICK_DIST = 7; // margen extra para alcanzar el balón al chutar (Haxball: 4)
const PLAYER_INV_MASS = 0.5; // el jugador pesa el doble que el balón
const BALL_INV_MASS = 1;

// Rebotes (0 = nada, 1 = rebote perfecto)
const REST_WALL = 0.72; // balón contra la pared: alto para jugar con las paredes
const REST_PLAYER_BALL = 0.1; // balón contra jugador: bajo = se queda pegado al pie para encadenar toques
// Cuánto empuja el balón al jugador al chocar (0 = nada, control absoluto;
// 0.1 = se nota un poco; 0.5 = como en Haxball original)
const PLAYER_INV_VS_BALL = 0;
const REST_PLAYER_PLAYER = 0.25;
const REST_POST = 0.5;
const REST_NET = 0.05;

// ----------------------------------------------------
// Red
// ----------------------------------------------------
// Versión del juego: si una sala se creó con otra versión, los datos no encajan
// (pasa si alguien no recarga la página después de un cambio). Súbela al cambiar
// el formato de los datos.
const GAME_VERSION = 10;
const MAX_PLAYERS = 12; // 6 contra 6
const SYNC_MS = 33; // 30 envíos/s
const SYNC_MS_CROWDED = 50; // 20 envíos/s cuando hay más de 8 jugadores
const KICK_HOLD_MS = 120; // un toque corto cuenta como chut
const GOAL_RESET_MS = 2000; // tiempo entre el gol y el saque
const CENTER_R = 75; // círculo central (saque)
const ROOM_STALE_MS = 10 * 60 * 1000; // salas sin actividad 10 min → se borran
const ACTIVE_EVERY_MS = 60 * 1000; // el host marca la sala como activa cada minuto
const LOBBY_EVERY_MS = 10 * 1000; // el host actualiza la lista de salas cada 10 s
const LOBBY_FRESH_MS = 45 * 1000; // en la lista solo salen salas actualizadas hace < 45 s

// Opciones de partido (0 = sin límite)
const SCORE_LIMITS = [0, 3, 5, 7, 10];
const TIME_LIMITS = [0, 3, 5, 7, 10]; // minutos
const DEFAULT_SCORE_LIMIT = 3;
const DEFAULT_TIME_LIMIT = 3;

const RED = "#e56e56";
const RED_LIGHT = "#f4a796";
const BLUE = "#5689e5";
const BLUE_LIGHT = "#97b6f2";

const POSTS = [
  { x: PITCH.left, y: GOAL_TOP },
  { x: PITCH.left, y: GOAL_BOTTOM },
  { x: PITCH.right, y: GOAL_TOP },
  { x: PITCH.right, y: GOAL_BOTTOM },
];
// Postes como discos fijos (inv = 0 → no se mueven)
const POST_DISCS = POSTS.map((p) => ({
  x: p.x,
  y: p.y,
  vx: 0,
  vy: 0,
  r: POST_R,
  inv: 0,
}));

const DPR =
  typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 2) : 1;

// Ritmo del juego (1 = Haxball original). NORMAL va un pelín más rápido.
const SPEEDS = [
  { label: "CLÁSICO", val: 1 },
  { label: "NORMAL", val: 1.12 },
  { label: "RÁPIDO", val: 1.3 },
];
const DEFAULT_SPEED = 1.12;

const lerp = (a, b, t) => a + (b - a) * t;
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;

// Formato compacto para la red: "x,y,vx,vy,chutando,hora"
// La hora de envío sirve para colocar cada dato en su momento exacto
// y que el movimiento de los demás se vea fluido aunque la red vaya a saltos.
const posBody = (p) =>
  `${r1(p.x)},${r1(p.y)},${r2(p.vx || 0)},${r2(p.vy || 0)},${
    p.isKicking ? 1 : 0
  }`;
const encPos = (p) => `${posBody(p)},${Date.now()}`;
const decPos = (s) => {
  if (typeof s !== "string") return null;
  const a = s.split(",");
  return {
    x: +a[0],
    y: +a[1],
    vx: +a[2] || 0,
    vy: +a[3] || 0,
    k: a[4] === "1",
    t: +a[5] || 0, // 0 = sin hora (no se usa para calcular relojes)
  };
};
// Balón: "x,y,vx,vy,chuts,cambioDeDueño,dueño,hora"
const ballBody = (b, c, o) =>
  `${r1(b.x)},${r1(b.y)},${r2(b.vx)},${r2(b.vy)},${b.k || 0},${c},${o || ""}`;
// sinHora: cuando el que escribe no es el dueño (al pasar el balón a otro),
// no ponemos su hora, porque es de otro reloj y descuadraría los cálculos
const encBall = (b, c, o, sinHora = false) =>
  `${ballBody(b, c, o)},${sinHora ? 0 : Date.now()}`;
const decBall = (s) => {
  if (typeof s !== "string") return null;
  const a = s.split(",");
  return {
    x: +a[0],
    y: +a[1],
    vx: +a[2] || 0,
    vy: +a[3] || 0,
    k: +a[4] || 0,
    c: +a[5] || 0,
    o: a[6] || null,
    t: +a[7] || 0,
  };
};

// Cada ordenador tiene su reloj: calculamos la diferencia con cada jugador
// (quedándonos con el mensaje que llegó más rápido) para pasar su hora a la nuestra.
const clockOffsets = {};
const toLocalTime = (id, sentAt) => {
  const d = Date.now() - sentAt;
  let o = clockOffsets[id];
  if (o === undefined || d < o) o = d;
  else o += (d - o) * 0.005; // se adapta despacio si la conexión cambia
  clockOffsets[id] = o;
  return sentAt + o;
};

// Posición de otro jugador "en el pasado reciente", entre dos datos recibidos
const interpPlayer = (p, renderT, tickRate) => {
  const s = p.snaps || (p.snaps = []);
  const n = s.length;
  if (!n) return;
  if (renderT <= s[0].t) {
    p.x = s[0].x;
    p.y = s[0].y;
    p.vx = s[0].vx;
    p.vy = s[0].vy;
    return;
  }
  const lastS = s[n - 1];
  if (renderT >= lastS.t) {
    // Sin datos nuevos todavía: seguimos su movimiento un poco (máx. 100 ms)
    const ticks = (Math.min(renderT - lastS.t, 100) / 1000) * tickRate;
    p.x = lastS.x + lastS.vx * ticks;
    p.y = lastS.y + lastS.vy * ticks;
    p.vx = lastS.vx;
    p.vy = lastS.vy;
    return;
  }
  let i = n - 1;
  while (i > 0 && s[i - 1].t > renderT) i--;
  const a = s[i - 1];
  const b = s[i];
  const f = (renderT - a.t) / Math.max(1, b.t - a.t);
  p.x = lerp(a.x, b.x, f);
  p.y = lerp(a.y, b.y, f);
  p.vx = lerp(a.vx, b.vx, f);
  p.vy = lerp(a.vy, b.vy, f);
  // Tiramos lo viejo
  while (s.length > 2 && s[1].t < renderT - 500) s.shift();
};

// Dónde está AHORA otro jugador (para los choques), a partir de su último dato.
// Se dibuja un poco en el pasado para que sea fluido, pero choca donde está de verdad.
const estimatePresent = (p, tickRate) => {
  const s = p.snaps || (p.snaps = []);
  const lastS = s[s.length - 1];
  if (!lastS) {
    p.cx = p.x;
    p.cy = p.y;
    p.cvx = p.vx || 0;
    p.cvy = p.vy || 0;
    return;
  }
  const ticks = (Math.min(Math.max(Date.now() - lastS.t, 0), 150) / 1000) * tickRate;
  p.cx = lastS.x + lastS.vx * ticks;
  p.cy = lastS.y + lastS.vy * ticks;
  p.cvx = lastS.vx;
  p.cvy = lastS.vy;
};

// Posición de saque: cada jugador del equipo en una altura distinta
const spawnPos = (team, rank = 0) => {
  const offsets = [0, -70, 70, -140, 140, -35, 35, -105, 105];
  return {
    x: team === "red" ? CX - 280 : CX + 280,
    y: CY + (offsets[rank] ?? 0),
  };
};

// Choque entre dos discos (igual que Haxball)
function collide(a, b, restitution) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const rsum = a.r + b.r;
  if (dx > rsum || dx < -rsum || dy > rsum || dy < -rsum) return false;
  const d = Math.hypot(dx, dy);
  if (d >= rsum || d === 0) return false;
  const massSum = a.inv + b.inv;
  if (massSum === 0) return false;
  const nx = dx / d;
  const ny = dy / d;
  const pen = rsum - d;
  a.x += nx * pen * (a.inv / massSum);
  a.y += ny * pen * (a.inv / massSum);
  b.x -= nx * pen * (b.inv / massSum);
  b.y -= ny * pen * (b.inv / massSum);
  const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
  if (rel < 0) {
    const j = (-(1 + restitution) * rel) / massSum;
    a.vx += nx * j * a.inv;
    a.vy += ny * j * a.inv;
    b.vx -= nx * j * b.inv;
    b.vy -= ny * j * b.inv;
  }
  return true;
}

// Paredes del balón. Devuelve el equipo que marca o null.
function ballWalls(b) {
  const inMouth = b.y > GOAL_TOP && b.y < GOAL_BOTTOM;

  // Bandas de arriba y abajo
  if (b.y - BALL_R < PITCH.top) {
    b.y = PITCH.top + BALL_R;
    if (b.vy < 0) b.vy = -b.vy * REST_WALL;
  } else if (b.y + BALL_R > PITCH.bottom) {
    b.y = PITCH.bottom - BALL_R;
    if (b.vy > 0) b.vy = -b.vy * REST_WALL;
  }

  // Lado izquierdo
  if (b.x >= PITCH.left) {
    if (!inMouth && b.x - BALL_R < PITCH.left) {
      b.x = PITCH.left + BALL_R;
      if (b.vx < 0) b.vx = -b.vx * REST_WALL;
    }
  } else {
    if (b.y - BALL_R < GOAL_TOP) {
      b.y = GOAL_TOP + BALL_R;
      if (b.vy < 0) b.vy = -b.vy * REST_NET;
    } else if (b.y + BALL_R > GOAL_BOTTOM) {
      b.y = GOAL_BOTTOM - BALL_R;
      if (b.vy > 0) b.vy = -b.vy * REST_NET;
    }
    if (b.x - BALL_R < PITCH.left - GOAL_DEPTH) {
      b.x = PITCH.left - GOAL_DEPTH + BALL_R;
      if (b.vx < 0) b.vx = -b.vx * REST_NET;
    }
  }

  // Lado derecho
  if (b.x <= PITCH.right) {
    if (!inMouth && b.x + BALL_R > PITCH.right) {
      b.x = PITCH.right - BALL_R;
      if (b.vx > 0) b.vx = -b.vx * REST_WALL;
    }
  } else {
    if (b.y - BALL_R < GOAL_TOP) {
      b.y = GOAL_TOP + BALL_R;
      if (b.vy < 0) b.vy = -b.vy * REST_NET;
    } else if (b.y + BALL_R > GOAL_BOTTOM) {
      b.y = GOAL_BOTTOM - BALL_R;
      if (b.vy > 0) b.vy = -b.vy * REST_NET;
    }
    if (b.x + BALL_R > PITCH.right + GOAL_DEPTH) {
      b.x = PITCH.right + GOAL_DEPTH - BALL_R;
      if (b.vx > 0) b.vx = -b.vx * REST_NET;
    }
  }

  if (b.x < PITCH.left) return "blue"; // entra en la portería roja
  if (b.x > PITCH.right) return "red"; // entra en la portería azul
  return null;
}

// ----------------------------------------------------
// Sonido
// ----------------------------------------------------
class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.lastKick = 0;
  }

  init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
  }

  playKick() {
    if (this.muted) return;
    // Con muchos jugadores, que no se acumulen sonidos
    const nowMs = performance.now();
    if (nowMs - this.lastKick < 60) return;
    this.lastKick = nowMs;
    this.init();
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.1);
    gain.gain.setValueAtTime(0.5, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.1);
  }

  playGoal() {
    if (this.muted) return;
    this.init();
    const now = this.ctx.currentTime;
    [261.63, 329.63, 392, 523.25].forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const start = now + idx * 0.09;
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.25, start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.6);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(start);
      osc.stop(start + 0.6);
    });
  }
}

const sounds = new SoundEngine();

// ----------------------------------------------------
// Gráficos: todo lo que no cambia se dibuja una vez y se reutiliza
// ----------------------------------------------------
const makeCanvas = (w, h) => {
  const c = document.createElement("canvas");
  c.width = Math.ceil(w * DPR);
  c.height = Math.ceil(h * DPR);
  const g = c.getContext("2d");
  g.scale(DPR, DPR);
  return [c, g];
};

// Campo
function buildField() {
  const [c, g] = makeCanvas(CW, CH);

  const sw = 56;
  for (let x = 0, i = 0; x < CW; x += sw, i++) {
    g.fillStyle = i % 2 === 0 ? "#718c5a" : "#6a8553";
    g.fillRect(x, 0, sw, CH);
  }

  g.fillStyle = "rgba(0,0,0,0.12)";
  g.fillRect(0, 0, CW, PITCH.top);
  g.fillRect(0, PITCH.bottom, CW, CH - PITCH.bottom);
  g.fillRect(0, PITCH.top, PITCH.left, PITCH.bottom - PITCH.top);
  g.fillRect(PITCH.right, PITCH.top, CW - PITCH.right, PITCH.bottom - PITCH.top);

  // Paredes: una franja clara pegada a la línea para que se vean bien
  g.fillStyle = "rgba(255,255,255,0.06)";
  g.fillRect(PITCH.left, PITCH.top, PITCH.right - PITCH.left, 6);
  g.fillRect(PITCH.left, PITCH.bottom - 6, PITCH.right - PITCH.left, 6);

  g.strokeStyle = "rgba(255,255,255,0.85)";
  g.lineWidth = 3;
  g.lineJoin = "round";
  g.strokeRect(
    PITCH.left,
    PITCH.top,
    PITCH.right - PITCH.left,
    PITCH.bottom - PITCH.top
  );
  g.beginPath();
  g.moveTo(CX, PITCH.top);
  g.lineTo(CX, PITCH.bottom);
  g.stroke();
  g.beginPath();
  g.arc(CX, CY, 75, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = "rgba(255,255,255,0.85)";
  g.beginPath();
  g.arc(CX, CY, 4, 0, Math.PI * 2);
  g.fill();

  g.lineWidth = 2;
  g.strokeStyle = "rgba(255,255,255,0.35)";
  g.beginPath();
  g.arc(PITCH.left, CY, 110, -Math.PI / 2, Math.PI / 2);
  g.stroke();
  g.beginPath();
  g.arc(PITCH.right, CY, 110, Math.PI / 2, (Math.PI * 3) / 2);
  g.stroke();

  [
    { x: PITCH.left, dir: -1 },
    { x: PITCH.right, dir: 1 },
  ].forEach((gl) => {
    const x0 = gl.dir < 0 ? gl.x - GOAL_DEPTH : gl.x;
    g.fillStyle = "rgba(255,255,255,0.12)";
    g.fillRect(x0, GOAL_TOP, GOAL_DEPTH, GOAL_HALF * 2);

    g.strokeStyle = "rgba(255,255,255,0.25)";
    g.lineWidth = 1;
    for (let y = GOAL_TOP; y <= GOAL_BOTTOM; y += 8) {
      g.beginPath();
      g.moveTo(x0, y);
      g.lineTo(x0 + GOAL_DEPTH, y);
      g.stroke();
    }
    for (let x = x0; x <= x0 + GOAL_DEPTH; x += 7) {
      g.beginPath();
      g.moveTo(x, GOAL_TOP);
      g.lineTo(x, GOAL_BOTTOM);
      g.stroke();
    }

    g.strokeStyle = "rgba(0,0,0,0.6)";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(gl.x, GOAL_TOP);
    g.lineTo(gl.x + gl.dir * GOAL_DEPTH, GOAL_TOP);
    g.lineTo(gl.x + gl.dir * GOAL_DEPTH, GOAL_BOTTOM);
    g.lineTo(gl.x, GOAL_BOTTOM);
    g.stroke();
  });

  POSTS.forEach((p) => {
    g.beginPath();
    g.arc(p.x, p.y, POST_R, 0, Math.PI * 2);
    g.fillStyle = p.x < CX ? "#ffcccc" : "#ccccff";
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = "#000";
    g.stroke();
  });

  return c;
}

const spriteCache = new Map();

// Jugador (por equipo, número y si está chutando)
function discSprite(team, kicking, num) {
  const key = `d|${team}|${kicking ? 1 : 0}|${num}`;
  let s = spriteCache.get(key);
  if (s) return s;
  const size = (PLAYER_R + 3) * 2;
  const [c, g] = makeCanvas(size, size);
  const m = size / 2;
  const isRed = team === "red";
  const grad = g.createRadialGradient(m - 5, m - 6, 2, m, m, PLAYER_R);
  grad.addColorStop(0, isRed ? RED_LIGHT : BLUE_LIGHT);
  grad.addColorStop(1, isRed ? RED : BLUE);
  g.beginPath();
  g.arc(m, m, PLAYER_R, 0, Math.PI * 2);
  g.fillStyle = grad;
  g.fill();
  g.lineWidth = kicking ? 3 : 2;
  g.strokeStyle = kicking ? "#ffffff" : "#000000";
  g.stroke();
  g.font = "bold 13px Inter, Arial, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "#ffffff";
  g.fillText(String(num), m, m + 1);
  s = { c, size };
  spriteCache.set(key, s);
  return s;
}

function ballSprite() {
  let s = spriteCache.get("ball");
  if (s) return s;
  const size = (BALL_R + 2) * 2;
  const [c, g] = makeCanvas(size, size);
  const m = size / 2;
  const bg = g.createRadialGradient(m - 3, m - 3, 1, m, m, BALL_R);
  bg.addColorStop(0, "#ffffff");
  bg.addColorStop(0.75, "#f0f0f0");
  bg.addColorStop(1, "#c9c9c9");
  g.beginPath();
  g.arc(m, m, BALL_R, 0, Math.PI * 2);
  g.fillStyle = bg;
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = "#000";
  g.stroke();
  s = { c, size };
  spriteCache.set("ball", s);
  return s;
}

function shadowSprite(r) {
  const key = `s|${r}`;
  let s = spriteCache.get(key);
  if (s) return s;
  const size = (r + 2) * 2;
  const [c, g] = makeCanvas(size, size);
  g.beginPath();
  g.ellipse(size / 2, size / 2, r, r * 0.9, 0, 0, Math.PI * 2);
  g.fillStyle = "rgba(0,0,0,0.22)";
  g.fill();
  s = { c, size };
  spriteCache.set(key, s);
  return s;
}

const nameCache = new Map();
function nameSprite(name, isMe) {
  const key = `${isMe ? 1 : 0}|${name}`;
  let s = nameCache.get(key);
  if (s) return s;
  if (nameCache.size > 200) nameCache.clear();
  const font = "600 11px Inter, Arial, sans-serif";
  const [, mg] = makeCanvas(1, 1);
  mg.font = font;
  const w = Math.ceil(mg.measureText(name).width) + 8;
  const h = 16;
  const [c, g] = makeCanvas(w, h);
  g.font = font;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineWidth = 3;
  g.strokeStyle = "rgba(0,0,0,0.7)";
  g.strokeText(name, w / 2, h / 2);
  g.fillStyle = isMe ? "#ffe066" : "#ffffff";
  g.fillText(name, w / 2, h / 2);
  s = { c, w, h };
  nameCache.set(key, s);
  return s;
}

const drawSprite = (ctx, s, x, y) =>
  ctx.drawImage(s.c, x - s.size / 2, y - s.size / 2, s.size, s.size);

function renderGame(
  ctx,
  field,
  players,
  ball,
  particles,
  fx,
  myUid,
  meDraw,
  kickTeam,
  ownerId
) {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.save();
  if (fx.shake > 0) {
    ctx.translate(
      (Math.random() - 0.5) * fx.shake,
      (Math.random() - 0.5) * fx.shake
    );
  }

  ctx.drawImage(field, 0, 0, CW, CH);

  // Saque de centro: el círculo se pinta del color del equipo que saca
  if (kickTeam) {
    const col = kickTeam === "red" ? RED : BLUE;
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(CX, CY, CENTER_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = col;
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  // Sombras (primero, para que no tapen a nadie)
  const ps = shadowSprite(PLAYER_R);
  for (const id in players) {
    const p = players[id];
    const x = id === myUid ? meDraw.x : p.x;
    const y = id === myUid ? meDraw.y : p.y;
    drawSprite(ctx, ps, x + 2, y + 4);
  }
  drawSprite(ctx, shadowSprite(BALL_R), ball.x + 2, ball.y + 4);

  // Estela del balón cuando va rápido
  const speed = Math.hypot(ball.vx, ball.vy);
  if (speed > 2.5 && ball.trail.length) {
    const strength = Math.min(1, (speed - 2.5) / 4);
    ctx.fillStyle = "#ffffff";
    for (let i = 0; i < ball.trail.length; i++) {
      const t = ball.trail[i];
      const k = 1 - i / ball.trail.length;
      ctx.globalAlpha = 0.22 * k * strength;
      ctx.beginPath();
      ctx.arc(t.x, t.y, BALL_R * k, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Jugadores
  for (const id in players) {
    const p = players[id];
    const isMe = id === myUid;
    const x = isMe ? meDraw.x : p.x;
    const y = isMe ? meDraw.y : p.y;

    if (isMe) {
      ctx.beginPath();
      ctx.arc(x, y, PLAYER_R + 6, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255,0.45)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (p.stale) ctx.globalAlpha = 0.35; // sin conexión
    drawSprite(ctx, discSprite(p.team, p.isKicking, p.num || 1), x, y);
    const n = nameSprite(
      p.stale ? `${p.name || "Crack"} (sin conexión)` : p.name || "Crack",
      isMe
    );
    ctx.drawImage(n.c, x - n.w / 2, y + PLAYER_R + 3, n.w, n.h);
    ctx.globalAlpha = 1;
  }

  drawSprite(ctx, ballSprite(), ball.x, ball.y);

  // Partículas
  for (let i = 0; i < particles.length; i++) {
    const pt = particles[i];
    ctx.globalAlpha = Math.max(0, pt.life);
    ctx.fillStyle = pt.color;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  // Quién controla el balón ahora mismo (arriba a la izquierda)
  if (ownerId) {
    const owner = players[ownerId];
    const label = `⚽ ${owner ? owner.name || "Crack" : "nadie"}`;
    const n = nameSprite(label, ownerId === myUid);
    ctx.globalAlpha = 0.8;
    ctx.drawImage(n.c, 6, 6, n.w, n.h);
    ctx.globalAlpha = 1;
  }

  // Destello de gol
  if (fx.flash > 0) {
    ctx.fillStyle = fx.flashColor;
    ctx.globalAlpha = fx.flash * 0.35;
    ctx.fillRect(0, 0, CW, CH);
    ctx.globalAlpha = 1;
  }
}

// Balón "fijo" para cuando está atrapado entre el jugador y la pared
const stuckBall = { x: 0, y: 0, vx: 0, vy: 0, r: BALL_R, inv: 0 };

// Disco temporal para no crear objetos nuevos en cada choque
const tmpDisc = { x: 0, y: 0, vx: 0, vy: 0, r: PLAYER_R, inv: PLAYER_INV_MASS };
const asDisc = (p, inv = PLAYER_INV_MASS) => {
  tmpDisc.inv = inv;
  tmpDisc.x = p.cx ?? p.x;
  tmpDisc.y = p.cy ?? p.y;
  tmpDisc.vx = p.cvx ?? p.vx ?? 0;
  tmpDisc.vy = p.cvy ?? p.vy ?? 0;
  return tmpDisc;
};

// ----------------------------------------------------
// App
// ----------------------------------------------------
export default function App() {
  const [user, setUser] = useState(null);
  const [playerName, setPlayerName] = useState("");
  const [roomId, setRoomId] = useState("");
  const [inputRoomId, setInputRoomId] = useState("");
  const [roomName, setRoomName] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [lobbyRooms, setLobbyRooms] = useState([]); // salas públicas
  const [, setLobbyTick] = useState(0); // para refrescar la lista cada poco
  const [selectedTeam, setSelectedTeam] = useState("red");
  const [chatMessage, setChatMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [meta, setMeta] = useState(null);
  const [playersList, setPlayersList] = useState([]);
  const [messages, setMessages] = useState([]);
  const [matchTime, setMatchTime] = useState(0); // segundos desde el inicio
  const [stats, setStats] = useState({}); // goles, asistencias y autogoles
  const [online, setOnline] = useState(true); // conexión con Firebase
  const [versionWarn, setVersionWarn] = useState(false);

  const canvasRef = useRef(null);
  const keys = useRef({});
  const kickHoldUntil = useRef(0);

  // Estado del juego en refs (no re-renderiza React)
  const players = useRef({});
  const posCache = useRef({}); // últimas posiciones recibidas, por si llegan antes que el jugador
  const ball = useRef({ x: CX, y: CY, vx: 0, vy: 0, k: 0, trail: [] });
  const ballNet = useRef(null);
  const particles = useRef([]);
  const fx = useRef({ shake: 0, flash: 0, flashColor: RED });
  const isHost = useRef(false);
  const hostIdRef = useRef(null);
  const speedRef = useRef(DEFAULT_SPEED);
  const scoresRef = useRef({ red: 0, blue: 0 });
  const lastKickoff = useRef(null);
  const lastGoalAt = useRef(null);
  const lastKickCount = useRef(null);
  const lastLocalKick = useRef(0);
  const goalPending = useRef(false);
  const goalOpen = useRef(false); // hay un gol marcado esperando el saque
  const kickoffTimer = useRef(null);
  const kickoffFn = useRef(null);
  // Dueño del balón: quien lo tocó el último lo calcula y lo envía a los demás.
  // c = número de "cambio de dueño" para ordenar los mensajes.
  const own = useRef({ c: 0, o: null });
  const playerIds = useRef([]);
  const listSig = useRef("");
  const forceSync = useRef(false);
  const metaNow = useRef({}); // último estado de la sala (para leerlo en la física)
  const touchRef = useRef({ last: null, prev: null }); // últimos que tocaron el balón
  const lastBallRecv = useRef(0); // cuándo llegó el último dato del dueño del balón

  const amHost = !!user && meta?.hostId === user.uid;
  const speed = meta?.speed || DEFAULT_SPEED;

  const spawnParticles = (x, y, color, count = 8, power = 1) => {
    // Límite para que no se acumulen con muchos jugadores
    if (particles.current.length > 150) return;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (Math.random() * 120 + 40) * power;
      particles.current.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 1,
        decay: Math.random() * 2 + 2,
        color,
        size: Math.random() * 2 + 1.5,
      });
    }
  };

  const rankInTeam = (uid, team) =>
    Object.keys(players.current)
      .filter((id) => players.current[id].team === team)
      .sort()
      .indexOf(uid);

  const resetForKickoff = (uid) => {
    const me = players.current[uid];
    if (me) {
      const pos = spawnPos(me.team, Math.max(0, rankInTeam(uid, me.team)));
      me.x = me.px = pos.x;
      me.y = me.py = pos.y;
      me.vx = 0;
      me.vy = 0;
    }
    const b = ball.current;
    b.x = b.px = CX;
    b.y = b.py = CY;
    b.vx = 0;
    b.vy = 0;
    b.trail = [];
    ballNet.current = null;
    goalPending.current = false;
    forceSync.current = true;
    lastBallRecv.current = Date.now(); // margen tras el saque
  };

  // 1. Autenticación anónima
  useEffect(() => {
    signInAnonymously(auth).catch((err) => {
      console.error("Error de autenticación:", err);
      alert(
        "No se pudo iniciar sesión. ¿Has activado el inicio de sesión anónimo en Firebase?"
      );
    });
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) {
        setPlayerName(
          localStorage.getItem("haxball_player_name") ||
            `Crack_${u.uid.slice(0, 4)}`
        );
      }
    });
    return unsub;
  }, []);

  // 2. Escuchar la sala
  useEffect(() => {
    if (!user || !roomId) return;
    const uid = user.uid;
    const base = `rooms/${roomId}`;
    const baseRef = ref(db, base);

    players.current = {};
    posCache.current = {};
    ballNet.current = null;
    lastKickoff.current = null;
    lastGoalAt.current = null;
    lastKickCount.current = null;
    hostIdRef.current = null;
    goalPending.current = false;
    goalOpen.current = false;
    own.current = { c: 0, o: null };
    playerIds.current = [];
    listSig.current = "";
    metaNow.current = {};
    touchRef.current = { last: null, prev: null };
    lastBallRecv.current = Date.now(); // margen al entrar en la sala

    // Saque de centro (lo hace el host). Saca el equipo que ha encajado.
    const doKickoff = (extraMeta = {}, extraPatch = {}) => {
      kickoffTimer.current = null;
      if (!isHost.current) return;
      const c = own.current.c + 1;
      own.current = { c, o: uid };
      const last = metaNow.current.lastGoalTeam;
      const kickoffTeam = last === "red" ? "blue" : last === "blue" ? "red" : "red";
      const patch = {};
      Object.entries({
        kickoff: serverNow(),
        banner: null,
        kickoffActive: true,
        kickoffTeam,
        ...extraMeta,
      }).forEach(([k, v]) => {
        patch[`meta/${k}`] = v;
      });
      patch.ball = encBall({ x: CX, y: CY, vx: 0, vy: 0, k: ball.current.k }, c, uid);
      patch.touch = null;
      Object.assign(patch, extraPatch);
      update(baseRef, patch).catch(() => {});
    };
    kickoffFn.current = doKickoff;

    const ensureHost = () => {
      if (hostIdRef.current === null) return;
      const ids = playerIds.current;
      if (!ids.length || ids.includes(hostIdRef.current)) return;
      if ([...ids].sort()[0] === uid) {
        update(ref(db, `${base}/meta`), { hostId: uid });
      }
    };

    // Al conectar (o reconectar): registrarse y borrarse al desconectar
    const unsubConn = onValue(ref(db, ".info/connected"), (snap) => {
      setOnline(snap.val() === true);
      if (snap.val() !== true) return;
      onDisconnect(baseRef).update({
        [`players/${uid}`]: null,
        [`pos/${uid}`]: null,
      });
      const me = players.current[uid];
      if (me) {
        update(baseRef, {
          [`players/${uid}`]: { name: me.name, team: me.team },
          [`pos/${uid}`]: encPos(me),
        }).catch(() => {});
      }
    });

    const unsubMeta = onValue(ref(db, `${base}/meta`), (snap) => {
      if (!snap.exists()) {
        alert("La sala ha sido cerrada.");
        setRoomId("");
        return;
      }
      const m = snap.val();
      setMeta(m);
      metaNow.current = m;
      setVersionWarn((m.v || 0) !== GAME_VERSION);
      hostIdRef.current = m.hostId;
      isHost.current = m.hostId === uid;
      speedRef.current = m.speed || DEFAULT_SPEED;
      scoresRef.current = { red: m.scoreRed || 0, blue: m.scoreBlue || 0 };
      goalOpen.current = (m.goalAt || 0) > (m.kickoff || 0);

      // El host programa el saque 2 s después de cada gol
      if (
        isHost.current &&
        goalOpen.current &&
        m.phase !== "over" &&
        !kickoffTimer.current
      ) {
        kickoffTimer.current = setTimeout(() => doKickoff(), GOAL_RESET_MS);
      }

      // Efectos del gol
      const goalAt = m.goalAt || 0;
      if (lastGoalAt.current === null) {
        lastGoalAt.current = goalAt;
      } else if (goalAt !== lastGoalAt.current) {
        lastGoalAt.current = goalAt;
        const scoredRed = m.lastGoalTeam === "red";
        sounds.playGoal();
        fx.current.shake = 6;
        fx.current.flash = 1;
        fx.current.flashColor = scoredRed ? RED : BLUE;
        spawnParticles(
          scoredRed ? PITCH.right + 10 : PITCH.left - 10,
          CY,
          scoredRed ? RED_LIGHT : BLUE_LIGHT,
          35,
          1.6
        );
      }

      // Saque de centro
      const kickoff = m.kickoff || 0;
      if (lastKickoff.current === null) {
        lastKickoff.current = kickoff;
      } else if (kickoff !== lastKickoff.current) {
        lastKickoff.current = kickoff;
        resetForKickoff(uid);
      }
      ensureHost();
    });

    // Lista de jugadores (nombre y equipo): solo cambia al entrar, salir o cambiar de equipo
    const unsubPlayers = onValue(ref(db, `${base}/players`), (snap) => {
      const data = snap.val() || {};
      const map = players.current;

      for (const id in data) {
        const info = data[id];
        let p = map[id];
        if (!p) {
          const cached = posCache.current[id];
          const c = cached || spawnPos(info.team, 0);
          p = map[id] = {
            x: c.x,
            y: c.y,
            px: c.x,
            py: c.y,
            vx: c.vx || 0,
            vy: c.vy || 0,
            snaps: cached
              ? [{ t: cached.lt, x: c.x, y: c.y, vx: c.vx, vy: c.vy }]
              : [],
            isKicking: !!c.k,
            kickReady: true,
            posInit: !!posCache.current[id],
          };
        }
        p.name = info.name;
        p.team = info.team;
      }
      for (const id in map) {
        if (!data[id] && id !== uid) delete map[id];
      }

      // Número de cada jugador dentro de su equipo
      const counters = { red: 0, blue: 0 };
      const ids = Object.keys(data).sort();
      ids.forEach((id) => {
        const p = map[id];
        if (p) p.num = ++counters[p.team];
      });
      playerIds.current = ids;

      const list = ids.map((id) => ({
        uid: id,
        name: data[id].name,
        team: data[id].team,
      }));
      const sig = list.map((p) => `${p.uid}:${p.name}:${p.team}`).join("|");
      if (sig !== listSig.current) {
        listSig.current = sig;
        setPlayersList(list);
      }
      ensureHost();

      // Si el dueño del balón se ha ido, el host se lo queda
      const o = own.current.o;
      if (isHost.current && o && o !== uid && !data[o]) {
        own.current = { c: own.current.c + 1, o: uid };
        ballNet.current = null;
        forceSync.current = true;
      }
    });

    // Posiciones: solo llega el jugador que ha cambiado, no la lista entera
    const posRef = ref(db, `${base}/pos`);
    const onPos = (snap) => {
      const id = snap.key;
      const v = decPos(snap.val());
      if (!v) return;
      if (id !== uid) v.lt = v.t ? toLocalTime(id, v.t) : Date.now();
      posCache.current[id] = v;
      const p = players.current[id];
      if (!p) return;
      if (id === uid) {
        // Mi posición la controlo yo; solo la uso al entrar
        if (!p.posInit) {
          p.x = p.px = v.x;
          p.y = p.py = v.y;
          p.posInit = true;
        }
        return;
      }
      const s = p.snaps;
      const lastS = s[s.length - 1];
      if (lastS && v.lt <= lastS.t) return; // llegó desordenado
      s.push({ t: v.lt, x: v.x, y: v.y, vx: v.vx, vy: v.vy });
      if (s.length > 20) s.shift();
      p.isKicking = v.k;
    };
    const unsubPosAdd = onChildAdded(posRef, onPos);
    const unsubPosChg = onChildChanged(posRef, onPos);

    const unsubBall = onValue(ref(db, `${base}/ball`), (snap) => {
      const v = decBall(snap.val());
      if (!v) return;

      // Sonido de chut de los demás
      if (lastKickCount.current !== null && v.k > lastKickCount.current) {
        if (v.o !== uid && performance.now() - lastLocalKick.current > 300) {
          sounds.playKick();
        }
      }
      lastKickCount.current = Math.max(lastKickCount.current || 0, v.k);
      ball.current.k = Math.max(ball.current.k || 0, v.k);

      // Solo acepto mensajes del dueño más reciente
      const cur = own.current;
      const newer = v.c > cur.c || (v.c === cur.c && (v.o || "") >= (cur.o || ""));
      if (!newer) return;
      const wasOwner = cur.o === uid;
      own.current = { c: v.c, o: v.o };
      if (v.o === uid) {
        if (!wasOwner) {
          // Me han pasado el balón (otro jugador ha minimizado la pestaña)
          const b = ball.current;
          b.x = b.px = v.x;
          b.y = b.py = v.y;
          b.vx = v.vx;
          b.vy = v.vy;
          forceSync.current = true;
        }
        ballNet.current = null;
        return;
      }
      // momento real del dato, en mi reloj
      v.lt = v.t ? toLocalTime(v.o, v.t) : Date.now();
      lastBallRecv.current = Date.now();
      ballNet.current = v;
    });

    const unsubMsgs = onValue(
      query(ref(db, `${base}/messages`), limitToLast(30)),
      (snap) => {
        const list = [];
        snap.forEach((child) => {
          list.push({ id: child.key, ...child.val() });
        });
        setMessages(list);
      }
    );

    // Quién tocó el balón el último y el penúltimo (para goles y asistencias)
    const unsubTouch = onValue(ref(db, `${base}/touch`), (snap) => {
      const t = snap.val() || {};
      touchRef.current = { last: t.last || null, prev: t.prev || null };
    });

    // Estadísticas de la partida
    const unsubStats = onValue(ref(db, `${base}/stats`), (snap) => {
      setStats(snap.val() || {});
    });

    // Tareas del host: fin del tiempo / prórroga y marcar la sala como activa
    let lastActiveMark = 0;
    let lastLobbyMark = 0;
    let lastLobbyKey = "";
    let lobbyOnDisconnect = false;
    const lobbyRef = ref(db, `lobby/${roomId}`);
    const hostTimer = setInterval(() => {
      if (!isHost.current) return;
      const m = metaNow.current;
      const t = serverNow();

      // Lista de salas públicas: el host mantiene la ficha de su sala al día
      if (m.isPublic) {
        const entry = {
          name: m.name || `Sala ${roomId}`,
          host: players.current[uid]?.name || "?",
          count: playerIds.current.length,
          max: MAX_PLAYERS,
          scoreRed: m.scoreRed || 0,
          scoreBlue: m.scoreBlue || 0,
          over: m.phase === "over",
          v: GAME_VERSION,
        };
        const key = JSON.stringify(entry);
        if (key !== lastLobbyKey || t - lastLobbyMark > LOBBY_EVERY_MS) {
          lastLobbyKey = key;
          lastLobbyMark = t;
          set(lobbyRef, { ...entry, lastActive: t }).catch(() => {});
          if (!lobbyOnDisconnect) {
            // si el host se desconecta, la ficha desaparece (el nuevo host la vuelve a crear)
            onDisconnect(lobbyRef).remove();
            lobbyOnDisconnect = true;
          }
        }
      } else if (lastLobbyKey) {
        // La sala ha pasado a privada: se quita de la lista
        lastLobbyKey = "";
        remove(lobbyRef).catch(() => {});
      }

      if (t - lastActiveMark > ACTIVE_EVERY_MS) {
        lastActiveMark = t;
        update(ref(db, `${base}/meta`), { lastActive: t }).catch(() => {});
      }
      if (m.phase === "over" || !m.timeLimit || m.overtime) return;
      if (goalOpen.current) return; // esperamos al saque
      if (t - (m.startedAt || t) < m.timeLimit * 60000) return;
      const red = m.scoreRed || 0;
      const blue = m.scoreBlue || 0;
      if (red === blue) {
        // Empate al acabar el tiempo: prórroga con gol de oro
        update(ref(db, `${base}/meta`), {
          overtime: true,
          banner: "¡PRÓRROGA! El próximo gol gana",
        }).catch(() => {});
        setTimeout(() => {
          if (metaNow.current.banner?.startsWith("¡PRÓRROGA")) {
            update(ref(db, `${base}/meta`), { banner: null }).catch(() => {});
          }
        }, 2500);
      } else {
        update(ref(db, `${base}/meta`), {
          phase: "over",
          winner: red > blue ? "red" : "blue",
          banner: null,
        }).catch(() => {});
      }
    }, 500);

    // Si minimizo la pestaña teniendo el balón, se lo paso a otro
    const onVisibility = () => {
      if (!document.hidden || own.current.o !== uid) return;
      const others = playerIds.current.filter((id) => id !== uid);
      if (!others.length) return;
      const o = others.includes(hostIdRef.current) ? hostIdRef.current : others[0];
      const c = own.current.c + 1;
      own.current = { c, o };
      update(baseRef, { ball: encBall(ball.current, c, o, true) }).catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      unsubConn();
      unsubMeta();
      unsubPlayers();
      unsubPosAdd();
      unsubPosChg();
      unsubBall();
      unsubMsgs();
      unsubTouch();
      unsubStats();
      clearInterval(hostTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      clearTimeout(kickoffTimer.current);
      kickoffTimer.current = null;
      kickoffFn.current = null;
      onDisconnect(baseRef).cancel();
      update(baseRef, {
        [`players/${uid}`]: null,
        [`pos/${uid}`]: null,
      }).catch(() => {});
    };
  }, [user, roomId]);

  // Lista de salas públicas (solo mientras estás en el menú)
  useEffect(() => {
    if (!user || roomId) return;
    const unsub = onValue(
      ref(db, "lobby"),
      (snap) => {
        const list = [];
        snap.forEach((child) => {
          list.push({ id: child.key, ...child.val() });
        });
        setLobbyRooms(list);
      },
      (err) => console.warn("No se pudo leer la lista de salas:", err.message)
    );
    // Refresca cada 10 s para quitar las salas que se han quedado sin host
    const t = setInterval(() => setLobbyTick((n) => n + 1), 10000);
    return () => {
      unsub();
      clearInterval(t);
    };
  }, [user, roomId]);

  // 3. Reloj
  useEffect(() => {
    if (!meta?.startedAt) return;
    const tick = () =>
      setMatchTime(
        Math.max(0, Math.floor((serverNow() - meta.startedAt) / 1000))
      );
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [meta?.startedAt]);

  // 4. Teclado
  useEffect(() => {
    const isTyping = () =>
      ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName);
    const blocked = ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
    const kickKeys = ["Space", "KeyX"];

    const down = (e) => {
      if (isTyping()) return;
      if (blocked.includes(e.code)) e.preventDefault();
      keys.current[e.code] = true;
      if (kickKeys.includes(e.code)) {
        kickHoldUntil.current = performance.now() + KICK_HOLD_MS;
      }
    };
    const up = (e) => {
      keys.current[e.code] = false;
    };
    const blur = () => {
      keys.current = {};
    };

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  // 5. Bucle de juego
  useEffect(() => {
    if (!user || !roomId) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    const field = buildField();
    const uid = user.uid;
    const base = `rooms/${roomId}`;
    const baseRef = ref(db, base);
    const meDraw = { x: 0, y: 0 };

    let animId;
    let last = performance.now();
    let acc = 0;
    let lastSync = 0;
    let lastPosStr = "";
    let lastBallStr = "";
    let lastHeartbeat = 0;

    // Pide ser el dueño del balón (lo he tocado yo)
    const claimBall = () => {
      if (own.current.o === uid) return;
      own.current = { c: own.current.c + 1, o: uid };
      ballNet.current = null;
      forceSync.current = true;
    };

    // Si el dueño del balón deja de enviar (se le ha caído internet, se ha ido...)
    // durante más de 1 s, el balón se queda sin nadie que mande y cada pantalla
    // lo vería en un sitio distinto. Entonces lo coge un jugador concreto
    // (el de uid más bajo, sin contar al dueño), el mismo en todas las pantallas.
    const checkStaleOwner = () => {
      const o = own.current.o;
      if (o === uid) return;
      if (Date.now() - lastBallRecv.current < 1000) return;
      const candidates = playerIds.current.filter((id) => id !== o).sort();
      if (candidates[0] === uid) {
        claimBall();
        lastBallRecv.current = Date.now();
      }
    };

    // Apunta quién ha tocado el balón (solo cuando cambia de jugador)
    const markTouch = () => {
      const t = touchRef.current;
      if (t.last === uid) return;
      touchRef.current = { last: uid, prev: t.last };
      update(baseRef, { touch: touchRef.current }).catch(() => {});
    };

    // Primer toque del saque: se acaban las restricciones de campo
    const endKickoff = () => {
      if (!metaNow.current.kickoffActive) return;
      metaNow.current = { ...metaNow.current, kickoffActive: false };
      update(ref(db, `${base}/meta`), { kickoffActive: false }).catch(() => {});
    };

    const nameOf = (id) => players.current[id]?.name || "Alguien";
    const teamOf = (id) => players.current[id]?.team;

    // Solo el dueño del balón anuncia los goles
    const reportGoal = (team) => {
      goalPending.current = true;
      const m = metaNow.current;
      const s = { ...scoresRef.current };
      s[team] += 1;
      scoresRef.current = s;

      // Quién ha marcado
      const patch = {};
      const { last, prev } = touchRef.current;
      let banner = `¡GOOOL DEL EQUIPO ${team === "red" ? "ROJO" : "AZUL"}!`;
      if (last && teamOf(last) === team) {
        banner = `⚽ ¡Gol de ${nameOf(last)}!`;
        patch[`stats/${last}/g`] = increment(1);
        patch[`stats/${last}/n`] = nameOf(last);
        patch[`stats/${last}/t`] = team;
        if (prev && prev !== last && teamOf(prev) === team) {
          banner += ` (asist. ${nameOf(prev)})`;
          patch[`stats/${prev}/a`] = increment(1);
          patch[`stats/${prev}/n`] = nameOf(prev);
          patch[`stats/${prev}/t`] = team;
        }
      } else if (last) {
        banner = `🙈 Autogol de ${nameOf(last)}`;
        patch[`stats/${last}/og`] = increment(1);
        patch[`stats/${last}/n`] = nameOf(last);
        patch[`stats/${last}/t`] = teamOf(last) || "";
      }

      // ¿Se acaba el partido? (límite de goles o gol de oro en la prórroga)
      const limit = m.scoreLimit || 0;
      const over = m.overtime || (limit > 0 && s[team] >= limit);

      patch["meta/scoreRed"] = s.red;
      patch["meta/scoreBlue"] = s.blue;
      patch["meta/lastGoalTeam"] = team;
      patch["meta/goalAt"] = serverNow();
      patch["meta/banner"] = banner;
      if (over) {
        patch["meta/phase"] = "over";
        patch["meta/winner"] = team;
      }
      update(baseRef, patch).catch((e) => console.error(e));
    };

    // Predicción del balón del dueño, con rebotes en las paredes
    const pred = { x: 0, y: 0, vx: 0, vy: 0 };
    const predictNet = (n) => {
      // Ticks transcurridos desde que el dueño lo envió (con decimales, sin saltos)
      const total = Math.max(
        0,
        Math.min(((Date.now() - n.lt) / 1000) * 60 * speedRef.current, 15)
      );
      const steps = Math.floor(total);
      const frac = total - steps;
      pred.x = n.x;
      pred.y = n.y;
      pred.vx = n.vx;
      pred.vy = n.vy;
      for (let i = 0; i < steps; i++) {
        pred.x += pred.vx;
        pred.y += pred.vy;
        pred.vx *= BALL_DAMPING;
        pred.vy *= BALL_DAMPING;
        ballWalls(pred);
      }
      pred.x += pred.vx * frac;
      pred.y += pred.vy * frac;
      ballWalls(pred);
      return pred;
    };

    // Un "tick" de física (60 por segundo a velocidad 1)
    const tick = (now) => {
      const b = ball.current;
      const all = players.current;
      const me = all[uid];
      b.px = b.x;
      b.py = b.y;

      // --- Mi jugador ---
      if (me) {
        me.px = me.x;
        me.py = me.y;
        const k = keys.current;
        let ix = 0;
        let iy = 0;
        if (k.KeyW || k.ArrowUp) iy -= 1;
        if (k.KeyS || k.ArrowDown) iy += 1;
        if (k.KeyA || k.ArrowLeft) ix -= 1;
        if (k.KeyD || k.ArrowRight) ix += 1;
        if (ix !== 0 && iy !== 0) {
          ix *= Math.SQRT1_2;
          iy *= Math.SQRT1_2;
        }

        const kickHeld = !!(k.Space || k.KeyX) || now < kickHoldUntil.current;
        if (!kickHeld) me.kickReady = true;
        me.isKicking = kickHeld;

        const accel = kickHeld ? PLAYER_ACCEL_KICKING : PLAYER_ACCEL;
        me.vx += ix * accel;
        me.vy += iy * accel;
        me.x += me.vx;
        me.y += me.vy;
        me.vx *= PLAYER_DAMPING;
        me.vy *= PLAYER_DAMPING;

        me.r = PLAYER_R;
        me.inv = PLAYER_INV_MASS;
        for (const id in all) {
          if (id !== uid) collide(me, asDisc(all[id]), REST_PLAYER_PLAYER);
        }
        for (let i = 0; i < POST_DISCS.length; i++) {
          collide(me, POST_DISCS[i], REST_POST);
        }

        // Saque de centro: cada uno en su campo y solo el equipo que saca
        // puede entrar en el círculo central (como en Haxball)
        const km = metaNow.current;
        if (km.kickoffActive) {
          const kicking = me.team === (km.kickoffTeam || "red");
          const dx = me.x - CX;
          const dy = me.y - CY;
          const d = Math.hypot(dx, dy) || 0.001;
          const wrongSide = me.team === "red" ? me.x > CX - PLAYER_R : me.x < CX + PLAYER_R;
          if (kicking) {
            // Puede estar dentro del círculo; fuera de él, solo en su campo
            if (wrongSide && d > CENTER_R - PLAYER_R) {
              if (d < CENTER_R + PLAYER_R) {
                me.x = CX + (dx / d) * (CENTER_R - PLAYER_R);
                me.y = CY + (dy / d) * (CENTER_R - PLAYER_R);
              } else {
                me.x = me.team === "red" ? CX - PLAYER_R : CX + PLAYER_R;
              }
              me.vx *= 0.5;
              me.vy *= 0.5;
            }
          } else {
            if (wrongSide) {
              me.x = me.team === "red" ? CX - PLAYER_R : CX + PLAYER_R;
              me.vx = 0;
            }
            const d2 = Math.hypot(me.x - CX, me.y - CY) || 0.001;
            if (d2 < CENTER_R + PLAYER_R) {
              me.x = CX + ((me.x - CX) / d2) * (CENTER_R + PLAYER_R);
              me.y = CY + ((me.y - CY) / d2) * (CENTER_R + PLAYER_R);
              me.vx *= 0.5;
              me.vy *= 0.5;
            }
          }
        }

        // Límites (los jugadores pueden salir de las líneas, como en Haxball)
        if (me.x < PLAYER_R) {
          me.x = PLAYER_R;
          me.vx = 0;
        } else if (me.x > CW - PLAYER_R) {
          me.x = CW - PLAYER_R;
          me.vx = 0;
        }
        if (me.y < PLAYER_R) {
          me.y = PLAYER_R;
          me.vy = 0;
        } else if (me.y > CH - PLAYER_R) {
          me.y = CH - PLAYER_R;
          me.vy = 0;
        }
      }

      // --- Balón: todos lo simulan; el dueño manda ---
      b.x += b.vx;
      b.y += b.vy;
      b.vx *= BALL_DAMPING;
      b.vy *= BALL_DAMPING;
      b.r = BALL_R;
      b.inv = BALL_INV_MASS;

      let touched = false;
      if (me) {
        // Chut: una vez por pulsación, como en Haxball
        if (me.isKicking && me.kickReady) {
          const dx = b.x - me.x;
          const dy = b.y - me.y;
          const d = Math.hypot(dx, dy);
          if (d > 0 && d < PLAYER_R + BALL_R + KICK_DIST) {
            b.vx += (dx / d) * KICK_STRENGTH * BALL_INV_MASS;
            b.vy += (dy / d) * KICK_STRENGTH * BALL_INV_MASS;
            me.kickReady = false;
            b.k = (b.k || 0) + 1;
            lastKickCount.current = Math.max(lastKickCount.current || 0, b.k);
            lastLocalKick.current = performance.now();
            touched = true;
            sounds.playKick();
            spawnParticles(b.x, b.y, "#ffffff", 6, 0.8);
          }
        }
        me.inv = PLAYER_INV_VS_BALL; // el balón casi no me mueve
        if (collide(me, b, REST_PLAYER_BALL)) touched = true;
        me.inv = PLAYER_INV_MASS;
      }

      // Los demás jugadores también tocan el balón en mi pantalla
      for (const id in all) {
        if (id !== uid) {
          collide(asDisc(all[id], PLAYER_INV_VS_BALL), b, REST_PLAYER_BALL);
        }
      }
      for (let i = 0; i < POST_DISCS.length; i++) {
        collide(b, POST_DISCS[i], REST_POST);
      }
      const scorer = ballWalls(b);

      // Si el balón está aplastado contra la pared o un poste, ahora es el
      // balón el que me frena a mí (si no, se metería dentro del jugador)
      if (me) {
        stuckBall.x = b.x;
        stuckBall.y = b.y;
        stuckBall.vx = b.vx;
        stuckBall.vy = b.vy;
        collide(me, stuckBall, 0);
      }

      if (touched) {
        claimBall();
        markTouch();
        endKickoff();
      }

      if (own.current.o === uid) {
        if (
          scorer &&
          !goalOpen.current &&
          !goalPending.current &&
          metaNow.current.phase !== "over"
        ) {
          reportGoal(scorer);
        }
      } else if (ballNet.current) {
        // Corrección suave hacia el balón del dueño
        const p = predictNet(ballNet.current);
        const ex = p.x - b.x;
        const ey = p.y - b.y;
        if (ex * ex + ey * ey > 70 * 70) {
          b.x = b.px = p.x;
          b.y = b.py = p.y;
          b.vx = p.vx;
          b.vy = p.vy;
        } else {
          const f = 0.15;
          b.x += ex * f;
          b.y += ey * f;
          b.vx += (p.vx - b.vx) * f;
          b.vy += (p.vy - b.vy) * f;
        }
      }

      // Estela (reutiliza objetos)
      const tr = b.trail;
      const head = tr.length >= 8 ? tr.pop() : { x: 0, y: 0 };
      head.x = b.x;
      head.y = b.y;
      tr.unshift(head);
    };

    // Si algo falla en un fotograma, que no se congele el juego entero
    let errorShown = false;
    const loop = (now) => {
      try {
        frame(now);
      } catch (e) {
        if (!errorShown) {
          errorShown = true;
          console.error("Error en el bucle del juego:", e);
        }
      }
      animId = requestAnimationFrame(loop);
    };

    const frame = (now) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      const tickRate = 60 * speedRef.current;

      // Física a ritmo fijo
      acc += dt * tickRate;
      let steps = 0;
      while (acc >= 1 && steps < 8) {
        tick(now);
        acc -= 1;
        steps++;
      }
      if (steps === 8) acc = 0;
      const alpha = Math.min(acc, 1); // para dibujar entre dos ticks sin tirones

      // Otros jugadores: predicción corta + suavizado
      // Los demás se dibujan un poquito en el pasado (unos 0,1 s), entre dos
      // datos ya recibidos: así no dan saltos aunque los datos lleguen irregulares.
      const all = players.current;
      const crowded = playerIds.current.length > 8;
      const interpMs = (crowded ? SYNC_MS_CROWDED : SYNC_MS) * 1.5 + 25;
      const renderT = Date.now() - interpMs;
      const wallNow = Date.now();
      for (const id in all) {
        if (id !== uid) {
          const p = all[id];
          interpPlayer(p, renderT, tickRate);
          estimatePresent(p, tickRate);
          // Sin datos en 2 s (envía un aviso cada 0,25 s): se le ha caído la conexión
          const lastS = p.snaps && p.snaps[p.snaps.length - 1];
          p.stale = !lastS || wallNow - lastS.t > 2000;
        }
      }

      const b = ball.current;
      const me = all[uid];

      // Seguridad: si algún número se ha estropeado (NaN), recolocar
      if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.vx)) {
        b.x = b.px = CX;
        b.y = b.py = CY;
        b.vx = b.vy = 0;
      }
      if (me && (!Number.isFinite(me.x) || !Number.isFinite(me.y))) {
        const pos = spawnPos(me.team, 0);
        me.x = me.px = pos.x;
        me.y = me.py = pos.y;
        me.vx = me.vy = 0;
      }

      // Efectos
      const parts = particles.current;
      if (parts.length) {
        for (let i = 0; i < parts.length; i++) {
          const pt = parts[i];
          pt.x += pt.vx * dt;
          pt.y += pt.vy * dt;
          pt.vx *= 0.92;
          pt.vy *= 0.92;
          pt.life -= pt.decay * dt;
        }
        particles.current = parts.filter((pt) => pt.life > 0);
      }
      fx.current.shake = Math.max(0, fx.current.shake - dt * 12);
      fx.current.flash = Math.max(0, fx.current.flash - dt * 1.5);

      // Posiciones interpoladas para dibujar suave en cualquier monitor
      if (me) {
        meDraw.x = lerp(me.px ?? me.x, me.x, alpha);
        meDraw.y = lerp(me.py ?? me.y, me.y, alpha);
      }
      const bx = b.x;
      const by = b.y;
      b.x = lerp(b.px ?? bx, bx, alpha);
      b.y = lerp(b.py ?? by, by, alpha);
      const km = metaNow.current;
      renderGame(
        ctx,
        field,
        all,
        b,
        particles.current,
        fx.current,
        uid,
        meDraw,
        km.kickoffActive ? km.kickoffTeam || "red" : null,
        own.current.o
      );
      b.x = bx;
      b.y = by;

      checkStaleOwner();

      // Envío a la red (menos veces por segundo si hay mucha gente)
      const syncMs =
        playerIds.current.length > 8 ? SYNC_MS_CROWDED : SYNC_MS;
      // (margen de 4 ms para que el ritmo de envío sea regular a 60/144 Hz)
      if (now - lastSync >= syncMs - 4) {
        lastSync = now;
        const payload = {};
        // Aunque no cambie nada, un aviso cada 250 ms para que los demás
        // sepan que sigues ahí y te dibujen en tu sitio exacto
        const heartbeat = now - lastHeartbeat > 250;

        if (me) {
          const s = posBody(me);
          if (s !== lastPosStr || forceSync.current || heartbeat) {
            lastPosStr = s;
            payload[`pos/${uid}`] = encPos(me);
          }
        }

        if (own.current.o === uid) {
          const s = ballBody(b, own.current.c, uid);
          if (s !== lastBallStr || forceSync.current || heartbeat) {
            lastBallStr = s;
            payload.ball = encBall(b, own.current.c, uid);
          }
        }
        if (heartbeat) lastHeartbeat = now;

        forceSync.current = false;
        if (Object.keys(payload).length) {
          update(baseRef, payload).catch(() => {});
        }
      }
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [user, roomId]);

  // ----------------------------------------------------
  // Acciones
  // ----------------------------------------------------
  // Borra las salas abandonadas (sin actividad en 10 minutos).
  // Si las reglas de Firebase no lo permiten, simplemente no hace nada.
  const cleanupOldRooms = async () => {
    try {
      const q = query(
        ref(db, "rooms"),
        orderByChild("meta/lastActive"),
        endAt(serverNow() - ROOM_STALE_MS)
      );
      const snap = await get(q);
      const patch = {};
      snap.forEach((child) => {
        patch[child.key] = null;
      });
      if (Object.keys(patch).length) {
        await update(ref(db, "rooms"), patch);
        console.log(`Salas abandonadas borradas: ${Object.keys(patch).length}`);
      }
      // Fichas de la lista pública que llevan rato sin actualizarse
      const lq = query(
        ref(db, "lobby"),
        orderByChild("lastActive"),
        endAt(serverNow() - ROOM_STALE_MS)
      );
      const lsnap = await get(lq);
      const lpatch = {};
      lsnap.forEach((child) => {
        lpatch[child.key] = null;
      });
      if (Object.keys(lpatch).length) await update(ref(db, "lobby"), lpatch);
    } catch (e) {
      console.warn("No se pudieron limpiar salas viejas:", e.message);
    }
  };

  const createRoom = async () => {
    if (!user) return;
    const name = playerName.trim();
    if (!name) return alert("Por favor ingresa tu nombre");
    localStorage.setItem("haxball_player_name", name);
    cleanupOldRooms(); // en segundo plano, no hace esperar

    try {
      let code;
      do {
        code = Math.random().toString(36).substring(2, 7).toUpperCase();
      } while ((await get(ref(db, `rooms/${code}/meta`))).exists());

      const pos = spawnPos(selectedTeam, 0);
      await set(ref(db, `rooms/${code}`), {
        meta: {
          hostId: user.uid,
          scoreRed: 0,
          scoreBlue: 0,
          speed: DEFAULT_SPEED,
          startedAt: serverNow(),
          lastActive: serverNow(),
          kickoff: 0,
          goalAt: 0,
          phase: "playing",
          scoreLimit: DEFAULT_SCORE_LIMIT,
          timeLimit: DEFAULT_TIME_LIMIT,
          kickoffActive: true,
          kickoffTeam: "red",
          v: GAME_VERSION,
          name: roomName.trim() || `Sala de ${name}`,
          isPublic,
        },
        ball: encBall({ x: CX, y: CY, vx: 0, vy: 0, k: 0 }, 0, user.uid),
        players: { [user.uid]: { name, team: selectedTeam } },
        pos: { [user.uid]: encPos(pos) },
      });
      setRoomId(code);
    } catch (e) {
      console.error(e);
      alert("No se pudo crear la sala: " + e.message);
    }
  };

  const joinRoom = async (codeArg) => {
    if (!user) return;
    const name = playerName.trim();
    if (!name) return alert("Ingresa tu nombre primero");
    const code = (typeof codeArg === "string" ? codeArg : inputRoomId)
      .trim()
      .toUpperCase();
    if (!code) return alert("Ingresa un código de sala");

    try {
      const snap = await get(ref(db, `rooms/${code}/meta`));
      if (!snap.exists())
        return alert("¡Sala no encontrada! Revisa el código.");
      if ((snap.val().v || 0) !== GAME_VERSION) {
        return alert(
          "Esta sala es de otra versión del juego. Que todos recarguen la página (Ctrl+F5) y cread una sala nueva."
        );
      }
      const pSnap = await get(ref(db, `rooms/${code}/players`));
      const current = pSnap.val() || {};
      const count = Object.keys(current).filter((id) => id !== user.uid).length;
      if (count >= MAX_PLAYERS) {
        return alert(`La sala está llena (máximo ${MAX_PLAYERS} jugadores).`);
      }
      const rank = Object.entries(current).filter(
        ([id, p]) => id !== user.uid && p.team === selectedTeam
      ).length;
      const pos = spawnPos(selectedTeam, rank);
      localStorage.setItem("haxball_player_name", name);
      await update(ref(db, `rooms/${code}`), {
        [`players/${user.uid}`]: { name, team: selectedTeam },
        [`pos/${user.uid}`]: encPos(pos),
      });
      setRoomId(code);
    } catch (e) {
      console.error(e);
      alert("No se pudo entrar en la sala: " + e.message);
    }
  };

  const leaveRoom = () => {
    if (playerIds.current.length <= 1) {
      remove(ref(db, `rooms/${roomId}`)).catch(() => {});
      remove(ref(db, `lobby/${roomId}`)).catch(() => {});
    }
    setRoomId("");
    setMeta(null);
    setMessages([]);
    setPlayersList([]);
    setMatchTime(0);
  };

  const switchTeam = (newTeam) => {
    setSelectedTeam(newTeam);
    const rank = Object.keys(players.current).filter(
      (id) => id !== user.uid && players.current[id].team === newTeam
    ).length;
    const pos = spawnPos(newTeam, rank);
    const me = players.current[user.uid];
    if (me) {
      me.team = newTeam;
      me.x = me.px = pos.x;
      me.y = me.py = pos.y;
      me.vx = 0;
      me.vy = 0;
    }
    update(ref(db, `rooms/${roomId}`), {
      [`players/${user.uid}/team`]: newTeam,
      [`pos/${user.uid}`]: encPos(pos),
    }).catch(() => {});
  };

  const setSpeed = (val) => {
    if (!amHost) return;
    update(ref(db, `rooms/${roomId}/meta`), { speed: val }).catch(() => {});
  };

  // Nueva partida (revancha): marcador, reloj y estadísticas a cero
  const resetScore = () => {
    if (!amHost || !kickoffFn.current) return;
    clearTimeout(kickoffTimer.current);
    kickoffTimer.current = null;
    kickoffFn.current(
      {
        scoreRed: 0,
        scoreBlue: 0,
        startedAt: serverNow(),
        phase: "playing",
        winner: null,
        overtime: false,
        lastGoalTeam: null,
        kickoffTeam: "red",
      },
      { stats: null }
    );
  };

  const setMatchOption = (key, val) => {
    if (!amHost) return;
    update(ref(db, `rooms/${roomId}/meta`), { [key]: val }).catch(() => {});
  };

  // Texto del reloj: cuenta atrás si hay límite de tiempo, o tiempo jugado
  const clockText = (() => {
    const fmt = (sec) =>
      `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(
        sec % 60
      ).padStart(2, "0")}`;
    const limit = (meta?.timeLimit || 0) * 60;
    if (!limit) return fmt(matchTime);
    if (meta?.overtime) return `+${fmt(Math.max(0, matchTime - limit))}`;
    return fmt(Math.max(0, limit - matchTime));
  })();

  // Tabla de estadísticas ordenada por goles
  const statRows = Object.entries(stats)
    .map(([id, st]) => ({
      id,
      name: st.n || "?",
      team: st.t,
      g: st.g || 0,
      a: st.a || 0,
      og: st.og || 0,
    }))
    .sort((x, y) => y.g - x.g || y.a - x.a);

  // Salas públicas que siguen vivas y son de esta versión, las más llenas primero
  const visibleRooms = lobbyRooms
    .filter(
      (r) =>
        r.v === GAME_VERSION &&
        serverNow() - (r.lastActive || 0) < LOBBY_FRESH_MS
    )
    .sort((a, b) => (b.count || 0) - (a.count || 0));

  const sendChat = (e) => {
    e.preventDefault();
    const text = chatMessage.trim();
    if (!text || !roomId) return;
    push(ref(db, `rooms/${roomId}/messages`), {
      sender: playerName,
      text,
      team: players.current[user.uid]?.team || selectedTeam,
      time: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
    }).catch(() => {});
    setChatMessage("");
    document.activeElement?.blur();
  };

  const copyCode = () => {
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };


  // ----------------------------------------------------
  // Interfaz
  // ----------------------------------------------------
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans select-none overflow-x-hidden">
      <header className="border-b border-slate-800/80 bg-slate-900/90 px-6 py-3 flex items-center justify-between backdrop-blur sticky top-0 z-50 gap-3">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-tr from-emerald-500 to-lime-400 p-2 rounded-xl text-slate-950 shadow-lg shadow-emerald-500/20">
            <Trophy className="w-6 h-6" />
          </div>
          <div>
            <h1 className="font-black text-xl tracking-wider bg-gradient-to-r from-emerald-400 via-lime-300 to-amber-300 bg-clip-text text-transparent">
              HAXBALL TURBO PRO
            </h1>
            <p className="text-[10px] text-slate-400 font-semibold">
              MULTIJUGADOR · FÍSICA CLÁSICA
            </p>
          </div>
        </div>

        {roomId && (
          <div className="flex items-center gap-4 bg-slate-950/80 border border-slate-800 px-4 py-1.5 rounded-full shadow-inner">
            {meta?.name && (
              <span className="text-xs text-slate-200 font-bold max-w-[180px] truncate">
                {meta.name}
              </span>
            )}
            <span className="text-xs text-slate-400">Código:</span>
            <span className="font-mono font-black text-amber-400 tracking-widest text-sm">
              {roomId}
            </span>
            <button
              onClick={copyCode}
              className="p-1 hover:bg-slate-800 rounded-md transition text-slate-300"
              title="Copiar código de sala"
            >
              {copied ? (
                <Check className="w-4 h-4 text-emerald-400" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </button>
          </div>
        )}

        <div className="flex items-center gap-2">
          {roomId && (
            <button
              onClick={leaveRoom}
              className="p-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl text-slate-300 transition"
              title="Salir de la sala"
            >
              <LogOut className="w-5 h-5 text-red-400" />
            </button>
          )}
          <button
            onClick={() => {
              sounds.muted = !isMuted;
              setIsMuted(!isMuted);
            }}
            className="p-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl text-slate-300 transition"
          >
            {isMuted ? (
              <VolumeX className="w-5 h-5 text-red-400" />
            ) : (
              <Volume2 className="w-5 h-5 text-emerald-400" />
            )}
          </button>
        </div>
      </header>

      {!roomId ? (
        <main className="flex-1 flex items-center justify-center p-6 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-black">
          <div className="w-full max-w-5xl flex flex-col lg:flex-row gap-6 items-stretch justify-center">
          <div className="lg:max-w-md w-full bg-slate-900/90 border border-slate-800 rounded-3xl p-8 shadow-2xl backdrop-blur space-y-6">
            <div className="text-center space-y-2">
              <h2 className="text-3xl font-black text-white flex items-center justify-center gap-2">
                ¡Entra al Partido!{" "}
                <Flame className="w-6 h-6 text-amber-400 animate-pulse" />
              </h2>
              <p className="text-xs text-slate-400">
                Fútbol multijugador con la física del Haxball de toda la vida
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                  Tu Apodo de Jugador
                </label>
                <input
                  type="text"
                  maxLength={12}
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  placeholder="Ej. CR7_Turbo"
                  className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500 transition font-bold"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                  Equipo Inicial
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    {
                      id: "red",
                      label: "ROJO",
                      on: "bg-red-500/20 border-red-500 text-red-400 shadow-lg shadow-red-500/10",
                      dot: "bg-red-500",
                    },
                    {
                      id: "blue",
                      label: "AZUL",
                      on: "bg-blue-500/20 border-blue-500 text-blue-400 shadow-lg shadow-blue-500/10",
                      dot: "bg-blue-500",
                    },
                  ].map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setSelectedTeam(t.id)}
                      className={`py-3 rounded-2xl font-black flex items-center justify-center gap-2 border transition ${
                        selectedTeam === t.id
                          ? t.on
                          : "bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700"
                      }`}
                    >
                      <span className={`w-3 h-3 rounded-full ${t.dot}`}></span>
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <hr className="border-slate-800 my-4" />

              <div className="space-y-3">
                <input
                  type="text"
                  maxLength={28}
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                  placeholder={`Nombre de la sala (ej. Sala de ${playerName || "Crack"})`}
                  className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-4 py-3 text-white text-sm focus:outline-none focus:border-emerald-500 transition"
                />
                <div className="grid grid-cols-2 gap-2 text-xs font-bold">
                  {[
                    { val: true, label: "🌍 Pública", hint: "Sale en la lista" },
                    { val: false, label: "🔒 Privada", hint: "Solo con código" },
                  ].map((o) => (
                    <button
                      key={o.label}
                      type="button"
                      onClick={() => setIsPublic(o.val)}
                      className={`py-2 rounded-xl border transition flex flex-col items-center ${
                        isPublic === o.val
                          ? "bg-emerald-500/15 border-emerald-500 text-emerald-300"
                          : "bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700"
                      }`}
                    >
                      {o.label}
                      <span className="text-[10px] font-medium opacity-70">{o.hint}</span>
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={createRoom}
                disabled={!user}
                className="w-full bg-gradient-to-r from-emerald-400 to-lime-400 hover:from-emerald-300 hover:to-lime-300 disabled:opacity-50 text-slate-950 font-black py-4 rounded-2xl shadow-xl shadow-emerald-500/20 flex items-center justify-center gap-2 transition transform active:scale-95"
              >
                <Play className="w-5 h-5 fill-current" />
                {user ? "Crear Sala Multijugador" : "Conectando..."}
              </button>

              <div className="relative flex items-center justify-center my-4">
                <span className="bg-slate-900 px-3 text-xs text-slate-500 font-semibold">
                  O ÚNETE A UNA SALA
                </span>
                <div className="absolute inset-0 top-1/2 border-t border-slate-800 -z-10"></div>
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={inputRoomId}
                  onChange={(e) => setInputRoomId(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === "Enter" && joinRoom()}
                  placeholder="CÓDIGO DE SALA"
                  className="flex-1 min-w-0 bg-slate-950 border border-slate-800 rounded-2xl px-4 py-3 text-white font-mono tracking-widest text-center uppercase focus:outline-none focus:border-amber-500 transition"
                />
                <button
                  onClick={joinRoom}
                  disabled={!user}
                  className="bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-slate-950 font-black px-6 py-3 rounded-2xl transition transform active:scale-95"
                >
                  Entrar
                </button>
              </div>
            </div>
          </div>

          {/* Lista de salas públicas */}
          <div className="w-full lg:max-w-lg bg-slate-900/90 border border-slate-800 rounded-3xl p-6 shadow-2xl backdrop-blur flex flex-col min-h-[320px]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-black text-white flex items-center gap-2">
                <Users className="w-5 h-5 text-emerald-400" /> Salas públicas
              </h3>
              <span className="text-xs text-slate-400 font-mono">
                {visibleRooms.length} {visibleRooms.length === 1 ? "sala" : "salas"}
              </span>
            </div>

            {visibleRooms.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center text-slate-500 text-sm gap-1">
                <span>No hay salas públicas ahora mismo.</span>
                <span className="text-xs">¡Crea una y aparecerá aquí para todos!</span>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto space-y-2 pr-1 max-h-[460px]">
                {visibleRooms.map((r) => {
                  const full = (r.count || 0) >= (r.max || MAX_PLAYERS);
                  return (
                    <div
                      key={r.id}
                      className="flex items-center gap-3 bg-slate-950/80 border border-slate-800 rounded-2xl px-4 py-3"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-slate-100 truncate">{r.name}</div>
                        <div className="text-[11px] text-slate-400 truncate">
                          Host: {r.host} ·{" "}
                          <span style={{ color: RED }}>{r.scoreRed || 0}</span>-
                          <span style={{ color: BLUE }}>{r.scoreBlue || 0}</span>
                          {r.over ? " · terminado" : ""}
                        </div>
                      </div>
                      <span
                        className={`text-xs font-mono font-bold ${
                          full ? "text-red-400" : "text-emerald-400"
                        }`}
                      >
                        {r.count || 0}/{r.max || MAX_PLAYERS}
                      </span>
                      <button
                        onClick={() => joinRoom(r.id)}
                        disabled={!user || full}
                        className="bg-amber-400 hover:bg-amber-300 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-black text-xs px-4 py-2 rounded-xl transition active:scale-95"
                      >
                        {full ? "Llena" : "Entrar"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          </div>
        </main>
      ) : (
        <main className="flex-1 flex flex-col xl:flex-row p-4 gap-4 max-w-[1300px] mx-auto w-full">
          <div className="flex-1 flex flex-col items-center gap-3">
            {/* Marcador */}
            <div className="w-full max-w-[900px] bg-slate-900/90 border border-slate-800 rounded-2xl px-5 py-3 flex items-center justify-between shadow-2xl">
              <div className="flex items-center gap-3">
                <div className="w-3 h-10 rounded-full" style={{ background: RED }}></div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-black tracking-wider block">
                    ROJO
                  </span>
                  <span className="text-4xl font-black" style={{ color: RED }}>
                    {meta?.scoreRed || 0}
                  </span>
                </div>
              </div>

              <div className="flex flex-col items-center gap-1">
                <span
                  className={`text-sm font-mono font-bold px-3 py-1 rounded-full border flex items-center gap-1.5 ${
                    meta?.overtime
                      ? "text-amber-300 bg-amber-500/10 border-amber-500/40"
                      : "text-slate-200 bg-slate-950 border-slate-800"
                  }`}
                >
                  <Timer className="w-3.5 h-3.5" />
                  {clockText}
                  {meta?.overtime && (
                    <span className="text-[10px] font-black">PRÓRROGA</span>
                  )}
                </span>
                <span className="text-[10px] text-slate-500 font-semibold">
                  {meta?.scoreLimit ? `A ${meta.scoreLimit} goles` : "Sin límite de goles"}
                  {" · "}
                  {meta?.timeLimit ? `${meta.timeLimit} min` : "sin tiempo"}
                </span>
                <div
                  className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800"
                  title={
                    amHost
                      ? "Velocidad del juego"
                      : "Solo el host puede cambiar la velocidad"
                  }
                >
                  {SPEEDS.map((p) => (
                    <button
                      key={p.val}
                      onClick={() => setSpeed(p.val)}
                      disabled={!amHost}
                      className={`px-2.5 py-0.5 rounded-lg text-[10px] font-black transition ${
                        speed === p.val
                          ? "bg-emerald-500 text-slate-950"
                          : "text-slate-400 enabled:hover:text-white disabled:opacity-60"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-3 text-right">
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-black tracking-wider block">
                    AZUL
                  </span>
                  <span className="text-4xl font-black" style={{ color: BLUE }}>
                    {meta?.scoreBlue || 0}
                  </span>
                </div>
                <div className="w-3 h-10 rounded-full" style={{ background: BLUE }}></div>
              </div>
            </div>

            {/* Campo */}
            <div className="relative rounded-2xl overflow-hidden border-4 border-slate-800 shadow-2xl w-full max-w-[900px]">
              <canvas
                ref={canvasRef}
                width={CW * DPR}
                height={CH * DPR}
                className="w-full h-auto block"
              />
              {(!online || versionWarn) && (
                <div className="absolute inset-x-0 bottom-3 flex justify-center pointer-events-none z-10">
                  <div className="bg-red-600/90 text-white text-xs font-bold px-4 py-1.5 rounded-full shadow">
                    {!online
                      ? "Sin conexión con el servidor… reconectando"
                      : "Esta sala es de otra versión del juego: recargad todos (Ctrl+F5) y cread una sala nueva"}
                  </div>
                </div>
              )}
              {meta?.kickoffActive && meta?.phase !== "over" && !meta?.banner && (
                <div className="absolute inset-x-0 top-3 flex justify-center pointer-events-none">
                  <div
                    className="text-white text-xs font-black px-3 py-1 rounded-full shadow"
                    style={{ background: meta.kickoffTeam === "blue" ? BLUE : RED }}
                  >
                    SACA EL {meta.kickoffTeam === "blue" ? "AZUL" : "ROJO"}
                  </div>
                </div>
              )}
              {meta?.phase === "over" && (
                <div className="absolute inset-0 bg-slate-950/80 flex items-center justify-center p-4">
                  <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 w-full max-w-md text-center shadow-2xl">
                    <div className="text-xs text-slate-400 font-bold uppercase tracking-wider">
                      Fin del partido
                    </div>
                    <div
                      className="text-3xl font-black mt-1"
                      style={{ color: meta.winner === "blue" ? BLUE : RED }}
                    >
                      ¡GANA EL {meta.winner === "blue" ? "AZUL" : "ROJO"}!
                    </div>
                    <div className="text-2xl font-black text-white mt-1">
                      <span style={{ color: RED }}>{meta.scoreRed || 0}</span>
                      {" - "}
                      <span style={{ color: BLUE }}>{meta.scoreBlue || 0}</span>
                    </div>

                    {statRows.length > 0 && (
                      <table className="w-full text-xs mt-4">
                        <thead>
                          <tr className="text-slate-400">
                            <th className="text-left font-semibold pb-1">Jugador</th>
                            <th className="font-semibold pb-1" title="Goles">⚽</th>
                            <th className="font-semibold pb-1" title="Asistencias">🅰️</th>
                            <th className="font-semibold pb-1" title="Autogoles">🙈</th>
                          </tr>
                        </thead>
                        <tbody>
                          {statRows.map((r) => (
                            <tr key={r.id} className="border-t border-slate-800">
                              <td className="text-left py-1 font-bold">
                                <span
                                  className="inline-block w-2 h-2 rounded-full mr-1.5"
                                  style={{ background: r.team === "blue" ? BLUE : RED }}
                                ></span>
                                {r.name}
                              </td>
                              <td className="text-white font-bold">{r.g}</td>
                              <td className="text-slate-300">{r.a}</td>
                              <td className="text-slate-400">{r.og}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    {amHost ? (
                      <button
                        onClick={resetScore}
                        className="mt-4 w-full bg-gradient-to-r from-emerald-400 to-lime-400 text-slate-950 font-black py-3 rounded-xl flex items-center justify-center gap-2 active:scale-95 transition"
                      >
                        <RotateCcw className="w-4 h-4" /> Revancha
                      </button>
                    ) : (
                      <div className="mt-4 text-xs text-slate-400">
                        Esperando a que el host empiece la revancha…
                      </div>
                    )}
                  </div>
                </div>
              )}
              {meta?.banner && meta?.phase !== "over" && (
                <div className="absolute inset-x-0 top-6 flex justify-center pointer-events-none">
                  <div className="bg-slate-950/85 text-white font-black px-6 py-2 rounded-full text-lg shadow-2xl border border-white/20 tracking-wide">
                    {meta.banner}
                  </div>
                </div>
              )}
            </div>

            {/* Controles */}
            <div className="w-full max-w-[900px] bg-slate-900/60 border border-slate-800 rounded-2xl p-3 flex items-center justify-between text-xs text-slate-400">
              <div className="flex items-center gap-4 flex-wrap">
                <span>
                  Moverse: <strong className="text-slate-200">WASD</strong> /{" "}
                  <strong className="text-slate-200">Flechas</strong>
                </span>
                <span>
                  Chutar: <strong className="text-amber-400">ESPACIO</strong> o{" "}
                  <strong className="text-amber-400">X</strong>
                </span>
              </div>

              {amHost && (
                <div className="flex items-center gap-2 flex-wrap">
                  <label className="flex items-center gap-1">
                    Goles
                    <select
                      value={meta?.scoreLimit || 0}
                      onChange={(e) => setMatchOption("scoreLimit", +e.target.value)}
                      className="bg-slate-800 text-slate-200 rounded-md px-1.5 py-0.5"
                    >
                      {SCORE_LIMITS.map((v) => (
                        <option key={v} value={v}>
                          {v ? v : "∞"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-1">
                    Tiempo
                    <select
                      value={meta?.timeLimit || 0}
                      onChange={(e) => setMatchOption("timeLimit", +e.target.value)}
                      className="bg-slate-800 text-slate-200 rounded-md px-1.5 py-0.5"
                    >
                      {TIME_LIMITS.map((v) => (
                        <option key={v} value={v}>
                          {v ? `${v} min` : "∞"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-1">
                    Sala
                    <select
                      value={meta?.isPublic ? "1" : "0"}
                      onChange={(e) => setMatchOption("isPublic", e.target.value === "1")}
                      className="bg-slate-800 text-slate-200 rounded-md px-1.5 py-0.5"
                    >
                      <option value="1">Pública</option>
                      <option value="0">Privada</option>
                    </select>
                  </label>
                  <button
                    onClick={resetScore}
                    className="flex items-center gap-1 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 px-3 py-1 rounded-lg transition text-xs font-bold"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Nuevo partido
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Lateral */}
          <div className="w-full xl:w-80 flex flex-col gap-4">
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 flex flex-col space-y-3 shadow-xl">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                  <Users className="w-4 h-4 text-emerald-400" /> Jugadores
                </span>
                <span className="text-xs bg-slate-950 border border-slate-800 px-2 py-0.5 rounded-full text-emerald-400 font-mono font-bold">
                  {playersList.length}/{MAX_PLAYERS}
                </span>
              </div>

              <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                {playersList.map((p) => (
                  <div
                    key={p.uid}
                    className="flex items-center justify-between bg-slate-950/80 p-2.5 rounded-xl border border-slate-800/80 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="w-3 h-3 rounded-full"
                        style={{ background: p.team === "red" ? RED : BLUE }}
                      ></span>
                      <span className="font-bold text-slate-200">{p.name}</span>
                      {stats[p.uid]?.g > 0 && (
                        <span className="text-[10px] text-slate-300 font-bold">
                          ⚽{stats[p.uid].g}
                        </span>
                      )}
                      {meta?.hostId === p.uid && (
                        <Crown className="w-3.5 h-3.5 text-amber-400" />
                      )}
                      {p.uid === user?.uid && (
                        <span className="text-[10px] text-amber-400 font-mono font-bold">
                          (Tú)
                        </span>
                      )}
                    </div>

                    {p.uid === user?.uid && (
                      <button
                        onClick={() =>
                          switchTeam(p.team === "red" ? "blue" : "red")
                        }
                        className="text-[10px] font-bold bg-slate-800 hover:bg-slate-700 text-slate-300 px-2.5 py-1 rounded-lg transition"
                      >
                        Pasar a {p.team === "red" ? "Azul" : "Rojo"}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex-1 bg-slate-900/90 border border-slate-800 rounded-2xl p-4 flex flex-col min-h-[280px] shadow-xl">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 block">
                Chat
              </span>

              <div className="flex-1 bg-slate-950 border border-slate-800 rounded-xl p-3 overflow-y-auto space-y-2 mb-3 text-xs max-h-56">
                {messages.map((msg) => (
                  <div key={msg.id} className="space-x-1.5 leading-relaxed">
                    <span className="text-slate-500 text-[10px] font-mono">
                      {msg.time}
                    </span>
                    <span
                      className="font-bold"
                      style={{ color: msg.team === "red" ? RED : BLUE }}
                    >
                      {msg.sender}:
                    </span>
                    <span className="text-slate-200">{msg.text}</span>
                  </div>
                ))}
              </div>

              <form onSubmit={sendChat} className="flex gap-2">
                <input
                  type="text"
                  maxLength={120}
                  value={chatMessage}
                  onChange={(e) => setChatMessage(e.target.value)}
                  placeholder="Mensaje..."
                  className="flex-1 min-w-0 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
                <button
                  type="submit"
                  className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 p-2 rounded-xl font-bold transition"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </div>
          </div>
        </main>
      )}
    </div>
  );
}
