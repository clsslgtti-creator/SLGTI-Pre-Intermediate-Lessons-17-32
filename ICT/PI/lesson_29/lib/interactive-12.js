import {
  createTypeInGameScene,
  normalizeTypeInExamples,
  normalizeTypeInQuestions,
  DEFAULT_FEEDBACK_ASSETS,
} from "./games/game-9.js";
import { audioManager, computeSegmentGapMs } from "./audio-manager.js";

const TYPE_IN_INSTRUCTION_TEXT =
  "Press Start to play. Type the answer and press Done.";
const LISTEN_REPEAT_INSTRUCTION_TEXT = "Listen and repeat each sentence.";

const trimText = (value) => (typeof value === "string" ? value.trim() : "");

const smoothScrollIntoView = (element) => {
  if (!element) {
    return;
  }
  element.scrollIntoView({ behavior: "smooth", block: "center" });
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

const createPlaybackStatus = () => {
  const status = document.createElement("p");
  status.className = "playback-status";
  status.textContent = "";
  return status;
};

const deriveSubActivityLetter = (key, index = 0) => {
  if (typeof key === "string") {
    const match = /activity[_-]?([a-z])/i.exec(key);
    if (match) {
      return match[1].toLowerCase();
    }
  }
  if (Number.isInteger(index)) {
    const code = 97 + index;
    if (code >= 97 && code <= 122) {
      return String.fromCharCode(code);
    }
  }
  return "";
};

const formatActivityLabel = (activityNumber, letter = "") => {
  if (activityNumber) {
    return letter
      ? `Activity ${activityNumber}${letter}`
      : `Activity ${activityNumber}`;
  }
  return letter ? `Activity ${letter}` : "Activity";
};

const insertFocusElement = (titleEl, focusText) => {
  const trimmed = trimText(focusText);
  if (!trimmed || !titleEl) {
    return;
  }
  const focusEl = document.createElement("p");
  focusEl.className = "activity-focus";
  focusEl.innerHTML = `<span class="activity-focus__label">Focus</span>${trimmed}`;
  titleEl.insertAdjacentElement("afterend", focusEl);
};

const buildTypingSlideId = (activityNumber, letter = "") => {
  const suffix = letter ? `-${letter}` : "";
  if (activityNumber) {
    return `activity-${activityNumber}${suffix}-game9`;
  }
  return `activity${suffix}-game9`;
};

const buildListenRepeatSlideId = (activityNumber, letter = "") => {
  const suffix = letter ? `-${letter}` : "";
  if (activityNumber) {
    return `activity-${activityNumber}${suffix}-listen-repeat`;
  }
  return `activity${suffix}-listen-repeat`;
};

const getRepeatPauseMs = (activityData, fallback = 1500) => {
  const raw =
    activityData?.listen_repeat_pause_ms ?? activityData?.repeat_pause_ms;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(500, parsed);
};

const parseTimerMs = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.max(5000, parsed);
};

const cloneFeedbackAssets = () => ({ ...DEFAULT_FEEDBACK_ASSETS });

const normalizeListenRepeatItems = (raw = []) => {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((entry, index) => {
      const id = trimText(entry?.id) || `line_${index + 1}`;
      const text = trimText(entry?.text);
      const audio = trimText(entry?.audio);
      if (!text || !audio) {
        return null;
      }
      return { id, text, audio };
    })
    .filter(Boolean);
};

