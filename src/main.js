/* ================================
   app.js — PIXIE Prototype (Full)
   ================================ */

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

    turnLock: false, // 내/적 턴 진행 중 입력 잠금
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
    setTimeout(() => {
        closeIntro();
    }, 4200);
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

function log(t) {
    const L = $('#log');
    if (L) L.textContent = `[F${state.floor}] ${t}\n` + L.textContent;
}
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
window.onerror = (msg, src, line, col) => {
    const L = $('#log'); if (L) L.textContent = `[ERROR] ${msg} @${line}:${col}\n` + L.textContent;
};

/* xorshift32 */
function makeRNG(seed) {
    let x = seed >>> 0 || 0x12345678;
    return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x >>>= 0; x ^= x << 5; x >>>= 0; return (x >>> 0) / 0xFFFFFFFF; };
}

/* ---------- 브라우저 폴백 ---------- */
async function ensureImageBitmap(file) {
    if (window.createImageBitmap) { try { return await createImageBitmap(file); } catch { } }
    const img = new Image(); img.decoding = 'async'; img.src = URL.createObjectURL(file);
    await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0); URL.revokeObjectURL(img.src);
    return (window.createImageBitmap ? await createImageBitmap(c) : c);
}
function makeCanvas(w, h) {
    try { return new OffscreenCanvas(w, h); }
    catch { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
}

/* ---------- 해시 / 저장 ---------- */
function fnv1aHex(buf) {
    let h = 0x811c9dc5 >>> 0; const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    for (let i = 0; i < u8.length; i++) { h ^= u8[i]; h = Math.imul(h, 0x01000193) >>> 0; }
    let s = ''; for (let i = 0; i < 8; i++) { h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0; s += (h >>> 0).toString(16).padStart(8, '0'); }
    return s.slice(0, 64);
}
async function safeHashHex(arrayBuffer) {
    try {
        if (crypto?.subtle?.digest) {
            const d = await crypto.subtle.digest('SHA-256', arrayBuffer);
            return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join('');
        }
        throw new Error('SubtleCrypto unavailable');
    } catch { return fnv1aHex(arrayBuffer); }
}

function save() {
    const data = { ...state, visited: [...state.visited] };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
}
function load() {
    const raw = localStorage.getItem(SAVE_KEY); if (!raw) return false;
    try { const d = JSON.parse(raw); Object.assign(state, d, { visited: new Set(d.visited) }); return true; }
    catch (e) { console.warn(e); return false; }
}

/* ---------- 이미지 분석 & 스탯 ---------- */
function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = d === 0 ? 0 : max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = Math.round((h * 60 + 360) % 360); const s = max === 0 ? 0 : d / max; const v = max;
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
    const SPD = 10 + (Math.abs(meta.aspect - 1) > 0.6 ? 2 : 0) + ((meta.hsvAvg.h > 200 && meta.hsvAvg.h < 260) ? 2 : (meta.hsvAvg.h < 40 || meta.hsvAvg.h > 330) ? 1 : 0);

    const seed = parseInt(meta.hash.slice(0, 8), 16) >>> 0;
    const rng = makeRNG(seed);
    const CRIT = Math.min(22, Math.round(rng() * 8 + meta.hsvAvg.s * 6 + (meta.lastModified ? 2 : 0)));
    const skills = ['Heavy Strike', 'Echo Barrage', 'Fragment Surge'];
    const skill = skills[Math.floor(rng() * skills.length)];
    return { HP, ATK, DEF, SPD, CRIT, skill };
}

