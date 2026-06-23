/**
 * SubAI — Core Application Controller
 * ควบคุม state หลักและ event wiring ทั้งหมด
 */

/* ══════════════════════════════════════
   APPLICATION STATE
══════════════════════════════════════ */
const App = {
  segments: [],
  videoUrl: null,
  videoDuration: 0,
  currentTime: 0,
  isPlaying: false,
  currentTheme: 'light',
  currentLang: 'th-TH',
  apiKey: localStorage.getItem('subai_api_key') || '',
  filename: 'subtitles',

  subtitleStyle: {
    fontFamily: 'Sarabun',
    fontSize: 26,
    color: '#ffffff',
    bgColor: '#000000',
    bgOpacity: 0.45,
    outlineColor: '#000000',
    align: 'center',
    position: 'bottom',
    maxChars: 40,
    bold: false,
    italic: false,
    strokeWidth: 1,
  },

  activeSegmentId: null,
  editingSegmentId: null,
};

/* ══════════════════════════════════════
   DOM REFERENCES
══════════════════════════════════════ */
const $ = (id) => document.getElementById(id);

/* ══════════════════════════════════════
   INITIALIZATION
══════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initVideoUpload();
  initVideoControls();
  initStylePanel();
  initTimeline();
  initExport();
  initApiModal();
  initKeyboardShortcuts();
  updateSubtitleList();

  // Restore theme
  const savedTheme = localStorage.getItem('subai_theme') || 'light';
  setTheme(savedTheme);

  // Restore style settings
  const savedStyle = localStorage.getItem('subai_style');
  if (savedStyle) {
    try {
      Object.assign(App.subtitleStyle, JSON.parse(savedStyle));
      restoreStyleControls();
    } catch (e) {}
  }
});

/* ══════════════════════════════════════
   THEME MANAGEMENT
══════════════════════════════════════ */
function initTheme() {
  document.querySelectorAll('.theme-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      setTheme(dot.dataset.theme);
    });
  });
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  App.currentTheme = theme;
  localStorage.setItem('subai_theme', theme);

  document.querySelectorAll('.theme-dot').forEach(dot => {
    dot.classList.toggle('active', dot.dataset.theme === theme);
  });
}

/* ══════════════════════════════════════
   VIDEO UPLOAD
══════════════════════════════════════ */
function initVideoUpload() {
  const fileInput = $('file-input');
  const placeholder = $('video-placeholder');
  const videoEl = $('video-el');
  const uploadBtn = $('upload-btn');

  // Click to upload
  placeholder.addEventListener('click', () => fileInput.click());
  uploadBtn?.addEventListener('click', () => fileInput.click());

  // Drag & Drop
  const dropZone = document.body;
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    placeholder.style.background = 'rgba(99,102,241,0.1)';
  });
  dropZone.addEventListener('dragleave', () => {
    placeholder.style.background = '';
  });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    placeholder.style.background = '';
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('video/')) {
      handleVideoFile(file);
    } else {
      showToast('error', 'ไฟล์ไม่ถูกต้อง', 'กรุณาเลือกไฟล์วิดีโอเท่านั้น');
    }
  });

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleVideoFile(file);
    fileInput.value = '';
  });
}

function handleVideoFile(file) {
  App.filename = file.name.replace(/\.[^.]+$/, '');

  // Show video
  const videoEl = $('video-el');
  const placeholder = $('video-placeholder');

  if (App.videoUrl) URL.revokeObjectURL(App.videoUrl);
  App.videoUrl = URL.createObjectURL(file);

  videoEl.src = App.videoUrl;
  videoEl.style.display = 'block';
  placeholder.style.display = 'none';

  videoEl.onloadedmetadata = () => {
    App.videoDuration = videoEl.duration;
    updateTimeDisplay(0, videoEl.duration);
  };

  // Start processing
  startProcessing(file);
}

/* ══════════════════════════════════════
   PROCESSING PIPELINE
══════════════════════════════════════ */
function startProcessing(file) {
  const overlay = $('processing-overlay');
  overlay.classList.add('show');
  resetProcessingUI();

  SpeechEngine.setLanguage(App.currentLang);
  if (App.apiKey) SpeechEngine.setApiKey(App.apiKey);

  SpeechEngine.setProgressCallback((pct) => {
    setProgress(pct);
  });

  SpeechEngine.setStepCallback((step) => {
    setProcessingStep(step);
    updateStepIndicators(step);
  });

  SpeechEngine.processVideo(
    file,
    (segments, videoUrl) => {
      // Success
      App.segments = segments;
      App.videoUrl = videoUrl;

      setTimeout(() => {
        overlay.classList.remove('show');
        onProcessingComplete();
      }, 600);
    },
    (errMsg) => {
      overlay.classList.remove('show');
      showToast('error', 'เกิดข้อผิดพลาด', errMsg);
    }
  );
}

