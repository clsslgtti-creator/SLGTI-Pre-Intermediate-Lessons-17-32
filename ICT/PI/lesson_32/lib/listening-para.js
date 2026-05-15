const normalizeText = (value) =>
  typeof value === "string" ? value.trim() : "";

const normalizeId = (raw, index, prefix) => {
  const normalized = normalizeText(raw);
  if (normalized.length) {
    return normalized;
  }
  return `${prefix}_${index + 1}`;
};

const normalizeAnswer = (value) => normalizeText(value).toLowerCase();

const normalizeAcceptedAnswers = (answer, alternatives = []) => {
  const seen = new Set();
  return [answer, ...(Array.isArray(alternatives) ? alternatives : [])]
    .map((value) => normalizeAnswer(value))
    .filter((value) => {
      if (!value || seen.has(value)) {
        return false;
      }
      seen.add(value);
      return true;
    });
};

const isAcceptedAnswer = (valueNormalized, segment) =>
  (segment?.acceptedAnswers || []).includes(valueNormalized);

const createHeading = (context = {}) => {
  if (context.activityNumber) {
    return `Activity ${context.activityNumber}`;
  }
  return "Activity";
};

const getMarksPerQuestion = (context) => {
  const markValue = Number(context?.marksPerQuestion);
  return Number.isFinite(markValue) && markValue > 0 ? markValue : 1;
};

const createMarksSummary = (total, marksPerQuestion) => {
  const summary = document.createElement("p");
  summary.className = "assessment-marks-summary";
  summary.textContent = `(${total} x ${marksPerQuestion} = ${total * marksPerQuestion} marks)`;
  return summary;
};

const createResultText = (correct, total, marksPerQuestion) => {
  if (!total) {
    return "";
  }
  return `Marks: ${correct * marksPerQuestion} / ${total * marksPerQuestion}`;
};