/* ===== 캐릭터 파워 지표 ===== */
function calcCharPower(stats) {
    // 체감 밸런스용 간단 가중합
    const base = stats.HP * 0.22 + stats.ATK * 2.0 + stats.DEF * 1.2 + stats.SPD * 1.0;
    const critB = stats.CRIT * 1.5;
    return Math.round(base + critB);
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
    const p = r(); if (source === 'boss') return p < 0.10 ? 'T5' : p < 0.50 ? 'T4' : 'T3';
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
        final.atkPct = val; final.crit = Math.max(0, Math.round(meta.hsvAvg.s * 6 + (tierKey !== 'T1' ? 3 : 0)));
    } else if (slot === 'armor') {
        final.def = Math.max(t.min.armor.def, Math.round(imgCoef.def * t.mult));
        final.hp = Math.max(t.min.armor.hp, Math.round(imgCoef.hp * t.mult));
    } else if (slot === 'rune') {
        final.echo = Math.round(imgCoef.echo * t.mult * 100) / 100;
    }
    return {
        id: `EQ_${slot}_${meta.hash.slice(0, 6)}`, slot, tier: tierKey, mods: final, from: source,
        sell: t.baseSell + Math.floor(state.floor * 1) + Math.floor(state.char.rng() * t.range)
    };
}
function equipAndAutoDisassemble(eq) {
    const prev = state.equip[eq.slot];
    if (prev) { state.gold += prev.sell; log(`[장비] ${eq.slot} 교체: 이전 ${prev.tier} 분해 (+${prev.sell}G)`); }
    state.equip[eq.slot] = eq; updateGoldUI(); renderEquipUI(); save();
}
function renderEquipUI() {
    const { weapon, armor, rune } = state.equip;
    $('#equipSlots').innerHTML = `
    <div class="card">무기: ${weapon ? `${weapon.tier} ATK+${weapon.mods.atkPct}% CRIT+${weapon.mods.crit || 0}%` : '없음'}</div>
    <div class="card">방어: ${armor ? `${armor.tier} DEF+${armor.mods.def} HP+${armor.mods.hp}` : '없음'}</div>
    <div class="card">룬: ${rune ? `${rune.tier} Echo+${rune.mods.echo}` : '없음'}</div>`;
}
function updateGoldUI() { $('#gold').textContent = `${state.gold}G`; }

/* ---------- 유물 ---------- */
const Relics = {
    R_HINT_A: {
        name: '미약한 통로의 인장', tier: 'T1',
        effect: { type: 'candidate', count: k => 1 + Math.floor(k / 3), prob: k => 1 - Math.pow(1 - 0.35, Math.pow(k, 0.85)) }
    },
    R_HINT_B: {
        name: '길찾는 잔광', tier: 'T2',
        effect: { type: 'depth', depth: k => Math.min(1 + Math.floor(k / 2), 3), bonus: +0.10 }
    },
    R_HINT_C: {
        name: '출구 음영 투시', tier: 'T3',
        effect: { type: 'reveal', prob: k => 1 - Math.pow(1 - 0.22, Math.pow(k, 0.8)) }
    },
    R_HINT_D: {
        name: '아키브 키스톤', tier: 'T4',
        effect: { type: 'shorten', rate: k => 1 - Math.pow(0.85, k) }
    },
    R_HINT_E: {
        name: '지도 제작자의 도장', tier: 'UQ',
        effect: { type: 'structure', weight: k => Math.floor(k / 2) }
    },
};
function addRelic(id, k = 1) { state.relics[id] = (state.relics[id] || 0) + k; log(`[유물] ${Relics[id].name} 스택 ${state.relics[id]}`); renderRelicsUI(); save(); }
function renderRelicsUI() {
    const el = $('#relics');
    el.innerHTML = Object.entries(state.relics).map(([id, k]) => `<div class="card">${Relics[id].name} ×${k}</div>`).join('') || '<div class="card">없음</div>';
}

/* ---------- 맵 ---------- */
async function buildTutorialFloor(seedHex) {
    state.map = {
        id: 'TUT',
        nodes: [
            { id: 'n0', type: 'battle', name: '반향 오염 폴더' },
            { id: 'n1', type: 'event', name: '파편 아카이브' },      // 튜토리얼에도 퍼즐 체험
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
    const N = 10 + Math.floor(r() * 4);
    const types = ['battle', 'battle', 'battle', 'reward', 'trap', 'shop', 'battle', 'event', 'battle', 'boss', 'exit'];
    const nodes = [...Array(N)].map((_, i) => ({ id: 'n' + i, type: types[i % types.length], name: nameOf(types[i % types.length]) }));
    const edges = []; for (let i = 0; i < N - 1; i++) edges.push(['n' + i, 'n' + (i + 1)]);
    state.map = { id: 'F' + (state.floor + 1), nodes, edges, startNodeId: 'n0' };
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
            openEvent();                 // ★ 파편 아카이브
        } else if (state.room.type === 'exit') {
            openExit();
        }
    } else {
        log(`소거된 잔향: ${state.room.name} (이벤트 없음)`);
    }
    save();
}