function onProcessingComplete() {
  updateSubtitleList();
  renderTimeline();
  showToast('success', 'เสร็จสมบูรณ์!', `สร้างซับได้ ${App.segments.length} ช่วง`);
  $('panel-count').textContent = App.segments.length + ' ช่วง';
}

function resetProcessingUI() {
  setProgress(0);
  setProcessingStep('กำลังเตรียมข้อมูล...');
  document.querySelectorAll('.proc-step-item').forEach(el => {
    el.classList.remove('done', 'current');
    el.querySelector('.step-indicator').textContent = '';
  });
  const steps = document.querySelectorAll('.proc-step-item');
  if (steps[0]) steps[0].classList.add('current');
}

function setProgress(pct) {
  const fill = $('progress-fill');
  const pctEl = $('progress-pct');
  if (fill) fill.style.width = pct + '%';
  if (pctEl) pctEl.textContent = Math.round(pct) + '%';
}

function setProcessingStep(msg) {
  const el = $('processing-step');
  if (el) el.textContent = msg;
}

const STEP_KEYWORDS = [
  { keyword: 'โหลด',      index: 0, label: 'โหลดไฟล์วิดีโอ' },
  { keyword: 'แยก',       index: 1, label: 'แยกข้อมูลเสียง' },
  { keyword: 'วิเคราะห์', index: 2, label: 'วิเคราะห์คำพูด' },
  { keyword: 'AI',         index: 3, label: 'AI ตรวจสอบซับ' },
  { keyword: 'จัด',       index: 4, label: 'จัดรูปแบบ' },
  { keyword: 'เสร็จ',     index: 5, label: 'เสร็จสมบูรณ์' },
];

function updateStepIndicators(step) {
  const match = STEP_KEYWORDS.find(s => step.includes(s.keyword));
  if (!match) return;

  const steps = document.querySelectorAll('.proc-step-item');
  steps.forEach((el, i) => {
    el.classList.remove('current');
    if (i < match.index) {
      el.classList.add('done');
      el.querySelector('.step-indicator').innerHTML = '✓';
    } else if (i === match.index) {
      el.classList.add('current');
    }
  });
}

/* ══════════════════════════════════════
   VIDEO CONTROLS
══════════════════════════════════════ */
function initVideoControls() {
  const videoEl = $('video-el');
  const playBtn = $('play-btn');
  const seekBar = $('seek-bar');
  const volSlider = $('vol-slider');
  const skipBwBtn = $('skip-bw-btn');
  const skipFwBtn = $('skip-fw-btn');

  // Play/Pause
  playBtn?.addEventListener('click', togglePlay);
  videoEl?.addEventListener('click', togglePlay);

  // Sync subtitle on timeupdate
  videoEl?.addEventListener('timeupdate', () => {
    const t = videoEl.currentTime;
    App.currentTime = t;
    if (seekBar) seekBar.value = t;
    updateTimeDisplay(t, App.videoDuration);
    syncSubtitleOverlay(t);
    TimelineEditor.updatePlayhead(t);
  });

  videoEl?.addEventListener('loadedmetadata', () => {
    App.videoDuration = videoEl.duration;
    if (seekBar) {
      seekBar.max = videoEl.duration;
      seekBar.value = 0;
    }
  });

  videoEl?.addEventListener('ended', () => {
    App.isPlaying = false;
    updatePlayBtn(false);
  });

  // Seek
  seekBar?.addEventListener('input', () => {
    if (videoEl) videoEl.currentTime = parseFloat(seekBar.value);
  });

  // Volume
  volSlider?.addEventListener('input', () => {
    if (videoEl) videoEl.volume = parseFloat(volSlider.value);
  });

  // Skip
  skipBwBtn?.addEventListener('click', () => {
    if (videoEl) videoEl.currentTime = Math.max(0, videoEl.currentTime - 5);
  });
  skipFwBtn?.addEventListener('click', () => {
    if (videoEl) videoEl.currentTime = Math.min(App.videoDuration, videoEl.currentTime + 5);
  });
}

