(function () {
  "use strict";

  const SCHOOL_FLOW =
    "/_api/cloudflow/v1.0/trigger/76ce8fba-e4ce-f111-a05a-000d3adca0fb";

  const QUESTIONS_FLOW =
    "/_api/cloudflow/v1.0/trigger/d653c85a-49d0-f111-a05a-000d3ab2ac23";

  const SAVE_FLOW =
    "/_api/cloudflow/v1.0/trigger/5a3bb2c7-66d0-f111-a05a-000d3ab2ac23";

  function init() {
    const root = document.getElementById("nafis-pre");
    if (!root || root.dataset.nafisBinding === "quiz-v4-save") return;

    const ids = [
      "np-code", "np-load", "np-message",
      "np-students-section", "np-school-name",
      "np-student", "np-start"
    ];

    if (ids.some(function (id) {
      return !root.querySelector("#" + id);
    })) {
      console.error("Nafis: بعض عناصر الصفحة المطلوبة غير موجودة.");
      return;
    }

    root.dataset.nafisBinding = "quiz-v4-save";

    // إزالة المعالجات القديمة من عناصر التحكم.
    function renew(id) {
      const old = root.querySelector("#" + id);
      const fresh = old.cloneNode(true);
      fresh.removeAttribute("onclick");
      fresh.removeAttribute("onchange");
      fresh.removeAttribute("onkeydown");
      old.replaceWith(fresh);
      return fresh;
    }

    const codeInput = renew("np-code");
    const loadButton = renew("np-load");
    const studentSelect = renew("np-student");
    const startButton = renew("np-start");

    const message = root.querySelector("#np-message");
    const section = root.querySelector("#np-students-section");
    const schoolName = root.querySelector("#np-school-name");
    const selection = root.querySelector("#np-selection");

    loadButton.type = "button";
    startButton.type = "button";

    message.setAttribute("role", "status");
    message.setAttribute("aria-live", "polite");

    let busy = false;
    let verifiedCode = "";
    let questions = [];
    let answers = [];
    let current = 0;
    let activeStudentKey = "";
    let sessionId = "";
    let submission = null;
    let saved = false;

    function newSessionId() {
      if (window.crypto &&
          typeof window.crypto.randomUUID === "function") {
        return window.crypto.randomUUID();
      }

      if (!window.crypto || !window.crypto.getRandomValues) {
        throw new Error("SECURE_RANDOM_UNAVAILABLE");
      }

      const bytes = new Uint8Array(16);
      window.crypto.getRandomValues(bytes);

      return Array.from(bytes, function (b) {
        return b.toString(16).padStart(2, "0");
      }).join("");
    }

    const quiz = document.createElement("section");
    quiz.id = "np-quiz";
    quiz.dir = "rtl";
    quiz.hidden = true;

    const previousQuiz = root.querySelector("#np-quiz");
    if (previousQuiz) previousQuiz.remove();

    root.appendChild(quiz);

    const style = document.createElement("style");
    style.textContent = `
      #nafis-pre #np-quiz {
        max-width:850px;margin:28px auto;padding:24px;
        background:#fff;border:1px solid #b58a38;
        border-radius:18px;color:#142b49;text-align:right;
      }

      #nafis-pre #np-quiz[hidden] {
        display:none!important;
      }

      #nafis-pre .npq-meta {
        color:#596579;margin-bottom:12px;
      }

      #nafis-pre .npq-question {
        font-size:21px;line-height:1.9;margin:20px 0;
        white-space:pre-wrap;
      }

      #nafis-pre .npq-option {
        display:flex;gap:12px;align-items:flex-start;
        padding:15px;margin:10px 0;border:1px solid #d5dae2;
        border-radius:12px;cursor:pointer;line-height:1.8;
      }

      #nafis-pre .npq-option:has(input:checked) {
        border-color:#b58a38;background:#faf5e9;
      }

      #nafis-pre .npq-option input {
        margin-top:7px;flex:0 0 auto;accent-color:#142b49;
      }

      #nafis-pre .npq-nav {
        display:flex;gap:12px;flex-wrap:wrap;margin-top:22px;
      }

      #nafis-pre .npq-button {
        background:#142b49;color:#fff;border:0;border-radius:10px;
        padding:12px 22px;font:inherit;cursor:pointer;
      }

      #nafis-pre button:disabled {
        opacity:.55;cursor:not-allowed;
      }

      #nafis-pre .npq-progress {
        width:100%;accent-color:#b58a38;
      }
    `;
    root.appendChild(style);

    function show(element, visible) {
      element.hidden = !visible;
      element.classList.remove("d-none");
      element.style.setProperty(
        "display", visible ? "block" : "none", "important"
      );
    }

    function notify(text, error) {
      message.textContent = text;

      const localStatus = quiz.querySelector("#npq-status");

      if (localStatus) {
        localStatus.textContent = text;
        localStatus.style.color = error ? "#b42318" : "#142b49";
      }

      show(message, true);
      message.style.color = error ? "#b42318" : "#142b49";
    }

    function updateControls() {
      const hasStudents = studentSelect.options.length > 1;
      const inQuiz = questions.length > 0;

      codeInput.disabled = busy || inQuiz;
      loadButton.disabled = busy || inQuiz;
      studentSelect.disabled = busy || inQuiz || !hasStudents;

      startButton.disabled =
        busy || inQuiz || !verifiedCode || !studentSelect.value;

      startButton.textContent = "بدء القياس القبلي";

      loadButton.textContent = busy
        ? "جارٍ الاتصال…"
        : "عرض طالبات المدرسة";

      root.setAttribute("aria-busy", String(busy));
    }

    // قراءة الرد المباشر أو الرد الموجود داخل response أو body.
    function unwrap(response, field) {
      let result = response;

      for (let depth = 0; depth < 10; depth++) {
        if (typeof result === "string") {
          result = JSON.parse(result);
          continue;
        }

        if (!result || typeof result !== "object") break;

        if (Object.prototype.hasOwnProperty.call(result, field)) {
          return result;
        }

        if (result.response !== undefined) {
          result = result.response;
        } else if (result.body !== undefined) {
          result = result.body;
        } else {
          break;
        }
      }

      throw new Error("UNEXPECTED_RESPONSE");
    }

    function parseArray(value) {
      const parsed = typeof value === "string"
        ? JSON.parse(value)
        : value;

      if (!Array.isArray(parsed)) {
        throw new Error("INVALID_ARRAY");
      }

      return parsed;
    }

    function callFlow(url, inputs, timeoutMs) {
      const limit = timeoutMs || 60000;

      return new Promise(function (resolve, reject) {
        if (!window.shell ||
            typeof window.shell.ajaxSafePost !== "function") {
          reject(new Error("CONNECTION_NOT_READY"));
          return;
        }

        let finished = false;

        const timer = window.setTimeout(function () {
          finish(new Error("REQUEST_TIMEOUT"));
        }, limit + 5000);

        function finish(error, value) {
          if (finished) return;

          finished = true;
          window.clearTimeout(timer);

          if (error) reject(error);
          else resolve(value);
        }

        try {
          window.shell.ajaxSafePost({
            type: "POST",
            url: url,
            timeout: limit,
            data: {
              eventData: JSON.stringify(inputs)
            }
          })
            .done(function (response) {
              finish(null, response);
            })
            .fail(function (xhr, textStatus) {
              const error = new Error(
                textStatus === "timeout"
                  ? "REQUEST_TIMEOUT"
                  : "FLOW_REQUEST_FAILED"
              );

              error.status = xhr && xhr.status;
              finish(error);
            });
        } catch (error) {
          finish(error);
        }
      });
    }

    function reportError(error, fallback) {
      console.error(
        "Nafis:", error.message, error.status || ""
      );

      if (error.status === 401 || error.status === 403) {
        notify(
          "رُفض الطلب. راجعي أدوار تشغيل هذا التدفق في Power Pages.",
          true
        );
      } else if (error.message === "REQUEST_TIMEOUT") {
        notify("تأخر رد الخدمة. حاولي مرة أخرى.", true);
      } else if (error.message === "CONNECTION_NOT_READY") {
        notify("تعذر تهيئة الاتصال. أعيدي تحميل الصفحة.", true);
      } else {
        notify(fallback, true);
      }
    }

    function resetStudents() {
      verifiedCode = "";
      schoolName.textContent = "";

      studentSelect.replaceChildren(
        new Option("اختاري اسمكِ من القائمة", "")
      );

      if (selection) selection.textContent = "";

      show(section, false);
      updateControls();
    }

    async function lookup(event) {
      if (event) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }

      if (busy || questions.length) return;

      const code = codeInput.value.trim();
      resetStudents();

      if (!/^[A-Za-z0-9_-]{1,60}$/.test(code)) {
        notify(
          "أدخلي رمز المدرسة الصحيح بالحروف الإنجليزية والأرقام.",
          true
        );
        codeInput.focus();
        return;
      }

      busy = true;
      updateControls();
      notify("جارٍ التحقق من المدرسة…");

      try {
        const response = await callFlow(SCHOOL_FLOW, {
          SchoolCode: code
        });

        const result = unwrap(response, "success");

        const valid =
          result.success === true ||
          String(result.success).trim().toLowerCase() === "true";

        if (!valid) {
          notify("رمز المدرسة غير صحيح أو غير مفعل.", true);
          return;
        }

        const students = parseArray(result.studentsjson);
        const fragment = document.createDocumentFragment();
        const keys = new Set();

        students.forEach(function (student) {
          if (!student ||
              typeof student.StudentKey !== "string" ||
              typeof student.StudentName !== "string") {
            return;
          }

          const key = student.StudentKey.trim();
          const name = student.StudentName.trim();

          if (!key || !name || keys.has(key)) return;

          keys.add(key);
          fragment.appendChild(new Option(name, key));
        });

        if (!keys.size) {
          notify(
            "تم التحقق، لكن لا توجد طالبات مسجلات للمدرسة.",
            true
          );
          return;
        }

        studentSelect.appendChild(fragment);
        verifiedCode = code;

        schoolName.textContent =
          typeof result.schoolname === "string"
            ? result.schoolname
            : "المدرسة";

        studentSelect.style.setProperty(
          "pointer-events", "auto", "important"
        );
        studentSelect.style.setProperty(
          "opacity", "1", "important"
        );

        show(section, true);

        notify(
          "تم جلب الطالبات. اختاري اسمكِ ثم اضغطي بدء القياس القبلي."
        );
      } catch (error) {
        reportError(
          error,
          "تعذر جلب قائمة الطالبات. حاولي مرة أخرى."
        );
      } finally {
        busy = false;
        updateControls();
      }
    }

    function element(tag, text, className) {
      const node = document.createElement(tag);

      if (text !== undefined) node.textContent = text;
      if (className) node.className = className;

      return node;
    }

    function button(text, handler, disabled) {
      const node = element("button", text, "npq-button");

      node.type = "button";
      node.disabled = Boolean(disabled) || busy;
      node.addEventListener("click", handler);

      return node;
    }

    function renderQuestion() {
      const question = questions[current];
      quiz.replaceChildren();

      const answered = answers.filter(Boolean).length;

      quiz.appendChild(element(
        "div",
        "السؤال " + (current + 1) + " من " + questions.length +
        " — تمت الإجابة عن " + answered,
        "npq-meta"
      ));

      const progress = document.createElement("progress");
      progress.className = "npq-progress";
      progress.max = questions.length;
      progress.value = answered;
      progress.setAttribute("aria-label", "عدد الأسئلة المجاب عنها");
      quiz.appendChild(progress);

      const heading = element(
        "h2", question.Question, "npq-question"
      );
      heading.tabIndex = -1;
      quiz.appendChild(heading);

      const choices = document.createElement("div");
      choices.setAttribute("role", "radiogroup");
      choices.setAttribute("aria-label", "خيارات الإجابة");

      const letters = { A: "أ", B: "ب", C: "ج", D: "د" };

      ["A", "B", "C", "D"].forEach(function (key) {
        const label = element("label", undefined, "npq-option");
        const input = document.createElement("input");

        input.type = "radio";
        input.name = "npq-answer";
        input.value = key;
        input.checked = answers[current] === key;
        input.disabled = busy || saved || Boolean(submission);

        input.addEventListener("change", function () {
          if (busy || saved || submission) return;

          answers[current] = key;
          progress.value = answers.filter(Boolean).length;

          quiz.firstChild.textContent =
            "السؤال " + (current + 1) + " من " + questions.length +
            " — تمت الإجابة عن " + progress.value;
        });

        label.appendChild(input);

        label.appendChild(element(
          "span",
          letters[key] + ". " + question["Option" + key]
        ));

        choices.appendChild(label);
      });

      quiz.appendChild(choices);

      const nav = element("div", undefined, "npq-nav");

      nav.appendChild(button("السابق", function () {
        current--;
        renderQuestion();
      }, current === 0));

      if (current < questions.length - 1) {
        nav.appendChild(button("التالي", function () {
          current++;
          renderQuestion();
        }));
      } else {
        nav.appendChild(button(
          busy
            ? "جارٍ حفظ الإجابات…"
            : (
              submission
                ? "إعادة محاولة الحفظ"
                : "إنهاء الاختبار وحفظ الإجابات"
            ),
          review
        ));
      }

      quiz.appendChild(nav);

      const localStatus = element("p", message.textContent);
      localStatus.id = "npq-status";
      localStatus.setAttribute("role", "status");
      localStatus.setAttribute("aria-live", "polite");
      quiz.appendChild(localStatus);

      heading.focus();
    }

    async function review() {
      if (busy || saved) return;

      const firstMissing = answers.findIndex(function (answer) {
        return !/^[ABCD]$/.test(answer || "");
      });

      if (firstMissing !== -1) {
        current = firstMissing;
        renderQuestion();

        notify(
          "بقيت أسئلة دون إجابة. انتقلنا إلى أول سؤال غير مكتمل.",
          true
        );
        return;
      }

      if (questions.length !== 30 ||
          !sessionId ||
          !activeStudentKey) {
        notify(
          "تعذر تجهيز بيانات القياس. أعيدي تحميل الصفحة وابدئي مجددًا.",
          true
        );
        return;
      }

      // تثبيت الإجابات عند أول إرسال لاستكمال الحفظ بنفس البيانات.
      if (!submission) {
        submission = Object.freeze({
          SchoolCode: verifiedCode,
          StudentKey: activeStudentKey,
          AnswersJson: JSON.stringify(
            questions.map(function (question, index) {
              return {
                ID: Number(question.ID),
                Selected: answers[index]
              };
            })
          ),
          SessionId: sessionId
        });
      }

      busy = true;
      updateControls();
      renderQuestion();

      notify(
        "جارٍ حفظ الإجابات… أبقي الصفحة مفتوحة حتى ظهور تأكيد الحفظ."
      );

      try {
        const response = await callFlow(
          SAVE_FLOW,
          submission,
          110000
        );

        const result = unwrap(response, "success");

        const successful =
          result.success === true ||
          String(result.success).trim().toLowerCase() === "true";

        if (!successful) {
          notify(
            typeof result.message === "string" &&
            result.message.trim()
              ? result.message
              : "لم يتأكد اكتمال الحفظ. أعيدي محاولة الحفظ بالإجابات نفسها.",
            true
          );
          return;
        }

        const score = typeof result.score === "number"
          ? result.score
          : (
            typeof result.score === "string" &&
            result.score.trim()
              ? Number(result.score)
              : NaN
          );

        const total = typeof result.total === "number"
          ? result.total
          : (
            typeof result.total === "string" &&
            result.total.trim()
              ? Number(result.total)
              : NaN
          );

        if (!Number.isInteger(score) ||
            total !== 30 ||
            score < 0 ||
            score > total) {
          throw new Error("INVALID_SAVE_RESULT");
        }

        saved = true;
        quiz.replaceChildren();

        const title = element(
          "h2",
          "تم حفظ القياس القبلي بنجاح",
          "npq-question"
        );
        title.tabIndex = -1;

        quiz.appendChild(title);

        quiz.appendChild(element(
          "p",
          "درجتكِ: " + score + " من " + total
        ));

        quiz.appendChild(element(
          "p",
          "النسبة: " +
          (score / total * 100).toLocaleString("ar-SA", {
            maximumFractionDigits: 1
          }) +
          "٪"
        ));

        quiz.appendChild(element(
          "p",
          "شكرًا لمشاركتكِ في مختبر نافس 360."
        ));

        notify("تم تأكيد حفظ الإجابات الثلاثين بنجاح.");

        title.focus();

        quiz.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
      } catch (error) {
        reportError(
          error,
          "لم يصل تأكيد الحفظ. اضغطي إعادة محاولة الحفظ لاستكمال الإجابات نفسها."
        );
      } finally {
        busy = false;
        updateControls();

        if (!saved) renderQuestion();
      }
    }

    async function start(event) {
      event.preventDefault();
      event.stopImmediatePropagation();

      if (busy || questions.length) return;

      if (!verifiedCode ||
          verifiedCode !== codeInput.value.trim()) {
        notify("تحققي من رمز المدرسة أولًا.", true);
        return;
      }

      if (!studentSelect.value) {
        notify("اختاري اسمكِ أولًا.", true);
        return;
      }

      busy = true;
      updateControls();
      notify("جارٍ تحميل أسئلة القياس القبلي…");

      try {
        const response = await callFlow(QUESTIONS_FLOW, {
          SchoolCode: verifiedCode,
          StudentKey: studentSelect.value
        });

        const result = unwrap(response, "questionsjson");
        const items = parseArray(result.questionsjson);

        const required = [
          "Question", "OptionA", "OptionB", "OptionC", "OptionD"
        ];

        const valid =
          items.length === 30 &&
          items.every(function (item) {
            return item &&
              Number.isSafeInteger(Number(item.ID)) &&
              Number(item.ID) > 0 &&
              required.every(function (key) {
                return typeof item[key] === "string" &&
                  item[key].trim().length > 0;
              });
          });

        const unique = new Set(items.map(function (item) {
          return item && Number(item.ID);
        }));

        if (!valid || unique.size !== 30) {
          throw new Error("INVALID_QUESTIONS");
        }

        sessionId = newSessionId();
        activeStudentKey = studentSelect.value;
        submission = null;
        saved = false;

        questions = items;
        answers = Array(questions.length).fill(null);
        current = 0;

        show(quiz, true);
        renderQuestion();

        notify(
          "تم تحميل 30 سؤالًا. اختاري الإجابة ثم انتقلي للسؤال التالي."
        );

        quiz.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
      } catch (error) {
        reportError(
          error,
          "تعذر تحميل الأسئلة أو بياناتها غير مكتملة. راجعي تشغيل تدفق الأسئلة."
        );
      } finally {
        busy = false;
        updateControls();

        if (questions.length) renderQuestion();
      }
    }

    loadButton.addEventListener("click", lookup, true);
    startButton.addEventListener("click", start, true);

    codeInput.addEventListener("keydown", function (event) {
      if (event.key === "Enter") lookup(event);
    }, true);

    codeInput.addEventListener("input", function () {
      if (!busy && !questions.length) resetStudents();
    });

    studentSelect.addEventListener("change", function () {
      updateControls();

      if (selection) {
        selection.textContent = studentSelect.value
          ? "تم اختيار: " +
            studentSelect.selectedOptions[0].textContent
          : "";
      }
    });

    resetStudents();
    notify("أدخلي رمز المدرسة لعرض قائمة الطالبات.");
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      init,
      { once: true }
    );
  } else {
    init();
  }
})();