const createTypingSlide = (gameConfig = {}, context = {}) => {
  const { slideId, activityLabel, focusText, includeFocus } = context;

  const slide = document.createElement("section");
  slide.className = "slide game-slide";
  if (slideId) {
    slide.id = slideId;
  }

  const title = document.createElement("h2");
  title.textContent = trimText(activityLabel) || "Typing";
  slide.appendChild(title);

  if (includeFocus && focusText) {
    insertFocusElement(title, focusText);
  }

  const instruction = document.createElement("p");
  instruction.className = "slide__instruction";
  instruction.textContent = TYPE_IN_INSTRUCTION_TEXT;
  slide.appendChild(instruction);

  const wrapper = document.createElement("div");
  wrapper.className = "game1-shell game9-shell";

  const stage = document.createElement("div");
  stage.className = "game1-stage game9-stage";
  const stageId = `game9-stage-${Math.random().toString(36).slice(2, 8)}`;
  stage.id = stageId;

  const status = document.createElement("p");
  status.className = "game1-status game9-status is-visible";
  status.textContent = "Loading game...";

  wrapper.append(stage, status);
  slide.appendChild(wrapper);

  const backgroundImage =
    gameConfig?.bg_image ?? gameConfig?.backgroundImage ?? null;
  const examples = normalizeTypeInExamples(gameConfig?.examples);
  const questions = normalizeTypeInQuestions(
    Array.isArray(gameConfig?.content)
      ? gameConfig.content
      : Array.isArray(gameConfig?.questions)
      ? gameConfig.questions
      : []
  );
  const feedbackAssets = cloneFeedbackAssets();
  const timePerQuestionMs =
    parseTimerMs(gameConfig?.timePerQuestionMs ?? gameConfig?.time_per_question_ms) ??
    null;

  if (!questions.length) {
    status.textContent = "The typing content is not ready yet.";
    return {
      id: slideId,
      element: slide,
      onEnter: () => {},
      onLeave: () => {},
    };
  }

  let gameInstance = null;

  const startGame = () => {
    const PhaserLib = window?.Phaser;
    if (!PhaserLib) {
      status.textContent =
        "Phaser library is missing. Please reload the lesson.";
      status.classList.add("is-error");
      return;
    }

    if (gameInstance) {
      gameInstance.destroy(true);
      gameInstance = null;
      stage.innerHTML = "";
    }

    status.textContent = "Loading game...";
    status.classList.remove("is-error");
    status.classList.remove("is-transparent");
    status.classList.add("is-visible");

    const sceneConfig = {
      examples,
      questions,
      feedbackAssets,
      backgroundImage,
      statusElement: status,
      onRoundUpdate: (info = {}) => {
        if (info.mode === "examples") {
          status.textContent = `Example ${info.exampleIndex + 1} of ${
            info.exampleTotal
          }`;
          status.classList.remove("is-transparent");
        } else if (info.mode === "questions") {
          status.textContent = `Question ${info.questionIndex + 1} of ${
            info.questionTotal
          } - Score ${info.score}/${info.total}`;
          status.classList.add("is-transparent");
        } else if (info.mode === "complete") {
          status.textContent = `Complete - Score ${info.score}/${info.total}`;
          status.classList.remove("is-transparent");
        }
        status.classList.add("is-visible");
      },
    };

    if (timePerQuestionMs) {
      sceneConfig.timePerQuestionMs = timePerQuestionMs;
    }

    const GameScene = createTypeInGameScene(sceneConfig);

    gameInstance = new PhaserLib.Game({
      type: PhaserLib.AUTO,
      parent: stageId,
      backgroundColor: "#f3f6fb",
      dom: {
        createContainer: true,
      },
      scale: {
        mode: PhaserLib.Scale.FIT,
        autoCenter: PhaserLib.Scale.CENTER_BOTH,
        width: 1280,
        height: 720,
        fullscreenTarget: stage,
        expandParent: true,
      },
      scene: GameScene,
    });
    if (gameInstance?.scale) {
      gameInstance.scale.fullscreenTarget = stage;
    }
  };

  const destroyGame = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    if (gameInstance) {
      gameInstance.destroy(true);
      gameInstance = null;
      stage.innerHTML = "";
    }
    status.textContent = "Game paused. Reopen this slide to play again.";
    status.classList.remove("is-transparent");
    status.classList.remove("is-error");
    status.classList.add("is-visible");
  };

  return {
    id: slideId,
    element: slide,
    onEnter: startGame,
    onLeave: destroyGame,
  };
};

const clearEntryHighlights = (items = []) => {
  items.forEach(({ card, line }) => {
    card?.classList.remove("is-active");
    line?.classList.remove("is-playing");
  });
};

