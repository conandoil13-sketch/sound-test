// ====== 전역 전투 상태 ======
let you = { hp: 100 };
let enemy = { hp: 100 };

// ====== 오디오/분석 셋업 ======
let ctx, media, analyser, timeBuf, freqBuf;
const FFT_SIZE = 4096;   // 주파수 해상도/지연 균형치
const SAMPLE_MS = 1000;  // 공격 샘플 길이(1초)

// ====== DOM ======
const $ = (id) => document.getElementById(id);
const log = (msg) => { const L = $('log'); L.textContent += msg + "\n"; L.scrollTop = L.scrollHeight; };
const setHP = (who, val) => {
    who.hp = Math.max(0, Math.min(100, val));
    if (who === you) {
        $('hpYou').style.width = who.hp + '%';
        $('hpYouTxt').textContent = who.hp;
    } else {
        $('hpEnemy').style.width = who.hp + '%';
        $('hpEnemyTxt').textContent = who.hp;
    }
};

// ====== 이벤트 ======
$('btnInit').onclick = initAudio;
$('btnAttack').onclick = async () => {
    const feat = await sampleAndAnalyze(SAMPLE_MS);
    const result = resolveAttackFromFeatures(feat);
    applyAttack('you', result);
    renderFeatureSummary(feat, result);
    if (enemy.hp <= 0) endBattle('승리!');
};
$('btnEnemy').onclick = () => {
    const dmg = Math.floor(Math.random() * 12) + 6;
    setHP(you, you.hp - dmg);
    log(`🟥 적이 ${dmg} 피해를 주었다.`);
    if (you.hp <= 0) endBattle('패배…');
};

// ====== 초기화 ======
async function initAudio() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') await ctx.resume();

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    media = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0.2;
    media.connect(analyser);

    timeBuf = new Float32Array(analyser.fftSize);
    freqBuf = new Uint8Array(analyser.frequencyBinCount);

    $('btnAttack').disabled = false;
    $('btnEnemy').disabled = false;
    log('✅ 오디오 초기화 완료. 공격 버튼을 눌러보세요.');
}

// ====== 샘플링 + 특징 추출 ======
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function sampleAndAnalyze(ms) {
    const start = performance.now();
    const frames = [];
    while (performance.now() - start < ms) {
        analyser.getFloatTimeDomainData(timeBuf);
        frames.push(Float32Array.from(timeBuf));
        await sleep(16); // ~60fps
    }
    analyser.getByteFrequencyData(freqBuf);

    const merged = mergeFrames(frames);
    const A = computeTimeDomainFeatures(merged);
    const B = computeFreqDomainFeatures(freqBuf, ctx.sampleRate, analyser.fftSize);
    const C = computePitchRhythm(merged, ctx.sampleRate);
    return { ...A, ...B, ...C, sampleMs: ms };
}

function mergeFrames(frames) {
    const N = frames.length;
    if (!N) return new Float32Array(0);
    const L = frames[0].length;
    const out = new Float32Array(L);
    for (let i = 0; i < L; i++) {
        let s = 0; for (let f = 0; f < N; f++) s += frames[f][i];
        out[i] = s / N;
    }
    return out;
}

// --- A. 시간영역 ---
function computeTimeDomainFeatures(buf) {
    if (!buf || buf.length === 0) return { rms: 0, zcr: 0, silenceRatio: 1, peak: 0 };
    const L = buf.length;
    let sumSq = 0, peak = 0, zeros = 0, silence = 0;
    for (let i = 0; i < L; i++) {
        const v = buf[i];
        sumSq += v * v;
        if (Math.abs(v) > peak) peak = Math.abs(v);
        if (i > 0 && (buf[i - 1] >= 0) !== (v >= 0)) zeros++;
        if (Math.abs(v) < 0.02) silence++;
    }
    const rms = Math.sqrt(sumSq / L);
    const zcr = zeros / L;
    const silenceRatio = silence / L;
    return { rms, zcr, silenceRatio, peak };
}

// --- B. 주파수영역 ---
function computeFreqDomainFeatures(freqUint8, sampleRate, fftSize) {
    const N = freqUint8.length; // fftSize/2
    let sum = 0, weighted = 0;
    for (let i = 0; i < N; i++) { sum += freqUint8[i]; weighted += freqUint8[i] * i; }
    const centroidBin = sum ? (weighted / sum) : 0;

    const target = sum * 0.85;
    let acc = 0, rolloffBin = 0;
    for (let i = 0; i < N; i++) { acc += freqUint8[i]; if (acc >= target) { rolloffBin = i; break; } }
    const bandwidth = Math.max(0, rolloffBin - centroidBin);

    const binHz = (sampleRate / 2) / N;
    return {
        spectralCentroidBin: centroidBin,
        spectralCentroidHz: centroidBin * binHz,
        bandwidthBin: bandwidth,
        bandwidthHz: bandwidth * binHz,
        rolloffBin
    };
}

// --- C. 피치/리듬 ---
function computePitchRhythm(buf, sampleRate) {
    const pitchHz = estimatePitchACF(buf, sampleRate);

    const chunks = 6;
    const len = Math.floor(buf.length / chunks);
    const arr = [];
    for (let c = 0; c < chunks; c++) {
        const seg = buf.slice(c * len, (c + 1) * len);
        const p = estimatePitchACF(seg, sampleRate);
        if (p > 0) arr.push(p);
    }
    const mean = arr.length ? arr.reduce((a, b) => a + b) / arr.length : 0;
    const sd = arr.length ? Math.sqrt(arr.reduce((a, b) => a + (b - mean) * (b - mean), 0) / arr.length) : 0;

    let onset = 0, prevE = 0, win = 256;
    for (let i = 0; i < buf.length; i += win) {
        const e = rmsSlice(buf, i, Math.min(i + win, buf.length));
        if (i > 0 && (e - prevE) > 0.05) onset++;
        prevE = e;
    }
    return { pitchHz, pitchStability: sd, onsetDensity: onset };
}

