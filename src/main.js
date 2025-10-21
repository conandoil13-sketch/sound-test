// ====== 전역 전투 상태 ======
let you = { hp: 100 };
let enemy = { hp: 100 };

// ====== 오디오/분석 셋업 ======
let ctx, media, analyser, timeBuf, freqBuf;
const FFT_SIZE = 4096;   // 주파수 해상도/지연 균형치
const SAMPLE_MS = 1000;  // 공격 샘플 길이(1초)

// ====== DOM 유틸 ======
const $ = (id) => document.getElementById(id);
const log = (msg) => { const L = $('log'); if (!L) return; L.textContent += msg + "\n"; L.scrollTop = L.scrollHeight; };
const setHP = (who, val) => {
    who.hp = Math.max(0, Math.min(100, val));
    if (who === you) {
        if ($('hpYou')) $('hpYou').style.width = who.hp + '%';
        if ($('hpYouTxt')) $('hpYouTxt').textContent = String(who.hp);
    } else {
        if ($('hpEnemy')) $('hpEnemy').style.width = who.hp + '%';
        if ($('hpEnemyTxt')) $('hpEnemyTxt').textContent = String(who.hp);
    }
};
const setStatus = (t) => { const s = $('status'); if (s) s.textContent = t; };

// ====== 마이크 요청(버튼 클릭 제스처 안에서 호출) ======
async function requestMicOnce() {
    // 보안 컨텍스트 경고(https 또는 localhost 권장)
    const secure = (location.protocol === 'https:' || location.hostname === 'localhost');
    if (!secure) {
        console.warn('Not a secure context. Use https or http://localhost for microphone.');
        setStatus('⚠️ 보안 컨텍스트가 아닙니다. https 또는 http://localhost 로 실행하세요.');
    }

    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') await ctx.resume();

    // 이미 초기화됐다면 재요청 불필요
    if (analyser && media && timeBuf && freqBuf) return true;

    if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) {
        throw new Error('이 브라우저는 getUserMedia를 지원하지 않거나 비활성화되어 있습니다.');
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    media = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0.2;
    media.connect(analyser);

    timeBuf = new Float32Array(analyser.fftSize);
    freqBuf = new Uint8Array(analyser.frequencyBinCount);
    return true;
}

// ====== 초기화(옵션) ======
async function initAudio() {
    try {
        await requestMicOnce();
        if ($('btnAttack')) $('btnAttack').disabled = false;
        if ($('btnEnemy')) $('btnEnemy').disabled = false;
        setStatus('✅ 오디오 초기화 완료. “공격(1초 녹음)” 버튼을 눌러보세요.');
        log('✅ 오디오 초기화 완료.');
    } catch (err) {
        showMicError(err);
    }
}

// ====== 이벤트 바인딩 ======
window.addEventListener('DOMContentLoaded', () => {
    if ($('btnInit')) $('btnInit').onclick = initAudio;

    if ($('btnAttack')) $('btnAttack').onclick = async () => {
        try {
            // 공격 버튼 클릭 시점에서 권한 요청/초기화 진행 → 팝업 떠야 함
            await requestMicOnce();
            const feat = await sampleAndAnalyze(SAMPLE_MS);
            const result = resolveAttackFromFeatures(feat);
            applyAttack('you', result);
            renderFeatureSummary(feat, result);
            if (enemy.hp <= 0) endBattle('승리!');
        } catch (err) {
            showMicError(err);
        }
    };

    if ($('btnEnemy')) $('btnEnemy').onclick = () => {
        const dmg = Math.floor(Math.random() * 12) + 6;
        setHP(you, you.hp - dmg);
        log(`🟥 적이 ${dmg} 피해를 주었다.`);
        if (you.hp <= 0) endBattle('패배…');
    };
});

// ====== 에러 표시 ======
function showMicError(err) {
    console.error(err);
    let msg = '❌ 마이크 초기화/요청 실패: ';
    if (err && err.name === 'NotAllowedError') msg += '권한이 거부되었습니다. 브라우저/OS 설정에서 허용 후 다시 시도.';
    else if (err && err.name === 'NotFoundError') msg += '마이크 장치를 찾을 수 없습니다.';
    else if (location.protocol !== 'https:' && location.hostname !== 'localhost') msg += 'https 또는 http://localhost 에서만 동작합니다.';
    else msg += (err && (err.message || String(err))) || '알 수 없는 오류';
    setStatus(msg);
    log(msg);
}

