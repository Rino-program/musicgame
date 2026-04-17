import './style.css';

type Screen = 'select' | 'playing' | 'result';
type Judgement = 'PERFECT' | 'GREAT' | 'GOOD' | 'BAD' | 'MISS';

type Note = {
  id: string;
  time: number;
  lane: number;
  type?: 'tap';
};

type RuntimeNote = Note & {
  judged: boolean;
  judgement?: Judgement;
  deltaMs?: number;
};

type Song = {
  id: string;
  title: string;
  artist?: string;
  bpm: number;
  difficulty: string;
  jacket?: string;
  duration: number;
  debug?: boolean;
  chart: Note[];
};

type Settings = {
  calibrationOffsetMs: number;
  speed: number;
  seVolume: number;
  musicVolume: number;
};

const LANE_KEYS = ['S', 'D', 'F', 'J', 'K', 'L'];
const LANE_COUNT = 6;
const WINDOWS_MS = {
  PERFECT: 25,
  GREAT: 45,
  GOOD: 80,
  BAD: 120,
};
const SCORE_BASE: Record<Judgement, number> = {
  PERFECT: 1000,
  GREAT: 700,
  GOOD: 400,
  BAD: 100,
  MISS: 0,
};
const ACC_WEIGHT: Record<Judgement, number> = {
  PERFECT: 1,
  GREAT: 0.8,
  GOOD: 0.5,
  BAD: 0.2,
  MISS: 0,
};
const COLORS = ['#49c1ff', '#6a8cff', '#9f73ff', '#ff73be', '#ff8a65', '#ffd166'];
const JUDGE_COLORS: Record<Judgement, string> = {
  PERFECT: '#7cf8c5',
  GREAT: '#68b6ff',
  GOOD: '#f7d774',
  BAD: '#ff8a65',
  MISS: '#ff5d77',
};

const audioCtx = new AudioContext();
const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('App container not found');
}

const appRoot = app;

const settings: Settings = {
  calibrationOffsetMs: 0,
  speed: 1,
  seVolume: 0.45,
  musicVolume: 0.5,
};

const songs: Song[] = [createDebugSong(), createSampleSong()];

let screen: Screen = 'select';
let selectedSongIndex = 0;
let audioUnlocked = false;
let gameplay: GameplaySession | null = null;

renderSongSelect();

window.addEventListener('keydown', (event) => {
  if (screen === 'select') {
    if (event.key === 'Enter') {
      void startGameplay(songs[selectedSongIndex]);
    }
    if (event.key === 'ArrowDown') {
      selectedSongIndex = (selectedSongIndex + 1) % songs.length;
      renderSongSelect();
    }
    if (event.key === 'ArrowUp') {
      selectedSongIndex = (selectedSongIndex + songs.length - 1) % songs.length;
      renderSongSelect();
    }
  }
});

function createDebugSong(): Song {
  const notes: Note[] = [];
  const start = 0.5;
  const interval = 0.5;
  const count = 72;
  for (let i = 0; i < count; i += 1) {
    notes.push({
      id: `dbg_${i}`,
      time: start + interval * i,
      lane: i % LANE_COUNT,
      type: 'tap',
    });
  }
  return {
    id: 'debug_metronome_120',
    title: 'Debug Metronome 120 BPM',
    artist: 'Generated',
    bpm: 120,
    difficulty: 'DEBUG',
    duration: start + interval * count + 1,
    debug: true,
    chart: notes,
  };
}

function createSampleSong(): Song {
  const notes: Note[] = [];
  let time = 1;
  for (let i = 0; i < 84; i += 1) {
    notes.push({ id: `sample_${i}`, time, lane: (i * 2 + (i % 3)) % LANE_COUNT, type: 'tap' });
    time += i % 7 === 0 ? 0.35 : 0.25;
  }
  return {
    id: 'pulse_steps',
    title: 'Pulse Steps',
    artist: 'Generated',
    bpm: 140,
    difficulty: 'NORMAL',
    duration: time + 1,
    chart: notes,
  };
}

function classify(deltaMsAbs: number): Judgement {
  if (deltaMsAbs <= WINDOWS_MS.PERFECT) return 'PERFECT';
  if (deltaMsAbs <= WINDOWS_MS.GREAT) return 'GREAT';
  if (deltaMsAbs <= WINDOWS_MS.GOOD) return 'GOOD';
  if (deltaMsAbs <= WINDOWS_MS.BAD) return 'BAD';
  return 'MISS';
}

