"use strict";

/* =========================================
   PrepAI - Smart Interview Coach
   Frontend JavaScript
========================================= */

const API_BASE = "";

// Interview state
let interviewId = null;
let questions = [];
let currentQuestionIndex = 0;
let totalQuestions = 5;
let timerInterval = null;
let timeRemaining = 15 * 60;
let isSubmitting = false;
let recognition = null;
let scoreChart = null;
let categoryChart = null;
let interviewRole = "Software Developer";
let interviewCategory = "Mixed";

// DOM helper
const $ = (id) => document.getElementById(id);

function showMessage(id, message) {
    const element = $(id);
    if (!element) return;

    element.textContent = message;
    element.classList.remove("hidden");
}

function hideMessage(id) {
    const element = $(id);
    if (!element) return;

    element.textContent = "";
    element.classList.add("hidden");
}

function showSection(id) {
    ["setup", "interview", "report"].forEach(sectionId => {
        const section = $(sectionId);
        if (section) section.classList.add("hidden");
    });

    const selected = $(id);
    if (selected) selected.classList.remove("hidden");

    window.scrollTo({ top: 0, behavior: "smooth" });
}

function getErrorMessage(error) {
    return error?.message || "Something went wrong. Please try again.";
}

/* =========================================
   API REQUEST HANDLER
========================================= */

async function apiRequest(url, options = {}) {
    let response;

    try {
        response = await fetch(API_BASE + url, options);
    } catch (error) {
        throw new Error(
            "Cannot connect to PrepAI. Please check whether the FastAPI server is running."
        );
    }

    const responseText = await response.text();
    let data = {};

    try {
        data = responseText ? JSON.parse(responseText) : {};
    } catch {
        console.error("Invalid server response:", responseText);

        throw new Error(
            `Server returned an invalid response (HTTP ${response.status}). Check the FastAPI terminal.`
        );
    }

    if (!response.ok) {
        throw new Error(
            data.detail || data.message || `Request failed (HTTP ${response.status}).`
        );
    }

    return data;
}

/* =========================================
   START INTERVIEW
========================================= */

async function startInterview() {
    hideMessage("setupError");

    const startButton = $("startBtn");

    const category = $("category")?.value || "Mixed";
    const difficulty = $("difficulty")?.value || "Intermediate";
    const count = Number($("count")?.value || 5);
    const duration = Number($("duration")?.value || 15);
    const role = $("role")?.value || "Software Developer";
    const level = $("level")?.value || "Fresher";
    const resumeFile = $("resume")?.files?.[0];

    if (resumeFile && resumeFile.size > 5 * 1024 * 1024) {
        showMessage("setupError", "Resume file must be smaller than 5 MB.");
        return;
    }

    if (resumeFile) {
        const allowedExtensions = [".pdf", ".docx", ".txt"];
        const extension = resumeFile.name
            .substring(resumeFile.name.lastIndexOf("."))
            .toLowerCase();

        if (!allowedExtensions.includes(extension)) {
            showMessage("setupError", "Please upload a PDF, DOCX or TXT resume.");
            return;
        }
    }

    startButton.disabled = true;
    startButton.textContent = "Preparing your interview...";

    try {
        const formData = new FormData();

        formData.append("category", category);
        formData.append("difficulty", difficulty);
        formData.append("total_questions", String(count));
        formData.append("role", role);
        formData.append("level", level);
        formData.append("duration", String(duration));

        if (resumeFile) {
            formData.append("resume", resumeFile);
        }

        const data = await apiRequest("/api/start", {
            method: "POST",
            body: formData
        });

        interviewId = data.interview_id ?? data.id;

        if (!interviewId) {
            throw new Error("The server did not return an interview ID.");
        }

        interviewRole = role;
        interviewCategory = category;
        totalQuestions = count;
        currentQuestionIndex = 0;

        questions = Array.isArray(data.questions)
            ? data.questions
            : [];

        if (questions.length === 0) {
            const firstQuestion =
                data.question ||
                data.current_question ||
                data.first_question;

            if (firstQuestion) {
                questions.push(firstQuestion);
            }
        }

        if (questions.length === 0) {
            throw new Error(
                "Interview started, but no questions were returned. Check the /api/start response."
            );
        }

        totalQuestions = questions.length;
        timeRemaining = duration * 60;

        const title = $("interviewTitle");
        if (title) title.textContent = role;

        const tag = $("contextTag");
        if (tag) tag.textContent = `${category} · ${difficulty}`;

        const answer = $("answer");
        if (answer) answer.value = "";

        showSection("interview");
        displayQuestion();
        startTimer();

    } catch (error) {
        console.error("Start interview error:", error);
        showMessage("setupError", getErrorMessage(error));
    } finally {
        startButton.disabled = false;
        startButton.innerHTML = 'Start my interview <span>→</span>';
    }
}

