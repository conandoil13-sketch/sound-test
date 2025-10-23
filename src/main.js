// app-file.js + world roguelike
// File-based RPG: 업로드 파일 -> 캐릭터 생성 -> 전투 + 시드 기반 가상 폴더 탐험

// ---------- 유틸 ----------
const $ = id => document.getElementById(id);
const log = txt => { const L = $('log'); if (!L) return; L.textContent += txt + "\n"; L.scrollTop = L.scrollHeight; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ab2hex = buf => { const h = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join(''); return h; };

// 파일의 해시값을 게임에서 사용되는 난수로 변환(시드 PRNG)
function seedFromHex(hex) {
    const s = parseInt(hex.slice(0, 16), 16) || 123456789;
    let n = BigInt(s);
    return () => {
        n ^= n << 13n; n ^= n >> 7n; n ^= n << 17n;
        const res = Number(n & 0xffffffffn);
        return (res >>> 0) / 0x100000000;
    };
}

// SHA-256 of ArrayBuffer via SubtleCrypto
async function sha256Hex(arrayBuffer) {
    const digest = await crypto.subtle.digest('SHA-256', arrayBuffer);
    return ab2hex(digest);
}

// 파일을 컴퓨터가 읽을 수 있는 형태로 변환
function readFileArrayBuffer(file) {
    return new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.onerror = e => rej(e);
        fr.readAsArrayBuffer(file);
    });
}

// 이미지 크기
function readImageSize(file) {
    return new Promise(resolve => {
        if (!file.type.startsWith('image/')) return resolve(null);
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => { const out = { w: img.naturalWidth, h: img.naturalHeight }; URL.revokeObjectURL(url); resolve(out); };
        img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
        img.src = url;
    });
}

// 오디오 길이
function readAudioDuration(file) {
    return new Promise(resolve => {
        if (!file.type.startsWith('audio/')) return resolve(null);
        const url = URL.createObjectURL(file);
        const a = new Audio();
        a.preload = 'metadata';
        a.onloadedmetadata = () => { const d = a.duration; URL.revokeObjectURL(url); resolve(d); };
        a.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
        a.src = url;
    });
}

// ---------- 파일 -> 특징 추출 ----------
async function analyzeFile(file) {
    const arr = await readFileArrayBuffer(file);
    const hex = await sha256Hex(arr);
    const imgSize = await readImageSize(file);
    const audioDur = await readAudioDuration(file);

    const nameLen = file.name ? file.name.length : 0;
    const size = file.size || 0;
    const mime = file.type || 'unknown';
    const last = file.lastModified || 0;

    return {
        fileName: file.name,
        mime, size, nameLen, lastModified: last,
        sha256: hex,
        imageSize: imgSize,
        audioDuration: audioDur
    };
}

// ---------- 특징 -> 스탯 매핑 (살짝 완화 버전) ----------
function featuresToCharacter(feat) {
    const sizeKB = feat.size / 1024;
    const nameFactor = feat.nameLen;
    const imgMaxSide = feat.imageSize ? Math.max(feat.imageSize.w, feat.imageSize.h) : 0;

    const hp = Math.round(clamp(48 + sizeKB / 60, 30, 200));
    const def = Math.round(clamp(5 + (sizeKB % 50) / 5, 5, 80));
    const atk = Math.round(clamp(5 + nameFactor * 2 + imgMaxSide / 60, 5, 120));
    const spd = Math.round(clamp(10 + (nameFactor % 10) + ((feat.lastModified || 0) % 7), 5, 90));

    const seed = seedFromHex(feat.sha256);
    const crit = Math.round(seed() * 20); // 0~19%
    const skillPool = ['Heavy Strike', 'Echo Barrage', 'Fragment Surge'];
    const skillIdx = Math.floor(seed() * skillPool.length);
    const skill = skillPool[skillIdx];

    const extras = {};
    if (feat.audioDuration) {
        extras.audioDuration = feat.audioDuration;
        extras.combo = Math.min(5, Math.max(1, Math.round(feat.audioDuration / 2)));
    } else extras.combo = 1;

    if (feat.imageSize) {
        extras.imageW = feat.imageSize.w; extras.imageH = feat.imageSize.h;
        const boost = Math.min(30, Math.floor(Math.max(feat.imageSize.w, feat.imageSize.h) / 200));
        return { name: feat.fileName, hp, atk: atk + boost, def, spd, crit, skill, extras };
    }
    return { name: feat.fileName, hp, atk, def, spd, crit, skill, extras };
}

