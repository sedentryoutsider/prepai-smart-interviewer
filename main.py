
import os
import json
import uuid
import sqlite3
from datetime import datetime
from typing import Optional

from dotenv import load_dotenv
from fastapi import (
    FastAPI,
    HTTPException,
    UploadFile,
    File,
    Form
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from groq import Groq, APIStatusError, APIConnectionError

from pypdf import PdfReader
from docx import Document


# ==================================================
# CONFIGURATION
# ==================================================

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_MODEL = os.getenv(
    "GROQ_MODEL",
    "openai/gpt-oss-20b"
)

client = Groq(api_key=GROQ_API_KEY) if GROQ_API_KEY else None

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
DB_PATH = os.path.join(BASE_DIR, "prepai.db")

app = FastAPI(
    title="PrepAI Smart Interviewer",
    description="AI Powered Mock Interview Platform",
    version="2.1.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

if os.path.isdir(STATIC_DIR):
    app.mount(
        "/static",
        StaticFiles(directory=STATIC_DIR),
        name="static"
    )


# ==================================================
# DATABASE CONNECTION
# ==================================================

def get_connection():
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


# ==================================================
# DATABASE INITIALIZATION + MIGRATION
# ==================================================

def initialize_database():
    """
    Create the current schema and safely migrate older SQLite databases.

    Older versions of PrepAI may have used INTEGER PRIMARY KEY for `id`.
    The application now generates UUID strings, so that old schema causes:
        sqlite3.IntegrityError: datatype mismatch

    When an incompatible id column is detected, rebuild the table and
    preserve the existing interview records wherever possible.
    """
    connection = get_connection()

    create_sql = """
        CREATE TABLE interviews (
            id TEXT PRIMARY KEY,
            category TEXT NOT NULL DEFAULT 'DSA',
            difficulty TEXT NOT NULL DEFAULT 'Medium',
            resume_text TEXT,
            questions TEXT NOT NULL DEFAULT '[]',
            answers TEXT NOT NULL DEFAULT '[]',
            current_index INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'in_progress',
            score REAL NOT NULL DEFAULT 0,
            report TEXT,
            created_at TEXT NOT NULL DEFAULT '',
            completed_at TEXT
        )
    """

    expected_columns = {
        "id": "TEXT",
        "category": "TEXT NOT NULL DEFAULT 'DSA'",
        "difficulty": "TEXT NOT NULL DEFAULT 'Medium'",
        "resume_text": "TEXT",
        "questions": "TEXT NOT NULL DEFAULT '[]'",
        "answers": "TEXT NOT NULL DEFAULT '[]'",
        "current_index": "INTEGER NOT NULL DEFAULT 0",
        "status": "TEXT NOT NULL DEFAULT 'in_progress'",
        "score": "REAL NOT NULL DEFAULT 0",
        "report": "TEXT",
        "created_at": "TEXT NOT NULL DEFAULT ''",
        "completed_at": "TEXT"
    }

    try:
        table_exists = connection.execute(
            "SELECT 1 FROM sqlite_master "
            "WHERE type='table' AND name='interviews'"
        ).fetchone()

        if not table_exists:
            connection.execute(create_sql)
            connection.commit()
            print("Created PrepAI interviews table.")
            return

        info = connection.execute(
            "PRAGMA table_info(interviews)"
        ).fetchall()

        column_info = {row["name"]: row for row in info}
        id_info = column_info.get("id")

        # UUID strings require a TEXT primary key. Merely adding a TEXT
        # column to an old INTEGER PRIMARY KEY table does not fix its schema.
        needs_rebuild = (
            id_info is None
            or str(id_info["type"]).upper() != "TEXT"
            or int(id_info["pk"]) != 1
        )

        if needs_rebuild:
            print("Migrating legacy interviews table to TEXT UUID primary key...")

            old_rows = connection.execute(
                "SELECT * FROM interviews"
            ).fetchall()

            connection.execute(
                "ALTER TABLE interviews RENAME TO interviews_legacy_migration"
            )
            connection.execute(create_sql)

            new_columns = list(expected_columns.keys())

            for old_row in old_rows:
                old = dict(old_row)

                old_id = old.get("id")
                record_id = str(old_id) if old_id is not None else str(uuid.uuid4())

                values = {
                    "id": record_id,
                    "category": old.get("category") or "DSA",
                    "difficulty": old.get("difficulty") or "Medium",
                    "resume_text": old.get("resume_text"),
                    "questions": old.get("questions") or "[]",
                    "answers": old.get("answers") or "[]",
                    "current_index": old.get("current_index") or 0,
                    "status": old.get("status") or "in_progress",
                    "score": old.get("score") or 0,
                    "report": old.get("report"),
                    "created_at": old.get("created_at") or "",
                    "completed_at": old.get("completed_at")
                }

                placeholders = ", ".join("?" for _ in new_columns)
                columns_sql = ", ".join(new_columns)
                connection.execute(
                    f"INSERT OR REPLACE INTO interviews ({columns_sql}) "
                    f"VALUES ({placeholders})",
                    tuple(values[column] for column in new_columns)
                )

            connection.execute("DROP TABLE interviews_legacy_migration")
            connection.commit()
            print(f"Migrated {len(old_rows)} existing interview record(s).")

        else:
            # Compatible TEXT primary key: add any columns missing from
            # earlier versions without disturbing the existing records.
            existing_columns = set(column_info.keys())

            for column, definition in expected_columns.items():
                if column not in existing_columns:
                    connection.execute(
                        f"ALTER TABLE interviews ADD COLUMN {column} {definition}"
                    )
                    print(f"Database migration: added {column}")

            connection.commit()

        print("PrepAI database initialized successfully.")

    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


initialize_database()


# ==================================================
# GROQ AI CONFIGURATION
# ==================================================

def ai_json(prompt: str):

    if client is None:
        raise HTTPException(
            status_code=500,
            detail="Groq API key missing. Check your .env file."
        )

    try:

        response = client.chat.completions.create(
            model=GROQ_MODEL,

            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are PrepAI, a professional technical "
                        "interview assistant. Return only valid JSON. "
                        "Do not use Markdown or code fences."
                    )
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],

            response_format={
                "type": "json_object"
            },

            temperature=0.5,
            max_completion_tokens=4000
        )

        content = response.choices[0].message.content

        if not content:
            raise ValueError("Empty response from Groq.")

        return json.loads(content)

    except json.JSONDecodeError:

        raise HTTPException(
            status_code=502,
            detail="Groq returned invalid JSON."
        )

    except APIStatusError as error:

        print("Groq API error:", error.status_code, str(error))

        if error.status_code == 401:
            detail = "Invalid Groq API key."

        elif error.status_code == 429:
            detail = "Groq rate limit reached. Please retry later."

        elif error.status_code == 404:
            detail = "Groq model not found or unavailable."

        elif error.status_code >= 500:
            detail = "Groq service temporarily unavailable."

        else:
            detail = f"Groq API error: {error.status_code}"

        raise HTTPException(
            status_code=502,
            detail=detail
        )

    except APIConnectionError as error:

        print("Groq connection error:", str(error))

        raise HTTPException(
            status_code=503,
            detail="Unable to connect to Groq."
        )

    except HTTPException:
        raise

    except Exception as error:

        print("Unexpected AI error:", repr(error))

        raise HTTPException(
            status_code=500,
            detail="Unexpected AI generation error."
        )