function togglePlay() {
  const videoEl = $('video-el');
  if (!videoEl || !videoEl.src) return;
  if (videoEl.paused) {
    videoEl.play();
    App.isPlaying = true;
  } else {
    videoEl.pause();
    App.isPlaying = false;
  }
  updatePlayBtn(App.isPlaying);
}

function updatePlayBtn(playing) {
  const btn = $('play-btn');
  if (!btn) return;
  btn.innerHTML = playing
    ? `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>`;
}

function updateTimeDisplay(current, total) {
  const el = $('time-display');
  if (!el) return;
  el.textContent = `${formatTime(current)} / ${formatTime(total || 0)}`;
}

function formatTime(sec) {
  if (!sec || isNaN(sec)) return '00:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

/* ══════════════════════════════════════
   SUBTITLE OVERLAY SYNC
══════════════════════════════════════ */
function syncSubtitleOverlay(time) {
  const overlayEl = $('subtitle-display');
  if (!overlayEl) return;

  const active = App.segments.find(s => time >= s.startTime && time <= s.endTime);
  if (active) {
    overlayEl.textContent = active.text;
    overlayEl.style.display = '';
    // Highlight in list
    if (active.id !== App.activeSegmentId) {
      setActiveSegment(active.id, false);
    }
  } else {
    overlayEl.textContent = '';
    overlayEl.style.display = App.segments.length ? 'none' : '';
  }
}

/* ══════════════════════════════════════
   SUBTITLE LIST
══════════════════════════════════════ */
function updateSubtitleList() {
  const list = $('subtitle-list');
  if (!list) return;

  const emptyState = $('empty-state');
  if (App.segments.length === 0) {
    list.innerHTML = '';
    if (emptyState) emptyState.style.display = '';
    $('panel-count').textContent = '0 ช่วง';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';
  $('panel-count').textContent = App.segments.length + ' ช่วง';

  list.innerHTML = '';
  App.segments.forEach(seg => {
    list.appendChild(createSubtitleItem(seg));
  });
}

function createSubtitleItem(seg) {
  const item = document.createElement('div');
  item.className = 'sub-item' + (seg.id === App.activeSegmentId ? ' active' : '');
  item.dataset.id = seg.id;

  const info = AIEngine.getConfidenceInfo(seg.confidence ?? 1);

  item.innerHTML = `
    <div class="sub-item-header">
      <span class="sub-index">${seg.id}</span>
      <span class="sub-time">${formatTime(seg.startTime)} → ${formatTime(seg.endTime)}</span>
      <span class="confidence-badge ${info.cls}">${info.icon} ${info.label}</span>
    </div>
    <div class="sub-text" id="sub-text-${seg.id}">${escapeHtml(seg.text)}</div>
    <div class="sub-item-footer">
      <span class="sub-duration">${((seg.endTime - seg.startTime)).toFixed(1)}s</span>
      ${seg.corrections && seg.corrections.length > 0 ? `
        <span class="ai-flag">🤖 AI แก้ไข</span>
      ` : ''}
      ${seg.language ? `<span class="sub-duration">${seg.language === 'th' ? '🇹🇭 TH' : '🇬🇧 EN'}</span>` : ''}
    </div>
  `;

  // Click to seek
  item.addEventListener('click', (e) => {
    if (e.target.classList.contains('sub-text')) return;
    seekToSegment(seg);
    setActiveSegment(seg.id, true);
  });

  // Double-click to edit
  const textEl = item.querySelector('.sub-text');
  textEl.addEventListener('dblclick', () => startEditSegment(seg, textEl));

  return item;
}

function setActiveSegment(id, scrollTo = false) {
  App.activeSegmentId = id;
  document.querySelectorAll('.sub-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id == id);
  });
  TimelineEditor.setActive(id);

  if (scrollTo) {
    const el = document.querySelector(`.sub-item[data-id="${id}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function seekToSegment(seg) {
  const videoEl = $('video-el');
  if (videoEl && videoEl.src) {
    videoEl.currentTime = seg.startTime;
  }
}

/* ──────────────────────────────────────
   INLINE EDITING
────────────────────────────────────── */
function startEditSegment(seg, el) {
  App.editingSegmentId = seg.id;
  el.contentEditable = 'true';
  el.focus();

  // Select all
  const range = document.createRange();
  range.selectNodeContents(el);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);

  const finish = () => {
    el.contentEditable = 'false';
    seg.text = el.textContent.trim();
    el.textContent = seg.text;
    App.editingSegmentId = null;
    // Re-analyze
    const analyzed = AIEngine.analyzeSegment(seg.text, '', '', App.currentLang.split('-')[0]);
    seg.confidence = analyzed.confidence;
    // Update the confidence badge
    updateSegmentBadge(seg);
    // Update timeline
    renderTimeline();
    showToast('info', 'บันทึกแล้ว', 'แก้ไขซับสำเร็จ');
  };

  el.addEventListener('blur', finish, { once: true });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      el.blur();
    }
    if (e.key === 'Escape') {
      el.textContent = seg.text;
      el.blur();
    }
  });
}

function updateSegmentBadge(seg) {
  const item = document.querySelector(`.sub-item[data-id="${seg.id}"]`);
  if (!item) return;
  const badge = item.querySelector('.confidence-badge');
  if (!badge) return;
  const info = AIEngine.getConfidenceInfo(seg.confidence ?? 1);
  badge.className = `confidence-badge ${info.cls}`;
  badge.textContent = `${info.icon} ${info.label}`;
}

/* ──────────────────────────────────────
   SEGMENT CONTROLS (Add/Delete/Split)
────────────────────────────────────── */
function addSegment() {
  const newId = App.segments.length > 0
    ? Math.max(...App.segments.map(s => s.id)) + 1
    : 1;
  const lastEnd = App.segments.length > 0
    ? App.segments[App.segments.length - 1].endTime
    : 0;
  const newSeg = {
    id: newId,
    startTime: lastEnd + 0.5,
    endTime: lastEnd + 3.5,
    text: 'ข้อความใหม่...',
    confidence: 1,
    corrections: [],
  };
  App.segments.push(newSeg);
  updateSubtitleList();
  renderTimeline();
  setActiveSegment(newId, true);
  // Auto-start editing
  setTimeout(() => {
    const textEl = document.querySelector(`#sub-text-${newId}`);
    if (textEl) startEditSegment(newSeg, textEl);
  }, 100);
}

function deleteActiveSegment() {
  if (!App.activeSegmentId) {
    showToast('warning', 'ยังไม่ได้เลือก', 'เลือกช่วงซับก่อนลบ');
    return;
  }
  const idx = App.segments.findIndex(s => s.id === App.activeSegmentId);
  if (idx !== -1) {
    App.segments.splice(idx, 1);
    App.activeSegmentId = null;
    updateSubtitleList();
    renderTimeline();
    showToast('info', 'ลบแล้ว', 'ลบช่วงซับสำเร็จ');
  }
}

function splitActiveSegment() {
  if (!App.activeSegmentId) return;
  const seg = App.segments.find(s => s.id === App.activeSegmentId);
  if (!seg) return;

  const parts = AIEngine.smartSplit(seg.text, App.subtitleStyle.maxChars,
    App.currentLang.split('-')[0]);

  if (parts.length <= 1) {
    showToast('info', 'ไม่จำเป็นต้องแยก', 'ข้อความสั้นพอแล้ว');
    return;
  }

  const dur = (seg.endTime - seg.startTime) / parts.length;
  const idx = App.segments.findIndex(s => s.id === seg.id);
  const maxId = Math.max(...App.segments.map(s => s.id));
  const newSegs = parts.map((text, i) => ({
    id: maxId + i + 1,
    startTime: seg.startTime + i * dur,
    endTime: seg.startTime + (i + 1) * dur,
    text: text.trim(),
    confidence: seg.confidence,
    corrections: ['แยกประโยค'],
  }));

  App.segments.splice(idx, 1, ...newSegs);
  // Re-number
  App.segments.forEach((s, i) => s.id = i + 1);
  updateSubtitleList();
  renderTimeline();
  showToast('success', 'แยกซับสำเร็จ', `แยกเป็น ${parts.length} ช่วง`);
}

/* ══════════════════════════════════════
   TIMELINE
══════════════════════════════════════ */
function initTimeline() {
  const wrapper = $('timeline-wrapper');
  const track = $('timeline-track');
  const playhead = $('timeline-playhead');
  const ruler = $('timeline-ruler');

  TimelineEditor.init(wrapper, track, playhead, {
    onSegmentClick: (id) => setActiveSegment(id, true),
    onTimeSeek: (time) => {
      const videoEl = $('video-el');
      if (videoEl) videoEl.currentTime = time;
    },
    onSegmentMove: () => updateSubtitleList(),
    onSegmentResize: () => updateSubtitleList(),
  });

  $('zoom-in-btn')?.addEventListener('click', () => TimelineEditor.zoomIn());
  $('zoom-out-btn')?.addEventListener('click', () => TimelineEditor.zoomOut());
}

function renderTimeline() {
  const duration = App.videoDuration ||
    TimelineEditor.getMaxTime(App.segments);
  const ruler = $('timeline-ruler');
  TimelineEditor.render(App.segments, duration);
  TimelineEditor.renderRuler(ruler, duration);
}

/* ══════════════════════════════════════
   STYLE PANEL
══════════════════════════════════════ */
function initStylePanel() {
  // Font family
  $('font-select')?.addEventListener('change', (e) => {
    App.subtitleStyle.fontFamily = e.target.value;
    applySubtitleStyle();
    saveStyle();
  });

  // Font size
  $('font-size')?.addEventListener('input', (e) => {
    App.subtitleStyle.fontSize = parseInt(e.target.value);
    $('font-size-val').textContent = e.target.value + 'px';
    applySubtitleStyle();
    saveStyle();
  });

  // Font color
  $('font-color')?.addEventListener('input', (e) => {
    App.subtitleStyle.color = e.target.value;
    $('font-color-swatch').style.background = e.target.value;
    applySubtitleStyle();
    saveStyle();
  });

  // BG color
  $('bg-color')?.addEventListener('input', (e) => {
    App.subtitleStyle.bgColor = e.target.value;
    $('bg-color-swatch').style.background = e.target.value;
    applySubtitleStyle();
    saveStyle();
  });

  // BG Opacity
  $('bg-opacity')?.addEventListener('input', (e) => {
    App.subtitleStyle.bgOpacity = parseFloat(e.target.value);
    $('bg-opacity-val').textContent = Math.round(e.target.value * 100) + '%';
    applySubtitleStyle();
    saveStyle();
  });

  // Outline color
  $('outline-color')?.addEventListener('input', (e) => {
    App.subtitleStyle.outlineColor = e.target.value;
    $('outline-color-swatch').style.background = e.target.value;
    applySubtitleStyle();
    saveStyle();
  });

  // Text align
  document.querySelectorAll('.align-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.align-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      App.subtitleStyle.align = btn.dataset.align;
      applySubtitleStyle();
      saveStyle();
    });
  });

  // Position
  $('pos-select')?.addEventListener('change', (e) => {
    App.subtitleStyle.position = e.target.value;
    applySubtitleStyle();
    saveStyle();
  });

  // Max chars
  $('max-chars')?.addEventListener('input', (e) => {
    App.subtitleStyle.maxChars = parseInt(e.target.value) || 40;
    saveStyle();
  });

  // Bold/Italic
  $('bold-btn')?.addEventListener('click', () => {
    App.subtitleStyle.bold = !App.subtitleStyle.bold;
    $('bold-btn').classList.toggle('active', App.subtitleStyle.bold);
    applySubtitleStyle();
    saveStyle();
  });
  $('italic-btn')?.addEventListener('click', () => {
    App.subtitleStyle.italic = !App.subtitleStyle.italic;
    $('italic-btn').classList.toggle('active', App.subtitleStyle.italic);
    applySubtitleStyle();
    saveStyle();
  });

  // Language
  $('lang-select')?.addEventListener('change', (e) => {
    App.currentLang = e.target.value;
    SpeechEngine.setLanguage(e.target.value);
  });

  applySubtitleStyle();
}