/* ---- 그래프 유틸 ---- */
function neighbors(nodeId) {
    return state.map.edges
        .filter(([a, b]) => a === nodeId || b === nodeId)
        .map(([a, b]) => a === nodeId ? b : a);
}
function nextUnvisitedNeighbor(fromId) {
    for (const id of neighbors(fromId)) {
        const key = `${state.map.id}:${id}`;
        if (!state.visited.has(key)) return id;
    }
    return null;
}
function advanceFlow(delay = 500) {
    setTimeout(() => {
        const nxt = nextUnvisitedNeighbor(state.room.id);
        if (nxt) {
            enterRoom(nxt);
        } else {
            log('이 분기의 폴더 정리가 끝났어. 지도를 열어 다른 경로를 확인해봐.');
            const ov = document.querySelector('#mapOverlay');
            if (ov) ov.hidden = false;
        }
    }, delay);
}

/* =======================
   Fake Folder Map Overlay
   ======================= */
function isReachable(fromId, toId) { return neighbors(fromId).includes(toId); }
function isVisited(mapId, nodeId) { return state.visited.has(`${mapId}:${nodeId}`); }
function hasRelic(id) { return (state.relics?.[id] || 0) > 0; }
function prettyNodeName(node) {
    const revealed =
        isVisited(state.map.id, node.id) ||
        node.type === 'boss' || node.type === 'shop' || node.type === 'reward' ||
        (node.type === 'exit' && hasRelic('R_HINT_C'));

    const base = revealed ? node.name : '???';
    const icon = isVisited(state.map.id, node.id) ? '📂' : (node.type === 'exit' ? '🡒' : '📁');
    return `${icon} ${base}`;
}
function renderMapOverlay() {
    if (!state.map) return;
    const bc = $('#breadcrumb');
    const cur = state.room?.id || state.map.startNodeId;
    const curName = state.map.nodes.find(n => n.id === cur)?.name || '폴더';
    bc.textContent = `${state.map.id} / ${curName}`;

    const list = document.createElement('ul');
    list.className = 'maplist';

    const seq = state.map.nodes.map(n => n.id);
    for (let i = 0; i < seq.length; i++) {
        const id = seq[i];
        const node = state.map.nodes.find(n => n.id === id);
        const li = document.createElement('li');
        li.dataset.node = id;

        const current = (id === cur);
        const visited = isVisited(state.map.id, id);
        const reachable = isReachable(cur, id) || current;

        li.className = [current ? 'current' : '', visited ? 'visited' : '', reachable ? '' : 'locked'].join(' ').trim();
        const name = prettyNodeName(node);
        li.innerHTML = `
      <span class="label">${name}</span>
      ${i < seq.length - 1 ? '<span class="arrow">⮑</span>' : ''}
      <span class="type">${node.type}</span>
    `;
        list.appendChild(li);
    }

    const host = $('#mapGraph');
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

/* ---------- 전투 ---------- */
function setSpritesForBattle() {
    const youHue = (state.char?.meta?.hsvAvg.h ?? 210);
    const enHue = (youHue + 140) % 360;
    $('#youSprite').src = svgDataURL({ hue: youHue, role: 'you' });
    $('#enemySprite').src = svgDataURL({ hue: enHue, role: 'enemy' });
}

/* ===== 적 스케일 산출 ===== */
function calcEnemyStats(isBoss = false) {
    const base = isBoss
        ? { HP: 170, ATK: 30, DEF: 15, SPD: 7 }
        : { HP: 110, ATK: 12, DEF: 9, SPD: 6 };

    // 층수 스케일(기존 계단식)
    const floorMul = 1 + 0.16 * Math.floor(state.floor / 5);

    // 캐릭터 현재/초기 파워 비율
    const ref = state.char?.powerRef || 220;
    const cur = state.char?.power || ref;
    const ratio = clamp(cur / ref, 0.75, 1.50); // 튐 방지

    // 따라붙기 강도(일반 20%, 보스 35%)
    const alpha = isBoss ? 0.45 : 0.30;

    // 최종 스케일
    const scale = floorMul * (1 + alpha * (ratio - 1));

    // 능력치 분배
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
        stats,
        hp: stats.HP,
        chips: isBoss ? ['과열', '보호막'] : ['과열']
    };
    setSpritesForBattle();
    renderBattleUI();
    log(`적 등장: ${state.enemy.name} HP ${state.enemy.hp} (scaled)`);
}

function renderBattleUI() {
    $('#battleStage').hidden = false;
    updateHPBars();
    $('#enemyChips').innerHTML = state.enemy.chips.map(c => `<span class="chip">${c}</span>`).join('');
    state.turnLock = false;
    $('#attackBtn').disabled = false;
}

