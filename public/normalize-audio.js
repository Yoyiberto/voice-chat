(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VoiceAudio = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function wavEncodeMono(input, sampleRate) {
    const len = input.length;
    const buffer = new ArrayBuffer(44 + len * 2);
    const view = new DataView(buffer);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); view.setUint32(4, 36 + len * 2, true);
    w(8, 'WAVE'); w(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    w(36, 'data'); view.setUint32(40, len * 2, true);
    for (let i = 0, o = 44; i < len; i++, o += 2) {
      const sample = Math.max(-1, Math.min(1, input[i] || 0));
      view.setInt16(o, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }
    return new Blob([buffer], { type: 'audio/wav' });
  }

  function detectPeak(input) {
    let peak = 0;
    for (let i = 0; i < input.length; i++) {
      const abs = Math.abs(input[i]);
      if (abs > peak) peak = abs;
    }
    return peak;
  }

  function rmsOf(input) {
    let sum = 0;
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
    return Math.sqrt(sum / Math.max(1, input.length));
  }

  function resample(input, fromRate, toRate) {
    const ratio = fromRate / toRate;
    const len = Math.floor(input.length / ratio);
    const out = new Float32Array(len);
    for (let i = 0; i < len; i++) out[i] = input[Math.floor(i * ratio)] || 0;
    return out;
  }

  function mixToMono(channels) {
    if (!channels || channels.length === 0) return new Float32Array(0);
    if (channels.length === 1) return channels[0];
    const len = channels[0].length;
    const out = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      let v = 0;
      for (const ch of channels) v += ch[i] || 0;
      out[i] = v / channels.length;
    }
    return out;
  }

  function decodeBlob(blob, AudioContextCtor) {
    const Ctx = AudioContextCtor || window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return Promise.reject(new Error('AudioContext no disponible'));
    const ctx = new Ctx({ sampleRate: 16000 });
    return (blob.arrayBuffer ? blob.arrayBuffer() : Promise.resolve(blob))
      .then((buffer) => {
        const ab = buffer instanceof ArrayBuffer ? buffer : new Uint8Array(buffer).buffer;
        return ctx.decodeAudioData(ab);
      })
      .then((decoded) => {
        const channels = [];
        for (let i = 0; i < decoded.numberOfChannels; i++) channels.push(decoded.getChannelData(i));
        const mono = mixToMono(channels);
        const targetRate = 16000;
        const data = decoded.sampleRate === targetRate ? mono : resample(mono, decoded.sampleRate, targetRate);
        const peak = detectPeak(data);
        const rms = rmsOf(data);
        ctx.close().catch(() => {});
        return {
          sampleRate: decoded.sampleRate,
          channels: decoded.numberOfChannels,
          durationMs: Math.round((mono.length / decoded.sampleRate) * 1000),
          peak,
          rms,
          data,
        };
      })
      .catch((err) => { try { ctx.close(); } catch {} throw err; });
  }

  function applyGain(input, gain) {
    const out = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) out[i] = input[i] * gain;
    return out;
  }

  function normalizeToPeak(input, targetPeak) {
    const peak = detectPeak(input);
    if (!peak || !Number.isFinite(targetPeak)) return input.slice();
    if (peak >= targetPeak) return applyGain(input, targetPeak / peak);
    return applyGain(input, targetPeak / peak);
  }

  function normalizeAudio(blob, options = {}) {
    const opts = Object.assign({ gain: 1, targetPeak: 0.85 }, options);
    return decodeBlob(blob, opts.AudioContextCtor).then((info) => {
      let data = info.data;
      if (opts.gain && opts.gain !== 1) data = applyGain(data, opts.gain);
      if (opts.targetPeak) data = normalizeToPeak(data, opts.targetPeak);
      return { blob: wavEncodeMono(data, 16000), metrics: info };
    });
  }

  return {
    normalizeAudio,
    decodeBlob,
    wavEncodeMono,
    detectPeak,
    applyGain,
    normalizeToPeak,
    mixToMono,
    resample,
  };
});