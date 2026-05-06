const normalizeText = (value) =>
  typeof value === "string" ? value.trim() : "";

const normalizeId = (raw, index, prefix) => {
  const normalized = normalizeText(raw);
  return normalized || `${prefix}_${index + 1}`;
};

const normalizeAnswer = (value) => normalizeText(value).toLowerCase();

const shuffleArray = (items = []) => {
  const clone = items.slice();
  for (let index = clone.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [clone[index], clone[swapIndex]] = [clone[swapIndex], clone[index]];
  }
  return clone;
};

const normalizeQuestions = (raw = {}) => {
  const source = Array.isArray(raw?.content)
    ? raw.content
    : Array.isArray(raw?.questions)
    ? raw.questions
    : Array.isArray(raw?.Questions)
    ? raw.Questions
    : Array.isArray(raw)
    ? raw
    : [];

  return source
    .map((entry, index) => {
      const prompt = normalizeText(entry?.question);
      const answer = normalizeText(entry?.answer);
      const options = Array.isArray(entry?.options)
        ? entry.options.map((option) => normalizeText(option)).filter(Boolean)
        : [];
      if (!prompt || !answer || options.length < 2) {
        return null;
      }
      return {
        id: normalizeId(entry?.id, index, "reading"),
        prompt,
        answer,
        answerNormalized: normalizeAnswer(answer),
        options,
      };
    })
    .filter(Boolean);
};

const getQuestionOrder = (questions, savedOrder) => {
  const savedIds = Array.isArray(savedOrder) ? savedOrder : [];
  if (savedIds.length === questions.length) {
    const ordered = savedIds
      .map((id) => questions.find((question) => question.id === id))
      .filter(Boolean);
    if (ordered.length === questions.length) {
      return ordered;
    }
  }
  return questions.slice();
};

const getOptionOrder = (question, savedDetail) => {
  const savedOrder = Array.isArray(savedDetail?.[question.id])
    ? savedDetail[question.id].map((value) => normalizeText(value))
    : null;
  if (savedOrder && savedOrder.length === question.options.length) {
    const map = new Map();
    question.options.forEach((option) => {
      map.set(normalizeText(option), option);
    });
    const ordered = savedOrder
      .map((key) => map.get(key))
      .filter((value) => typeof value === "string");
    if (ordered.length === question.options.length) {
      return ordered;
    }
  }
  return shuffleArray(question.options);
};

const createHeading = (context = {}) =>
  context.activityNumber ? `Activity ${context.activityNumber}` : "Activity";

const getMarksPerQuestion = (context = {}) => {
  const parsed = Number(context?.marksPerQuestion);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

const createMarksSummaryText = (total, marksPerQuestion) => {
  if (!Number.isInteger(total) || total <= 0) {
    return "";
  }
  return `${total} x ${marksPerQuestion} = ${total * marksPerQuestion} marks`;
};

const createResultText = (correct, total, marksPerQuestion = 1) => {
  if (!Number.isInteger(total) || total <= 0) {
    return "";
  }
  return `Score: ${correct * marksPerQuestion} / ${
    total * marksPerQuestion
  } marks`;
};

const resultMessage = (
  element,
  correct,
  total,
  marksPerQuestion = 1,
  tone = "neutral"
) => {
  element.textContent = createResultText(correct, total, marksPerQuestion);
  element.classList.remove(
    "assessment-result--error",
    "assessment-result--success"
  );
  if (tone === "error") {
    element.classList.add("assessment-result--error");
  } else if (tone === "success") {
    element.classList.add("assessment-result--success");
  }
};

const appendFormattedInline = (target, text) => {
  const source = typeof text === "string" ? text : "";
  const boldPattern = /\*([^*]+)\*/g;
  let cursor = 0;
  let match = boldPattern.exec(source);

  while (match) {
    if (match.index > cursor) {
      target.append(document.createTextNode(source.slice(cursor, match.index)));
    }
    const strong = document.createElement("strong");
    strong.textContent = match[1];
    target.appendChild(strong);
    cursor = match.index + match[0].length;
    match = boldPattern.exec(source);
  }

  if (cursor < source.length) {
    target.append(document.createTextNode(source.slice(cursor)));
  }
};

const appendFormattedParagraphs = (target, text, className) => {
  const lines = String(text ?? "").split(/\r?\n/);
  lines.forEach((line) => {
    const paragraph = document.createElement("p");
    if (className) {
      paragraph.className = className;
    }
    if (line.length) {
      appendFormattedInline(paragraph, line);
    } else {
      paragraph.appendChild(document.createElement("br"));
    }
    target.appendChild(paragraph);
  });
};

const normalizeDialogue = (raw = []) =>
  (Array.isArray(raw) ? raw : [])
    .map((entry, index) => {
      const name =
        normalizeText(entry?.name) ||
        normalizeText(entry?.speaker) ||
        `Speaker ${index + 1}`;
      const text = normalizeText(entry?.text);
      if (!text) {
        return null;
      }
      return {
        id: normalizeId(entry?.id, index, "dialogue"),
        name,
        speaker: normalizeText(entry?.speaker),
        text,
      };
    })
    .filter(Boolean);

const normalizePassage = (raw) => {
  if (typeof raw === "string") {
    return raw.trim();
  }
  if (Array.isArray(raw)) {
    return raw
      .map((entry) =>
        typeof entry === "string" ? entry.trim() : normalizeText(entry?.text)
      )
      .filter(Boolean)
      .join("\n");
  }
  if (raw && typeof raw === "object") {
    return normalizeText(raw.text);
  }
  return "";
};

const createOptionButton = (label) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "listening-option";
  button.textContent = label;
  button.dataset.value = label;
  button.dataset.normalized = normalizeAnswer(label);
  return button;
};