# ==================================================
# RESUME EXTRACTION
# ==================================================

def extract_resume_text(file: UploadFile):

    filename = (file.filename or "").lower()

    try:

        if filename.endswith(".pdf"):

            reader = PdfReader(file.file)

            text = "\n".join(
                page.extract_text() or ""
                for page in reader.pages
            )

        elif filename.endswith(".docx"):

            document = Document(file.file)

            text = "\n".join(
                paragraph.text
                for paragraph in document.paragraphs
            )

        elif filename.endswith(".txt"):

            text = file.file.read().decode(
                "utf-8",
                errors="ignore"
            )

        else:

            raise HTTPException(
                status_code=400,
                detail="Upload PDF, DOCX or TXT resume."
            )

        text = text.strip()

        if not text:
            raise HTTPException(
                status_code=400,
                detail="No readable text found in resume."
            )

        return text[:15000]

    except HTTPException:
        raise

    except Exception as error:

        print("Resume error:", repr(error))

        raise HTTPException(
            status_code=400,
            detail="Unable to extract resume text."
        )


# ==================================================
# GENERATE INTERVIEW QUESTIONS
# ==================================================

def generate_questions(
    category,
    difficulty,
    total_questions,
    resume_text=None
):

    resume_context = ""

    if resume_text:

        resume_context = f"""
        Candidate Resume:

        {resume_text}

        Generate some questions based on the candidate's
        actual projects, skills and technologies.
        Do not invent candidate experience.
        """

    prompt = f"""

    Generate exactly {total_questions} technical
    interview questions.

    Category: {category}

    Difficulty: {difficulty}

    {resume_context}

    Return JSON:

    {{
        "questions": [
            {{
                "question": "Question text",
                "ideal_answer": "Detailed expected answer",
                "evaluation_criteria": [
                    "Concept 1",
                    "Concept 2"
                ]
            }}
        ]
    }}

    Rules:

    1. Avoid duplicate questions.
    2. Match the requested difficulty.
    3. Questions must be technically accurate.
    4. Include useful expected answers.
    5. Questions should be suitable for software
       development placement interviews.

    """

    result = ai_json(prompt)

    questions = result.get("questions", [])

    if not isinstance(questions, list):
        raise HTTPException(
            status_code=502,
            detail="Invalid question format from AI."
        )

    if len(questions) < total_questions:
        raise HTTPException(
            status_code=502,
            detail="AI generated fewer questions than requested."
        )

    return questions[:total_questions]


