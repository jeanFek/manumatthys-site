// Interactive background.
// Hydra (hydra-synth, AGPL-3.0, see assets/vendor/) processes the Sirena glitch video. The mouse, or the tilt of a phone,
// plays the picture AND the music (filter + echo through Web Audio); the music also drives the picture on its own:
// bass, mids, highs and the beat of the track (kicks) push every patch, with or without a visitor.
// Nothing here runs for visitors who prefer reduced motion, and the plain video stays if WebGL or Hydra is unavailable.

const Interactive = (() => {
    const HYDRA_URL = 'assets/vendor/hydra-synth.js';
    const RESOLUTION = 0.7;                 // Hydra pixels per CSS pixel: a little chunky on purpose, and light for phones
    const SWITCH_EVERY = [14000, 24000];    // ms between two automatic changes of patch
    const TILT_RANGE = 25;                  // degrees of tilt to reach the edge of the effect
    const HYDRA_FPS = 70;                   // Hydra skips frames above this: ~60 fps on a 120 Hz screen, every frame on a 60 Hz one
    const AUDIO_STEP = 25;                  // ms between two updates of the sound parameters

    // Shared state, read by the patches and by the audio chain
    //   x, y   position of the pointer / tilt, 0..1 (y up), wanders on its own when nobody plays
    //   e      energy: rises when the visitor moves, falls back to 0 in a few seconds (0 = the music is left untouched)
    //   bass / mid / high   level of each band of the music, 0..1, scaled to the loudest recent passage so any track moves the picture
    //   beat   jumps to 1 on each kick and falls back in a quarter of a second
    //   spin   keeps turning, faster when the highs are loud
    const S = { x: 0.5, y: 0.5, e: 0, bass: 0, mid: 0, high: 0, beat: 0, spin: 0, t: 0 };

    const target = { x: 0.5, y: 0.5 };
    let started = false, active = true, pressed = false, hasInput = false;
    let lastInput = -Infinity, downAt = 0, downPos = null;
    let video, box, audioFx, hydra, synth, sourceReady = false, shown = false;
    let last = 0, nextSwitch = 0, patchIndex = 0, audioAcc = 0;
    const peak = { bass: 0.2, mid: 0.2, high: 0.2 }, floor = { bass: 1, mid: 1, high: 1 };
    let bassAvg = 0, lastBeat = 0;

    // ---------- Input: mouse / finger / tilt ----------

    function setTarget(x, y, deadZone = 0) {
        if (hasInput) {
            const dist = Math.hypot(x - target.x, y - target.y);
            S.e = Math.min(1, S.e + Math.min(Math.max(dist - deadZone, 0), 0.25) * 3);
        }
        hasInput = true;
        target.x = x;
        target.y = y;
        lastInput = performance.now();
    }

    function onPointerMove(e) {
        if (active) setTarget(e.clientX / innerWidth, 1 - e.clientY / innerHeight);
    }

    function onPointerDown(e) {
        if (!active || (e.target.closest && e.target.closest('a, button'))) return;
        pressed = true;  // holding keeps the effect at full
        downAt = performance.now();
        downPos = [e.clientX, e.clientY];
    }

    function onPointerUp(e) {
        if (!pressed) return;
        pressed = false;
        const quick = performance.now() - downAt < 300;
        const still = Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]) < 12;
        if (quick && still) nextPatch();  // a tap changes the patch
    }

    // Phones: the position when the phone is first read counts as "straight", so any way of holding it works.
    let tiltBase = null;

    function onTilt(e) {
        if (!active || e.beta == null || e.gamma == null) return;
        const angle = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
        let x = e.gamma, y = e.beta;
        if (angle === 90) [x, y] = [e.beta, -e.gamma];                          // landscape, turned left
        else if (angle === -90 || angle === 270) [x, y] = [-e.beta, e.gamma];   // landscape, turned right
        if (!tiltBase) tiltBase = { x, y };
        const clamp = v => Math.max(-1, Math.min(1, v));
        setTarget(0.5 + clamp((x - tiltBase.x) / TILT_RANGE) * 0.4, 0.5 - clamp((y - tiltBase.y) / TILT_RANGE) * 0.4, 0.004);
    }

    function askTilt() {
        if (typeof DeviceOrientationEvent === 'undefined') return;
        if (typeof DeviceOrientationEvent.requestPermission !== 'function') {
            addEventListener('deviceorientation', onTilt);
            return;
        }
        // iPhone: the prompt needs a real tap (here, the one on "Enter"). If it is refused as "not a tap", ask again on the next one.
        const ask = () => {
            DeviceOrientationEvent.requestPermission()
                .then(state => {
                    if (state === 'granted') addEventListener('deviceorientation', onTilt);
                    removeEventListener('touchend', ask);
                    removeEventListener('click', ask);
                })
                .catch(() => { /* try again on the next tap */ });
        };
        ask();
        addEventListener('touchend', ask);
        addEventListener('click', ask);
    }

    // ---------- Sound: filter + echo on the background music, and an analyser that listens back ----------

    function createAudioFx(audio) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return null;
        if (navigator.audioSession) navigator.audioSession.type = 'playback';  // iOS: keep playing with the silent switch on
        const ctx = new AudioCtx();
        ctx.resume();

        const lp = ctx.createBiquadFilter();       // the pointer closes / opens the sound
        lp.type = 'lowpass';
        lp.frequency.value = 20000;
        lp.Q.value = 0.7;
        const dry = ctx.createGain();
        const wet = ctx.createGain();              // echo level: 0 until the visitor plays
        wet.gain.value = 0;
        const delay = ctx.createDelay(1);
        delay.delayTime.value = 0.27;
        const feedback = ctx.createGain();
        feedback.gain.value = 0.4;
        const master = ctx.createGain();
        const limiter = ctx.createDynamicsCompressor();  // safety net only: resonance and echo can never get loud
        limiter.threshold.value = -3;
        limiter.knee.value = 0;
        limiter.ratio.value = 20;
        limiter.attack.value = 0.003;
        limiter.release.value = 0.15;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.8;
        analyser.minDecibels = -80;  // the default scale tops out at -30 dB, where this track's bass sits all the time: nothing would move
        analyser.maxDecibels = -10;

        const source = ctx.createMediaElementSource(audio);
        source.connect(lp);
        lp.connect(dry).connect(master);
        lp.connect(delay);
        delay.connect(wet).connect(master);
        delay.connect(feedback).connect(delay);
        master.connect(limiter).connect(ctx.destination);
        source.connect(analyser);  // listens before the filter: closing the sound does not freeze the picture

        // The element's sound now goes through the context: if the browser suspends it (tab switch, call), wake it on the next gesture
        const wake = () => { if (ctx.state !== 'running') ctx.resume(); };
        addEventListener('pointerdown', wake);
        addEventListener('touchend', wake);
        addEventListener('keydown', wake);

        return { ctx, lp, wet, delay, master, analyser, bins: new Uint8Array(analyser.frequencyBinCount) };
    }

    const mean = (a, from, to) => { let s = 0; for (let i = from; i < to; i++) s += a[i]; return s / (to - from) / 255; };

    function updateAudio() {
        if (!audioFx) return;
        const { ctx, lp, wet, delay, master, analyser, bins } = audioFx;
        const now = ctx.currentTime;
        const open = 20000;
        const closed = 200 * Math.pow(60, S.x);  // 200 Hz (left) to 12 kHz (right)
        const cutoff = Math.exp(Math.log(open) + (Math.log(closed) - Math.log(open)) * S.e);
        lp.frequency.setTargetAtTime(cutoff, now, 0.08);
        lp.Q.setTargetAtTime(0.7 + S.e * 2.5, now, 0.08);
        wet.gain.setTargetAtTime(S.e * 0.55, now, 0.08);
        delay.delayTime.setTargetAtTime(0.15 + 0.3 * S.y, now, 0.15);  // the glide of the delay time bends the echo like tape
        master.gain.setTargetAtTime(1 - 0.2 * S.e, now, 0.08);

        analyser.getByteFrequencyData(bins);
        listen('bass', mean(bins, 0, 3));    // ~0 - 500 Hz
        listen('mid', mean(bins, 4, 24));    // ~700 Hz - 4 kHz
        listen('high', mean(bins, 25, 90));  // ~4 - 15 kHz

        // Kick: the bass jumps above its recent average
        const clock = performance.now();
        if (S.bass > 0.35 && S.bass > bassAvg * 1.25 + 0.06 && clock - lastBeat > 170) {
            S.beat = 1;
            lastBeat = clock;
        }
        bassAvg += (S.bass - bassAvg) * 0.08;
    }

    // Band level, 0..1: stretched between the quietest and the loudest recent moments of that band (both adapt slowly),
    // so a loud or a quiet track moves the picture just as much. Fast attack, slower release.
    function listen(band, raw) {
        floor[band] = Math.min(raw, floor[band] + 0.0002);
        peak[band] = Math.max(raw, floor[band] + (peak[band] - floor[band]) * 0.9995);
        const level = Math.min(1, Math.max(0, (raw - floor[band]) / Math.max(peak[band] - floor[band], 0.08)));
        S[band] += (level - S[band]) * (level > S[band] ? 0.6 : 0.2);
    }

    // ---------- Picture: Hydra patches, all driven by S ----------

    const PATCHES = [
        // melt: noise warps the video, a feedback trail smears it; the bass swells the warp, each kick bursts it
        ({ src, noise, s0, o0 }) => src(s0)
            .modulate(noise(() => 2 + S.x * 6 + S.mid * 4, 0.04), () => 0.012 + S.e * 0.25 + S.bass * 0.14 + S.beat * 0.22)
            .blend(src(o0).scale(1.004).rotate(() => (S.x - 0.5) * 0.02).brightness(-0.02), () => 0.55 + S.e * 0.3 - S.beat * 0.3)
            .contrast(() => 1.15 + S.e * 0.3 + S.beat * 0.35)  // the trail darkens a little each frame, so bright passages do not wash out to white
            .out(),
        // kaleidoscope: the pointer sets the mirrors, the music sets the zoom, the spin and the ripple
        ({ src, osc, s0 }) => src(s0)
            .kaleid(() => 2 + Math.round(S.y * 5))
            .rotate(() => S.spin + (S.x - 0.5) * 2)
            .scale(() => 1 + S.bass * 0.35 + S.beat * 0.3)
            .modulateScale(osc(8, 0.1), () => S.e * 0.4 + S.mid * 0.6)
            .out(),
        // blocks: the picture breaks into coarse pixels on each kick and its colours slip with the mids
        ({ src, s0, o0 }) => src(s0)
            .pixelate(() => 40 * Math.pow(30, 1 - Math.max(S.e, S.beat * 0.85)), () => 24 * Math.pow(30, 1 - Math.max(S.e, S.beat * 0.85)))
            .modulateHue(src(o0).scale(1.01), () => 0.3 + S.e * 4 + S.mid * 3 + S.beat * 5)
            .out(),
        // difference: the picture against a displaced copy of itself, pushed by the bass and the kicks
        ({ src, s0 }) => src(s0)
            .diff(src(s0).scrollX(() => 0.01 + S.x * 0.08 + S.bass * 0.12).scale(() => 1.02 + S.e * 0.1 + S.beat * 0.18))
            .add(src(s0), 0.25)
            .saturate(() => 2 + S.high * 2.5)
            .out()
    ];

    function scheduleSwitch() {
        nextSwitch = performance.now() + SWITCH_EVERY[0] + Math.random() * (SWITCH_EVERY[1] - SWITCH_EVERY[0]);
    }

    function nextPatch() {
        if (!synth) return;
        patchIndex = (patchIndex + 1 + Math.floor(Math.random() * (PATCHES.length - 1))) % PATCHES.length;  // never the same twice in a row
        PATCHES[patchIndex](synth);
        scheduleSwitch();
    }

    function loadHydra() {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = HYDRA_URL;
            script.onload = () => (typeof Hydra === 'function' ? resolve() : reject(new Error('Hydra global missing')));
            script.onerror = () => reject(new Error('could not load ' + HYDRA_URL));
            document.head.appendChild(script);
        });
    }

    const canvasSize = () => [Math.round(box.clientWidth * RESOLUTION), Math.round(box.clientHeight * RESOLUTION)];

    function startHydra() {
        const canvas = document.createElement('canvas');
        [canvas.width, canvas.height] = canvasSize();
        box.appendChild(canvas);
        try {
            hydra = new Hydra({
                canvas, makeGlobal: false, autoLoop: false,  // we drive the loop ourselves, to pause it
                detectAudio: false,                          // no microphone: the music is analysed through Web Audio instead
                enableStreamCapture: false, numSources: 1, numOutputs: 2
            });
        } catch (err) {
            canvas.remove();
            throw err;
        }
        synth = hydra.synth;
        synth.fps = HYDRA_FPS;

        const bindVideo = () => { synth.s0.init({ src: video, dynamic: true }); sourceReady = true; };
        if (video.readyState >= 2) bindVideo(); else video.addEventListener('loadeddata', bindVideo, { once: true });

        patchIndex = Math.floor(Math.random() * PATCHES.length);
        PATCHES[patchIndex](synth);
        scheduleSwitch();

        let resizeTimer;
        addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => hydra.setResolution(...canvasSize()), 200);
        });
    }

    // ---------- Loop ----------

    function updateState(dt) {
        S.t += dt;
        S.beat *= Math.exp(-dt * 7);
        S.spin += dt * (0.05 + S.high * 0.5);
        if (pressed) S.e = Math.max(S.e, 0.9);
        S.e = Math.max(0, S.e - dt / (active ? 3.5 : 0.8));  // out of the home screen, the music is released quickly

        const idle = (performance.now() - lastInput) / 1000;
        const wander = Math.min(Math.max((idle - 4) / 4, 0), 1);  // after a few seconds without input, the position drifts on its own
        const tx = target.x + (0.5 + 0.35 * Math.sin(S.t * 0.23) - target.x) * wander;
        const ty = target.y + (0.5 + 0.3 * Math.sin(S.t * 0.31 + 1) - target.y) * wander;
        const k = 1 - Math.exp(-dt * 6);
        S.x += (tx - S.x) * k;
        S.y += (ty - S.y) * k;
    }

    function frame(now) {
        requestAnimationFrame(frame);
        const dt = Math.min(now - last, 100);
        last = now;
        updateState(dt / 1000);
        audioAcc += dt;
        if (audioAcc >= AUDIO_STEP) {
            audioAcc = 0;
            updateAudio();
        }
        if (!synth || !sourceReady || !active || video.readyState < 2) return;
        if (performance.now() > nextSwitch) nextPatch();
        hydra.tick(dt);
        if (!shown) {  // the first picture is out: hand the background over to the canvas
            shown = true;
            box.classList.add('hydra');
        }
    }

    // ---------- Public ----------

    // Call from the click on "Enter": the sound context and the tilt permission both need that tap.
    function start({ audio, video: videoEl }) {
        if (started) return;
        started = true;
        video = videoEl;
        box = document.getElementById('bg');

        try { audioFx = createAudioFx(audio); } catch (err) { console.warn('Sound effects unavailable:', err); }
        askTilt();

        addEventListener('pointermove', onPointerMove, { passive: true });
        addEventListener('pointerdown', onPointerDown, { passive: true });
        addEventListener('pointerup', onPointerUp, { passive: true });
        addEventListener('pointercancel', () => { pressed = false; }, { passive: true });
        addEventListener('orientationchange', () => { tiltBase = null; });

        requestAnimationFrame(now => { last = now; frame(now); });
        loadHydra().then(startHydra).catch(err => console.warn('Hydra unavailable, the plain video stays:', err));
    }

    // The home screen is the playground: out of it, the picture pauses and the music goes back to normal
    function setActive(on) {
        active = on;
        if (!on) pressed = false;
    }

    return { start, setActive, state: S, get audioFx() { return audioFx; }, get patch() { return patchIndex; } };
})();