const buildTranscript = (activityData = {}) => {
  const dialogue = normalizeDialogue(activityData?.transcript_dialogue);
  const passage = normalizePassage(activityData?.transcript_passage);

  const wrapper = document.createElement("div");
  wrapper.className = "reading-transcript";

  if (dialogue.length) {
    wrapper.classList.add("reading-transcript--dialogue");
    const card = document.createElement("article");
    card.className =
      "dialogue-card dialogue-card--reading reading-dialogue-card";

    dialogue.forEach((line) => {
      const paragraph = document.createElement("p");
      paragraph.className = "dialogue-card__line reading-dialogue-line";

      const speaker = document.createElement("strong");
      speaker.className = "reading-dialogue-speaker";
      speaker.textContent = line.name;

      paragraph.appendChild(speaker);
      paragraph.append(": ");
      appendFormattedInline(paragraph, line.text.replace(/\s*\r?\n\s*/g, " "));
      card.appendChild(paragraph);
    });

    wrapper.appendChild(card);
    return wrapper;
  }

  if (passage) {
    wrapper.classList.add("reading-transcript--passage");
    const card = document.createElement("article");
    card.className = "dialogue-card dialogue-card--reading reading-passage-card";
    appendFormattedParagraphs(card, passage, "dialogue-card__line");
    wrapper.appendChild(card);
    return wrapper;
  }

  const empty = document.createElement("p");
  empty.className = "empty-state";
  empty.textContent = "Reading text will be available soon.";
  wrapper.appendChild(empty);
  return wrapper;
};

