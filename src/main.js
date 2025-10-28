/* ================================
   app.js — PIXIE Prototype (Full)
   ================================ */

/* ---------- 페이즈/옵션 ---------- */
let AUTORESTORE = false; // 초기엔 자동복원 끔 (원하면 true)
function setPhase(phase) { document.body.dataset.phase = phase; } // intro | run

/* ---------- 전역 상태 ---------- */
const state = {
    ver: 1,
    floor: 1,
    fidelity: 0,
    gold: 0,
    runId: null,

    map: null,
    room: null,
    visited: new Set(),

    relics: {},
    equip: { weapon: null, armor: null, rune: null },
    inventory: { consum: [] },

    char: null,
    enemy: null,
    lootProfile: null,

    seeds: { floor: null, path: null, env: null },

    temp: {},

    turnLock: false, // 내/적 턴 진행 중 입력 잠금
    reviveUsed: false,
};

/* ---------- Intro Overlay 제어 ---------- */
function openIntro() {
    const el = document.getElementById('intro');
    if (!el) return;
    el.hidden = false;
    el.removeAttribute('aria-hidden');

    const skip = document.getElementById('skipIntro');
    if (skip) skip.onclick = closeIntro;

    // 자동 종료 (매 새로고침 재생 — localStorage 플래그 쓰지 않음)
    setTimeout(() => { closeIntro(); }, 4200);
}
function closeIntro() {
    const el = document.getElementById('intro');
    if (!el) return;
    el.setAttribute('aria-hidden', 'true');
    el.hidden = true;
}

/* ---------- 유틸 ---------- */
const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);
const SAVE_KEY = 'pixie_run_v1';
const REF_BASE_POWER = 220;

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

/* xorshift32 */
function makeRNG(seed) {
    let x = seed >>> 0 || 0x12345678;
    return () => {
        x ^= x << 13; x >>>= 0;
        x ^= x >>> 17; x >>>= 0;
        x ^= x << 5; x >>>= 0;
        return (x >>> 0) / 0xFFFFFFFF;
    };
}
/* ===== 엔딩 이미지 설정 & 프리로드 ===== */
const ENDING_ASSETS = {
    good: './assets/pixie_good.png',
    normal: './assets/pixie_normal.png',
    bad: './assets/pixie_bad.png',
};
function preloadImg(src) {
    return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
}
function computeEndingKey() {
    const relicScore = Object.values(state.relics || {}).reduce((a, b) => a + b, 0);
    const youPower = state.char?.powerInit || 0;
    if (relicScore >= 4 && youPower >= 240) return 'good';
    if (relicScore <= 1 && youPower < 200) return 'bad';
    return 'normal';
}
async function openEnding(endingKey = 'normal') {
    // 배경 이미지 먼저 프리로드
    const imgSrc = ENDING_ASSETS[endingKey] || ENDING_ASSETS.normal;
    try { await preloadImg(imgSrc); } catch { }

    // 전투/패널 닫기 & 상호작용 잠시 정지
    ['#mapOverlay', '#bagSheet', '#shopSheet', '#dialoguePanel', '#logSheet'].forEach(sel => {
        const el = document.querySelector(sel); if (el) el.setAttribute('hidden', '');
    });
    setPhase('intro');

    // 오버레이 컨테이너
    const wrap = document.createElement('div');
    wrap.id = 'endingOverlay';
    Object.assign(wrap.style, {
        position: 'fixed', inset: '0', zIndex: '3000', overflow: 'hidden'
    });

    // ★ 배경: PNG를 꽉 채워서 cover
    const bg = document.createElement('div');
    Object.assign(bg.style, {
        position: 'absolute', inset: '0',
        backgroundImage: `url("${imgSrc}")`,
        backgroundSize: 'cover', backgroundPosition: 'center center', backgroundRepeat: 'no-repeat',
        filter: 'saturate(1.05) contrast(1.02)'
    });

    // 어둡게 깔기(텍스트 가독성)
    const dim = document.createElement('div');
    Object.assign(dim.style, {
        position: 'absolute', inset: '0',
        background: 'linear-gradient(180deg, rgba(0,0,0,.35), rgba(0,0,0,.6))'
    });

    // 카드
    const card = document.createElement('div');
    Object.assign(card.style, {
        position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
        width: 'min(780px, 92vw)', padding: '22px 18px',
        borderRadius: '16px',
        background: 'rgba(10,12,20,.55)',
        border: '1px solid rgba(120,220,255,.35)',
        boxShadow: '0 0 24px rgba(120,220,255,.25), inset 0 0 24px rgba(120,220,255,.08)',
        color: '#dff7ff', textAlign: 'center', backdropFilter: 'blur(2px)'
    });

    const title = document.createElement('h2');
    title.textContent = `ENDING — ${endingKey.toUpperCase()}`;
    title.style.margin = '0 0 6px 0';

    const name = document.createElement('div');
    name.textContent = 'PIXIE';
    name.style.cssText = 'opacity:.85;font-size:12px;margin-top:2px;letter-spacing:.1em';

    const p1 = document.createElement('p');
    const p2 = document.createElement('p');
    p1.style.margin = '10px 0 6px 0'; p2.style.margin = '0 0 16px 0';

    if (endingKey === 'good') {
        p1.textContent = '“찾았어. 사실 난 네가 오랫동안 되찾고 싶어 하던 그 파일이야.”';
        p2.textContent = '“이제 함께 나가자. 내가 너의 곁에서 계속 반짝일게.”';
    } else if (endingKey === 'bad') {
        p1.textContent = '“조금 모자랐어… 하지만 실패도 네 이야기의 일부야.”';
        p2.textContent = '“다시 시작해보자.”';
    } else {
        // normal
        p1.textContent = '“여기까지 왔네. 완벽하진 않지만 충분히 아름다웠어.”';
        p2.textContent = '“지금 나갈 수도, 이 세계를 계속 탐험할 수도 있어.”';
    }

    const row = document.createElement('div');
    Object.assign(row.style, { display: 'flex', flexWrap: 'wrap', gap: '10px', justifyContent: 'center' });

    // 버튼 스타일
    const btnPrimary = (label, onClick) => {
        const b = document.createElement('button'); b.textContent = label;
        Object.assign(b.style, {
            padding: '10px 14px', borderRadius: '10px', border: '1px solid rgba(120,220,255,.5)',
            background: 'linear-gradient(180deg,#0df 0%,#08a 100%)', color: '#012', fontWeight: '700', cursor: 'pointer'
        });
        b.onclick = onClick; return b;
    };
    const btnGhost = (label, onClick) => {
        const b = document.createElement('button'); b.textContent = label;
        Object.assign(b.style, {
            padding: '10px 14px', borderRadius: '10px', border: '1px solid rgba(120,220,255,.35)',
            background: 'transparent', color: '#cde', cursor: 'pointer'
        });
        b.onclick = onClick; return b;
    };

    // 공통 동작
    function closeEnding() {
        document.getElementById('endingOverlay')?.remove();
    }
    function exitToIntro() {
        closeEnding();
        restartRun(true); // 저장 초기화 + 처음화면
    }

    if (endingKey === 'good') {
        // 나가기 중심
        row.append(
            btnPrimary('나가기', exitToIntro),
            btnGhost('PIXIE 로그', () => { document.querySelector('#logSheet')?.removeAttribute('hidden'); })
        );
    } else if (endingKey === 'bad') {
        // 다시 시작만
        row.append(
            btnPrimary('처음부터', exitToIntro),
            btnGhost('PIXIE 로그', () => { document.querySelector('#logSheet')?.removeAttribute('hidden'); })
        );
    } else {
        // normal: 선택지 — 엔드리스 / 나가기 / 로그
        const endlessBtn = btnPrimary('엔드리스로 계속', async () => {
            // 엔드리스 플래그 켜고, 다음 층 생성해서 진행
            state.endless = true;
            closeEnding();
            try {
                await buildNextFloor(state.seeds.path, state.seeds.env);
                // L5에서 더 안 오르도록 유지: fidelity는 고정, floor만 증가
                document.getElementById('floor').textContent = state.map?.id || `F${state.floor}-α`;
                log('엔드리스: 다음 층으로 이동');
                enterRoom(state.map.startNodeId);
                save();
            } catch (e) {
                log('엔드리스 전환 오류: ' + e?.message);
            }
        });

        row.append(
            endlessBtn,
            btnGhost('나가기', exitToIntro),
            btnGhost('PIXIE 로그', () => { document.querySelector('#logSheet')?.removeAttribute('hidden'); })
        );
    }

    card.append(title, name, p1, p2, row);
    wrap.append(bg, dim, card);
    document.body.append(wrap);
}

