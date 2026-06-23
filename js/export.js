/**
 * SubAI — Export Module
 * ส่งออกซับไตเติ้ลเป็น SRT, VTT, ASS
 */

const ExportEngine = (() => {

  /* ──────────────────────────────────────
     TIME FORMATTING HELPERS
  ────────────────────────────────────── */
  function toSRTTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.round((seconds % 1) * 1000);
    return `${pad2(h)}:${pad2(m)}:${pad2(s)},${pad3(ms)}`;
  }

  function toVTTTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.round((seconds % 1) * 1000);
    if (h > 0) return `${pad2(h)}:${pad2(m)}:${pad2(s)}.${pad3(ms)}`;
    return `${pad2(m)}:${pad2(s)}.${pad3(ms)}`;
  }

  function toASSTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const cs = Math.round((seconds % 1) * 100); // centiseconds
    return `${h}:${pad2(m)}:${pad2(s)}.${pad2(cs)}`;
  }

  function pad2(n) { return String(n).padStart(2, '0'); }
  function pad3(n) { return String(n).padStart(3, '0'); }

  /* ──────────────────────────────────────
     SRT FORMAT
  ────────────────────────────────────── */
  function toSRT(segments) {
    return segments.map((seg, i) => {
      return [
        `${i + 1}`,
        `${toSRTTime(seg.startTime)} --> ${toSRTTime(seg.endTime)}`,
        seg.text.trim(),
        '',
      ].join('\n');
    }).join('\n');
  }

  /* ──────────────────────────────────────
     VTT FORMAT
  ────────────────────────────────────── */
  function toVTT(segments, styleOptions = {}) {
    const {
      align = 'center',
      position = 'bottom',
    } = styleOptions;

    const header = 'WEBVTT\nKind: subtitles\n';
    const body = segments.map((seg, i) => {
      const posStr = position === 'top'
        ? 'align:center line:10%'
        : position === 'middle'
          ? 'align:center line:50%'
          : 'align:center line:90%';

      return [
        `${i + 1}`,
        `${toVTTTime(seg.startTime)} --> ${toVTTTime(seg.endTime)} ${posStr}`,
        seg.text.trim(),
        '',
      ].join('\n');
    }).join('\n');

    return header + '\n' + body;
  }

  /* ──────────────────────────────────────
     ASS/SSA FORMAT (with full styling)
  ────────────────────────────────────── */
  function toASS(segments, styleOptions = {}) {
    const {
      fontFamily = 'Sarabun',
      fontSize = 26,
      primaryColor = '#FFFFFF',
      outlineColor = '#000000',
      alignment = 2, // 2 = bottom center
      bold = 0,
      italic = 0,
      outline = 2,
      shadow = 1,
      marginV = 20,
    } = styleOptions;

    // Convert HTML color to ASS BGR hex
    function toBGR(hex) {
      const r = hex.slice(1,3);
      const g = hex.slice(3,5);
      const b = hex.slice(5,7);
      return `&H00${b}${g}${r}`.toUpperCase();
    }

    const pc = toBGR(primaryColor);
    const oc = toBGR(outlineColor);

    const header = `[Script Info]
Title: SubAI Export
ScriptType: v4.00+
WrapStyle: 0
PlayResX: 1920
PlayResY: 1080
Timer: 100.0000
YCbCr Matrix: None

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontFamily},${fontSize},${pc},&H000000FF,${oc},&H80000000,${bold},${italic},0,0,100,100,0,0,1,${outline},${shadow},${alignment},10,10,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

    const events = segments.map(seg => {
      const text = seg.text.replace(/\n/g, '\\N').trim();
      return `Dialogue: 0,${toASSTime(seg.startTime)},${toASSTime(seg.endTime)},Default,,0,0,0,,${text}`;
    }).join('\n');

    return header + '\n' + events;
  }

  /* ──────────────────────────────────────
     DOWNLOAD HELPER
  ────────────────────────────────────── */
  function downloadFile(content, filename, mimeType) {
    const blob = new Blob(['\ufeff' + content], { type: mimeType + ';charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /* ──────────────────────────────────────
     COPY TO CLIPBOARD
  ────────────────────────────────────── */
  async function copyToClipboard(segments) {
    const text = segments.map(s => s.text).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    }
  }

  /* ──────────────────────────────────────
     PUBLIC API
  ────────────────────────────────────── */
  function exportSRT(segments, filename = 'subtitles') {
    const content = toSRT(segments);
    downloadFile(content, `${filename}.srt`, 'text/plain');
  }

  function exportVTT(segments, filename = 'subtitles', styleOptions = {}) {
    const content = toVTT(segments, styleOptions);
    downloadFile(content, `${filename}.vtt`, 'text/vtt');
  }

  function exportASS(segments, filename = 'subtitles', styleOptions = {}) {
    const content = toASS(segments, styleOptions);
    downloadFile(content, `${filename}.ass`, 'text/plain');
  }

  function exportTXT(segments, filename = 'subtitles') {
    const content = segments.map((s, i) =>
      `[${formatTime(s.startTime)} - ${formatTime(s.endTime)}]\n${s.text}`
    ).join('\n\n');
    downloadFile(content, `${filename}.txt`, 'text/plain');
  }

  function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${pad2(m)}:${pad2(s)}`;
  }

  return {
    exportSRT,
    exportVTT,
    exportASS,
    exportTXT,
    copyToClipboard,
    toSRT,
    toVTT,
    toASS,
  };

})();

window.ExportEngine = ExportEngine;
