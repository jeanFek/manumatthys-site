const body = document.body;
const audio = document.getElementById('background-audio');
const audioControl = document.getElementById('audioControl');
const bgVideo = document.getElementById('bg-video');
const hero = document.querySelector('.hero');
const rgbElements = document.querySelectorAll('.rgb');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- Language (English / Basque) ----------

const LANG_KEY = 'matthys-lang';
const LABELS = {
    en: { play: 'Play', stop: 'Stop' },
    eu: { play: 'Entzun', stop: 'Gelditu' }
};
let lang = 'en';

function setLang(next) {
    lang = next;
    document.documentElement.dataset.lang = next;
    document.documentElement.lang = next;
    try { localStorage.setItem(LANG_KEY, next); } catch (e) { /* private mode: not remembered */ }
    showAudioState();
}

function initialLang() {
    try {
        const saved = localStorage.getItem(LANG_KEY);
        if (saved === 'en' || saved === 'eu') return saved;
    } catch (e) { /* ignore */ }
    return (navigator.language || '').toLowerCase().startsWith('eu') ? 'eu' : 'en';  // Basque browsers get Basque, everyone else English
}

document.querySelectorAll('[data-set-lang]').forEach(btn => {
    btn.addEventListener('click', () => setLang(btn.dataset.setLang));
});

// ---------- Logo size: its box covers 2.5 % of the home screen (half the width and height of the 10 % version) ----------

const LOGO_SHARE = 0.025;
const LOGO_RATIO = 466 / 750;  // width / height of assets/images/logo.svg

function sizeLogo() {
    const w = hero.clientWidth;
    const h = hero.clientHeight;
    if (!w || !h) return;  // page not laid out yet
    // height² × ratio = share × w × h, kept inside the screen on very narrow or very short windows
    const logoH = Math.min(Math.sqrt(LOGO_SHARE * w * h / LOGO_RATIO), h, w / LOGO_RATIO);
    hero.style.setProperty('--logo-h', `${Math.round(logoH)}px`);
}

sizeLogo();
addEventListener('resize', sizeLogo);

// ---------- RGB cycle and moving background ----------

let colorIndex = 0;
const colors = ['red', 'green', 'blue'];

function updateColors() {
    const newColor = colors[colorIndex % colors.length];
    rgbElements.forEach(el => { el.style.color = newColor; });  // logo, icons, menu
    colorIndex++;
}

const BG_JUMP_MS = 100;  // New random background position every 100 milliseconds (same rhythm as the flash)
const BG_RANGE = 15;    // Must match the 15vw / 15vh overflow of #bg in styles.css

function jumpBackground() {
    const offset = () => (Math.random() * 2 - 1) * BG_RANGE;
    body.style.setProperty('--bg-x', `${offset()}vw`);
    body.style.setProperty('--bg-y', `${offset()}vh`);
}

// ---------- Background video: horizontal on wide screens, vertical on tall ones ----------

let entered = false;
let heroVisible = true;

bgVideo.poster = innerHeight > innerWidth ? bgVideo.dataset.posterV : bgVideo.dataset.posterH;

function playBackground() {
    if (reducedMotion || !entered || !heroVisible) return;
    bgVideo.play().catch(() => { /* autoplay refused: the poster stays */ });
}

function pickBackground() {
    const tall = innerHeight > innerWidth;
    const src = tall ? bgVideo.dataset.v : bgVideo.dataset.h;
    if (bgVideo.getAttribute('src') === src) return;
    bgVideo.poster = tall ? bgVideo.dataset.posterV : bgVideo.dataset.posterH;
    bgVideo.src = src;
    playBackground();
}

// The video only runs while the home screen is visible; the top bar shrinks once the content takes over
new IntersectionObserver(([entry]) => {
    heroVisible = entry.isIntersecting;
    body.classList.toggle('past-hero', !heroVisible);
    if (typeof Interactive !== 'undefined') Interactive.setActive(heroVisible);
    if (heroVisible) playBackground(); else bgVideo.pause();
}, { rootMargin: '-80px 0px 0px 0px' }).observe(hero);

// ---------- Entry gate ----------

function enterSite() {
    document.getElementById('warning').remove();
    body.classList.remove('gated');
    entered = true;
    audio.muted = false;  // The click on "Enter" lets the browser start the sound
    audio.play().catch(err => console.log('Audio play failed:', err));
    if (reducedMotion) return;  // static background poster and colours
    setInterval(updateColors, 60);  // Color cycling every 60 milliseconds
    setInterval(jumpBackground, BG_JUMP_MS);
    pickBackground();
    matchMedia('(orientation: portrait)').addEventListener('change', pickBackground);
    if (typeof Interactive !== 'undefined') Interactive.start({ audio, video: bgVideo });  // Hydra + sound effects, started by this tap
}

document.getElementById('enter').addEventListener('click', enterSite);

// ---------- Sound button ----------

function showAudioState() {
    const playing = !audio.paused && !audio.muted;
    audioControl.classList.toggle('playing', playing);  // Square (stop) while playing, triangle (play) otherwise
    audioControl.setAttribute('aria-label', playing ? LABELS[lang].stop : LABELS[lang].play);
}

audioControl.addEventListener('click', () => {
    if (audio.paused || audio.muted) {
        audio.muted = false;
        audio.play().catch(err => console.log('Audio play failed:', err));
    } else {
        audio.pause();
    }
});

audio.addEventListener('play', showAudioState);
audio.addEventListener('pause', showAudioState);
audio.addEventListener('volumechange', showAudioState);

audio.play().catch(err => console.log('Auto-play failed:', err));

// ---------- YouTube videos: nothing is loaded from YouTube until the visitor clicks ----------

document.querySelectorAll('.yt').forEach(btn => {
    btn.addEventListener('click', () => {
        const frame = document.createElement('iframe');
        frame.src = `https://www.youtube-nocookie.com/embed/${btn.dataset.id}?autoplay=1&rel=0`;
        frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
        frame.allowFullscreen = true;
        frame.title = btn.getAttribute('aria-label');
        const box = document.createElement('div');  // a <button> must not contain an iframe
        box.className = `${btn.className} loaded`;
        box.append(frame);
        btn.replaceWith(box);
        audio.pause();  // the background music stops while a video plays
    }, { once: true });
});

setLang(initialLang());
