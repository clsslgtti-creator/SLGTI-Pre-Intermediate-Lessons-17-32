import {
  audioManager,
  computeSegmentGapMs,
  getBetweenItemGapMs,
} from "./audio-manager.js";
import { showCompletionModal } from "./completion-modal.js";

const trimString = (value) => (typeof value === "string" ? value.trim() : "");

const normalizeAnswer = (value) =>
  trimString(value)
    .toLowerCase()
    .replace(/[.,;:!?]+$/g, "")
    .replace(/\s+/g, " ");

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

const buildHeading = (slide, headingText) => {
  const heading = document.createElement("h2");
  heading.textContent = headingText;
  slide.appendChild(heading);
};

const ensureInstructionAnchor = (slide, text = "") => {
  const instruction = document.createElement("p");
  instruction.className = "slide__instruction";
  instruction.textContent = text;
  slide.appendChild(instruction);
};

const maybeInsertFocus = (slide, focusText, includeFocus) => {
  if (!includeFocus) {
    return;
  }
  const trimmed = trimString(focusText);
  if (!trimmed) {
    return;
  }
  const focusEl = document.createElement("p");
  focusEl.className = "activity-focus";
  focusEl.textContent = trimmed;
  slide.querySelector("h2")?.insertAdjacentElement("afterend", focusEl);
};

const normalizeLineItems = (raw = []) => {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((entry, index) => {
      const id = trimString(entry?.id) || `line_${index + 1}`;
      const text = trimString(entry?.text);
      const audio = trimString(entry?.audio);
      if (!text || !audio) {
        return null;
      }
      return { id, text, audio };
    })
    .filter(Boolean);
};

const getRepeatPauseMs = (activityData, fallback = 1500) => {
  const raw =
    activityData?.listen_repeat_pause_ms ?? activityData?.repeat_pause_ms;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(500, parsed) : fallback;
};

const createSubActivityContext = (base, letter, includeFocus = false) => ({
  activityLabel: base.activityLabel,
  activityNumber: base.activityNumber,
  activityFocus: base.activityFocus,
  includeFocus,
  subActivitySuffix: letter ? letter : "",
  subActivityLetter: letter || "",
});

const normalizeBlankTable = (raw = {}) => {
  const audio = trimString(raw?.audio);
  const title = trimString(raw?.title);
  const table = Array.isArray(raw?.table) ? raw.table : [];
  let blankIndex = 0;

  const rows = table
    .map((row) => {
      if (!Array.isArray(row)) {
        return null;
      }

      const cells = row
        .map((cell) => {
          if (!cell || typeof cell !== "object") {
            return null;
          }

          const isBlank = Boolean(cell.isBlank);
          const answers = Array.isArray(cell.answers)
            ? cell.answers.map((answer) => trimString(answer)).filter(Boolean)
            : [];
          const normalizedAnswers = answers.map(normalizeAnswer).filter(Boolean);
          const blankId = isBlank ? `blank_${blankIndex + 1}` : "";
          if (isBlank) {
            blankIndex += 1;
          }

          return {
            tagName: cell.type === "th" ? "th" : "td",
            prefix: trimString(cell.prefix),
            suffix: trimString(cell.suffix),
            isBlank,
            answers,
            normalizedAnswers,
            blankId,
          };
        })
        .filter(Boolean);

      return cells.length ? cells : null;
    })
    .filter(Boolean);

  return {
    audio,
    title,
    rows,
    blankCount: blankIndex,
  };
};