function updateHPBars() {
    const you = state.char, en = state.enemy;
    const youPct = Math.max(0, you.hp / you.stats.HP) * 100;
    const enPct = Math.max(0, en.hp / en.stats.HP) * 100;
    $('#hpYou').style.width = `${youPct}%`; $('#hpEnemy').style.width = `${enPct}%`;
    $('#hpYouTxt').textContent = `HP ${you.hp}/${you.stats.HP}`;
    $('#hpEnemyTxt').textContent = `HP ${en.hp}/${en.stats.HP}`;
}

$('#attackBtn').addEventListener('click', () => {
    if (!state.enemy || state.turnLock) return;
    state.turnLock = true;
    $('#attackBtn').disabled = true;

    const you = state.char, en = state.enemy;
    const wep = state.equip.weapon;
    const atkBonus = wep ? Math.round(you.stats.ATK * (wep.mods.atkPct || 0) / 100) : 0;
    const atk = you.stats.ATK + atkBonus;

    const baseDmg = Math.max(1, Math.round(atk - en.stats.DEF * 0.25));
    const r = you.rng;
    const isCrit = (r() * 100) < you.stats.CRIT;
    const critMul = isCrit ? 1.7 : 1.0;

    let skillMul = 1.0, hits = 1;
    switch (you.stats.skill) {
        case 'Heavy Strike': skillMul = 1.1 + r() * 0.3; break;
        case 'Echo Barrage': hits = 2 + Math.floor(r() * 3); break;
        case 'Fragment Surge': skillMul = 1 + you.stats.SPD / 200; break;
    }
    const vary = n => { const v = 0.15 * (r() * 2 - 1); return Math.round(n * (1 + v)); };

    let total = 0;
    for (let i = 0; i < hits; i++) total += vary(Math.round(baseDmg * skillMul * critMul));

    en.hp = Math.max(0, en.hp - total);
    floatDmg(total, '#dmgFloats', false, isCrit);
    log(`공격: ${you.stats.skill} ×${hits} → ${total} 피해 ${isCrit ? '(치명)' : ''}`);
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
    const you = state.char, en = state.enemy;
    const r = state.char.rng;
    const trapDef = state.char.trapDEF ? 1 : 0;
    const defEff = you.stats.DEF - trapDef;
    const dmg = Math.max(1, Math.round(en.stats.ATK - defEff * 0.25));
    const final = Math.round(dmg * (0.9 + r() * 0.2)); // ±10%

    you.hp = Math.max(0, you.hp - final);
    floatDmg(final, '#dmgFloats', true, false);
    if (state.char.trapDEF) { state.char.trapDEF--; log('함정 효과 소거: DEF 페널티 해제'); }
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
    log(`격파: ${state.enemy.name}`); $('#attackBtn').disabled = true;
    const g = 8 + Math.floor(state.char.rng() * 7); state.gold += g; updateGoldUI();
    if (state.room.type === 'boss') { addRelic('R_HINT_A'); }
    state.enemy = null; save();
    advanceFlow(650);
}
function onPlayerDown() { log(`탈락: 탐사자 다운`); $('#attackBtn').disabled = true; }
function floatDmg(n, sel, toYou = false, crit = false) {
    const host = $(sel); const s = document.createElement('div');
    s.className = 'float'; s.textContent = (toYou ? '-' : '') + n;
    s.style.position = 'absolute'; s.style.left = toYou ? '20%' : '70%'; s.style.top = toYou ? '65%' : '25%';
    s.style.fontWeight = crit ? '800' : '600'; s.style.transform = 'translateY(0)'; s.style.transition = 'transform .6s, opacity .6s';
    host.appendChild(s); requestAnimationFrame(() => { s.style.transform = 'translateY(-30px)'; s.style.opacity = '.1'; });
    setTimeout(() => s.remove(), 700);
}

/* =========================
   Memory Wish Puzzle System
   ========================= */
const WishCheck = {
    huge(meta) { // "아주 큰 추억"
        const sizeKB = meta.size / 1024;
        return sizeKB >= 800 || meta.maxSide >= 2000; // 800KB+ 또는 2000px+
    },
    passionate(meta) { // "정열적인(RED)"
        const { h, s, v } = meta.hsvAvg;
        return (h >= 345 || h <= 20) && s >= 0.25 && v >= 0.25;
    },
    sad(meta) { // "슬픈(BLUE)"
        const { h, s } = meta.hsvAvg;
        return h >= 200 && h <= 260 && s >= 0.18;
    },
    squareish(meta) { // "정제된 균형(정사각)"
        return Math.abs(meta.aspect - 1) <= 0.1;
    },
    noisy(meta) { // "거친 입자(대비↑)"
        return meta.contrastStd >= 0.18;
    }
};
const WishLabel = {
    huge: '아주 큰',
    passionate: '정열적인',
    sad: '슬픈',
    squareish: '정제된',
    noisy: '거친'
};
function buildMemoryWish(rng) {
    const pool = ['huge', 'passionate', 'sad', 'squareish', 'noisy'];
    const first = pool[Math.floor(rng() * pool.length)];
    const two = rng() < 0.45; // 45% 확률로 2중 조건
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
    const gold = ok ? (wish.keys.length === 2 ? 24 : 14) : 6; // 실패해도 소액 위로
    const heal = ok ? (wish.keys.length === 2 ? 18 : 10) : 0;
    return { ok, results, gold, heal };
}

/* ---------- 방 이벤트 ---------- */
function openReward() {
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*';
    input.onchange = async e => {
        const f = e.target.files?.[0]; if (!f) return;
        const meta = await analyzeImage(f);
        const slot = ['weapon', 'armor', 'rune'][Math.floor(state.char.rng() * 3)];
        const eq = makeEquipmentFromImage(meta, slot, 'reward', state.floor);
        const msg = `${eq.tier} ${slot} 장착 시 이전 장비는 자동 분해(+${eq.sell}G).\n진행할까요?`;
        if (confirm(msg)) equipAndAutoDisassemble(eq); else log('보상 취소');
    };
    advanceFlow(300);
    input.click();
}

function openEvent() {
    const panel = $('#dialoguePanel');
    const lines = $('#dialogueLines');
    const choices = $('#choiceList');

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

        lines.innerHTML = `
      <p>검증 결과:</p>
      <ul>${detail}</ul>
      <p>${judge.ok ? '완벽해! 로그가 선명해졌어.' : '충분하진 않지만, 몇 조각은 채워졌어.'}</p>
    `;

        state.gold += judge.gold;
        if (judge.heal > 0) {
            state.char.hp = Math.min(state.char.stats.HP, state.char.hp + judge.heal);
        }
        updateGoldUI(); updateHPBars?.();
        log(`아카이브 복원: +${judge.gold}G${judge.heal ? `, HP +${judge.heal}` : ''}`);

        cleanup();
        advanceFlow(450);
    };

    panel.removeAttribute('hidden');

    function cleanup() {
        panel.setAttribute('hidden', '');
        fileInput.remove();
    }
}

