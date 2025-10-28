// ===== PIXIE Story Bubble (standalone) =====
(function () {
    // 1) 호스트 DOM이 없으면 자동 생성 (독립 운용용)
    let host = document.getElementById('storyBubble');
    if (!host) {
        host = document.createElement('aside');
        host.id = 'storyBubble';
        host.className = 'story-bubble';
        host.setAttribute('hidden', '');
        host.setAttribute('aria-hidden', 'true');
        host.setAttribute('aria-live', 'polite');
        host.innerHTML = `
      <div class="bubble">
        <div class="pixie-badge">P.I.X.I.E</div>
        <p id="storyText">...</p>
        <button id="storyClose" class="ghost" title="닫기">닫기</button>
      </div>`;
        document.body.appendChild(host);
    }

    const textEl = host.querySelector('#storyText');
    const closeBtn = host.querySelector('#storyClose');

    let lock = false;
    let queue = [];
    let autoTimer = null;

    function _applyTheme(theme) {
        host.classList.remove('theme-pink', 'theme-green');
        if (theme) host.classList.add(`theme-${theme}`);
    }

    function _open(msg, { autohide = 0, theme = null, onClose = null, closeOnBackdrop = true } = {}) {
        if (lock) return false;
        if (!textEl) return false;

        _applyTheme(theme);
        textEl.innerHTML = msg;

        host.hidden = false;
        host.removeAttribute('aria-hidden');

        // 닫기 핸들러
        const close = () => {
            if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
            host.setAttribute('hidden', '');
            host.setAttribute('aria-hidden', 'true');
            lock = false;
            document.removeEventListener('keydown', escClose);
            if (closeOnBackdrop) host.removeEventListener('click', backdropClose);
            if (typeof onClose === 'function') onClose();
            _drain(); // 큐 다음 항목
        };

        // ESC 닫기
        function escClose(e) { if (e.key === 'Escape') close(); }
        document.addEventListener('keydown', escClose);

        // 배경 클릭 닫기
        function backdropClose(e) {
            if (e.target === host) close();
        }
        if (closeOnBackdrop) host.addEventListener('click', backdropClose);

        // 버튼 닫기
        if (closeBtn) {
            closeBtn.onclick = close;
            closeBtn.classList.remove('ghost'); // 스타일 충돌 방지용 (있어도 OK)
            closeBtn.id = 'storyClose';
        }

        // 자동 닫기
        if (autohide > 0) {
            autoTimer = setTimeout(() => { autoTimer = null; close(); }, autohide);
        }

        lock = true;
        return true;
    }

    function _drain() {
        if (lock) return;
        const next = queue.shift();
        if (!next) return;
        _open(next.msg, next.opts);
    }

    // ========== 공개 API ==========
    function story(msg, opts = {}) {
        // 즉시 표시 시도, 실패하면 큐에 적재
        if (!_open(msg, opts)) {
            queue.push({ msg, opts });
        }
    }

    function storyQueue(messages = [], { gap = 400, autohide = 0, theme = null } = {}) {
        // messages: string[] 또는 {text, autohide, theme, onClose}[]
        const normalized = messages.map(m => {
            if (typeof m === 'string') return { text: m, autohide, theme };
            return { text: m.text, autohide: m.autohide ?? autohide, theme: m.theme ?? theme, onClose: m.onClose };
        });

        // 첫 항목은 즉시, 이후는 onClose에서 지연 후 enqueue
        const first = normalized.shift();
        if (first) {
            story(first.text, {
                autohide: first.autohide,
                theme: first.theme,
                onClose: () => {
                    // 나머지를 gap 간격으로 순차 등록
                    let i = 0;
                    const tick = () => {
                        if (i >= normalized.length) return;
                        const it = normalized[i++];
                        setTimeout(() => {
                            story(it.text, { autohide: it.autohide, theme: it.theme, onClose: it.onClose });
                            tick();
                        }, gap);
                    };
                    tick();
                    if (typeof first.onClose === 'function') first.onClose();
                }
            });
        }
    }

    function closeStory() {
        // 강제 닫기 (큐는 유지)
        if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
        host.setAttribute('hidden', '');
        host.setAttribute('aria-hidden', 'true');
        lock = false;
    }

    // 전역 등록
    window.story = story;
    window.storyQueue = storyQueue;
    window.closeStory = closeStory;
})();