// ---------- 전투 규칙 ----------
function computeDamage(attacker, defender, seedRandom) {
    const base = Math.max(1, Math.round(attacker.atk - defender.def * 0.25));
    const isCrit = (seedRandom() * 100) < attacker.crit;
    let dmg = base * (isCrit ? 1.7 : 1.0);

    if (attacker.skill === 'Heavy Strike') {
        dmg = Math.round(dmg * (1.1 + seedRandom() * 0.3));
    } else if (attacker.skill === 'Echo Barrage') {
        const hits = 1 + attacker.extras.combo;
        let total = 0;
        for (let i = 0; i < hits; i++) total += Math.round(dmg * (0.35 + seedRandom() * 0.5));
        dmg = total;
    } else if (attacker.skill === 'Fragment Surge') {
        dmg = Math.round(dmg * (1 + attacker.spd / 200 + seedRandom() * 0.2));
    }

    dmg = Math.max(1, Math.round(dmg * (0.85 + seedRandom() * 0.3)));
    return { dmg, isCrit };
}

// ---------- 적 생성 (버프 약간 반영) ----------
function generateEnemy(seedRandom, level = 1) {
    const hp = 60 + Math.round(seedRandom() * 140);  // 60~200
    const atk = 10 + Math.round(seedRandom() * 45);  // 10~55
    const def = 4 + Math.round(seedRandom() * 24);   // 4~28
    const spd = 8 + Math.round(seedRandom() * 30);
    const skillPool = ['Claw', 'Spit', 'Rush'];
    const skill = skillPool[Math.floor(seedRandom() * skillPool.length)];
    const crit = Math.round(seedRandom() * 10);
    return { name: 'Feral Shade', hp, atk, def, spd, skill, crit, extras: { combo: 1 } };
}

// ---------- 월드/루트(가상 폴더) 절차 생성 ----------
let WORLD = null;           // { seedStr, rooms:[{id,label,type,encRate,eventRate,visited}], index }
let currentSummon = null;
let currentSeedRandom = Math.random;

// 방 타입: encounterRate / eventRate 가중치 테이블
const ROOM_TYPES = [
    { key: 'Archive', label: '아카이브', enc: 0.45, evt: 0.35 },
    { key: 'Resonance', label: '진동지대', enc: 0.60, evt: 0.25 },
    { key: 'Lumin', label: '광휘지대', enc: 0.50, evt: 0.30 },
    { key: 'Vault', label: '봉인지대', enc: 0.70, evt: 0.20 }, // 조우 높음
];

// 시드로 길이 D, 각 방 타입/난수 결정
function generateWorld(seedStr) {
    const rnd = seedFromHex(seedStr);
    const depth = 6 + Math.floor(rnd() * 3); // 6~8 방
    const rooms = [];
    for (let i = 0; i < depth; i++) {
        const t = ROOM_TYPES[Math.floor(rnd() * ROOM_TYPES.length)];
        // 층마다 미세 가중(깊을수록 만남↑)
        const encRate = clamp(t.enc + i * 0.03, 0.1, 0.9);
        const evtRate = clamp(t.evt - i * 0.02, 0.05, 0.8);
        rooms.push({
            id: i,
            label: `${t.label} ${i + 1}층`,
            type: t.key,
            encRate, eventRate: evtRate,
            visited: false
        });
    }
    WORLD = { seedStr, rooms, index: 0 };
    renderWorldUI();
    log(`🗂️ 가상 폴더 루트 생성: 깊이 ${rooms.length} (시드:${seedStr.slice(0, 8)}..)`);
}