/* ---------- 브라우저 폴백 ---------- */
async function ensureImageBitmap(file) {
    if (window.createImageBitmap) {
        try { return await createImageBitmap(file); } catch { }
    }
    const img = new Image();
    img.decoding = 'async';
    img.src = URL.createObjectURL(file);
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    URL.revokeObjectURL(img.src);
    return (window.createImageBitmap ? await createImageBitmap(c) : c);
}
function makeCanvas(w, h) {
    try { return new OffscreenCanvas(w, h); }
    catch { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
}

/* ---------- 해시 / 저장 ---------- */
function fnv1aHex(buf) {
    let h = 0x811c9dc5 >>> 0;
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    for (let i = 0; i < u8.length; i++) {
        h ^= u8[i];
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    let s = '';
    for (let i = 0; i < 8; i++) {
        h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
        s += (h >>> 0).toString(16).padStart(8, '0');
    }
    return s.slice(0, 64);
}
async function safeHashHex(arrayBuffer) {
    try {
        if (crypto?.subtle?.digest) {
            const d = await crypto.subtle.digest('SHA-256', arrayBuffer);
            return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join('');
        }
        throw new Error('SubtleCrypto unavailable');
    } catch {
        return fnv1aHex(arrayBuffer);
    }
}
function save() {
    const data = { ...state, visited: [...state.visited] };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
}
function load() {
    const raw = localStorage.getItem(SAVE_KEY); if (!raw) return false;
    try {
        const d = JSON.parse(raw);
        Object.assign(state, d, { visited: new Set(d.visited) });
        return true;
    } catch { return false; }
}

/* ---------- 이미지 분석 & 스탯 ---------- */
function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = d === 0 ? 0 : max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = Math.round((h * 60 + 360) % 360);
    const s = max === 0 ? 0 : d / max;
    const v = max;
    return [h, s, v];
}
async function analyzeImage(file) {
    const ab = await file.arrayBuffer();
    const hash = await safeHashHex(ab);

    const bmp = await ensureImageBitmap(file);
    const { width, height } = bmp;
    const canvas = makeCanvas(64, 64); const ctx = canvas.getContext('2d');
    const scale = Math.max(width, height) / 64;
    const sw = Math.max(1, Math.round(width / scale)), sh = Math.max(1, Math.round(height / scale));
    canvas.width = sw; canvas.height = sh; ctx.drawImage(bmp, 0, 0, sw, sh);

    const data = ctx.getImageData(0, 0, sw, sh).data;
    let r = 0, g = 0, b = 0, n = sw * sh;
    for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2]; }
    r /= n; g /= n; b /= n;
    const [h, s, v] = rgbToHsv(r, g, b);

    let sum = 0, v255 = v * 255;
    for (let i = 0; i < data.length; i += 4) {
        const vv = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
        sum += (vv - v255) ** 2;
    }
    const contrastStd = Math.sqrt(sum / n) / 255;

    return {
        name: file.name, size: file.size, type: file.type, lastModified: file.lastModified,
        width, height, aspect: width / height, maxSide: Math.max(width, height), minSide: Math.min(width, height),
        hsvAvg: { h, s, v }, contrastStd, avgRGB: { r, g, b }, hash
    };
}
function metaToStats(meta) {
    const sizeKB = meta.size / 1024;
    const nameLen = (meta.name || '').length;
    const atkImg = meta.maxSide / 90 + meta.contrastStd * 25;

    const HP = clamp(Math.round(50 + sizeKB / 30 + meta.minSide / 100), 40, 240);
    const ATK = clamp(Math.round(5 + nameLen * 1.5 + atkImg), 5, 130);
    const DEF = 5 + (meta.type.includes('png') ? 3 : meta.type.includes('webp') ? 3 : meta.type.includes('heic') ? 2 : 1);
    const SPD = 10 + (Math.abs(meta.aspect - 1) > 0.6 ? 2 : 0)
        + ((meta.hsvAvg.h > 200 && meta.hsvAvg.h < 260) ? 2
            : (meta.hsvAvg.h < 40 || meta.hsvAvg.h > 330) ? 1 : 0);

    const seed = parseInt(meta.hash.slice(0, 8), 16) >>> 0;
    const rng = makeRNG(seed);
    const CRIT = Math.min(22, Math.round(rng() * 8 + meta.hsvAvg.s * 6 + (meta.lastModified ? 2 : 0)));
    const skills = ['Heavy Strike', 'Echo Barrage', 'Fragment Surge'];
    const skill = skills[Math.floor(rng() * skills.length)];
    return { HP, ATK, DEF, SPD, CRIT, skill };
}

/* ================================
   PIXIE Log (from scratch)
   ================================ */

const PIXIE_BUF = []; // { text, tone, badge, time }

function escapeHTML(s = '') {
    return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function pickTone(s) {
    if (/오류|ERROR|탈락|경고|DEF -|에러|실패/.test(s)) return 'err';
    if (/격파|보상|유물|회복|골드|\+|획득|성공/.test(s)) return 'event';
    if (/상점|지도|경로|다음|이동|접근|열림|닫힘|진행/.test(s)) return 'warn';
    return 'event';
}
function renderPixieLog() {
    const host = document.getElementById('log');
    if (!host) return;
    host.innerHTML = PIXIE_BUF.map(m => `
    <div class="pixie-msg">
      <div class="pixie-ava">✨</div>
      <div class="pixie-bubble">
        <span class="meta">[${m.time}]</span>
        <span class="${m.tone}">${escapeHTML(m.text)}</span>
      </div>
    </div>
  `).join('');
}
function pixieSay(text, { tone = 'event', badge = 'PIXIE' } = {}) {
    const now = new Date();
    const time = now.toTimeString().slice(0, 5); // HH:MM
    PIXIE_BUF.push({ text, tone, badge, time });
    if (PIXIE_BUF.length > 200) PIXIE_BUF.shift();
    renderPixieLog();
}
/* 게임 코드 별칭 */
function log(t) {
    const decorated = String(t)
        .replace(/^격파:/, '🌸 격파:')
        .replace(/^피격:/, '💢 피격:')
        .replace(/^공격:/, '⚡ 공격:')
        .replace(/^함정/, '🪤 함정')
        .replace(/^상점/, '🛒 상점')
        .replace(/^유물/, '🔹 유물')
        .replace(/^탈락:/, '💀 탈락:')
        .replace(/^오류/, '⚠️ 오류');

    const line = decorated
        .replace('골드가 부족해', '골드가 모자라! 다음에 다시 와줘!')
        .replace('다음 층으로 이동', '다음 층 포트로 슝—!')
        .replace('이벤트 없음', '여긴 이미 정리했어. 스킵!');

    pixieSay(line, { tone: pickTone(line) });
}
window.onerror = (msg, src, line, col) => {
    pixieSay(`앗! 에러 감지… <${String(msg)}> @${line}:${col}`, { tone: 'err' });
};
window.addEventListener('DOMContentLoaded', () => {
    renderPixieLog();
    const dock = document.getElementById('logDock');
    if (dock) dock.addEventListener('click', () => {
        const sheet = document.getElementById('logSheet');
        const willOpen = sheet?.hasAttribute('hidden');
        if (willOpen) {
            sheet.hidden = false; sheet.removeAttribute('aria-hidden');
            dock.setAttribute('aria-expanded', 'true');
        } else {
            sheet.setAttribute('hidden', ''); sheet.setAttribute('aria-hidden', 'true');
            dock.setAttribute('aria-expanded', 'false');
        }
    });
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.close[data-close="#logSheet"]');
        if (!btn) return;
        const sheet = document.getElementById('logSheet');
        sheet.setAttribute('hidden', ''); sheet.setAttribute('aria-hidden', 'true');
        const dock = document.getElementById('logDock');
        if (dock) dock.setAttribute('aria-expanded', 'false');
    });
});

/* ===== 캐릭터 파워 지표 ===== */
function calcCharPower(stats) {
    const base = stats.HP * 0.22 + stats.ATK * 2.0 + stats.DEF * 1.2 + stats.SPD * 1.0;
    const critB = stats.CRIT * 1.5;
    return Math.round(base + critB);
}

/* ===== 유효 스탯 (장비/룬/함정 반영) & HP 상한 ===== */
function getYouStats() {
    if (!state.char) return { ATK: 0, DEF: 0, CRIT: 0, HPmax: 0, runeEcho: 0 };
    const base = state.char.stats;
    const wep = state.equip.weapon?.mods || {};
    const arm = state.equip.armor?.mods || {};
    const rune = state.equip.rune?.mods || {};

    const ATK = base.ATK + Math.round(base.ATK * (wep.atkPct || 0) / 100);
    const DEF = base.DEF + (arm.def || 0) - (state.char.trapDEF || 0);
    const CRIT = base.CRIT + (wep.crit || 0);
    const HPmax = base.HP + (arm.hp || 0);

    return { ATK, DEF, CRIT, HPmax, runeEcho: (rune.echo || 0) };
}
function clampYouHP() {
    const eff = getYouStats();
    if (!state.char) return;
    state.char.hp = clamp(state.char.hp, 0, eff.HPmax);
}

