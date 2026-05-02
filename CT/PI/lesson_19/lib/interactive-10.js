import { audioManager, computeSegmentGapMs } from "./audio-manager.js";
import { showCompletionModal } from "./completion-modal.js";

const MCQ_INSTRUCTION_TEXT = "Choose the correct answer.";
const LISTEN_REPEAT_INSTRUCTION_TEXT = "Listen and repeat each sentence.";

const trimText = (value) => (typeof value === "string" ? value.trim() : "");

const normalizeAnswer = (value) => trimText(value).toLowerCase();

const shuffleArray = (items = []) => {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index],
    ];
  }
  return shuffled;
};

const waitMs = (duration, { signal } = {}) =>
  new Promise((resolve) => {
    if (!Number.isFinite(duration) || duration <= 0) {
      resolve();
      return;
    }

    let timeoutId = null;

    const cleanup = () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }
      signal?.removeEventListener("abort", onAbort);
    };

    const onAbort = () => {
      cleanup();
      resolve();
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }

    signal?.addEventListener("abort", onAbort, { once: true });
    timeoutId = window.setTimeout(() => {
      cleanup();
      resolve();
    }, duration);
  });

const smoothScrollIntoView = (element) => {
  if (!element) {
    return;
  }
  element.scrollIntoView({ behavior: "smooth", block: "center" });
};

const createStatus = () => {
  const status = document.createElement("p");
  status.className = "playback-status";
  status.textContent = "";
  return status;
};

const createHeading = (slide, text) => {
  const heading = document.createElement("h2");
  heading.textContent = text;
  slide.appendChild(heading);
  return heading;
};

const createInstruction = (slide, text) => {
  const instruction = document.createElement("p");
  instruction.className = "slide__instruction";
  instruction.textContent = text;
  slide.appendChild(instruction);
  return instruction;
};

const insertFocusElement = (heading, focusText, includeFocus) => {
  const trimmed = trimText(focusText);
  if (!includeFocus || !trimmed || !heading) {
    return;
  }

  const focusEl = document.createElement("p");
  focusEl.className = "activity-focus";

  const label = document.createElement("span");
  label.className = "activity-focus__label";
  label.textContent = "Focus";

  focusEl.append(label, `: ${trimmed}`);
  heading.insertAdjacentElement("afterend", focusEl);
};

const buildSlideId = (activityNumber, letter, role) => {
  const suffix = letter ? `-${letter}` : "";
  return activityNumber
    ? `activity-${activityNumber}${suffix}-${role}`
    : `activity${suffix}-${role}`;
};

const normalizeQuestions = (raw = []) => {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((item, index) => {
      const question = trimText(item?.question);
      const answer = trimText(item?.answer);
      const options = Array.isArray(item?.options)
        ? item.options.map((option) => trimText(option)).filter(Boolean)
        : [];

      if (!question || !answer || options.length < 2) {
        return null;
      }

      const optionSet = Array.from(new Set([...options, answer]));
      return {
        id: trimText(item?.id) || `mcq_${index + 1}`,
        question,
        answer,
        answerNormalized: normalizeAnswer(answer),
        options: shuffleArray(optionSet),
      };
    })
    .filter(Boolean);
};

const normalizeListenRepeatItems = (raw = []) => {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((item, index) => {
      const text = trimText(item?.text);
      const audio = trimText(item?.audio);
      if (!text || !audio) {
        return null;
      }
      return {
        id: trimText(item?.id) || `repeat_${index + 1}`,
        text,
        audio,
      };
    })
    .filter(Boolean);
};