// 현재 방 표시/버튼 상태
function renderWorldUI() {
    if (!WORLD) return;
    const cur = WORLD.rooms[WORLD.index];
    const info = `현재 위치: ${cur.label} | 타입:${cur.type} | 조우율:${Math.round(cur.encRate * 100)}% | 이벤트:${Math.round(cur.eventRate * 100)}%`;
    $('worldInfo').textContent = info;

    const list = WORLD.rooms.map((r, i) => {
        const here = (i === WORLD.index) ? '🟦' : (r.visited ? '⟪v⟫' : '—');
        return `${here} [${i + 1}] ${r.label} (enc:${Math.round(r.encRate * 100)}%)`;
    }).join('\n');
    $('roomList').textContent = list;

    // 버튼들
    $('enterRoomBtn').disabled = false;
    $('prevRoomBtn').disabled = WORLD.index <= 0;
    $('nextRoomBtn').disabled = WORLD.index >= WORLD.rooms.length - 1;
}

// 방 진입 시 조우/이벤트 판정 → 전투 연결
function enterCurrentRoom() {
    if (!WORLD) { log('월드가 없습니다. 소환 후 월드를 생성하세요.'); return; }
    const r = WORLD.rooms[WORLD.index];
    r.visited = true;

    const roll = currentSeedRandom(); // 결정적 난수
    if (roll < r.encRate) {
        // 전투 조우
        window.currentEnemy = generateEnemy(currentSeedRandom);
        log(`⚠️ 조우 발생! ${r.label}에서 ${window.currentEnemy.name} 등장 (HP:${window.currentEnemy.hp})`);
        updateHPbars();
        // 공격 버튼은 소환 때 이미 활성화됨. 전투는 기존 onPlayerAttack()로 진행
    } else if (roll < r.encRate + r.eventRate) {
        // 간단 이벤트 (힐/버프 중 랜덤)
        const sub = currentSeedRandom();
        if (sub < 0.5) {
            const heal = 5 + Math.round(currentSeedRandom() * 12);
            currentSummon.hp = clamp(currentSummon.hp + heal, 1, 200);
            log(`✨ ${r.label}에서 데이터 파편을 발견! 당신의 소환수가 ${heal} HP 회복.`);
            updateHPbars();
        } else {
            const buff = 2 + Math.round(currentSeedRandom() * 5);
            currentSummon.atk += buff;
            log(`🔧 ${r.label}에서 구조 패턴을 최적화! ATK +${buff}.`);
        }
    } else {
        log(`… ${r.label}은(는) 고요했다. (아무 일도 일어나지 않음)`);
    }
    renderWorldUI();
}

// 이동
function gotoNextRoom() {
    if (!WORLD) return;
    if (WORLD.index < WORLD.rooms.length - 1) {
        WORLD.index++;
        renderWorldUI();
    }
}
function gotoPrevRoom() {
    if (!WORLD) return;
    if (WORLD.index > 0) {
        WORLD.index--;
        renderWorldUI();
    }
}

// ---------- UI 연결/흐름 ----------
async function onSummonFile(file) {
    $('tags').innerHTML = '';
    $('stats').textContent = '';
    log(`>> 파일 분석중: ${file.name}`);
    try {
        const feat = await analyzeFile(file);
        const char = featuresToCharacter(feat);
        currentSeedRandom = seedFromHex(feat.sha256);
        currentSummon = char;

        $('tags').innerHTML = [
            `<span class="tag">MIME:${feat.mime}</span>`,
            `<span class="tag">SIZE:${Math.round(feat.size / 1024)}KB</span>`,
            `<span class="tag">HASH:${feat.sha256.slice(0, 8)}..</span>`,
            feat.imageSize ? `<span class="tag">IMG:${feat.imageSize.w}x${feat.imageSize.h}</span>` : '',
            feat.audioDuration ? `<span class="tag">AUD:${feat.audioDuration.toFixed(1)}s</span>` : ''
        ].join(' ');
        $('stats').textContent = JSON.stringify(char, null, 2);

        if ($('attackBtn')) $('attackBtn').disabled = false;
        if ($('worldGenBtn')) $('worldGenBtn').disabled = false;

        log(`✅ 소환 완료: ${char.name} (HP:${char.hp} ATK:${char.atk} DEF:${char.def} SPD:${char.spd} SKILL:${char.skill})`);
        // 첫 적은 바로 소환하지 않고, 방에 들어가서 조우되도록 변경
        updateHPbars();
    } catch (e) {
        log('❌ 분석 실패: ' + (e.message || e));
    }
}

