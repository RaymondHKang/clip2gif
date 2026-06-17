import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { extractClipBrowser, BROWSER_EXTRACT_THRESHOLD } from './clipExtractor.js';

const CORE_VERSION = '0.12.10';
const CORE_BASE = `https://unpkg.com/@ffmpeg/core-mt@${CORE_VERSION}/dist/esm`;
const MAX_CLIP_SECONDS = 60;
const MAX_FILE_BYTES = 1024 * 1024 * 1024; // 1 GB
const WARN_FILE_BYTES = 200 * 1024 * 1024;

let ffmpegInstance = null;
let loadPromise = null;
let lastFfmpegLog = '';

const GIF_FILTER = (width, fps) =>
  [
    `[0:v]fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b]`,
    '[a]palettegen=stats_mode=diff:max_colors=256[p]',
    '[b][p]paletteuse=dither=bayer:bayer_scale=3',
  ].join(';');

const GIF_FILTER_PRESCALED = [
  '[0:v]split[a][b]',
  '[a]palettegen=stats_mode=diff:max_colors=256[p]',
  '[b][p]paletteuse=dither=bayer:bayer_scale=3',
].join(';');

async function getFFmpeg(onProgress) {
  if (ffmpegInstance) return ffmpegInstance;

  if (!loadPromise) {
    loadPromise = (async () => {
      const ffmpeg = new FFmpeg();

      ffmpeg.on('log', ({ message }) => {
        lastFfmpegLog = message;
        if (message.includes('frame=')) {
          onProgress?.('Encoding frames…', 75);
        }
      });

      ffmpeg.on('progress', ({ progress }) => {
        const pct = Math.min(95, 40 + Math.round(progress * 55));
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
  const code = await ffmpeg.exec(args);
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

async function writeInputFile(ffmpeg, file, inputName, onProgress) {
  onProgress?.('Reading video file…', 12);
  try {
    await ffmpeg.writeFile(inputName, await fetchFile(file));
  } catch {
    throw new Error(
      'Not enough memory to load the video. For large files, trim a shorter clip or close other browser tabs.',
    );
  }
}

async function encodeGif(ffmpeg, inputName, outputName, trimStart, trimDuration, width, fps, onProgress) {
  onProgress?.('Converting clip to GIF…', 30);

  try {
    await runFfmpeg(ffmpeg, [
      '-ss', String(trimStart),
      '-t', String(trimDuration),
      '-i', inputName,
      '-filter_complex', GIF_FILTER(width, fps),
      '-an',
      '-loop', '0',
      outputName,
    ]);
  } catch {
    onProgress?.('Retrying with alternate encoder…', 45);
    const clipName = 'clip.mp4';

    await runFfmpeg(ffmpeg, [
      '-ss', String(trimStart),
      '-t', String(trimDuration),
      '-i', inputName,
      '-an',
      '-vf', `fps=${fps},scale=${width}:-1:flags=lanczos`,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-pix_fmt', 'yuv420p',
      clipName,
    ]);

    await deleteQuiet(ffmpeg, inputName);

    await runFfmpeg(ffmpeg, [
      '-i', clipName,
      '-filter_complex', GIF_FILTER_PRESCALED,
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
  const { start, end, width, fps } = options;
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

  let workFile = file;
  let trimStart = start;
  let trimDuration = duration;

  // Large files: extract only the selected clip in-browser first (avoids loading full file into WASM)
  if (file.size > BROWSER_EXTRACT_THRESHOLD) {
    onProgress?.('Large file — extracting selected clip first…', 8);
    const clipBlob = await extractClipBrowser(file, start, end, onProgress);
    const ext = clipBlob.type.includes('webm') ? '.webm' : '.mp4';
    workFile = new File([clipBlob], `clip${ext}`, { type: clipBlob.type });
    trimStart = 0;
    trimDuration = duration;
  }

  const inputName = 'input' + getExtension(workFile.name);
  const outputName = 'output.gif';

  await writeInputFile(ffmpeg, workFile, inputName, onProgress);
  await encodeGif(ffmpeg, inputName, outputName, trimStart, trimDuration, width, fps, onProgress);
  await deleteQuiet(ffmpeg, inputName);

  onProgress?.('Finalizing…', 98);
  const result = await readGifOutput(ffmpeg, outputName, file, start, end);
  onProgress?.('Done!', 100);
  return result;
}

export { formatTime, formatBytes, MAX_CLIP_SECONDS, MAX_FILE_BYTES, WARN_FILE_BYTES, BROWSER_EXTRACT_THRESHOLD };