function renderSongSelect(): void {
  screen = 'select';
  appRoot.innerHTML = `
    <div class="screen song-select">
      <header class="topbar">
        <h1>Web Music Game</h1>
        <button id="unlock-audio" class="ghost">${audioUnlocked ? 'Audio Ready' : 'Tap to Start Audio'}</button>
      </header>
      <main class="song-select-main">
        <section class="song-list" id="song-list"></section>
        <aside class="settings-card">
          <h2>Settings</h2>
          <label>Calibration Offset (ms)
            <input id="offset-input" type="number" min="-200" max="200" step="1" value="${settings.calibrationOffsetMs}" />
          </label>
          <label>Note Speed (${settings.speed.toFixed(2)}x)
            <input id="speed-input" type="range" min="0.8" max="1.5" step="0.05" value="${settings.speed}" />
          </label>
          <label>SE Volume (${Math.round(settings.seVolume * 100)}%)
            <input id="se-input" type="range" min="0" max="1" step="0.05" value="${settings.seVolume}" />
          </label>
          <label>Music Volume (${Math.round(settings.musicVolume * 100)}%)
            <input id="music-input" type="range" min="0" max="1" step="0.05" value="${settings.musicVolume}" />
          </label>
          <button id="play-btn" class="play">PLAY</button>
          <p class="hint">Enter: Start / ↑↓: Select Song</p>
        </aside>
      </main>
    </div>
  `;

  const list = appRoot.querySelector<HTMLDivElement>('#song-list');
  if (list) {
    list.innerHTML = songs
      .map((song, index) => {
        const selected = index === selectedSongIndex;
        return `
        <button class="song-card ${selected ? 'selected' : ''}" data-song-index="${index}">
          <div class="jacket">${song.debug ? 'DBG' : '♪'}</div>
          <div class="song-meta">
            <h3>${song.title}</h3>
            <p>${song.artist ?? 'Unknown'} / BPM ${song.bpm}</p>
            <span class="diff">${song.difficulty}</span>
          </div>
        </button>
      `;
      })
      .join('');
  }

  appRoot.querySelectorAll<HTMLButtonElement>('.song-card').forEach((card) => {
    card.addEventListener('click', () => {
      const index = Number(card.dataset.songIndex ?? 0);
      selectedSongIndex = index;
      renderSongSelect();
    });
    card.addEventListener('dblclick', () => {
      const index = Number(card.dataset.songIndex ?? 0);
      selectedSongIndex = index;
      void startGameplay(songs[index]);
    });
  });

  appRoot.querySelector<HTMLButtonElement>('#unlock-audio')?.addEventListener('click', async () => {
    await unlockAudio();
    renderSongSelect();
  });

  appRoot.querySelector<HTMLInputElement>('#offset-input')?.addEventListener('input', (event) => {
    settings.calibrationOffsetMs = Number((event.target as HTMLInputElement).value);
  });

  appRoot.querySelector<HTMLInputElement>('#speed-input')?.addEventListener('input', (event) => {
    settings.speed = Number((event.target as HTMLInputElement).value);
    renderSongSelect();
  });

  appRoot.querySelector<HTMLInputElement>('#se-input')?.addEventListener('input', (event) => {
    settings.seVolume = Number((event.target as HTMLInputElement).value);
    renderSongSelect();
  });

  appRoot.querySelector<HTMLInputElement>('#music-input')?.addEventListener('input', (event) => {
    settings.musicVolume = Number((event.target as HTMLInputElement).value);
    renderSongSelect();
  });

  appRoot.querySelector<HTMLButtonElement>('#play-btn')?.addEventListener('click', () => {
    void startGameplay(songs[selectedSongIndex]);
  });
}

type GameplayResult = {
  song: Song;
  score: number;
  maxCombo: number;
  counts: Record<Judgement, number>;
  deltas: number[];
  accuracy: number;
};

type FlashState = { power: number; color: string };
type Particle = { x: number; y: number; vx: number; vy: number; life: number; color: string };