function applySubtitleStyle() {
  const el = $('subtitle-display');
  if (!el) return;
  const s = App.subtitleStyle;

  el.style.fontFamily = `'${s.fontFamily}', sans-serif`;
  el.style.fontSize = s.fontSize + 'px';
  el.style.color = s.color;
  el.style.textAlign = s.align;
  el.style.fontWeight = s.bold ? '700' : '400';
  el.style.fontStyle = s.italic ? 'italic' : 'normal';

  // Background
  const bg = hexToRgb(s.bgColor);
  if (bg) {
    el.style.background = `rgba(${bg.r},${bg.g},${bg.b},${s.bgOpacity})`;
  }

  // Position
  const overlay = $('subtitle-overlay');
  if (overlay) {
    if (s.position === 'top') {
      overlay.style.top = '40px';
      overlay.style.bottom = 'auto';
    } else if (s.position === 'middle') {
      overlay.style.top = '50%';
      overlay.style.bottom = 'auto';
      overlay.style.transform = 'translateY(-50%)';
    } else {
      overlay.style.top = 'auto';
      overlay.style.bottom = '50px';
      overlay.style.transform = '';
    }
  }

  // Outline (text-shadow)
  const outRgb = hexToRgb(s.outlineColor);
  if (outRgb) {
    const o = `rgba(${outRgb.r},${outRgb.g},${outRgb.b},0.9)`;
    el.style.textShadow = `1px 1px 3px ${o}, -1px 1px 3px ${o}, 1px -1px 3px ${o}, -1px -1px 3px ${o}`;
  }
}