const createDialogueTables = (tablesData = []) => {
  if (!Array.isArray(tablesData) || !tablesData.length) {
    return null;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "dialogue-table-group";
  const tables = [];

  tablesData.forEach((tableData) => {
    if (!Array.isArray(tableData) || !tableData.length) {
      return;
    }

    const table = document.createElement("table");
    table.className = "dialogue-table";
    const tbody = document.createElement("tbody");
    const columnSpans = [];

    tableData.forEach((rowData) => {
      if (!Array.isArray(rowData) || !rowData.length) {
        return;
      }

      const row = document.createElement("tr");
      let columnIndex = 0;
      let hasCell = false;

      rowData.forEach((cellValue) => {
        if (cellValue === null || cellValue === undefined) {
          const tracker = columnSpans[columnIndex];
          if (tracker?.cell) {
            tracker.rowSpan += 1;
            tracker.cell.rowSpan = tracker.rowSpan;
          }
          columnIndex += 1;
          return;
        }

        const cell = document.createElement("td");
        cell.textContent = `${cellValue}`;
        row.appendChild(cell);
        columnSpans[columnIndex] = { cell, rowSpan: 1 };
        columnIndex += 1;
        hasCell = true;
      });

      if (hasCell) {
        tbody.appendChild(row);
      }
    });

    if (tbody.children.length) {
      table.appendChild(tbody);
      wrapper.appendChild(table);
      tables.push(table);
    }
  });

  if (!tables.length) {
    return null;
  }

  wrapper.classList.add(
    tables.length === 1 ? "dialogue-table-group--single" : "dialogue-table-group--multi"
  );
  return wrapper;
};

const createIntroBox = (data = {}) => {
  const subtitle = trimText(data?.subtitle);
  const tables = createDialogueTables(data?.tables);

  if (!subtitle && !tables) {
    return null;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "interactive10-intro";

  if (subtitle) {
    const subtitleEl = document.createElement("p");
    subtitleEl.className = "interactive10-subtitle";
    subtitleEl.textContent = subtitle;
    wrapper.appendChild(subtitleEl);
  }

  if (tables) {
    wrapper.appendChild(tables);
  }

  return wrapper;
};

const buildMcqSlide = (activityA = {}, context = {}) => {
  const {
    activityNumber = null,
    activityLabel = "Activity",
    focusText = "",
    includeFocus = false,
  } = context;

  const slide = document.createElement("section");
  slide.className =
    "slide slide--listening listening-slide listening-slide--mcq interactive10-slide interactive10-slide--mcq";

  const heading = createHeading(slide, `${activityLabel}a`);
  insertFocusElement(heading, focusText, includeFocus);
  createInstruction(slide, MCQ_INSTRUCTION_TEXT);

  const introBox = createIntroBox(activityA);
  if (introBox) {
    slide.appendChild(introBox);
  }

  const controls = document.createElement("div");
  controls.className = "slide__controls";

  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "secondary-btn";
  resetBtn.textContent = "Reset";

  const checkBtn = document.createElement("button");
  checkBtn.type = "button";
  checkBtn.className = "primary-btn";
  checkBtn.textContent = "Check Answers";
  checkBtn.disabled = true;

  const status = createStatus();
  controls.append(resetBtn, checkBtn, status);

  const grid = document.createElement("div");
  grid.className = "listening-mcq-grid interactive10-mcq-grid";
  slide.appendChild(grid);
  slide.appendChild(controls);

  const questions = shuffleArray(normalizeQuestions(activityA?.content));
  const answeredQuestions = new Set();
  let completionShown = false;
  let answersChecked = false;

  const entries = questions.map((question, index) => {
    const card = document.createElement("article");
    card.className = "dialogue-card dialogue-card--listening interactive10-question-card";

    const title = document.createElement("h3");
    title.className = "dialogue-card__title";
    title.textContent = `${index + 1}`;
    card.appendChild(title);

    const prompt = document.createElement("p");
    prompt.className = "interactive10-question";
    prompt.textContent = question.question;
    card.appendChild(prompt);

    const optionGroup = document.createElement("div");
    optionGroup.className = "listening-option-group";

    const buttons = question.options.map((option) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "listening-option";
      button.textContent = option;
      button.dataset.optionValue = option;
      button.dataset.optionNormalized = normalizeAnswer(option);
      optionGroup.appendChild(button);
      return button;
    });

    card.appendChild(optionGroup);

    const feedback = document.createElement("p");
    feedback.className = "listening-feedback";
    feedback.textContent = "";
    card.appendChild(feedback);

    grid.appendChild(card);

    return {
      question,
      card,
      buttons,
      feedback,
      selectedNormalized: "",
    };
  });

  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Questions will be added soon.";
    grid.appendChild(empty);
    checkBtn.disabled = true;
    resetBtn.disabled = true;
  }

  const clearFeedback = (entry) => {
    entry.card.classList.remove("is-correct", "is-incorrect", "has-feedback");
    entry.feedback.textContent = "";
    entry.feedback.className = "listening-feedback";
    entry.buttons.forEach((button) => {
      button.disabled = false;
      button.classList.remove("is-correct", "is-incorrect");
    });
  };

  const updateStatus = () => {
    if (answersChecked) {
      return;
    }
    checkBtn.disabled = answeredQuestions.size !== entries.length;
    status.textContent = answeredQuestions.size
      ? `${answeredQuestions.size} of ${entries.length} answered.`
      : "";
  };

  const applyFeedback = () => {
    answersChecked = true;
    let correctCount = 0;

    entries.forEach((entry) => {
      const isCorrect =
        entry.selectedNormalized &&
        entry.selectedNormalized === entry.question.answerNormalized;

      if (isCorrect) {
        correctCount += 1;
      }

      entry.card.classList.add("has-feedback");
      entry.card.classList.add(isCorrect ? "is-correct" : "is-incorrect");

      const selectedButton = entry.buttons.find(
        (button) => button.dataset.optionNormalized === entry.selectedNormalized
      );
      const correctButton = entry.buttons.find(
        (button) =>
          button.dataset.optionNormalized === entry.question.answerNormalized
      );

      selectedButton?.classList.add(isCorrect ? "is-correct" : "is-incorrect");
      correctButton?.classList.add("is-correct");
      entry.buttons.forEach((button) => {
        button.disabled = true;
      });

      entry.feedback.classList.remove(
        "listening-feedback--positive",
        "listening-feedback--negative",
        "listening-feedback--neutral"
      );

      if (!entry.selectedNormalized) {
        entry.feedback.textContent = `No answer selected. Correct answer: ${entry.question.answer}`;
        entry.feedback.classList.add("listening-feedback--neutral");
      } else if (isCorrect) {
        entry.feedback.textContent = "Correct!";
        entry.feedback.classList.add("listening-feedback--positive");
      } else {
        entry.feedback.textContent = `Incorrect. Correct answer: ${entry.question.answer}`;
        entry.feedback.classList.add("listening-feedback--negative");
      }
    });

    status.textContent = `Score: ${correctCount} / ${entries.length}`;
    checkBtn.disabled = true;
    if (!completionShown && entries.length) {
      completionShown = true;
      showCompletionModal({
        title: "Results",
        message: `You answered ${correctCount} out of ${entries.length} correctly.`,
      });
    }
  };

  const resetAll = () => {
    answersChecked = false;
    completionShown = false;
    answeredQuestions.clear();
    checkBtn.disabled = true;
    entries.forEach((entry) => {
      entry.selectedNormalized = "";
      clearFeedback(entry);
      entry.buttons.forEach((button) => {
        button.classList.remove("is-selected");
      });
    });
    updateStatus();
  };

  entries.forEach((entry) => {
    entry.buttons.forEach((button) => {
      button.addEventListener("click", () => {
        if (answersChecked) {
          return;
        }
        clearFeedback(entry);
        entry.selectedNormalized = button.dataset.optionNormalized || "";
        entry.buttons.forEach((btn) => btn.classList.remove("is-selected"));
        button.classList.add("is-selected");
        answeredQuestions.add(entry.question.id);
        updateStatus();
      });
    });
  });

  checkBtn.addEventListener("click", () => {
    if (!entries.length || answersChecked) {
      return;
    }
    applyFeedback();
  });

  resetBtn.addEventListener("click", resetAll);

  return {
    id: buildSlideId(activityNumber, "a", "listening1-mcq"),
    element: slide,
    onLeave: () => {
      resetAll();
    },
  };
};