const resultMessage = (element, correct, total, marksPerQuestion, tone = "neutral") => {
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

const setErrorMessage = (element, message) => {
  element.textContent = message;
  element.classList.remove("assessment-result--success");
  element.classList.add("assessment-result--error");
};

const normalizeSegments = (raw = []) =>
  (Array.isArray(raw) ? raw : [])
    .map((entry, index) => {
      const text = normalizeText(entry?.text);
      if (text) {
        return {
          type: "text",
          text,
        };
      }

      const answer = normalizeText(entry?.blank);
      if (!answer) {
        return null;
      }

      return {
        type: "blank",
        id: normalizeId(entry?.id, index, "listening_para"),
        answer,
        answerNormalized: normalizeAnswer(answer),
        acceptedAnswers: normalizeAcceptedAnswers(
          answer,
          entry?.alternative ?? entry?.alternative_answers ?? entry?.alternatives
        ),
      };
    })
    .filter(Boolean);

export const buildListeningParaSlides = (
  activityData = {},
  context = {},
  assessment = {}
) => {
  const segments = normalizeSegments(activityData?.content);
  const blanks = segments.filter((segment) => segment.type === "blank");
  const audioSrc = normalizeText(activityData?.audio);
  const marksPerQuestion = getMarksPerQuestion(context);
  const maxPlays = 2;
  const secondPlaybackDelaySeconds = 15;
  let secondPlaybackTimer = null;
  let secondPlaybackCountdownInterval = null;
  let secondPlaybackRemaining = 0;
  let secondPlaybackCountdownActive = false;

  const slide = document.createElement("section");
  slide.className = "slide slide--assessment slide--listening-para";

  const heading = document.createElement("h2");
  heading.textContent = createHeading(context);
  slide.appendChild(heading);

  const marksSummary = createMarksSummary(blanks.length, marksPerQuestion);
  slide.appendChild(marksSummary);

  const controls = document.createElement("div");
  controls.className = "slide__controls";
  slide.appendChild(controls);

  const playBtn = document.createElement("button");
  playBtn.type = "button";
  playBtn.className = "primary-btn";
  playBtn.textContent = "Play Audio";
  controls.appendChild(playBtn);

  const statusEl = document.createElement("p");
  statusEl.className = "playback-status";
  statusEl.textContent = "Audio can be played twice.";
  controls.appendChild(statusEl);

  const paragraphWrap = document.createElement("div");
  paragraphWrap.className = "listening-paragraph";
  slide.appendChild(paragraphWrap);

  const actions = document.createElement("div");
  actions.className = "assessment-actions";
  slide.appendChild(actions);

  const submitBtn = document.createElement("button");
  submitBtn.type = "button";
  submitBtn.className = "primary-btn";
  submitBtn.textContent = "Submit";
  actions.appendChild(submitBtn);

  const resultEl = document.createElement("p");
  resultEl.className = "assessment-result";
  resultEl.setAttribute("role", "status");
  actions.appendChild(resultEl);

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

  const blankEntries = [];

  if (segments.length) {
    const paragraph = document.createElement("p");
    paragraph.className = "listening-paragraph__line";
    paragraphWrap.appendChild(paragraph);

    segments.forEach((segment) => {
      if (segment.type === "text") {
        paragraph.append(document.createTextNode(segment.text));
        return;
      }

      const blankWrap = document.createElement("span");
      blankWrap.className = "listening-paragraph__blank-wrap";

      const input = document.createElement("input");
      input.type = "text";
      input.className = "listening-paragraph__blank";
      input.autocomplete = "off";
      input.spellcheck = false;
      input.setAttribute("aria-label", `Blank ${blankEntries.length + 1}`);
      input.style.setProperty(
        "--blank-width",
        `${Math.max(6, Math.min(18, segment.answer.length + 2))}ch`
      );

      const answerEl = document.createElement("span");
      answerEl.className = "listening-paragraph__answer";
      answerEl.hidden = true;

      const entry = {
        segment,
        input,
        answerEl,
        value: "",
        valueNormalized: "",
        locked: false,
      };

      input.addEventListener("input", () => {
        if (entry.locked) {
          return;
        }
        entry.value = input.value;
        entry.valueNormalized = normalizeAnswer(input.value);
        input.classList.remove("is-correct", "is-incorrect");
        answerEl.hidden = true;
        answerEl.textContent = "";
        resultEl.classList.remove("assessment-result--error");
      });

      blankEntries.push(entry);
      blankWrap.append(input, answerEl);
      paragraph.appendChild(blankWrap);
    });
  } else {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Paragraph will be available soon.";
    paragraphWrap.appendChild(empty);
    submitBtn.disabled = true;
  }

  registerActivity({ total: blankEntries.length, marksPerQuestion });

  let audioElement = audioSrc ? new Audio(audioSrc) : null;
  let playCount = Number.isFinite(savedDetail?.playbackCount)
    ? Math.max(0, Math.min(maxPlays, savedDetail.playbackCount))
    : 0;
  let isPlaying = false;
  let autoTriggered = false;

  const refreshAnswerInteractivity = () => {
    const disabled = instructionsLocked || submissionLocked;
    blankEntries.forEach((entry) => {
      entry.input.disabled = disabled || entry.locked;
    });

    submitBtn.disabled =
      instructionsLocked ||
      submissionLocked ||
      isPlaying ||
      playCount < maxPlays ||
      !blankEntries.length;
  };

  const updatePlaybackStatus = () => {
    if (instructionsLocked) {
      statusEl.textContent = "Please listen to the instructions first.";
      playBtn.disabled = true;
      return;
    }
    if (!audioElement) {
      statusEl.textContent = "Audio not available.";
      playBtn.disabled = true;
      return;
    }
    if (submissionLocked) {
      statusEl.textContent = "Responses submitted.";
      playBtn.disabled = true;
      return;
    }
    if (
      secondPlaybackCountdownActive &&
      !isPlaying &&
      playCount < maxPlays
    ) {
      statusEl.textContent = `Second recording starts in ${secondPlaybackRemaining}s. Click Play to listen sooner.`;
      playBtn.disabled = false;
      return;
    }
    if (isPlaying) {
      statusEl.textContent = `Playing (${playCount + 1} / ${maxPlays})...`;
      playBtn.disabled = true;
      return;
    }
    if (playCount >= maxPlays) {
      statusEl.textContent = "Audio played twice.";
      playBtn.disabled = true;
      return;
    }
    statusEl.textContent =
      playCount === 0
        ? "Audio can be played twice."
        : `You can play ${maxPlays - playCount} more time(s).`;
    playBtn.disabled = false;
  };

  const handleAudioError = () => {
    statusEl.textContent = "Unable to play audio.";
    playBtn.disabled = true;
    refreshAnswerInteractivity();
  };

  const clearSecondPlaybackTimers = () => {
    if (secondPlaybackTimer !== null) {
      window.clearTimeout(secondPlaybackTimer);
      secondPlaybackTimer = null;
    }
    if (secondPlaybackCountdownInterval !== null) {
      window.clearInterval(secondPlaybackCountdownInterval);
      secondPlaybackCountdownInterval = null;
    }
    secondPlaybackRemaining = 0;
    secondPlaybackCountdownActive = false;
  };

  const scheduleSecondPlayback = () => {
    if (
      secondPlaybackCountdownActive ||
      !audioElement ||
      instructionsLocked ||
      submissionLocked ||
      playCount < 1 ||
      playCount >= maxPlays
    ) {
      return;
    }

    clearSecondPlaybackTimers();
    secondPlaybackRemaining = secondPlaybackDelaySeconds;
    secondPlaybackCountdownActive = true;

    const renderCountdown = () => {
      statusEl.textContent = `Second recording starts in ${secondPlaybackRemaining}s. Click Play to listen sooner.`;
    };

    renderCountdown();
    playBtn.disabled = false;

    secondPlaybackTimer = window.setTimeout(() => {
      clearSecondPlaybackTimers();
      beginPlayback();
    }, secondPlaybackDelaySeconds * 1000);

    secondPlaybackCountdownInterval = window.setInterval(() => {
      secondPlaybackRemaining -= 1;
      if (secondPlaybackRemaining <= 0) {
        clearSecondPlaybackTimers();
        return;
      }
      renderCountdown();
    }, 1000);
  };

  const handleAudioEnded = () => {
    isPlaying = false;
    playCount = Math.min(maxPlays, playCount + 1);
    if (playCount < maxPlays) {
      scheduleSecondPlayback();
    }
    updatePlaybackStatus();
    refreshAnswerInteractivity();
  };

  if (audioElement) {
    audioElement.addEventListener("ended", handleAudioEnded);
    audioElement.addEventListener("error", handleAudioError);
  } else {
    playBtn.disabled = true;
  }

  const beginPlayback = () => {
    if (!audioElement || submissionLocked || instructionsLocked) {
      return;
    }
    if (playCount >= maxPlays) {
      updatePlaybackStatus();
      return;
    }
    clearSecondPlaybackTimers();
    try {
      audioElement.currentTime = 0;
    } catch {
      /* ignore */
    }
    const playPromise = audioElement.play();
    if (playPromise?.catch) {
      playPromise.catch(handleAudioError);
    }
    isPlaying = true;
    updatePlaybackStatus();
    refreshAnswerInteractivity();
  };

  playBtn.addEventListener("click", () => {
    if (isPlaying || playCount >= maxPlays) {
      return;
    }
    autoTriggered = true;
    slide._autoTriggered = true;
    beginPlayback();
  });

  const lockEntry = (entry, isCorrect) => {
    entry.locked = true;
    entry.input.disabled = true;
    entry.input.classList.toggle("is-correct", isCorrect);
    entry.input.classList.toggle("is-incorrect", !isCorrect);
    if (isCorrect) {
      entry.answerEl.textContent = "";
      entry.answerEl.hidden = true;
      return;
    }
    entry.answerEl.textContent = `Answer: ${entry.segment.answer}`;
    entry.answerEl.hidden = false;
  };

  const evaluate = () => {
    if (!blankEntries.length) {
      return;
    }
    if (playCount < maxPlays) {
      setErrorMessage(
        resultEl,
        "Please listen to the audio twice before submitting."
      );
      return;
    }

    const unanswered = blankEntries.filter(
      (entry) => !normalizeText(entry.input.value)
    );
    if (unanswered.length) {
      setErrorMessage(resultEl, "Please fill in every blank.");
      return;
    }

    let correctCount = 0;
    blankEntries.forEach((entry) => {
      entry.value = entry.input.value;
      entry.valueNormalized = normalizeAnswer(entry.input.value);
      const isCorrect = isAcceptedAnswer(entry.valueNormalized, entry.segment);
      if (isCorrect) {
        correctCount += 1;
      }
      lockEntry(entry, isCorrect);
    });

    submissionLocked = true;
    refreshAnswerInteractivity();
    submitBtn.textContent = "Submitted";
    updatePlaybackStatus();

    const detail = {
      answers: blankEntries.reduce((acc, entry) => {
        acc[entry.segment.id] = entry.input.value;
        return acc;
      }, {}),
      playbackCount: playCount,
    };

    submitResult({
      total: blankEntries.length,
      correct: correctCount,
      marksPerQuestion,
      detail,
      timestamp: new Date().toISOString(),
    });

    resultMessage(
      resultEl,
      correctCount,
      blankEntries.length,
      marksPerQuestion,
      correctCount === blankEntries.length ? "success" : "neutral"
    );
  };

  const applySavedState = () => {
    const storedAnswers = savedDetail?.answers || {};
    let correctCount = 0;

    blankEntries.forEach((entry) => {
      const storedAnswer = storedAnswers[entry.segment.id];
      if (typeof storedAnswer === "string") {
        entry.input.value = storedAnswer;
        entry.value = storedAnswer;
        entry.valueNormalized = normalizeAnswer(storedAnswer);
      }

      const isCorrect = isAcceptedAnswer(entry.valueNormalized, entry.segment);
      if (isCorrect) {
        correctCount += 1;
      }
      lockEntry(entry, isCorrect);
    });

    submissionLocked = true;
    refreshAnswerInteractivity();
    submitBtn.textContent = "Submitted";
    updatePlaybackStatus();
    resultMessage(resultEl, correctCount, blankEntries.length, savedState?.marksPerQuestion || marksPerQuestion);
  };

  if (savedState?.submitted) {
    applySavedState();
  } else {
    submitBtn.addEventListener("click", evaluate);
  }

  slide.addEventListener("instructionstatechange", (event) => {
    instructionsLocked = Boolean(event.detail?.locked);
    refreshAnswerInteractivity();
    updatePlaybackStatus();
  });

  refreshAnswerInteractivity();
  updatePlaybackStatus();

  const onLeave = () => {
    clearSecondPlaybackTimers();
    if (audioElement) {
      audioElement.pause();
      audioElement.currentTime = 0;
    }
    isPlaying = false;
    autoTriggered = false;
    slide._autoTriggered = false;
    updatePlaybackStatus();
    refreshAnswerInteractivity();
  };

  const slideId = context.key
    ? `${context.key}-listening-para`
    : "activity-listening-para";

  return [
    {
      id: slideId,
      element: slide,
      autoPlay: {
        button: playBtn,
        trigger: () => {
          if (autoTriggered || isPlaying || playCount >= maxPlays) {
            return;
          }
          autoTriggered = true;
          slide._autoTriggered = true;
          beginPlayback();
        },
        status: statusEl,
      },
      onLeave,
      instructionCountdownSeconds: 15,
    },
  ];
};


