/**
 * SubAI — AI Sentence Intelligence Engine
 * ─────────────────────────────────────────
 * ใช้ LLM (Groq LLaMA / OpenAI GPT) เดารูปประโยค + แก้คำผิด
 * หลังจาก Speech-to-Text transcription
 *
 * ฟีเจอร์:
 * 1. เดาประโยคที่ขาดหายหรือมั่วจาก context รอบข้าง
 * 2. แก้คำที่ออกเสียงคล้ายกันแต่ผิด (homophone correction)
 * 3. แก้ไวยากรณ์ภาษาไทย/อังกฤษ
 * 4. คำนวณ confidence score จาก LLM
 * 5. Fallback เป็น pattern-based เมื่อไม่มี API Key
 */

const AISentenceEngine = (() => {

  /* ── Config ── */
  let groqApiKey   = '';
  let openaiApiKey = '';
  let provider     = 'groq'; // 'groq' | 'openai' | 'local'
  let language     = 'th';
  let onProgress   = null;

  const GROQ_MODEL   = 'llama-3.3-70b-versatile';  // ดีที่สุดสำหรับภาษาไทย
  const OPENAI_MODEL = 'gpt-4o-mini';               // ถูก + เร็ว
  const BATCH_SIZE   = 8;                           // segments ต่อ 1 API call

  /* ── Setup ── */
  function configure({ groqKey, openaiKey, prov, lang, progressCb }) {
    if (groqKey   !== undefined) groqApiKey   = groqKey   || '';
    if (openaiKey !== undefined) openaiApiKey = openaiKey || '';
    if (prov      !== undefined) provider     = prov      || 'local';
    if (lang      !== undefined) language     = lang      || 'th';
    if (progressCb)              onProgress   = progressCb;
  }

  /* ══════════════════════════════════════
     MAIN: แก้ไข segments ทั้งหมด
  ══════════════════════════════════════ */
  async function correctAll(segments, onStep) {
    if (!segments || segments.length === 0) return segments;

    const hasGroq   = provider === 'groq'   && groqApiKey;
    const hasOpenAI = provider === 'openai' && openaiApiKey;
    const useLLM    = hasGroq || hasOpenAI;

    if (!useLLM) {
      /* ── ไม่มี API Key: ใช้ local pattern-based correction ── */
      return localCorrectAll(segments);
    }

    /* ── ใช้ LLM ── */
    const result = [...segments];
    const batches = chunkArray(segments, BATCH_SIZE);
    let processed = 0;

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];

      /* สร้าง context window สำหรับแต่ละ batch */
      const batchWithCtx = batch.map((seg, j) => {
        const globalIdx = i * BATCH_SIZE + j;
        return {
          id     : seg.id,
          text   : seg.text,
          prev   : segments[globalIdx - 1]?.text || '',
          next   : segments[globalIdx + 1]?.text || '',
        };
      });

      if (onStep) onStep(`AI กำลังแก้ประโยค batch ${i+1}/${batches.length}...`);

      try {
        const corrected = await callLLM(batchWithCtx);

        /* map ผลลัพธ์กลับเข้า segments */
        corrected.forEach(fix => {
          const idx = result.findIndex(s => s.id === fix.id);
          if (idx !== -1) {
            result[idx] = {
              ...result[idx],
              text        : fix.text   || result[idx].text,
              confidence  : fix.confidence ?? result[idx].confidence,
              aiFixed     : fix.changed ?? false,
              aiReason    : fix.reason  || '',
              corrections : fix.changed
                ? [...(result[idx].corrections || []), `🧠 AI: ${fix.reason || 'แก้ไขประโยค'}`]
                : (result[idx].corrections || []),
            };
          }
        });

      } catch (err) {
        console.warn(`[AISentence] Batch ${i+1} failed:`, err.message);
        /* ถ้า LLM fail → ใช้ local correction สำหรับ batch นั้น */
        batch.forEach(seg => {
          const idx = result.findIndex(s => s.id === seg.id);
          if (idx !== -1) {
            const fixed = localCorrect(seg, segments);
            result[idx] = { ...result[idx], ...fixed };
          }
        });
      }

      processed += batch.length;
      if (onProgress) onProgress(Math.round((processed / segments.length) * 100));

      /* Rate limit: รอ 300ms ระหว่าง batch */
      if (i < batches.length - 1) await sleep(300);
    }

    return result;
  }

  /* ══════════════════════════════════════
     LLM CALL
  ══════════════════════════════════════ */
  async function callLLM(batchWithCtx) {
    const prompt = buildPrompt(batchWithCtx);

    const endpoint = provider === 'groq'
      ? 'https://api.groq.com/openai/v1/chat/completions'
      : 'https://api.openai.com/v1/chat/completions';

    const model  = provider === 'groq' ? GROQ_MODEL : OPENAI_MODEL;
    const apiKey = provider === 'groq' ? groqApiKey  : openaiApiKey;

    const body = {
      model,
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user',   content: prompt              },
      ],
      temperature     : 0.1,   // ต่ำ = แม่นยำ ไม่สร้างสรรค์เกินไป
      max_tokens      : 2048,
      response_format : { type: 'json_object' },
    };

    const res = await fetch(endpoint, {
      method : 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type' : 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `LLM API: HTTP ${res.status}`);
    }

    const data = await res.json();
    const raw  = data.choices?.[0]?.message?.content || '{"segments":[]}';

    try {
      const parsed = JSON.parse(raw);
      /* รองรับ response ทั้งแบบ {segments:[...]} และ [...] */
      return Array.isArray(parsed)
        ? parsed
        : (parsed.segments || parsed.results || []);
    } catch {
      console.warn('[AISentence] JSON parse failed:', raw.slice(0, 200));
      return [];
    }
  }

  /* ── System Prompt ── */
  function buildSystemPrompt() {
    const langNote = language === 'th'
      ? 'ข้อความเป็นภาษาไทย อาจมีคำทับศัพท์ภาษาอังกฤษปะปน'
      : 'Text is in English.';

    return `คุณเป็น AI ผู้เชี่ยวชาญด้านการแก้ไขซับไตเติ้ลที่ถูก transcribe จากเสียงพูด (Speech-to-Text)
${langNote}

กฎการแก้ไข:
1. แก้ประโยคที่ขาดหาย มั่ว หรือไม่สมบูรณ์ โดยใช้ prev/next เป็น context
2. แก้คำที่ออกเสียงคล้ายกันแต่ผิดความหมาย (เช่น "กาน" → "การ", "ควาน" → "ความ")
3. แก้ไวยากรณ์และการเว้นวรรคให้ถูกต้อง
4. ห้ามเพิ่มเนื้อหาใหม่ที่ไม่มีใน text ต้นฉบับ
5. ถ้าข้อความถูกต้องแล้ว ให้ส่งกลับ text เดิม และ changed: false
6. ตอบกลับเป็น JSON เท่านั้น ห้ามมีข้อความอื่น

Format ตอบกลับ:
{"segments": [{"id": <number>, "text": "<corrected>", "confidence": <0.0-1.0>, "changed": <bool>, "reason": "<brief Thai reason>"}]}`;
  }

  /* ── User Prompt ── */
  function buildPrompt(batchWithCtx) {
    const inputJson = JSON.stringify(batchWithCtx, null, 2);
    return `ตรวจสอบและแก้ไขซับต่อไปนี้:\n\n${inputJson}\n\nตอบเป็น JSON เท่านั้น`;
  }

  /* ══════════════════════════════════════
     LOCAL CORRECTION (ไม่ต้อง API)
     Pattern-based สำหรับ Fallback
  ══════════════════════════════════════ */

  const THAI_HOMOPHONES = [
    // [ผิด, ถูก] — คำที่มักสับสนจาก STT
    ['กาน',   'การ'],  ['กาน์',   'กาน'],
    ['ควาน',  'ความ'], ['ควม',    'ความ'],
    ['ปัน',   'ปั้น'], ['ปัญหา',  'ปัญหา'],
    ['ทำไม',  'ทำไม'], ['ทำใม',   'ทำไม'],
    ['คน',    'คน'],   ['กน',     'คน'],
    ['เรา',   'เรา'],  ['เรำ',    'เรา'],
    ['ไป',    'ไป'],   ['ใป',     'ไป'],
    ['มา',    'มา'],   ['มำ',     'มา'],
    ['ว่า',   'ว่า'],  ['ว้า',    'ว่า'],
    ['ที่',   'ที่'],  ['ทึ่',    'ที่'],
    ['นี้',   'นี้'],  ['นิ้',    'นี้'],
    ['นั้น',  'นั้น'], ['นั้ม',   'นั้น'],
    ['แล้ว',  'แล้ว'], ['แล้ม',   'แล้ว'],
    ['อยาก',  'อยาก'], ['อะยาก',  'อยาก'],
    ['ต้อง',  'ต้อง'], ['ต้อม',   'ต้อง'],
    ['จริง',  'จริง'], ['จริ่ง',  'จริง'],
    ['สาม',   'สาม'],  ['ศาม',    'สาม'],
    ['ห้า',   'ห้า'],  ['ห้ำ',    'ห้า'],
    ['ครับ',  'ครับ'], ['ครัป',   'ครับ'],
    ['นะ',    'นะ'],   ['นะะ',    'นะ'],
    ['ด้วย',  'ด้วย'], ['ด้วน',   'ด้วย'],
    ['เลย',   'เลย'],  ['เลน',    'เลย'],
    ['ก็',    'ก็'],   ['กื็',    'ก็'],
    ['สิ่ง',  'สิ่ง'], ['สิง',    'สิ่ง'],
    ['เพราะ', 'เพราะ'],['เพระ',   'เพราะ'],
    ['อาจ',   'อาจ'],  ['อาด',    'อาจ'],
    ['เช่น',  'เช่น'], ['เช่ม',   'เช่น'],
    ['เป็น',  'เป็น'], ['เป็ม',   'เป็น'],
    ['มี',    'มี'],   ['มีี',    'มี'],
    ['ได้',   'ได้'],  ['ได้้',   'ได้'],
    ['หรือ',  'หรือ'], ['รึ',     'หรือ'],
    ['กับ',   'กับ'],  ['กัป',    'กับ'],
    ['และ',   'และ'],  ['แล',     'และ'],
    ['ของ',   'ของ'],  ['ขอ',     'ของ'],
    ['จาก',   'จาก'],  ['จาค',    'จาก'],
    ['เพื่อ', 'เพื่อ'],['เพือ',   'เพื่อ'],
    ['ถ้า',   'ถ้า'],  ['ถ้ำ',    'ถ้า'],
    ['เมื่อ', 'เมื่อ'],['เมือ',   'เมื่อ'],
  ];

  const REPEATED_CHAR = /(.)\1{3,}/g;
  const MULTI_SPACE   = /\s{2,}/g;
  const TRAILING_PUNCT = /[,،、，]\s*$/;

  function localCorrect(seg, allSegs = []) {
    let text = seg.text || '';
    let changed = false;
    const reasons = [];

    /* 1. ล้าง repeated chars */
    const dedup = text.replace(REPEATED_CHAR, '$1$1');
    if (dedup !== text) { text = dedup; changed = true; reasons.push('ลบตัวอักษรซ้ำ'); }

    /* 2. ล้าง multi-space */
    const trimmed = text.replace(MULTI_SPACE, ' ').trim();
    if (trimmed !== text) { text = trimmed; changed = true; }

    /* 3. Homophone correction */
    for (const [wrong, right] of THAI_HOMOPHONES) {
      if (text.includes(wrong)) {
        const fixed = text.split(wrong).join(right);
        if (fixed !== text) {
          text = fixed; changed = true;
          reasons.push(`แก้ "${wrong}" → "${right}"`);
        }
      }
    }

    /* 4. ลบ trailing comma */
    const noTrail = text.replace(TRAILING_PUNCT, '.');
    if (noTrail !== text) { text = noTrail; changed = true; reasons.push('แก้เครื่องหมายท้ายประโยค'); }

    /* 5. Capitalize ถ้าเป็นอังกฤษ */
    if (language !== 'th' && text.length > 0) {
      const cap = text.charAt(0).toUpperCase() + text.slice(1);
      if (cap !== text) { text = cap; changed = true; }
    }

    return {
      ...seg,
      text,
      aiFixed  : changed,
      aiReason : reasons.join(', '),
      corrections: changed
        ? [...(seg.corrections || []), `🔧 Local: ${reasons.join(', ')}`]
        : (seg.corrections || []),
    };
  }

  function localCorrectAll(segments) {
    return segments.map(seg => localCorrect(seg, segments));
  }

  /* ══════════════════════════════════════
     SINGLE SEGMENT CORRECTION (on-demand)
     เรียกเมื่อ user กดปุ่ม "AI แก้" บน segment
  ══════════════════════════════════════ */
  async function correctSingle(seg, prevSeg = null, nextSeg = null) {
    const hasLLM = (provider === 'groq' && groqApiKey) || (provider === 'openai' && openaiApiKey);

    if (!hasLLM) {
      return localCorrect(seg);
    }

    const batchCtx = [{
      id  : seg.id,
      text: seg.text,
      prev: prevSeg?.text || '',
      next: nextSeg?.text || '',
    }];

    try {
      const result = await callLLM(batchCtx);
      const fix    = result.find(r => r.id === seg.id) || result[0];
      if (!fix) return localCorrect(seg);

      return {
        ...seg,
        text       : fix.text        || seg.text,
        confidence : fix.confidence  ?? seg.confidence,
        aiFixed    : fix.changed     ?? false,
        aiReason   : fix.reason      || '',
        corrections: fix.changed
          ? [...(seg.corrections || []), `🧠 AI: ${fix.reason || 'แก้ไขประโยค'}`]
          : (seg.corrections || []),
      };
    } catch (err) {
      console.warn('[AISentence.correctSingle]', err.message);
      return localCorrect(seg);
    }
  }

  /* ══════════════════════════════════════
     SENTENCE COMPLETION
     เดาประโยคที่ขาดหายไปจาก context
  ══════════════════════════════════════ */
  async function completeSentence(partialText, prevText = '', nextText = '') {
    const hasLLM = (provider === 'groq' && groqApiKey) || (provider === 'openai' && openaiApiKey);

    if (!hasLLM) {
      return { completed: partialText, confidence: 0.5, source: 'local' };
    }

    const langNote = language === 'th' ? 'ภาษาไทย' : 'English';
    const systemMsg = `คุณเป็น AI เดาประโยคที่ขาดหายจาก speech-to-text (${langNote})
ตอบกลับเป็น JSON: {"completed": "<full sentence>", "confidence": <0-1>}
ห้ามเพิ่มเนื้อหาที่ไม่เกี่ยวข้อง`;

    const userMsg = `ประโยคก่อนหน้า: "${prevText}"
ประโยคที่ขาดหาย/ไม่สมบูรณ์: "${partialText}"
ประโยคถัดไป: "${nextText}"

เดาว่าประโยคที่สมบูรณ์คืออะไร`;

    try {
      const endpoint = provider === 'groq'
        ? 'https://api.groq.com/openai/v1/chat/completions'
        : 'https://api.openai.com/v1/chat/completions';
      const model  = provider === 'groq' ? GROQ_MODEL   : OPENAI_MODEL;
      const apiKey = provider === 'groq' ? groqApiKey   : openaiApiKey;

      const res = await fetch(endpoint, {
        method : 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body   : JSON.stringify({
          model,
          messages   : [{ role: 'system', content: systemMsg }, { role: 'user', content: userMsg }],
          temperature: 0.2,
          max_tokens : 200,
          response_format: { type: 'json_object' },
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const raw  = data.choices?.[0]?.message?.content || '{}';
      const json = JSON.parse(raw);
      return { completed: json.completed || partialText, confidence: json.confidence || 0.8, source: 'llm' };
    } catch (err) {
      console.warn('[AISentence.completeSentence]', err.message);
      return { completed: partialText, confidence: 0.5, source: 'local' };
    }
  }

  /* ══════════════════════════════════════
     UTILITIES
  ══════════════════════════════════════ */
  function chunkArray(arr, size) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function isAvailable() {
    return (provider === 'groq' && !!groqApiKey) ||
           (provider === 'openai' && !!openaiApiKey);
  }

  /* ── Public API ── */
  return {
    configure,
    correctAll,
    correctSingle,
    completeSentence,
    localCorrectAll,
    localCorrect,
    isAvailable,
  };

})();

window.AISentenceEngine = AISentenceEngine;
