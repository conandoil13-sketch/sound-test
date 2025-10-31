/* ================================
   app.js — PIXIE Prototype (Full, fixed)
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
    turnLock: false,
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
    setTimeout(closeIntro, 4200);
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
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

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
    good: './assets/pixie/pixie_good.png',
    normal: './assets/pixie/pixie_normal.png',
    bad: './assets/pixie/pixie_bad.png',
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
    const imgSrc = ENDING_ASSETS[endingKey] || ENDING_ASSETS.normal;
    try { await preloadImg(imgSrc); } catch { }

    ['#mapOverlay', '#bagSheet', '#shopSheet', '#dialoguePanel', '#logSheet'].forEach(sel => {
        const el = document.querySelector(sel); if (el) el.setAttribute('hidden', '');
    });
    setPhase('intro');

    const wrap = document.createElement('div');
    wrap.id = 'endingOverlay';
    Object.assign(wrap.style, { position: 'fixed', inset: '0', zIndex: '3000', overflow: 'hidden' });

    const bg = document.createElement('div');
    Object.assign(bg.style, {
        position: 'absolute', inset: '0',
        backgroundImage: `url("${imgSrc}")`,
        backgroundSize: 'cover', backgroundPosition: 'center center', backgroundRepeat: 'no-repeat',
        filter: 'saturate(1.05) contrast(1.02)'
    });

    const dim = document.createElement('div');
    Object.assign(dim.style, {
        position: 'absolute', inset: '0',
        background: 'linear-gradient(180deg, rgba(0,0,0,.35), rgba(0,0,0,.6))'
    });

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
        p1.textContent = '“여기까지 왔네. 완벽하진 않지만 충분히 아름다웠어.”';
        p2.textContent = '“지금 나갈 수도, 이 세계를 계속 탐험할 수도 있어.”';
    }

    const row = document.createElement('div');
    Object.assign(row.style, { display: 'flex', flexWrap: 'wrap', gap: '10px', justifyContent: 'center' });

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

    function closeEnding() { document.getElementById('endingOverlay')?.remove(); }
    function exitToIntro() { closeEnding(); restartRun(true); }

    if (endingKey === 'good') {
        row.append(
            btnPrimary('나가기', exitToIntro),
            btnGhost('PIXIE 로그', () => { document.querySelector('#logSheet')?.removeAttribute('hidden'); })
        );
    } else if (endingKey === 'bad') {
        row.append(
            btnPrimary('처음부터', exitToIntro),
            btnGhost('PIXIE 로그', () => { document.querySelector('#logSheet')?.removeAttribute('hidden'); })
        );
    } else {
        const endlessBtn = btnPrimary('엔드리스로 계속', async () => {
            state.endless = true;
            closeEnding();
            try {
                await buildNextFloor(state.seeds.path, state.seeds.env);
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
    const SPD = 10 + (Math.abs(meta.aspect - 1) > 0.6 ? 2 : 0) +
        ((meta.hsvAvg.h > 200 && meta.hsvAvg.h < 260) ? 2 : (meta.hsvAvg.h < 40 || meta.hsvAvg.h > 330) ? 1 : 0);

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
function escapeHTML(s = '') { return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
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
    const time = now.toTimeString().slice(0, 5);
    PIXIE_BUF.push({ text, tone, badge, time });
    if (PIXIE_BUF.length > 200) PIXIE_BUF.shift();
    renderPixieLog();
}
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

/* ===== 유효 스탯 & HP 상한 ===== */
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

