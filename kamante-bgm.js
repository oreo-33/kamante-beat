/* かまんてびーと 共通BGM
   ・全ページで同じ曲が流れます(プログラムで作った曲)
   ・同じフォルダに bgm.mp3 を置くと、そちらを使います(なければ、この曲)
   ・ページを移っても、曲の続きから流れます
   ・ブラウザの決まりで、ページを開いたあと「最初の1回タップ」したときから鳴り始めます */
(function() {
    if (window.__kbgm)return;
    window.__kbgm = 1;
    var SC = document.currentScript, bottom = (SC && SC.getAttribute('data-bottom')) || '16px', side = (SC && SC.getAttribute('data-side')) || 'left';
    var J = function(k, d) {
        try {
            return JSON.parse(localStorage.getItem(k)) || d
        } catch (e) {
            return d
        }
    };
    var enabled = function() {
        return localStorage.getItem('kamanteBgm') !== '0' && J('kamanteSettings', {}).sound !== false
    };
    var ac = null, master = null, silent = null, started = false, vol = .3, duckV = 1, fileAudio = null, useFile = false, fileSeeked = false, next = 0, TEMPO = .62;
    var n = parseInt(sessionStorage.getItem('kamanteBgmN')) || 0;
    var PENT = [293.66, 329.63, 392, 440, 493.88, 587.33, 659.25, 784, 880];
    var MEL = [5, -1, 4, 5, 7, -1, 5, 4, 3, -1, 2, 3, 4, -1, -1, -1, 5, -1, 4, 5, 7, -1, 8, 7, 5, -1, 4, 3, 2, -1, -1, -1];
    var BASS = [73.42, 98, 110, 98];
    // ボタン
    var b = document.createElement('button');
    b.id = 'kbgmBtn';
    b.setAttribute('aria-label', 'BGMのオン・オフ');
    b.style.cssText = 'position:fixed;' + side + ':10px;bottom:calc(env(safe-area-inset-bottom,0px) + ' + bottom + ');width:40px;height:40px;border-radius:50%;border:2px solid rgba(255,255,255,.7);background:rgba(10,8,40,.65);color:#fff;font-size:19px;z-index:90;cursor:pointer;padding:0;line-height:1';

    function setBtn() {
        b.textContent = enabled() ? '🎵' : '🔇'
    }
    setBtn();
    (document.body || document.documentElement).appendChild(b);
    // 曲の音

    function tone(f1, f2, d, type, v, dl) {
        var t = ac.currentTime + dl, o = ac.createOscillator(), g = ac.createGain();
        o.type = type;
        o.frequency.setValueAtTime(f1, t);
        if (f2 !== f1)o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + d);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(v, t + Math.min(.04, d / 3));
        g.gain.exponentialRampToValueAtTime(.0001, t + d);
        o.connect(g);
        g.connect(master);
        o.start(t);
        o.stop(t + d + .05)
    }

    function active() {
        return ac && started && !useFile && enabled() && !document.hidden && ac.state === 'running'
    }

    function tick() {
        if (!active())return;
        var now = ac.currentTime;
        if (next < now - .5)next = now + .05;
        while (next < now + .35) {
            var dl = next - now, i = n % 32, m = MEL[i];
            if (m >= 0) {
                var f = PENT[m];
                tone(f, f * .997, TEMPO * 1.5, 'triangle', .5, dl);
                tone(f * 2, f * 2, .25, 'sine', .12, dl + .01)
            }
            if (i % 8 === 0) {
                var bf = BASS[(i / 8) | 0];
                tone(bf, bf, TEMPO * 7.5, 'sine', .55, dl)
            }
            if (i % 4 === 0)tone(120, 45, .3, 'sine', .7, dl); else if (i % 4 === 2)tone(100, 45, .2, 'sine', .35, dl);
            if (i % 2 === 1)tone(1600, 1100, .04, 'square', .06, dl);
            if (i === 14 || i === 30) {
                tone(1568, 1568, .9, 'sine', .12, dl + .1);
                tone(2093, 2093, .9, 'sine', .08, dl + .25)
            }
            n++;
            next += TEMPO
        }
        try {
            sessionStorage.setItem('kamanteBgmN', n % 32)
        } catch (e) {}
    }
    setInterval(tick, 150);
    // bgm.mp3 があるとき
    try {
        fileAudio = new Audio();
        fileAudio.loop = true;
        fileAudio.preload = 'auto';
        fileAudio.addEventListener('canplaythrough', function() {
            useFile = true;
            syncFile()
            });
        fileAudio.addEventListener('error', function() {
            useFile = false
            });
        fileAudio.addEventListener('timeupdate', function() {
            try {
                sessionStorage.setItem('kamanteBgmT', fileAudio.currentTime)
            } catch (e) {}
            });
        fileAudio.src = 'bgm.mp3'
    } catch (e) {}

    function syncFile() {
        if (!fileAudio || !useFile)return;
        if (started && enabled() && !document.hidden) {
            if (!fileSeeked) {
                fileSeeked = true;
                var t = parseFloat(sessionStorage.getItem('kamanteBgmT'));
                if (t > 0 && isFinite(t)) {
                    try {
                        fileAudio.currentTime = t
                    } catch (e) {}
                }
            }
            fileAudio.volume = Math.min(1, .5 * duckV);
            fileAudio.play().catch(function() {})
        }
        else fileAudio.pause()
    }
    // 開始(最初のタップで)

    function ensure() {
        if (!enabled())return;
        if (!ac) {
            try {
                ac = new (window.AudioContext || window.webkitAudioContext)();
                master = ac.createGain();
                master.gain.value = vol * duckV;
                var cp = ac.createDynamicsCompressor();
                master.connect(cp);
                cp.connect(ac.destination)
            } catch (e) {
                return
            }
        }
        if (ac.state !== 'running')ac.resume().catch(function() {});
        try {
            if (navigator.audioSession)navigator.audioSession.type = 'playback'
        } catch (e) {}
        try {
            if (!silent) {
                silent = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=');
                silent.loop = true;
                silent.volume = .01
            }
            if (silent.paused)silent.play().catch(function() {})
        } catch (e) {}
        started = true;
        syncFile()
    }

    function first() {
        if (started && ac && ac.state === 'running')return;
        ensure()
    }
    ['pointerdown', 'touchstart', 'keydown', 'click'].forEach(function(t) {
        window.addEventListener(t, first, true)
        });
    b.addEventListener('click', function(e) {
        e.stopPropagation();
        var on = localStorage.getItem('kamanteBgm') !== '0' && J('kamanteSettings', {}).sound !== false;
        if (on)localStorage.setItem('kamanteBgm', '0'); else {
            localStorage.setItem('kamanteBgm', '1');
            var s = J('kamanteSettings', {});
            s.sound = true;
            localStorage.setItem('kamanteSettings', JSON.stringify(s));
            ensure()
        }
        setBtn();
        syncFile()
        });
    document.addEventListener('visibilitychange', function() {
        if (ac) {
            if (document.hidden)ac.suspend(); else if (started && enabled())ac.resume()
        }
        syncFile()
        });
    window.KamanteBGM = {
        duck: function(v) {
            duckV = v;
            if (master && ac)master.gain.setTargetAtTime(vol * v, ac.currentTime, .15);
            if (fileAudio)fileAudio.volume = Math.min(1, .5 * v)
        },
        refresh: function() {
            setBtn();
            syncFile()
        }
    };
    // 前のページで始まっていたら、できるだけすぐ再開を試みる
    if (enabled())ensure();
    })();