const createListenRepeatSlide = (
  items = [],
  {
    slideId,
    activityLabel = "Activity",
    focusText = "",
    includeFocus = false,
    repeatPauseMs = 1500,
  } = {}
) => {
  const resolvedSlideId = slideId || "interactive12-listen-repeat";
  const autoDelayMs = 5000;
  const slide = document.createElement("section");
  slide.className =
    "slide slide--listen-repeat listening-slide listening-slide--repeat";
  if (resolvedSlideId) {
    slide.id = resolvedSlideId;
  }

  const title = document.createElement("h2");
  title.textContent = trimText(activityLabel) || "Activity";
  slide.appendChild(title);

  if (includeFocus && focusText) {
    insertFocusElement(title, focusText);
  }

  const instruction = document.createElement("p");
  instruction.className = "slide__instruction";
  instruction.textContent = LISTEN_REPEAT_INSTRUCTION_TEXT;
  slide.appendChild(instruction);

  const controls = document.createElement("div");
  controls.className = "slide__controls";
  const startBtn = document.createElement("button");
  startBtn.type = "button";
  startBtn.className = "primary-btn";
  startBtn.textContent = "Start";
  const status = createPlaybackStatus();
  controls.append(startBtn, status);
  slide.appendChild(controls);

  const list = document.createElement("div");
  list.className = "dialogue-grid listening-read-grid";
  slide.appendChild(list);

  const entries = items.map((entry, index) => {
    const card = document.createElement("article");
    card.className =
      "dialogue-card dialogue-card--reading listening-read-card";

    const cardTitle = document.createElement("h3");
    cardTitle.className = "dialogue-card__title";
    cardTitle.textContent = `${index + 1}`;
    card.appendChild(cardTitle);

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

  const setPlaybackMode = (mode, { resumeIndex } = {}) => {
    playbackState.mode = mode;
    if (Number.isInteger(resumeIndex)) {
      playbackState.resumeIndex = Math.max(0, resumeIndex);
    }
    updateButtonLabel();
  };

  const resetPlaybackState = () => {
    setPlaybackMode("idle", { resumeIndex: 0 });
    autoTriggered = false;
    slide._autoTriggered = false;
    startBtn.disabled = false;
  };

  updateButtonLabel();

  const clearAutoStart = () => {
    if (pendingAutoStart !== null) {
      window.clearTimeout(pendingAutoStart);
      pendingAutoStart = null;
    }
  };

  const resetEntries = () => {
    clearEntryHighlights(entries);
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

        if (signal.aborted) {
          break;
        }

        if (gapMs > 0) {
          status.textContent = "Your turn...";
          await waitMs(gapMs, { signal });
        }

        item.card?.classList.remove("is-active");
        item.line?.classList.remove("is-playing");

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

  const onLeave = () => {
    clearAutoStart();
    pauseRequested = false;
    sequenceAbort?.abort();
    sequenceAbort = null;
    audioManager.stopAll();
    resetEntries();
    resetPlaybackState();
    status.textContent = "";
  };

  return {
    id: resolvedSlideId,
    element: slide,
    autoPlay: {
      button: startBtn,
      trigger: triggerAutoPlay,
      status,
    },
    onLeave,
  };
};

const buildTypingData = (value = {}, fallback = {}) => ({
  examples: value?.examples ?? fallback.examples,
  content: Array.isArray(value?.content)
    ? value.content
    : Array.isArray(value?.questions)
    ? value.questions
    : Array.isArray(value)
    ? value
    : [],
  bg_image: value?.bg_image ?? value?.backgroundImage ?? fallback.bg_image,
  time_per_question_ms:
    value?.time_per_question_ms ??
    value?.timePerQuestionMs ??
    fallback.time_per_question_ms,
});

export const buildInteractive12Slides = (activityData = {}, context = {}) => {
  const { activityNumber, focus } = context;
  const focusText = trimText(focus);
  const content =
    activityData?.content0 ?? activityData?.content_0 ?? activityData?.content;
  const fallback = {
    examples: activityData?.examples,
    bg_image: activityData?.bg_image ?? activityData?.backgroundImage,
    time_per_question_ms: activityData?.time_per_question_ms,
  };

  const slides = [];
  let focusAssigned = false;

  const shouldIncludeFocus = () => {
    if (!focusText || focusAssigned) {
      return false;
    }
    focusAssigned = true;
    return true;
  };

  if (content && typeof content === "object" && !Array.isArray(content)) {
    Object.entries(content).forEach(([key, value], index) => {
      const letter = deriveSubActivityLetter(key, index);
      if (letter === "a") {
        slides.push(
          createTypingSlide(buildTypingData(value, fallback), {
            slideId: buildTypingSlideId(activityNumber, letter),
            activityLabel: formatActivityLabel(activityNumber, letter),
            focusText,
            includeFocus: shouldIncludeFocus(),
          })
        );
        return;
      }

      const items = normalizeListenRepeatItems(value);
      if (items.length) {
        slides.push(
          createListenRepeatSlide(items, {
            slideId: buildListenRepeatSlideId(activityNumber, letter),
            activityLabel: formatActivityLabel(activityNumber, letter),
            focusText,
            includeFocus: shouldIncludeFocus(),
            repeatPauseMs: getRepeatPauseMs(activityData),
          })
        );
      }
    });
  } else if (Array.isArray(content)) {
    slides.push(
      createTypingSlide(buildTypingData(content, fallback), {
        slideId: buildTypingSlideId(activityNumber, "a"),
        activityLabel: formatActivityLabel(activityNumber, "a"),
        focusText,
        includeFocus: shouldIncludeFocus(),
      })
    );
  }

  if (slides.length) {
    return slides;
  }

  return [
    createTypingSlide(
      { content: [] },
      {
        slideId: buildTypingSlideId(activityNumber, "a"),
        activityLabel: formatActivityLabel(activityNumber, "a"),
        focusText,
        includeFocus: Boolean(focusText),
      }
    ),
  ];
};