/* ---------- 절차 스프라이트 (기본형, 현재는 ENEMY 전용 시스템 사용) ---------- */
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
    clampYouHP(); updateHPBars();
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
    const LAYERS = 5 + Math.floor(r() * 2);
    const FANOUT_MIN = 2, FANOUT_MAX = 3;
    const typesPool = ['battle', 'battle', 'reward', 'trap', 'shop', 'event'];

    const nodes = [], edges = [];
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
        case 'exit': return '다음 층으로 이어주는 포트가 숨어 있어. 시그니처를 맞추면 열린다.';
        default: return '';
    }
}
/* 말풍선 확률: 튜토리얼은 항상, 그 외 35% (게임 RNG 소비 금지) */
function shouldNarrateRoom() {
    if (state?.map?.id === 'TUT') return true;
    return Math.random() < 0.35;
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

        // ✅ 핵심 액션: 항상 실행
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

        // ✅ 말풍선: 보스는 항상, 그 외는 확률
        const t = state.room.type;
        const narrate = (t === 'boss') || shouldNarrateRoom();
        if (narrate) {
            if (t === 'battle') storyAt('room_bat_' + nodeId, '잔향체 냄새가 나… 먼저 정리하자.', {
                autohide: 2400,
                avatar: {
                    src: window.pickPose?.('talk_a', { random: false }) || './assets/pixie/talk_a.png',
                    position: 'left', size: 118, radius: 16, alt: 'PIXIE — 대화'
                }
            });
            if (t === 'event') storyAt('room_evt_' + nodeId, '파편 아카이브다! 조건에 맞는 기억이면 로그를 되살릴 수 있어 ପ(˶•-•˶)ଓ ♡', {
                autohide: 2400,
                avatar: {
                    src: window.pickPose?.('surprised', { random: false }) || './assets/pixie/surprised.png',
                    position: 'left', size: 118, radius: 16, alt: 'PIXIE — 놀람'
                }
            });
            if (t === 'reward') storyAt('room_rwd_' + nodeId, '백업 캐시 금고 발견( σ̴̶̷̤ .̫ σ̴̶̷̤ ) 적합한 추억으로 장비를 강화할 수 있어!', {
                autohide: 2400,
                avatar: {
                    src: window.pickPose?.('surprised', { random: false }) || './assets/pixie/surprised.png',
                    position: 'left', size: 118, radius: 16, alt: 'PIXIE — 놀람'
                }
            });
            if (t === 'trap') storyAt('room_trp_' + nodeId, '조심해. 이 구간 메모리가 찢어져 있어.', {
                theme: 'pink', autohide: 2400,
                avatar: {
                    src: window.pickPose?.('serious', { random: false }) || './assets/pixie/serious.png',
                    position: 'left', size: 118, radius: 16, alt: 'PIXIE — 진지'
                }
            });
            if (t === 'shop') storyAt('room_shp_' + nodeId, '패치 키오스크 온라인. 장비/회복/룬을 준비해.', {
                autohide: 2400,
                avatar: {
                    src: window.pickPose?.('talk_a', { random: false }) || './assets/pixie/talk_a.png',
                    position: 'left', size: 118, radius: 16, alt: 'PIXIE — 대화'
                }
            });
            if (t === 'boss') storyAt('room_bos_' + nodeId, '조심해!! 관리자 데몬이야!!', {
                autohide: 2400,
                avatar: {
                    src: window.pickPose?.('serious', { random: false }) || './assets/pixie/serious.png',
                    position: 'left', size: 118, radius: 16, alt: 'PIXIE — 진지'
                }
            });
            if (t === 'exit') storyAt('room_ext_' + nodeId, '포트가 보여. 시드 두 개가 필요해.', {
                autohide: 2200,
                avatar: {
                    src: window.pickPose?.('talk_a', { random: false }) || './assets/pixie/talk_a.png',
                    position: 'left', size: 108, radius: 14, alt: 'PIXIE — 대화'
                }
            });
        }

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
const mapGraphEl = $('#mapGraph');
if (mapGraphEl) {
    mapGraphEl.addEventListener('click', (e) => {
        const li = e.target.closest('li[data-node]');
        if (!li) return;
        const id = li.dataset.node;
        if (li.classList.contains('locked')) { log('이 경로는 아직 닿을 수 없어.'); return; }
        if (id === state.room?.id) { $('#mapOverlay').hidden = true; return; }
        $('#mapOverlay').hidden = true;
        enterRoom(id);
    });
}
$('#mapDock')?.addEventListener('click', () => { renderMapOverlay(); $('#mapOverlay').hidden = false; });

function advanceFlow(delay = 0) {
    setTimeout(() => {
        renderMapOverlay();
        const ov = document.querySelector('#mapOverlay');
        if (ov) ov.hidden = false;
        log('다음 폴더를 선택해줘.');
    }, delay);
}

/* ===== 데미지 감쇠 커브 ===== */
function softDamageAgainst(ATK, DEF) {
    const BASE = 40, SPAN = 50, K_ATK = 1.00, C_DEF = 1.10, BIAS = 12;
    const num = ATK * K_ATK;
    const den = (ATK * K_ATK) + (DEF * C_DEF) + BIAS;
    const ratio = den > 0 ? num / den : 0;
    const dmg = BASE + SPAN * ratio;
    return Math.max(1, Math.round(dmg));
}

/* ---------- 전투 ---------- */
/* (YOU 스프라이트는 아래 Player Sprite System에서 렌더) */
function calcEnemyStats(isBoss = false) {
    const base = isBoss ? { HP: 170, ATK: 30, DEF: 15, SPD: 7 }
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

/* =========================================
 * Enemy Sprite System — VARIANTS (REPLACE)
 * ========================================= */

const _enemySpriteCache = new Map();

/* 아키타입 + 파라미터 빌드 */
function buildEnemySpriteConfig(seed32, isBoss = false) {
    const r = makeRNG(seed32 >>> 0);
    const archetypes = ['sentinel', 'swarm', 'obelisk', 'orbiter'];
    const type = isBoss ? 'obelisk' : archetypes[Math.floor(r() * archetypes.length)];

    // 팔레트: 플레이어 기준 +140°에 ±15° 가변
    const baseH = ((state.char?.meta?.hsvAvg?.h ?? 210) + 140 + Math.round((r() - 0.5) * 30) + 360) % 360;
    const sat = 60 + Math.round(r() * 10);
    const lig = isBoss ? 22 : 18;

    // 공통 파라미터
    const strokeStyle = (r() < 0.35) ? 'dash' : 'solid';
    const tiltDeg = Math.round((r() - 0.5) * 10); // -5~+5도
    const badge = (r() < 0.18) ? true : false;

    // 타입별 내부 파라미터
    let params = {};
    if (type === 'sentinel') {
        params = {
            frame: 'rect', dash: true,
            triH: 0.55 + r() * 0.08, // 역삼각 키
        };
    } else if (type === 'swarm') {
        params = {
            dots: (isBoss ? 7 : 3 + Math.floor(r() * 3)), // 3~5, 보스 7
            radius: 7 + Math.floor(r() * 9)
        };
    } else if (type === 'obelisk') {
        params = {
            pillarW: 0.28 + r() * 0.08,
            eye: true,
            rings: isBoss ? 3 : 1 + Math.floor(r() * 2)
        };
    } else if (type === 'orbiter') {
        params = {
            coreR: 0.22 + r() * 0.06,
            sats: (isBoss ? 4 : 2 + Math.floor(r() * 2)) // 2~3, 보스 4
        };
    }

    return { type, baseH, sat, lig, strokeStyle, tiltDeg, badge, params, isBoss };
}

/* 적 SVG 생성 */
function _hsl(h = 200, s = 60, l = 28) { return `hsl(${h},${s}%,${l}%)`; }
function svgDataURLEnemy(cfg, w = 160, h = 160) {
    const { type, baseH, sat, lig, strokeStyle, tiltDeg, badge, params, isBoss } = cfg;

    const bg = _hsl(baseH, Math.max(30, sat - 10), lig);
    const fg = _hsl((baseH + 20) % 360, Math.min(100, sat + 10), Math.min(80, lig + 20));
    const accent = _hsl((baseH + 300) % 360, Math.min(100, sat + 12), Math.min(78, lig + 28));

    const cx = w / 2, cy = h / 2;
    const rot = `transform="rotate(${tiltDeg},${cx},${cy})"`;
    const dash = strokeStyle === 'dash' ? `stroke-dasharray="6 4"` : '';

    let main = '';
    if (type === 'sentinel') {
        const rx = 12, ry = 12;
        const grid = `<rect x="12" y="12" width="${w - 24}" height="${h - 24}" rx="${rx}" ry="${ry}" fill="none" stroke="${fg}" ${dash} opacity=".35"/>`;
        const triH = params.triH || 0.58;
        const p1 = `${cx - (w * 0.28)},${cy + (h * 0.20)}`;
        const p2 = `${cx},${cy - (h * triH * 0.5)}`;
        const p3 = `${cx + (w * 0.28)},${cy + (h * 0.20)}`;
        const tri = `<polygon points="${p1} ${p2} ${p3}" fill="${fg}" opacity="${isBoss ? 0.85 : 0.75}" ${rot}/>`;
        main = grid + tri;
    } else if (type === 'swarm') {
        const n = params.dots || 4, r = params.radius || 10;
        const dots = [];
        for (let i = 0; i < n; i++) {
            const ang = (i / n) * Math.PI * 2;
            const rr = Math.min(w, h) * 0.25 + (i % 2 ? 8 : -8);
            const x = cx + rr * Math.cos(ang);
            const y = cy + rr * Math.sin(ang);
            dots.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${fg}" opacity="${0.7}" ${rot}/>`);
        }
        main = dots.join('');
    } else if (type === 'obelisk') {
        const pw = (params.pillarW || 0.3) * w;
        const rect = `<rect x="${cx - pw / 2}" y="${h * 0.18}" width="${pw}" height="${h * 0.64}" fill="${fg}" opacity="${0.78}" ${rot}/>`;
        const rings = [];
        const ringN = params.rings || 1;
        for (let i = 0; i < ringN; i++) {
            const rr = Math.min(w, h) * (0.28 + i * 0.06);
            rings.push(`<circle cx="${cx}" cy="${cy}" r="${rr}" fill="none" stroke="${accent}" stroke-width="2" opacity="${0.35 - i * 0.06}" ${rot}/>`);
        }
        const eye = params.eye ? `<circle cx="${cx}" cy="${h * 0.36}" r="${8}" fill="${accent}" ${rot}/>` : '';
        main = rect + rings.join('') + eye;
    } else if (type === 'orbiter') {
        const coreR = (params.coreR || 0.24) * Math.min(w, h);
        const core = `<circle cx="${cx}" cy="${cy}" r="${coreR}" fill="${fg}" opacity="${0.82}" ${rot}/>`;
        const sats = params.sats || 2;
        const satEls = [];
        for (let i = 0; i < sats; i++) {
            const ang = (i / sats) * Math.PI * 2;
            const rr = coreR + 20 + (i % 2 ? 6 : -6);
            const x = cx + rr * Math.cos(ang);
            const y = cy + rr * Math.sin(ang);
            satEls.push(`<circle cx="${x}" cy="${y}" r="${8}" fill="${accent}" opacity="0.8" ${rot}/>`);
        }
        main = core + satEls.join('');
    }

    const badgeEl = badge ? `<text x="${w - 16}" y="${16}" font-size="12" text-anchor="end" fill="${accent}" opacity=".65">✴</text>` : '';
    const base = `
  <svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="100%" height="100%" fill="${bg}"/>
    ${main}
    <line x1="${w * 0.15}" y1="${h * 0.85}" x2="${w * 0.85}" y2="${h * 0.85}" stroke="${accent}" stroke-width="3" opacity=".5"/>
    ${badgeEl}
  </svg>`;
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(base);
}

/* 적 스프라이트 적용 */
function renderEnemySprite(seed32, isBoss = false) {
    const cfg = buildEnemySpriteConfig(seed32, isBoss);
    const key = JSON.stringify(cfg);
    if (!_enemySpriteCache.has(key)) {
        _enemySpriteCache.set(key, svgDataURLEnemy(cfg));
    }
    const url = _enemySpriteCache.get(key);
    const el = document.getElementById('enemySprite');
    if (el) el.src = url;
}

/* =========================================
 * Player Sprite System — YOU (INTEGRATED)
 * ========================================= */

/* 캐시: 같은 파라미터면 같은 data URL 재사용 */
const _youSpriteCache = new Map();
const _jsonKey = (o) => JSON.stringify(o);

/* 티어 > 숫자화 + 컬러 보정 유틸 */
function _tierRank(t) { return ({ T1: 1, T2: 2, T3: 3, T4: 4, T5: 5 }[t] || 0); }
function _tierAdjust(hsl, tierN) {
    const [h, s, l] = hsl;
    const s2 = Math.min(100, s + tierN * 2.2);
    const l2 = Math.min(100, l + tierN * 1.4);
    return [h, s2, l2];
}

/* 장비 → 외형 파라미터 매핑 */
function buildSpriteConfigFromEquip() {
    const { weapon, armor, rune } = state.equip || {};
    const eff = getYouStats();
    const youHPmax = eff.HPmax || (state.char?.stats?.HP || 100);
    const youHP = state.char?.hp ?? youHPmax;

    // 무기(공격성)
    const atkPct = weapon?.mods?.atkPct || 0;
    const crit = (weapon?.mods?.crit || 0);
    const spikes = Math.max(4, Math.min(12, 4 + Math.round(atkPct / 5)));
    const polyDash = crit >= 6;

    // 방어(안정감)
    const defVal = armor?.mods?.def || 0;
    const hpVal = armor?.mods?.hp || 0;
    const ringCount = Math.max(0, Math.min(3, Math.round((defVal + hpVal) / 40)));
    const borderPx = Math.max(2, Math.min(6, 2 + Math.round((defVal) / 3)));

    // 룬(오라/잔향)
    const echo = rune?.mods?.echo || 0;
    const auraAlpha = Math.min(0.45, 0.18 + echo * 0.9);

    // 티어(색감 보정)
    const tierMax = Math.max(_tierRank(weapon?.tier), _tierRank(armor?.tier), _tierRank(rune?.tier));

    // HP 상태색 (저체력 시 붉은 기)
    const lowHP = youHPmax > 0 ? (youHP / youHPmax) < 0.30 : false;
    const hueBase = (state.char?.meta?.hsvAvg?.h ?? 210);
    const baseHSL = [hueBase, 60, 28 + (lowHP ? -2 : 0)];
    const [H, S, L] = _tierAdjust(baseHSL, tierMax);

    return {
        w: 160, h: 160,
        hue: H, sat: S, lig: L,
        spikes, polyDash, ringCount, borderPx,
        auraAlpha,
        lowHP
    };
}
function svgDataURLYou(cfg) {
    const { w, h, hue, sat, lig, spikes, polyDash, ringCount, borderPx, auraAlpha, lowHP } = cfg;

    const bg = _hsl(hue, sat * 0.6, Math.max(10, lig - 2));
    const fg = _hsl((hue + 25) % 360, Math.min(100, sat + 8), Math.min(80, lig + 22));
    const accent = _hsl((hue + 300) % 360, Math.min(100, sat + 12), Math.min(78, lig + 28));
    const ringClr = _hsl(hue, sat, Math.min(90, lig + 36));

    const cx = w / 2, cy = h / 2, r = Math.min(w, h) * 0.28;
    const pts = [];
    for (let i = 0; i < spikes; i++) {
        const a = (i / spikes) * Math.PI * 2;
        const rr = r * (0.92 + 0.08 * Math.sin(i * 1.7));
        pts.push(`${cx + rr * Math.cos(a)},${cy + rr * Math.sin(a)}`);
    }
    const poly = pts.join(' ');

    const rings = [];
    for (let i = 1; i <= ringCount; i++) {
        const rr = (Math.min(w, h) * 0.36) + i * 6;
        rings.push(`<circle cx="${cx}" cy="${cy}" r="${rr}" fill="none" stroke="${ringClr}" stroke-opacity="${0.25 - i * 0.05}" stroke-width="1"/>`);
    }

    const aura = `<circle cx="${cx}" cy="${cy}" r="${Math.min(w, h) * 0.48}" fill="${accent}" opacity="${auraAlpha}"/>`;

    const tint = lowHP
        ? `<rect x="0" y="0" width="${w}" height="${h}" fill="rgba(255,70,70,0.06)"/>`
        : '';

    const dash = polyDash ? `stroke-dasharray="5 4"` : '';
    const body = `<polygon points="${poly}" fill="${fg}" stroke="${accent}" stroke-width="${borderPx}" ${dash} opacity="0.9"/>`;

    const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="100%" height="100%" fill="${bg}"/>
    ${aura}
    ${rings.join('')}
    ${body}
    <line x1="${w * 0.18}" y1="${h * 0.82}" x2="${w * 0.82}" y2="${h * 0.82}" stroke="${accent}" stroke-width="2" opacity=".45"/>
    ${tint}
  </svg>`;

    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}
function renderYouSprite() {
    if (!state.char) return;
    const cfg = buildSpriteConfigFromEquip();
    const key = _jsonKey(cfg);
    if (!_youSpriteCache.has(key)) {
        _youSpriteCache.set(key, svgDataURLYou(cfg));
    }
    const url = _youSpriteCache.get(key);
    const el = document.getElementById('youSprite');
    if (el) el.src = url;
}
/* 전투 진입 시 호출(적 스프라이트는 spawnEnemy에서 처리) */
function setSpritesForBattle() {
    renderYouSprite(); // YOU만 렌더
}

/* -------- 전투 UI/흐름 -------- */
function renderBattleUI() {
    $('#battleStage').hidden = false;
    updateHPBars();
    $('#enemyChips').innerHTML = state.enemy.chips.map(c => `<span class="chip">${c}</span>`).join('');
    state.turnLock = false;
    $('#attackBtn').disabled = false;
}

/* ✅ HP 바 갱신 — 안전화 & YOU 스프라이트 동기화 */
function updateHPBars() {
    if (!state.char) return;

    const eff = getYouStats();
    const you = state.char;

    // 플레이어
    const youMax = Math.max(1, eff?.HPmax || you?.stats?.HP || 1);
    const youPct = Math.max(0, Math.min(100, (you.hp / youMax) * 100));
    const hpYouBar = document.getElementById('hpYou');
    const hpYouTxt = document.getElementById('hpYouTxt');
    if (hpYouBar) hpYouBar.style.width = `${youPct}%`;
    if (hpYouTxt) hpYouTxt.textContent = `HP ${you.hp}/${youMax}`;

    // 적 (존재할 때만)
    const en = state.enemy;
    if (en) {
        const maxHP = Math.max(1, en?.stats?.HP || en?.hp || 1);
        const enPct = Math.max(0, Math.min(100, (en.hp / maxHP) * 100));
        const hpEnBar = document.getElementById('hpEnemy');
        const hpEnTxt = document.getElementById('hpEnemyTxt');
        if (hpEnBar) hpEnBar.style.width = `${enPct}%`;
        if (hpEnTxt) hpEnTxt.textContent = `HP ${en.hp}/${maxHP}`;
    }

    // YOU 스프라이트도 HP/장비 상태 변화에 맞춰 갱신
    renderYouSprite?.();
}

$('#attackBtn').addEventListener('click', () => {
    if (!state.enemy || state.turnLock) return;
    state.turnLock = true;
    $('#attackBtn').disabled = true;

    const eff = getYouStats();
    const you = state.char, en = state.enemy;
    const r = you.rng;

    const basePerHit = softDamageAgainst(eff.ATK, en.stats.DEF);
    const isCrit = (r() * 100) < eff.CRIT;
    const critMul = isCrit ? 1.25 : 1.0;

    let skillMul = 1.0, hits = 1;
    switch (you.stats.skill) {
        case 'Heavy Strike': {
            skillMul = 1.05 + r() * 0.15;
            break;
        }
        case 'Echo Barrage': {
            hits = 2 + Math.floor(r() * 2); // 2~3
            break;
        }
        case 'Fragment Surge': {
            const surge = 1 + Math.min(you.stats.SPD / 500, 0.15);
            skillMul = surge;
            break;
        }
    }

    const vary = n => {
        const v = 0.07 * (r() * 2 - 1);
        return Math.round(n * (1 + v));
    };

    let total = 0;
    for (let i = 0; i < hits; i++) {
        const per = vary(Math.round(basePerHit * skillMul * critMul));
        total += Math.max(1, per);
    }

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

    const dmgBase = Math.max(1, Math.round(en.stats.ATK - eff.DEF * 0.25));
    const randMul = 0.9 + r() * 0.2; // ±10%

    const PRESSURE_K = 0.05;
    const hpPct = Math.max(0, Math.min(1, you.hp / eff.HPmax));
    const pressureMul = 1 + hpPct * PRESSURE_K;

    const final = Math.round(dmgBase * randMul * pressureMul);

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
    if (!state.reviveUsed) {
        state.reviveUsed = true;
        const eff = getYouStats();
        const reviveHP = Math.max(1, Math.floor(eff.HPmax * 0.4));
        state.char.hp = reviveHP;
        state.char.trapDEF = 0;
        state.turnLock = false;
        $('#attackBtn').disabled = false;
        updateHPBars();
        if (window.story) {
            window.story('이번 한 번은 나의 힘으로 너의 소중한 파일을 지켜줄게!', { icon: '✨', duration: 2600, pos: 'center' });
        }
        log('부활: PIXIE 보호 발동 (HP 40% 회복)');
        return;
    }

    log('탈락: 탐사자 다운');

    storyAt('down_fail', '미안… 이번에는 지키지 못했어.', {
        theme: 'pink', autohide: 2200,
        avatar: {
            src: (window.pickPose && window.pickPose('cry', { random: false })) || './assets/pixie/cry.png',
            position: 'left', size: 116, radius: 14, alt: 'PIXIE — 눈물'
        }
    });

    state.turnLock = true;
    $('#attackBtn').disabled = true;
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
// (오래된 openReward 구현은 제거하고, 아래 Vault 버전만 사용)

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
            ? { id: 'patch_m', name: '안정화 패치 M', type: 'heal', amount: 50, desc: '체력 50 회복' }
            : { id: 'patch_s', name: '안정화 패치 S', type: 'heal', amount: 30, desc: '체력 30 회복' };
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
    if (!state.char) { pixieSay('시스템: 소환 전 함정 감지 — 효과는 보류됨.', { tone: 'warn' }); advanceFlow(350); return; }
    const prev = state.char.trapDEF || 0;
    state.char.trapDEF = prev + 1;
    log('함정: 다음 전투에서 DEF -1 (1회)');

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
    const sheet = $('#shopSheet');
    if (sheet) { sheet.hidden = false; sheet.removeAttribute('aria-hidden'); storyAt('shop_open_' + state.floor, '필요한 패치를 고르자. 골드를 너무 아끼면 다음 방이 아플 수 있어.'); }

    const floorBump = Math.max(0, (state.floor - 1)) * 2;

    const slotA = {
        id: 'heal50', name: '안정화 패치(즉시)', desc: 'HP 50 회복',
        cost: 50 + floorBump,
        buy() {
            state.gold -= this.cost;
            state.char.hp = Math.min(getYouStats().HPmax, state.char.hp + 50);
            updateGoldUI(); updateHPBars();
            log(`상점A: ${this.name} 구매 (HP +50, -${this.cost}G)`);
        }
    };
    const slotB = {
        id: 'patch_s', name: '안정화 패치 S', desc: '소모품: 사용 시 HP +30',
        cost: 22 + floorBump,
        buy() {
            state.gold -= this.cost;
            (state.inventory.consum ||= []).push({ id: 'patch_s', name: '안정화 패치 S', type: 'heal', amount: 30, desc: '체력 30 회복' });
            updateGoldUI();
            log(`상점B: ${this.name} 구매 (인벤토리 지급, -${this.cost}G)`);
        }
    };

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
        catch { log('상점 구매 처리 중 오류가 있어.'); }
    };
}

/* ---------- Exit ---------- */
function openExit() {
    const D1 = $('#seedPopupA'), D2 = $('#seedPopupB');
    if (!D1 || !D2) { advanceFlow(300); return; }

    D1.removeAttribute('hidden'); D1.showModal();

    $('#seedOkA').onclick = async () => {
        const f = $('#seedFileA').files?.[0];
        if (!f) return;
        const ab = await f.arrayBuffer();
        state.seeds.path = await safeHashHex(ab);

        D1.close(); D1.setAttribute('hidden', '');
        D2.removeAttribute('hidden'); D2.showModal();
    };

    $('#seedOkB').onclick = async () => {
        const f = $('#seedFileB').files?.[0]; if (!f) return;
        const ab = await f.arrayBuffer();
        state.seeds.env = await safeHashHex(ab);

        D2.close(); D2.setAttribute('hidden', '');

        await buildNextFloor(state.seeds.path, state.seeds.env);

        state.floor += 1;
        state.fidelity = Math.min(5, state.fidelity + 1);

        const fid = $('#fidelity'); if (fid) fid.textContent = 'L' + state.fidelity;

        log('다음 층으로 이동');

        if (state.fidelity >= 5) {
            try {
                const key = computeEndingKey(); // good | normal | bad
                await openEnding(key);
            } catch (e) {
                console.error(e);
                enterRoom(state.map.startNodeId);
            }
            save();
            return;
        }

        enterRoom(state.map.startNodeId);
        save();
    };
}

/* ---------- 공용 UI ---------- */
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
    state.char.powerInit = calcCharPower(stats);
    state.char.powerRef = REF_BASE_POWER;
    state.char.power = state.char.powerInit;

    state.lootProfile = ['lowHigh', 'balanced', 'highLow'][Math.floor(state.char.rng() * 3)];
    state.runId = meta.hash.slice(0, 12);

    setPhase('run');

    storyAt('summoned', `접속 확인. <b>${meta.name}</b>의 잔광이 안정적이야. 탐사가 시작돼.`, {
        theme: 'green', autohide: 2400,
        avatar: {
            src: window.pickPose?.('smile', { random: false }) || './assets/pixie/smile.png',
            position: 'left', size: 118, radius: 16, alt: 'PIXIE — 미소'
        }
    });

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

    card.append(title, msg, btn);
    wrap.appendChild(card);
    document.body.appendChild(wrap);
}

function restartRun() {
    try { localStorage.removeItem(SAVE_KEY); } catch { }
    location.reload();
}

/* ---------- 부트 ---------- */
window.addEventListener('DOMContentLoaded', () => {
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

state.temp ||= {};
state.temp.vault ||= { shards: 0, keys: 0 };
function _vrng() { return (state.char?.rng || Math.random); }

function generateVaultOffers() {
    const r = _vrng();
    const slot = ['weapon', 'armor', 'rune'][Math.floor(r() * 3)];
    const offerA = {
        id: 'vault_eq',
        type: 'equipment',
        name: `메모리 융합 ${slot}`,
        desc: `이미지 업로드로 ${slot}를 생성하고 즉시 장착(이전 장비 자동 분해).`,
        action: async () => {
            const inp = document.createElement('input');
            inp.type = 'file'; inp.accept = 'image/*'; inp.style.display = 'none';
            document.body.appendChild(inp);
            inp.onchange = async (e) => {
                const f = e.target.files?.[0]; inp.remove();
                if (!f) { log('금고: 업로드가 취소되었어.'); return; }
                const meta = await analyzeImage(f);
                const eq = makeEquipmentFromImage(meta, slot, 'reward', state.floor);
                equipAndAutoDisassemble(eq);
                log(`금고 보상: ${eq.tier} ${slot} 장착 완료! [${meta.name}]`);
                consumeVaultPick();
            };
            inp.click();
        }
    };

    const goldGain = 18 + Math.floor((_vrng()() * 1 + state.floor) * 4);
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

    const kits = [
        { id: 'patch_s', name: '안정화 패치 S', type: 'heal', amount: 30, desc: '체력 30 회복' },
        { id: 'patch_m', name: '안정화 패치 M', type: 'heal', amount: 50, desc: '체력 50 회복' },
        { id: 'patch_l', name: '안정화 패치 L', type: 'heal', amount: 100, desc: '체력 100 회복' },
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

function renderVault() {
    const sheet = document.getElementById('vaultSheet');
    const list = document.getElementById('vaultList');
    const picks = document.getElementById('vaultPicksLeft');
    const shards = document.getElementById('vaultShards');
    const keys = document.getElementById('vaultKeys');
    const reroll = document.getElementById('vaultRerollBtn');

    if (!sheet || !list || !picks || !shards || !keys || !reroll) {
        log('오류: 금고 UI 요소를 찾을 수 없어.');
        legacyRewardFallback();
        return;
    }

    const V = state.temp.vault;

    if (!V.offers || !Array.isArray(V.offers) || !V.offers.length) {
        V.offers = generateVaultOffers();
    }

    list.innerHTML = V.offers.map((o, i) => `
    <div class="card" data-idx="${i}" style="display:flex;flex-direction:column;gap:8px;">
      <div style="font-weight:700">${o.name}</div>
      <div class="muted" style="font-size:12px;">${o.desc}</div>
      <button data-pick="${i}" ${V.picksLeft > 0 ? '' : 'disabled'}>
        ${V.picksLeft > 0 ? '선택' : '선택 완료'}
      </button>
    </div>
  `).join('');

    picks.textContent = `남은 선택: ${V.picksLeft}`;
    shards.textContent = `조각: ${V.shards}`;
    keys.textContent = `Keys: ${V.keys}`;

    list.onclick = (e) => {
        const btn = e.target.closest('button[data-pick]');
        if (!btn) return;
        const idx = +btn.dataset.pick;
        const offer = V.offers?.[idx]; if (!offer) return;
        if (V.picksLeft <= 0) { log('금고: 더 이상 선택할 수 없어.'); return; }
        offer.action?.();
    };

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

    sheet.hidden = false;
    sheet.removeAttribute('aria-hidden');
}

function consumeVaultPick() {
    const V = state.temp.vault;
    V.picksLeft = Math.max(0, (V.picksLeft || 0) - 1);
    renderVault();

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

/* 공개 API: Vault 버전 */
function openReward() {
    const V = state.temp.vault;
    if (!('shards' in V)) V.shards = 0;
    if (!('keys' in V)) V.keys = 0;
    V.picksLeft = (V.keys > 0) ? 2 : 1;
    V.offers = generateVaultOffers();
    renderVault();
}

document.querySelector('#vaultSheet .close[data-close="#vaultSheet"]')?.addEventListener('click', () => {
    const sheet = document.getElementById('vaultSheet');
    sheet.setAttribute('hidden', '');
    sheet.setAttribute('aria-hidden', 'true');
    advanceFlow(300);
});

/* ======================
   Story Bubble Hooks
   ====================== */
const _storyCooldown = new Map();
function storyAt(key, text, opts = {}) {
    const now = Date.now();
    const cd = opts.cooldown ?? 1200;
    const last = _storyCooldown.get(key) || 0;
    if (now - last < cd) return;
    _storyCooldown.set(key, now);

    if (typeof window.story === 'function') {
        window.story(text, {
            autohide: opts.autohide ?? 2400,
            theme: opts.theme ?? null,
            onClose: opts.onClose,
            avatar: opts.avatar
        });
    }
}