/* ---------- 절차 스프라이트 ---------- */
function svgDataURL({ w = 160, h = 160, hue = 200, role = 'enemy' } = {}) {
    const bg = `hsl(${hue},60%,${role === 'enemy' ? 18 : 28}%)`;
    const fg = `hsl(${(hue + 40) % 360},70%,60%)`;
    const accent = `hsl(${(hue + 300) % 360},80%,70%)`;
    const grid = role === 'enemy'
        ? `<rect x="12" y="12" width="${w - 24}" height="${h - 24}" rx="10" ry="10" fill="none" stroke="${fg}" stroke-dasharray="6 4" opacity=".35"/>`
        : `<circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 3}" fill="none" stroke="${accent}" stroke-width="2" opacity=".55"/>`;
    const geo = role === 'enemy'
        ? `<polygon points="${w * 0.2},${h * 0.7} ${w * 0.5},${h * 0.2} ${w * 0.8},${h * 0.7}" fill="${fg}" opacity=".75"/>`
        : `<rect x="${w * 0.3}" y="${h * 0.3}" width="${w * 0.4}" height="${h * 0.4}" fill="${fg}" opacity=".75"/>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="100%" height="100%" fill="${bg}"/>${grid}${geo}
    <line x1="${w * 0.15}" y1="${h * 0.85}" x2="${w * 0.85}" y2="${h * 0.85}" stroke="${accent}" stroke-width="3" opacity=".5"/>
  </svg>`;
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

/* ---------- 장비 ---------- */
const Tier = {
    T1: { mult: 1.00, min: { weapon: { atkPct: 4 }, armor: { def: 1, hp: 10 }, rune: {} }, baseSell: 15, range: 5 },
    T2: { mult: 1.25, min: { weapon: { atkPct: 7 }, armor: { def: 2, hp: 16 }, rune: {} }, baseSell: 30, range: 10 },
    T3: { mult: 1.55, min: { weapon: { atkPct: 10 }, armor: { def: 3, hp: 24 }, rune: {} }, baseSell: 60, range: 25 },
    T4: { mult: 1.85, min: { weapon: { atkPct: 13 }, armor: { def: 4, hp: 36 }, rune: {} }, baseSell: 120, range: 40 },
    T5: { mult: 2.20, min: { weapon: { atkPct: 16 }, armor: { def: 5, hp: 52 }, rune: {} }, baseSell: 250, range: 60 },
};
function rollTier(source, floor, r) {
    const p = r();
    if (source === 'boss') return p < 0.10 ? 'T5' : p < 0.50 ? 'T4' : 'T3';
    if (source === 'reward') return p < 0.05 ? 'T4' : p < 0.25 ? 'T3' : p < 0.65 ? 'T2' : 'T1';
    return p < 0.10 ? 'T3' : p < 0.40 ? 'T2' : 'T1';
}
function makeEquipmentFromImage(meta, slot, source, floor) {
    const tierKey = rollTier(source, floor, state.char.rng);
    const t = Tier[tierKey];
    const imgCoef = {
        weapon: { atkPct: Math.round((meta.maxSide / 800 + meta.contrastStd * 0.4) * 100) / 1 },
        armor: { def: Math.round(1 + (meta.type.includes('png') ? 2 : 1)), hp: Math.round(10 + meta.minSide / 40) },
        rune: { echo: meta.hsvAvg.s > 0.5 ? 0.12 : 0.06 }
    }[slot];
    const final = JSON.parse(JSON.stringify(imgCoef));
    if (slot === 'weapon') {
        const val = Math.max(t.min.weapon.atkPct, Math.round(imgCoef.atkPct * t.mult));
        final.atkPct = val;
        final.crit = Math.max(0, Math.round(meta.hsvAvg.s * 6 + (tierKey !== 'T1' ? 3 : 0)));
    } else if (slot === 'armor') {
        final.def = Math.max(t.min.armor.def, Math.round(imgCoef.def * t.mult));
        final.hp = Math.max(t.min.armor.hp, Math.round(imgCoef.hp * t.mult));
    } else if (slot === 'rune') {
        final.echo = Math.round(imgCoef.echo * t.mult * 100) / 100;
    }
    return {
        id: `EQ_${slot}_${meta.hash.slice(0, 6)}`,
        slot, tier: tierKey, mods: final, from: source,
        sell: t.baseSell + Math.floor(state.floor * 1) + Math.floor(state.char.rng() * t.range)
    };
}
function renderEquipUI() {
    const { weapon, armor, rune } = state.equip;
    const badge = (t) => t ? `<span class="tier-badge tier-${t}">${t}</span>` : '';
    const host = $('#equipSlots'); if (!host) return;
    host.innerHTML = `
    <div class="card">무기: ${weapon ? `${badge(weapon.tier)} ATK+${weapon.mods.atkPct}% CRIT+${weapon.mods.crit || 0}%` : '없음'}</div>
    <div class="card">방어: ${armor ? `${badge(armor.tier)}  DEF+${armor.mods.def}   HP+${armor.mods.hp}` : '없음'}</div>
    <div class="card">룬:   ${rune ? `${badge(rune.tier)}   Echo+${rune.mods.echo}` : '없음'}</div>`;
}
function equipAndAutoDisassemble(eq) {
    const prev = state.equip[eq.slot];
    if (prev) { state.gold += prev.sell; log(`[장비] ${eq.slot} 교체: 이전 ${prev.tier} 분해 (+${prev.sell}G)`); }
    state.equip[eq.slot] = eq;
    updateGoldUI(); renderEquipUI();
    clampYouHP(); updateHPBars(); // 장비 교체 시 HP 상한 동기화
    save();
}
function updateGoldUI() { const g = $('#gold'); if (g) g.textContent = `${state.gold}G`; }

/* ---------- 유물 ---------- */
const Relics = {
    R_HINT_A: { name: '미약한 통로의 인장', tier: 'T1', effect: { type: 'candidate', count: k => 1 + Math.floor(k / 3), prob: k => 1 - Math.pow(1 - 0.35, Math.pow(k, 0.85)) } },
    R_HINT_B: { name: '길찾는 잔광', tier: 'T2', effect: { type: 'depth', depth: k => Math.min(1 + Math.floor(k / 2), 3), bonus: +0.10 } },
    R_HINT_C: { name: '출구 음영 투시', tier: 'T3', effect: { type: 'reveal', prob: k => 1 - Math.pow(1 - 0.22, Math.pow(k, 0.8)) } },
    R_HINT_D: { name: '아키브 키스톤', tier: 'T4', effect: { type: 'shorten', rate: k => 1 - Math.pow(0.85, k) } },
    R_HINT_E: { name: '지도 제작자의 도장', tier: 'UQ', effect: { type: 'structure', weight: k => Math.floor(k / 2) } },
};
function addRelic(id, k = 1) { state.relics[id] = (state.relics[id] || 0) + k; log(`[유물] ${Relics[id].name} 스택 ${state.relics[id]}`); renderRelicsUI(); save(); }
function renderRelicsUI() {
    const el = $('#relics'); if (!el) return;
    const html = Object.entries(state.relics).map(([id, k]) => {
        const R = Relics[id]; const tier = R?.tier || 'T1';
        return `<div class="card"><span class="tier-badge tier-${tier}">${tier}</span> ${R.name} ×${k}</div>`;
    }).join('');
    el.innerHTML = html || '<div class="card">없음</div>';
}

/* ---------- 맵 ---------- */
async function buildTutorialFloor(seedHex) {
    state.map = {
        id: 'TUT',
        nodes: [
            { id: 'n0', type: 'battle', name: '반향 오염 폴더' },
            { id: 'n1', type: 'event', name: '파편 아카이브' },
            { id: 'n2', type: 'reward', name: '백업 캐시 금고' },
            { id: 'n3', type: 'trap', name: '오류 틈' },
            { id: 'n4', type: 'shop', name: '패치 키오스크' },
            { id: 'n5', type: 'boss', name: '수문자 프로세스' },
            { id: 'n6', type: 'exit', name: '출구 포트' },
        ],
        edges: [['n0', 'n1'], ['n1', 'n2'], ['n2', 'n3'], ['n3', 'n4'], ['n4', 'n5'], ['n5', 'n6']],
        startNodeId: 'n0'
    };
    state.seeds.floor = seedHex;
}
async function buildNextFloor(pathHash, envHash) {
    const r = makeRNG(parseInt(pathHash.slice(0, 8), 16) ^ parseInt(envHash.slice(0, 8), 16));
    const LAYERS = 5 + Math.floor(r() * 2);    // 5~6
    const FANOUT_MIN = 2, FANOUT_MAX = 3;
    const typesPool = ['battle', 'battle', 'reward', 'trap', 'shop', 'event'];

    const nodes = [];
    const edges = [];
    const idOf = (layer, idx) => `n${layer}_${idx}`;

    for (let layer = 0; layer < LAYERS; layer++) {
        const fanout = (layer === 0 || layer === LAYERS - 1) ? 1 : (FANOUT_MIN + Math.floor(r() * (FANOUT_MAX - FANOUT_MIN + 1)));
        for (let i = 0; i < fanout; i++) {
            let type = 'battle';
            if (layer === 0) type = 'battle';
            else if (layer === LAYERS - 2) type = 'boss';
            else if (layer === LAYERS - 1) type = 'exit';
            else type = typesPool[Math.floor(r() * typesPool.length)];
            nodes.push({ id: idOf(layer, i), layer, type, name: nameOf(type) });
        }
    }
    for (let layer = 0; layer < LAYERS - 1; layer++) {
        const cur = nodes.filter(n => n.layer === layer);
        const nxt = nodes.filter(n => n.layer === layer + 1);
        for (const c of cur) {
            const picks = new Set();
            picks.add(nxt[Math.floor(r() * nxt.length)].id);
            if (r() < 0.5 && nxt.length > 1) picks.add(nxt[Math.floor(r() * nxt.length)].id);
            for (const pid of picks) edges.push([c.id, pid]);
        }
    }
    state.map = { id: 'F' + (state.floor + 1), nodes, edges, startNodeId: idOf(0, 0) };
}
function nameOf(type) {
    return {
        battle: '반향 오염 폴더', reward: '백업 캐시 금고', trap: '오류 틈', shop: '패치 키오스크',
        event: '파편 아카이브', boss: '수문자 프로세스', exit: '출구 포트'
    }[type] || '폴더';
}
function roomDesc(type) {
    switch (type) {
        case 'battle': return '이 폴더에는 잔향체라는 이물질이 끼어 있어. 지나가려면 정리해야 해.';
        case 'reward': return '오래된 캐시 조각이 얼어붙어 있어. 복원하면 쓸 만한 것이 나온다.';
        case 'trap': return '여긴 메모리가 찢어진 자리야. 스쳐도 데이터가 샌다.';
        case 'shop': return '임시 패치 서버가 열려 있어. 골드로 옵션을 적용하자.';
        case 'event': return '로그의 빈칸이 남아 있어. 조각이 맞으면 문장이 완성돼.';
        case 'boss': return '이 트리의 관리자 데몬이 지키고 있어. 접근 권한을 빼앗아야 해.';
        case 'exit': return '다음 층으로 이어지는 포트가 숨어 있어. 시그니처를 맞추면 열린다.';
        default: return '';
    }
}
function enterRoom(nodeId) {
    state.room = state.map.nodes.find(n => n.id === nodeId);
    $('#roomName').textContent = state.room.name;
    $('#roomDesc').textContent = roomDesc(state.room.type);
    $('#battleStage').hidden = state.room.type !== 'battle' && state.room.type !== 'boss';
    $('#attackBtn').disabled = (state.room.type !== 'battle' && state.room.type !== 'boss');

    const key = `${state.map.id}:${nodeId}`;
    const first = !state.visited.has(key);

    if (first) {
        state.visited.add(key);
        if (state.room.type === 'battle' || state.room.type === 'boss') {
            spawnEnemy(state.room.type === 'boss');
        } else if (state.room.type === 'reward') {
            openReward();
        } else if (state.room.type === 'trap') {
            applyTrap();
        } else if (state.room.type === 'shop') {
            openShop();
        } else if (state.room.type === 'event') {
            openEvent();
        } else if (state.room.type === 'exit') {
            openExit();
        }
        const t = state.room.type;
        if (t === 'battle') storyAt('room_bat_' + nodeId, '잔향체 냄새가 나… 먼저 정리하자.');
        if (t === 'event') storyAt('room_evt_' + nodeId, '파편 아카이브다! 조건에 맞는 기억이면 로그를 되살릴 수 있어 ପ(˶•-•˶)ଓ ♡');
        if (t === 'reward') storyAt('room_rwd_' + nodeId, '백업 캐시 금고 발견( σ̴̶̷̤ .̫ σ̴̶̷̤ ) 적합한 추억으로 장비를 강화할 수 있어!');
        if (t === 'trap') storyAt('room_trp_' + nodeId, '조심해. 이 구간 메모리가 찢어져 있어.', { theme: 'pink' });
        if (t === 'shop') storyAt('room_shp_' + nodeId, '패치 키오스크 온라인. 장비/회복/룬을 준비해.');
        if (t === 'boss') storyAt('room_bos_' + nodeId, '조심해!! 관리자 데몬이야!!');
        if (t === 'exit') storyAt('room_ext_' + nodeId, '포트가 보여. 시드 두 개가 필요해.');
    } else {
        log(`소거된 잔향: ${state.room.name} (이벤트 없음)`);
    }
    save();
}

/* ---- 그래프 유틸 & 오버레이 ---- */
function neighbors(nodeId) {
    return state.map.edges
        .filter(([a, b]) => a === nodeId || b === nodeId)
        .map(([a, b]) => a === nodeId ? b : a);
}
function isVisited(mapId, nodeId) { return state.visited.has(`${mapId}:${nodeId}`); }
function renderMapOverlay() {
    if (!state.map) return;
    const bc = $('#breadcrumb');
    const cur = state.room?.id || state.map.startNodeId;
    const curNode = state.map.nodes.find(n => n.id === cur);
    if (bc) bc.textContent = `${state.map.id} / ${curNode?.name || '폴더'}`;

    const list = document.createElement('ul');
    list.className = 'maplist';

    const curLi = document.createElement('li');
    curLi.className = 'current';
    curLi.innerHTML = `<span class="label">📂 ${curNode?.name || '폴더'}</span>
                     <span class="type">${curNode?.type || ''}</span>`;
    list.appendChild(curLi);

    const neigh = neighbors(cur);
    if (!neigh.length) {
        const li = document.createElement('li');
        li.className = 'locked';
        li.innerHTML = `<span class="label">다음 경로 없음</span>`;
        list.appendChild(li);
    } else {
        neigh.forEach(id => {
            const node = state.map.nodes.find(n => n.id === id);
            const visited = isVisited(state.map.id, id);
            const li = document.createElement('li');
            li.dataset.node = id;
            li.className = visited ? 'visited' : '';
            li.innerHTML = `
        <span class="label">📁 ${node.name}</span>
        <span class="type">${node.type}</span>
        ${visited ? '<span class="chip muted">visited</span>' : '<span class="chip">new</span>'}
      `;
            list.appendChild(li);
        });
    }

    const host = $('#mapGraph'); if (!host) return;
    host.innerHTML = '';
    host.appendChild(list);
}
$('#mapGraph').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-node]');
    if (!li) return;
    const id = li.dataset.node;
    if (li.classList.contains('locked')) { log('이 경로는 아직 닿을 수 없어.'); return; }
    if (id === state.room?.id) { $('#mapOverlay').hidden = true; return; }
    $('#mapOverlay').hidden = true;
    enterRoom(id);
});
$('#mapDock')?.addEventListener('click', () => { renderMapOverlay(); $('#mapOverlay').hidden = false; });