/* =========================================
   DISPLAY QUESTION
========================================= */

function getQuestionText(question) {
    if (typeof question === "string") return question;

    if (question && typeof question === "object") {
        return (
            question.question ||
            question.text ||
            question.title ||
            "Question unavailable."
        );
    }

    return "Question unavailable.";
}

function displayQuestion() {
    const question = questions[currentQuestionIndex];

    if (!question) {
        finishInterview();
        return;
    }

    const questionElement = $("questionText");
    const indexElement = $("qIndex");
    const progressText = $("progressText");
    const progressBar = $("progressBar");

    if (questionElement) {
        questionElement.textContent = getQuestionText(question);
    }

    if (indexElement) {
        indexElement.textContent =
            String(currentQuestionIndex + 1).padStart(2, "0");
    }

    if (progressText) {
        progressText.textContent =
            `Question ${currentQuestionIndex + 1} of ${totalQuestions}`;
    }

    if (progressBar) {
        progressBar.style.width =
            `${((currentQuestionIndex + 1) / totalQuestions) * 100}%`;
    }

    const answer = $("answer");

    if (answer) {
        answer.value = "";
        answer.focus();
    }

    hideMessage("answerError");

    const feedback = $("feedback");

    if (feedback) {
        feedback.classList.add("hidden");
        feedback.innerHTML = "";
    }
}

/* =========================================
   INTERVIEW TIMER
========================================= */