const buildFillBlanksSlide = (data = {}, context = {}) => {
  const {
    activityLabel = "Activity",
    activityNumber = null,
    subActivitySuffix = "",
    activityFocus = "",
    includeFocus = false,
    subActivityLetter = "",
  } = context;

  const normalized = normalizeBlankTable(data);
  const slide = document.createElement("section");
  slide.className =
    "slide slide--listening listening-slide listening-slide--fill-table";

  buildHeading(slide, `${activityLabel}${subActivitySuffix}`);
  maybeInsertFocus(slide, activityFocus, includeFocus);
  ensureInstructionAnchor(
    slide,
    "Listen to the audio twice and fill in the blanks."
  );

  const controls = document.createElement("div");
  controls.className = "slide__controls";

  const playBtn = document.createElement("button");
  playBtn.type = "button";
  playBtn.className = "primary-btn";
  playBtn.textContent = "Start";

  const status = createStatus();
  controls.append(playBtn, status);
  slide.appendChild(controls);

  const tableWrapper = document.createElement("div");
  tableWrapper.className = "listening-fill-table-wrap";

  if (normalized.title) {
    const tableTitle = document.createElement("h3");
    tableTitle.className = "listening-fill-table-title";
    tableTitle.textContent = normalized.title;
    tableWrapper.appendChild(tableTitle);
  }

  const table = document.createElement("table");
  table.className = "listening-fill-table";
  const tbody = document.createElement("tbody");
  table.appendChild(tbody);
  tableWrapper.appendChild(table);
  slide.appendChild(tableWrapper);

  const entries = [];

  normalized.rows.forEach((row) => {
    const tr = document.createElement("tr");

    row.forEach((cell) => {
      const element = document.createElement(cell.tagName);
      if (!cell.isBlank) {
        element.textContent = cell.prefix;
        tr.appendChild(element);
        return;
      }

      if (cell.prefix) {
        const prefix = document.createElement("span");
        prefix.textContent = cell.prefix;
        element.appendChild(prefix);
      }

      const input = document.createElement("input");
      input.type = "text";
      input.className = "listening-fill-input";
      input.autocomplete = "off";
      input.dataset.blankId = cell.blankId;
      input.setAttribute("aria-label", `Blank ${entries.length + 1}`);
      element.appendChild(input);

      if (cell.suffix) {
        const suffix = document.createElement("span");
        suffix.textContent = cell.suffix;
        element.appendChild(suffix);
      }

      const feedback = document.createElement("span");
      feedback.className = "listening-fill-cell-feedback";
      element.appendChild(feedback);

      entries.push({
        cell,
        cellEl: element,
        input,
        feedback,
      });

      tr.appendChild(element);
    });

    tbody.appendChild(tr);
  });

  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Fill-in-the-blank content will be added soon.";
    slide.appendChild(empty);
  }

  const actions = document.createElement("div");
  actions.className = "listening-fill-actions";

  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "secondary-btn";
  resetBtn.textContent = "Reset";

  const checkBtn = document.createElement("button");
  checkBtn.type = "button";
  checkBtn.className = "primary-btn";
  checkBtn.textContent = "Check Answers";
  checkBtn.disabled = true;

  const scoreEl = document.createElement("p");
  scoreEl.className = "listening-feedback listening-feedback--neutral";
  scoreEl.textContent = "";

  actions.append(resetBtn, checkBtn, scoreEl);
  slide.appendChild(actions);

  let playbackController = null;
  let playbackCount = 0;
  let secondPlaybackTimer = null;
  let autoTriggered = false;
  let isPlaying = false;
  let answersChecked = false;

  const allBlanksFilled = () =>
    entries.length > 0 &&
    entries.every((entry) => trimString(entry.input.value).length > 0);

  const updateButtonState = () => {
    playBtn.disabled =
      isPlaying || !normalized.audio || playbackCount >= 2 || answersChecked;
    playBtn.textContent =
      playbackCount === 0 ? "Start" : playbackCount === 1 ? "Play Again" : "Played Twice";
    checkBtn.disabled = answersChecked || playbackCount < 2 || !allBlanksFilled();
  };

  const clearPlaybackTimers = () => {
    if (secondPlaybackTimer !== null) {
      window.clearTimeout(secondPlaybackTimer);
      secondPlaybackTimer = null;
    }
  };

  const scheduleSecondPlayback = () => {
    clearPlaybackTimers();
    status.textContent = "Second playback starts soon...";
    secondPlaybackTimer = window.setTimeout(() => {
      secondPlaybackTimer = null;
      beginPlayback();
    }, 3000);
  };

  const beginPlayback = async () => {
    if (!normalized.audio) {
      status.textContent = "Audio will be added soon.";
      updateButtonState();
      return;
    }

    if (playbackCount >= 2) {
      status.textContent = "You have already listened twice.";
      updateButtonState();
      return;
    }

    clearPlaybackTimers();
    playbackController?.abort();
    playbackController = new AbortController();
    const { signal } = playbackController;

    isPlaying = true;
    status.textContent =
      playbackCount === 0 ? "Playing..." : "Replaying audio...";
    updateButtonState();
    audioManager.stopAll();

    try {
      await audioManager.play(normalized.audio, { signal });
      if (signal.aborted) {
        status.textContent = "Playback stopped.";
        return;
      }

      playbackCount += 1;
      if (playbackCount >= 2) {
        status.textContent = "You have listened twice. Fill every blank, then check.";
      } else {
        scheduleSecondPlayback();
      }
    } catch (error) {
      if (!signal.aborted) {
        console.error(error);
        status.textContent = "Unable to play audio.";
      }
    } finally {
      playbackController = null;
      isPlaying = false;
      updateButtonState();
    }
  };

  const checkAnswers = () => {
    if (answersChecked || playbackCount < 2 || !allBlanksFilled()) {
      return;
    }

    answersChecked = true;
    let correctCount = 0;

    entries.forEach((entry) => {
      const attempt = normalizeAnswer(entry.input.value);
      const isCorrect = entry.cell.normalizedAnswers.includes(attempt);
      if (isCorrect) {
        correctCount += 1;
      }

      entry.input.disabled = true;
      entry.cellEl.classList.add(isCorrect ? "is-correct" : "is-incorrect");
      entry.input.classList.add(isCorrect ? "is-correct" : "is-incorrect");
      entry.feedback.textContent = isCorrect
        ? "Correct"
        : `Answer: ${entry.cell.answers[0] ?? ""}`;
    });

    scoreEl.textContent = `Score: ${correctCount} / ${entries.length}`;
    scoreEl.classList.remove(
      "listening-feedback--positive",
      "listening-feedback--negative",
      "listening-feedback--neutral"
    );
    scoreEl.classList.add(
      correctCount === entries.length
        ? "listening-feedback--positive"
        : "listening-feedback--negative"
    );

    status.textContent = `You answered ${correctCount} of ${entries.length} correctly.`;
    updateButtonState();
    showCompletionModal({
      title: "Results",
      message: `You answered ${correctCount} out of ${entries.length} correctly.`,
    });
  };

  const resetAll = () => {
    clearPlaybackTimers();
    playbackController?.abort();
    playbackController = null;
    audioManager.stopAll();
    playbackCount = 0;
    autoTriggered = false;
    slide._autoTriggered = false;
    isPlaying = false;
    answersChecked = false;
    status.textContent = "";
    scoreEl.textContent = "";
    scoreEl.className = "listening-feedback listening-feedback--neutral";
    entries.forEach((entry) => {
      entry.input.value = "";
      entry.input.disabled = false;
      entry.input.classList.remove("is-correct", "is-incorrect");
      entry.cellEl.classList.remove("is-correct", "is-incorrect");
      entry.feedback.textContent = "";
    });
    updateButtonState();
  };

  entries.forEach((entry) => {
    entry.input.addEventListener("input", () => {
      if (answersChecked) {
        return;
      }
      entry.input.classList.remove("is-correct", "is-incorrect");
      entry.cellEl.classList.remove("is-correct", "is-incorrect");
      entry.feedback.textContent = "";
      updateButtonState();
    });
  });

  playBtn.addEventListener("click", () => {
    beginPlayback();
  });

  checkBtn.addEventListener("click", checkAnswers);
  resetBtn.addEventListener("click", resetAll);

  const triggerAutoPlay = () => {
    if (autoTriggered) {
      return;
    }
    autoTriggered = true;
    slide._autoTriggered = true;
    beginPlayback();
  };

  updateButtonState();

  const suffixSegment = subActivityLetter ? `-${subActivityLetter}` : "";

  return {
    id: activityNumber
      ? `activity-${activityNumber}${suffixSegment}-listening`
      : "activity-listening",
    element: slide,
    autoPlay: {
      button: playBtn,
      trigger: triggerAutoPlay,
      status,
    },
    onLeave: resetAll,
    instructionCountdownSeconds: 15,
  };
};

