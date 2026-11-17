# PrepAI — Smart AI Interview & Career Coach

A Generative AI mini-project built with FastAPI, Google Gemini, SQLite, HTML, CSS and JavaScript.

## Included features
1. Dynamic AI-generated technical interview questions
2. AI answer evaluation with score, feedback and suggested answer
3. Voice answers using browser SpeechRecognition where supported
4. Spoken questions using browser SpeechSynthesis
5. Resume upload and text extraction (PDF, DOCX, TXT)
6. Resume-aware personalized interview questions
7. Interview countdown timer (10, 15, 20 or 30 minutes)
8. Question categories: DSA, DBMS, OOP, SQL, OS, Networks, Python, Java and Mixed
9. Performance charts using Chart.js
10. AI-generated strengths, priority areas and seven-day preparation plan
11. SQLite interview history

## Requirements
- Python 3.10+
- Gemini API key from Google AI Studio
- Modern browser; Chrome/Edge recommended for browser speech recognition

## Windows PowerShell setup

```powershell
cd prepai_smart_interviewer
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
```

Edit `.env` and add your Gemini API key:

```env
GEMINI_API_KEY=your_actual_api_key
GEMINI_MODEL=gemini-2.5-flash
```

Run:

```powershell
uvicorn main:app --reload
```

Open http://127.0.0.1:8000

API documentation: http://127.0.0.1:8000/docs

## Project structure

```text
prepai_smart_interviewer/
├── main.py
├── requirements.txt
├── .env.example
├── .gitignore
├── README.md
├── prepai.db             # created automatically
└── static/
    ├── index.html
    ├── style.css
    └── app.js
```

## API endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Backend and AI status |
| POST | `/api/start` | Start interview; accepts multipart form and optional resume |
| POST | `/api/answer` | Evaluate answer and generate next question |
| POST | `/api/timeout` | End an interview when timer expires |
| GET | `/api/report/{id}` | Fetch report and generate AI improvement plan |
| GET | `/api/history` | List recent interview attempts |

## Notes and limitations
- Keep the Gemini API key in `.env`; never place it in frontend JavaScript or commit it to GitHub.
- Voice recognition uses the browser Web Speech API. Browser/platform support varies; typed answers remain available.
- Browser microphone access generally requires localhost or HTTPS and user permission.
- Resume parsing extracts selectable text. Scanned/image-only PDFs need OCR, which is not included in this mini-project.
- AI evaluation is advisory and can be imperfect. It should not be treated as an objective hiring decision.
- The timer is client-side for this educational MVP. A production system should enforce deadlines on the server.
- Charts load Chart.js from a CDN, so an internet connection is needed for charts.
- The seven-day plan is generated from submitted interview answers. If no answers are submitted, there is little evidence for a meaningful plan.