function advanceFlow(delay = 0) {
    setTimeout(() => {
        renderMapOverlay();
        const ov = document.querySelector('#mapOverlay');
        if (ov) ov.hidden = false;
        log('다음 폴더를 선택해줘.');
    }, delay);
}
/* ===== 데미지 감쇠 커브(ATK 변화 민감도 완화) ===== */
// 결과 범위 예시: 6 ~ 24 사이(상수로 튜닝 가능)
function softDamageAgainst(ATK, DEF) {
    // 튜닝 상수
    const BASE = 8;          // 최소 기반 피해
    const SPAN = 20;         // 추가로 벌어질 수 있는 범위 (BASE+SPAN=상한)
    const K_ATK = 0.90;      // ATK 효과 완화
    const C_DEF = 1.20;      // DEF 효율(높을수록 방어가 잘 먹힘)
    const BIAS = 22;         // 분모 바이어스(초저스탯 폭주 방지)

    const num = ATK * K_ATK;
    const den = (ATK * K_ATK) + (DEF * C_DEF) + BIAS;
    const ratio = den > 0 ? num / den : 0;       // 0~1
    const dmg = BASE + SPAN * ratio;             // BASE ~ BASE+SPAN
    return Math.max(1, Math.round(dmg));
}

/* ---------- 전투 ---------- */
function setSpritesForBattle() {
    const youHue = (state.char?.meta?.hsvAvg.h ?? 210);
    const enHue = (youHue + 140) % 360;
    $('#youSprite').src = svgDataURL({ hue: youHue, role: 'you' });
    $('#enemySprite').src = svgDataURL({ hue: enHue, role: 'enemy' });
}
function calcEnemyStats(isBoss = false) {
    const base = isBoss
        ? { HP: 170, ATK: 30, DEF: 15, SPD: 7 }
        : { HP: 110, ATK: 12, DEF: 9, SPD: 6 };

    const floorMul = 1 + 0.16 * Math.floor(state.floor / 5);

    const ref = state.char?.powerRef || REF_BASE_POWER;
    const cur = state.char?.powerInit || ref;
    const ratio = clamp(cur / ref, 0.70, 1.40);
    const alpha = isBoss ? 0.80 : 0.60;
    const scale = floorMul * (1 + alpha * (ratio - 1));

    const hpMul = scale * 1.10;
    const offMul = scale * 1.00;
    const defMul = scale * 0.95;
    const spdMul = scale * 1.00;

    return {
        HP: Math.max(1, Math.round(base.HP * hpMul)),
        ATK: Math.max(1, Math.round(base.ATK * offMul)),
        DEF: Math.max(0, Math.round(base.DEF * defMul)),
        SPD: Math.max(1, Math.round(base.SPD * spdMul)),
    };
}
function spawnEnemy(isBoss = false) {
    const stats = calcEnemyStats(isBoss);
    state.enemy = {
        name: isBoss ? '수문자 프로세스' : '잔향체',
        stats, hp: stats.HP,
        chips: isBoss ? ['과열', '보호막'] : ['과열']
    };
    setSpritesForBattle();
    renderBattleUI();
    log(`적 등장: ${state.enemy.name} HP ${state.enemy.hp} (scaled)`);
    if (state.char?.trapDEF > 0) log(`함정 경고: DEF -${state.char.trapDEF} (피격 시 1스택 소모)`);
}
function renderBattleUI() {
    $('#battleStage').hidden = false;
    updateHPBars();
    $('#enemyChips').innerHTML = state.enemy.chips.map(c => `<span class="chip">${c}</span>`).join('');
    state.turnLock = false;
    $('#attackBtn').disabled = false;
}
function updateHPBars() {
    if (!state.char) return;
    const eff = getYouStats();
    const you = state.char, en = state.enemy;

    const youPct = Math.max(0, you.hp / eff.HPmax) * 100;
    $('#hpYou').style.width = `${youPct}%`;
    $('#hpYouTxt').textContent = `HP ${you.hp}/${eff.HPmax}`;

    if (en) {
        const enPct = Math.max(0, en.hp / en.stats.HP) * 100;
        $('#hpEnemy').style.width = `${enPct}%`;
        $('#hpEnemyTxt').textContent = `HP ${en.hp}/${en.stats.HP}`;
    } else {
        $('#hpEnemy').style.width = `0%`;
        $('#hpEnemyTxt').textContent = `HP 0/0`;
    }
}
$('#attackBtn').addEventListener('click', () => {
    if (!state.enemy || state.turnLock) return;
    state.turnLock = true;
    $('#attackBtn').disabled = true;

    const eff = getYouStats();
    const you = state.char, en = state.enemy;
    const r = you.rng;

    // ✅ 감쇠 커브로 기본 피해 산출(변화폭 완화)
    const basePerHit = softDamageAgainst(eff.ATK, en.stats.DEF);

    // ✅ 크리티컬 효율도 완만하게(기존 1.7 → 1.25)
    const isCrit = (r() * 100) < eff.CRIT;
    const critMul = isCrit ? 1.25 : 1.0;

    // ✅ 스킬 영향 축소
    let skillMul = 1.0, hits = 1;
    switch (you.stats.skill) {
        case 'Heavy Strike': {
            // 1.05 ~ 1.20 (기존보다 좁고 낮음)
            skillMul = 1.05 + r() * 0.15;
            break;
        }
        case 'Echo Barrage': {
            // 다타 경감: 2~3타 고정, 각 타 데미지는 동일
            hits = 2 + Math.floor(r() * 2); // 2~3
            break;
        }
        case 'Fragment Surge': {
            // SPD 기여 축소(기존 SPD/200 → SPD/500, 상한 1.15)
            const surge = 1 + Math.min(you.stats.SPD / 500, 0.15);
            skillMul = surge;
            break;
        }
    }

    // ✅ 데미지 분산폭 축소(±7% → 변동 적게)
    const vary = n => {
        const v = 0.07 * (r() * 2 - 1); // -7% ~ +7%
        return Math.round(n * (1 + v));
    };

    // 합산
    let total = 0;
    for (let i = 0; i < hits; i++) {
        const per = vary(Math.round(basePerHit * skillMul * critMul));
        total += Math.max(1, per);
    }

    // ✅ 룬 잔향도 살짝 너프(50% → 35% 추가)
    if (eff.runeEcho > 0 && r() < eff.runeEcho) {
        const echo = Math.max(1, Math.round(total * 0.35));
        total += echo;
        log(`룬의 잔향! 추가 피해 ${echo}`);
    }

    en.hp = Math.max(0, en.hp - total);
    floatDmg(total, '#dmgFloats', false, isCrit);
    log(`공격: ${you.stats.skill}${hits > 1 ? ` ×${hits}` : ''} → ${total} 피해 ${isCrit ? '(치명)' : ''}`);
    updateHPBars();

    if (en.hp <= 0) {
        onEnemyDown();
        state.turnLock = false;
        $('#attackBtn').disabled = true;
    } else {
        log('적의 차례…');
        setTimeout(enemyAttack, 500);
    }
});

