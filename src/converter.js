import { FFmpeg, FFFSType } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { extractClipBrowser, BROWSER_EXTRACT_THRESHOLD } from './clipExtractor.js';

const CORE_VERSION = '0.12.10';
const CORE_BASE = `https://unpkg.com/@ffmpeg/core-mt@${CORE_VERSION}/dist/esm`;
const MAX_CLIP_SECONDS = 60;
const MAX_FILE_BYTES = 1024 * 1024 * 1024;
const WARN_FILE_BYTES = 200 * 1024 * 1024;
const MEMFS_FALLBACK_LIMIT = 250 * 1024 * 1024;

let ffmpegInstance = null;
let loadPromise = null;
const ffmpegLogs = [];

function paletteFilter(width, fps, fast) {
  const scaleFlag = fast ? 'bilinear' : 'lanczos';
  const colors = fast ? 128 : 256;
  const stats = fast ? 'single' : 'diff';

  return [
    `[0:v]fps=${fps},scale=${width}:-1:flags=${scaleFlag},split[a][b]`,
    `[a]palettegen=max_colors=${colors}:stats_mode=${stats}[p]`,
    `[b][p]paletteuse`,
  ].join(';');
}

async function getFFmpeg(onProgress) {
  if (ffmpegInstance) return ffmpegInstance;

  if (!loadPromise) {
    loadPromise = (async () => {
      const ffmpeg = new FFmpeg();

      ffmpeg.on('log', ({ message }) => {
        ffmpegLogs.push(message);
        if (ffmpegLogs.length > 30) ffmpegLogs.shift();
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

function lastFfmpegError() {
  const errLine = [...ffmpegLogs].reverse().find((line) =>
    /error|invalid|failed|no such file|not found|permission|codec|unsupported/i.test(line),
  );
  return errLine?.trim() ?? ffmpegLogs.at(-1)?.trim() ?? '';
}

async function runFfmpeg(ffmpeg, args) {
  ffmpegLogs.length = 0;
  const code = await ffmpeg.exec(args);
  if (code !== 0) {
    const hint = lastFfmpegError();
    throw new Error(hint ? `Video processing failed: ${hint}` : 'Video processing failed.');
  }
}

async function deleteQuiet(ffmpeg, name) {
  try {
    await ffmpeg.deleteFile(name);
  } catch {
    /* ignore */
  }
}

async function unmountQuiet(ffmpeg, mountPoint) {
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

async function mountInputFile(ffmpeg, file) {
  const mountPoint = '/input';
  const safeName = 'video' + getExtension(file.name);

  await unmountQuiet(ffmpeg, mountPoint);

  try {
    await ffmpeg.createDir(mountPoint);
  } catch {
    await unmountQuiet(ffmpeg, mountPoint);
    await ffmpeg.createDir(mountPoint);
  }

  const mountFile = file.name === safeName ? file : new File([file], safeName, { type: file.type || 'video/mp4' });

  await ffmpeg.mount(FFFSType.WORKERFS, { files: [mountFile] }, mountPoint);

  const listing = await ffmpeg.listDir(mountPoint);
  if (!listing.some((entry) => entry.name === safeName && !entry.isDir)) {
    throw new Error('WORKERFS mount did not expose the video file.');
  }

  return { inputPath: `${mountPoint}/${safeName}`, mountPoint, mode: 'workerfs' };
}

async function setupInput(ffmpeg, file, onProgress) {
  const tryWorker = async () => {
    const mounted = await mountInputFile(ffmpeg, file);
    return { ...mounted, mode: 'workerfs', inputName: null };
  };

  const tryMem = async () => {
    const inputName = 'video' + getExtension(file.name);
    onProgress?.('Loading video into memory…', 12);
    await ffmpeg.writeFile(inputName, await fetchFile(file));
    return { inputPath: inputName, mountPoint: null, mode: 'memfs', inputName };
  };

  if (file.size > MEMFS_FALLBACK_LIMIT) {
    return await tryWorker();
  }

  try {
    return await tryWorker();
  } catch {
    return await tryMem();
  }
}

async function cleanupInput(ffmpeg, input) {
  if (input.mode === 'workerfs' && input.mountPoint) {
    await unmountQuiet(ffmpeg, input.mountPoint);
  } else if (input.inputName) {
    await deleteQuiet(ffmpeg, input.inputName);
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
  if (!data || data.length < 64) {
    throw new Error('GIF output was empty. Try a different clip or lower width/FPS.');
  }
  await deleteQuiet(ffmpeg, outputName);

  const baseName = sanitizeFilename(file.name);
  return {
    blob: new Blob([data], { type: 'image/gif' }),
    filename: `${baseName}-${Math.round(start)}s-${Math.round(end)}s.gif`,
    sizeLabel: formatBytes(data.length),
  };
}

async function tryEncode(ffmpeg, args) {
  await deleteQuiet(ffmpeg, 'output.gif');
  await runFfmpeg(ffmpeg, args);
}

async function encodeGifFromInput(ffmpeg, inputPath, trimStart, trimDuration, width, fps, fast, onProgress) {
  onProgress?.('Converting clip to GIF…', 25);
  const outputName = 'output.gif';
  const seekArgs = ['-ss', String(trimStart), '-t', String(trimDuration)];

  const attempts = [
    {
      label: 'palette',
      args: [
        ...seekArgs,
        '-i', inputPath,
        '-filter_complex', paletteFilter(width, fps, fast),
        '-an',
        '-loop', '0',
        outputName,
      ],
    },
    {
      label: 'accurate-seek',
      args: [
        '-i', inputPath,
        '-ss', String(trimStart),
        '-t', String(trimDuration),
        '-filter_complex', paletteFilter(width, fps, fast),
        '-an',
        '-loop', '0',
        outputName,
      ],
    },
    {
      label: 'simple-gif',
      args: [
        ...seekArgs,
        '-i', inputPath,
        '-vf', `fps=${fps},scale=${width}:-1:flags=bilinear`,
        '-an',
        '-loop', '0',
        '-f', 'gif',
        outputName,
      ],
    },
    {
      label: 'reencode',
      args: null,
    },
  ];

  let lastError = null;

  for (const attempt of attempts) {
    try {
      if (attempt.label === 'reencode') {
        onProgress?.('Retrying with alternate encoder…', 55);
        const clipName = 'clip.mp4';
        await deleteQuiet(ffmpeg, clipName);
        await tryEncode(ffmpeg, [
          ...seekArgs,
          '-i', inputPath,
          '-an',
          '-vf', `fps=${fps},scale=${width}:-1:flags=bilinear`,
          '-c:v', 'libx264',
          '-preset', 'ultrafast',
          '-pix_fmt', 'yuv420p',
          clipName,
        ]);
        await tryEncode(ffmpeg, [
          '-i', clipName,
          '-vf', `fps=${fps},scale=${width}:-1:flags=bilinear`,
          '-an',
          '-loop', '0',
          '-f', 'gif',
          outputName,
        ]);
        await deleteQuiet(ffmpeg, clipName);
      } else {
        await tryEncode(ffmpeg, attempt.args);
      }
      return outputName;
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError ?? new Error('All conversion methods failed.');
}

/**
 * Convert a video clip to GIF using ffmpeg.wasm.
 */
export async function convertVideoToGif(file, options, onProgress) {
  const { start, end, width, fps, fast = true } = options;
  const duration = end - start;

  if (duration <= 0) throw new Error('End time must be after start time.');
  if (duration > MAX_CLIP_SECONDS) {
    throw new Error(`Clips longer than ${MAX_CLIP_SECONDS} seconds are not supported.`);
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`File is too large (${formatBytes(file.size)}). Max is ${formatBytes(MAX_FILE_BYTES)}.`);
  }
  if (estimateGifBytes(duration, width, fps) > 50 * 1024 * 1024) {
    throw new Error('Clip settings would produce a huge GIF. Lower width or FPS.');
  }

  const ffmpeg = await getFFmpeg(onProgress);
  let workFile = file;
  let trimStart = start;
  let trimDuration = duration;
  let input = null;

  try {
    onProgress?.('Preparing video…', 10);

    try {
      input = await setupInput(ffmpeg, workFile, onProgress);
    } catch (setupError) {
      if (workFile.size > BROWSER_EXTRACT_THRESHOLD) {
        onProgress?.('Extracting clip via browser…', 12);
        const clipBlob = await extractClipBrowser(workFile, start, end, onProgress);
        workFile = new File([clipBlob], 'clip.webm', { type: clipBlob.type });
        trimStart = 0;
        trimDuration = duration;
        input = await setupInput(ffmpeg, workFile, onProgress);
      } else {
        throw setupError;
      }
    }

    try {
      const outputName = await encodeGifFromInput(
        ffmpeg,
        input.inputPath,
        trimStart,
        trimDuration,
        width,
        fps,
        fast,
        onProgress,
      );
      onProgress?.('Finalizing…', 98);
      const result = await readGifOutput(ffmpeg, outputName, file, start, end);
      onProgress?.('Done!', 100);
      return result;
    } catch (encodeError) {
      if (workFile === file && file.size > BROWSER_EXTRACT_THRESHOLD) {
        onProgress?.('Retrying via browser clip extraction…', 40);
        await cleanupInput(ffmpeg, input);
        input = null;

        const clipBlob = await extractClipBrowser(file, start, end, onProgress);
        workFile = new File([clipBlob], 'clip.webm', { type: clipBlob.type });
        input = await setupInput(ffmpeg, workFile, onProgress);

        const outputName = await encodeGifFromInput(
          ffmpeg,
          input.inputPath,
          0,
          duration,
          width,
          fps,
          fast,
          onProgress,
        );
        onProgress?.('Finalizing…', 98);
        const result = await readGifOutput(ffmpeg, outputName, file, start, end);
        onProgress?.('Done!', 100);
        return result;
      }
      throw encodeError;
    }
  } finally {
    if (input) await cleanupInput(ffmpeg, input);
  }
}

export { formatTime, formatBytes, MAX_CLIP_SECONDS, MAX_FILE_BYTES, WARN_FILE_BYTES };