type GameplaySession = {
  song: Song;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  notes: RuntimeNote[];
  startAt: number;
  raf: number;
  paused: boolean;
  ended: boolean;
  score: number;
  combo: number;
  maxCombo: number;
  weighted: number;
  weightedMax: number;
  counts: Record<Judgement, number>;
  deltas: number[];
  laneFlash: FlashState[];
  lanePressed: number[];
  particles: Particle[];
  judgementText: { text: string; color: string; life: number } | null;
  comboPulse: number;
  laneLayout: { left: number; top: number; width: number; height: number; laneWidth: number; judgeY: number };
  cleanup: Array<() => void>;
  activePointers: Map<number, number>;
  pauseOverlay: HTMLDivElement | null;
};

async function unlockAudio(): Promise<void> {
  if (audioCtx.state !== 'running') {
    await audioCtx.resume();
  }
  audioUnlocked = true;
}

async function startGameplay(song: Song): Promise<void> {
  await unlockAudio();
  if (gameplay) {
    cleanupGameplay();
  }
  screen = 'playing';
  appRoot.innerHTML = `
    <div class="screen gameplay-root">
      <canvas id="game-canvas"></canvas>
      <div class="hud top-left"><span id="song-name"></span></div>
      <div class="hud top-center">Score <strong id="score">0</strong> / Acc <strong id="acc">0.00%</strong> / Combo <strong id="combo">0</strong></div>
      <div class="hud top-right"><button id="pause-btn" class="ghost">Pause</button><span>ESC: Pause</span></div>
      <div class="hud judge-text" id="judge-text"></div>
      <div class="hud debug-panel" id="debug-panel"></div>
      <div class="pause-overlay hidden" id="pause-overlay">
        <div class="pause-card">
          <h2>Paused</h2>
          <button id="resume-btn">Resume</button>
          <button id="retry-btn">Retry</button>
          <button id="back-btn">Back to Select</button>
        </div>
      </div>
    </div>
  `;

  const canvas = appRoot.querySelector<HTMLCanvasElement>('#game-canvas');
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx) {
    throw new Error('Canvas not available');
  }

  const session: GameplaySession = {
    song,
    canvas,
    ctx,
    notes: song.chart.map((note) => ({ ...note, judged: false })),
    startAt: audioCtx.currentTime + 1,
    raf: 0,
    paused: false,
    ended: false,
    score: 0,
    combo: 0,
    maxCombo: 0,
    weighted: 0,
    weightedMax: 0,
    counts: { PERFECT: 0, GREAT: 0, GOOD: 0, BAD: 0, MISS: 0 },
    deltas: [],
    laneFlash: Array.from({ length: LANE_COUNT }, () => ({ power: 0, color: '#ffffff' })),
    lanePressed: Array.from({ length: LANE_COUNT }, () => 0),
    particles: [],
    judgementText: null,
    comboPulse: 0,
    laneLayout: { left: 0, top: 0, width: 0, height: 0, laneWidth: 0, judgeY: 0 },
    cleanup: [],
    activePointers: new Map(),
    pauseOverlay: appRoot.querySelector<HTMLDivElement>('#pause-overlay'),
  };
  gameplay = session;

  scheduleSongAudio(session);
  bindGameplayInputs(session);
  resizeCanvas(session);
  session.raf = requestAnimationFrame(() => frame(session));
}

function scheduleSongAudio(session: GameplaySession): void {
  const beat = 60 / session.song.bpm;

  if (session.song.debug) {
    session.song.chart.forEach((note) => {
      scheduleClick(session.startAt + note.time, settings.musicVolume * 0.9, 1200);
    });
    return;
  }

  for (let t = 0; t < session.song.duration; t += beat) {
    const hi = Math.round(t / beat) % 4 === 0;
    scheduleClick(session.startAt + t, settings.musicVolume * (hi ? 0.8 : 0.4), hi ? 700 : 420);
  }
}

function scheduleClick(when: number, volume: number, freq: number): void {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'square';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), when + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.03);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(when);
  osc.stop(when + 0.035);
}

function playHitSe(): void {
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'triangle';
  osc.frequency.value = 950;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, settings.seVolume * 0.6), now + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.045);
}