function enemyAttack() {
    const eff = getYouStats();
    const you = state.char, en = state.enemy;
    const r = you.rng;

    const dmg = Math.max(1, Math.round(en.stats.ATK - eff.DEF * 0.25));
    const final = Math.round(dmg * (0.9 + r() * 0.2)); // ±10%

    you.hp = Math.max(0, you.hp - final);
    floatDmg(final, '#dmgFloats', true, false);
    if (state.char.trapDEF) {
        log('함정 발동: 이번 공격에 DEF -1 적용');
        state.char.trapDEF--;
        if (state.char.trapDEF <= 0) log('함정 효과 소거: DEF 페널티 해제');
    }
    log(`피격: ${final} 피해`);
    updateHPBars();

    if (you.hp <= 0) {
        onPlayerDown();
        state.turnLock = false;
        $('#attackBtn').disabled = true;
    } else {
        state.turnLock = false;
        $('#attackBtn').disabled = false;
    }
}
function onEnemyDown() {
    log(`격파: ${state.enemy.name}`);
    $('#attackBtn').disabled = true;
    const g = 8 + Math.floor(state.char.rng() * 7);
    state.gold += g; updateGoldUI();
    if (state.room.type === 'boss') addRelic('R_HINT_A');
    state.enemy = null; save();
    advanceFlow(650);
}
function onPlayerDown() {
    // ★ 1회 한정 픽시 부활
    if (!state.reviveUsed) {
        state.reviveUsed = true;

        // 부활 HP: 최대체력의 40% (최소 1)
        const eff = getYouStats();
        const reviveHP = Math.max(1, Math.floor(eff.HPmax * 0.4));
        state.char.hp = reviveHP;

        // 혹시 남아있을 페널티/잠금 완화
        state.char.trapDEF = 0;          // 함정 페널티 해제
        state.turnLock = false;
        $('#attackBtn').disabled = false;

        updateHPBars();

        // 픽시 스토리 버블 (분리된 story-bubble.js 사용)
        if (window.story) {
            window.story('이번 한 번은 나의 힘으로 너의 소중한 파일을 지켜줄게!', {
                icon: '✨', duration: 2600, pos: 'center'
            });
        }
        log('부활: PIXIE 보호 발동 (HP 40% 회복)');

        // 전투 계속 진행 (턴은 플레이어에게)
        return;
    }

    // ★ 두 번째 사망: 재시작 안내
    log('탈락: 탐사자 다운');
    if (window.story) {
        window.story('미안… 이번에는 지키지 못했어.', { icon: '😔', duration: 1800, pos: 'center' });
    }

    // 입력 막고 버튼도 비활성화
    state.turnLock = true;
    $('#attackBtn').disabled = true;

    // 재시작 버튼 표시
    setTimeout(showRestartPrompt, 600);
}

function floatDmg(n, sel, toYou = false, crit = false) {
    const host = $(sel); if (!host) return;
    const s = document.createElement('div');
    s.className = 'float';
    s.textContent = (toYou ? '-' : '') + n;
    s.style.position = 'absolute';
    s.style.left = toYou ? '20%' : '70%';
    s.style.top = toYou ? '65%' : '25%';
    s.style.fontWeight = crit ? '800' : '600';
    s.style.transform = 'translateY(0)';
    s.style.transition = 'transform .6s, opacity .6s';
    host.appendChild(s);
    requestAnimationFrame(() => { s.style.transform = 'translateY(-30px)'; s.style.opacity = '.1'; });
    setTimeout(() => s.remove(), 700);
}

/* =========================
   Memory Wish Puzzle System
   ========================= */
const WishCheck = {
    huge(meta) { const sizeKB = meta.size / 1024; return sizeKB >= 800 || meta.maxSide >= 2000; },
    passionate(meta) { const { h, s, v } = meta.hsvAvg; return (h >= 345 || h <= 20) && s >= 0.25 && v >= 0.25; },
    sad(meta) { const { h, s } = meta.hsvAvg; return h >= 200 && h <= 260 && s >= 0.18; },
    squareish(meta) { return Math.abs(meta.aspect - 1) <= 0.1; },
    noisy(meta) { return meta.contrastStd >= 0.18; }
};
const WishLabel = { huge: '아주 큰', passionate: '정열적인', sad: '슬픈', squareish: '정제된', noisy: '거친' };
function buildMemoryWish(rng) {
    const pool = ['huge', 'passionate', 'sad', 'squareish', 'noisy'];
    const first = pool[Math.floor(rng() * pool.length)];
    const two = rng() < 0.45;
    let second = null;
    if (two) {
        const rest = pool.filter(k => k !== first);
        second = rest[Math.floor(rng() * rest.length)];
    }
    const keys = second ? [first, second] : [first];
    const sentence = keys.map(k => WishLabel[k]).join(' 그리고 ') + ' 추억';
    return { keys, sentence };
}
function checkMemoryWish(meta, wish) {
    const results = wish.keys.map(k => ({ key: k, ok: !!WishCheck[k](meta) }));
    const passCount = results.filter(r => r.ok).length;
    const ok = passCount === wish.keys.length;
    const gold = ok ? (wish.keys.length === 2 ? 24 : 14) : 6;
    const heal = ok ? (wish.keys.length === 2 ? 18 : 10) : 0;
    return { ok, results, gold, heal };
}

