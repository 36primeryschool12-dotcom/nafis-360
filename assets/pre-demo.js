
(() => {
  "use strict";

  const mode = document.body.dataset.mode;
  const bank = window.NAFIS_DEMO_QUESTIONS;
  const Q = mode === "post" && Array.isArray(bank)
    ? reorderWithinDomains(bank)
    : bank;

  function reorderWithinDomains(questions) {
    const domains = new Map();
    for (const question of questions) {
      if (!domains.has(question.domain)) domains.set(question.domain, []);
      domains.get(question.domain).push(question);
    }
    return Array.from(domains.values()).flatMap((group) => group.reverse());
  }
  const $ = (id) => document.getElementById(id);

  const state = {
    index: 0,
    answers: []
  };

  const letters = ["أ", "ب", "ج", "د"];

  function show(id) {
    ["welcome", "quiz", "result"].forEach((name) => {
      $(name).classList.toggle("hidden", name !== id);
    });
  }

  function updateProgress() {
    const count = state.answers.filter(
      (answer) => answer !== null
    ).length;

    $("meta").textContent =
      `السؤال ${state.index + 1} من ${Q.length} — ` +
      `أُجيب عن ${count}`;

    $("progress").value = count;
  }

  function render() {
    const i = state.index;
    const q = Q[i];

    updateProgress();

    $("question").textContent = q.text;
    $("options").replaceChildren();
    showFeedback(q, state.answers[i]);

    q.options.forEach((option, j) => {
      const label = document.createElement("label");
      label.className = "option";

      const input = document.createElement("input");
      input.type = "radio";
      input.name = "answer";
      input.value = String(j);
      input.checked = state.answers[i] === j;

      input.addEventListener("change", () => {
        state.answers[i] = j;
        updateProgress();
        showFeedback(q, j);
      });

      const text = document.createElement("span");
      text.textContent = `${letters[j]}. ${option}`;

      label.append(input, text);
      $("options").appendChild(label);
    });

    $("previous").disabled = i === 0;

    $("next").textContent =
      i === Q.length - 1
        ? "إنهاء وعرض النتيجة"
        : "التالي";

    $("question").focus();
  }

  function showFeedback(question, answer) {
    const status = $("status");
    status.textContent = "";
    if (mode !== "training" || answer === null) return;

    status.textContent = answer === question.correct
      ? "إجابة صحيحة. أحسنتِ!"
      : `الإجابة الصحيحة: ${question.options[question.correct]}.`;
  }

  function finish() {
    const missing = state.answers.findIndex(
      (answer) => answer === null
    );

    if (missing !== -1) {
      state.index = missing;
      render();

      $("status").textContent =
        "يرجى إكمال جميع الأسئلة. " +
        "انتقلنا إلى أول سؤال دون إجابة.";

      return;
    }

    let score = 0;
    const byDomain = new Map();

    Q.forEach((q, i) => {
      const correct = state.answers[i] === q.correct;

      if (correct) score++;

      const item = byDomain.get(q.domain) || {
        total: 0,
        correct: 0
      };

      item.total++;

      if (correct) item.correct++;

      byDomain.set(q.domain, item);
    });

    $("score").textContent = `${score} من ${Q.length}`;

    $("percent").textContent =
      `النسبة: ${Math.round(100 * score / Q.length)}٪`;

    $("domains").replaceChildren();

    for (const [name, item] of byDomain) {
      const line = document.createElement("div");
      line.className = "domain";

      const strong = document.createElement("strong");
      strong.textContent = name;

      line.append(
        strong,
        document.createTextNode(
          `: ${item.correct} من ${item.total}`
        )
      );

      $("domains").appendChild(line);
    }

    show("result");
  }

  function begin() {
    if (!Array.isArray(Q) || Q.length !== 30) {
      $("welcome").querySelector("p").textContent =
        "تعذر تحميل بيانات الأسئلة التجريبية.";
      return;
    }

    state.index = 0;
    state.answers = Array(Q.length).fill(null);

    show("quiz");
    render();
  }

  $("start").addEventListener("click", begin);
  $("restart").addEventListener("click", begin);

  $("previous").addEventListener("click", () => {
    if (state.index > 0) {
      state.index--;
      render();
    }
  });

  $("next").addEventListener("click", () => {
    if (state.index < Q.length - 1) {
      state.index++;
      render();
    } else {
      finish();
    }
  });
})();