// ====== 샘플링 + 특징 추출 ======
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function sampleAndAnalyze(ms) {
    const start = performance.now();
    const frames = [];
    while (performance.now() - start < ms) {
        analyser.getFloatTimeDomainData(timeBuf);
        frames.push(Float32Array.from(timeBuf));
        await sleep(16); // ~60fps 수집
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
    const rms = Math.sqrt(sumSq / L); // 0~1 근사
    const zcr = zeros / L;            // 0~0.5 근사
    const silenceRatio = silence / L; // 0~1
    return { rms, zcr, silenceRatio, peak };
}

// --- B. 주파수영역 ---
function computeFreqDomainFeatures(freqUint8, sampleRate) {
    const N = freqUint8.length; // fftSize/2
    let sum = 0, weighted = 0;
    for (let i = 0; i < N; i++) { sum += freqUint8[i]; weighted += freqUint8[i] * i; }
    const centroidBin = sum ? (weighted / sum) : 0;

    // 상위 85% 롤오프 지점
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

    // 피치 안정도(창 분할 표준편차)
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

    // 온셋 근사: 프레임 간 에너지 급증 횟수
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

// 단순 ACF 피치 추정(단일 음정에 강함, 소음/화성은 약함)
function estimatePitchACF(buf, sampleRate) {
    const n = buf.length;
    if (!n) return 0;
    // DC 제거 & 정규화
    let mean = 0; for (let i = 0; i < n; i++) mean += buf[i]; mean /= n;
    const x = new Float32Array(n);
    let maxAbs = 0;
    for (let i = 0; i < n; i++) { x[i] = buf[i] - mean; maxAbs = Math.max(maxAbs, Math.abs(x[i])); }
    if (maxAbs > 0) for (let i = 0; i < n; i++) x[i] /= maxAbs;

    // 합리적 피치 범위: 70~800 Hz
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
    // 기본 ATK: RMS (0~1) → 10~70
    const baseATK = Math.round(10 + f.rms * 60);

    // 속성: 스펙트럼 중심(Hz) 기준
    const cen = f.spectralCentroidHz;
    let element = 'Earth';
    if (cen > 4000) element = 'Wind';
    else if (cen > 2000) element = 'Fire';
    else if (cen > 900) element = 'Water';

    // 피치 기반 스킬
    const p = f.pitchHz;
    let skill = 'Balanced Strike';
    if (p > 650) skill = 'Swift Flurry';   // 고음, 속공형
    else if (p > 200) skill = 'Tempo Slash';    // 중음, 밸런스
    else if (p > 60) skill = 'Bass Smash';     // 저음, 묵직
    else skill = 'Noise Burst';    // 무피치/잡음

    // 보정치
    const accuracy = Math.max(60, 95 - f.bandwidthHz / 50 - f.pitchStability / 5);
    const combo = Math.min(5, 1 + Math.floor(f.onsetDensity / 2));
    const critChance = Math.min(45, Math.round(f.zcr * 200));
    const silenceBoost = (f.silenceRatio > 0.6) ? -5 : 0;

    // 대미지
    let dmg = baseATK + silenceBoost;
    if (Math.random() * 100 < critChance) {
        dmg = Math.round(dmg * 1.5);
        skill += ' ★CRIT';
    }
    // 콤보는 75% 효율
    dmg = Math.round(dmg * (1 + (combo - 1) * 0.75 * 0.15));

    return { skill, element, dmg: Math.max(1, dmg), accuracy: Math.round(accuracy), combo };
}

// ====== 전투 적용 & UI ======
function applyAttack(who, result) {
    // 명중 판정
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
    if ($('btnAttack')) $('btnAttack').disabled = true;
    if ($('btnEnemy')) $('btnEnemy').disabled = true;
}

function renderFeatureSummary(f, r) {
    const tag = (t) => `<span class="tag">${t}</span>`;
    const tags = [
        tag(`A: RMS ${f.rms.toFixed(3)}`),
        tag(`A: ZCR ${f.zcr.toFixed(3)}`),
        tag(`A: Silence ${Math.round(f.silenceRatio * 100)}%`),
        tag(`B: Centroid ${Math.round(f.spectralCentroidHz)}Hz`),
        tag(`B: Bandwidth ${Math.round(f.bandwidthHz)}Hz`),
        tag(`C: Pitch ${Math.round(f.pitchHz)}Hz`),
        tag(`C: Onsets ${f.onsetDensity}`),
        tag(`C: Stability ${Math.round(f.pitchStability)}`)
    ];
    if ($('tags')) $('tags').innerHTML = tags.join(' ');

    if ($('stats')) $('stats').textContent =
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