function updateHud(
  session: GameplaySession,
  scoreEl: Element | null,
  accEl: Element | null,
  comboEl: Element | null,
): void {
  if (!scoreEl || !accEl || !comboEl) return;
  scoreEl.textContent = String(Math.round(session.score));
  accEl.textContent = `${(getAccuracy(session) * 100).toFixed(2)}%`;
  comboEl.textContent = String(session.combo);
}

function bindGameplayInputs(session: GameplaySession): void {
  const scoreEl = appRoot.querySelector('#score');
  const accEl = appRoot.querySelector('#acc');
  const comboEl = appRoot.querySelector('#combo');
  const songNameEl = appRoot.querySelector('#song-name');
  songNameEl!.textContent = `${session.song.title} [${session.song.difficulty}]`;

  const syncHud = (): void => {
    updateHud(session, scoreEl, accEl, comboEl);
  };
  syncHud();

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat || session.ended) return;

    if (event.key === 'Escape') {
      togglePause(session, true);
      return;
    }

    if (event.key === '[' || event.key === ']') {
      const amount = event.shiftKey ? 5 : 1;
      settings.calibrationOffsetMs += event.key === '[' ? -amount : amount;
      return;
    }

    const lane = LANE_KEYS.findIndex((key) => key.toLowerCase() === event.key.toLowerCase());
    if (lane >= 0) {
      handleLaneInput(session, lane);
      syncHud();
    }
  };

  const onResize = (): void => resizeCanvas(session);

  const onPointerDown = (event: PointerEvent): void => {
    const lane = laneFromPointer(session, event.clientX, event.clientY);
    if (lane < 0) return;
    session.activePointers.set(event.pointerId, lane);
    handleLaneInput(session, lane);
    syncHud();
  };

  const onPointerUp = (event: PointerEvent): void => {
    session.activePointers.delete(event.pointerId);
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', onResize);
  session.canvas.addEventListener('pointerdown', onPointerDown);
  session.canvas.addEventListener('pointerup', onPointerUp);
  session.canvas.addEventListener('pointercancel', onPointerUp);

  appRoot.querySelector<HTMLButtonElement>('#pause-btn')?.addEventListener('click', () => togglePause(session, true));
  appRoot.querySelector<HTMLButtonElement>('#resume-btn')?.addEventListener('click', () => togglePause(session, false));
  appRoot.querySelector<HTMLButtonElement>('#retry-btn')?.addEventListener('click', () => {
    cleanupGameplay();
    void startGameplay(session.song);
  });
  appRoot.querySelector<HTMLButtonElement>('#back-btn')?.addEventListener('click', () => {
    cleanupGameplay();
    renderSongSelect();
  });

  session.cleanup.push(() => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('resize', onResize);
    session.canvas.removeEventListener('pointerdown', onPointerDown);
    session.canvas.removeEventListener('pointerup', onPointerUp);
    session.canvas.removeEventListener('pointercancel', onPointerUp);
  });
}

function togglePause(session: GameplaySession, pause: boolean): void {
  if (session.ended) return;
  if (pause === session.paused) return;
  session.paused = pause;
  if (pause) {
    session.pauseOverlay?.classList.remove('hidden');
    void audioCtx.suspend();
  } else {
    session.pauseOverlay?.classList.add('hidden');
    void audioCtx.resume();
  }
}

function laneFromPointer(session: GameplaySession, x: number, y: number): number {
  const rect = session.canvas.getBoundingClientRect();
  const px = x - rect.left;
  const py = y - rect.top;
  const laneRect = session.laneLayout;
  if (px < laneRect.left || px > laneRect.left + laneRect.width || py < laneRect.top || py > laneRect.top + laneRect.height) {
    return -1;
  }
  const lane = Math.floor((px - laneRect.left) / laneRect.laneWidth);
  return Math.max(0, Math.min(LANE_COUNT - 1, lane));
}

function handleLaneInput(session: GameplaySession, lane: number): void {
  if (session.paused) return;
  session.lanePressed[lane] = 1;

  const tHit = audioCtx.currentTime - session.startAt + settings.calibrationOffsetMs / 1000;
  let bestIndex = -1;
  let bestAbs = Number.POSITIVE_INFINITY;

  session.notes.forEach((note, idx) => {
    if (note.judged || note.lane !== lane) return;
    const delta = (tHit - note.time) * 1000;
    const abs = Math.abs(delta);
    if (abs <= WINDOWS_MS.BAD && abs < bestAbs) {
      bestIndex = idx;
      bestAbs = abs;
    }
  });

  if (bestIndex < 0) {
    return;
  }

  const best = session.notes[bestIndex];
  const deltaMs = (tHit - best.time) * 1000;
  const judgement = classify(Math.abs(deltaMs));
  applyJudgement(session, best, judgement, deltaMs);
}

