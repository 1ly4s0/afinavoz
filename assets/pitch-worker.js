const frameSize = 2048;
const analysisHop = 256;
const halfFrame = frameSize / 2;
const tau = Math.PI * 2;
const window = Float64Array.from({ length: frameSize }, (_, index) => .5 - .5 * Math.cos(tau * index / frameSize));

function transform(real, imaginary, inverse = false) {
    for (let index = 1, reversed = 0; index < frameSize; index++) {
        let bit = frameSize >> 1;
        while (reversed & bit) {
            reversed ^= bit;
            bit >>= 1;
        }
        reversed ^= bit;
        if (index >= reversed) continue;
        [real[index], real[reversed]] = [real[reversed], real[index]];
        [imaginary[index], imaginary[reversed]] = [imaginary[reversed], imaginary[index]];
    }

    for (let size = 2; size <= frameSize; size *= 2) {
        const step = tau / size * (inverse ? 1 : -1);
        const half = size / 2;
        for (let j = 0; j < half; j++) {
            const cosine = Math.cos(j * step);
            const sine = Math.sin(j * step);
            for (let left = j; left < frameSize; left += size) {
                const right = left + half;
                const r = real[right] * cosine - imaginary[right] * sine;
                const i = real[right] * sine + imaginary[right] * cosine;
                real[right] = real[left] - r;
                imaginary[right] = imaginary[left] - i;
                real[left] += r;
                imaginary[left] += i;
            }
        }
    }
}

function shiftPitch(input, ratio, report) {
    // Stretch with phase continuity, then resample to the exact input length.
    const synthesisHop = Math.round(analysisHop * ratio);
    const stretch = synthesisHop / analysisHop;
    const padding = Math.ceil(halfFrame * stretch) + halfFrame;
    const size = Math.ceil(input.length * stretch) + padding;
    const stretched = new Float32Array(size);
    const weights = new Float32Array(size);
    const real = new Float64Array(frameSize);
    const imaginary = new Float64Array(frameSize);
    const previous = new Float64Array(halfFrame + 1);
    const phases = new Float64Array(halfFrame + 1);
    const lowpass = halfFrame / Math.max(stretch, 1);
    const frames = Math.ceil((input.length + halfFrame) / analysisHop);

    for (let frame = 0; frame <= frames; frame++) {
        const inputStart = frame * analysisHop - halfFrame;
        const outputStart = frame * synthesisHop;
        for (let index = 0; index < frameSize; index++) {
            real[index] = (input[inputStart + index] ?? 0) * window[index];
            imaginary[index] = 0;
        }
        transform(real, imaginary);

        for (let bin = 0; bin <= halfFrame; bin++) {
            const phase = Math.atan2(imaginary[bin], real[bin]);
            const expected = tau * bin * analysisHop / frameSize;
            let deviation = phase - previous[bin] - expected;
            deviation -= tau * Math.round(deviation / tau);
            phases[bin] = frame ? phases[bin] + (expected + deviation) * stretch : phase;
            previous[bin] = phase;

            // Remove frequencies that would alias when the stretched signal is sped up.
            const filter = stretch > 1 ? Math.max(0, Math.min(1, (lowpass - bin) / (lowpass * .08))) : 1;
            const amplitude = Math.hypot(real[bin], imaginary[bin]) * filter;
            real[bin] = amplitude * Math.cos(phases[bin]);
            imaginary[bin] = bin === 0 || bin === halfFrame ? 0 : amplitude * Math.sin(phases[bin]);
            if (bin > 0 && bin < halfFrame) {
                real[frameSize - bin] = real[bin];
                imaginary[frameSize - bin] = -imaginary[bin];
            }
        }
        transform(real, imaginary, true);
        for (let index = 0; index < frameSize && outputStart + index < size; index++) {
            const target = outputStart + index;
            stretched[target] += real[index] / frameSize * window[index];
            weights[target] += window[index] ** 2;
        }
        if (frame % 80 === 0) report(frame / frames);
    }

    const output = new Float32Array(input.length);
    for (let index = 0; index < output.length; index++) {
        const source = halfFrame + index * stretch;
        const left = Math.floor(source);
        const blend = source - left;
        const a = stretched[left] / Math.max(weights[left], 1e-8);
        const b = stretched[left + 1] / Math.max(weights[left + 1], 1e-8);
        output[index] = a + (b - a) * blend;
    }
    return output;
}

self.onmessage = ({ data }) => {
    try {
        const ratio = 2 ** (data.semitones / 12);
        const channels = data.channels.map((channel, index) =>
            shiftPitch(channel, ratio, progress => self.postMessage({ progress: (index + progress) / data.channels.length }))
        );
        let peak = 1;
        for (const channel of channels) {
            for (let index = 0; index < channel.length; index++) peak = Math.max(peak, Math.abs(channel[index]));
        }
        if (peak > 1) {
            for (const channel of channels) {
                for (let index = 0; index < channel.length; index++) channel[index] /= peak;
            }
        }
        self.postMessage({ channels }, channels.map(channel => channel.buffer));
    } catch (error) {
        self.postMessage({ error: error.message });
    }
};
