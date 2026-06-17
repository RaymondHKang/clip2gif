import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

const CORE_VERSION = '0.12.10';
const CORE_BASE = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/esm`;

let ffmpegInstance = null;
let loadPromise = null;

async function getFFmpeg(onProgress) {
  if (ffmpegInstance) return ffmpegInstance;

  if (!loadPromise) {
    loadPromise = (async () => {
      const ffmpeg = new FFmpeg();

      ffmpeg.on('log', ({ message }) => {
        if (message.includes('frame=')) {
          onProgress?.('Encoding frames…', 70);
        }
      });

      ffmpeg.on('progress', ({ progress }) => {
        const pct = Math.min(95, 50 + Math.round(progress * 45));
        onProgress?.('Converting to GIF…', pct);
      });

      onProgress?.('Loading converter engine…', 5);

      await ffmpeg.load({
        coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
      });

      ffmpegInstance = ffmpeg;
      return ffmpeg;
    })();
  }

  return loadPromise;
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = (seconds % 60).toFixed(1);
  return mins > 0 ? `${mins}:${secs.padStart(4, '0')}` : `${secs}s`;
}

function sanitizeFilename(name) {
  return name.replace(/\.[^.]+$/, '').replace(/[^\w\-]+/g, '-').slice(0, 60) || 'clip';
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
  if (duration > 30) {
    throw new Error('Clips longer than 30 seconds produce very large GIFs. Try a shorter clip.');
  }

  const ffmpeg = await getFFmpeg(onProgress);
  const inputName = 'input' + getExtension(file.name);
  const outputName = 'output.gif';

  onProgress?.('Reading video file…', 15);
  await ffmpeg.writeFile(inputName, await fetchFile(file));

  onProgress?.('Extracting clip…', 35);

  // Palette generation for high-quality GIFs
  const paletteFilter = [
    `fps=${fps}`,
    `scale=${width}:-1:flags=lanczos`,
    'palettegen=max_colors=256:stats_mode=diff',
  ].join(',');

  await ffmpeg.exec([
    '-ss', String(start),
    '-t', String(duration),
    '-i', inputName,
    '-vf', paletteFilter,
    'palette.png',
  ]);

  onProgress?.('Building GIF…', 55);

  const gifFilter = [
    `fps=${fps}`,
    `scale=${width}:-1:flags=lanczos`,
    'paletteuse=dither=bayer:bayer_scale=3',
  ].join(',');

  await ffmpeg.exec([
    '-ss', String(start),
    '-t', String(duration),
    '-i', inputName,
    '-i', 'palette.png',
    '-lavfi', gifFilter,
    '-loop', '0',
    outputName,
  ]);

  onProgress?.('Finalizing…', 98);

  const data = await ffmpeg.readFile(outputName);
  const blob = new Blob([data.buffer], { type: 'image/gif' });

  // Cleanup virtual filesystem
  await ffmpeg.deleteFile(inputName).catch(() => {});
  await ffmpeg.deleteFile('palette.png').catch(() => {});
  await ffmpeg.deleteFile(outputName).catch(() => {});

  onProgress?.('Done!', 100);

  const baseName = sanitizeFilename(file.name);
  return {
    blob,
    filename: `${baseName}-${Math.round(start)}s-${Math.round(end)}s.gif`,
    sizeLabel: formatBytes(blob.size),
  };
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

export { formatTime, formatBytes };
