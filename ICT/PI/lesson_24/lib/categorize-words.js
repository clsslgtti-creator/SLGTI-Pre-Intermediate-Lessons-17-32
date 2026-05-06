const trimString = (value) =>
  typeof value === "string" ? value.trim() : "";

const normalizeAnswer = (value) => trimString(value).toLowerCase();

const normalizeId = (raw, index, prefix) => {
  const normalized = trimString(raw);
  return normalized || `${prefix}_${index + 1}`;
};

const shuffleArray = (items = []) => {
  const list = items.slice();
  for (let index = list.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [list[index], list[swapIndex]] = [list[swapIndex], list[index]];
  }
  return list;
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
  if (!element) {
    return;
  }
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

const normalizeCategories = (raw = {}) => {
  const values = Array.isArray(raw?.category)
    ? raw.category
    : Array.isArray(raw?.categories)
    ? raw.categories
    : [];
  return Array.from(
    new Set(values.map((value) => trimString(value)).filter(Boolean))
  );
};

const normalizeItems = (raw = {}) => {
  const source = Array.isArray(raw?.content)
    ? raw.content
    : Array.isArray(raw?.items)
    ? raw.items
    : Array.isArray(raw)
    ? raw
    : [];

  return source
    .map((entry, index) => {
      const word =
        trimString(entry?.item_a) ||
        trimString(entry?.itemA) ||
        trimString(entry?.word) ||
        trimString(entry?.text);
      const category =
        trimString(entry?.item_b) ||
        trimString(entry?.itemB) ||
        trimString(entry?.category) ||
        trimString(entry?.answer);
      if (!word || !category) {
        return null;
      }
      return {
        id: normalizeId(entry?.id, index, "category_word"),
        word,
        category,
        categoryNormalized: normalizeAnswer(category),
      };
    })
    .filter(Boolean);
};

export const buildCategorizeWordsSlides = (
  activityData = {},
  context = {},
  assessment = {}
) => {
  const rawContent = activityData?.content ?? {};
  const categories = normalizeCategories(rawContent);
  const items = normalizeItems(rawContent);
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
  let interactionsReady = false;

  const slide = document.createElement("section");
  slide.className =
    "slide slide--assessment slide--categorize-words listening-slide--matching listening-slide--category-sort";

  const heading = document.createElement("h2");
  heading.textContent = createHeading(context);
  slide.appendChild(heading);

  const marksSummary = createMarksSummaryText(items.length, marksPerQuestion);
  if (marksSummary) {
    const marksEl = document.createElement("p");
    marksEl.className = "assessment-marks-summary";
    marksEl.textContent = `(${marksSummary})`;
    slide.appendChild(marksEl);
  }

  const layout = document.createElement("div");
  layout.className = "listening-word-match listening-word-match--categories";
  slide.appendChild(layout);

  const wordsColumn = document.createElement("div");
  wordsColumn.className = "word-match-bank";
  layout.appendChild(wordsColumn);

  const categoriesColumn = document.createElement("div");
  categoriesColumn.className = "word-match-categories";
  layout.appendChild(categoriesColumn);

  const feedbackEl = document.createElement("p");
  feedbackEl.className =
    "listening-feedback listening-feedback--neutral word-match-feedback";
  layout.appendChild(feedbackEl);

  const actions = document.createElement("div");
  actions.className = "assessment-actions";
  slide.appendChild(actions);

  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "secondary-btn";
  resetBtn.textContent = "Reset";
  actions.appendChild(resetBtn);

  const submitBtn = document.createElement("button");
  submitBtn.type = "button";
  submitBtn.className = "primary-btn";
  submitBtn.textContent = submissionLocked ? "Submitted" : "Submit";
  actions.appendChild(submitBtn);

  const resultEl = document.createElement("p");
  resultEl.className = "assessment-result";
  resultEl.setAttribute("role", "status");
  actions.appendChild(resultEl);

  registerActivity({
    total: items.length,
    marksPerQuestion,
  });

  const placements = new Map();
  const dropzones = [];
  const cardsById = new Map();

  const updateFeedback = (text, variant = "neutral") => {
    feedbackEl.textContent = text;
    feedbackEl.classList.remove(
      "listening-feedback--positive",
      "listening-feedback--negative",
      "listening-feedback--neutral"
    );
    feedbackEl.classList.add(`listening-feedback--${variant}`);
  };

  const resetCardPosition = (cardEl) => {
    if (!cardEl) {
      return;
    }
    cardEl.style.top = "";
    cardEl.style.left = "";
    cardEl.style.position = "relative";
    const $ = window.jQuery;
    if ($ && $(cardEl).data("uiDraggable")) {
      $(cardEl).draggable("option", "revert", "invalid");
    }
  };

  const updateZoneFillState = (zone) => {
    const hasCards = Boolean(zone?.querySelector(".word-match-card"));
    const placeholder = zone?.querySelector(".word-match-placeholder");
    placeholder?.classList.toggle("is-hidden", hasCards);
    zone?.classList.toggle("is-filled", hasCards);
  };

  const clearEvaluationState = () => {
    updateFeedback("", "neutral");
    resultEl.textContent = "";
    resultEl.classList.remove(
      "assessment-result--error",
      "assessment-result--success"
    );
    dropzones.forEach((zone) =>
      zone.classList.remove("is-correct", "is-incorrect")
    );
    cardsById.forEach((card) =>
      card.classList.remove("is-correct", "is-incorrect")
    );
  };

  const setInteractionsEnabled = (enabled) => {
    if (!interactionsReady) {
      return;
    }
    const $ = window.jQuery;
    if (!$ || !$.fn?.draggable || !$.fn?.droppable) {
      return;
    }
    const method = enabled ? "enable" : "disable";
    $(Array.from(cardsById.values())).draggable(method);
    $(dropzones).droppable(method);
    $(wordsColumn).droppable(method);
  };

  const refreshInteractivity = () => {
    const locked =
      instructionsLocked ||
      submissionLocked ||
      !items.length ||
      !categories.length;
    resetBtn.disabled = locked;
    submitBtn.disabled = locked;
    setInteractionsEnabled(!locked);
  };

  const detachFromZone = (cardEl) => {
    if (!cardEl) {
      return;
    }
    const itemId = cardEl.dataset.itemId;
    const assigned = cardEl.dataset.assignedZone;
    if (itemId) {
      placements.delete(itemId);
    }
    if (assigned) {
      const zone = dropzones.find((zoneEl) => zoneEl.dataset.zoneId === assigned);
      zone?.classList.remove("is-correct", "is-incorrect");
      updateZoneFillState(zone);
    }
    cardEl.dataset.assignedZone = "";
  };

  const moveCardToZone = (cardEl, zoneEl) => {
    if (!cardEl || !zoneEl || submissionLocked) {
      return;
    }
    detachFromZone(cardEl);
    const zoneId = zoneEl.dataset.zoneId;
    zoneEl.appendChild(cardEl);
    resetCardPosition(cardEl);
    cardEl.dataset.assignedZone = zoneId;
    placements.set(cardEl.dataset.itemId, zoneId);
    updateZoneFillState(zoneEl);
    cardEl.classList.remove("is-correct", "is-incorrect");
    zoneEl.classList.remove("is-correct", "is-incorrect");
  };

  const moveCardToBank = (cardEl) => {
    if (!cardEl || submissionLocked) {
      return;
    }
    detachFromZone(cardEl);
    resetCardPosition(cardEl);
    wordsColumn.appendChild(cardEl);
    cardEl.classList.remove("is-correct", "is-incorrect");
  };

  const resetActivity = () => {
    if (submissionLocked) {
      return;
    }
    placements.clear();
    clearEvaluationState();
    dropzones.forEach((zone) => {
      Array.from(zone.querySelectorAll(".word-match-card")).forEach((card) => {
        zone.removeChild(card);
      });
      updateZoneFillState(zone);
    });
    shuffleArray(Array.from(cardsById.values())).forEach((card) => {
      card.dataset.assignedZone = "";
      resetCardPosition(card);
      wordsColumn.appendChild(card);
    });
    refreshInteractivity();
  };

  const markAnswers = () => {
    let correctCount = 0;
    dropzones.forEach((zone) =>
      zone.classList.remove("is-correct", "is-incorrect")
    );
    cardsById.forEach((card) => {
      const zone = dropzones.find(
        (zoneEl) => zoneEl.dataset.zoneId === card.dataset.assignedZone
      );
      const isCorrect =
        Boolean(zone) &&
        normalizeAnswer(zone.dataset.category) ===
          normalizeAnswer(card.dataset.expectedCategory);
      card.classList.toggle("is-correct", isCorrect);
      card.classList.toggle("is-incorrect", !isCorrect);
      if (isCorrect) {
        correctCount += 1;
      }
    });
    dropzones.forEach((zone) => {
      const zoneCards = Array.from(zone.querySelectorAll(".word-match-card"));
      if (!zoneCards.length) {
        return;
      }
      const allCorrect = zoneCards.every(
        (card) =>
          normalizeAnswer(card.dataset.expectedCategory) ===
          normalizeAnswer(zone.dataset.category)
      );
      zone.classList.add(allCorrect ? "is-correct" : "is-incorrect");
    });
    return correctCount;
  };

  const evaluate = () => {
    if (submissionLocked || !items.length || !categories.length) {
      return;
    }
    if (placements.size < items.length) {
      resultEl.textContent = "Place every word into a category before submitting.";
      resultEl.classList.add("assessment-result--error");
      return;
    }

    const correctCount = markAnswers();
    submissionLocked = true;
    submitBtn.textContent = "Submitted";
    refreshInteractivity();

    updateFeedback(
      correctCount === items.length
        ? "Great job! Every word is in the correct category."
        : `You sorted ${correctCount} of ${items.length}.`,
      correctCount === items.length ? "positive" : "negative"
    );
    resultMessage(
      resultEl,
      correctCount,
      items.length,
      marksPerQuestion,
      correctCount === items.length ? "success" : "neutral"
    );

    submitResult({
      total: items.length,
      correct: correctCount,
      marksPerQuestion,
      detail: {
        placements: items.reduce((acc, item) => {
          const zoneId = placements.get(item.id);
          const zone = dropzones.find((zoneEl) => zoneEl.dataset.zoneId === zoneId);
          acc[item.id] = zone?.dataset?.category ?? null;
          return acc;
        }, {}),
      },
      timestamp: new Date().toISOString(),
    });
  };

  if (!items.length || !categories.length) {
    const emptyState = document.createElement("p");
    emptyState.className = "empty-state";
    emptyState.textContent = "Categorizing content will be available soon.";
    layout.appendChild(emptyState);
    resetBtn.disabled = true;
    submitBtn.disabled = true;
  }

  categories.forEach((category, index) => {
    const card = document.createElement("article");
    card.className = "word-match-sentence word-match-category";

    const title = document.createElement("h3");
    title.textContent = category;
    card.appendChild(title);

    const zone = document.createElement("div");
    zone.className = "word-match-dropzone word-match-dropzone--category";
    zone.dataset.category = category;
    zone.dataset.zoneId = `category_${index + 1}`;

    const placeholder = document.createElement("span");
    placeholder.className = "word-match-placeholder";
    placeholder.textContent = "Drop words here";
    zone.appendChild(placeholder);

    card.appendChild(zone);
    categoriesColumn.appendChild(card);
    dropzones.push(zone);
  });

  shuffleArray(items).forEach((item) => {
    const card = document.createElement("div");
    card.className = "word-match-card";
    card.dataset.itemId = item.id;
    card.dataset.expectedCategory = item.category;
    card.dataset.assignedZone = "";
    card.textContent = item.word;
    cardsById.set(item.id, card);
    wordsColumn.appendChild(card);
  });

  const applySavedState = () => {
    const savedPlacements = savedDetail?.placements || {};
    Object.entries(savedPlacements).forEach(([itemId, category]) => {
      const card = cardsById.get(itemId);
      const zone = dropzones.find(
        (zoneEl) => normalizeAnswer(zoneEl.dataset.category) === normalizeAnswer(category)
      );
      if (!card || !zone) {
        return;
      }
      zone.appendChild(card);
      resetCardPosition(card);
      card.dataset.assignedZone = zone.dataset.zoneId;
      placements.set(itemId, zone.dataset.zoneId);
      updateZoneFillState(zone);
    });
    const savedTotal = Number.isFinite(savedState?.total)
      ? savedState.total
      : items.length;
    const savedCorrect = Number.isFinite(savedState?.correct)
      ? savedState.correct
      : markAnswers();
    markAnswers();
    resultMessage(
      resultEl,
      savedCorrect,
      savedTotal,
      marksPerQuestion,
      savedTotal && savedCorrect === savedTotal ? "success" : "neutral"
    );
    updateFeedback(
      savedCorrect === savedTotal
        ? "Great job! Every word is in the correct category."
        : `You sorted ${savedCorrect} of ${savedTotal}.`,
      savedCorrect === savedTotal ? "positive" : "negative"
    );
    submitBtn.textContent = "Submitted";
    refreshInteractivity();
  };

  const setupInteractions = () => {
    if (interactionsReady) {
      return;
    }
    const $ = window.jQuery;
    if (!$ || !$.fn?.draggable || !$.fn?.droppable) {
      console.warn("jQuery UI is required for the categorizing activity.");
      return;
    }

    interactionsReady = true;
    const cards = Array.from(cardsById.values());

    $(cards).draggable({
      revert: "invalid",
      containment: slide,
      start() {
        $(this).addClass("is-active");
        if (!submissionLocked) {
          clearEvaluationState();
        }
      },
      stop() {
        $(this).removeClass("is-active");
      },
    });

    $(dropzones).droppable({
      accept: ".word-match-card",
      tolerance: "intersect",
      over() {
        $(this).addClass("is-hover");
      },
      out() {
        $(this).removeClass("is-hover");
      },
      drop(_, ui) {
        $(this).removeClass("is-hover");
        moveCardToZone(ui.draggable.get(0), this);
      },
    });

    $(wordsColumn).droppable({
      accept: ".word-match-card",
      tolerance: "intersect",
      drop(_, ui) {
        moveCardToBank(ui.draggable.get(0));
      },
    });

    refreshInteractivity();
  };

  resetBtn.addEventListener("click", resetActivity);
  submitBtn.addEventListener("click", evaluate);

  slide.addEventListener("instructionstatechange", (event) => {
    instructionsLocked = Boolean(event.detail?.locked);
    refreshInteractivity();
  });

  if (savedState?.submitted) {
    applySavedState();
  } else {
    refreshInteractivity();
  }

  return [
    {
      id: context.key ? `${context.key}-categorize-words` : "categorize-words",
      element: slide,
      onEnter: setupInteractions,
      onLeave: () => {},
    },
  ];
};