function restoreStyleControls() {
  const s = App.subtitleStyle;
  const sel = (id, val) => { const el = $(id); if(el) el.value = val; };
  sel('font-select', s.fontFamily);
  sel('font-size', s.fontSize);
  sel('bg-opacity', s.bgOpacity);
  sel('pos-select', s.position);
  sel('max-chars', s.maxChars);
  if ($('font-size-val')) $('font-size-val').textContent = s.fontSize + 'px';
  if ($('bg-opacity-val')) $('bg-opacity-val').textContent = Math.round(s.bgOpacity*100) + '%';
  if ($('font-color-swatch')) $('font-color-swatch').style.background = s.color;
  if ($('bg-color-swatch')) $('bg-color-swatch').style.background = s.bgColor;
  if ($('outline-color-swatch')) $('outline-color-swatch').style.background = s.outlineColor;
  if ($('bold-btn')) $('bold-btn').classList.toggle('active', s.bold);
  if ($('italic-btn')) $('italic-btn').classList.toggle('active', s.italic);
  document.querySelectorAll('.align-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.align === s.align);
  });
  applySubtitleStyle();
}

function saveStyle() {
  localStorage.setItem('subai_style', JSON.stringify(App.subtitleStyle));
}

/* ══════════════════════════════════════
   EXPORT
══════════════════════════════════════ */
function initExport() {
  const exportBtn = $('export-btn');
  const exportDrop = $('export-dropdown');

  exportBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    exportDrop?.classList.toggle('show');
  });

  document.addEventListener('click', () => {
    exportDrop?.classList.remove('show');
  });

  $('export-srt')?.addEventListener('click', () => {
    if (!checkHasSegments()) return;
    ExportEngine.exportSRT(App.segments, App.filename);
    showToast('success', 'ดาวน์โหลดแล้ว', 'ไฟล์ SRT พร้อมแล้ว');
    exportDrop?.classList.remove('show');
  });

  $('export-vtt')?.addEventListener('click', () => {
    if (!checkHasSegments()) return;
    ExportEngine.exportVTT(App.segments, App.filename, App.subtitleStyle);
    showToast('success', 'ดาวน์โหลดแล้ว', 'ไฟล์ VTT พร้อมแล้ว');
    exportDrop?.classList.remove('show');
  });

  $('export-ass')?.addEventListener('click', () => {
    if (!checkHasSegments()) return;
    const styleOpts = {
      fontFamily: App.subtitleStyle.fontFamily,
      fontSize: App.subtitleStyle.fontSize,
      primaryColor: App.subtitleStyle.color,
      outlineColor: App.subtitleStyle.outlineColor,
      alignment: App.subtitleStyle.position === 'top' ? 8 : App.subtitleStyle.position === 'middle' ? 5 : 2,
      bold: App.subtitleStyle.bold ? -1 : 0,
      italic: App.subtitleStyle.italic ? -1 : 0,
    };
    ExportEngine.exportASS(App.segments, App.filename, styleOpts);
    showToast('success', 'ดาวน์โหลดแล้ว', 'ไฟล์ ASS พร้อมแล้ว');
    exportDrop?.classList.remove('show');
  });

  $('export-txt')?.addEventListener('click', () => {
    if (!checkHasSegments()) return;
    ExportEngine.exportTXT(App.segments, App.filename);
    showToast('success', 'ดาวน์โหลดแล้ว', 'ไฟล์ TXT พร้อมแล้ว');
    exportDrop?.classList.remove('show');
  });

  $('copy-btn')?.addEventListener('click', async () => {
    if (!checkHasSegments()) return;
    await ExportEngine.copyToClipboard(App.segments);
    showToast('success', 'คัดลอกแล้ว', 'ซับถูกคัดลอกแล้ว');
  });

  $('add-seg-btn')?.addEventListener('click', addSegment);
  $('del-seg-btn')?.addEventListener('click', deleteActiveSegment);
  $('split-seg-btn')?.addEventListener('click', splitActiveSegment);
  $('ai-recheck-btn')?.addEventListener('click', rerunAI);
}