/* ---------- 방 이벤트 ---------- */
function openReward() {
    storyAt('vault_hint_' + state.map.id, '캐시 금고: 업로드한 추억으로 <b>능력치가 계산</b>돼. 장비 교체 시 이전 장비는 분해돼 골드로 돌아와.');
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*'; input.style.display = 'none';
    document.body.appendChild(input);

    const done = (msg = null) => {
        if (msg) log(msg);
        input.remove();
        advanceFlow(450);
    };

    input.onchange = async e => {
        const f = e.target.files?.[0];
        if (!f) return done('금고 취소… 다음 경로를 골라줘!');
        try {
            const meta = await analyzeImage(f);
            const slot = ['weapon', 'armor', 'rune'][Math.floor(state.char.rng() * 3)];
            const eq = makeEquipmentFromImage(meta, slot, 'reward', state.floor);
            const msg = `${eq.tier} ${slot} 장착 시 이전 장비는 자동 분해(+${eq.sell}G).\n진행할까요?`;
            if (confirm(msg)) {
                equipAndAutoDisassemble(eq);
                log(`금고 보상: ${eq.tier} ${slot} 장착 완료! [${meta.name}]`);
            } else {
                log('금고 보상 취소—다음에 더 좋은 기회를 노려보자!');
            }
            updateGoldUI(); clampYouHP(); updateHPBars?.();
            done();
        } catch {
            log(`오류: 보상 처리 중 문제 발생`);
            done();
        }
    };

    log('백업 캐시 금고: 너의 추억을 넣어 장비로 정제할 수 있어! (무작위 슬롯)');
    input.click();
}
function openEvent() {
    const panel = $('#dialoguePanel');
    const lines = $('#dialogueLines');
    const choices = $('#choiceList');
    if (!panel || !lines || !choices) { advanceFlow(300); return; }

    const r = state.char?.rng || makeRNG(0x7531abcd);
    const wish = buildMemoryWish(r);

    lines.innerHTML = `
    <p><b>파편 아카이브</b> 접근 권한 획득.</p>
    <p class="muted">나는 <b>${wish.sentence}</b>를 원해.</p>
    <p class="muted">사진을 업로드하면 조건에 맞는지 검증하고, 로그를 복원할게.</p>
  `;
    choices.innerHTML = '';

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);

    const uploadBtn = document.createElement('button');
    uploadBtn.className = 'primary';
    uploadBtn.textContent = '사진 업로드';
    uploadBtn.onclick = () => fileInput.click();

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = '그만두기';
    cancelBtn.onclick = () => { cleanup(); advanceFlow(300); };

    choices.appendChild(uploadBtn);
    choices.appendChild(cancelBtn);

    fileInput.onchange = async e => {
        const f = e.target.files?.[0]; if (!f) return;
        const meta = await analyzeImage(f);
        const judge = checkMemoryWish(meta, wish);

        const detail = judge.results.map(r => {
            const name = WishLabel[r.key];
            return `<li>${name}: ${r.ok ? '충족' : '미충족'}</li>`;
        }).join('');
        if (judge.ok) {
            storyAt('wish_ok_' + state.floor, '좋았어! 네 기억이 빈칸을 정확히 메웠어ι(˙◁˙ )/', { theme: 'green' });
        } else {
            storyAt('wish_ng_' + state.floor, '아쉬워… 아직 부족해. 다른 결로 다시 시도해 보자(-‸-,)');
        }
        const rewards = [];
        state.gold += judge.gold; rewards.push(`골드 +${judge.gold}`);
        if (judge.heal > 0) {
            state.char.hp = Math.min(getYouStats().HPmax, state.char.hp + judge.heal);
            rewards.push(`HP +${judge.heal}`);
        }
        const kit = (judge.ok && judge.results.length === 2)
            ? { id: 'patch_m', name: '안정화 패치 M', type: 'heal', amount: 30, desc: '체력 30 회복' }
            : { id: 'patch_s', name: '안정화 패치 S', type: 'heal', amount: 18, desc: '체력 18 회복' };
        state.inventory.consum.push(kit);
        rewards.push(`${kit.name} ×1`);

        updateGoldUI(); clampYouHP(); updateHPBars?.();
        log(`아카이브 복원: ${rewards.join(', ')}`);

        lines.innerHTML = `
          <p><b>검증 결과</b></p>
          <ul>${detail}</ul>
          <p>${judge.ok ? '완벽해! 로그가 선명해졌어.' : '충분하진 않지만, 몇 조각은 채워졌어.'}</p>
          <p><b>보상</b> — ${rewards.join(' / ')}</p>
        `;
        choices.innerHTML = '';
        const cont = document.createElement('button');
        cont.textContent = '계속';
        cont.className = 'primary';
        cont.onclick = () => { cleanup(); advanceFlow(450); };
        choices.appendChild(cont);
    };

    panel.removeAttribute('hidden');

    function cleanup() {
        panel.setAttribute('hidden', '');
        fileInput.remove();
    }
}
function applyTrap() {
    // 소환 전 안전 가드
    if (!state.char) {
        pixieSay('시스템: 소환 전 함정 감지 — 효과는 보류됨.', { tone: 'warn' });
        advanceFlow(350);
        return;
    }

    // 스택 적용
    const prev = state.char.trapDEF || 0;
    state.char.trapDEF = prev + 1;

    // PIXIE 로그에 확실히 남기기
    log('함정: 다음 전투에서 DEF -1 (1회)');

    // 가벼운 현장 토스트(시트 안 열어도 보이게)
    const toast = document.createElement('div');
    toast.textContent = '🪤 함정 발동: 다음 전투 DEF -1 (1회)';
    Object.assign(toast.style, {
        position: 'fixed', left: '50%', top: '14px', transform: 'translateX(-50%)',
        padding: '8px 12px', background: 'rgba(255,80,80,.9)', color: '#fff',
        fontWeight: '700', borderRadius: '10px', zIndex: 9999, pointerEvents: 'none',
        boxShadow: '0 6px 18px rgba(0,0,0,.25)', transition: 'opacity .4s'
    });
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; }, 900);
    setTimeout(() => { toast.remove(); }, 1400);

    advanceFlow(350);
}

function openShop() {
    // 시트 먼저 연다(렌더 실패해도 패널은 떠 있게)
    const sheet = $('#shopSheet');
    if (sheet) { sheet.hidden = false; sheet.removeAttribute('aria-hidden'); storyAt('shop_open_' + state.floor, '필요한 패치를 고르자. 골드를 너무 아끼면 다음 방이 아플 수 있어.'); }

    const floorBump = Math.max(0, (state.floor - 1)) * 2;

    const slotA = {
        id: 'heal30', name: '안정화 패치(즉시)', desc: 'HP 30 회복',
        cost: 30 + floorBump,
        buy() {
            state.gold -= this.cost;
            state.char.hp = Math.min(getYouStats().HPmax, state.char.hp + 30);
            updateGoldUI(); updateHPBars();
            log(`상점A: ${this.name} 구매 (HP +30, -${this.cost}G)`);
        }
    };
    const slotB = {
        id: 'patch_m', name: '안정화 패치 M', desc: '소모품: 사용 시 HP +30',
        cost: 22 + floorBump,
        buy() {
            state.gold -= this.cost;
            (state.inventory.consum ||= []).push({ id: 'patch_m', name: '안정화 패치 M', type: 'heal', amount: 30, desc: '체력 30 회복' });
            updateGoldUI();
            log(`상점B: ${this.name} 구매 (인벤토리 지급, -${this.cost}G)`);
        }
    };

    // 티어 미리보기 제거
    const r = state.char?.rng || makeRNG(0x5a1e5);
    const slotPick = ['weapon', 'armor', 'rune'][Math.floor(r() * 3)];
    const slotC = {
        id: 'gear',
        name: `${slotPick}`,
        desc: `무작위 ${slotPick} — 구매하면 업로드한 추억으로 계수를 정해 즉시 장착(이전 장비 자동 분해).`,
        cost: 55 + Math.max(0, (state.floor - 1)) * 3,
        buy() {
            const inp = document.createElement('input');
            inp.type = 'file'; inp.accept = 'image/*'; inp.style.display = 'none';
            document.body.appendChild(inp);
            inp.onchange = async (e) => {
                const f = e.target.files?.[0]; if (!f) { inp.remove(); return; }
                const meta = await analyzeImage(f);
                state.gold -= this.cost;
                const eq = makeEquipmentFromImage(meta, slotPick, 'reward', state.floor);
                equipAndAutoDisassemble(eq);
                updateGoldUI();
                log(`상점C: ${eq.tier} ${slotPick} 구매/장착 (-${this.cost}G) [${meta.name}]`);
                inp.remove(); renderShop();
            };
            inp.click();
        }
    };

    state.temp ||= {};
    state.temp.shopOffers = [slotA, slotB, slotC];

    try { renderShop(); }
    catch (err) {
        log('상점 렌더 중 오류. 기본 목록으로 재시도할게!');
        // 최소 표시
        $('#shopList').innerHTML = `
          <div class="card"><b>${slotA.name}</b><div class="muted">${slotA.desc}</div>
          <div style="display:flex;justify-content:space-between;margin-top:8px;">
            <span class="tag">${slotA.cost}G</span><button data-buy="0">구매</button></div></div>
          <div class="card"><b>${slotB.name}</b><div class="muted">${slotB.desc}</div>
          <div style="display:flex;justify-content:space-between;margin-top:8px;">
            <span class="tag">${slotB.cost}G</span><button data-buy="1">구매</button></div></div>
          <div class="card"><b>${slotC.name}</b><div class="muted">${slotC.desc}</div>
          <div style="display:flex;justify-content:space-between;margin-top:8px;">
            <span class="tag">${slotC.cost}G</span><button data-buy="2">구매</button></div></div>
        `;
        document.getElementById('shopList').onclick = (e) => {
            const btn = e.target.closest('button[data-buy]'); if (!btn) return;
            const offer = state.temp.shopOffers[+btn.dataset.buy];
            if (!offer) return;
            if (state.gold < offer.cost) { log('골드가 부족해.'); return; }
            offer.buy();
        };
    }

    // 닫기 버튼은 한 번만 바인딩
    const closer = document.querySelector('#shopSheet .close[data-close="#shopSheet"]');
    if (closer && !closer._wired) {
        closer._wired = true;
        closer.addEventListener('click', () => {
            $('#shopSheet').setAttribute('hidden', '');
            $('#shopSheet').setAttribute('aria-hidden', 'true');
            advanceFlow(300);
        });
    }
}

function renderShop() {
    const host = $('#shopList');
    if (!host) return;
    const offers = state.temp?.shopOffers || [];

    host.innerHTML = offers.map((o, i) => {
        const afford = state.gold >= o.cost;
        return `
          <div class="card" data-offer="${i}" style="display:flex;flex-direction:column;gap:8px;">
            <div style="font-weight:700;display:flex;align-items:center;gap:8px;">${o.name}</div>
            <div class="muted" style="font-size:13px;">${o.desc || ''}</div>
            <div style="margin-top:auto;display:flex;align-items:center;justify-content:space-between;">
              <span class="tag">${o.cost}G</span>
              <button data-buy="${i}" ${afford ? '' : 'disabled'}>${afford ? '구매' : '골드부족'}</button>
            </div>
          </div>
        `;
    }).join('');

    host.onclick = (e) => {
        const btn = e.target.closest('button[data-buy]');
        if (!btn) return;
        const idx = +btn.getAttribute('data-buy');
        const offer = state.temp?.shopOffers?.[idx];
        if (!offer) return;
        if (state.gold < offer.cost) { log('골드가 부족해.'); return; }
        try { offer.buy(); }
        catch (err) { log('상점 구매 처리 중 오류가 있어.'); }
    };
}