export const buildReadingSlides = (
  activityData = {},
  context = {},
  assessment = {}
) => {
  const questions = normalizeQuestions(activityData);
  const marksPerQuestion = getMarksPerQuestion(context);

  const registerActivity =
    typeof assessment?.registerActivity === "function"
      ? assessment.registerActivity
      : () => {};
  const submitResult =
    typeof assessment?.submitResult === "function"
      ? assessment.submitResult
      : () => {};
  const getSavedState =
    typeof assessment?.getState === "function"
      ? assessment.getState
      : () => null;

  const savedState = getSavedState() || null;
  const savedDetail = savedState?.detail || {};
  let submissionLocked = Boolean(savedState?.submitted);
  let instructionsLocked = false;

  const slide = document.createElement("section");
  slide.className = "slide slide--assessment slide--reading slide--reading-mcq";

  const heading = document.createElement("h2");
  heading.textContent = createHeading(context);
  slide.appendChild(heading);

  const marksSummary = createMarksSummaryText(
    questions.length,
    marksPerQuestion
  );
  if (marksSummary) {
    const marksEl = document.createElement("p");
    marksEl.className = "assessment-marks-summary";
    marksEl.textContent = `(${marksSummary})`;
    slide.appendChild(marksEl);
  }

  slide.appendChild(buildTranscript(activityData));

  const grid = document.createElement("div");
  grid.className = "listening-mcq-grid reading-question-grid";
  slide.appendChild(grid);

  const actions = document.createElement("div");
  actions.className = "assessment-actions";
  slide.appendChild(actions);

  const submitBtn = document.createElement("button");
  submitBtn.type = "button";
  submitBtn.className = "primary-btn";
  submitBtn.textContent = submissionLocked ? "Submitted" : "Submit Answers";
  actions.appendChild(submitBtn);

  const resultEl = document.createElement("p");
  resultEl.className = "assessment-result";
  resultEl.setAttribute("role", "status");
  actions.appendChild(resultEl);

  const orderedQuestions = getQuestionOrder(
    questions,
    savedDetail.questionOrder
  );

  const questionEntries = orderedQuestions.map((question, index) => {
    const card = document.createElement("article");
    card.className = "dialogue-card dialogue-card--listening quiz-card";

    const title = document.createElement("h3");
    title.className = "dialogue-card__title";
    title.textContent = `${index + 1}.`;
    card.appendChild(title);

    const prompt = document.createElement("p");
    prompt.className = "dialogue-card__line dialogue-card__line--question";
    prompt.textContent = question.prompt;
    card.appendChild(prompt);

    const optionGroup = document.createElement("div");
    optionGroup.className = "listening-option-group";
    card.appendChild(optionGroup);

    const optionOrder = getOptionOrder(
      question,
      savedDetail?.optionOrder || {}
    );
    const buttons = optionOrder.map((label) => {
      const button = createOptionButton(label);
      optionGroup.appendChild(button);
      return button;
    });

    const feedback = document.createElement("p");
    feedback.className = "listening-feedback";
    card.appendChild(feedback);

    const entry = {
      question,
      card,
      buttons,
      feedback,
      selected: null,
      selectedNormalized: "",
      locked: false,
    };

    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        if (entry.locked || submissionLocked || instructionsLocked) {
          return;
        }
        entry.selected = button.dataset.value;
        entry.selectedNormalized = button.dataset.normalized || "";
        buttons.forEach((btn) => btn.classList.remove("is-selected"));
        button.classList.add("is-selected");
        resultEl.textContent = "";
        resultEl.classList.remove(
          "assessment-result--error",
          "assessment-result--success"
        );
      });
    });

    grid.appendChild(card);
    return entry;
  });

  registerActivity({
    total: questionEntries.length,
    marksPerQuestion,
  });

  const refreshInteractivity = () => {
    const disabled = instructionsLocked || submissionLocked;
    questionEntries.forEach((entry) => {
      entry.buttons.forEach((button) => {
        button.disabled = disabled || entry.locked;
      });
    });
    submitBtn.disabled = disabled || !questionEntries.length;
  };

  if (!questionEntries.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Questions will be available soon.";
    grid.appendChild(empty);
    submitBtn.disabled = true;
  }

  const lockEntry = (entry, isCorrect) => {
    entry.locked = true;
    entry.card.classList.toggle("is-correct", isCorrect);
    entry.card.classList.toggle("is-incorrect", !isCorrect);
    entry.buttons.forEach((button) => {
      const isAnswer =
        button.dataset.normalized === entry.question.answerNormalized;
      if (isAnswer) {
        button.classList.add("is-correct");
      }
      if (button.classList.contains("is-selected") && !isCorrect) {
        button.classList.add("is-incorrect");
      }
    });
    entry.feedback.textContent = isCorrect
      ? "Correct!"
      : `Answer: ${entry.question.answer}`;
    entry.feedback.classList.toggle(
      "listening-feedback--positive",
      isCorrect
    );
    entry.feedback.classList.toggle(
      "listening-feedback--negative",
      !isCorrect
    );
  };

  const evaluate = () => {
    if (submissionLocked || !questionEntries.length) {
      return;
    }
    const unanswered = questionEntries.filter(
      (entry) => !entry.selectedNormalized
    );
    if (unanswered.length) {
      resultEl.textContent = "Please answer every question.";
      resultEl.classList.add("assessment-result--error");
      return;
    }

    let correctCount = 0;
    questionEntries.forEach((entry) => {
      const isCorrect =
        entry.selectedNormalized === entry.question.answerNormalized;
      if (isCorrect) {
        correctCount += 1;
      }
      lockEntry(entry, isCorrect);
    });

    submissionLocked = true;
    submitBtn.textContent = "Submitted";
    refreshInteractivity();

    const detail = {
      questionOrder: questionEntries.map((entry) => entry.question.id),
      optionOrder: questionEntries.reduce((acc, entry) => {
        acc[entry.question.id] = entry.buttons.map(
          (button) => button.dataset.value
        );
        return acc;
      }, {}),
      answers: questionEntries.reduce((acc, entry) => {
        acc[entry.question.id] = entry.selected ?? null;
        return acc;
      }, {}),
    };

    submitResult({
      total: questionEntries.length,
      correct: correctCount,
      marksPerQuestion,
      detail,
      timestamp: new Date().toISOString(),
    });

    resultMessage(
      resultEl,
      correctCount,
      questionEntries.length,
      marksPerQuestion,
      correctCount === questionEntries.length ? "success" : "neutral"
    );
  };

  const applySavedState = () => {
    const storedAnswers = savedDetail?.answers || {};
    let correctCount = 0;
    questionEntries.forEach((entry) => {
      const storedAnswer = storedAnswers[entry.question.id];
      if (typeof storedAnswer === "string") {
        const normalized = normalizeAnswer(storedAnswer);
        entry.selected = storedAnswer;
        entry.selectedNormalized = normalized;
        const selectedButton = entry.buttons.find(
          (button) => button.dataset.normalized === normalized
        );
        selectedButton?.classList.add("is-selected");
      }
      const isCorrect =
        entry.selectedNormalized === entry.question.answerNormalized;
      if (isCorrect) {
        correctCount += 1;
      }
      lockEntry(entry, isCorrect);
    });
    submissionLocked = true;
    submitBtn.textContent = "Submitted";
    refreshInteractivity();
    resultMessage(
      resultEl,
      correctCount,
      questionEntries.length,
      marksPerQuestion,
      correctCount === questionEntries.length ? "success" : "neutral"
    );
  };

  if (savedState?.submitted) {
    applySavedState();
  } else {
    submitBtn.addEventListener("click", evaluate);
  }

  slide.addEventListener("instructionstatechange", (event) => {
    instructionsLocked = Boolean(event.detail?.locked);
    refreshInteractivity();
  });

  refreshInteractivity();

  return [
    {
      id: context.key ? `${context.key}-reading` : "activity-reading",
      element: slide,
      onEnter: () => {
        slide.classList.add("is-animated");
      },
      onLeave: () => {},
    },
  ];
};