function checkHasSegments() {
  if (App.segments.length === 0) {
    showToast('warning', 'ยังไม่มีซับ', 'โปรดอัปโหลดวิดีโอก่อน');
    return false;
  }
  return true;
}

function rerunAI() {
  if (App.segments.length === 0) return;
  const lang = App.currentLang.split('-')[0];
  App.segments = AIEngine.analyzeAll(App.segments, lang);
  updateSubtitleList();
  renderTimeline();
  showToast('success', 'AI ตรวจสอบแล้ว', `ตรวจสอบ ${App.segments.length} ช่วง`);
}

/* ══════════════════════════════════════
   API KEY MODAL
══════════════════════════════════════ */
function initApiModal() {
  const statusEl = $('api-status');
  const modal = $('api-modal');
  const closeBtn = $('api-modal-close');
  const saveBtn = $('api-key-save');
  const input = $('api-key-input');

  updateApiStatus();

  statusEl?.addEventListener('click', () => {
    modal?.classList.add('show');
    if (input) input.value = App.apiKey;
  });

  closeBtn?.addEventListener('click', () => modal?.classList.remove('show'));

  modal?.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('show');
  });

  saveBtn?.addEventListener('click', () => {
    const key = input?.value.trim();
    App.apiKey = key;
    localStorage.setItem('subai_api_key', key);
    SpeechEngine.setApiKey(key);
    updateApiStatus();
    modal?.classList.remove('show');
    showToast('success', 'บันทึกแล้ว', key ? 'เชื่อมต่อ Whisper API แล้ว' : 'ใช้ Web Speech API');
  });
}