function applyJudgement(session: GameplaySession, note: RuntimeNote, judgement: Judgement, deltaMs: number): void {
  if (note.judged) return;

  note.judged = true;
  note.judgement = judgement;
  note.deltaMs = deltaMs;

  session.counts[judgement] += 1;
  session.weighted += ACC_WEIGHT[judgement];
  session.weightedMax += 1;

  if (judgement === 'MISS') {
    session.combo = 0;
  } else {
    const multiplier = Math.min(2, 1 + session.combo * 0.002);
    session.score += SCORE_BASE[judgement] * multiplier;
    session.combo += 1;
    session.maxCombo = Math.max(session.maxCombo, session.combo);
    session.deltas.push(deltaMs);
    playHitSe();
  }

  session.judgementText = { text: judgement, color: JUDGE_COLORS[judgement], life: 1 };
  session.comboPulse = 1;
  session.laneFlash[note.lane] = {
    power: 1,
    color: judgement === 'MISS' ? '#ff5d77' : JUDGE_COLORS[judgement],
  };

  for (let i = 0; i < 8; i += 1) {
    const angle = (Math.PI * 2 * i) / 8;
    session.particles.push({
      x: session.laneLayout.left + session.laneLayout.laneWidth * (note.lane + 0.5),
      y: session.laneLayout.judgeY,
      vx: Math.cos(angle) * (40 + Math.random() * 50),
      vy: Math.sin(angle) * (40 + Math.random() * 50) - 15,
      life: 0.35 + Math.random() * 0.25,
      color: judgement === 'MISS' ? '#ff5d77' : JUDGE_COLORS[judgement],
    });
  }

  if (session.particles.length > 240) {
    session.particles.splice(0, session.particles.length - 240);
  }
}

function frame(session: GameplaySession): void {
  if (session.ended) return;

  if (!session.paused) {
    const songTime = audioCtx.currentTime - session.startAt;
    updateAutoplayMiss(session, songTime);

    if (songTime > session.song.duration + 0.5 && session.notes.every((note) => note.judged)) {
      finishGameplay(session);
      return;
    }

    draw(session, songTime);
    updateUi(session, songTime);
  }

  session.raf = requestAnimationFrame(() => frame(session));
}

function updateAutoplayMiss(session: GameplaySession, songTime: number): void {
  session.notes.forEach((note) => {
    if (note.judged) return;
    if ((songTime - note.time) * 1000 > WINDOWS_MS.BAD) {
      applyJudgement(session, note, 'MISS', WINDOWS_MS.BAD + 1);
    }
  });
}