function updateHPbars() {
    if (!currentSummon) return;
    if ($('hpYou')) $('hpYou').style.width = currentSummon.hp + '%';
    if ($('hpYouTxt')) $('hpYouTxt').textContent = String(currentSummon.hp);
    if (window.currentEnemy) {
        if ($('hpEnemy')) $('hpEnemy').style.width = window.currentEnemy.hp + '%';
        if ($('hpEnemyTxt')) $('hpEnemyTxt').textContent = String(window.currentEnemy.hp);
    }
}

// attack action (user)
function onPlayerAttack() {
    if (!currentSummon) { log('소환수가 없습니다.'); return; }
    if (!window.currentEnemy) { log('적이 없습니다. 방에 진입해 조우를 발생시키세요.'); return; }

    const seedRandom = currentSeedRandom;
    const res = computeDamage(currentSummon, window.currentEnemy, seedRandom);
    window.currentEnemy.hp = Math.max(0, window.currentEnemy.hp - res.dmg);
    log(`🟦 ${currentSummon.name}의 ${currentSummon.skill} → 적에게 ${res.dmg} 피해 ${res.isCrit ? '(CRIT!)' : ''}`);
    updateHPbars();
    if (window.currentEnemy.hp <= 0) {
        log('🏆 적 격파! 승리했습니다.');
        window.currentEnemy = null;
        $('hpEnemy').style.width = '0%';
        $('hpEnemyTxt').textContent = '0';
        return;
    }
    // enemy retaliate
    setTimeout(() => {
        const er = computeDamage(window.currentEnemy, currentSummon, seedRandom);
        currentSummon.hp = Math.max(0, currentSummon.hp - er.dmg);
        log(`🟥 ${window.currentEnemy.name}의 ${window.currentEnemy.skill} → 당신의 소환수에게 ${er.dmg} 피해 ${er.isCrit ? '(CRIT!)' : ''}`);
        updateHPbars();
        if (currentSummon.hp <= 0) {
            log('💀 당신의 소환수가 파괴되었습니다. 재소환하거나 다른 파일로 시도하세요.');
            if ($('attackBtn')) $('attackBtn').disabled = true;
        }
    }, 700 + Math.floor(currentSeedRandom() * 800));
}

// hook
window.addEventListener('DOMContentLoaded', () => {
    const fileInput = $('fileInput');
    const summonBtn = $('summonBtn');
    const attackBtn = $('attackBtn');

    if (fileInput && summonBtn) {
        summonBtn.onclick = () => {
            const f = fileInput.files && fileInput.files[0];
            if (!f) { log('파일을 선택하세요.'); return; }
            onSummonFile(f);
        };
    }
    if (attackBtn) {
        attackBtn.onclick = onPlayerAttack;
        attackBtn.disabled = true;
    }

    // 월드 UI 버튼
    if ($('worldGenBtn')) $('worldGenBtn').onclick = () => {
        if (!currentSummon || !currentSeedRandom) { log('먼저 파일을 소환하세요.'); return; }
        // 같은 파일이면 항상 같은 구조가 나오도록, 캐릭터 해시 일부를 시드로 사용
        generateWorld(currentSummon.name + ':' + $('tags').textContent);
        $('enterRoomBtn').disabled = false;
        $('nextRoomBtn').disabled = false;
        $('prevRoomBtn').disabled = true;
    };
    if ($('enterRoomBtn')) $('enterRoomBtn').onclick = enterCurrentRoom;
    if ($('nextRoomBtn')) $('nextRoomBtn').onclick = gotoNextRoom;
    if ($('prevRoomBtn')) $('prevRoomBtn').onclick = gotoPrevRoom;
});
