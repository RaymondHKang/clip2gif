import { FFmpeg, FFFSType } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';

const CORE_VERSION = '0.12.10';
const CORE_BASE = `https://unpkg.com/@ffmpeg/core-mt@${CORE_VERSION}/dist/esm`;
const MAX_CLIP_SECONDS = 60;
const MAX_FILE_BYTES = 1024 * 1024 * 1024;
const WARN_FILE_BYTES = 200 * 1024 * 1024;

let ffmpegInstance = null;
let loadPromise = null;
let lastFfmpegLog = '';

function gifFilter(width, fps, fast) {
  const scale = fast ? 'flags=bilinear' : 'flags=lanczos';
  const colors = fast ? 128 : 256;
  const stats = fast ? 'single' : 'diff';
  const dither = fast ? 'dither=none' : 'dither=bayer:bayer_scale=3';

  return [
    `[0:v]fps=${fps},scale=${width}:-1:${scale},split[a][b]`,
    `[a]palettegen=max_colors=${colors}:stats_mode=${stats}[p]`,
    `[b][p]paletteuse=${dither}`,
  ].join(';');
}

const GIF_FILTER_PRESCALED = (fast) => {
  const colors = fast ? 128 : 256;
  const stats = fast ? 'single' : 'diff';
  const dither = fast ? 'dither=none' : 'dither=bayer:bayer_scale=3';
  return [
    '[0:v]split[a][b]',
    `[a]palettegen=max_colors=${colors}:stats_mode=${stats}[p]`,
    `[b][p]paletteuse=${dither}`,
  ].join(';');
};

async function getFFmpeg(onProgress) {
  if (ffmpegInstance) return ffmpegInstance;

  if (!loadPromise) {
    loadPromise = (async () => {
      const ffmpeg = new FFmpeg();

      ffmpeg.on('log', ({ message }) => {
        lastFfmpegLog = message;
      });

      ffmpeg.on('progress', ({ progress }) => {
        const pct = Math.min(95, 25 + Math.round(progress * 70));
        onProgress?.('Converting to GIF…', pct);
      });

      onProgress?.('Loading converter engine…', 5);

      await ffmpeg.load({
        coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
        workerURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.worker.js`, 'text/javascript'),
      });

      ffmpegInstance = ffmpeg;
      return ffmpeg;
    })();
  }

  return loadPromise;
}

async function runFfmpeg(ffmpeg, args) {
  lastFfmpegLog = '';
  const code = await ffmpeg.exec(['-threads', '0', ...args]);
  if (code !== 0) {
    const hint = lastFfmpegLog ? ` ${lastFfmpegLog.trim()}` : '';
    throw new Error(`Video processing failed.${hint}`);
  }
}

async function deleteQuiet(ffmpeg, name) {
  try {
    await ffmpeg.deleteFile(name);
  } catch {
    /* already removed */
  }
}

async function mountInputFile(ffmpeg, file) {
  const mountPoint = '/source';
  const inputFilename = 'input' + getExtension(file.name);

  try {
    await ffmpeg.createDir(mountPoint);
  } catch {
    /* directory may already exist */
  }

  await ffmpeg.mount(
    FFFSType.WORKERFS,
    { blobs: [{ name: inputFilename, data: file }] },
    mountPoint,
  );

  return { inputPath: `${mountPoint}/${inputFilename}`, mountPoint };
}

async function unmountInputFile(ffmpeg, mountPoint) {
  try {
    await ffmpeg.unmount(mountPoint);
  } catch {
    /* ignore */
  }
  try {
    await ffmpeg.deleteDir(mountPoint);
  } catch {
    /* ignore */
  }
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = (seconds % 60).toFixed(1);
  return mins > 0 ? `${mins}:${secs.padStart(4, '0')}` : `${secs}s`;
}

function sanitizeFilename(name) {
  return name.replace(/\.[^.]+$/, '').replace(/[^\w\-]+/g, '-').slice(0, 60) || 'clip';
}

function getExtension(filename) {
  const ext = filename.split('.').pop()?.toLowerCase();
  const allowed = ['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v', 'ogv'];
  return allowed.includes(ext) ? `.${ext}` : '.mp4';
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function estimateGifBytes(duration, width, fps) {
  const height = Math.round(width * 9 / 16);
  return duration * fps * width * height * 0.15;
}

async function readGifOutput(ffmpeg, outputName, file, start, end) {
  const data = await ffmpeg.readFile(outputName);
  await deleteQuiet(ffmpeg, outputName);

  const baseName = sanitizeFilename(file.name);
  return {
    blob: new Blob([data], { type: 'image/gif' }),
    filename: `${baseName}-${Math.round(start)}s-${Math.round(end)}s.gif`,
    sizeLabel: formatBytes(data.length),
  };
}

async function encodeGif(ffmpeg, inputPath, outputName, trimStart, trimDuration, width, fps, fast, onProgress) {
  onProgress?.('Converting clip to GIF…', 20);

  // -ss before -i = fast seek (critical for large files — no real-time playback)
  try {
    await runFfmpeg(ffmpeg, [
      '-ss', String(trimStart),
      '-t', String(trimDuration),
      '-i', inputPath,
      '-filter_complex', gifFilter(width, fps, fast),
      '-an',
      '-loop', '0',
      outputName,
    ]);
  } catch {
    onProgress?.('Retrying with alternate encoder…', 50);
    const clipName = 'clip.mp4';

    await runFfmpeg(ffmpeg, [
      '-ss', String(trimStart),
      '-t', String(trimDuration),
      '-i', inputPath,
      '-an',
      '-vf', `fps=${fps},scale=${width}:-1:flags=${fast ? 'bilinear' : 'lanczos'}`,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-pix_fmt', 'yuv420p',
      clipName,
    ]);

    await runFfmpeg(ffmpeg, [
      '-i', clipName,
      '-filter_complex', GIF_FILTER_PRESCALED(fast),
      '-an',
      '-loop', '0',
      outputName,
    ]);

    await deleteQuiet(ffmpeg, clipName);
  }
}

/**
 * Convert a video clip to GIF using ffmpeg.wasm.
 */
export async function convertVideoToGif(file, options, onProgress) {
  const { start, end, width, fps, fast = false } = options;
  const duration = end - start;

  if (duration <= 0) {
    throw new Error('End time must be after start time.');
  }
  if (duration > MAX_CLIP_SECONDS) {
    throw new Error(`Clips longer than ${MAX_CLIP_SECONDS} seconds are not supported. Trim to a shorter segment.`);
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`File is too large (${formatBytes(file.size)}). Try a video under ${formatBytes(MAX_FILE_BYTES)}.`);
  }

  const estimated = estimateGifBytes(duration, width, fps);
  if (estimated > 50 * 1024 * 1024) {
    throw new Error(
      'This clip would produce a very large GIF. Lower the width or FPS, or choose a shorter segment.',
    );
  }

  const ffmpeg = await getFFmpeg(onProgress);
  const outputName = 'output.gif';

  onProgress?.('Preparing video…', 10);
  const { inputPath, mountPoint } = await mountInputFile(ffmpeg, file);

  try {
    await encodeGif(ffmpeg, inputPath, outputName, start, duration, width, fps, fast, onProgress);
    onProgress?.('Finalizing…', 98);
    const result = await readGifOutput(ffmpeg, outputName, file, start, end);
    onProgress?.('Done!', 100);
    return result;
  } finally {
    await unmountInputFile(ffmpeg, mountPoint);
  }
}

export { formatTime, formatBytes, MAX_CLIP_SECONDS, MAX_FILE_BYTES, WARN_FILE_BYTES };