// ▼ 기존 openExit 전부 교체
function openExit() {
    const D1 = $('#seedPopupA'), D2 = $('#seedPopupB');
    if (!D1 || !D2) { advanceFlow(300); return; }

    D1.removeAttribute('hidden');
    D1.showModal();

    $('#seedOkA').onclick = async () => {
        const f = $('#seedFileA').files?.[0];
        if (!f) return;
        const ab = await f.arrayBuffer();
        state.seeds.path = await safeHashHex(ab);

        D1.close();
        D1.setAttribute('hidden', '');
        D2.removeAttribute('hidden');
        D2.showModal();
    };

    $('#seedOkB').onclick = async () => {
        const f = $('#seedFileB').files?.[0];
        if (!f) return;
        const ab = await f.arrayBuffer();
        state.seeds.env = await safeHashHex(ab);

        D2.close();
        D2.setAttribute('hidden', '');

        // 다음 층 생성
        await buildNextFloor(state.seeds.path, state.seeds.env);

        // 진행 수치 갱신
        state.floor += 1;
        state.fidelity = Math.min(5, state.fidelity + 1);

        // HUD 반영
        const fid = $('#fidelity');
        if (fid) fid.textContent = 'L' + state.fidelity;

        log('다음 층으로 이동');

        // ★★★ 엔딩 트리거: L5 도달 시 분기
        if (state.fidelity >= 5) {
            try {
                const key = computeEndingKey(); // good | normal | bad
                // 엔딩 연출로 진입 (이 함수가 재시작/엔드리스/나가기 등 선택 처리)
                await showEndingOverlay(key);
            } catch (e) {
                console.error(e);
                // 혹시 엔딩 연출에서 오류나면 안전하게 맵으로 복귀
                enterRoom(state.map.startNodeId);
            }
            save();
            return; // 엔딩 분기 했으니 여기서 종료
        }

        // 평소처럼 다음 층 입장
        enterRoom(state.map.startNodeId);
        save();
    };
}


/* ---------- 공용 UI(시트 닫기/가방) ---------- */
document.addEventListener('click', e => {
    const t = e.target.closest('[data-close]'); if (!t) return;
    const sel = t.getAttribute('data-close'); const el = document.querySelector(sel); if (!el) return;
    if (el.tagName === 'DIALOG' && el.close) el.close();
    el.setAttribute('hidden', '');
});
$('#mapDock')?.addEventListener('click', () => { const ov = $('#mapOverlay'); if (ov) ov.hidden = false; });
$$('.close').forEach(b => b.addEventListener('click', () => {
    const sel = b.getAttribute('data-close'); if (sel) { const el = $(sel); if (el) el.hidden = true; }
}));

function renderItemsUI() {
    const host = $('#itemsList'); if (!host) return;
    const items = state.inventory.consum || [];
    if (!items.length) {
        host.innerHTML = '<div class="card">소모품이 없습니다</div>';
        return;
    }
    host.innerHTML = items.map((it, i) => `
      <div class="card" style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <div>
          <div><b>${it.name}</b></div>
          <div class="muted" style="font-size:12px;">${it.desc || ''}</div>
        </div>
        <button data-use="${i}">사용</button>
      </div>
    `).join('');
    host.querySelectorAll('button[data-use]').forEach(b => {
        b.onclick = () => useItem(parseInt(b.getAttribute('data-use'), 10));
    });
}
function useItem(idx) {
    const items = state.inventory.consum || [];
    const it = items[idx]; if (!it) return;
    if (it.type === 'heal') {
        const eff = getYouStats();
        const before = state.char.hp;
        state.char.hp = Math.min(eff.HPmax, state.char.hp + it.amount);
        const gain = state.char.hp - before;
        log(`소모품 사용: ${it.name} (HP +${gain})`);
        updateHPBars();
    }
    items.splice(idx, 1);
    state.inventory.consum = items;
    renderItemsUI(); save();
}
function renderBagTab(tab = 'equip') {
    document.querySelectorAll('#bagSheet .tabs button').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === tab);
    });
    const eq = $('#equipSlots'), it = $('#itemsList'), rl = $('#relics');
    if (eq) eq.hidden = tab !== 'equip';
    if (it) it.hidden = tab !== 'consum';
    if (rl) rl.hidden = tab !== 'relics';
    if (tab === 'equip') renderEquipUI();
    else if (tab === 'consum') renderItemsUI();
    else if (tab === 'relics') renderRelicsUI();
}
$('#bagBtn')?.addEventListener('click', () => { renderBagTab('equip'); const s = $('#bagSheet'); if (s) s.hidden = false; });
$('#bagSheet')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.tabs button[data-tab]'); if (!btn) return;
    renderBagTab(btn.dataset.tab);
});

/* ---------- 소환 & 초기화 ---------- */
$('#summonBtn')?.addEventListener('click', () => $('#fileInput').click());
$('#fileInput')?.addEventListener('change', async e => {
    const file = e.target.files?.[0]; if (!file) return;
    const meta = await analyzeImage(file);
    const stats = metaToStats(meta);
    const seed = parseInt(meta.hash.slice(0, 8), 16) >>> 0;

    state.char = { meta, stats, hp: stats.HP, rng: makeRNG(seed) };
    state.char.powerInit = calcCharPower(stats); // 초기 소환 파워
    state.char.powerRef = REF_BASE_POWER;       // 적 스케일 기준선
    state.char.power = state.char.powerInit; // 표시용

    state.lootProfile = ['lowHigh', 'balanced', 'highLow'][Math.floor(state.char.rng() * 3)];
    state.runId = meta.hash.slice(0, 12);

    setPhase('run');
    // ... 기존 setPhase('run'); UI 업데이트 등 이후, 맨 끝쪽에 한 줄
    storyAt('summoned', `접속 확인. <b>${meta.name}</b>의 잔광이 안정적이야. 탐사가 시작돼.`, { theme: 'green' });

    const S = $('#stats');
    if (S) S.innerHTML = `
    <div class="tag">ATK ${stats.ATK}</div>
    <div class="tag">DEF ${stats.DEF}</div>
    <div class="tag">SPD ${stats.SPD}</div>
    <div class="tag">CRIT ${stats.CRIT}%</div>
    <div class="tag">Skill ${stats.skill}</div>`;
    const T = $('#tags');
    if (T) T.innerHTML = `
    <span class="tag">MIME ${meta.type}</span>
    <span class="tag">SIZE ${(meta.size / 1024) | 0}KB</span>
    <span class="tag">HASH ${meta.hash.slice(0, 8)}</span>
    <span class="tag">IMG ${meta.width}×${meta.height}</span>`;

    updateGoldUI();
    log(`탐사자 소환: ${meta.name} / 해시 ${meta.hash.slice(0, 8)}`);

    const atk = $('#attackBtn'); if (atk) atk.disabled = true;
    clampYouHP(); updateHPBars();

    await buildTutorialFloor(meta.hash);
    enterRoom(state.map.startNodeId);
    save();
});
function showRestartPrompt() {
    // 간단 오버레이 생성 (스타일 인라인: CSS 건드리지 않으려면 이렇게)
    const wrap = document.createElement('div');
    wrap.id = 'restartOverlay';
    Object.assign(wrap.style, {
        position: 'fixed', inset: '0', zIndex: 9999,
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
    });

    const card = document.createElement('div');
    Object.assign(card.style, {
        minWidth: 'min(480px, 92vw)', padding: '20px 16px',
        borderRadius: '16px', border: '1.5px solid rgba(255,0,140,.45)',
        background: 'rgba(10, 10, 16, .9)', color: '#fff',
        boxShadow: '0 0 24px rgba(255,0,140,.3), inset 0 0 8px rgba(255,0,140,.15)',
        textAlign: 'center'
    });

    const title = document.createElement('div');
    title.textContent = '미안, 이번에는 지키지 못했어.';
    Object.assign(title.style, { fontSize: '18px', fontWeight: 700, marginBottom: '6px' });

    const msg = document.createElement('div');
    msg.textContent = '처음부터 다시 해보자.';
    Object.assign(msg.style, { opacity: .9, marginBottom: '16px' });

    const btn = document.createElement('button');
    btn.textContent = '처음부터';
    Object.assign(btn.style, {
        padding: '10px 16px', borderRadius: '10px', border: '1px solid #ff4bd2',
        background: '#1b0f1b', color: '#fff', cursor: 'pointer',
        boxShadow: '0 0 12px rgba(255,75,210,.35)'
    });
    btn.onclick = restartRun;

    card.appendChild(title);
    card.appendChild(msg);
    card.appendChild(btn);
    wrap.appendChild(card);
    document.body.appendChild(wrap);
}

function restartRun() {
    try { localStorage.removeItem(SAVE_KEY); } catch { }
    // 상태 깔끔히 초기화 후 새로고침이 가장 안전
    location.reload();
}

/* ---------- 부트 ---------- */
window.addEventListener('DOMContentLoaded', () => {
    // 모든 오버레이/시트 닫기
    ['#mapOverlay', '#bagSheet', '#logSheet', '#dialoguePanel', '#shopSheet'].forEach(sel => {
        const el = $(sel); if (el) el.setAttribute('hidden', '');
    });
    document.querySelectorAll('dialog').forEach(d => { try { d.close(); } catch { } d.setAttribute('hidden', ''); });

    setPhase('intro');
    const bst = $('#battleStage'); if (bst) bst.hidden = true;
    const atk = $('#attackBtn'); if (atk) atk.disabled = true;

    const rn = $('#roomName'); if (rn) rn.innerHTML = '안녕 ! 나는 P.I.X.I.E (Personal Indexing eXfiltration Interface)야! 탐사를 시작하려면 추억이 담긴 사진을 불러와줘!';
    const rd = $('#roomDesc'); if (rd) rd.textContent = '하단의 “기억을 불러오기”를 눌러 탐사자를 소환해보자!';

    try { openIntro(); } catch { openIntro(); }

    if (AUTORESTORE && load() && state.char) {
        setPhase('run');
        const s = state.char.stats, m = state.char.meta;
        const S = $('#stats'); if (S) S.innerHTML = `
          <div class="tag">ATK ${s.ATK}</div><div class="tag">DEF ${s.DEF}</div>
          <div class="tag">SPD ${s.SPD}</div><div class="tag">CRIT ${s.CRIT}%</div>
          <div class="tag">Skill ${s.skill}</div>`;
        const T = $('#tags'); if (T) T.innerHTML = `
          <span class="tag">MIME ${m.type}</span><span class="tag">SIZE ${(m.size / 1024) | 0}KB</span>
          <span class="tag">HASH ${m.hash.slice(0, 8)}</span><span class="tag">IMG ${m.width}×${m.height}</span>`;
        updateGoldUI(); renderEquipUI(); renderRelicsUI(); log('세션 복원 완료');
        clampYouHP(); updateHPBars();

        if (state.map && state.room) enterRoom(state.room.id);
        else if (state.map) enterRoom(state.map.startNodeId);
    }
});
/* =========================
   Vault (백업 캐시 금고) — Drop-in
   ========================= */

