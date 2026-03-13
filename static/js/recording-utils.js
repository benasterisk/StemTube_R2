/**
 * Shared recording utilities used by both desktop mixer and mobile app.
 * Pure functions with no framework/mixer dependencies.
 */
class RecordingUtils {

    /**
     * Encode AudioBuffer to WAV blob (16-bit PCM).
     * @param {AudioBuffer} buffer
     * @returns {Blob}
     */
    static audioBufferToWav(buffer) {
        const numChannels = buffer.numberOfChannels;
        const sampleRate = buffer.sampleRate;
        const bitsPerSample = 16;
        const blockAlign = numChannels * bitsPerSample / 8;
        const byteRate = sampleRate * blockAlign;
        const dataLength = buffer.length * blockAlign;
        const headerLength = 44;
        const wavBuffer = new ArrayBuffer(headerLength + dataLength);
        const view = new DataView(wavBuffer);

        RecordingUtils._writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + dataLength, true);
        RecordingUtils._writeString(view, 8, 'WAVE');

        RecordingUtils._writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true); // PCM
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, byteRate, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitsPerSample, true);

        RecordingUtils._writeString(view, 36, 'data');
        view.setUint32(40, dataLength, true);

        const channels = [];
        for (let ch = 0; ch < numChannels; ch++) {
            channels.push(buffer.getChannelData(ch));
        }

        let offset = 44;
        for (let i = 0; i < buffer.length; i++) {
            for (let ch = 0; ch < numChannels; ch++) {
                const sample = Math.max(-1, Math.min(1, channels[ch][i]));
                view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
                offset += 2;
            }
        }

        return new Blob([wavBuffer], { type: 'audio/wav' });
    }

    /** @private */
    static _writeString(view, offset, str) {
        for (let i = 0; i < str.length; i++) {
            view.setUint8(offset + i, str.charCodeAt(i));
        }
    }

    /**
     * Save a recording WAV to the server.
     * @param {Blob} wavBlob
     * @param {string} name
     * @param {number} startOffset
     * @param {string} downloadId
     * @returns {Promise<Object>} Server response with id, name, etc.
     */
    static async saveToServer(wavBlob, name, startOffset, downloadId) {
        const formData = new FormData();
        formData.append('file', wavBlob, 'recording.wav');
        formData.append('name', name);
        formData.append('start_offset', startOffset.toString());
        formData.append('download_id', downloadId);

        const resp = await fetch('/api/recordings', {
            method: 'POST',
            body: formData,
            credentials: 'include',
        });
        if (!resp.ok) throw new Error(`Upload failed: ${resp.status}`);
        return await resp.json();
    }

    /**
     * Fetch recordings metadata from server.
     * @param {string} downloadId
     * @returns {Promise<Array>}
     */
    static async fetchRecordings(downloadId) {
        const resp = await fetch(`/api/recordings/${downloadId}`, {
            credentials: 'include',
        });
        if (!resp.ok) return [];
        const data = await resp.json();
        if (!data.success || !data.recordings) return [];
        return data.recordings;
    }

    /**
     * Delete a recording from the server.
     * @param {string} serverId
     */
    static async deleteFromServer(serverId) {
        await fetch(`/api/recordings/${serverId}`, {
            method: 'DELETE',
            credentials: 'include',
        });
    }

    /**
     * Request server-side de-bleed via Demucs.
     * @param {string} serverId
     * @param {string} stemType - 'vocals'|'bass'|'drums'|'other'
     */
    static async requestDebleed(serverId, stemType) {
        const resp = await fetch(`/api/recordings/${serverId}/debleed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ stem_type: stemType }),
            credentials: 'include',
        });
        if (!resp.ok) throw new Error(`De-bleed request failed: ${resp.status}`);
        return await resp.json();
    }

    /**
     * Get best supported MIME type for MediaRecorder.
     * @returns {string|null}
     */
    static getSupportedMimeType() {
        const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac'];
        for (const t of types) {
            if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t;
        }
        return null;
    }

    /**
     * Estimate recording latency from browser APIs, cached in localStorage.
     * @param {AudioContext} audioContext
     * @returns {number} Latency in seconds
     */
    static estimateLatency(audioContext) {
        const cached = localStorage.getItem('stemtube_mobile_latency');
        if (cached) return parseFloat(cached);

        if (!audioContext) return 0.05;

        const baseLatency = audioContext.baseLatency || 0;
        const outputLatency = audioContext.outputLatency || 0;
        const inputEstimate = baseLatency + 0.01;
        let latency = baseLatency + outputLatency + inputEstimate;
        latency = Math.max(0.02, Math.min(0.2, latency));

        localStorage.setItem('stemtube_mobile_latency', latency.toString());
        console.log(`[RecordingUtils] Estimated latency: ${(latency * 1000).toFixed(1)}ms`);
        return latency;
    }

    /**
     * Apply latency compensation by trimming start of buffer.
     * @param {AudioContext} audioContext
     * @param {AudioBuffer} buffer
     * @param {number} latency - Seconds to trim
     * @returns {AudioBuffer}
     */
    static applyLatencyCompensation(audioContext, buffer, latency) {
        const samplesToTrim = Math.max(0, Math.round(latency * buffer.sampleRate));
        if (samplesToTrim <= 0 || samplesToTrim >= buffer.length) return buffer;

        const newLength = buffer.length - samplesToTrim;
        const newBuffer = audioContext.createBuffer(
            buffer.numberOfChannels, newLength, buffer.sampleRate
        );
        for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
            newBuffer.getChannelData(ch).set(
                buffer.getChannelData(ch).subarray(samplesToTrim)
            );
        }
        return newBuffer;
    }

    /**
     * Decode audio blob with iOS fallback (server-side WAV conversion via ffmpeg).
     * @param {AudioContext} audioContext
     * @param {Blob} blob
     * @returns {Promise<AudioBuffer>}
     */
    static async decodeAudioBlob(audioContext, blob) {
        try {
            const arrayBuffer = await blob.arrayBuffer();
            return await audioContext.decodeAudioData(arrayBuffer);
        } catch (err) {
            console.warn('[RecordingUtils] Direct decode failed, trying server fallback:', err);
            const formData = new FormData();
            formData.append('audio', blob, 'recording.mp4');
            const resp = await fetch('/api/recordings/convert', {
                method: 'POST',
                body: formData,
                credentials: 'include',
            });
            if (!resp.ok) throw new Error(`Server conversion failed: ${resp.status}`);
            const wavBuffer = await resp.arrayBuffer();
            return await audioContext.decodeAudioData(wavBuffer);
        }
    }
}
