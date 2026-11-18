export function encodeWav(audio) {
    const channels = Array.from({ length: audio.numberOfChannels }, (_, index) => audio.getChannelData(index));
    const frameBytes = channels.length * 2;
    const payloadBytes = audio.length * frameBytes;
    if (payloadBytes > 0xffffffff - 36) throw new Error('WAV is too large');
    const bytes = new ArrayBuffer(44 + payloadBytes);
    const header = new DataView(bytes);

    header.setUint32(0, 0x52494646); // RIFF
    header.setUint32(4, 36 + payloadBytes, true);
    header.setUint32(8, 0x57415645); // WAVE
    header.setUint32(12, 0x666d7420); // fmt
    header.setUint32(16, 16, true);
    header.setUint16(20, 1, true); // PCM
    header.setUint16(22, channels.length, true);
    header.setUint32(24, audio.sampleRate, true);
    header.setUint32(28, audio.sampleRate * frameBytes, true);
    header.setUint16(32, frameBytes, true);
    header.setUint16(34, 16, true);
    header.setUint32(36, 0x64617461); // data
    header.setUint32(40, payloadBytes, true);

    let position = 44;
    for (let frame = 0; frame < audio.length; frame++) {
        for (const channel of channels) {
            const sample = Math.max(-1, Math.min(1, channel[frame]));
            header.setInt16(position, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
            position += 2;
        }
    }
    return new Blob([bytes], { type: 'audio/wav' });
}
