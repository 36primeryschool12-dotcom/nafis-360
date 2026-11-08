(() => {
  "use strict";

  const registry = window.NafisSchoolRegistry;
  const $ = id => document.getElementById(id);
  const form = $("schoolForm");
  const rows = $("rows");
  const message = $("message");
  const errors = {
    "invalid-school": "أدخلي اسم المدرسة وإدارة التعليم بصورة صحيحة.",
    "duplicate-school": "هذه المدرسة موجودة بالفعل في إدارة التعليم نفسها.",
    "missing-school": "تعذر العثور على المدرسة.",
    "code-generation": "تعذر توليد رمز فريد. أعيدي المحاولة."
  };
  let editing = null;
  let busy = false;

  function notify(text, error = false) {
    message.textContent = text;
    message.classList.toggle("error", error);
  }

  function clearForm() {
    editing = null;
    form.reset();
    $("schoolCode").value = "";
    $("formTitle").textContent = "إضافة مدرسة جديدة";
    $("saveBtn").textContent = "إضافة المدرسة وتوليد الرمز";
    notify("");
  }

  function showEmpty(text) {
    const cell = rows.insertRow().insertCell();
    cell.colSpan = 5;
    cell.textContent = text;
  }

  function button(label, handler, style = "secondary") {
    const action = document.createElement("button");
    action.type = "button";
    action.className = style;
    action.textContent = label;
    action.addEventListener("click", handler);
    return action;
  }

  function editSchool(school) {
    editing = school.code;
    $("schoolName").value = school.name;
    $("educationOffice").value = school.office;
    $("schoolCode").value = school.code;
    $("schoolStatus").value = school.status;
    $("formTitle").textContent = "تعديل بيانات المدرسة";
    $("saveBtn").textContent = "حفظ التعديلات";
    notify("");
    $("schoolName").focus();
  }

  async function copyCode(code) {
    try {
      await navigator.clipboard.writeText(code);
      notify(`نُسخ رمز المدرسة: ${code}`);
    } catch {
      notify(`يمكنك نسخ الرمز من الجدول: ${code}`, true);
    }
  }

  function render() {
    rows.replaceChildren();
    let schools;
    try {
      schools = registry.read();
    } catch {
      $("total").textContent = $("active").textContent = $("inactive").textContent = "—";
      showEmpty("تعذر قراءة سجل المدارس من المتصفح.");
      return;
    }

    const query = $("search").value.trim().toLocaleLowerCase("ar");
    const active = schools.filter(school => school.status === "active").length;
    $("total").textContent = schools.length;
    $("active").textContent = active;
    $("inactive").textContent = schools.length - active;

    const matches = schools.filter(school => [school.name, school.office, school.code]
      .join(" ").toLocaleLowerCase("ar").includes(query));
    if (!matches.length) {
      showEmpty(schools.length ? "لا توجد مدارس مطابقة للبحث." : "لم تُضف أي مدرسة بعد.");
      return;
    }

    for (const school of matches) {
      const row = rows.insertRow();
      row.insertCell().textContent = school.name;
      row.insertCell().textContent = school.office;
      const code = document.createElement("code");
      code.dir = "ltr";
      code.textContent = school.code;
      row.insertCell().append(code);
      const status = row.insertCell();
      status.className = `status ${school.status === "active" ? "on" : "off"}`;
      status.textContent = school.status === "active" ? "نشطة" : "غير نشطة";

      row.insertCell().append(
        button("نسخ الرمز", () => copyCode(school.code)),
        button("تعديل", () => editSchool(school)),
        button(school.status === "active" ? "تعطيل" : "تفعيل", async () => {
          try {
            const updated = await registry.toggle(school.code);
            if (editing === school.code) $("schoolStatus").value = updated.status;
            render();
            notify("تم تحديث حالة المدرسة.");
          } catch (error) {
            notify(errors[error.message] || "تعذر حفظ حالة المدرسة في المتصفح.", true);
          }
        }, "warn")
      );
    }
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    $("saveBtn").disabled = true;
    $("resetBtn").disabled = true;
    const currentCode = editing;
    try {
      const school = await registry.save({
        name: $("schoolName").value,
        office: $("educationOffice").value,
        status: $("schoolStatus").value
      }, currentCode);
      clearForm();
      render();
      notify(currentCode ? "تم حفظ التعديلات." : `أُضيفت المدرسة. رمزها: ${school.code}`);
    } catch (error) {
      notify(errors[error.message] || "تعذر حفظ المدرسة في المتصفح. تحققي من إعدادات التخزين.", true);
    } finally {
      busy = false;
      $("saveBtn").disabled = false;
      $("resetBtn").disabled = false;
    }
  });

  $("resetBtn").addEventListener("click", clearForm);
  $("search").addEventListener("input", render);
  window.addEventListener("storage", event => {
    if (event.key === registry.key || event.key === null) render();
  });
  render();
})();