# ==================================================
# EVALUATE ANSWERS
# ==================================================

def evaluate_answer(question, answer):

    prompt = f"""

    Evaluate this technical interview answer.

    Question:
    {question.get("question", "")}

    Expected Answer:
    {question.get("ideal_answer", "")}

    Evaluation Criteria:
    {json.dumps(question.get("evaluation_criteria", []))}

    Candidate Answer:
    {answer}

    Return JSON:

    {{
        "score": 0,
        "feedback": "Detailed feedback",
        "strengths": ["Strength 1"],
        "improvements": ["Improvement 1"],
        "ideal_answer": "Correct answer"
    }}

    Rules:

    - Score must be between 0 and 10.
    - Evaluate technical accuracy.
    - Evaluate completeness.
    - Evaluate clarity.
    - Be constructive.
    - Empty answers must receive zero.

    """

    result = ai_json(prompt)

    try:

        result["score"] = max(
            0,
            min(10, int(result.get("score", 0)))
        )

    except (ValueError, TypeError):

        result["score"] = 0

    result.setdefault("feedback", "")
    result.setdefault("strengths", [])
    result.setdefault("improvements", [])
    result.setdefault(
        "ideal_answer",
        question.get("ideal_answer", "")
    )

    return result


# ==================================================
# SEVEN DAY IMPROVEMENT PLAN
# ==================================================

def generate_improvement_plan(category, evaluations):

    prompt = f"""

    Create a personalized seven-day technical
    interview improvement plan.

    Category:
    {category}

    Evaluation Results:
    {json.dumps(evaluations)}

    Return JSON:

    {{
        "overall_feedback": "Overall feedback",
        "key_weaknesses": ["Weakness 1"],
        "key_strengths": ["Strength 1"],
        "seven_day_plan": [
            {{
                "day": 1,
                "topic": "Topic",
                "task": "Specific task",
                "goal": "Learning outcome"
            }}
        ]
    }}

    Include exactly seven days.

    """

    result = ai_json(prompt)

    result.setdefault("overall_feedback", "")
    result.setdefault("key_weaknesses", [])
    result.setdefault("key_strengths", [])
    result.setdefault("seven_day_plan", [])

    return result


# ==================================================
# REQUEST MODELS
# ==================================================

class AnswerRequest(BaseModel):

    interview_id: str

    answer: str = Field(default="")

    question_index: Optional[int] = None


class TimeoutRequest(BaseModel):

    interview_id: str

    question_index: Optional[int] = None


# ==================================================
# ROOT ROUTE
# ==================================================

@app.get("/")
def home():

    index_file = os.path.join(
        STATIC_DIR,
        "index.html"
    )

    if os.path.isfile(index_file):
        return FileResponse(index_file)

    return {
        "message": "Welcome to PrepAI Smart Interviewer",
        "docs": "/docs",
        "health": "/api/health"
    }


# ==================================================
# HEALTH CHECK
# ==================================================

@app.get("/api/health")
def health():

    return {
        "status": "healthy",
        "application": "PrepAI Smart Interviewer",
        "ai_provider": "Groq",
        "ai_model": GROQ_MODEL,
        "ai_configured": client is not None,
        "database": "SQLite"
    }


