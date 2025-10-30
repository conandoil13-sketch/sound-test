// ===== PIXIE Story Bubble (standalone, with avatar) =====
(function () {
    // 1) 호스트 DOM이 없으면 자동 생성 (독립 운용)
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

    const AVATAR_ID = 'storyAvatar';

    function _applyTheme(theme) {
        host.classList.remove('theme-pink', 'theme-green');
        if (theme) host.classList.add(`theme-${theme}`);
    }

    // 아바타(픽시 표정 이미지) 설정/해제
    function _setAvatar(avatar) {
        // avatar: { src, alt?, position?('left'|'bottom'), size?, radius?, className? }
        let img = host.querySelector('#' + AVATAR_ID);

        if (!avatar || !avatar.src) {
            if (img) img.remove();
            host.classList.remove('ava-left', 'ava-bottom', 'with-ava');
            return;
        }

        if (!img) {
            img = document.createElement('img');
            img.id = AVATAR_ID;
            img.decoding = 'async';
            img.loading = 'eager';
            img.draggable = false;
            img.alt = avatar.alt || 'PIXIE';
            img.className = 'story-avatar ' + (avatar.className || '');
            const bubble = host.querySelector('.bubble');
            const p = host.querySelector('#storyText');
            bubble.insertBefore(img, p);
        }

        img.src = avatar.src;
        img.alt = avatar.alt || 'PIXIE';
        img.style.width = (avatar.size ?? 112) + 'px';
        img.style.height = 'auto';
        img.style.borderRadius = (avatar.radius ?? 16) + 'px';

        host.classList.add('with-ava');
        host.classList.remove('ava-left', 'ava-bottom');
        host.classList.add(avatar.position === 'bottom' ? 'ava-bottom' : 'ava-left');
    }

    function _open(msg, {
        autohide = 0,
        theme = null,
        onClose = null,
        closeOnBackdrop = true,
        avatar = null
    } = {}) {
        if (lock || !textEl) return false;

        _applyTheme(theme);
        textEl.innerHTML = msg;
        _setAvatar(avatar);

        host.hidden = false;
        host.removeAttribute('aria-hidden');

        const close = () => {
            if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
            host.setAttribute('hidden', '');
            host.setAttribute('aria-hidden', 'true');
            lock = false;
            document.removeEventListener('keydown', escClose);
            if (closeOnBackdrop) host.removeEventListener('click', backdropClose);
            _setAvatar(null);
            if (typeof onClose === 'function') onClose();
            _drain();
        };

        function escClose(e) { if (e.key === 'Escape') close(); }
        document.addEventListener('keydown', escClose);

        function backdropClose(e) { if (e.target === host) close(); }
        if (closeOnBackdrop) host.addEventListener('click', backdropClose);

        if (closeBtn) {
            closeBtn.onclick = close;
            closeBtn.classList.remove('ghost');
            closeBtn.id = 'storyClose';
        }

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
    /** 단건 표시 */
    function story(msg, opts = {}) {
        if (!_open(msg, opts)) queue.push({ msg, opts });
    }

    /** 여러 개를 순차 표시 */
    function storyQueue(messages = [], { gap = 400, autohide = 0, theme = null } = {}) {
        const normalized = messages.map(m => {
            if (typeof m === 'string') return { text: m, autohide, theme };
            return {
                text: m.text,
                autohide: m.autohide ?? autohide,
                theme: m.theme ?? theme,
                onClose: m.onClose,
                avatar: m.avatar
            };
        });

        const first = normalized.shift();
        if (first) {
            story(first.text, {
                autohide: first.autohide,
                theme: first.theme,
                onClose: () => {
                    let i = 0;
                    const tick = () => {
                        if (i >= normalized.length) return;
                        const it = normalized[i++];
                        setTimeout(() => {
                            story(it.text, {
                                autohide: it.autohide,
                                theme: it.theme,
                                onClose: it.onClose,
                                avatar: it.avatar
                            });
                            tick();
                        }, gap);
                    };
                    tick();
                    if (typeof first.onClose === 'function') first.onClose();
                },
                avatar: first.avatar
            });
        }
    }

    /** 강제 닫기(큐 유지) */
    function closeStory() {
        if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
        host.setAttribute('hidden', '');
        host.setAttribute('aria-hidden', 'true');
        lock = false;
        _setAvatar(null);
    }


    window.story = story;
    window.storyQueue = storyQueue;
    window.closeStory = closeStory;
    window.storySpeak = storySpeak; // 선택 사용
})();