function updateUi(session: GameplaySession, songTime: number): void {
  const scoreEl = appRoot.querySelector('#score');
  const accEl = appRoot.querySelector('#acc');
  const comboEl = appRoot.querySelector('#combo');
  const judgeEl = appRoot.querySelector('#judge-text');
  const debugEl = appRoot.querySelector('#debug-panel');

  updateHud(session, scoreEl, accEl, comboEl);

  if (judgeEl) {
    if (session.judgementText) {
      session.judgementText.life = Math.max(0, session.judgementText.life - 0.03);
      if (session.judgementText.life <= 0) {
        session.judgementText = null;
        judgeEl.textContent = '';
      } else {
        judgeEl.textContent = session.judgementText.text;
        judgeEl.setAttribute('style', `color:${session.judgementText.color};opacity:${session.judgementText.life}`);
      }
    }
  }

  if (debugEl) {
    const recent = session.deltas.slice(-10).reverse();
    debugEl.innerHTML = `
      <h3>Debug</h3>
      <p>songTime: ${songTime.toFixed(3)}s</p>
      <p>offset: ${settings.calibrationOffsetMs}ms ([ / ] for ±1, Shift ±5)</p>
      <p>input delta(ms): ${recent.length > 0 ? recent.map((v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`).join(', ') : '---'}</p>
      <div class="mini-hist">${renderMiniHistogram(recent)}</div>
    `;
  }
}

function renderMiniHistogram(values: number[]): string {
  const bins = new Array(9).fill(0);
  values.forEach((value) => {
    const clamped = Math.max(-60, Math.min(60, value));
    const idx = Math.min(8, Math.max(0, Math.floor(((clamped + 60) / 120) * 9)));
    bins[idx] += 1;
  });

  return bins
    .map((count, idx) => {
      const center = -53 + idx * 13;
      const perfect = Math.abs(center) <= WINDOWS_MS.PERFECT;
      return `<span class="bar ${perfect ? 'perfect' : ''}" style="height:${Math.max(8, count * 8)}px"></span>`;
    })
    .join('');
}

function draw(session: GameplaySession, songTime: number): void {
  const { ctx, canvas } = session;
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#070a14';
  ctx.fillRect(0, 0, w, h);

  const laneAreaW = Math.min(w * 0.56, 720);
  const laneAreaH = h * 0.92;
  const left = (w - laneAreaW) * 0.5;
  const top = h * 0.04;
  const laneWidth = laneAreaW / LANE_COUNT;
  const judgeY = top + laneAreaH * 0.82;

  session.laneLayout = { left, top, width: laneAreaW, height: laneAreaH, laneWidth, judgeY };

  for (let lane = 0; lane < LANE_COUNT; lane += 1) {
    const laneX = left + lane * laneWidth;
    const grd = ctx.createLinearGradient(0, top, 0, top + laneAreaH);
    grd.addColorStop(0, 'rgba(255,255,255,0.03)');
    grd.addColorStop(1, 'rgba(255,255,255,0.08)');
    ctx.fillStyle = grd;
    ctx.fillRect(laneX, top, laneWidth, laneAreaH);

    const flash = session.laneFlash[lane];
    if (flash.power > 0.01) {
      ctx.fillStyle = `${flash.color}${Math.round(Math.min(255, flash.power * 120)).toString(16).padStart(2, '0')}`;
      ctx.fillRect(laneX, judgeY - 60, laneWidth, 120);
      flash.power *= 0.88;
    }

    if (session.lanePressed[lane] > 0.01) {
      const alpha = session.lanePressed[lane];
      ctx.fillStyle = `rgba(255,255,255,${0.2 * alpha})`;
      ctx.fillRect(laneX, judgeY - 30, laneWidth, 70);
      session.lanePressed[lane] *= 0.84;
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.strokeRect(laneX, top, laneWidth, laneAreaH);

    ctx.fillStyle = '#ffffffcc';
    ctx.font = `${Math.max(16, laneWidth * 0.2)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(LANE_KEYS[lane], laneX + laneWidth / 2, judgeY + 28);
  }

  ctx.strokeStyle = '#c5f7ff';
  ctx.shadowBlur = 14;
  ctx.shadowColor = '#7ce7ff';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(left, judgeY);
  ctx.lineTo(left + laneAreaW, judgeY);
  ctx.stroke();
  ctx.shadowBlur = 0;

  const pps = 440 * settings.speed;
  session.notes.forEach((note) => {
    if (note.judged) return;
    const delta = note.time - songTime;
    const y = judgeY - delta * pps;
    if (y < top - 30 || y > top + laneAreaH + 30) return;

    const laneX = left + note.lane * laneWidth + laneWidth * 0.12;
    const noteW = laneWidth * 0.76;
    const noteH = Math.max(18, laneWidth * 0.18);
    const glow = Math.max(0, 1 - Math.min(1, Math.abs(delta) / 0.35));

    ctx.fillStyle = COLORS[note.lane];
    ctx.globalAlpha = 0.65 + glow * 0.35;
    roundRect(ctx, laneX, y - noteH / 2, noteW, noteH, 8);
    ctx.fill();

    if (glow > 0) {
      ctx.globalAlpha = glow * 0.7;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      roundRect(ctx, laneX - 2, y - noteH / 2 - 2, noteW + 4, noteH + 4, 10);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  });

  const dt = 1 / 60;
  session.particles = session.particles.filter((p) => p.life > 0);
  session.particles.forEach((p) => {
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 90 * dt;

    ctx.globalAlpha = Math.max(0, p.life * 1.5);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  });

  if (session.comboPulse > 0.01) {
    ctx.fillStyle = '#ffffff88';
    ctx.font = `${Math.round(40 + session.comboPulse * 14)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(`${session.combo} Combo`, w * 0.5, top + 56);
    session.comboPulse *= 0.88;
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function getAccuracy(session: GameplaySession): number {
  if (session.weightedMax === 0) return 0;
  return session.weighted / session.weightedMax;
}

function finishGameplay(session: GameplaySession): void {
  session.ended = true;
  cancelAnimationFrame(session.raf);
  const result: GameplayResult = {
    song: session.song,
    score: Math.round(session.score),
    maxCombo: session.maxCombo,
    counts: session.counts,
    deltas: session.deltas,
    accuracy: getAccuracy(session),
  };
  cleanupGameplay(false);
  renderResult(result);
}

function cleanupGameplay(clearScreen = true): void {
  if (!gameplay) return;
  gameplay.ended = true;
  cancelAnimationFrame(gameplay.raf);
  gameplay.cleanup.forEach((fn) => fn());
  gameplay = null;
  if (clearScreen) {
    appRoot.innerHTML = '';
  }
}

function renderResult(result: GameplayResult): void {
  screen = 'result';
  const avg = result.deltas.length ? result.deltas.reduce((a, b) => a + b, 0) / result.deltas.length : 0;
  const variance =
    result.deltas.length > 0
      ? result.deltas.reduce((sum, value) => sum + (value - avg) ** 2, 0) / result.deltas.length
      : 0;
  const std = Math.sqrt(variance);

  appRoot.innerHTML = `
    <div class="screen result-screen">
      <h1>RESULT</h1>
      <h2>${result.song.title} / ${result.song.difficulty}</h2>
      <div class="result-grid">
        <div><strong>Score</strong><span>${result.score}</span></div>
        <div><strong>Accuracy</strong><span>${(result.accuracy * 100).toFixed(2)}%</span></div>
        <div><strong>Max Combo</strong><span>${result.maxCombo}</span></div>
        <div><strong>Average Delta</strong><span>${avg >= 0 ? '+' : ''}${avg.toFixed(2)}ms</span></div>
        <div><strong>Std Dev</strong><span>${std.toFixed(2)}ms</span></div>
      </div>
      <div class="judge-breakdown">
        ${Object.entries(result.counts)
          .map(([key, value]) => `<p><span>${key}</span><strong>${value}</strong></p>`)
          .join('')}
      </div>
      <div class="histogram">${renderResultHistogram(result.deltas)}</div>
      <div class="actions">
        <button id="retry-result">Retry</button>
        <button id="back-result" class="ghost">Back to Select</button>
      </div>
    </div>
  `;

  appRoot.querySelector<HTMLButtonElement>('#retry-result')?.addEventListener('click', () => {
    void startGameplay(result.song);
  });
  appRoot.querySelector<HTMLButtonElement>('#back-result')?.addEventListener('click', () => {
    renderSongSelect();
  });
}

function renderResultHistogram(deltas: number[]): string {
  const bins = new Array(25).fill(0);
  const min = -120;
  const max = 120;

  deltas.forEach((delta) => {
    const clamped = Math.max(min, Math.min(max, delta));
    const ratio = (clamped - min) / (max - min);
    const idx = Math.max(0, Math.min(bins.length - 1, Math.floor(ratio * bins.length)));
    bins[idx] += 1;
  });

  return bins
    .map((count, idx) => {
      const center = min + ((idx + 0.5) * (max - min)) / bins.length;
      const perfect = Math.abs(center) <= WINDOWS_MS.PERFECT;
      return `<span class="hbar ${perfect ? 'perfect' : ''}" style="height:${Math.max(6, count * 7)}px"></span>`;
    })
    .join('');
}

function resizeCanvas(session: GameplaySession): void {
  const dpr = window.devicePixelRatio || 1;
  const width = window.innerWidth;
  const height = window.innerHeight;
  session.canvas.width = Math.floor(width * dpr);
  session.canvas.height = Math.floor(height * dpr);
  session.canvas.style.width = `${width}px`;
  session.canvas.style.height = `${height}px`;
  session.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