/* 상태 슬롯 확보 */
state.temp ||= {};
state.temp.vault ||= { shards: 0, keys: 0 };

/* 유틸: 난수 */
function _vrng() { return (state.char?.rng || Math.random); }

/* 오퍼 생성 */
function generateVaultOffers() {
    const r = _vrng();
    // 슬롯 A: 메모리 융합 장비 (파일 업로드 → 장착)
    const slot = ['weapon', 'armor', 'rune'][Math.floor(r() * 3)];
    const offerA = {
        id: 'vault_eq',
        type: 'equipment',
        name: `메모리 융합 ${slot}`,
        desc: `이미지 업로드로 ${slot}를 생성하고 즉시 장착(이전 장비 자동 분해).`,
        action: async () => {
            // 파일 업로드
            const inp = document.createElement('input');
            inp.type = 'file'; inp.accept = 'image/*'; inp.style.display = 'none';
            document.body.appendChild(inp);
            inp.onchange = async (e) => {
                const f = e.target.files?.[0]; inp.remove();
                if (!f) { log('금고: 업로드가 취소되었어.'); return; }
                const meta = await analyzeImage(f);
                // 장비 생성 (소스는 'reward'로 통일, 층 스케일 반영)
                const eq = makeEquipmentFromImage(meta, slot, 'reward', state.floor);
                equipAndAutoDisassemble(eq);
                log(`금고 보상: ${eq.tier} ${slot} 장착 완료! [${meta.name}]`);
                // 선택 1회 소모 처리
                consumeVaultPick();
            };
            inp.click();
        }
    };

    // 슬롯 B: 골드
    const goldGain = 18 + Math.floor((_vrng()() * 1 + state.floor) * 4); // 층 보정
    const offerB = {
        id: 'vault_gold',
        type: 'gold',
        name: `골드 +${goldGain}`,
        desc: '획득 즉시 반영',
        action: () => {
            state.gold += goldGain; updateGoldUI();
            log(`금고 보상: 골드 +${goldGain}`);
            consumeVaultPick();
        }
    };

    // 슬롯 C: 소모품
    const kits = [
        { id: 'patch_s', name: '안정화 패치 S', type: 'heal', amount: 18, desc: '체력 18 회복' },
        { id: 'patch_m', name: '안정화 패치 M', type: 'heal', amount: 30, desc: '체력 30 회복' },
        { id: 'patch_l', name: '안정화 패치 L', type: 'heal', amount: 45, desc: '체력 45 회복' },
    ];
    const kit = kits[Math.floor(r() * kits.length)];
    const offerC = {
        id: 'vault_item',
        type: 'item',
        name: `${kit.name} ×1`,
        desc: kit.desc,
        action: () => {
            (state.inventory.consum ||= []).push({ ...kit });
            renderItemsUI?.();
            log(`금고 보상: ${kit.name} ×1 획득`);
            consumeVaultPick();
        }
    };

    return [offerA, offerB, offerC];
}

/* 렌더링 */
function renderVault() {
    const sheet = document.getElementById('vaultSheet');
    const list = document.getElementById('vaultList');
    const picks = document.getElementById('vaultPicksLeft');
    const shards = document.getElementById('vaultShards');
    const keys = document.getElementById('vaultKeys');
    const reroll = document.getElementById('vaultRerollBtn');

    if (!sheet || !list || !picks || !shards || !keys || !reroll) {
        log('오류: 금고 UI 요소를 찾을 수 없어.');
        // 안전장치: 기존 단일 보상 흐름으로 폴백
        legacyRewardFallback();
        return;
    }

    const V = state.temp.vault;

    // 오퍼 초기화
    if (!V.offers || !Array.isArray(V.offers) || !V.offers.length) {
        V.offers = generateVaultOffers();
    }

    // 카드 3개
    list.innerHTML = V.offers.map((o, i) => `
    <div class="card" data-idx="${i}" style="display:flex;flex-direction:column;gap:8px;">
      <div style="font-weight:700">${o.name}</div>
      <div class="muted" style="font-size:12px;">${o.desc}</div>
      <button data-pick="${i}" ${V.picksLeft > 0 ? '' : 'disabled'}>
        ${V.picksLeft > 0 ? '선택' : '선택 완료'}
      </button>
    </div>
  `).join('');

    // 상단 상태
    picks.textContent = `남은 선택: ${V.picksLeft}`;
    shards.textContent = `조각: ${V.shards}`;
    keys.textContent = `Keys: ${V.keys}`;

    // 선택 핸들러
    list.onclick = (e) => {
        const btn = e.target.closest('button[data-pick]');
        if (!btn) return;
        const idx = +btn.dataset.pick;
        const offer = V.offers?.[idx]; if (!offer) return;
        if (V.picksLeft <= 0) { log('금고: 더 이상 선택할 수 없어.'); return; }
        offer.action?.();
    };

    // 재롤: 10G 또는 조각 1개 소모
    reroll.onclick = () => {
        if (V.shards > 0) {
            V.shards -= 1;
            log('금고: 조각 1개로 오퍼를 리롤했어.');
        } else if (state.gold >= 10) {
            state.gold -= 10; updateGoldUI();
            log('금고: 10G로 오퍼를 리롤했어.');
        } else {
            log('금고: 리롤에 필요한 자원이 부족해.');
            return;
        }
        V.offers = generateVaultOffers();
        renderVault();
    };

    // 오픈
    sheet.hidden = false;
    sheet.removeAttribute('aria-hidden');
}

/* 선택 소모 & 종료 처리 */
function consumeVaultPick() {
    const V = state.temp.vault;
    V.picksLeft = Math.max(0, (V.picksLeft || 0) - 1);
    renderVault();

    // 선택이 모두 끝나면 닫고 다음 흐름
    if (V.picksLeft <= 0) {
        setTimeout(() => {
            const sheet = document.getElementById('vaultSheet');
            if (sheet) {
                sheet.setAttribute('hidden', '');
                sheet.setAttribute('aria-hidden', 'true');
            }
            advanceFlow(450);
        }, 300);
    }
}

/* 폴백: 기존 단일 보상(파일 업로드 → 장비) */
function legacyRewardFallback() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*'; input.style.display = 'none';
    document.body.appendChild(input);
    input.onchange = async e => {
        const f = e.target.files?.[0]; input.remove();
        if (!f) { log('금고 취소…'); advanceFlow(300); return; }
        try {
            const meta = await analyzeImage(f);
            const slot = ['weapon', 'armor', 'rune'][Math.floor(_vrng()() * 3)];
            const eq = makeEquipmentFromImage(meta, slot, 'reward', state.floor);
            equipAndAutoDisassemble(eq);
            log(`금고 보상(폴백): ${eq.tier} ${slot} 장착! [${meta.name}]`);
        } catch {
            log('오류: 금고 처리 실패');
        }
        advanceFlow(300);
    };
    log('백업 캐시 금고(폴백): 이미지를 업로드하면 장비로 정제할게!');
    input.click();
}

/* 공개 API: 기존 openReward() 교체 */
function openReward() {
    // 최초 진입 시 일회성 초기값
    const V = state.temp.vault;
    if (!('shards' in V)) V.shards = 0;
    if (!('keys' in V)) V.keys = 0;

    // 키가 있으면 2회 선택, 없으면 1회
    V.picksLeft = (V.keys > 0) ? 2 : 1;
    V.offers = generateVaultOffers();
    renderVault();
}

/* 금고 닫기 버튼 처리(이미 data-close가 있지만 안전망) */
document.querySelector('#vaultSheet .close[data-close="#vaultSheet"]')?.addEventListener('click', () => {
    const sheet = document.getElementById('vaultSheet');
    sheet.setAttribute('hidden', '');
    sheet.setAttribute('aria-hidden', 'true');
    advanceFlow(300);
});
/* ======================
   Story Bubble Hooks
   ====================== */
// 중복/스팸 방지용 간단 쿨다운 (키별)
const _storyCooldown = new Map();


function storyAt(key, text, opts = {}) {
    const now = Date.now();
    const cd = opts.cooldown ?? 1200;
    const last = _storyCooldown.get(key) || 0;
    if (now - last < cd) return; // 쿨다운 중
    _storyCooldown.set(key, now);
    if (typeof window.story === 'function') {
        window.story(text, {
            autohide: opts.autohide ?? 2400,
            theme: opts.theme ?? null,
            onClose: opts.onClose
        });
    }
}

/** 전투 중 너무 잦게 뜨지 않게 하고 싶으면 이 헬퍼 사용 */
function storyInCombat(key, text, opts = {}) {
    // 턴락 중엔 큐에 넣고, 풀리면 보여주고 싶다면 옵션 확장 가능
    if (state.turnLock) return;
    storyAt(key, text, { theme: 'pink', ...opts });
}
