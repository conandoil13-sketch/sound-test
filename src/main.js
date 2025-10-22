// app-file.js
// File-based RPG: 업로드 파일 -> 캐릭터 생성 -> 전투

// ---------- 유틸 ----------
const $ = id => document.getElementById(id);
const log = txt => { const L = $('log'); if (!L) return; L.textContent += txt + "\n"; L.scrollTop = L.scrollHeight; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ab2hex = buf => { const h = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join(''); return h; };

// 파일의 해시값을 게임에서 사용되는 난수로 변환.>시드값으로 사용
function seedFromHex(hex) {
    // take first 16 chars -> number seed
    const s = parseInt(hex.slice(0, 16), 16) || 123456789;
    let n = BigInt(s);
    return () => {
        // xorshift64*
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

// try to read image dimensions (returns {w,h} or null)
function readImageSize(file) {
    return new Promise(resolve => {
        if (!file.type.startsWith('image/')) return resolve(null);
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            const out = { w: img.naturalWidth, h: img.naturalHeight };
            URL.revokeObjectURL(url);
            resolve(out);
        };
        img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
        img.src = url;
    });
}

// try to read audio duration (returns seconds or null)
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

// ---------- 특징 -> 스탯 매핑 ----------
function featuresToCharacter(feat) {
    // base stats
    const sizeKB = feat.size / 1024;
    const hp = Math.round(clamp(48 + sizeKB / 60, 30, 200)); // 파일 크기 기준
    const def = Math.round(clamp(5 + (sizeKB % 50) / 5, 5, 80));
    const nameFactor = feat.nameLen;
    const imgMaxSide = feat.imageSize ? Math.max(feat.imageSize.w, feat.imageSize.h) : 0;
    const atk = Math.round(clamp(5 + nameFactor * 2 + imgMaxSide / 60, 5, 120));
    const spd = Math.round(clamp(10 + (nameFactor % 10) + ((feat.lastModified || 0) % 7), 5, 90));

    // crit from hash
    const seed = seedFromHex(feat.sha256);
    const crit = Math.round(seed() * 20); // 0~19%

    // special skill pick from seed
    const skillPool = ['Heavy Strike', 'Echo Barrage', 'Fragment Surge']; // Example skills
    const skillIdx = Math.floor(seed() * skillPool.length);
    const skill = skillPool[skillIdx];

    // extra for audio or image
    const extras = {};
    if (feat.audioDuration) {
        extras.audioDuration = feat.audioDuration;
        // lengthier audio -> better combo ability
        extras.combo = Math.min(5, Math.max(1, Math.round(feat.audioDuration / 2)));
    } else extras.combo = 1;

    if (feat.imageSize) {
        extras.imageW = feat.imageSize.w; extras.imageH = feat.imageSize.h;
        // large image -> slight atk boost
        const boost = Math.min(30, Math.floor(Math.max(feat.imageSize.w, feat.imageSize.h) / 200));
        // apply minor boost
        return {
            name: feat.fileName,
            hp, atk: atk + boost, def, spd, crit, skill, extras
        };
    }

    return { name: feat.fileName, hp, atk, def, spd, crit, skill, extras };
}

// ---------- 전투 규칙 ----------
function computeDamage(attacker, defender, seedRandom) {
    // base damage from ATK minus fraction of DEF
    const base = Math.max(1, Math.round(attacker.atk - defender.def * 0.25));
    // critical check
    const isCrit = (seedRandom() * 100) < attacker.crit;
    let dmg = base * (isCrit ? 1.7 : 1.0);

    // skill effects by name (seed-dependent variability)
    if (attacker.skill === 'Heavy Strike') {
        dmg = Math.round(dmg * (1.1 + seedRandom() * 0.3)); // stronger single hit
    } else if (attacker.skill === 'Echo Barrage') {
        // deal multiple small hits, return total
        const hits = 1 + attacker.extras.combo;
        let total = 0;
        for (let i = 0; i < hits; i++) {
            total += Math.round(dmg * (0.35 + seedRandom() * 0.5));
        }
        dmg = total;
    } else if (attacker.skill === 'Fragment Surge') {
        // mix of atk and spd matters
        dmg = Math.round(dmg * (1 + attacker.spd / 200 + seedRandom() * 0.2));
    }

    // minor randomization
    dmg = Math.max(1, Math.round(dmg * (0.85 + seedRandom() * 0.3)));
    return { dmg, isCrit };
}

// Simple enemy generator (random but reproducible via seed)
function generateEnemy(seedRandom, level = 1) {
    const hp = 60 + Math.round(seedRandom() * 140);
    const atk = 8 + Math.round(seedRandom() * 40);
    const def = 3 + Math.round(seedRandom() * 20);
    const spd = 8 + Math.round(seedRandom() * 30);
    const skillPool = ['Claw', 'Spit', 'Rush'];
    const skill = skillPool[Math.floor(seedRandom() * skillPool.length)];
    return { name: 'Feral Shade', hp, atk, def, spd, skill, crit: Math.round(seedRandom() * 10) };
}

// ---------- UI 연결/흐름 ----------
let currentSummon = null;
let currentSeedRandom = Math.random;

async function onSummonFile(file) {
    $('tags').innerHTML = '';
    $('stats').textContent = '';
    log(`>> 파일 분석중: ${file.name}`);
    try {
        const feat = await analyzeFile(file);
        const char = featuresToCharacter(feat);
        // create seedRandom from sha so results reproducible
        currentSeedRandom = seedFromHex(feat.sha256);
        currentSummon = char;
        // render UI
        $('tags').innerHTML = [
            `<span class="tag">MIME:${feat.mime}</span>`,
            `<span class="tag">SIZE:${Math.round(feat.size / 1024)}KB</span>`,
            `<span class="tag">HASH:${feat.sha256.slice(0, 8)}..</span>`,
            feat.imageSize ? `<span class="tag">IMG:${feat.imageSize.w}x${feat.imageSize.h}</span>` : '',
            feat.audioDuration ? `<span class="tag">AUD:${feat.audioDuration.toFixed(1)}s</span>` : ''
        ].join(' ');
        $('stats').textContent = JSON.stringify(char, null, 2);
        // enable attack
        if ($('attackBtn')) $('attackBtn').disabled = false;
        log(`✅ 소환 완료: ${char.name} (HP:${char.hp} ATK:${char.atk} DEF:${char.def} SPD:${char.spd} SKILL:${char.skill})`);
        // spawn enemy
        window.currentEnemy = generateEnemy(currentSeedRandom);
        log(`⚔️ 나타난 적: ${window.currentEnemy.name} (HP:${window.currentEnemy.hp})`);
        updateHPbars();
    } catch (e) {
        log('❌ 분석 실패: ' + (e.message || e));
    }
}

function updateHPbars() {
    if ($('hpYou')) $('hpYou').style.width = (currentSummon ? currentSummon.hp : you.hp) + '%';
    if ($('hpYouTxt')) $('hpYouTxt').textContent = String(currentSummon ? currentSummon.hp : you.hp);
    if ($('hpEnemy')) $('hpEnemy').style.width = (window.currentEnemy ? window.currentEnemy.hp : enemy.hp) + '%';
    if ($('hpEnemyTxt')) $('hpEnemyTxt').textContent = String(window.currentEnemy ? window.currentEnemy.hp : enemy.hp);
}

// attack action (user)
function onPlayerAttack() {
    if (!currentSummon || !window.currentEnemy) { log('소환수 또는 적이 없습니다.'); return; }
    const seedRandom = currentSeedRandom;
    const res = computeDamage(currentSummon, window.currentEnemy, seedRandom);
    window.currentEnemy.hp = Math.max(0, window.currentEnemy.hp - res.dmg);
    log(`🟦 ${currentSummon.name}의 ${currentSummon.skill} → 적에게 ${res.dmg} 피해 ${res.isCrit ? '(CRIT!)' : ''}`);
    updateHPbars();
    if (window.currentEnemy.hp <= 0) {
        log('🏆 적 격파! 승리했습니다.');
        if ($('attackBtn')) $('attackBtn').disabled = true;
        return;
    }
    // enemy retaliate (simple)
    setTimeout(() => {
        const seedR = currentSeedRandom;
        const er = computeDamage(window.currentEnemy, currentSummon, seedR);
        currentSummon.hp = Math.max(0, currentSummon.hp - er.dmg);
        log(`🟥 ${window.currentEnemy.name}의 ${window.currentEnemy.skill} → 당신의 소환수에게 ${er.dmg} 피해 ${er.isCrit ? '(CRIT!)' : ''}`);
        updateHPbars();
        if (currentSummon.hp <= 0) {
            log('💀 당신의 소환수가 파괴되었습니다. 재소환하세요.');
            if ($('attackBtn')) $('attackBtn').disabled = true;
        }
    }, 700 + Math.floor(currentSeedRandom() * 800));
}

// hook file input + buttons (expects certain element ids)
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
});