function rmsSlice(buf, s, e) {
    let sum = 0, n = 0;
    for (let i = s; i < e; i++) { const v = buf[i]; sum += v * v; n++; }
    return n ? Math.sqrt(sum / n) : 0;
}

// 간단 ACF 피치 추정(단일음에 강함)
function estimatePitchACF(buf, sampleRate) {
    const n = buf.length;
    let mean = 0; for (let i = 0; i < n; i++) mean += buf[i]; mean /= n;
    const x = new Float32Array(n);
    let maxAbs = 0;
    for (let i = 0; i < n; i++) { x[i] = buf[i] - mean; maxAbs = Math.max(maxAbs, Math.abs(x[i])); }
    if (maxAbs > 0) for (let i = 0; i < n; i++) x[i] /= maxAbs;

    const minLag = Math.floor(sampleRate / 800);
    const maxLag = Math.floor(sampleRate / 70);
    let bestLag = -1, bestCorr = 0;

    for (let lag = minLag; lag <= maxLag; lag++) {
        let corr = 0;
        for (let i = 0; i < n - lag; i++) corr += x[i] * x[i + lag];
        corr /= (n - lag);
        if (corr > bestCorr) { bestCorr = corr; bestLag = lag; }
    }
    if (bestLag > 0 && bestCorr > 0.2) return sampleRate / bestLag;
    return 0;
}

// ====== 스킬/대미지 규칙 ======
function resolveAttackFromFeatures(f) {
    const baseATK = Math.round(10 + f.rms * 60);

    const cen = f.spectralCentroidHz;
    let element = 'Earth';
    if (cen > 4000) element = 'Wind';
    else if (cen > 2000) element = 'Fire';
    else if (cen > 900) element = 'Water';

    const p = f.pitchHz;
    let skill = 'Balanced Strike';
    if (p > 650) skill = 'Swift Flurry';
    else if (p > 200) skill = 'Tempo Slash';
    else if (p > 60) skill = 'Bass Smash';
    else skill = 'Noise Burst';

    const accuracy = Math.max(60, 95 - f.bandwidthHz / 50 - f.pitchStability / 5);
    const combo = Math.min(5, 1 + Math.floor(f.onsetDensity / 2));
    const critChance = Math.min(45, Math.round(f.zcr * 200));
    const silenceBoost = (f.silenceRatio > 0.6) ? -5 : 0;

    let dmg = baseATK + silenceBoost;
    if (Math.random() * 100 < critChance) {
        dmg = Math.round(dmg * 1.5);
        skill += ' ★CRIT';
    }
    dmg = Math.round(dmg * (1 + (combo - 1) * 0.75 * 0.15));

    return { skill, element, dmg: Math.max(1, dmg), accuracy: Math.round(accuracy), combo };
}

// ====== 전투 적용 & UI ======
function applyAttack(who, result) {
    if (Math.random() * 100 > result.accuracy) {
        log(`🔸 ${who === 'you' ? '당신' : '적'}의 ${result.skill} (속성:${result.element}) 은/는 빗나갔다!`);
        return;
    }
    if (who === 'you') {
        setHP(enemy, enemy.hp - result.dmg);
        log(`🟦 당신의 ${result.skill} (속성:${result.element}) → 적에게 ${result.dmg} 피해!`);
    } else {
        setHP(you, you.hp - result.dmg);
        log(`🟥 적의 ${result.skill} (속성:${result.element}) → 당신에게 ${result.dmg} 피해!`);
    }
}

function endBattle(msg) {
    log(`\n🏁 ${msg}`);
    $('btnAttack').disabled = true;
    $('btnEnemy').disabled = true;
}

function renderFeatureSummary(f, r) {
    const tags = [];
    const push = (t) => tags.push(`<span class="tag">${t}</span>`);
    push(`A: RMS ${f.rms.toFixed(3)}`);
    push(`A: ZCR ${f.zcr.toFixed(3)}`);
    push(`A: Silence ${Math.round(f.silenceRatio * 100)}%`);
    push(`B: Centroid ${Math.round(f.spectralCentroidHz)}Hz`);
    push(`B: Bandwidth ${Math.round(f.bandwidthHz)}Hz`);
    push(`C: Pitch ${Math.round(f.pitchHz)}Hz`);
    push(`C: Onsets ${f.onsetDensity}`);
    push(`C: Stability ${Math.round(f.pitchStability)}`);
    $('tags').innerHTML = tags.join(' ');

    $('stats').textContent =
        `[A: 시간영역]
  RMS         : ${f.rms.toFixed(4)}
  Peak        : ${f.peak.toFixed(4)}
  ZCR         : ${f.zcr.toFixed(4)}
  Silence     : ${(f.silenceRatio * 100).toFixed(1)}%

[B: 주파수영역]
  Centroid    : ${f.spectralCentroidHz.toFixed(1)} Hz (bin ${f.spectralCentroidBin.toFixed(1)})
  Bandwidth   : ${f.bandwidthHz.toFixed(1)} Hz (bin ${f.bandwidthBin.toFixed(1)})
  RolloffBin  : ${f.rolloffBin}

[C: 피치/리듬]
  Pitch       : ${f.pitchHz.toFixed(1)} Hz
  StabilitySD : ${f.pitchStability.toFixed(1)}
  OnsetCount  : ${f.onsetDensity}

[결과]
  Skill       : ${r.skill}
  Element     : ${r.element}
  Combo       : x${r.combo}
  Accuracy    : ${r.accuracy}%
  Damage      : ${r.dmg}
`;
}