function applyTrap() {
    state.char.trapDEF = (state.char.trapDEF || 0) + 1; log('함정: 다음 전투에서 DEF -1 (1회)');
    advanceFlow(350);
}
function openShop() {
    if (state.gold >= 30 && confirm('상점: 30G로 HP 30 회복?')) {
        state.gold -= 30; state.char.hp = Math.min(state.char.stats.HP, state.char.hp + 30);
        updateGoldUI(); updateHPBars(); log('상점: 안정화 패치 적용(HP+30)');
    }
    advanceFlow(300);
}
function openExit() {
    const D1 = $('#seedPopupA'), D2 = $('#seedPopupB');
    D1.removeAttribute('hidden'); D1.showModal();
    $('#seedOkA').onclick = async () => {
        const f = $('#seedFileA').files?.[0]; if (!f) return;
        const ab = await f.arrayBuffer(); state.seeds.path = await safeHashHex(ab);
        D1.close(); D1.setAttribute('hidden', ''); D2.removeAttribute('hidden'); D2.showModal();
    };
    $('#seedOkB').onclick = async () => {
        const f = $('#seedFileB').files?.[0]; if (!f) return;
        const ab = await f.arrayBuffer(); state.seeds.env = await safeHashHex(ab);
        D2.close(); D2.setAttribute('hidden', '');
        await buildNextFloor(state.seeds.path, state.seeds.env);
        state.floor += 1; state.fidelity = Math.min(5, state.fidelity + 1);
        $('#fidelity').textContent = 'L' + state.fidelity;
        log('다음 층으로 이동'); enterRoom(state.map.startNodeId); save();
    };
}

