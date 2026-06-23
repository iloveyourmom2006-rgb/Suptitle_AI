# 🎬 SubAI — ระบบทำซับไตเติ้ลอัตโนมัติด้วย AI

> สร้างซับไตเติ้ลจากวิดีโอโดยอัตโนมัติ พร้อมระบบ AI ตรวจสอบความถูกต้อง ปรับแต่งสไตล์ได้เต็มที่

[![GitHub Pages](https://img.shields.io/badge/Live%20Demo-GitHub%20Pages-blue?style=flat-square)](https://iloveyourmom2006-rgb.github.io/Suptitle_AI/)
![HTML](https://img.shields.io/badge/HTML5-orange?style=flat-square)
![CSS](https://img.shields.io/badge/CSS3-blue?style=flat-square)
![JavaScript](https://img.shields.io/badge/JavaScript-yellow?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)

---

## ✨ ฟีเจอร์หลัก

| ฟีเจอร์ | รายละเอียด |
|---|---|
| 🤖 **AI Transcription** | Web Speech API (ฟรี) + รองรับ OpenAI Whisper API |
| 🧠 **AI Correction** | ตรวจจับซับมั่ว + คำนวณ Confidence Score |
| ⏱ **Timeline Editor** | ลาก/ปรับขนาด segment บน timeline ได้ |
| ✏️ **Inline Edit** | ดับเบิลคลิกแก้ไขซับได้ทันที |
| 🎨 **Full Style Control** | ฟ้อนต์, ขนาด, สี, ขอบ, ตำแหน่ง, ความโปร่งใส |
| 🌈 **7 Color Themes** | Light, Sakura, Ocean, Forest, Sunset, Lavender, Dark |
| 📤 **Export** | SRT / VTT / ASS (พร้อมสไตล์) / TXT |
| ⌨️ **Keyboard Shortcuts** | Space, ←→, Delete |

---

## 🚀 วิธีใช้งาน

### ✅ วิธีที่ 1: เปิดใช้งานบนเครื่อง (ง่ายที่สุด)

> **ต้องใช้ Chrome หรือ Edge เวอร์ชันล่าสุดเท่านั้น** (Firefox ยังไม่รองรับ Web Speech API)

1. ดาวน์โหลดหรือ clone โปรเจกต์
2. **ไม่ต้องติดตั้งอะไรทั้งนั้น** — เปิด `index.html` ด้วย Chrome/Edge ได้เลย
3. อัปโหลดวิดีโอ แล้วกด Generate

> ⚠️ **หมายเหตุ**: Web Speech API ต้องการการเชื่อมต่ออินเทอร์เน็ต  
> และ browser จะขอสิทธิ์ใช้ไมโครโฟน — **กด "อนุญาต"** เพื่อให้ระบบทำงานได้

### ✅ วิธีที่ 2: เปิดผ่าน Live Server (แนะนำ)

ถ้า Web Speech API ไม่ทำงานบน `file://` ให้ใช้วิธีนี้:

```bash
# ถ้ามี VS Code → ติดตั้ง Extension "Live Server" แล้วกด "Go Live"

# หรือถ้ามี Node.js:
npx serve .

# หรือถ้ามี Python:
python -m http.server 8000
```

แล้วเปิด `http://localhost:8000` บน Chrome/Edge

### ✅ วิธีที่ 3: Whisper API (แม่นยำที่สุด — มีค่าใช้จ่าย)

1. สมัคร [OpenAI API Key](https://platform.openai.com/api-keys)
2. กดปุ่ม **"Web Speech"** ที่ header ของแอป
3. ใส่ API Key แล้วกด บันทึก
4. อัปโหลดวิดีโอ → ระบบจะใช้ Whisper โดยอัตโนมัติ

ราคา Whisper: ~$0.006 / นาที (ถูกมาก)

---

## 🌐 Deploy บน GitHub Pages

```bash
# ใน GitHub repo → Settings → Pages → Branch: main → Save
# รอ 1-2 นาที แล้วเข้าที่:
https://iloveyourmom2006-rgb.github.io/Suptitle_AI/
```

---

## 📁 โครงสร้างไฟล์

```
Suptitle_AI/
├── index.html          ← หน้าหลัก
├── css/
│   ├── styles.css      ← Design system
│   └── themes.css      ← Color themes (7 ธีม)
└── js/
    ├── ai-engine.js    ← AI ตรวจสอบซับ
    ├── speech.js       ← Speech recognition pipeline
    ├── editor.js       ← Timeline editor
    ├── export.js       ← Export SRT/VTT/ASS/TXT
    └── app.js          ← Core controller
```

---

## ⌨️ Keyboard Shortcuts

| ปุ่ม | ฟังก์ชัน |
|---|---|
| `Space` | เล่น / หยุด วิดีโอ |
| `←` / `→` | ย้อนหลัง / ข้ามหน้า 2 วินาที |
| `Delete` | ลบ segment ที่เลือก |
| `Esc` (ขณะแก้) | ยกเลิกการแก้ไข |
| `Enter` (ขณะแก้) | บันทึกการแก้ไข |

---

## 🧠 วิธีทำงานของ AI

```
วิดีโอ → Web Audio API → AudioContext
                              ↓
                    MediaStreamDestination
                              ↓
                    SpeechRecognition API
                              ↓
                    ข้อความ + Timestamp
                              ↓
                    AI Engine (ai-engine.js)
                    ├── ตรวจ noise patterns
                    ├── แก้ capitalization
                    ├── แก้ punctuation
                    ├── คำนวณ Confidence Score
                    └── Sentence pattern analysis
                              ↓
                    ซับไตเติ้ลพร้อมใช้ ✓
```

---

## 🛠 Browser Compatibility

| Browser | Web Speech | Audio Route | รองรับ |
|---|---|---|---|
| Chrome ≥ 90 | ✅ | ✅ | ✅ เต็มรูปแบบ |
| Edge ≥ 90 | ✅ | ✅ | ✅ เต็มรูปแบบ |
| Firefox | ❌ | ✅ | ⚠️ ต้องใช้ Whisper API |
| Safari | ⚠️ | ✅ | ⚠️ จำกัด |

---

## 📝 License

MIT License — ใช้ได้อิสระ, แก้ไขได้, แจกจ่ายได้
