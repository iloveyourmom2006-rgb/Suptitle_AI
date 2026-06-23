/**
 * SubAI — AI Subtitle Correction Engine
 * ระบบ AI ตรวจสอบและแก้ไขซับไตเติ้ล
 */

const AIEngine = (() => {

  /* ── Common Thai words & patterns ── */
  const THAI_COMMON_WORDS = [
    'และ','หรือ','แต่','ที่','ใน','บน','กับ','จาก','ของ','เพื่อ',
    'เป็น','มี','ได้','ไม่','จะ','ก็','แล้ว','ว่า','นี้','นั้น',
    'การ','ความ','คน','เรา','เขา','เธอ','มัน','คุณ','ผม','ฉัน',
    'ดี','สวย','งาม','ใหม่','เก่า','ใหญ่','เล็ก','มาก','น้อย',
    'ไป','มา','ออก','เข้า','ขึ้น','ลง','กลับ','ต้อง','อยาก','ชอบ',
    'รู้','เห็น','ฟัง','พูด','บอก','ถาม','ตอบ','ทำ','สร้าง','เปลี่ยน',
    'วัน','เดือน','ปี','เวลา','ตอน','เมื่อ','หลัง','ก่อน',
    'บ้าน','โรงเรียน','ที่ทำงาน','ร้าน','เมือง','ประเทศ',
    'ครอบครัว','พ่อ','แม่','พี่','น้อง','เพื่อน','ครู',
    'อาหาร','น้ำ','ข้าว','หมู','ไก่','ผัก','ผลไม้',
    'สุขภาพ','โรค','หมอ','ยา','โรงพยาบาล',
    'เงิน','งาน','ราคา','ถูก','แพง',
    'ภาษา','คำ','ประโยค','เรื่อง','เนื้อหา',
    'ดี','เยี่ยม','ยอดเยี่ยม','สมบูรณ์','ถูกต้อง',
    'ปัญหา','แก้ไข','ช่วย','สนับสนุน',
    'เริ่ม','จบ','สิ้นสุด','ต่อ','ดำเนิน',
    'นะ','ครับ','ค่ะ','นะครับ','นะคะ','เลย','ด้วย','ก็ได้',
  ];

  const ENGLISH_COMMON_WORDS = [
    'the','a','an','is','are','was','were','be','been','being',
    'have','has','had','do','does','did','will','would','could','should',
    'may','might','shall','can','must','need','dare','ought',
    'and','or','but','if','because','although','while','when','where',
    'what','which','who','whom','whose','how','why','that','this',
    'these','those','here','there','now','then','today','yesterday',
    'I','you','he','she','it','we','they','me','him','her','us','them',
    'my','your','his','her','its','our','their','mine','yours',
    'not','no','yes','never','always','sometimes','often',
    'very','really','quite','just','also','too','even',
    'good','bad','big','small','new','old','great','little',
    'go','come','get','make','take','see','know','think','say','tell',
    'use','find','give','live','work','call','try','ask','need',
    'want','look','feel','become','leave','put','mean','keep',
    'let','begin','show','hear','play','run','move','live',
    'all','each','every','both','few','more','most','other','some','such',
    'than','then','so','only','out','up','about','into','after','before',
    'well','back','still','way','first','time','day','year','people',
    'man','woman','child','hand','part','place','case','week','company',
    'eye','point','government','life','city','number','group','problem',
    'fact',
  ];

  // Common word pairs for N-gram analysis
  const COMMON_BIGRAMS = {
    'i am': 0.95, 'i have': 0.93, 'it is': 0.94, 'we are': 0.92,
    'you are': 0.91, 'this is': 0.93, 'there is': 0.90, 'he is': 0.92,
    'she is': 0.91, 'they are': 0.90, 'i will': 0.92, 'i can': 0.91,
    'do not': 0.93, 'does not': 0.91, 'did not': 0.90, 'is not': 0.92,
    'are not': 0.89, 'was not': 0.90, 'have been': 0.91, 'will be': 0.90,
    'would be': 0.89, 'can be': 0.90, 'to be': 0.93, 'of the': 0.95,
    'in the': 0.94, 'on the': 0.93, 'at the': 0.92, 'for the': 0.92,
    'with the': 0.91, 'from the': 0.90, 'to the': 0.92, 'and the': 0.91,
    'that the': 0.90, 'it was': 0.91, 'he was': 0.90, 'she was': 0.90,
    'they were': 0.89, 'we were': 0.89, 'i was': 0.93, 'you were': 0.89,
  };

  /* ── Noise patterns to detect ── */
  const NOISE_PATTERNS = [
    /\[.*?\]/g,       // [noise], [music]
    /\(.*?\)/g,       // (background sound)
    /♪+/g,            // music symbols
    /\.{3,}/g,        // excessive dots ...
    /[^ก-๛a-zA-Z0-9\s.,!?'":\-()[\]]/g, // unusual symbols (keep Thai + common)
    /(\b\w\b\s){3,}/g, // too many single chars
  ];

  const BROKEN_INDICATORS = [
    /^[^ก-๛a-zA-ZA-Z]/,       // starts with special char
    /[A-Z]{5,}/,                // too many caps
    /(.)\1{4,}/,                // repeated chars
    /\d{8,}/,                   // very long numbers
  ];

  /* ── Sentence completion patterns ── */
  const SENTENCE_ENDERS = /[.!?।…ๆ。！？]$/;
  const SENTENCE_STARTERS = /^[A-Zก-๙"'(]/;

  /* ─────────────────────────────────────────
     PUBLIC API
  ───────────────────────────────────────── */

  /**
   * Main function: analyze and correct a subtitle segment
   * @param {string} text  - raw transcribed text
   * @param {string} prevText - previous segment (context)
   * @param {string} nextText - next segment (context)
   * @param {string} lang  - 'th' | 'en' | 'auto'
   * @returns {{ corrected: string, confidence: number, issues: string[], corrections: string[] }}
   */
  function analyzeSegment(text, prevText = '', nextText = '', lang = 'auto') {
    if (!text || text.trim() === '') {
      return { corrected: text, confidence: 0, issues: ['empty'], corrections: [] };
    }

    const detectedLang = lang === 'auto' ? detectLanguage(text) : lang;
    const issues = [];
    const corrections = [];
    let corrected = text.trim();

    // Step 1: Clean noise
    const cleaned = cleanNoise(corrected);
    if (cleaned !== corrected) {
      corrections.push(`ลบ noise: "${corrected.slice(0,20)}" → "${cleaned.slice(0,20)}"`);
      corrected = cleaned;
    }

    // Step 2: Check for broken patterns
    const broken = detectBrokenPatterns(corrected);
    if (broken.length > 0) {
      issues.push(...broken);
    }

    // Step 3: Fix capitalization
    if (detectedLang === 'en') {
      const capitalized = fixCapitalization(corrected);
      if (capitalized !== corrected) {
        corrections.push('แก้ตัวพิมพ์ใหญ่-เล็ก');
        corrected = capitalized;
      }
    }

    // Step 4: Fix punctuation
    const punctuated = fixPunctuation(corrected, detectedLang);
    if (punctuated !== corrected) {
      corrections.push('แก้เครื่องหมายวรรคตอน');
      corrected = punctuated;
    }

    // Step 5: Context prediction - fill gaps
    if (corrected.endsWith('-') || corrected.endsWith('...')) {
      const predicted = predictMissingEnd(corrected, nextText, detectedLang);
      if (predicted) {
        corrected = corrected.replace(/-$|\.{3}$/, predicted);
        corrections.push('AI เติมประโยคที่ขาดหาย');
      }
    }

    // Step 6: Calculate confidence score
    const confidence = calculateConfidence(corrected, prevText, nextText, detectedLang, issues);

    return {
      corrected: corrected.trim(),
      confidence,
      issues,
      corrections,
      language: detectedLang,
    };
  }

  /**
   * Batch analyze array of subtitle segments
   */
  function analyzeAll(segments, lang = 'auto') {
    return segments.map((seg, i) => {
      const prev = i > 0 ? segments[i-1].text : '';
      const next = i < segments.length - 1 ? segments[i+1].text : '';
      const result = analyzeSegment(seg.text, prev, next, lang);
      return { ...seg, ...result, text: result.corrected };
    });
  }

  /**
   * Predict word given partial text & context
   */
  function predictWord(partial, context = '', lang = 'auto') {
    const detectedLang = lang === 'auto' ? detectLanguage(partial + ' ' + context) : lang;
    const wordList = detectedLang === 'th' ? THAI_COMMON_WORDS : ENGLISH_COMMON_WORDS;
    const lastWord = partial.trim().split(/\s+/).pop().toLowerCase();

    if (!lastWord) return [];

    const candidates = wordList.filter(w =>
      w.toLowerCase().startsWith(lastWord) && w !== lastWord
    ).slice(0, 5);

    return candidates;
  }

  /* ─────────────────────────────────────────
     PRIVATE HELPERS
  ───────────────────────────────────────── */

  function detectLanguage(text) {
    const thaiChars = (text.match(/[ก-๛]/g) || []).length;
    const latinChars = (text.match(/[a-zA-Z]/g) || []).length;
    if (thaiChars > latinChars) return 'th';
    if (latinChars > 0) return 'en';
    return 'th'; // default
  }

  function cleanNoise(text) {
    let cleaned = text;
    // Remove common noise markers
    cleaned = cleaned.replace(/\[.*?\]/g, '').trim();
    cleaned = cleaned.replace(/♪[^♪]*♪/g, '').trim();
    cleaned = cleaned.replace(/♪/g, '').trim();
    // Remove multiple spaces
    cleaned = cleaned.replace(/\s{2,}/g, ' ');
    return cleaned.trim();
  }

  function detectBrokenPatterns(text) {
    const found = [];
    if (/[A-Z]{6,}/.test(text)) found.push('ALL_CAPS_NOISE');
    if (/(.)\1{5,}/.test(text)) found.push('REPEATED_CHARS');
    if (text.length < 2) found.push('TOO_SHORT');
    if (/^\d+$/.test(text)) found.push('NUMBERS_ONLY');
    if (/[^\u0000-\u024F\u0E00-\u0E7F\u3000-\u303F\u3040-\u30FF\u4E00-\u9FFF]/g.test(text)) {
      // non-standard Unicode range - might have garbage
    }
    return found;
  }

  function fixCapitalization(text) {
    if (!text) return text;
    // Capitalize first letter of sentence
    return text.replace(/(^|[.!?]\s+)([a-z])/g, (m, p1, p2) => p1 + p2.toUpperCase());
  }

  function fixPunctuation(text, lang) {
    let t = text;
    // Remove double spaces before punctuation
    t = t.replace(/\s+([.,!?])/g, '$1');
    // Ensure space after punctuation
    t = t.replace(/([.,!?])([^\s"')\]0-9])/g, '$1 $2');
    // Remove trailing commas (sentence shouldn't end in ,)
    t = t.replace(/,\s*$/, '.');
    return t;
  }

  function predictMissingEnd(text, nextText, lang) {
    if (!nextText) return null;
    // Simple heuristic: if next segment starts with a word that could continue this one
    const nextWords = nextText.trim().split(/\s+/);
    const nextFirstWord = nextWords[0];
    // Check if it's a continuation word
    const CONTINUATION_WORDS_TH = ['ว่า','แล้ว','ก็','ด้วย','และ','หรือ','แต่'];
    const CONTINUATION_WORDS_EN = ['and','or','but','so','then','that','which','because'];
    const contWords = lang === 'th' ? CONTINUATION_WORDS_TH : CONTINUATION_WORDS_EN;

    if (contWords.some(w => nextFirstWord.toLowerCase().includes(w.toLowerCase()))) {
      return ''; // Remove the incomplete marker, keep as-is
    }
    return null;
  }

  function calculateConfidence(text, prevText, nextText, lang, issues) {
    let score = 1.0;

    // Penalize for detected issues
    score -= issues.length * 0.15;

    // Reward longer, well-formed sentences
    const wordCount = text.split(/\s+/).length;
    if (wordCount < 2) score -= 0.2;
    if (wordCount > 3) score += 0.05;

    // Check if sentence seems complete
    const endsWell = SENTENCE_ENDERS.test(text) || text.length > 5;
    if (!endsWell) score -= 0.1;

    // Check English bigrams
    if (lang === 'en') {
      const words = text.toLowerCase().split(/\s+/);
      let bigramScore = 0;
      let bigramCount = 0;
      for (let i = 0; i < words.length - 1; i++) {
        const bigram = words[i] + ' ' + words[i+1];
        if (COMMON_BIGRAMS[bigram]) {
          bigramScore += COMMON_BIGRAMS[bigram];
          bigramCount++;
        }
      }
      if (bigramCount > 0) {
        score += (bigramScore / bigramCount - 0.5) * 0.2;
      }
    }

    // Check Thai character ratio if Thai
    if (lang === 'th') {
      const thaiRatio = (text.match(/[ก-๛]/g) || []).length / text.length;
      if (thaiRatio < 0.3 && text.length > 5) score -= 0.15; // suspicious for Thai
    }

    // Context consistency bonus
    if (prevText && nextText) {
      const prevLang = detectLanguage(prevText);
      const nextLang = detectLanguage(nextText);
      if (prevLang === lang && nextLang === lang) score += 0.05;
    }

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Get confidence label & CSS class
   */
  function getConfidenceInfo(score) {
    if (score >= 0.85) return { label: `${Math.round(score*100)}%`, cls: 'high', icon: '✓' };
    if (score >= 0.65) return { label: `${Math.round(score*100)}%`, cls: 'medium', icon: '⚠' };
    return { label: `${Math.round(score*100)}%`, cls: 'low', icon: '✗' };
  }

  /**
   * Smart split: split long text into multiple subtitle segments
   */
  function smartSplit(text, maxChars = 40, lang = 'auto') {
    if (text.length <= maxChars) return [text];

    const segments = [];
    const detectedLang = lang === 'auto' ? detectLanguage(text) : lang;

    if (detectedLang === 'th') {
      // Thai: split at natural break points
      const thaiBreakPoints = /(?<=[ๆ.!?])\s+|(?<=\s)(และ|หรือ|แต่|ว่า|เพราะ|เนื่องจาก|จึง)\s/g;
      let parts = text.split(thaiBreakPoints);
      if (parts.length === 1) {
        // Force split at nearest space
        parts = [];
        let remaining = text;
        while (remaining.length > maxChars) {
          let cutAt = maxChars;
          while (cutAt > 0 && remaining[cutAt] !== ' ' && remaining[cutAt] !== '\n') cutAt--;
          if (cutAt === 0) cutAt = maxChars;
          parts.push(remaining.slice(0, cutAt).trim());
          remaining = remaining.slice(cutAt).trim();
        }
        if (remaining) parts.push(remaining);
      }
      return parts.filter(p => p.trim().length > 0);
    } else {
      // English: split at punctuation or conjunctions
      const parts = [];
      const words = text.split(' ');
      let line = '';
      for (const w of words) {
        if ((line + ' ' + w).trim().length <= maxChars) {
          line = (line + ' ' + w).trim();
        } else {
          if (line) parts.push(line);
          line = w;
        }
      }
      if (line) parts.push(line);
      return parts;
    }
  }

  /**
   * Generate word suggestions for autocomplete
   */
  function getSuggestions(partialText, lang = 'auto') {
    const detectedLang = lang === 'auto' ? detectLanguage(partialText) : lang;
    const wordList = detectedLang === 'th' ? THAI_COMMON_WORDS : ENGLISH_COMMON_WORDS;
    const words = partialText.trim().split(/\s+/);
    const lastWord = words[words.length - 1].toLowerCase();

    if (lastWord.length < 1) return [];

    return wordList
      .filter(w => w.toLowerCase().startsWith(lastWord) && w.toLowerCase() !== lastWord)
      .slice(0, 6);
  }

  /* ── Expose public API ── */
  return {
    analyzeSegment,
    analyzeAll,
    predictWord,
    getSuggestions,
    smartSplit,
    getConfidenceInfo,
    detectLanguage,
  };

})();

// Make globally available
window.AIEngine = AIEngine;
