import { number } from './ui.js';

export const suffix = 'afinavoz';
export const presets = {
    low: { semitones: -5 },
    bright: { semitones: 4 },
    octave: { semitones: 12 },
    original: { semitones: 0 }
};
export const readSettings = () => ({ semitones: number('semitones') });

export function process(audio, { semitones }, context, onProgress) {
    if (semitones === 0) return audio;
    const channels = Array.from({ length: audio.numberOfChannels }, (_, index) => audio.getChannelData(index).slice());
    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL('./pitch-worker.js', import.meta.url));
        worker.onerror = event => {
            worker.terminate();
            reject(new Error(event.message));
        };
        worker.onmessage = ({ data }) => {
            if ('progress' in data) {
                onProgress(data.progress);
                return;
            }
            worker.terminate();
            try {
                if (data.error) throw new Error(data.error);
                const result = context.createBuffer(audio.numberOfChannels, audio.length, audio.sampleRate);
                data.channels.forEach((channel, index) => result.copyToChannel(channel, index));
                resolve(result);
            } catch (error) {
                reject(error);
            }
        };
        worker.postMessage({ channels, semitones }, channels.map(channel => channel.buffer));
    });
}
