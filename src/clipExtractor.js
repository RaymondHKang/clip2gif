const MIME_CANDIDATES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4',
];

function pickRecorderMimeType() {
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

function seekVideo(video, time) {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('Could not seek in video.'));
    };
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    if (typeof video.fastSeek === 'function') {
      video.fastSeek(time);
    } else {
      video.currentTime = time;
    }
  });
}

/**
 * Last-resort fallback: record the clip via the browser (real-time, but reliable).
 */
export async function extractClipBrowser(file, start, end, onProgress) {
  const mimeType = pickRecorderMimeType();
  if (!mimeType) {
    throw new Error('Browser cannot extract clip from this large video.');
  }

  const clipDuration = end - start;
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.src = url;
  video.muted = true;
  video.playsInline = true;

  try {
    await new Promise((resolve, reject) => {
      if (video.readyState >= 1) return resolve();
      video.addEventListener('loadedmetadata', resolve, { once: true });
      video.addEventListener('error', () => reject(new Error('Could not read video.')), { once: true });
    });

    onProgress?.('Recording clip in browser…', 15);
    if (start > 0) await seekVideo(video, start);

    const stream = video.captureStream?.() ?? video.mozCaptureStream?.();
    if (!stream) throw new Error('Browser cannot capture video stream.');

    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 });
    const chunks = [];
    const stopAt = end - 0.05;

    return await new Promise((resolve, reject) => {
      let done = false;
      const finish = (err, blob) => {
        if (done) return;
        done = true;
        video.pause();
        if (err) reject(err);
        else resolve(blob);
      };

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.onerror = () => finish(new Error('Clip recording failed.'));
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: mimeType });
        if (blob.size < 512) {
          finish(new Error('Could not extract clip — try H.264 MP4 format.'));
        } else {
          finish(null, blob);
        }
      };

      const onTimeUpdate = () => {
        const pct = Math.min(100, Math.round(((video.currentTime - start) / clipDuration) * 100));
        onProgress?.(`Recording clip… ${pct}%`, 15 + Math.round(pct * 0.1));
        if (video.currentTime >= stopAt) {
          video.removeEventListener('timeupdate', onTimeUpdate);
          recorder.stop();
        }
      };

      video.addEventListener('timeupdate', onTimeUpdate);
      recorder.start(200);
      video.play().catch(() =>
        finish(new Error('Browser cannot play this video. Try H.264 MP4 instead of HEVC/H.265.')),
      );
    });
  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute('src');
    video.load();
  }
}

export const BROWSER_EXTRACT_THRESHOLD = 100 * 1024 * 1024;
