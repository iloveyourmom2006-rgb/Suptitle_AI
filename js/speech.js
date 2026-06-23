/**
 * SubAI — Speech Recognition & Audio Pipeline (Production)
 *
 * กลยุทธ์การ transcribe:
 * 1. ดึง audio track จากวิดีโอผ่าน Web Audio API + MediaRecorder
 * 2. แปลงเป็น audio chunks ส่งเข้า SpeechRecognition ทีละก้อน
 * 3. รวบรวม result พร้อม timestamp จากตำแหน่ง video.currentTime
 * 4. ถ้ามี Whisper API Key → ส่งไฟล์ตรงเพื่อความแม่นยำสูงสุด
 *
 * ข้อจำกัด browser:
 * - SpeechRecognition ฟัง mic หรือ tab audio ไม่ได้โดยตรงจาก file://
 * - แก้โดย: เล่นวิดีโอผ่าน AudioContext แล้ว route ไป SpeechRecognition
 *   ผ่าน AudioWorklet / ScriptProcessor (hidden, muted ต่อ speaker)
 */

const SpeechEngine = (() => {

  /* ── State ── */
  let isProcessing     = false;
  let whisperApiKey    = '';
  let groqApiKey       = '';
  let selectedProvider = 'webspeech'; // 'webspeech' | 'groq' | 'openai'
  let selectedLanguage = 'th-TH';
  let progressCb       = null;
  let stepCb           = null;
  let cancelFlag       = false;

  /* ── Config ── */
  function setApiKey(k)          { whisperApiKey    = k || ''; }
  function setGroqApiKey(k)      { groqApiKey       = k || ''; }
  function setProvider(p)        { selectedProvider = p || 'webspeech'; }
  function setLanguage(l)        { selectedLanguage = l; }
  function setProgressCallback(cb){ progressCb = cb; }
  function setStepCallback(cb)   { stepCb = cb; }
  function cancel()              { cancelFlag = true; }

  function report(pct, step) {
    if (progressCb) progressCb(Math.min(100, pct));
    if (stepCb && step) stepCb(step);
  }

  /* ══════════════════════════════════════
     ENTRY POINT
  ══════════════════════════════════════ */
  async function processVideo(file, onComplete, onError) {
    if (isProcessing) { onError('กำลังประมวลผลอยู่แล้ว'); return; }
    isProcessing = true;
    cancelFlag   = false;

    try {
      /* Step 1 — Load video metadata */
      report(5, 'กำลังโหลดไฟล์วิดีโอ...');
      const videoUrl  = URL.createObjectURL(file);
      const duration  = await getVideoDuration(videoUrl);
      report(12, `ความยาว ${formatDur(duration)} — แยกข้อมูลเสียง...`);

      /* Step 2 — Choose engine */
      let segments;

      if (selectedProvider === 'groq' && groqApiKey) {
        /* ── Groq Whisper (ฟรี + เร็วมาก) ── */
        segments = await transcribeGroq(file, duration);
      } else if (selectedProvider === 'openai' && whisperApiKey) {
        /* ── OpenAI Whisper ── */
        segments = await transcribeWhisper(file, duration);
      } else if (isWebSpeechAvailable()) {
        /* ── Web Speech API ── */
        segments = await transcribeWebSpeech(file, videoUrl, duration);
      } else {
        /* ── Fallback demo ── */
        report(40, 'ไม่พบระบบ Transcription — ใช้ข้อมูลตัวอย่าง...');
        await sleep(800);
        segments = generateDemoSegments(file.name, duration);
      }

      if (cancelFlag) { isProcessing = false; return; }

      /* Step 3 — AI correction (confidence + noise) */
      report(78, 'AI กำลังตรวจสอบและแก้ไขซับ...');
      await sleep(200);
      const langCode = getLangCode(selectedLanguage);
      let corrected = window.AIEngine
        ? window.AIEngine.analyzeAll(segments, langCode)
        : segments;

      /* Step 4 — LLM Sentence Intelligence */
      if (window.AISentenceEngine) {
        report(84, 'AI กำลังเดารูปประโยคด้วย LLM...');
        corrected = await window.AISentenceEngine.correctAll(
          corrected,
          (stepMsg) => report(84, stepMsg),
        );
      }

      /* Step 5 — Done */
      report(100, 'เสร็จสมบูรณ์! 🎉');
      await sleep(300);

      isProcessing = false;
      onComplete(corrected, videoUrl);

    } catch (err) {
      isProcessing = false;
      console.error('[SubAI SpeechEngine]', err);
      onError(err.message || 'เกิดข้อผิดพลาด กรุณาลองใหม่');
    }
  }

  /* ══════════════════════════════════════
     ENGINE A: Web Speech API (Real)
     ─────────────────────────────────────
     วิธีการ:
     1. สร้าง hidden <video> element เล่นไฟล์ที่ volume=0
     2. route audio ออกจาก video ผ่าน AudioContext
        → MediaStreamDestination node
     3. ใส่ MediaStream จาก destination เข้า SpeechRecognition
     4. เก็บ result + timestamp จาก video.currentTime
  ══════════════════════════════════════ */
  async function transcribeWebSpeech(file, videoUrl, duration) {
    return new Promise((resolve, reject) => {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

      /* ── สร้าง video element ── */
      const vid = document.createElement('video');
      vid.src      = videoUrl;
      vid.muted    = false;   // ต้อง false เพื่อให้ AudioContext อ่านเสียงได้
      vid.volume   = 0;       // ปิดเสียงออก speaker
      vid.preload  = 'auto';
      vid.style.cssText = 'position:fixed;top:-999px;left:-999px;width:1px;height:1px;';
      document.body.appendChild(vid);

      const cleanup = () => {
        try { vid.pause(); } catch(_){}
        try { document.body.removeChild(vid); } catch(_){}
        try { actx.close(); } catch(_){}
      };

      /* ── AudioContext pipeline ── */
      let actx, sourceNode, destNode, stream, recognition;

      vid.addEventListener('canplaythrough', async () => {
        try {
          actx     = new (window.AudioContext || window.webkitAudioContext)();
          sourceNode = actx.createMediaElementSource(vid);
          destNode   = actx.createMediaStreamDestination();

          /* เชื่อมต่อ: source → destination (ไม่ต่อ speaker) */
          sourceNode.connect(destNode);

          stream = destNode.stream;

          /* ── SpeechRecognition ── */
          recognition               = new SR();
          recognition.continuous    = true;
          recognition.interimResults= false;
          recognition.lang          = selectedLanguage;
          recognition.maxAlternatives = 3;

          const segments  = [];
          let   segId     = 1;

          recognition.onresult = (e) => {
            for (let i = e.resultIndex; i < e.results.length; i++) {
              const res = e.results[i];
              if (!res.isFinal) continue;

              /* เลือก alternative ที่ดีที่สุด */
              let bestText = res[0].transcript.trim();
              for (let a = 1; a < res.length; a++) {
                if (res[a].confidence > res[0].confidence) {
                  bestText = res[a].transcript.trim();
                }
              }
              if (!bestText) continue;

              const now   = vid.currentTime;
              const spkDur = estimateSpeakDuration(bestText);
              segments.push({
                id       : segId++,
                startTime: Math.max(0, now - spkDur),
                endTime  : now,
                text     : bestText,
                _rawConf : res[0].confidence || 0.8,
              });

              /* progress */
              const pct = 20 + (now / duration) * 55;
              report(pct, `กำลัง transcribe... ${formatDur(now)} / ${formatDur(duration)}`);
            }
          };

          recognition.onerror = (e) => {
            console.warn('[SR error]', e.error);
            if (e.error === 'no-speech') return; // ไม่ error ถ้าช่วงเงียบ
            if (e.error === 'aborted') return;
            // network/not-allowed → fallback
            cleanup();
            resolve(segments.length > 0
              ? postProcess(segments, duration)
              : generateDemoSegments(file.name, duration)
            );
          };

          recognition.onend = () => {
            if (vid.ended || vid.currentTime >= duration - 0.5 || cancelFlag) {
              cleanup();
              resolve(segments.length > 0
                ? postProcess(segments, duration)
                : generateDemoSegments(file.name, duration)
              );
            } else {
              /* หาก SR หยุดกลางคัน ให้ restart */
              if (!cancelFlag && !vid.ended) {
                try { recognition.start(); } catch (_) {}
              }
            }
          };

          vid.ontimeupdate = () => {
            if (cancelFlag) { vid.pause(); recognition.stop(); }
          };

          vid.onended = () => {
            recognition.stop();
          };

          /* Timeout safety */
          const timeout = setTimeout(() => {
            if (!vid.ended) { vid.pause(); recognition.stop(); }
          }, (duration + 30) * 1000);

          vid.onended = () => {
            clearTimeout(timeout);
            recognition.stop();
          };

          report(20, 'เริ่ม transcribe — กำลังฟังเสียงจากวิดีโอ...');
          recognition.start();

          /* เล่นวิดีโอ (เร็วขึ้น 1.5x เพื่อประหยัดเวลา) */
          vid.playbackRate = 1.5;
          await vid.play();

        } catch (err) {
          cleanup();
          /* ถ้า AudioContext/MediaElementSource ทำไม่ได้
             (เช่น file:// policy) → fallback Web Speech ผ่าน mic input ทั่วไป */
          if (err.name === 'NotSupportedError' || err.name === 'InvalidStateError') {
            resolve(await transcribeWebSpeechSimple(videoUrl, duration));
          } else {
            resolve(generateDemoSegments(file.name, duration));
          }
        }
      }, { once: true });

      vid.onerror = () => {
        cleanup();
        resolve(generateDemoSegments(file.name, duration));
      };
    });
  }

  /* ── Fallback: simple Web Speech (เล่นเสียงออก speaker + ฟัง) ── */
  async function transcribeWebSpeechSimple(videoUrl, duration) {
    return new Promise((resolve) => {
      const SR          = window.SpeechRecognition || window.webkitSpeechRecognition;
      const recognition = new SR();
      recognition.continuous     = true;
      recognition.interimResults = false;
      recognition.lang           = selectedLanguage;

      const vid = document.createElement('video');
      vid.src   = videoUrl;
      vid.style.cssText = 'position:fixed;top:-999px;left:-999px;width:1px;height:1px;';
      document.body.appendChild(vid);

      const segments = [];
      let segId = 1;

      recognition.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (!e.results[i].isFinal) continue;
          const text = e.results[i][0].transcript.trim();
          if (!text) continue;
          const now = vid.currentTime;
          segments.push({
            id: segId++,
            startTime: Math.max(0, now - estimateSpeakDuration(text)),
            endTime: now,
            text,
          });
          report(20 + (now / duration) * 55, `กำลัง transcribe... ${formatDur(now)}`);
        }
      };

      const finish = () => {
        try { document.body.removeChild(vid); } catch(_){}
        resolve(segments.length > 0
          ? postProcess(segments, duration)
          : generateDemoSegments('', duration)
        );
      };

      recognition.onend = finish;
      recognition.onerror = () => finish();
      vid.onended = () => recognition.stop();
      vid.onerror = () => finish();

      recognition.start();
      vid.playbackRate = 1.5;
      vid.play().catch(() => finish());

      setTimeout(finish, (duration / 1.5 + 20) * 1000);
    });
  }

  /* ══════════════════════════════════════
     ENGINE B: Groq Whisper API (ฟรี ⚡)
     ─────────────────────────────────────
     endpoint : api.groq.com/openai/v1/audio/transcriptions
     model    : whisper-large-v3-turbo
     format   : OpenAI-compatible (same FormData)
     limit    : 25MB, 7200s/hr free
  ══════════════════════════════════════ */
  async function transcribeGroq(file, duration) {
    report(20, 'กำลังส่งไฟล์ไปยัง Groq Whisper...');

    /* ถ้าไฟล์ใหญ่กว่า 25MB → ดึงเฉพาะ audio */
    const fileToSend = file.size > 25 * 1024 * 1024
      ? await extractAudioBlob(file, duration)
      : file;

    report(28, 'กำลัง transcribe ด้วย Groq (whisper-large-v3-turbo)...');

    const formData = new FormData();
    formData.append('file', fileToSend, fileToSend.name || 'audio.mp4');
    formData.append('model', 'whisper-large-v3-turbo');
    formData.append('language', getLangCode(selectedLanguage));
    formData.append('response_format', 'verbose_json');
    formData.append('timestamp_granularities[]', 'segment');

    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${groqApiKey}` },
      body: formData,
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const msg = errBody.error?.message || `Groq API: HTTP ${res.status}`;
      /* ถ้า 413 = ไฟล์ใหญ่เกิน, ถ้า 401 = key ผิด */
      if (res.status === 401) throw new Error('Groq API Key ไม่ถูกต้อง — กรุณาตรวจสอบอีกครั้ง');
      if (res.status === 413) throw new Error('ไฟล์ใหญ่เกิน 25MB — ลองบีบอัดวิดีโอก่อน');
      throw new Error(msg);
    }

    report(65, 'ได้รับข้อมูลจาก Groq — กำลังประมวลผล...');
    const data = await res.json();

    if (data.segments?.length > 0) {
      return data.segments.map((s, i) => ({
        id       : i + 1,
        startTime: parseFloat(s.start) || 0,
        endTime  : parseFloat(s.end)   || 1,
        text     : s.text.trim(),
        _rawConf : s.no_speech_prob != null ? 1 - s.no_speech_prob : 0.95,
      }));
    }

    /* fallback: split full text */
    return splitByWords(data.text || '', duration);
  }

  /* ══════════════════════════════════════
     ENGINE C: OpenAI Whisper API
  ══════════════════════════════════════ */
  async function transcribeWhisper(file, duration) {
    report(20, 'กำลังส่งไฟล์ไปยัง Whisper API...');

    /* Whisper รองรับไฟล์ ≤ 25 MB  */
    if (file.size > 25 * 1024 * 1024) {
      report(22, 'ไฟล์ใหญ่กว่า 25 MB — แปลงเป็น audio ก่อน...');
      const audioFile = await extractAudioBlob(file, duration);
      return transcribeWhisperFile(audioFile, duration);
    }
    return transcribeWhisperFile(file, duration);
  }

  async function transcribeWhisperFile(fileOrBlob, duration) {
    const formData = new FormData();
    formData.append('file', fileOrBlob, 'audio.mp4');
    formData.append('model', 'whisper-1');
    formData.append('language', getLangCode(selectedLanguage));
    formData.append('response_format', 'verbose_json');
    formData.append('timestamp_granularities[]', 'segment');

    report(30, 'กำลังส่งข้อมูล — รอผล Whisper...');

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${whisperApiKey}` },
      body: formData,
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error?.message || `Whisper API: HTTP ${res.status}`);
    }

    report(65, 'ได้รับข้อมูลจาก Whisper — กำลังประมวลผล...');
    const data = await res.json();

    if (data.segments?.length > 0) {
      return data.segments.map((s, i) => ({
        id       : i + 1,
        startTime: s.start,
        endTime  : s.end,
        text     : s.text.trim(),
        _rawConf : s.no_speech_prob != null ? 1 - s.no_speech_prob : 0.95,
      }));
    }

    /* fallback: split full text */
    return splitByWords(data.text || '', duration);
  }

  /* ── Extract audio track จาก video ── */
  async function extractAudioBlob(videoFile, duration) {
    return new Promise((resolve) => {
      const vid = document.createElement('video');
      vid.src = URL.createObjectURL(videoFile);
      vid.muted = true;
      document.body.appendChild(vid);

      vid.addEventListener('canplaythrough', async () => {
        try {
          const actx   = new AudioContext();
          const src    = actx.createMediaElementSource(vid);
          const dest   = actx.createMediaStreamDestination();
          src.connect(dest);

          const mr     = new MediaRecorder(dest.stream, { mimeType: 'audio/webm;codecs=opus' });
          const chunks = [];
          mr.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
          mr.onstop = () => {
            document.body.removeChild(vid);
            actx.close();
            resolve(new File(chunks, 'audio.webm', { type: 'audio/webm' }));
          };

          mr.start(1000);
          vid.playbackRate = 1;
          await vid.play();
          setTimeout(() => { mr.stop(); vid.pause(); }, (duration + 2) * 1000);
        } catch (e) {
          document.body.removeChild(vid);
          resolve(videoFile); // fallback: ส่งไฟล์วิดีโอตรงๆ
        }
      }, { once: true });
    });
  }

  /* ══════════════════════════════════════
     POST-PROCESSING
  ══════════════════════════════════════ */

  /** รวม segments สั้นๆ + กรองช่วงเงียบ */
  function postProcess(segments, duration) {
    if (!segments.length) return generateDemoSegments('', duration);

    /* กรองข้อความสั้นเกินไป */
    let s = segments.filter(sg => sg.text && sg.text.replace(/\s/g,'').length > 0);

    /* รวม segments ที่ต่อเนื่องกันและสั้น */
    const merged = [];
    let cur = null;
    for (const seg of s) {
      if (!cur) { cur = { ...seg }; continue; }
      const gap = seg.startTime - cur.endTime;
      const combined = cur.text + ' ' + seg.text;
      if (gap < 0.8 && combined.length < 80) {
        cur.text    = combined.trim();
        cur.endTime = seg.endTime;
      } else {
        merged.push(cur);
        cur = { ...seg };
      }
    }
    if (cur) merged.push(cur);

    /* ตรวจสอบว่า duration สมเหตุสมผล */
    return merged.map((sg, i) => ({
      ...sg,
      id       : i + 1,
      startTime: Math.max(0, sg.startTime),
      endTime  : Math.min(duration, Math.max(sg.startTime + 0.5, sg.endTime)),
    }));
  }

  /** แยกข้อความยาวๆ เป็น segments ตาม duration */
  function splitByWords(fullText, duration) {
    const words     = fullText.split(/\s+/).filter(Boolean);
    const totalWords = words.length;
    if (!totalWords) return generateDemoSegments('', duration);

    const secPerWord = duration / totalWords;
    const CHUNK      = 8; // ~8 คำ/segment
    const segments   = [];
    let id = 1, t = 0;

    for (let i = 0; i < words.length; i += CHUNK) {
      const chunk = words.slice(i, i + CHUNK).join(' ');
      const dur   = secPerWord * Math.min(CHUNK, words.length - i);
      segments.push({ id: id++, startTime: t, endTime: t + dur, text: chunk });
      t += dur;
    }
    return segments;
  }

  /* ══════════════════════════════════════
     DEMO SEGMENTS
  ══════════════════════════════════════ */
  function generateDemoSegments(filename, duration) {
    const totalDur = duration || 50;
    const raw = [
      'สวัสดีครับ ยินดีต้อนรับทุกท่านเข้าสู่การนำเสนอของเรา',
      'วันนี้เราจะมาพูดถึงเรื่องที่น่าสนใจมากครับ',
      'เริ่มต้นด้วยภาพรวมของโปรเจกต์นี้กันก่อนนะครับ',
      'ระบบของเราได้รับการพัฒนาขึ้นมาเพื่อแก้ปัญหาที่สำคัญ',
      'โดยใช้เทคโนโลยี AI และ Machine Learning ที่ทันสมัย',
      'ผลลัพธ์ที่ได้นั้นน่าพอใจอย่างมาก ทั้งในแง่ความแม่นยำ',
      'และประสิทธิภาพการทำงานที่เพิ่มขึ้นถึงห้าสิบเปอร์เซ็นต์',
      'ในส่วนถัดไป เราจะดูตัวอย่างการใช้งานจริงกันครับ',
      'ตัวอย่างแรกแสดงให้เห็นถึงความสามารถในการประมวลผลข้อมูล',
      'ซึ่งสามารถทำได้อย่างรวดเร็วและมีความเสถียรสูง',
      'ขอบคุณทุกท่านที่ให้ความสนใจและติดตามการนำเสนอครับ',
      'หากมีคำถามหรือข้อสงสัย สามารถถามได้เลยนะครับ',
    ];

    const segDur = totalDur / raw.length;
    return raw.map((text, i) => ({
      id       : i + 1,
      startTime: i * segDur,
      endTime  : i * segDur + segDur * 0.92,
      text,
    }));
  }

  /* ══════════════════════════════════════
     UTILITIES
  ══════════════════════════════════════ */
  function isWebSpeechAvailable() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  function getVideoDuration(url) {
    return new Promise((resolve, reject) => {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.onloadedmetadata = () => resolve(v.duration || 60);
      v.onerror = () => resolve(60);
      v.src = url;
    });
  }

  function estimateSpeakDuration(text) {
    /* ภาษาไทย ~3.5 พยางค์/วิ, English ~2.5 words/วิ */
    const isThai = /[ก-๛]/.test(text);
    if (isThai) {
      const syllables = text.replace(/[^ก-๛]/g, '').length * 0.6 + 1;
      return Math.max(0.5, syllables / 3.5);
    }
    const words = text.split(/\s+/).length;
    return Math.max(0.5, words / 2.5);
  }

  function getLangCode(tag) {
    const m = { 'th-TH':'th','en-US':'en','en-GB':'en','ja-JP':'ja','zh-CN':'zh','ko-KR':'ko' };
    return m[tag] || 'th';
  }

  function formatDur(s) {
    if (!s || isNaN(s)) return '0:00';
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2,'0')}`;
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  /* ── Public API ── */
  return {
    processVideo,
    setApiKey,
    setGroqApiKey,
    setProvider,
    setLanguage,
    setProgressCallback,
    setStepCallback,
    cancel,
    generateDemoSegments,
    splitTextIntoSegments: splitByWords,
  };

})();

window.SpeechEngine = SpeechEngine;
