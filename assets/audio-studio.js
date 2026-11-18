import { announce, bindControls, bindFileInput, byId, copy, download, filename, formatTime, setFileName } from './ui.js';
import { encodeWav } from './wav.js';
import { presets, process, readSettings, suffix } from './effect.js';

const player = byId('player');
const canvas = byId('preview');
const controls = byId('settings');
const preview = byId('listen');
const save = byId('save');
let context;
let track;
let busy = false;
let prepared;
let playerUrl;
let waveform;

function setPlayerSource(source, time = 0) {
    if (playerUrl) URL.revokeObjectURL(playerUrl);
    playerUrl = URL.createObjectURL(source);
    player.src = playerUrl;
    player.load();
    if (time > 0) player.currentTime = time;
}

function setBusy(value) {
    busy = value;
    byId('file').disabled = value;
    controls.disabled = value;
    preview.disabled = value || !track;
    save.disabled = value || !track;
    byId('studio').dataset.busy = String(value);
}

function peaks(buffer) {
    const channel = buffer.getChannelData(0);
    return Array.from({ length: 180 }, (_, index) => {
        const start = Math.floor(index / 180 * channel.length);
        const end = Math.floor((index + 1) / 180 * channel.length);
        let peak = 0;
        for (let frame = start; frame < end; frame += Math.max(1, Math.floor((end - start) / 180))) {
            peak = Math.max(peak, Math.abs(channel[frame]));
        }
        return peak;
    });
}

function draw() {
    const drawing = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    drawing.clearRect(0, 0, width, height);
    const bars = 128;
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    const position = player.duration ? player.currentTime / player.duration : 0;
    for (let index = 0; index < bars; index++) {
        const fraction = index / (bars - 1);
        const sketch = Math.sin(Math.PI * fraction) ** .73 * (.12 + .78 * Math.abs(Math.sin(index * .19) * Math.cos(index * 1.31)));
        const amplitude = waveform ? Math.sqrt(waveform[Math.round(fraction * (waveform.length - 1))]) : sketch;
        const bar = Math.max(3, Math.min(1, amplitude) * height * .82);
        drawing.globalAlpha = waveform && fraction <= position ? 1 : track ? .64 : .41;
        drawing.fillStyle = accent;
        drawing.fillRect(22 + index * (width - 44) / bars, (height - bar) / 2, 3.2, bar);
    }
    drawing.globalAlpha = 1;
}

async function load(file) {
    if (busy) return;
    setBusy(true);
    announce(copy('Opening your audio…', 'Abriendo tu audio…'));
    try {
        context ??= new AudioContext();
        const buffer = await context.decodeAudioData(await file.arrayBuffer());
        track = { file, buffer };
        prepared = undefined;
        waveform = peaks(buffer);
        setPlayerSource(file);
        player.hidden = false;
        byId('placeholder').hidden = true;
        setFileName(file, formatTime(buffer.duration) + ' · ' + (buffer.sampleRate / 1000) + ' kHz');
        byId('track-state').textContent = copy('Original', 'Original');
        draw();
        announce('');
    } catch {
        announce(copy('Could not open that audio. Try an MP3 or WAV.', 'No se pudo abrir ese audio. Prueba con un MP3 o WAV.'), true);
    } finally {
        setBusy(false);
    }
}

async function mix() {
    const settings = readSettings();
    const key = JSON.stringify(settings);
    if (prepared?.key === key) return prepared;
    const buffer = await process(track.buffer, settings, context, fraction => {
        announce(copy('Rendering audio', 'Procesando audio') + ' · ' + Math.floor(fraction * 100) + '%');
    });
    prepared = { key, blob: encodeWav(buffer), waveform: peaks(buffer) };
    return prepared;
}

async function perform(action) {
    if (busy || !track) return;
    setBusy(true);
    announce(copy('Rendering your mix…', 'Preparando tu mezcla…'));
    try {
        await new Promise(resolve => setTimeout(resolve, 0));
        const result = await mix();
        if (action === 'save') {
            download(result.blob, filename(track.file, suffix, 'wav'));
            announce(copy('Your WAV is ready. The download has started.', 'Tu WAV está listo. La descarga ha comenzado.'));
        } else {
            const time = player.currentTime || 0;
            waveform = result.waveform;
            setPlayerSource(result.blob, time);
            byId('track-state').textContent = copy('Edited mix', 'Mezcla editada');
            draw();
            try {
                await player.play();
                announce('');
            } catch {
                announce(copy('Your mix is ready. Press play to listen.', 'La mezcla está lista. Dale al play para escucharla.'));
            }
        }
    } catch {
        announce(copy('The mix could not be rendered. Try a shorter file.', 'No se pudo preparar la mezcla. Prueba con un archivo más corto.'), true);
    } finally {
        setBusy(false);
    }
}

for (const button of controls.querySelectorAll('[data-preset]')) {
    button.addEventListener('click', () => {
        for (const [id, value] of Object.entries(presets[button.dataset.preset])) byId(id).value = value;
        controls.dispatchEvent(new Event('input', { bubbles: true }));
    });
}
controls.addEventListener('input', () => {
    const current = JSON.stringify(readSettings());
    for (const button of controls.querySelectorAll('[data-preset]')) {
        button.setAttribute('aria-pressed', String(current === JSON.stringify(presets[button.dataset.preset])));
    }
});
player.addEventListener('timeupdate', draw);
player.addEventListener('loadedmetadata', draw);
preview.addEventListener('click', () => perform('listen'));
save.addEventListener('click', () => perform('save'));
bindFileInput(load);
bindControls();
controls.dispatchEvent(new Event('input', { bubbles: true }));
setBusy(false);
draw();