function updateApiStatus() {
  const statusEl = $('api-status');
  const dot = statusEl?.querySelector('.dot');
  const label = statusEl?.querySelector('.api-label');
  if (App.apiKey) {
    dot?.classList.add('connected');
    if (label) label.textContent = 'Whisper API';
  } else {
    dot?.classList.remove('connected');
    if (label) label.textContent = 'Web Speech';
  }
}

/* ══════════════════════════════════════
   KEYBOARD SHORTCUTS
══════════════════════════════════════ */
function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Don't intercept if editing
    if (App.editingSegmentId) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    if (e.code === 'Space') {
      e.preventDefault();
      togglePlay();
    }
    if (e.code === 'ArrowLeft') {
      const v = $('video-el');
      if (v) v.currentTime = Math.max(0, v.currentTime - 2);
    }
    if (e.code === 'ArrowRight') {
      const v = $('video-el');
      if (v) v.currentTime = Math.min(App.videoDuration, v.currentTime + 2);
    }
    if (e.code === 'Delete' || e.code === 'Backspace') {
      deleteActiveSegment();
    }
    if (e.ctrlKey && e.code === 'KeyZ') {
      showToast('info', 'Undo', 'กด Ctrl+Z (ยังไม่รองรับ)');
    }
  });
}

/* ══════════════════════════════════════
   TOAST NOTIFICATIONS
══════════════════════════════════════ */
function showToast(type, title, msg) {
  const container = $('toast-container');
  if (!container) return;

  const icons = {
    success: '✓',
    warning: '⚠',
    error: '✕',
    info: 'ℹ',
  };

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <div class="toast-icon">${icons[type] || 'ℹ'}</div>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      ${msg ? `<div class="toast-msg">${msg}</div>` : ''}
    </div>
  `;

  container.appendChild(toast);

  // Auto remove
  setTimeout(() => {
    toast.classList.add('remove');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

/* ══════════════════════════════════════
   UTILITIES
══════════════════════════════════════ */
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  } : null;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Make App globally accessible for debugging
window.SubAIApp = App;
