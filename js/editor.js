/**
 * SubAI — Timeline Editor
 * จัดการ timeline, drag, resize segments
 */

const TimelineEditor = (() => {

  /* ── State ── */
  let state = {
    segments: [],
    duration: 100,
    currentTime: 0,
    zoom: 1,
    scrollLeft: 0,
    activeSegmentId: null,
    dragging: null,
    resizing: null,
  };

  let callbacks = {
    onSegmentClick: null,
    onSegmentMove: null,
    onSegmentResize: null,
    onTimeSeek: null,
  };

  /* DOM refs */
  let wrapperEl = null;
  let trackEl = null;
  let playheadEl = null;

  /* ──────────────────────────────────────
     INIT
  ────────────────────────────────────── */
  function init(wrapper, track, playhead, cbs = {}) {
    wrapperEl = wrapper;
    trackEl = track;
    playheadEl = playhead;
    callbacks = { ...callbacks, ...cbs };

    // Click on timeline to seek
    wrapperEl.addEventListener('click', onTimelineClick);
    // Mouse events for drag/resize
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    // Touch support
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);
  }

  /* ──────────────────────────────────────
     RENDER SEGMENTS
  ────────────────────────────────────── */
  function render(segments, duration) {
    if (!trackEl) return;
    state.segments = segments;
    state.duration = duration || getMaxTime(segments);

    trackEl.innerHTML = '';

    segments.forEach(seg => {
      const el = createSegmentEl(seg);
      trackEl.appendChild(el);
    });

    updatePlayhead(state.currentTime);
  }

  function createSegmentEl(seg) {
    const pct = (t) => (t / state.duration) * 100;
    const el = document.createElement('div');
    el.className = 'tl-segment';
    el.dataset.id = seg.id;
    el.style.left = pct(seg.startTime) + '%';
    el.style.width = Math.max(0.5, pct(seg.endTime - seg.startTime)) + '%';

    // Color by confidence
    if (seg.confidence !== undefined) {
      if (seg.confidence < 0.65) el.classList.add('error');
      else if (seg.confidence < 0.85) el.classList.add('warning');
    }

    if (seg.id === state.activeSegmentId) el.classList.add('active');

    // Label
    const label = document.createElement('span');
    label.className = 'tl-segment-label';
    label.textContent = seg.text || '';
    el.appendChild(label);

    // Resize handle
    const handle = document.createElement('div');
    handle.className = 'tl-resize-handle';
    el.appendChild(handle);

    // Events
    el.addEventListener('mousedown', (e) => onSegmentMouseDown(e, seg));
    el.addEventListener('touchstart', (e) => onSegmentTouchStart(e, seg), { passive: false });

    handle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      startResize(e, seg, el);
    });

    return el;
  }

  /* ──────────────────────────────────────
     DRAG & RESIZE
  ────────────────────────────────────── */
  function onSegmentMouseDown(e, seg) {
    if (e.target.classList.contains('tl-resize-handle')) return;
    e.preventDefault();
    startDrag(e, seg);
  }

  function onSegmentTouchStart(e, seg) {
    if (e.target.classList.contains('tl-resize-handle')) return;
    e.preventDefault();
    const touch = e.touches[0];
    startDrag({ clientX: touch.clientX, clientY: touch.clientY }, seg);
  }

  function startDrag(e, seg) {
    const rect = wrapperEl.getBoundingClientRect();
    state.dragging = {
      seg,
      startX: e.clientX,
      origStart: seg.startTime,
      origEnd: seg.endTime,
      wrapperRect: rect,
    };
    // Notify selection
    setActive(seg.id);
    if (callbacks.onSegmentClick) callbacks.onSegmentClick(seg.id);
  }

  function startResize(e, seg, el) {
    e.preventDefault();
    const rect = wrapperEl.getBoundingClientRect();
    state.resizing = {
      seg,
      startX: e.clientX,
      origEnd: seg.endTime,
      wrapperRect: rect,
    };
  }

  function onMouseMove(e) {
    handleMove(e.clientX);
  }

  function onTouchMove(e) {
    e.preventDefault();
    handleMove(e.touches[0].clientX);
  }

  function handleMove(clientX) {
    if (state.dragging) {
      const { seg, startX, origStart, origEnd, wrapperRect } = state.dragging;
      const pxPerSec = wrapperRect.width / state.duration;
      const deltaSec = (clientX - startX) / pxPerSec;
      const dur = origEnd - origStart;

      let newStart = Math.max(0, origStart + deltaSec);
      let newEnd = newStart + dur;
      if (newEnd > state.duration) {
        newEnd = state.duration;
        newStart = newEnd - dur;
      }

      seg.startTime = newStart;
      seg.endTime = newEnd;

      // Update DOM
      const pct = (t) => (t / state.duration) * 100;
      const el = trackEl.querySelector(`[data-id="${seg.id}"]`);
      if (el) {
        el.style.left = pct(newStart) + '%';
        el.style.width = pct(newEnd - newStart) + '%';
      }
    }

    if (state.resizing) {
      const { seg, startX, origEnd, wrapperRect } = state.resizing;
      const pxPerSec = wrapperRect.width / state.duration;
      const deltaSec = (clientX - startX) / pxPerSec;
      const minDur = 0.5;

      let newEnd = Math.max(seg.startTime + minDur,
        Math.min(state.duration, origEnd + deltaSec));
      seg.endTime = newEnd;

      const pct = (t) => (t / state.duration) * 100;
      const el = trackEl.querySelector(`[data-id="${seg.id}"]`);
      if (el) {
        el.style.width = pct(newEnd - seg.startTime) + '%';
      }
    }
  }

  function onMouseUp(e) {
    finishInteraction();
  }
  function onTouchEnd(e) {
    finishInteraction();
  }

  function finishInteraction() {
    if (state.dragging) {
      if (callbacks.onSegmentMove) {
        callbacks.onSegmentMove(state.dragging.seg);
      }
      state.dragging = null;
    }
    if (state.resizing) {
      if (callbacks.onSegmentResize) {
        callbacks.onSegmentResize(state.resizing.seg);
      }
      state.resizing = null;
    }
  }

  /* ──────────────────────────────────────
     TIMELINE CLICK = SEEK
  ────────────────────────────────────── */
  function onTimelineClick(e) {
    if (state.dragging || state.resizing) return;
    if (e.target.classList.contains('tl-segment') ||
        e.target.classList.contains('tl-resize-handle') ||
        e.target.classList.contains('tl-segment-label')) return;

    const rect = wrapperEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const time = (x / rect.width) * state.duration;
    const clamped = Math.max(0, Math.min(state.duration, time));

    updatePlayhead(clamped);
    if (callbacks.onTimeSeek) callbacks.onTimeSeek(clamped);
  }

  /* ──────────────────────────────────────
     PLAYHEAD
  ────────────────────────────────────── */
  function updatePlayhead(time) {
    state.currentTime = time;
    if (!playheadEl || !state.duration) return;
    const pct = (time / state.duration) * 100;
    playheadEl.style.left = Math.min(100, Math.max(0, pct)) + '%';

    // Highlight active segment
    const activeSeg = state.segments.find(s =>
      time >= s.startTime && time <= s.endTime
    );
    if (activeSeg && activeSeg.id !== state.activeSegmentId) {
      setActive(activeSeg.id);
      if (callbacks.onSegmentClick) callbacks.onSegmentClick(activeSeg.id);
    }
  }

  /* ──────────────────────────────────────
     ZOOM
  ────────────────────────────────────── */
  function zoomIn()  { state.zoom = Math.min(state.zoom * 1.5, 8); applyZoom(); }
  function zoomOut() { state.zoom = Math.max(state.zoom / 1.5, 1); applyZoom(); }
  function applyZoom() {
    if (!trackEl) return;
    const parent = trackEl.parentElement;
    if (parent) {
      parent.style.width = (state.zoom * 100) + '%';
    }
  }

  /* ──────────────────────────────────────
     RULER
  ────────────────────────────────────── */
  function renderRuler(rulerEl, duration) {
    if (!rulerEl || !duration) return;
    rulerEl.innerHTML = '';

    const step = Math.max(1, Math.floor(duration / 20));

    for (let t = 0; t <= duration; t += step) {
      const tick = document.createElement('div');
      tick.className = 'ruler-tick' + (t % (step * 5) === 0 ? ' major' : '');
      tick.style.left = (t / duration * 100) + '%';

      const line = document.createElement('div');
      line.className = 'tick-line';
      tick.appendChild(line);

      if (t % (step * 5) === 0) {
        const label = document.createElement('span');
        label.className = 'tick-label';
        label.textContent = formatTime(t);
        tick.appendChild(label);
      }
      rulerEl.appendChild(tick);
    }
  }

  /* ──────────────────────────────────────
     HELPERS
  ────────────────────────────────────── */
  function setActive(id) {
    state.activeSegmentId = id;
    if (!trackEl) return;
    trackEl.querySelectorAll('.tl-segment').forEach(el => {
      el.classList.toggle('active', el.dataset.id == id);
    });
  }

  function getMaxTime(segments) {
    if (!segments.length) return 60;
    return Math.max(...segments.map(s => s.endTime)) + 2;
  }

  function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }

  /* ── Public API ── */
  return {
    init,
    render,
    renderRuler,
    updatePlayhead,
    setActive,
    zoomIn,
    zoomOut,
    getMaxTime,
  };

})();

window.TimelineEditor = TimelineEditor;
