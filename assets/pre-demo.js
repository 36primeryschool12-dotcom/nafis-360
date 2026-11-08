
(() => {
  "use strict";

  const mode = document.body.dataset.mode || "pre";
  const journey = window.NafisDemoJourney;
  const bank = Array.isArray(window.NAFIS_DEMO_QUESTIONS) ? window.NAFIS_DEMO_QUESTIONS : [];
  const domains = new Map();
  for (const question of bank) {
    if (!domains.has(question.domain)) domains.set(question.domain, []);
    domains.get(question.domain).push(question);
  }
  const batches = [...domains.values()];
  let questions = mode === "post" ? batches.flatMap(group => group.slice().reverse()) : bank;
  let batchIndex = 0;
  const $ = (id) => document.getElementById(id);

  const state = {
    index: 0,
    answers: []
  };

  const letters = ["أ", "ب", "ج", "د"];

  function show(id) {
    ["locked", "welcome", "quiz", "result"].forEach((name) => {
      $(name)?.classList.toggle("hidden", name !== id);
    });
  }

  function updateProgress() {
    const count = state.answers.filter(
      (answer) => answer !== null
    ).length;

    $("meta").textContent =
      `السؤال ${state.index + 1} من ${questions.length} — ` +
      `أُجيب عن ${count}`;

    $("progress").max = questions.length;
    $("progress").value = count;
  }

  function render() {
    const i = state.index;
    const q = questions[i];

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
      i === questions.length - 1
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

    const saved = journey.complete(mode, batchIndex);
    const progressMessage = $("progress-message");
    progressMessage.textContent = saved
      ? (mode === "training" ? "اكتملت الدفعة." : "اكتملت المرحلة.")
      : "تعذر حفظ تقدم الرحلة. فعّلي التخزين في المتصفح وأعيدي المحاولة.";
    const onward = $("onward");
    if (onward) {
      onward.hidden = !saved || !journey.canOpen(mode === "pre" ? "training" : "post");
    }

    let score = 0;
    const byDomain = new Map();

    questions.forEach((q, i) => {
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

    $("score").textContent = `${score} من ${questions.length}`;

    $("percent").textContent =
      `النسبة: ${Math.round(100 * score / questions.length)}٪`;

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
    $("result-heading").focus();
  }

  function showWelcome() {
    if (!journey.canOpen(mode)) {
      show("locked");
      return;
    }

    if (mode === "training") {
      const list = $("batches");
      list.replaceChildren();
      if (batches.length !== journey.batchCount || batches.some(group => group.length !== 10)) {
        $("welcome-note").textContent = "تعذر تحميل دفعات التدريب التجريبي.";
        show("welcome");
        return;
      }
      const completed = journey.progress().batches;
      for (const [index, group] of batches.entries()) {
        const card = document.createElement("li");
        const title = document.createElement("strong");
        title.textContent = `الدفعة ${index + 1} · ${group[0].domain}`;
        const details = document.createElement("span");
        details.textContent = index < completed ? "مكتملة · 10 أسئلة" :
          index === completed ? "متاحة · 10 أسئلة" : "مقفلة حتى إكمال الدفعة السابقة";
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = index < completed ? `إعادة الدفعة ${index + 1}` :
          `بدء الدفعة ${index + 1}`;
        button.disabled = index > completed;
        button.addEventListener("click", () => begin(index));
        card.append(title, details, button);
        list.appendChild(card);
      }
    }
    show("welcome");
  }

  function begin(index = 0) {
    if (!journey.canOpen(mode)) {
      show("locked");
      return;
    }
    if (mode === "training") {
      if (!batches[index] || index > journey.progress().batches) return;
      batchIndex = index;
      questions = batches[index];
    }
    if (!Array.isArray(questions) || questions.length !== (mode === "training" ? 10 : 30)) {
      $("welcome-note").textContent = "تعذر تحميل بيانات الأسئلة التجريبية.";
      return;
    }

    state.index = 0;
    state.answers = Array(questions.length).fill(null);

    show("quiz");
    render();
  }

  $("start")?.addEventListener("click", () => begin());
  $("restart").addEventListener("click", () => {
    if (mode === "training") {
      showWelcome();
      $("welcome-heading").focus();
    } else {
      begin();
    }
  });

  showWelcome();
  window.addEventListener("pageshow", event => {
    if (event.persisted) showWelcome();
  });

  $("previous").addEventListener("click", () => {
    if (state.index > 0) {
      state.index--;
      render();
    }
  });

  $("next").addEventListener("click", () => {
    if (state.index < questions.length - 1) {
      state.index++;
      render();
    } else {
      finish();
    }
  });
})();