function updateTimerDisplay() {
    const timer = $("timer");
    if (!timer) return;

    const minutes = Math.floor(timeRemaining / 60);
    const seconds = timeRemaining % 60;

    timer.textContent =
        `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

    timer.classList.toggle("timer-warning", timeRemaining <= 60);
}

function startTimer() {
    stopTimer();
    updateTimerDisplay();

    timerInterval = setInterval(() => {
        timeRemaining--;
        updateTimerDisplay();

        if (timeRemaining <= 0) {
            stopTimer();
            submitTimeout();
        }
    }, 1000);
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

/* =========================================
   SUBMIT ANSWER
========================================= */

async function submitAnswer() {
    if (isSubmitting) return;

    hideMessage("answerError");

    const answer = $("answer")?.value.trim();

    if (!answer) {
        showMessage(
            "answerError",
            "Please enter your answer before submitting."
        );
        return;
    }

    if (!interviewId) {
        showMessage(
            "answerError",
            "Interview session not found. Please restart."
        );
        return;
    }

    isSubmitting = true;

    const submitButton = $("submitBtn");

    if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = "Evaluating answer...";
    }

    try {
        const data = await apiRequest("/api/answer", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                interview_id: interviewId,
                answer: answer,
                question_index: currentQuestionIndex
            })
        });

        displayFeedback(data);

        const nextQuestion =
            data.next_question ||
            data.question;

        if (nextQuestion && data.completed !== true) {
            if (currentQuestionIndex + 1 < questions.length) {
                questions[currentQuestionIndex + 1] = nextQuestion;
            } else {
                questions.push(nextQuestion);
            }
        }

        if (
            data.completed === true ||
            data.status === "completed" ||
            data.is_completed === true
        ) {
            stopTimer();
            await finishInterview();
            return;
        }

        currentQuestionIndex++;

        if (currentQuestionIndex >= questions.length) {
            stopTimer();
            await finishInterview();
            return;
        }

        setTimeout(() => {
            displayQuestion();
        }, 1200);

    } catch (error) {
        console.error("Submit answer error:", error);
        showMessage("answerError", getErrorMessage(error));
    } finally {
        isSubmitting = false;

        if (submitButton) {
            submitButton.disabled = false;
            submitButton.textContent = "Submit answer →";
        }
    }
}

/* =========================================
   ANSWER FEEDBACK
========================================= */

function displayFeedback(data) {
    const feedback = $("feedback");
    if (!feedback) return;

    const evaluation =
        data?.evaluation && typeof data.evaluation === "object"
            ? data.evaluation
            : data;

    const score =
        evaluation.score ??
        data.score ??
        data.answer_score ??
        "N/A";

    const feedbackText =
        evaluation.feedback ||
        evaluation.explanation ||
        "Your answer has been evaluated.";

    const listHTML = (items) => {
        if (!Array.isArray(items) || items.length === 0) {
            return "<li>No specific points provided.</li>";
        }

        return items.map(item => {
            const value = typeof item === "string"
                ? item
                : item.description || item.text || JSON.stringify(item);

            return `<li>${escapeHTML(value)}</li>`;
        }).join("");
    };

    feedback.innerHTML = `
        <h3>AI Evaluation</h3>

        <div class="feedback-score">
            Score: ${escapeHTML(score)}/10
        </div>

        <p>${escapeHTML(feedbackText)}</p>

        <div class="feedback-columns">
            <div>
                <h4>Strengths</h4>
                <ul>${listHTML(evaluation.strengths)}</ul>
            </div>

            <div>
                <h4>Areas to improve</h4>
                <ul>${listHTML(
                    evaluation.improvements ||
                    evaluation.areas_to_improve
                )}</ul>
            </div>
        </div>

        ${evaluation.ideal_answer ? `
            <div class="ideal-answer">
                <h4>Suggested answer</h4>
                <p>${escapeHTML(evaluation.ideal_answer)}</p>
            </div>
        ` : ""}
    `;

    feedback.classList.remove("hidden");
}

function escapeHTML(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

/* =========================================
   TIMEOUT
========================================= */

async function submitTimeout() {
    if (!interviewId) return;

    stopTimer();

    try {
        await apiRequest("/api/timeout", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                interview_id: interviewId,
                question_index: currentQuestionIndex
            })
        });

    } catch (error) {
        console.error("Timeout request error:", error);
    }

    await finishInterview();
}

/* =========================================
   FINISH INTERVIEW AND LOAD REPORT
========================================= */

async function finishInterview() {
    stopTimer();
    stopVoiceInput();

    if (!interviewId) return;

    showSection("report");

    const reportDetails = $("reportDetails");

    if (reportDetails) {
        reportDetails.innerHTML =
            "<p>Generating your performance report...</p>";
    }

    try {
        await loadReport();
        await loadHistory();

    } catch (error) {
        console.error("Report error:", error);

        if (reportDetails) {
            reportDetails.textContent =
                `Could not load your report: ${getErrorMessage(error)}`;
        }
    }
}

async function loadReport() {
    const data = await apiRequest(
        `/api/report/${encodeURIComponent(interviewId)}`
    );

    displayReport(data);
}

/* =========================================
   DISPLAY REPORT
========================================= */

function getReportEvaluations(report, data) {
    const candidates = [
        report?.evaluations,
        report?.answers,
        data?.evaluations,
        data?.answers
    ];

    return candidates.find(Array.isArray) || [];
}

function getEvaluationRecord(item) {
    if (
        item?.evaluation &&
        typeof item.evaluation === "object"
    ) {
        return item.evaluation;
    }

    return item || {};
}

function displayReport(data) {
    const report =
        data?.report && typeof data.report === "object"
            ? data.report
            : data || {};

    const answers = getReportEvaluations(report, data);
    const evaluations = answers.map(getEvaluationRecord);

    const scoreValues = evaluations
        .map(item => Number(item.score))
        .filter(value => Number.isFinite(value));

    const calculatedAverage = scoreValues.length
        ? scoreValues.reduce((sum, value) => sum + value, 0)
            / scoreValues.length
        : 0;

    const score = Number(
        report.average_score ??
        data.score ??
        report.final_score ??
        report.score ??
        calculatedAverage
    );

    if ($("finalScore")) {
        $("finalScore").textContent =
            Number.isFinite(score) ? score.toFixed(1) : "0.0";
    }

    if ($("reportRole")) {
        $("reportRole").textContent =
            report.role || data.role || interviewRole;
    }

    if ($("reportMeta")) {
        const category = data.category || interviewCategory;
        const difficulty = data.difficulty || "";

        $("reportMeta").textContent =
            `${category} ${difficulty ? "· " + difficulty : ""} interview · ${answers.length || totalQuestions} questions`;
    }

    displayReportPlan(
        report.seven_day_plan ||
        report.improvement_plan ||
        report.plan ||
        data.seven_day_plan ||
        data.improvement_plan ||
        data.plan,
        report
    );

    displayAnswerReview(answers);

    createCharts(
        report,
        answers,
        data.category || interviewCategory
    );
}

/* =========================================
   IMPROVEMENT PLAN
========================================= */

function displayReportPlan(plan, report = {}) {
    const container = $("plan");
    if (!container) return;

    const days = Array.isArray(plan) ? plan : [];

    const strengths = Array.isArray(report.key_strengths)
        ? report.key_strengths
        : [];

    const weaknesses = Array.isArray(report.key_weaknesses)
        ? report.key_weaknesses
        : [];

    if (
        !days.length &&
        !report.overall_feedback &&
        !strengths.length &&
        !weaknesses.length
    ) {
        container.innerHTML = `
            <h3>Your 7-day improvement plan</h3>
            <p>
                The backend did not save an improvement plan
                for this interview. Check the FastAPI terminal
                for an AI-generation error.
            </p>
        `;
        return;
    }

    const list = items => items.length
        ? `<ul>${items.map(item =>
            `<li>${escapeHTML(item)}</li>`
        ).join("")}</ul>`
        : "<p>Not provided.</p>";

    const planHTML = days.map((item, index) => `
        <article class="plan-item">
            <strong>
                Day ${escapeHTML(item.day ?? index + 1)}:
                ${escapeHTML(item.topic || "Practice")}
            </strong>

            <p>
                ${escapeHTML(
                    item.task ||
                    "Review the topic and practise interview questions."
                )}
            </p>

            ${item.goal ? `
                <small>
                    <strong>Goal:</strong>
                    ${escapeHTML(item.goal)}
                </small>
            ` : ""}
        </article>
    `).join("");

    container.innerHTML = `
        <h3>Your personalized 7-day improvement plan</h3>

        ${report.overall_feedback
            ? `<p>${escapeHTML(report.overall_feedback)}</p>`
            : ""}

        <div class="feedback-columns">
            <div>
                <h4>Your strengths</h4>
                ${list(strengths)}
            </div>

            <div>
                <h4>Areas to improve</h4>
                ${list(weaknesses)}
            </div>
        </div>

        ${planHTML || "<p>No daily plan was returned by the AI.</p>"}
    `;
}

/* =========================================
   ANSWER-BY-ANSWER REVIEW
========================================= */

function displayAnswerReview(answers) {
    const container = $("reportDetails");
    if (!container) return;

    if (!Array.isArray(answers) || answers.length === 0) {
        container.innerHTML =
            "<p>No answer records were saved for this interview.</p>";
        return;
    }

    container.innerHTML = `
        <h3>Answer-by-answer review</h3>

        ${answers.map((item, index) => {
            const evaluation = getEvaluationRecord(item);

            const question =
                item.question ||
                item.question_text ||
                `Question ${index + 1}`;

            const answer =
                item.answer ||
                "No answer recorded (time expired).";

            const score = Number.isFinite(Number(evaluation.score))
                ? Number(evaluation.score).toFixed(1)
                : "N/A";

            const strengths = Array.isArray(evaluation.strengths)
                ? evaluation.strengths
                : [];

            const improvements = Array.isArray(evaluation.improvements)
                ? evaluation.improvements
                : [];

            const idealAnswer = evaluation.ideal_answer || "";

            const makeList = values => values.length
                ? `<ul>${values.map(value =>
                    `<li>${escapeHTML(value)}</li>`
                ).join("")}</ul>`
                : "<p>Not provided.</p>";

            return `
                <article class="review-card">

                    <h3>
                        Question ${index + 1}
                        <span class="review-score">${score}/10</span>
                    </h3>

                    <p>
                        <strong>${escapeHTML(question)}</strong>
                    </p>

                    <p>
                        <strong>Your answer:</strong><br>
                        ${escapeHTML(answer)}
                    </p>

                    <p>
                        <strong>AI feedback:</strong><br>
                        ${escapeHTML(
                            evaluation.feedback ||
                            "No feedback was saved."
                        )}
                    </p>

                    <div class="feedback-columns">
                        <div>
                            <h4>What you did well</h4>
                            ${makeList(strengths)}
                        </div>

                        <div>
                            <h4>What to improve</h4>
                            ${makeList(improvements)}
                        </div>
                    </div>

                    ${idealAnswer ? `
                        <details>
                            <summary>View suggested answer</summary>
                            <p>${escapeHTML(idealAnswer)}</p>
                        </details>
                    ` : ""}

                </article>
            `;
        }).join("")}
    `;
}

/* =========================================
   CHART.JS ANALYTICS
========================================= */

function createCharts(
    report,
    answers,
    categoryName = "Interview"
) {
    if (typeof Chart === "undefined") {
        console.warn("Chart.js is not loaded.");
        return;
    }

    const scores = answers.map(item => {
        const evaluation = getEvaluationRecord(item);
        const value = Number(evaluation.score);

        return Number.isFinite(value) ? value : 0;
    });

    const labels = answers.map((_, index) => `Q${index + 1}`);

    if (scoreChart) {
        scoreChart.destroy();
    }

    const scoreCanvas = $("scoreChart");

    if (scoreCanvas) {
        scoreChart = new Chart(scoreCanvas, {
            type: "bar",

            data: {
                labels,

                datasets: [{
                    label: "Score out of 10",
                    data: scores,
                    borderWidth: 1,
                    borderRadius: 6
                }]
            },

            options: {
                responsive: true,
                maintainAspectRatio: true,

                scales: {
                    y: {
                        beginAtZero: true,
                        max: 10,
                        ticks: {
                            stepSize: 1
                        }
                    }
                },

                plugins: {
                    legend: {
                        display: true
                    }
                }
            }
        });
    }

    // Current backend evaluates one selected interview category.
    // Do not fabricate separate DSA/DBMS/OOP/SQL scores.

    if (categoryChart) {
        categoryChart.destroy();
    }

    const categoryCanvas = $("categoryChart");

    if (categoryCanvas) {
        const validScores = scores.filter(Number.isFinite);

        const categoryAverage = validScores.length
            ? validScores.reduce((sum, value) => sum + value, 0)
                / validScores.length
            : 0;

        categoryChart = new Chart(categoryCanvas, {
            type: "bar",

            data: {
                labels: [categoryName],

                datasets: [{
                    label: "Average score out of 10",
                    data: [Number(categoryAverage.toFixed(2))],
                    borderWidth: 1,
                    borderRadius: 6
                }]
            },

            options: {
                responsive: true,
                maintainAspectRatio: true,

                scales: {
                    y: {
                        beginAtZero: true,
                        max: 10,
                        ticks: {
                            stepSize: 1
                        }
                    }
                },

                plugins: {
                    legend: {
                        display: true
                    },

                    title: {
                        display: true,
                        text: "Selected interview category"
                    }
                }
            }
        });
    }
}

/* =========================================
   INTERVIEW HISTORY
========================================= */

async function loadHistory() {
    const container = $("historyList");
    if (!container) return;

    try {
        const data = await apiRequest("/api/history");

        const history = Array.isArray(data)
            ? data
            : data.history || data.interviews || [];

        if (history.length === 0) {
            container.innerHTML =
                "<p>No previous interviews yet.</p>";
            return;
        }

        container.innerHTML = history.map(item => {
            const role = item.role || item.category || "Interview";

            const score =
                item.score ?? item.average_score ?? "N/A";

            const date = item.created_at
                ? new Date(item.created_at).toLocaleDateString()
                : "Date unavailable";

            return `
                <div class="history-item">
                    <strong>${escapeHTML(role)}</strong>
                    <span>Score: ${escapeHTML(score)}</span>
                    <small>${escapeHTML(date)}</small>
                </div>
            `;
        }).join("");

    } catch (error) {
        console.error("History loading error:", error);

        container.innerHTML =
            "<p>Could not load previous interviews.</p>";
    }
}

/* =========================================
   VOICE INPUT - BROWSER SPEECH RECOGNITION
========================================= */

function setupVoiceInput() {
    const SpeechRecognition =
        window.SpeechRecognition ||
        window.webkitSpeechRecognition;

    const micButton = $("micBtn");
    const voiceStatus = $("voiceStatus");

    if (!SpeechRecognition) {
        if (micButton) {
            micButton.disabled = true;
            micButton.textContent = "Voice input unavailable";
        }

        if (voiceStatus) {
            voiceStatus.textContent =
                "Your browser does not support speech recognition. Try Chrome or Edge.";
        }

        return;
    }

    recognition = new SpeechRecognition();

    recognition.lang = "en-IN";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onstart = () => {
        if (micButton) {
            micButton.textContent = "⏹ Stop speaking";
        }

        if (voiceStatus) {
            voiceStatus.textContent = "Listening...";
        }
    };

    recognition.onresult = (event) => {
        let finalText = "";
        let interimText = "";

        for (
            let i = event.resultIndex;
            i < event.results.length;
            i++
        ) {
            const transcript =
                event.results[i][0].transcript;

            if (event.results[i].isFinal) {
                finalText += transcript + " ";
            } else {
                interimText += transcript;
            }
        }

        const answer = $("answer");

        if (answer && finalText) {
            answer.value =
                (answer.value + " " + finalText).trim();
        }

        if (voiceStatus) {
            voiceStatus.textContent = interimText
                ? `Recognizing: ${interimText}`
                : "Listening...";
        }
    };

    recognition.onerror = (event) => {
        console.error(
            "Voice recognition error:",
            event.error
        );

        if (voiceStatus) {
            voiceStatus.textContent =
                `Voice input error: ${event.error}`;
        }

        if (micButton) {
            micButton.textContent = "🎙 Start speaking";
        }
    };

    recognition.onend = () => {
        if (micButton) {
            micButton.textContent = "🎙 Start speaking";
        }

        if (
            voiceStatus &&
            voiceStatus.textContent === "Listening..."
        ) {
            voiceStatus.textContent = "Voice input stopped.";
        }
    };
}

function toggleVoiceInput() {
    if (!recognition) return;

    try {
        if ($("micBtn")?.textContent.includes("Stop")) {
            recognition.stop();
        } else {
            recognition.start();
        }
    } catch (error) {
        console.error("Microphone error:", error);
    }
}

function stopVoiceInput() {
    if (recognition) {
        try {
            recognition.stop();
        } catch {
            // Recognition may already be stopped.
        }
    }
}

/* =========================================
   READ QUESTION ALOUD
========================================= */

function speakQuestion() {
    if (!("speechSynthesis" in window)) {
        alert(
            "Text-to-speech is not supported by your browser."
        );
        return;
    }

    window.speechSynthesis.cancel();

    const text =
        $("questionText")?.textContent || "";

    const utterance =
        new SpeechSynthesisUtterance(text);

    utterance.lang = "en-IN";
    utterance.rate = 0.95;

    window.speechSynthesis.speak(utterance);
}

/* =========================================
   RESET INTERVIEW
========================================= */

function resetInterview() {
    stopTimer();
    stopVoiceInput();

    if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
    }

    interviewId = null;
    questions = [];
    currentQuestionIndex = 0;
    isSubmitting = false;

    if ($("answer")) {
        $("answer").value = "";
    }

    if ($("resume")) {
        $("resume").value = "";
    }

    hideMessage("setupError");
    hideMessage("answerError");

    if (scoreChart) {
        scoreChart.destroy();
        scoreChart = null;
    }

    if (categoryChart) {
        categoryChart.destroy();
        categoryChart = null;
    }

    showSection("setup");
}

/* =========================================
   INITIALIZE APPLICATION
========================================= */

document.addEventListener("DOMContentLoaded", () => {

    $("startBtn")?.addEventListener(
        "click",
        startInterview
    );

    $("submitBtn")?.addEventListener(
        "click",
        submitAnswer
    );

    $("micBtn")?.addEventListener(
        "click",
        toggleVoiceInput
    );

    $("speakBtn")?.addEventListener(
        "click",
        speakQuestion
    );

    $("newBtn")?.addEventListener(
        "click",
        resetInterview
    );

    setupVoiceInput();
    loadHistory();

    console.log(
        "PrepAI frontend initialized successfully."
    );
});