(function () {
  "use strict";

  const style = document.createElement("style");

  style.textContent = `
    #nafis-pre #np-quiz {
      width: calc(100% - 24px) !important;
      max-width: 780px !important;
      box-sizing: border-box !important;
      margin: 20px auto !important;
      padding: 22px !important;
      direction: rtl !important;
    }

    #nafis-pre #np-quiz .npq-question {
      font-size: 22px !important;
      line-height: 1.8 !important;
      margin: 16px 0 !important;
    }

    #nafis-pre #np-quiz .npq-option {
      display: flex !important;
      flex-direction: row !important;
      align-items: center !important;
      justify-content: flex-start !important;
      gap: 12px !important;
      width: 100% !important;
      height: auto !important;
      min-height: 58px !important;
      max-height: none !important;
      box-sizing: border-box !important;
      padding: 12px 16px !important;
      margin: 10px 0 !important;
      direction: rtl !important;
      text-align: right !important;
      float: none !important;
      position: static !important;
    }

    #nafis-pre #np-quiz .npq-option input[type="radio"] {
      appearance: auto !important;
      -webkit-appearance: radio !important;
      display: inline-block !important;
      position: static !important;
      float: none !important;
      flex: 0 0 22px !important;
      width: 22px !important;
      min-width: 22px !important;
      max-width: 22px !important;
      height: 22px !important;
      min-height: 22px !important;
      max-height: 22px !important;
      margin: 0 !important;
      padding: 0 !important;
      transform: none !important;
      box-shadow: none !important;
      accent-color: #142b49 !important;
    }

    #nafis-pre #np-quiz .npq-option span {
      display: block !important;
      position: static !important;
      flex: 1 1 0% !important;
      width: auto !important;
      min-width: 0 !important;
      max-width: none !important;
      margin: 0 !important;
      padding: 0 !important;
      font-size: 20px !important;
      font-weight: 500 !important;
      line-height: 1.7 !important;
      white-space: normal !important;
      overflow-wrap: anywhere !important;
      text-align: right !important;
      color: #142b49 !important;
    }

    #nafis-pre #np-quiz .npq-button {
      width: auto !important;
      min-height: 44px !important;
      font-size: 18px !important;
      padding: 10px 24px !important;
    }

    @media (max-width: 600px) {
      #nafis-pre #np-quiz {
        padding: 14px !important;
      }

      #nafis-pre #np-quiz .npq-question {
        font-size: 20px !important;
      }

      #nafis-pre #np-quiz .npq-option span {
        font-size: 18px !important;
      }
    }
  `;

  document.head.appendChild(style);
})();