# ==================================================
# START INTERVIEW
# ==================================================

@app.post("/api/start")
async def start_interview(

    category: str = Form("DSA"),

    difficulty: str = Form("Medium"),

    total_questions: int = Form(5),

    resume: Optional[UploadFile] = File(None)

):

    if not category.strip():

        raise HTTPException(
            status_code=400,
            detail="Category is required."
        )

    if total_questions < 1 or total_questions > 15:

        raise HTTPException(
            status_code=400,
            detail="Choose between 1 and 15 questions."
        )

    resume_text = None

    if resume and resume.filename:

        resume_text = extract_resume_text(resume)

    questions = generate_questions(
        category.strip(),
        difficulty.strip(),
        total_questions,
        resume_text
    )

    interview_id = str(uuid.uuid4())

    created_at = datetime.now().isoformat()

    connection = get_connection()

    try:

        connection.execute(
            """
            INSERT INTO interviews (
                id,
                category,
                difficulty,
                resume_text,
                questions,
                answers,
                current_index,
                status,
                score,
                created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,

            (
                interview_id,
                category.strip(),
                difficulty.strip(),
                resume_text,
                json.dumps(questions),
                json.dumps([]),
                0,
                "in_progress",
                0,
                created_at
            )
        )

        connection.commit()

    finally:
        connection.close()

    return {
        "success": True,
        "message": "Interview started successfully.",
        "interview_id": interview_id,
        "category": category,
        "difficulty": difficulty,
        "total_questions": len(questions),
        "current_question_index": 0,
        "questions": [
            item.get("question", "") for item in questions
        ],
        "question": questions[0]["question"]
    }


# ==================================================
# SUBMIT ANSWER
# ==================================================

@app.post("/api/answer")
def submit_answer(request: AnswerRequest):

    connection = get_connection()

    try:

        interview = connection.execute(
            "SELECT * FROM interviews WHERE id = ?",
            (request.interview_id,)
        ).fetchone()

        if not interview:

            raise HTTPException(
                status_code=404,
                detail="Interview not found."
            )

        if interview["status"] != "in_progress":

            raise HTTPException(
                status_code=400,
                detail="Interview already completed."
            )

        questions = json.loads(interview["questions"])
        answers = json.loads(interview["answers"] or "[]")

        current_index = interview["current_index"] or 0

        if request.question_index is not None:

            if request.question_index != current_index:

                raise HTTPException(
                    status_code=409,
                    detail="Question index mismatch."
                )

        if current_index >= len(questions):

            raise HTTPException(
                status_code=400,
                detail="No questions remaining."
            )

        question = questions[current_index]

        evaluation = evaluate_answer(
            question,
            request.answer.strip()
        )

        answers.append({
            "question_index": current_index,
            "question": question["question"],
            "answer": request.answer,
            "evaluation": evaluation
        })

        next_index = current_index + 1

        completed = next_index >= len(questions)

        if completed:

            average_score = round(
                sum(
                    item["evaluation"]["score"]
                    for item in answers
                ) / len(answers),
                2
            )

            report = generate_improvement_plan(
                interview["category"],
                answers
            )

            report["average_score"] = average_score
            report["total_questions"] = len(questions)
            report["evaluations"] = answers

            connection.execute(
                """
                UPDATE interviews
                SET answers = ?,
                    current_index = ?,
                    status = 'completed',
                    score = ?,
                    report = ?,
                    completed_at = ?
                WHERE id = ?
                """,

                (
                    json.dumps(answers),
                    next_index,
                    average_score,
                    json.dumps(report),
                    datetime.now().isoformat(),
                    request.interview_id
                )
            )

        else:

            connection.execute(
                """
                UPDATE interviews
                SET answers = ?,
                    current_index = ?
                WHERE id = ?
                """,

                (
                    json.dumps(answers),
                    next_index,
                    request.interview_id
                )
            )

        connection.commit()

        response = {
            "success": True,
            "evaluation": evaluation,
            "completed": completed,
            "answered_questions": len(answers),
            "total_questions": len(questions)
        }

        if completed:

            response["message"] = "Interview completed."

            response["report_url"] = (
                f"/api/report/{request.interview_id}"
            )

        else:

            response["next_question"] = (
                questions[next_index]["question"]
            )

            response["current_question_index"] = next_index

        return response

    finally:
        connection.close()


# ==================================================
# TIMEOUT
# ==================================================

@app.post("/api/timeout")
def timeout_question(request: TimeoutRequest):

    connection = get_connection()

    try:

        interview = connection.execute(
            "SELECT * FROM interviews WHERE id = ?",
            (request.interview_id,)
        ).fetchone()

        if not interview:

            raise HTTPException(
                status_code=404,
                detail="Interview not found."
            )

        if interview["status"] != "in_progress":

            raise HTTPException(
                status_code=400,
                detail="Interview already completed."
            )

        questions = json.loads(interview["questions"])
        answers = json.loads(interview["answers"] or "[]")

        current_index = interview["current_index"] or 0

        if request.question_index is not None:

            if request.question_index != current_index:

                raise HTTPException(
                    status_code=409,
                    detail="Question index mismatch."
                )

        if current_index >= len(questions):

            raise HTTPException(
                status_code=400,
                detail="No questions remaining."
            )

        question = questions[current_index]

        evaluation = {
            "score": 0,
            "feedback": "Time expired.",
            "strengths": [],
            "improvements": [
                "Practice answering within the time limit."
            ],
            "ideal_answer": question.get("ideal_answer", "")
        }

        answers.append({
            "question_index": current_index,
            "question": question["question"],
            "answer": "",
            "evaluation": evaluation,
            "timed_out": True
        })

        next_index = current_index + 1

        completed = next_index >= len(questions)

        if completed:

            average_score = round(
                sum(
                    item["evaluation"]["score"]
                    for item in answers
                ) / len(answers),
                2
            )

            report = generate_improvement_plan(
                interview["category"],
                answers
            )

            report["average_score"] = average_score
            report["total_questions"] = len(questions)
            report["evaluations"] = answers

            connection.execute(
                """
                UPDATE interviews
                SET answers = ?,
                    current_index = ?,
                    status = 'completed',
                    score = ?,
                    report = ?,
                    completed_at = ?
                WHERE id = ?
                """,

                (
                    json.dumps(answers),
                    next_index,
                    average_score,
                    json.dumps(report),
                    datetime.now().isoformat(),
                    request.interview_id
                )
            )

        else:

            connection.execute(
                """
                UPDATE interviews
                SET answers = ?,
                    current_index = ?
                WHERE id = ?
                """,

                (
                    json.dumps(answers),
                    next_index,
                    request.interview_id
                )
            )

        connection.commit()

        response = {
            "success": True,
            "evaluation": evaluation,
            "completed": completed,
            "answered_questions": len(answers),
            "total_questions": len(questions)
        }

        if completed:

            response["message"] = "Interview completed."

            response["report_url"] = (
                f"/api/report/{request.interview_id}"
            )

        else:

            response["next_question"] = (
                questions[next_index]["question"]
            )

            response["current_question_index"] = next_index

        return response

    finally:
        connection.close()


# ==================================================
# REPORT
# ==================================================

@app.get("/api/report/{interview_id}")
def get_report(interview_id: str):

    connection = get_connection()

    try:

        interview = connection.execute(
            "SELECT * FROM interviews WHERE id = ?",
            (interview_id,)
        ).fetchone()

        if not interview:

            raise HTTPException(
                status_code=404,
                detail="Interview not found."
            )

        if interview["status"] != "completed":

            raise HTTPException(
                status_code=400,
                detail="Interview not completed yet."
            )

        report = json.loads(interview["report"] or "{}")

        return {
            "success": True,
            "interview_id": interview_id,
            "category": interview["category"],
            "difficulty": interview["difficulty"],
            "score": interview["score"],
            "status": interview["status"],
            "created_at": interview["created_at"],
            "completed_at": interview["completed_at"],
            "report": report
        }

    finally:
        connection.close()


# ==================================================
# HISTORY
# ==================================================

@app.get("/api/history")
def get_history():

    connection = get_connection()

    try:

        rows = connection.execute(
            """
            SELECT id, category, difficulty, status,
                   score, created_at, completed_at
            FROM interviews
            ORDER BY created_at DESC
            """
        ).fetchall()

        return {
            "success": True,
            "total_interviews": len(rows),
            "history": [dict(row) for row in rows]
        }

    finally:
        connection.close()


# ==================================================
# START SERVER
# ==================================================

if __name__ == "__main__":

    import uvicorn

    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=8000,
        reload=True
    )
