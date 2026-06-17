const MIME_CANDIDATES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4',
];

function pickRecorderMimeType() {
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

function waitForEvent(target, event) {
  return new Promise((resolve, reject) => {
    const onOk = () => {
      cleanup();
      resolve();
    };
    const onErr = () => {
      cleanup();
      reject(new Error('Video playback failed while extracting clip.'));
    };
    const cleanup = () => {
      target.removeEventListener(event, onOk);
      target.removeEventListener('error', onErr);
    };
    target.addEventListener(event, onOk, { once: true });
    target.addEventListener('error', onErr, { once: true });
  });
}

function seekVideo(video, time) {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('Could not seek in video. The format may not be supported by your browser.'));
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

function loadVideoMetadata(video) {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 1) {
      resolve();
      return;
    }
    video.addEventListener('loadedmetadata', () => resolve(), { once: true });
    video.addEventListener('error', () => reject(new Error('Could not read video file.')), { once: true });
  });
}

/**
 * Extract a clip from a large video using the browser's media APIs.
 * Avoids loading the full source file into ffmpeg.wasm memory.
 */
export async function extractClipBrowser(file, start, end, onProgress) {
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('Your browser does not support clip extraction for large videos.');
  }

  const mimeType = pickRecorderMimeType();
  if (!mimeType) {
    throw new Error('Your browser does not support video recording needed for large files.');
  }

  const clipDuration = end - start;
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';

  try {
    await loadVideoMetadata(video);

    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      throw new Error('Could not determine video duration.');
    }

    onProgress?.('Seeking to clip start…', 14);
    await seekVideo(video, Math.max(0, start));

    const stream =
      typeof video.captureStream === 'function'
        ? video.captureStream()
        : typeof video.mozCaptureStream === 'function'
          ? video.mozCaptureStream()
          : null;

    if (!stream) {
      throw new Error('Your browser cannot capture video for large-file conversion.');
    }

    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 5_000_000,
    });

    const chunks = [];
    const stopAt = end - 0.04;

    const blob = await new Promise((resolve, reject) => {
      let settled = false;
      const fail = (message) => {
        if (settled) return;
        settled = true;
        video.pause();
        if (recorder.state === 'recording') recorder.stop();
        reject(new Error(message));
      };

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };

      recorder.onerror = () => fail('Failed while recording clip from video.');

      recorder.onstop = () => {
        if (settled) return;
        settled = true;
        const result = new Blob(chunks, { type: mimeType });
        if (result.size < 1024) {
          reject(
            new Error(
              'Could not extract clip. Your browser may not support this video codec — try H.264 MP4.',
            ),
          );
          return;
        }
        resolve(result);
      };

      const finish = () => {
        video.pause();
        video.removeEventListener('timeupdate', onTimeUpdate);
        video.removeEventListener('ended', finish);
        if (recorder.state === 'recording') recorder.stop();
      };

      const onTimeUpdate = () => {
        const elapsed = Math.max(0, video.currentTime - start);
        const pct = Math.min(100, Math.round((elapsed / clipDuration) * 100));
        onProgress?.(`Extracting clip… ${pct}%`, 15 + Math.round(pct * 0.12));

        if (video.currentTime >= stopAt) finish();
      };

      video.addEventListener('timeupdate', onTimeUpdate);
      video.addEventListener('ended', finish);
      recorder.start(250);

      video.play().catch(() => {
        fail(
          'Browser cannot play this video (often HEVC/H.265). Re-encode as H.264 MP4 or use a smaller file.',
        );
      });
    });

    onProgress?.('Clip extracted', 28);
    return blob;
  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute('src');
    video.load();
  }
}

export const BROWSER_EXTRACT_THRESHOLD = 100 * 1024 * 1024;