const createSequencedTextSlide = (
  items = [],
  context = {},
  {
    mode = "listen",
    repeatPauseMs = 1500,
    autoDelayMs = 5000,
    presentation = "cards",
  } = {}
) => {
  const {
    activityLabel = "Activity",
    activityNumber = null,
    subActivitySuffix = "",
    activityFocus = "",
    includeFocus = false,
    subActivityLetter = "",
  } = context;

  const isRepeatMode = mode === "listen-repeat";
  const isReadMode = mode === "read";
  const slide = document.createElement("section");
  slide.className = isRepeatMode
    ? "slide slide--listen-repeat listening-slide listening-slide--repeat"
    : "slide slide--listening listening-slide listening-slide--read";

  buildHeading(slide, `${activityLabel}${subActivitySuffix}`);
  maybeInsertFocus(slide, activityFocus, includeFocus);
  ensureInstructionAnchor(
    slide,
    isRepeatMode
      ? "Listen and repeat each sentence."
      : isReadMode
      ? "Read along with the audio."
      : "Listen to each sentence."
  );

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
  const paragraphLayout = presentation === "paragraph";
  list.className = paragraphLayout
    ? "listening-paragraph"
    : "dialogue-grid listening-read-grid";
  slide.appendChild(list);

  const entries = normalizeLineItems(items).map((entry, index) => {
    if (paragraphLayout) {
      const line = document.createElement("p");
      line.className = "listening-paragraph__line";
      line.textContent = entry.text;
      list.appendChild(line);
      return { entry, card: null, line };
    }

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

    return { entry, card, line };
  });

  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Audio will be added soon.";
    list.appendChild(empty);
  }

  let sequenceAbort = null;
  let autoTriggered = false;
  let pendingAutoStart = null;
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

  const setPlaybackMode = (modeValue, { resumeIndex } = {}) => {
    playbackState.mode = modeValue;
    if (Number.isInteger(resumeIndex)) {
      playbackState.resumeIndex = Math.max(0, resumeIndex);
    }
    updateButtonLabel();
  };

  const resetEntries = () => {
    entries.forEach(({ card, line }) => {
      card?.classList.remove("is-active");
      line?.classList.remove("is-playing");
    });
  };

  const resetPlaybackState = () => {
    setPlaybackMode("idle", { resumeIndex: 0 });
    autoTriggered = false;
    slide._autoTriggered = false;
    startBtn.disabled = false;
  };

  const clearAutoStart = () => {
    if (pendingAutoStart !== null) {
      window.clearTimeout(pendingAutoStart);
      pendingAutoStart = null;
    }
  };

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
        item.card?.classList.add("is-active");
        item.line?.classList.add("is-playing");
        status.textContent = "Listening...";
        smoothScrollIntoView(item.card ?? item.line);

        try {
          await audioManager.play(item.entry.audio, { signal });
        } catch (error) {
          if (!signal.aborted) {
            console.error(error);
            status.textContent = "Unable to play audio.";
          }
        } finally {
          item.line?.classList.remove("is-playing");
        }

        if (signal.aborted) {
          break;
        }

        playbackState.resumeIndex = index + 1;

        let gapMs = 0;
        try {
          const duration = await audioManager.getDuration(item.entry.audio);
          gapMs = computeSegmentGapMs(
            isReadMode ? "read" : isRepeatMode ? "listen-repeat" : "listen",
            duration,
            isRepeatMode ? { repeatPauseMs } : undefined
          );
        } catch (error) {
          console.error(error);
        }

        if (gapMs > 0) {
          status.textContent = isRepeatMode
            ? "Your turn..."
            : isReadMode
            ? "Read along..."
            : "Next up...";
          await waitMs(gapMs, { signal });
        }

        item.card?.classList.remove("is-active");

        if (isReadMode && index < entries.length - 1) {
          await waitMs(getBetweenItemGapMs("read"), { signal });
        }

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
    clearAutoStart();
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
    autoTriggered = true;
    slide._autoTriggered = true;
    clearAutoStart();
    pendingAutoStart = window.setTimeout(() => {
      pendingAutoStart = null;
      runSequence();
    }, Math.max(0, autoDelayMs));
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

  updateButtonLabel();

  const suffixSegment = subActivityLetter ? `-${subActivityLetter}` : "";

  return {
    id: activityNumber
      ? `activity-${activityNumber}${suffixSegment}-${
          isRepeatMode ? "listen-repeat" : isReadMode ? "reading" : "listening"
        }`
      : `activity-${isRepeatMode ? "listen-repeat" : isReadMode ? "reading" : "listening"}`,
    element: slide,
    autoPlay: {
      button: startBtn,
      trigger: triggerAutoPlay,
      status,
    },
    onLeave: () => {
      clearAutoStart();
      pauseRequested = false;
      sequenceAbort?.abort();
      sequenceAbort = null;
      audioManager.stopAll();
      resetEntries();
      resetPlaybackState();
      status.textContent = "";
    },
  };
};

