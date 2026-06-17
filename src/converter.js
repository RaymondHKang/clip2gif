import { GIFEncoder, quantize, applyPalette } from 'gifenc';

const MAX_CLIP_SECONDS = 60;
const MAX_FILE_BYTES = 1024 * 1024 * 1024;
const WARN_FILE_BYTES = 200 * 1024 * 1024;

function seekVideo(video, time) {
  return new Promise((resolve, reject) => {
    const target = Math.max(0, Math.min(time, video.duration - 0.001));

    if (Math.abs(video.currentTime - target) < 0.04) {
      resolve();
      return;
    }

    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('Failed to seek in video.'));
    };
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };

    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    video.currentTime = target;
  });
}

function even(n) {
  const v = Math.max(2, Math.round(n));
  return v % 2 === 0 ? v : v + 1;
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = (seconds % 60).toFixed(1);
  return mins > 0 ? `${mins}:${secs.padStart(4, '0')}` : `${secs}s`;
}

function sanitizeFilename(name) {
  return name.replace(/\.[^.]+$/, '').replace(/[^\w\-]+/g, '-').slice(0, 60) || 'clip';
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function loadVideo(video, file) {
  const url = URL.createObjectURL(file);
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';

  await new Promise((resolve, reject) => {
    if (video.readyState >= 1) {
      resolve();
      return;
    }
    video.addEventListener('loadedmetadata', () => resolve(), { once: true });
    video.addEventListener('error', () => reject(new Error('Cannot load video. Try H.264 MP4.')), { once: true });
  });

  return url;
}

/**
 * Convert a video clip to GIF by capturing frames in the browser.
 * Works with any video the browser can play — no ffmpeg.wasm required.
 */
export async function convertVideoToGif(file, options, onProgress) {
  const { start, end, width, fps, fast = true, videoEl = null } = options;
  const duration = end - start;

  if (duration <= 0) throw new Error('End time must be after start time.');
  if (duration > MAX_CLIP_SECONDS) {
    throw new Error(`Clips longer than ${MAX_CLIP_SECONDS} seconds are not supported.`);
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`File is too large (${formatBytes(file.size)}). Max is ${formatBytes(MAX_FILE_BYTES)}.`);
  }

  const evenWidth = even(width);
  const maxColors = fast ? 128 : 256;
  const frameCount = Math.max(1, Math.round(duration * fps));
  const frameDelay = Math.round(1000 / fps);

  const video = videoEl ?? document.createElement('video');
  const ownsVideo = !videoEl;
  let objectUrl = null;

  if (ownsVideo) {
    objectUrl = await loadVideo(video, file);
  } else if (video.readyState < 1) {
    await new Promise((resolve, reject) => {
      video.addEventListener('loadedmetadata', () => resolve(), { once: true });
      video.addEventListener('error', () => reject(new Error('Video preview not ready.')), { once: true });
    });
  }

  if (!Number.isFinite(video.duration) || video.duration <= 0) {
    throw new Error('Could not read video duration.');
  }

  const scale = evenWidth / video.videoWidth;
  const evenHeight = even(video.videoHeight * scale);

  const canvas = document.createElement('canvas');
  canvas.width = evenWidth;
  canvas.height = evenHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas is not supported in this browser.');

  const gif = GIFEncoder();

  try {
    onProgress?.('Capturing frames…', 10);

    for (let i = 0; i < frameCount; i++) {
      const time = start + i / fps;
      onProgress?.(
        `Capturing frame ${i + 1} of ${frameCount}…`,
        10 + Math.round(((i + 1) / frameCount) * 85),
      );

      await seekVideo(video, time);
      ctx.drawImage(video, 0, 0, evenWidth, evenHeight);

      const { data } = ctx.getImageData(0, 0, evenWidth, evenHeight);
      const palette = quantize(data, maxColors);
      const index = applyPalette(data, palette);

      gif.writeFrame(index, evenWidth, evenHeight, {
        palette,
        delay: frameDelay,
      });
    }

    onProgress?.('Building GIF…', 98);
    gif.finish();

    const bytes = gif.bytes();
    if (!bytes || bytes.length < 64) {
      throw new Error('GIF was empty. The video may use an unsupported codec (try H.264 MP4).');
    }

    onProgress?.('Done!', 100);

    const baseName = sanitizeFilename(file.name);
    return {
      blob: new Blob([bytes], { type: 'image/gif' }),
      filename: `${baseName}-${Math.round(start)}s-${Math.round(end)}s.gif`,
      sizeLabel: formatBytes(bytes.length),
    };
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

export { formatTime, formatBytes, MAX_CLIP_SECONDS, MAX_FILE_BYTES, WARN_FILE_BYTES };