const buildListenRepeatSlide = (items = [], context = {}) => {
  const {
    activityNumber = null,
    activityLabel = "Activity",
    repeatPauseMs = 1500,
  } = context;

  const entriesData = normalizeListenRepeatItems(items);
  const slide = document.createElement("section");
  slide.className =
    "slide slide--listen-repeat listening-slide listening-slide--repeat interactive10-slide interactive10-slide--repeat";

  createHeading(slide, `${activityLabel}b`);
  createInstruction(slide, LISTEN_REPEAT_INSTRUCTION_TEXT);

  const controls = document.createElement("div");
  controls.className = "slide__controls";
  const startBtn = document.createElement("button");
  startBtn.type = "button";
  startBtn.className = "primary-btn";
  startBtn.textContent = "Start";
  const status = createStatus();
  controls.append(startBtn, status);
  slide.appendChild(controls);

  const list = document.createElement("div");
  list.className = "dialogue-grid listening-read-grid";
  slide.appendChild(list);

  const entries = entriesData.map((entry, index) => {
    const card = document.createElement("article");
    card.className = "dialogue-card dialogue-card--reading listening-read-card";

    const title = document.createElement("h3");
    title.className = "dialogue-card__title";
    title.textContent = `${index + 1}`;
    card.appendChild(title);

    const wrapper = document.createElement("div");
    wrapper.className = "dialogue-card__texts";

    const line = document.createElement("p");
    line.className = "dialogue-card__line";
    line.textContent = entry.text;
    wrapper.appendChild(line);

    card.appendChild(wrapper);
    list.appendChild(card);

    return {
      entry,
      card,
      line,
    };
  });

  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Audio will be added soon.";
    list.appendChild(empty);
  }

  let sequenceAbort = null;
  let autoTriggered = false;
  let pauseRequested = false;

  const playbackState = {
    mode: "idle",
    resumeIndex: 0,
  };

  const updateButtonLabel = () => {
    if (playbackState.mode === "playing") {
      startBtn.textContent = "Pause";
      return;
    }
    if (playbackState.mode === "paused") {
      startBtn.textContent = "Resume";
      return;
    }
    startBtn.textContent = "Start";
  };

  const setPlaybackMode = (mode, { resumeIndex } = {}) => {
    playbackState.mode = mode;
    if (Number.isInteger(resumeIndex)) {
      playbackState.resumeIndex = Math.max(0, resumeIndex);
    }
    updateButtonLabel();
  };

  const resetEntries = () => {
    entries.forEach(({ card, line }) => {
      card.classList.remove("is-active");
      line.classList.remove("is-playing");
    });
  };

  const resetPlaybackState = () => {
    setPlaybackMode("idle", { resumeIndex: 0 });
    autoTriggered = false;
    slide._autoTriggered = false;
    startBtn.disabled = false;
  };

  updateButtonLabel();

  const runSequence = async (fromIndex = 0) => {
    if (!entries.length) {
      status.textContent = "Audio will be added soon.";
      resetPlaybackState();
      return;
    }

    pauseRequested = false;
    sequenceAbort?.abort();
    sequenceAbort = new AbortController();
    const { signal } = sequenceAbort;

    audioManager.stopAll();
    resetEntries();
    setPlaybackMode("playing", { resumeIndex: fromIndex });
    status.textContent = fromIndex === 0 ? "Starting..." : "Resuming...";

    let completed = false;

    try {
      for (let index = fromIndex; index < entries.length; index += 1) {
        playbackState.resumeIndex = index;
        const item = entries[index];
        item.card.classList.add("is-active");
        item.line.classList.add("is-playing");
        status.textContent = "Listening...";
        smoothScrollIntoView(item.card);

        try {
          await audioManager.play(item.entry.audio, { signal });
        } catch (error) {
          if (!signal.aborted) {
            console.error(error);
            status.textContent = "Unable to play audio.";
          }
        } finally {
          item.line.classList.remove("is-playing");
        }

        if (signal.aborted) {
          break;
        }

        playbackState.resumeIndex = index + 1;

        let gapMs = 0;
        try {
          const duration = await audioManager.getDuration(item.entry.audio);
          gapMs = computeSegmentGapMs("listen-repeat", duration, {
            repeatPauseMs,
          });
        } catch (error) {
          console.error(error);
        }

        if (gapMs > 0) {
          status.textContent = "Your turn...";
          await waitMs(gapMs, { signal });
        }

        item.card.classList.remove("is-active");
        if (signal.aborted) {
          break;
        }
      }

      if (!signal.aborted) {
        completed = true;
        status.textContent = "Playback complete.";
      }
    } finally {
      const aborted = sequenceAbort?.signal?.aborted ?? false;
      sequenceAbort = null;

      if (aborted && pauseRequested) {
        setPlaybackMode("paused", { resumeIndex: playbackState.resumeIndex });
        status.textContent = "Paused.";
      } else if (completed) {
        resetPlaybackState();
        resetEntries();
      } else if (aborted) {
        status.textContent = "Playback stopped.";
        resetPlaybackState();
        resetEntries();
      } else {
        resetPlaybackState();
      }

      pauseRequested = false;
    }
  };

  const startSequence = (fromIndex = 0) => {
    autoTriggered = true;
    slide._autoTriggered = true;
    runSequence(fromIndex);
  };

  const triggerAutoPlay = () => {
    if (
      autoTriggered ||
      playbackState.mode === "playing" ||
      playbackState.mode === "paused"
    ) {
      return;
    }
    startSequence();
  };

  startBtn.addEventListener("click", () => {
    if (playbackState.mode === "playing") {
      pauseRequested = true;
      sequenceAbort?.abort();
      return;
    }

    if (playbackState.mode === "paused") {
      startSequence(playbackState.resumeIndex);
      return;
    }

    startSequence();
  });

  const onLeave = () => {
    pauseRequested = false;
    sequenceAbort?.abort();
    sequenceAbort = null;
    audioManager.stopAll();
    resetEntries();
    resetPlaybackState();
    status.textContent = "";
  };

  return {
    id: buildSlideId(activityNumber, "b", "listening1-repeat"),
    element: slide,
    autoPlay: {
      button: startBtn,
      trigger: triggerAutoPlay,
      status,
    },
    onLeave,
  };
};

const getRepeatPauseMs = (activityData, fallback = 1500) => {
  const parsed = Number(
    activityData?.listen_repeat_pause_ms ?? activityData?.repeat_pause_ms
  );
  return Number.isFinite(parsed) ? Math.max(500, parsed) : fallback;
};

export const buildInteractive10Slides = (activityData = {}, context = {}) => {
  const { activityNumber, focus } = context;
  const activityLabel = activityNumber ? `Activity ${activityNumber}` : "Activity";
  const focusText = trimText(focus);
  const repeatPauseMs = getRepeatPauseMs(activityData);

  const slides = [];

  if (activityData?.content?.activity_a) {
    slides.push(
      buildMcqSlide(activityData.content.activity_a, {
        activityNumber,
        activityLabel,
        focusText,
        includeFocus: Boolean(focusText),
      })
    );
  }

  const repeatItems = activityData?.content?.activity_b;
  if (Array.isArray(repeatItems) && repeatItems.length) {
    slides.push(
      buildListenRepeatSlide(repeatItems, {
        activityNumber,
        activityLabel,
        repeatPauseMs,
      })
    );
  }

  return slides;
};
