import './styles.css';
import { convertVideoToGif, formatTime, formatBytes } from './converter.js';

const yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = String(new Date().getFullYear());

let videoFile = null;
let videoUrl = null;
let videoDuration = 0;

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const converterBody = document.getElementById('converter-body');
const videoPreview = document.getElementById('video-preview');
const fileInfo = document.getElementById('file-info');
const startInput = document.getElementById('start-time');
const endInput = document.getElementById('end-time');
const clipDuration = document.getElementById('clip-duration');
const widthInput = document.getElementById('width');
const fpsSelect = document.getElementById('fps');
const convertBtn = document.getElementById('convert-btn');
const resetBtn = document.getElementById('reset-btn');
const progressWrap = document.getElementById('progress-wrap');
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');
const resultSection = document.getElementById('result-section');
const resultGif = document.getElementById('result-gif');
const resultInfo = document.getElementById('result-info');
const downloadBtn = document.getElementById('download-btn');

function updateClipDuration() {
  const start = parseFloat(startInput.value) || 0;
  const end = parseFloat(endInput.value) || 0;
  const dur = Math.max(0, end - start);
  clipDuration.textContent = `Clip: ${formatTime(dur)}`;
  clipDuration.style.color = dur > 30 ? 'var(--danger)' : '';
}

function loadVideo(file) {
  if (videoUrl) URL.revokeObjectURL(videoUrl);

  videoFile = file;
  videoUrl = URL.createObjectURL(file);
  videoPreview.src = videoUrl;
  converterBody.classList.add('active');
  resultSection.classList.remove('active');

  fileInfo.textContent = `${file.name} · ${formatBytes(file.size)}`;

  videoPreview.onloadedmetadata = () => {
    videoDuration = videoPreview.duration;
    startInput.max = String(videoDuration);
    endInput.max = String(videoDuration);
    startInput.value = '0';
    endInput.value = String(Math.min(3, videoDuration).toFixed(1));
    updateClipDuration();
  };
}

function resetConverter() {
  if (videoUrl) URL.revokeObjectURL(videoUrl);
  videoFile = null;
  videoUrl = null;
  videoDuration = 0;
  videoPreview.removeAttribute('src');
  converterBody.classList.remove('active');
  progressWrap.classList.remove('active');
  resultSection.classList.remove('active');
  fileInput.value = '';
}

function setProgress(message, percent) {
  progressWrap.classList.add('active');
  progressFill.style.width = `${percent}%`;
  progressText.textContent = message;
}

dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('dragover');
});

dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));

dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  const file = e.dataTransfer?.files?.[0];
  if (file?.type.startsWith('video/')) loadVideo(file);
});

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) loadVideo(file);
});

[startInput, endInput].forEach((el) => el.addEventListener('input', updateClipDuration));

resetBtn.addEventListener('click', resetConverter);

convertBtn.addEventListener('click', async () => {
  if (!videoFile) return;

  const start = parseFloat(startInput.value) || 0;
  const end = parseFloat(endInput.value) || 0;
  const width = parseInt(widthInput.value, 10) || 480;
  const fps = parseInt(fpsSelect.value, 10) || 12;

  convertBtn.disabled = true;
  resetBtn.disabled = true;
  resultSection.classList.remove('active');

  try {
    const result = await convertVideoToGif(
      videoFile,
      { start, end, width, fps },
      setProgress,
    );

    const url = URL.createObjectURL(result.blob);
    resultGif.src = url;
    resultInfo.textContent = `${result.filename} · ${result.sizeLabel}`;
    downloadBtn.href = url;
    downloadBtn.download = result.filename;
    resultSection.classList.add('active');
  } catch (err) {
    alert(err.message || 'Conversion failed. Try a shorter clip or smaller dimensions.');
  } finally {
    convertBtn.disabled = false;
    resetBtn.disabled = false;
    progressWrap.classList.remove('active');
  }
});

function initAds() {
  const adsScript = document.querySelector('script[src*="adsbygoogle"]');
  if (!adsScript || !window.adsbygoogle) return;

  document.querySelectorAll('.adsbygoogle').forEach(() => {
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      /* ignore */
    }
  });
}

initAds();
