// PIXIE 표정 이미지 맵
// 경로는 프로젝트에 맞게 조정하세요.
window.PIXIE_POSES = {
    happy: ["./assets/pixie/happy_01.png"],
    smile: ["./assets/pixie/smile.png"],
    serious: ["./assets/pixie/serious.png"],
    talk: ["./assets/pixie/talk_a.png"],
    surprised: ["./assets/pixie/surprised.png"],
    angry: ["./assets/pixie/angry.png"],
    cry: ["./assets/pixie/tears.png"]
};

window.pickPose = function pickPose(key, { random = false, index = 0 } = {}) {
    const list = (window.PIXIE_POSES && window.PIXIE_POSES[key]) || [];
    if (!list.length) return null;
    const src = random
        ? list[Math.floor(Math.random() * list.length)]
        : list[Math.max(0, Math.min(index, list.length - 1))];
    return src;
};

window.preloadPixiePoses = function preloadPixiePoses() {
    Object.values(window.PIXIE_POSES || {}).flat().forEach(src => {
        const im = new Image();
        im.decoding = 'async';
        im.loading = 'eager';
        im.src = src;
    });
};

window.addEventListener('DOMContentLoaded', () => {
    try { window.preloadPixiePoses(); } catch { }
});