export const buildListeningElevenSlides = (activityData = {}, context = {}) => {
  const { activityNumber, focus: rawFocus } = context;
  const activityLabel = activityNumber
    ? `Activity ${activityNumber}`
    : "Activity";
  const activityFocus = trimString(rawFocus);
  const repeatPauseMs = getRepeatPauseMs(activityData);

  const baseContext = {
    activityLabel,
    activityNumber,
    activityFocus,
  };

  return [
    buildFillBlanksSlide(
      activityData?.content?.activity_a,
      createSubActivityContext(baseContext, "a", Boolean(activityFocus))
    ),
    createSequencedTextSlide(
      activityData?.content?.activity_b,
      createSubActivityContext(baseContext, "b"),
      {
        mode: "listen",
        autoDelayMs: 5000,
        presentation: "paragraph",
      }
    ),
    createSequencedTextSlide(
      activityData?.content?.activity_c,
      createSubActivityContext(baseContext, "c"),
      {
        mode: "listen-repeat",
        autoDelayMs: 5000,
        repeatPauseMs,
      }
    ),
    createSequencedTextSlide(
      activityData?.content?.activity_d,
      createSubActivityContext(baseContext, "d"),
      {
        mode: "read",
        autoDelayMs: 5000,
        repeatPauseMs,
      }
    ),
  ];
};
