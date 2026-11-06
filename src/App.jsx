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
const BALL_R = 7.5; // bastante más pequeño que en Haxball (10): más control y más juego

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
const GAME_VERSION = 17;
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

// ----------------------------------------------------
// Red: el HOST calcula toda la física (jugadores y balón) y manda una
// "foto" del partido 30 veces por segundo. Los demás solo envían qué
// teclas pulsan. Así todos ven exactamente el mismo balón.
// ----------------------------------------------------
const BIT_UP = 1;
const BIT_DOWN = 2;
const BIT_LEFT = 4;
const BIT_RIGHT = 8;
const BIT_KICK = 16;

// Identificador corto de cada jugador para que la foto ocupe poco
const sidOf = (uid) => uid.slice(0, 6);

// Foto del host: "hora|chuts|bx,by,bvx,bvy|sid,x,y,vx,vy,chutando,sinConexión|..."
const encState = (t, k, b, ents, info) => {
  let s = `${t}|${k}|${r1(b.x)},${r1(b.y)},${r2(b.vx)},${r2(b.vy)}`;
  for (const id in ents) {
    if (!info[id]) continue;
    const p = ents[id];
    s += `|${sidOf(id)},${r1(p.x)},${r1(p.y)},${r2(p.vx)},${r2(p.vy)},${
      p.isKicking ? 1 : 0
    },${p.stale ? 1 : 0}`;
  }
  return s;
};
const decState = (str) => {
  if (typeof str !== "string") return null;
  const parts = str.split("|");
  if (parts.length < 3) return null;
  const b = parts[2].split(",");
  const players = [];
  for (let i = 3; i < parts.length; i++) {
    const a = parts[i].split(",");
    players.push({
      sid: a[0],
      x: +a[1],
      y: +a[2],
      vx: +a[3] || 0,
      vy: +a[4] || 0,
      k: a[5] === "1",
      s: a[6] === "1",
    });
  }
  return {
    t: +parts[0] || 0,
    k: +parts[1] || 0,
    ball: { x: +b[0], y: +b[1], vx: +b[2] || 0, vy: +b[3] || 0 },
    players,
  };
};