/* ---------- 공용 UI ---------- */
document.addEventListener('click', e => {
    const t = e.target.closest('[data-close]'); if (!t) return;
    const sel = t.getAttribute('data-close'); const el = document.querySelector(sel); if (!el) return;
    if (el.tagName === 'DIALOG' && el.close) el.close();
    el.setAttribute('hidden', '');
});
$('#mapDock')?.addEventListener('click', () => $('#mapOverlay').hidden = false);
$$('.close').forEach(b => b.addEventListener('click', () => {
    const sel = b.getAttribute('data-close'); if (sel) $(sel).hidden = true;
}));

/* ---------- 소환 & 초기화 ---------- */
$('#summonBtn').addEventListener('click', () => $('#fileInput').click());
$('#fileInput').addEventListener('change', async e => {
    const file = e.target.files?.[0]; if (!file) return;
    const meta = await analyzeImage(file);
    const stats = metaToStats(meta);
    const seed = parseInt(meta.hash.slice(0, 8), 16) >>> 0;

    state.char = { meta, stats, hp: stats.HP, rng: makeRNG(seed) };
    state.char.power = calcCharPower(stats);   // ★ 파워 측정
    state.char.powerRef = state.char.power;    // ★ 기준선 고정

    state.lootProfile = ['lowHigh', 'balanced', 'highLow'][Math.floor(state.char.rng() * 3)];
    state.runId = meta.hash.slice(0, 12);

    setPhase('run');

    $('#stats').innerHTML = `
    <div class="tag">ATK ${stats.ATK}</div>
    <div class="tag">DEF ${stats.DEF}</div>
    <div class="tag">SPD ${stats.SPD}</div>
    <div class="tag">CRIT ${stats.CRIT}%</div>
    <div class="tag">Skill ${stats.skill}</div>`;
    $('#tags').innerHTML = `
    <span class="tag">MIME ${meta.type}</span>
    <span class="tag">SIZE ${(meta.size / 1024) | 0}KB</span>
    <span class="tag">HASH ${meta.hash.slice(0, 8)}</span>
    <span class="tag">IMG ${meta.width}×${meta.height}</span>`;
    updateGoldUI();
    log(`탐사자 소환: ${meta.name} / 해시 ${meta.hash.slice(0, 8)}`);
    $('#attackBtn').disabled = true;

    await buildTutorialFloor(meta.hash);
    enterRoom(state.map.startNodeId);
    save();
});

/* ---------- 부트 ---------- */
window.addEventListener('DOMContentLoaded', () => {
    // 모든 오버레이/시트/다이얼로그 강제 닫기
    ['#mapOverlay', '#bagSheet', '#logSheet', '#dialoguePanel'].forEach(sel => {
        const el = $(sel); if (el) el.setAttribute('hidden', '');
    });
    document.querySelectorAll('dialog').forEach(d => { try { d.close(); } catch { } d.setAttribute('hidden', ''); });

    // 인트로 상태로 시작 (업로드 전까지 run으로 바꾸지 않음)
    setPhase('intro');
    $('#battleStage').hidden = true;
    $('#attackBtn').disabled = true;

    // PIXIE 톤의 초기 문구
    $('#roomName').innerHTML = '안녕 ! 나는 P.I.X.I.E (Personal Indexing eXfiltration Interface)야! 탐사를 시작하려면 사진을 불러와줘!';
    $('#roomDesc').textContent = '하단의 “기억을 불러오기”를 눌러 탐사자를 소환해보자!';

    // 인트로 오버레이 — 항상 재생
    try { openIntro(); } catch { openIntro(); }

    // 자동복원 옵션
    if (AUTORESTORE && load() && state.char) {
        setPhase('run');
        const s = state.char.stats, m = state.char.meta;
        $('#stats').innerHTML = `
      <div class="tag">ATK ${s.ATK}</div><div class="tag">DEF ${s.DEF}</div>
      <div class="tag">SPD ${s.SPD}</div><div class="tag">CRIT ${s.CRIT}%</div>
      <div class="tag">Skill ${s.skill}</div>`;
        $('#tags').innerHTML = `
      <span class="tag">MIME ${m.type}</span><span class="tag">SIZE ${(m.size / 1024) | 0}KB</span>
      <span class="tag">HASH ${m.hash.slice(0, 8)}</span><span class="tag">IMG ${m.width}×${m.height}</span>`;
        updateGoldUI(); renderEquipUI(); renderRelicsUI(); log('세션 복원 완료');

        if (state.map && state.room) enterRoom(state.room.id);
        else if (state.map) enterRoom(state.map.startNodeId);
    }
});