// Teclas de un jugador: "teclas,vecesQueHaPulsadoChutar"
// El tercer número cambia en cada envío: así el host sabe que sigues conectado
// aunque estés quieto (si el texto no cambia, Firebase no avisa)
const encInput = (bits, kc, seq) => `${bits},${kc},${seq}`;
const decInput = (str) => {
  if (typeof str !== "string") return null;
  const a = str.split(",");
  return { bits: +a[0] || 0, kc: +a[1] || 0 };
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

// Posición de saque: cada jugador del equipo en una altura distinta
// ----------------------------------------------------
// Bots
// ----------------------------------------------------
const BOT_PREFIX = "~bot";
const isBot = (id) => typeof id === "string" && id.startsWith(BOT_PREFIX);
const BOT_NAMES = ["Rayo", "Muro", "Turbo", "Tanque", "Chispa", "Pulpo", "Cohete", "Halcón", "Trueno", "Ciclón"];
const BOT_LEVELS = {
  facil: { label: "Fácil", think: 9, look: 2, aim: 0.7, shotRange: 300, noise: 30 },
  normal: { label: "Normal", think: 4, look: 5, aim: 0.84, shotRange: 420, noise: 10 },
  dificil: { label: "Difícil", think: 1, look: 8, aim: 0.9, shotRange: 540, noise: 0 },
};

// Decide qué teclas pulsa un bot (lo calcula el host en cada paso)
function botThink(id, p, ball, all, inf, km, level, st, tick) {
  const L = BOT_LEVELS[level] || BOT_LEVELS.normal;
  const dir = p.team === "red" ? 1 : -1; // hacia dónde ataca
  const goalX = dir > 0 ? PITCH.right + 10 : PITCH.left - 10;
  const ownX = dir > 0 ? PITCH.left : PITCH.right;
  const reach = PLAYER_R + BALL_R + KICK_DIST;

  // Saque de centro: si no saca mi equipo, me quedo quieto en mi sitio
  if (km.kickoffActive && p.team !== (km.kickoffTeam || "red")) {
    st.kick = 0;
    return 0;
  }

  if (tick - (st.lastThink ?? -99) >= L.think) {
    st.lastThink = tick;
    const bx = ball.x + ball.vx * L.look;
    const by = ball.y + ball.vy * L.look;
    const myD = Math.hypot(p.x - bx, p.y - by);

    // ¿Algún compañero está bastante más cerca del balón? Entonces defiendo
    let closer = false;
    let rankInTeam = 0;
    for (const oid in all) {
      if (oid === id || inf[oid]?.team !== p.team) continue;
      const o = all[oid];
      if (Math.hypot(o.x - bx, o.y - by) + 25 < myD) closer = true;
      if (isBot(oid) && oid < id) rankInTeam++;
    }
    if (km.kickoffActive) closer = false;

    if (!closer) {
      // Me pongo detrás del balón mirando a la portería rival y empujo
      let ux = goalX - bx;
      let uy = CY - by;
      const ul = Math.hypot(ux, uy) || 1;
      ux /= ul;
      uy /= ul;
      const rel = (p.x - bx) * ux + (p.y - by) * uy; // > 0: estoy por delante del balón
      if (rel > -6) {
        // Lado malo: doy la vuelta al balón por el lado más corto
        const px = -uy;
        const py = ux;
        const sgn = (p.x - bx) * px + (p.y - by) * py >= 0 ? 1 : -1;
        st.tx = bx - ux * 34 + px * sgn * 30;
        st.ty = by - uy * 34 + py * sgn * 30;
      } else {
        st.tx = bx + ux * 14;
        st.ty = by + uy * 14;
      }
      // ¿Chuto?
      const dx = ball.x - p.x;
      const dy = ball.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      const aim = (dx / d) * ux + (dy / d) * uy;
      const distGoal = Math.abs(goalX - ball.x);
      const nearOwn = Math.abs(ball.x - ownX) < 220 && (dx / d) * dir > 0.2;
      if (d < reach - 1 && tick - (st.lastKick ?? -99) > 25) {
        if ((aim > L.aim && distGoal < L.shotRange) || nearOwn) {
          st.kick = 2;
          st.lastKick = tick;
        }
      }
    } else {
      // Defensa: entre el balón y mi portería
      const f = 0.3 + rankInTeam * 0.12;
      st.tx = ownX + (bx - ownX) * f;
      st.ty = CY + (by - CY) * 0.55 + (rankInTeam % 2 ? 40 : -40) * (rankInTeam > 0 ? 1 : 0);
    }
    if (L.noise) {
      st.tx += (Math.random() - 0.5) * L.noise;
      st.ty += (Math.random() - 0.5) * L.noise;
    }
  }

  let bits = 0;
  const ex = (st.tx ?? p.x) - p.x;
  const ey = (st.ty ?? p.y) - p.y;
  if (ex > 4) bits |= BIT_RIGHT;
  if (ex < -4) bits |= BIT_LEFT;
  if (ey > 4) bits |= BIT_DOWN;
  if (ey < -4) bits |= BIT_UP;
  if (st.kick > 0) {
    bits |= BIT_KICK;
    st.kick--;
  }
  return bits;
}

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
  kickTeam
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
    const x = p.dx ?? p.x;
    const y = p.dy ?? p.y;
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
    const x = p.dx ?? p.x;
    const y = p.dy ?? p.y;

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

// Física de un jugador según sus teclas (igual en el host y en tu pantalla)
function stepPlayer(p, bits) {
  let ix = 0;
  let iy = 0;
  if (bits & BIT_UP) iy -= 1;
  if (bits & BIT_DOWN) iy += 1;
  if (bits & BIT_LEFT) ix -= 1;
  if (bits & BIT_RIGHT) ix += 1;
  if (ix !== 0 && iy !== 0) {
    ix *= Math.SQRT1_2;
    iy *= Math.SQRT1_2;
  }
  const accel = bits & BIT_KICK ? PLAYER_ACCEL_KICKING : PLAYER_ACCEL;
  p.vx += ix * accel;
  p.vy += iy * accel;
  p.x += p.vx;
  p.y += p.vy;
  p.vx *= PLAYER_DAMPING;
  p.vy *= PLAYER_DAMPING;
}

// Saque de centro: cada uno en su campo y solo el equipo que saca
// puede entrar en el círculo central (como en Haxball)
function applyKickoffLimits(p, km) {
  if (!km.kickoffActive) return;
  const kicking = p.team === (km.kickoffTeam || "red");
  const dx = p.x - CX;
  const dy = p.y - CY;
  const d = Math.hypot(dx, dy) || 0.001;
  const wrongSide = p.team === "red" ? p.x > CX - PLAYER_R : p.x < CX + PLAYER_R;
  if (kicking) {
    if (wrongSide && d > CENTER_R - PLAYER_R) {
      if (d < CENTER_R + PLAYER_R) {
        p.x = CX + (dx / d) * (CENTER_R - PLAYER_R);
        p.y = CY + (dy / d) * (CENTER_R - PLAYER_R);
      } else {
        p.x = p.team === "red" ? CX - PLAYER_R : CX + PLAYER_R;
      }
      p.vx *= 0.5;
      p.vy *= 0.5;
    }
  } else {
    if (wrongSide) {
      p.x = p.team === "red" ? CX - PLAYER_R : CX + PLAYER_R;
      p.vx = 0;
    }
    const d2 = Math.hypot(p.x - CX, p.y - CY) || 0.001;
    if (d2 < CENTER_R + PLAYER_R) {
      p.x = CX + ((p.x - CX) / d2) * (CENTER_R + PLAYER_R);
      p.y = CY + ((p.y - CY) / d2) * (CENTER_R + PLAYER_R);
      p.vx *= 0.5;
      p.vy *= 0.5;
    }
  }
}

// Límites del canvas (los jugadores pueden salir de las líneas, como en Haxball)
function clampToCanvas(p) {
  if (p.x < PLAYER_R) {
    p.x = PLAYER_R;
    p.vx = 0;
  } else if (p.x > CW - PLAYER_R) {
    p.x = CW - PLAYER_R;
    p.vx = 0;
  }
  if (p.y < PLAYER_R) {
    p.y = PLAYER_R;
    p.vy = 0;
  } else if (p.y > CH - PLAYER_R) {
    p.y = CH - PLAYER_R;
    p.vy = 0;
  }
}

// Disco temporal para no crear objetos nuevos en cada choque
const tmpDisc = { x: 0, y: 0, vx: 0, vy: 0, r: PLAYER_R, inv: 0 };

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
  // Predicción del balón para quien no es host (experimental, apagada por defecto)
  const [predictBall, setPredictBall] = useState(() => {
    try {
      return localStorage.getItem("hx_predict") === "1";
    } catch {
      return true;
    }
  });
  const predictRef = useRef(predictBall);
  predictRef.current = predictBall;
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
  const kickPresses = useRef(0); // veces que he pulsado chutar

  // Estado del juego en refs (no re-renderiza React)
  // ents: jugadores. En el host se calculan aquí; en los demás se dibujan
  // a partir de las fotos del host (y el tuyo propio se predice para que responda al momento).
  const ents = useRef({});
  const info = useRef({}); // nombre, equipo y sid de cada jugador
  const sidMap = useRef({}); // sid → uid
  const inputs = useRef({}); // (host) teclas de cada jugador
  const ball = useRef({ x: CX, y: CY, vx: 0, vy: 0, k: 0, trail: [], snaps: [] });
  const hostMe = useRef(null); // (invitado) dónde me tiene el host
  const lastStateRecv = useRef(0); // (invitado) última foto recibida del host
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
  const playerIds = useRef([]);
  const listSig = useRef("");
  const metaNow = useRef({}); // último estado de la sala (para leerlo en la física)
  const touchRef = useRef({ last: null, prev: null }); // (host) últimos que tocaron el balón

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

  const rankInTeam = (id, team) =>
    Object.keys(info.current)
      .filter((k) => info.current[k].team === team)
      .sort()
      .indexOf(id);

  const placeAtSpawn = (id) => {
    const p = ents.current[id];
    const inf = info.current[id];
    if (!p || !inf) return;
    const pos = spawnPos(inf.team, Math.max(0, rankInTeam(id, inf.team)));
    p.x = p.px = pos.x;
    p.y = p.py = pos.y;
    p.vx = 0;
    p.vy = 0;
    p.snaps = [];
  };

  const resetBall = () => {
    const b = ball.current;
    b.x = b.px = CX;
    b.y = b.py = CY;
    b.vx = 0;
    b.vy = 0;
    b.trail = [];
    b.snaps = [];
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

    ents.current = {};
    info.current = {};
    sidMap.current = {};
    inputs.current = {};
    hostMe.current = null;
    ball.current = { x: CX, y: CY, vx: 0, vy: 0, k: 0, trail: [], snaps: [] };
    lastKickoff.current = null;
    lastGoalAt.current = null;
    lastKickCount.current = null;
    hostIdRef.current = null;
    isHost.current = false;
    goalPending.current = false;
    goalOpen.current = false;
    playerIds.current = [];
    listSig.current = "";
    metaNow.current = {};
    touchRef.current = { last: null, prev: null };
    lastStateRecv.current = Date.now(); // margen al entrar en la sala

    // Saque de centro (lo hace el host). Saca el equipo que ha encajado.
    const doKickoff = (extraMeta = {}, extraPatch = {}) => {
      kickoffTimer.current = null;
      if (!isHost.current) return;
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
      Object.assign(patch, extraPatch);
      update(baseRef, patch).catch(() => {});
    };
    kickoffFn.current = doKickoff;

    const ensureHost = () => {
      if (hostIdRef.current === null) return;
      const ids = playerIds.current.filter((id) => !isBot(id));
      if (!ids.length || ids.includes(hostIdRef.current)) return;
      if ([...ids].sort()[0] === uid) {
        update(ref(db, `${base}/meta`), { hostId: uid });
      }
    };

    // Paso a ser el host: sigo el partido desde lo último que veía
    const becomeHost = () => {
      for (const id in ents.current) {
        const p = ents.current[id];
        p.px = p.x;
        p.py = p.y;
        p.kickReady = true;
        p.kickPending = 0;
        p.snaps = [];
      }
      const b = ball.current;
      b.px = b.x;
      b.py = b.y;
      b.snaps = [];
      touchRef.current = { last: null, prev: null };
      goalPending.current = false;
    };

    // Al conectar (o reconectar): registrarse y borrarse al desconectar
    const unsubConn = onValue(ref(db, ".info/connected"), (snap) => {
      setOnline(snap.val() === true);
      if (snap.val() !== true) return;
      onDisconnect(baseRef).update({
        [`players/${uid}`]: null,
        [`in/${uid}`]: null,
      });
      const mine = info.current[uid];
      const me = ents.current[uid];
      if (mine && me) {
        update(baseRef, {
          [`players/${uid}`]: {
            name: mine.name,
            team: mine.team,
            sid: sidOf(uid),
            sx: r1(me.x),
            sy: r1(me.y),
          },
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
      const wasHost = isHost.current;
      const hostChanged = hostIdRef.current !== null && hostIdRef.current !== m.hostId;
      hostIdRef.current = m.hostId;
      isHost.current = m.hostId === uid;
      if (isHost.current && !wasHost) becomeHost();
      // Nuevo host: le damos un momento antes de pensar que se ha caído
      if (hostChanged || wasHost) lastStateRecv.current = Date.now();
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

      // Saque de centro: el host recoloca a todos; los demás, a sí mismos
      const kickoff = m.kickoff || 0;
      if (lastKickoff.current === null) {
        lastKickoff.current = kickoff;
      } else if (kickoff !== lastKickoff.current) {
        lastKickoff.current = kickoff;
        if (isHost.current) {
          for (const id in ents.current) placeAtSpawn(id);
          touchRef.current = { last: null, prev: null };
        } else {
          placeAtSpawn(uid);
          hostMe.current = null;
          for (const id in ents.current) ents.current[id].snaps = [];
        }
        resetBall();
        goalPending.current = false;
      }
      ensureHost();
    });

    // Lista de jugadores (nombre, equipo y dónde aparecen)
    const unsubPlayers = onValue(ref(db, `${base}/players`), (snap) => {
      const data = snap.val() || {};
      const map = ents.current;

      for (const id in data) {
        const d = data[id];
        const prevTeam = info.current[id]?.team;
        info.current[id] = { name: d.name, team: d.team, sid: d.sid || sidOf(id), bot: !!d.bot };
        sidMap.current[d.sid || sidOf(id)] = id;
        let p = map[id];
        const sx = Number.isFinite(d.sx) ? d.sx : spawnPos(d.team, 0).x;
        const sy = Number.isFinite(d.sy) ? d.sy : spawnPos(d.team, 0).y;
        if (!p) {
          p = map[id] = {
            x: sx,
            y: sy,
            px: sx,
            py: sy,
            vx: 0,
            vy: 0,
            r: PLAYER_R,
            inv: PLAYER_INV_MASS,
            snaps: [],
            isKicking: false,
            kickReady: true,
            kickPending: 0,
            lastKc: null,
          };
        } else if (prevTeam && prevTeam !== d.team && (isHost.current || id === uid)) {
          // Ha cambiado de equipo: a su sitio nuevo
          p.x = p.px = sx;
          p.y = p.py = sy;
          p.vx = p.vy = 0;
        }
        p.name = d.name;
        p.team = d.team;
      }
      for (const id in map) {
        if (!data[id]) {
          delete map[id];
          delete info.current[id];
          delete inputs.current[id];
        }
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
        bot: !!data[id].bot,
      }));
      const sig = list.map((p) => `${p.uid}:${p.name}:${p.team}`).join("|");
      if (sig !== listSig.current) {
        listSig.current = sig;
        setPlayersList(list);
      }
      ensureHost();
    });

    // Teclas de cada jugador (las usa el host)
    const inRef = ref(db, `${base}/in`);
    const onInput = (snap) => {
      const id = snap.key;
      if (id === uid) return;
      const v = decInput(snap.val());
      if (!v) return;
      inputs.current[id] = { bits: v.bits, at: Date.now() };
      const p = ents.current[id];
      if (p) {
        // Cada pulsación de chutar cuenta aunque haya sido muy rápida
        if (p.lastKc !== null && v.kc > p.lastKc) p.kickPending = 10;
        p.lastKc = v.kc;
      }
    };
    const unsubInAdd = onChildAdded(inRef, onInput);
    const unsubInChg = onChildChanged(inRef, onInput);

    // Fotos del partido que manda el host (las usan los demás)
    const unsubState = onValue(ref(db, `${base}/state`), (snap) => {
      if (isHost.current) return;
      const v = decState(snap.val());
      if (!v) return;
      const lt = toLocalTime(`host:${hostIdRef.current}`, v.t);
      lastStateRecv.current = Date.now();

      const b = ball.current;
      const bs = b.snaps;
      if (!bs.length || lt > bs[bs.length - 1].t) {
        bs.push({ t: lt, x: v.ball.x, y: v.ball.y, vx: v.ball.vx, vy: v.ball.vy, k: v.k });
        if (bs.length > 20) bs.shift();
      }

      // Chut de alguien: sonido y chispas
      if (lastKickCount.current !== null && v.k > lastKickCount.current) {
        if (performance.now() - lastLocalKick.current > 300) sounds.playKick();
        spawnParticles(v.ball.x, v.ball.y, "#ffffff", 6, 0.8);
      }
      lastKickCount.current = v.k;

      for (const sp of v.players) {
        const id = sidMap.current[sp.sid];
        const p = id && ents.current[id];
        if (!p) continue;
        if (id === uid) {
          hostMe.current = { t: lt, x: sp.x, y: sp.y, vx: sp.vx, vy: sp.vy };
          continue;
        }
        const s = p.snaps;
        if (!s.length || lt > s[s.length - 1].t) {
          s.push({ t: lt, x: sp.x, y: sp.y, vx: sp.vx, vy: sp.vy });
          if (s.length > 20) s.shift();
        }
        p.isKicking = sp.k;
        p.staleHost = sp.s;
      }
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

    // Estadísticas de la partida
    const unsubStats = onValue(ref(db, `${base}/stats`), (snap) => {
      setStats(snap.val() || {});
    });

    // Tareas del host: fin del tiempo / prórroga, lista pública y sala activa
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
          host: info.current[uid]?.name || "?",
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

    // Si el host minimiza la pestaña, el partido se pararía: pasa el mando a otro
    const onVisibility = () => {
      if (!document.hidden || !isHost.current) return;
      const others = playerIds.current.filter((id) => id !== uid && !isBot(id)).sort();
      if (!others.length) return;
      update(ref(db, `${base}/meta`), { hostId: others[0] }).catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      unsubConn();
      unsubMeta();
      unsubPlayers();
      unsubInAdd();
      unsubInChg();
      unsubState();
      unsubMsgs();
      unsubStats();
      clearInterval(hostTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      clearTimeout(kickoffTimer.current);
      kickoffTimer.current = null;
      kickoffFn.current = null;
      onDisconnect(baseRef).cancel();
      update(baseRef, {
        [`players/${uid}`]: null,
        [`in/${uid}`]: null,
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
      ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
    const blocked = ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
    const kickKeys = ["Space", "KeyX"];

    const down = (e) => {
      if (isTyping()) return;
      if (blocked.includes(e.code)) e.preventDefault();
      keys.current[e.code] = true;
      if (kickKeys.includes(e.code) && !e.repeat) {
        kickHoldUntil.current = performance.now() + KICK_HOLD_MS;
        kickPresses.current += 1;
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

    let animId;
    let last = performance.now();
    let acc = 0;
    let lastSync = 0;
    let lastInputStr = "";
    let lastInputSent = 0;
    let inputSeq = 0;
    let lastHostClaim = 0;
    // (invitado) balón predicho en mi pantalla: reacciona al momento cuando lo toco
    // y se va corrigiendo hacia el balón real del host
    // (invitado) Para calcular el balón en mi pantalla:
    const myHist = []; // dónde he estado en cada paso (mi pantalla)
    const myKicks = []; // chuts que he pulsado y el host aún no ha confirmado
    const rb = { x: 0, y: 0, vx: 0, vy: 0, r: BALL_R, inv: BALL_INV_MASS };
    const meDisc = { x: 0, y: 0, vx: 0, vy: 0, r: PLAYER_R, inv: PLAYER_INV_VS_BALL };
    const sTmp = { x: 0, y: 0, vx: 0, vy: 0 };
    const rOut = { x: 0, y: 0, vx: 0, vy: 0 };
    const rOld = { x: 0, y: 0, vx: 0, vy: 0 };
    const ballOff = { x: 0, y: 0 }; // pequeña corrección visual que se va apagando
    let prevHb = null;
    let myLastKc = kickPresses.current;

    // Teclas que estoy pulsando ahora mismo
    const readBits = (now) => {
      const k = keys.current;
      let bits = 0;
      if (k.KeyW || k.ArrowUp) bits |= BIT_UP;
      if (k.KeyS || k.ArrowDown) bits |= BIT_DOWN;
      if (k.KeyA || k.ArrowLeft) bits |= BIT_LEFT;
      if (k.KeyD || k.ArrowRight) bits |= BIT_RIGHT;
      if (k.Space || k.KeyX || now < kickHoldUntil.current) bits |= BIT_KICK;
      return bits;
    };

    const nameOf = (id) => info.current[id]?.name || "Alguien";
    const teamOf = (id) => info.current[id]?.team;

    // Primer toque del saque: se acaban las restricciones de campo
    const endKickoff = () => {
      if (!metaNow.current.kickoffActive) return;
      metaNow.current = { ...metaNow.current, kickoffActive: false };
      update(ref(db, `${base}/meta`), { kickoffActive: false }).catch(() => {});
    };

    // (host) apunta quién ha tocado el balón, para goles y asistencias
    const touched = (id) => {
      const t = touchRef.current;
      if (t.last !== id) touchRef.current = { last: id, prev: t.last };
      endKickoff();
    };

    // (host) gol: marcador, goleador y si se acaba el partido
    const reportGoal = (team) => {
      goalPending.current = true;
      const m = metaNow.current;
      const s = { ...scoresRef.current };
      s[team] += 1;
      scoresRef.current = s;

      const patch = {};
      const { last: lastT, prev } = touchRef.current;
      let banner = `¡GOOOL DEL EQUIPO ${team === "red" ? "ROJO" : "AZUL"}!`;
      if (lastT && teamOf(lastT) === team) {
        banner = `⚽ ¡Gol de ${nameOf(lastT)}!`;
        patch[`stats/${lastT}/g`] = increment(1);
        patch[`stats/${lastT}/n`] = nameOf(lastT);
        patch[`stats/${lastT}/t`] = team;
        if (prev && prev !== lastT && teamOf(prev) === team) {
          banner += ` (asist. ${nameOf(prev)})`;
          patch[`stats/${prev}/a`] = increment(1);
          patch[`stats/${prev}/n`] = nameOf(prev);
          patch[`stats/${prev}/t`] = team;
        }
      } else if (lastT) {
        banner = `🙈 Autogol de ${nameOf(lastT)}`;
        patch[`stats/${lastT}/og`] = increment(1);
        patch[`stats/${lastT}/n`] = nameOf(lastT);
        patch[`stats/${lastT}/t`] = teamOf(lastT) || "";
      }

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
      update(ref(db, base), patch).catch((e) => console.error(e));
    };

    // ---------- HOST: calcula todo el partido ----------
    const botState = {}; // memoria de cada bot
    let botTick = 0;
    const hostTick = (bits) => {
      botTick++;
      const all = ents.current;
      const inf = info.current;
      const b = ball.current;
      const km = metaNow.current;
      const nowMs = Date.now();
      const ids = [];
      for (const id in all) if (inf[id]) ids.push(id);

      b.px = b.x;
      b.py = b.y;

      // Mis propias pulsaciones de chutar
      const me = all[uid];
      if (me && kickPresses.current > myLastKc) {
        me.kickPending = 10;
        myLastKc = kickPresses.current;
      }

      // Movimiento de cada jugador según sus teclas
      for (const id of ids) {
        const p = all[id];
        p.px = p.x;
        p.py = p.y;
        let pb = 0;
        if (id === uid) pb = bits;
        else if (inf[id]?.bot) {
          const st = botState[id] || (botState[id] = {});
          pb = botThink(id, p, b, all, inf, km, km.botLevel || "normal", st, botTick);
        } else {
          const inp = inputs.current[id];
          // Si no llegan sus teclas en 1,5 s (se ha caído), se queda quieto
          if (inp && nowMs - inp.at < 1500) pb = inp.bits;
        }
        p.isKicking = !!(pb & BIT_KICK);
        if (!p.isKicking && !(p.kickPending > 0)) p.kickReady = true;
        stepPlayer(p, pb);
      }

      // Choques entre jugadores
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          collide(all[ids[i]], all[ids[j]], REST_PLAYER_PLAYER);
        }
      }
      for (const id of ids) {
        const p = all[id];
        for (let i = 0; i < POST_DISCS.length; i++) collide(p, POST_DISCS[i], REST_POST);
        applyKickoffLimits(p, km);
        clampToCanvas(p);
      }

      // Balón
      b.x += b.vx;
      b.y += b.vy;
      b.vx *= BALL_DAMPING;
      b.vy *= BALL_DAMPING;
      b.r = BALL_R;
      b.inv = BALL_INV_MASS;

      for (const id of ids) {
        const p = all[id];
        // Chut: al mantener la tecla o justo después de pulsarla
        if ((p.isKicking && p.kickReady) || p.kickPending > 0) {
          const dx = b.x - p.x;
          const dy = b.y - p.y;
          const d = Math.hypot(dx, dy);
          if (d > 0 && d < PLAYER_R + BALL_R + KICK_DIST) {
            b.vx += (dx / d) * KICK_STRENGTH * BALL_INV_MASS;
            b.vy += (dy / d) * KICK_STRENGTH * BALL_INV_MASS;
            p.kickReady = false;
            p.kickPending = 0;
            b.k = (b.k || 0) + 1;
            touched(id);
            sounds.playKick();
            spawnParticles(b.x, b.y, "#ffffff", 6, 0.8);
          }
        }
        if (p.kickPending > 0) p.kickPending--;

        // El balón casi no mueve al jugador (control absoluto)
        p.inv = PLAYER_INV_VS_BALL;
        if (collide(p, b, REST_PLAYER_BALL)) touched(id);
        p.inv = PLAYER_INV_MASS;
      }
      for (let i = 0; i < POST_DISCS.length; i++) collide(b, POST_DISCS[i], REST_POST);
      const scorer = ballWalls(b);

      // Si el balón está aplastado contra la pared, frena al jugador
      for (const id of ids) {
        const p = all[id];
        stuckBall.x = b.x;
        stuckBall.y = b.y;
        stuckBall.vx = b.vx;
        stuckBall.vy = b.vy;
        collide(p, stuckBall, 0);
      }

      if (scorer && !goalOpen.current && !goalPending.current && km.phase !== "over") {
        reportGoal(scorer);
      }

      const tr = b.trail;
      const head = tr.length >= 8 ? tr.pop() : { x: 0, y: 0 };
      head.x = b.x;
      head.y = b.y;
      tr.unshift(head);
    };

    // ---------- INVITADO: predice solo su jugador ----------
    const guestTick = (bits, now, tickRate, tickTime) => {
      const me = ents.current[uid];
      if (!me) return;
      guestMoveMe(me, bits, tickRate);
      // Guardo dónde estoy en cada paso (para recalcular el balón con mis movimientos)
      myHist.push({ t: tickTime, x: me.x, y: me.y, vx: me.vx, vy: me.vy });
      if (myHist.length > 90) myHist.shift();
      // Chut pulsado: lo apunto (el host lo aplicará cuando le llegue)
      if (kickPresses.current > myLastKc) {
        myLastKc = kickPresses.current;
        myKicks.push({ t: tickTime, k0: lastKickCount.current ?? 0 });
        const b = ball.current;
        if (Math.hypot(b.x - me.x, b.y - me.y) < PLAYER_R + BALL_R + KICK_DIST + 4) {
          lastLocalKick.current = performance.now();
          sounds.playKick();
        }
      }
    };

    // Posición de algo en un momento concreto, a partir de sus datos guardados
    const sampleAt = (arr, t, tickRate, out) => {
      const n = arr.length;
      if (!n) return null;
      if (t <= arr[0].t) {
        const a0 = arr[0];
        out.x = a0.x;
        out.y = a0.y;
        out.vx = a0.vx || 0;
        out.vy = a0.vy || 0;
        return out;
      }
      const last = arr[n - 1];
      if (t >= last.t) {
        const ticks = (Math.min(t - last.t, 150) / 1000) * tickRate;
        out.x = last.x + (last.vx || 0) * ticks;
        out.y = last.y + (last.vy || 0) * ticks;
        out.vx = last.vx || 0;
        out.vy = last.vy || 0;
        return out;
      }
      let i = n - 1;
      while (i > 0 && arr[i - 1].t > t) i--;
      const a = arr[i - 1];
      const c = arr[i];
      const f = (t - a.t) / Math.max(1, c.t - a.t);
      out.x = lerp(a.x, c.x, f);
      out.y = lerp(a.y, c.y, f);
      out.vx = lerp(a.vx || 0, c.vx || 0, f);
      out.vy = lerp(a.vy || 0, c.vy || 0, f);
      return out;
    };

    // ----------------------------------------------------
    // (invitado) Balón calculado con tus movimientos y tus chuts:
    // parto del último balón del host y repito la física paso a paso hasta
    // "ahora", usando dónde estabas TÚ en cada paso (y dónde estaban los demás).
    // Así el balón sale de tu pie según la superficie con la que lo tocas,
    // y coincide con el del host en cuanto el host recibe tus teclas.
    // ----------------------------------------------------
    const replayBall = (hb, tEnd, tickRate, out, meOk) => {
      const tickMs = 1000 / tickRate;
      rb.x = hb.x;
      rb.y = hb.y;
      rb.vx = hb.vx;
      rb.vy = hb.vy;
      const total = Math.max(0, Math.min((tEnd - hb.t) / tickMs, 20));
      const n = Math.floor(total);
      for (const k of myKicks) k.used = false;
      for (let i = 1; i <= n; i++) {
        const ti = hb.t + i * tickMs;
        rb.x += rb.vx;
        rb.y += rb.vy;
        rb.vx *= BALL_DAMPING;
        rb.vy *= BALL_DAMPING;
        if (meOk) {
          const m = sampleAt(myHist, ti, tickRate, sTmp);
          if (m) {
            meDisc.x = m.x;
            meDisc.y = m.y;
            meDisc.vx = m.vx;
            meDisc.vy = m.vy;
            // Mis chuts pendientes (igual que el host: una vez, en cuanto llegue al balón)
            for (const k of myKicks) {
              if (k.used || ti < k.t || ti - k.t > 350) continue;
              const dx = rb.x - meDisc.x;
              const dy = rb.y - meDisc.y;
              const d = Math.hypot(dx, dy);
              if (d > 0 && d < PLAYER_R + BALL_R + KICK_DIST) {
                rb.vx += (dx / d) * KICK_STRENGTH * BALL_INV_MASS;
                rb.vy += (dy / d) * KICK_STRENGTH * BALL_INV_MASS;
                k.used = true;
              }
            }
            collide(meDisc, rb, REST_PLAYER_BALL);
          }
        }
        for (const id in ents.current) {
          if (id === uid) continue;
          const o = ents.current[id];
          if (o.stale) continue;
          const sp = sampleAt(o.snaps || [], ti, tickRate, sTmp);
          if (!sp) continue;
          tmpDisc.inv = PLAYER_INV_VS_BALL;
          tmpDisc.x = sp.x;
          tmpDisc.y = sp.y;
          tmpDisc.vx = sp.vx;
          tmpDisc.vy = sp.vy;
          collide(tmpDisc, rb, REST_PLAYER_BALL);
        }
        for (let j = 0; j < POST_DISCS.length; j++) collide(rb, POST_DISCS[j], REST_POST);
        ballWalls(rb);
      }
      const f = total - n;
      out.x = rb.x + rb.vx * f;
      out.y = rb.y + rb.vy * f;
      out.vx = rb.vx;
      out.vy = rb.vy;
      return out;
    };

    const guestMoveMe = (me, bits, tickRate) => {
      me.px = me.x;
      me.py = me.y;
      me.isKicking = !!(bits & BIT_KICK);
      stepPlayer(me, bits);

      // No atravesar a los demás (tal y como los veo)
      for (const id in ents.current) {
        if (id === uid) continue;
        const o = ents.current[id];
        tmpDisc.x = o.x;
        tmpDisc.y = o.y;
        tmpDisc.vx = o.vx || 0;
        tmpDisc.vy = o.vy || 0;
        collide(me, tmpDisc, REST_PLAYER_PLAYER);
      }
      for (let i = 0; i < POST_DISCS.length; i++) collide(me, POST_DISCS[i], REST_POST);
      applyKickoffLimits(me, metaNow.current);
      clampToCanvas(me);

      // Corrección suave hacia donde me tiene el host (él manda)
      const hm = hostMe.current;
      if (hm) {
        const age = Math.min(
          Math.max(((Date.now() - hm.t) / 1000) * tickRate + 3, 0),
          15
        );
        const tx = hm.x + hm.vx * age;
        const ty = hm.y + hm.vy * age;
        const ex = tx - me.x;
        const ey = ty - me.y;
        if (ex * ex + ey * ey > 60 * 60) {
          me.x = me.px = tx;
          me.y = me.py = ty;
          me.vx = hm.vx;
          me.vy = hm.vy;
        } else {
          me.x += ex * 0.08;
          me.y += ey * 0.08;
          me.vx += (hm.vx - me.vx) * 0.08;
          me.vy += (hm.vy - me.vy) * 0.08;
        }
      }


      // Sin predicción del balón: mi jugador no puede meterse dentro del balón
      // tal y como lo veo (así nunca lo atravieso, por ejemplo contra la pared)
if (!predictRef.current) {
  const b = ball.current;
  if (Number.isFinite(b.x)) {
    const dx = me.x - b.x;
    const dy = me.y - b.y;
    const dist = Math.hypot(dx, dy);
    const minDist = PLAYER_R + BALL_R;
    if (dist < minDist && dist > 0) {
      me.x += (dx / dist) * (minDist - dist) * 0.15;
      me.y += (dy / dist) * (minDist - dist) * 0.15;
    }
  }
}
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
      const host = isHost.current;
      const bits = readBits(now);
      const all = ents.current;
      const b = ball.current;
      const crowded = playerIds.current.length > 8;
      const syncMs = crowded ? SYNC_MS_CROWDED : SYNC_MS;

      // Física a ritmo fijo
      acc += dt * tickRate;
      let steps = 0;
      while (acc >= 1 && steps < 8) {
        if (host) hostTick(bits);
        else guestTick(bits, now, tickRate, Date.now() - (acc - 1) * (1000 / tickRate));
        acc -= 1;
        steps++;
      }
      if (steps === 8) acc = 0;
      const alpha = Math.min(acc, 1); // para dibujar entre dos ticks sin tirones

      const wallNow = Date.now();
      if (host) {
        // Todo viene de mi propia física: dibujo entre el tick anterior y el actual
        for (const id in all) {
          const p = all[id];
          p.dx = lerp(p.px ?? p.x, p.x, alpha);
          p.dy = lerp(p.py ?? p.y, p.y, alpha);
          const inp = inputs.current[id];
          p.stale = id !== uid && !info.current[id]?.bot && (!inp || wallNow - inp.at > 2500);
        }
      } else {
        // Los demás y el balón se dibujan un poquito en el pasado (~0,1 s),
        // entre dos fotos del host: así se ven fluidos y todos ven lo mismo
        const renderT = wallNow - (syncMs * 1.5 + 30);
        for (const id in all) {
          const p = all[id];
          if (id === uid) {
            p.dx = lerp(p.px ?? p.x, p.x, alpha);
            p.dy = lerp(p.py ?? p.y, p.y, alpha);
            p.stale = false;
          } else {
            interpPlayer(p, renderT, tickRate);
            p.dx = p.x;
            p.dy = p.y;
            // "sin conexión": lo dice el host en la foto, o el host no responde
            p.stale = !!p.staleHost || wallNow - lastStateRecv.current > 2000;
          }
        }
        // El balón: el último del host, recalculado hasta ahora con mis movimientos
        const hsn = b.snaps;
        const hb = hsn[hsn.length - 1];
        const meNow = all[uid];
        const meOk = !!meNow && !meNow.stale && myHist.length > 0;
        // Chuts ya confirmados por el host o muy viejos: fuera
        while (myKicks.length && wallNow - myKicks[0].t > 600) myKicks.shift();
        if (hb && predictRef.current) {
          for (let i = myKicks.length - 1; i >= 0; i--) {
            if ((hb.k || 0) > myKicks[i].k0 && hb.t >= myKicks[i].t) myKicks.splice(i, 1);
          }
          replayBall(hb, wallNow, tickRate, rOut, meOk);
          if (prevHb && prevHb.t !== hb.t) {
            // Ha llegado una foto nueva del host: si cambia algo, lo suavizo
            replayBall(prevHb, wallNow, tickRate, rOld, meOk);
            const ox = rOld.x - rOut.x;
            const oy = rOld.y - rOut.y;
            if (ox * ox + oy * oy < 90 * 90) {
              ballOff.x += ox;
              ballOff.y += oy;
            } else {
              ballOff.x = 0;
              ballOff.y = 0;
            }
          }
          prevHb = hb;
          const dec = Math.exp(-dt * 14);
          ballOff.x *= dec;
          ballOff.y *= dec;
          b.x = rOut.x + ballOff.x;
          b.y = rOut.y + ballOff.y;
          b.vx = rOut.vx;
          b.vy = rOut.vy;
        } else {
          // Balón del host tal cual, un poco en el pasado (como los demás jugadores)
          prevHb = null;
          ballOff.x = 0;
          ballOff.y = 0;
          interpPlayer(b, renderT, tickRate);
        }
        b.px = b.x;
        b.py = b.y;
        const tr = b.trail;
        const head = tr.length >= 8 ? tr.pop() : { x: 0, y: 0 };
        head.x = b.x;
        head.y = b.y;
        tr.unshift(head);
      }

      // Seguridad: si algún número se ha estropeado (NaN), recolocar
      if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.vx)) {
        resetBall();
      }
      for (const id in all) {
        const p = all[id];
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.vx)) {
          placeAtSpawn(id);
        }
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

      // Dibujar (el balón del host, entre ticks)
      const bx = b.x;
      const by = b.y;
      if (host) {
        b.x = lerp(b.px ?? bx, bx, alpha);
        b.y = lerp(b.py ?? by, by, alpha);
      }
      const km = metaNow.current;
      renderGame(
        ctx,
        field,
        all,
        b,
        particles.current,
        fx.current,
        uid,
        km.kickoffActive ? km.kickoffTeam || "red" : null
      );
      b.x = bx;
      b.y = by;

      // Red
      if (host) {
        // El host manda la foto del partido
        if (now - lastSync >= syncMs - 4) {
          lastSync = now;
          set(
            ref(db, `${base}/state`),
            encState(Date.now(), b.k || 0, b, all, info.current)
          ).catch(() => {});
        }
      } else {
        // Los demás mandan sus teclas (al cambiar, y un aviso cada 0,3 s)
        const str = encInput(bits, kickPresses.current, 0);
        if (str !== lastInputStr || now - lastInputSent > 300) {
          lastInputStr = str;
          lastInputSent = now;
          inputSeq = (inputSeq + 1) % 1000;
          set(ref(db, `${base}/in/${uid}`), encInput(bits, kickPresses.current, inputSeq)).catch(() => {});
        }

        // Si el host deja de mandar fotos (se le ha caído), otro pasa a ser host
        if (wallNow - lastStateRecv.current > 1500 && wallNow - lastHostClaim > 3000) {
          const candidates = playerIds.current
            .filter((id) => id !== hostIdRef.current && !isBot(id))
            .sort();
          if (candidates[0] === uid) {
            lastHostClaim = wallNow;
            update(ref(db, `${base}/meta`), { hostId: uid }).catch(() => {});
          }
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

  const playerEntry = (name, team, pos) => ({
    name,
    team,
    sid: sidOf(user.uid),
    sx: r1(pos.x),
    sy: r1(pos.y),
  });

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
        players: { [user.uid]: playerEntry(name, selectedTeam, pos) },
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
        [`players/${user.uid}`]: playerEntry(name, selectedTeam, pos),
      });
      setRoomId(code);
    } catch (e) {
      console.error(e);
      alert("No se pudo entrar en la sala: " + e.message);
    }
  };

  const leaveRoom = () => {
    if (playerIds.current.filter((id) => !isBot(id)).length <= 1) {
      remove(ref(db, `rooms/${roomId}`)).catch(() => {});
      remove(ref(db, `lobby/${roomId}`)).catch(() => {});
    } else if (isHost.current) {
      // Antes de irme, paso el mando a otro para que el partido no se pare
      const others = playerIds.current.filter((id) => id !== user.uid && !isBot(id)).sort();
      update(ref(db, `rooms/${roomId}/meta`), { hostId: others[0] }).catch(() => {});
    }
    setRoomId("");
    setMeta(null);
    setMessages([]);
    setPlayersList([]);
    setMatchTime(0);
  };

  const switchTeam = (newTeam) => {
    setSelectedTeam(newTeam);
    const rank = Object.keys(info.current).filter(
      (id) => id !== user.uid && info.current[id].team === newTeam
    ).length;
    const pos = spawnPos(newTeam, rank);
    const me = ents.current[user.uid];
    if (me) {
      me.team = newTeam;
      me.x = me.px = pos.x;
      me.y = me.py = pos.y;
      me.vx = 0;
      me.vy = 0;
    }
    update(ref(db, `rooms/${roomId}/players/${user.uid}`), {
      team: newTeam,
      sx: r1(pos.x),
      sy: r1(pos.y),
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

  // Bots (solo el host): son jugadores más de la sala que mueve el host
  const addBot = (team) => {
    if (!amHost) return;
    if (playerIds.current.length >= MAX_PLAYERS) {
      alert(`La sala está llena (máximo ${MAX_PLAYERS}).`);
      return;
    }
    const id = BOT_PREFIX + Math.random().toString(36).slice(2, 7);
    const used = new Set(playersList.map((p) => p.name));
    const free = BOT_NAMES.filter((n) => !used.has(`🤖 ${n}`));
    const name = `🤖 ${free.length ? free[(Math.random() * free.length) | 0] : "Bot"}`;
    const rank = playersList.filter((p) => p.team === team).length;
    const pos = spawnPos(team, rank);
    update(ref(db, `rooms/${roomId}/players`), {
      [id]: { name, team, sid: id.slice(0, 6), sx: r1(pos.x), sy: r1(pos.y), bot: true },
    }).catch(() => {});
  };
  const removeBot = (id) => {
    if (!amHost || !isBot(id)) return;
    update(ref(db, `rooms/${roomId}`), { [`players/${id}`]: null, [`in/${id}`]: null }).catch(() => {});
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
      team: info.current[user.uid]?.team || selectedTeam,
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
                {!amHost && (
                  <button
                    onClick={() => {
                      const v = !predictBall;
                      setPredictBall(v);
                      try {
                        localStorage.setItem("hx_predict", v ? "1" : "0");
                      } catch {
                        /* nada */
                      }
                    }}
                    className={`px-2 py-0.5 rounded-lg font-bold transition ${
                      predictBall ? "bg-emerald-500 text-slate-950" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                    }`}
                    title="Calcula el balón en tu pantalla con tus movimientos (experimental)"
                  >
                    Predicción del balón: {predictBall ? "SÍ" : "NO"}
                  </button>
                )}
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
                  <label className="flex items-center gap-1">
                    Bots
                    <select
                      value={meta?.botLevel || "normal"}
                      onChange={(e) => setMatchOption("botLevel", e.target.value)}
                      className="bg-slate-800 text-slate-200 rounded-md px-1.5 py-0.5"
                    >
                      {Object.entries(BOT_LEVELS).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    onClick={() => addBot("red")}
                    className="px-2.5 py-1 rounded-lg font-bold text-white transition hover:brightness-110"
                    style={{ background: RED }}
                  >
                    + Bot rojo
                  </button>
                  <button
                    onClick={() => addBot("blue")}
                    className="px-2.5 py-1 rounded-lg font-bold text-white transition hover:brightness-110"
                    style={{ background: BLUE }}
                  >
                    + Bot azul
                  </button>
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

                    {p.bot && amHost && (
                      <button
                        onClick={() => removeBot(p.uid)}
                        className="text-[10px] font-bold bg-slate-800 hover:bg-red-600 text-slate-300 hover:text-white px-2.5 py-1 rounded-lg transition"
                        title="Quitar bot"
                      >
                        Quitar
                      </button>
                    )}
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
