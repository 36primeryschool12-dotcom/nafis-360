/* جلب بيانات المدرسة كاملةً من تدفق الدفعات؛ لا يخزن رموز الدخول محليًا. */
(function () {
  "use strict";
  const OLD_URL="/_api/cloudflow/v1.0/trigger/8f91d0be-f8d0-f111-a05c-7c1e52885529";
  const PAGED_URL="/_api/cloudflow/v1.0/trigger/aff48928-c6d2-f111-a05a-7ced8d458a2d";
  const schema=[
    {name:"students",array:"StudentsJson",more:"HasMoreStudents",next:"NextStudentsAfterId",input:"StudentsAfterId"},
    {name:"attempts",array:"AttemptsJson",more:"HasMoreAttempts",next:"NextAttemptsAfterId",input:"AttemptsAfterId"},
    {name:"training",array:"TrainingJson",more:"HasMoreTraining",next:"NextTrainingAfterId",input:"TrainingAfterId"}
  ];
  function field(object,name){return object[name.toLowerCase()]!==undefined?object[name.toLowerCase()]:object[name];}
  function unwrap(value){
    for(let i=0;i<8;i++){
      if(typeof value==="string"){value=JSON.parse(value);continue;}
      if(!value||typeof value!=="object")break;
      if("success" in value||"Success" in value)return value;
      if(value.response!==undefined){value=value.response;continue;}
      if(value.body!==undefined){value=value.body;continue;}
      break;
    }
    throw new Error("INVALID_RESPONSE");
  }
  function boolean(value){
    const text=String(value).trim().toLowerCase();
    if(value===true||text==="true")return true;
    if(value===false||text==="false")return false;
    throw new Error("INVALID_PAGE_FLAG");
  }
  function integer(value){
    if(value===null||value===undefined||String(value).trim()==="")throw new Error("INVALID_CURSOR");
    const n=Number(value);if(!Number.isSafeInteger(n)||n<0)throw new Error("INVALID_CURSOR");return n;
  }
  function cancelled(){const e=new Error("ABORTED");e.textStatus="abort";return e;}
  function onePage(send,options,signal){
    return new Promise((resolve,reject)=>{
      let settled=false,request,timer;
      function cleanup(){clearTimeout(timer);signal.removeEventListener("abort",abort);}
      function finish(fn,value){if(settled)return;settled=true;cleanup();fn(value);}
      function abort(){finish(reject,cancelled());try{request?.abort?.();}catch(error){}}
      signal.addEventListener("abort",abort,{once:true});
      if(signal.aborted){abort();return;}
      timer=setTimeout(()=>{const e=new Error("PAGE_TIMEOUT");e.textStatus="timeout";finish(reject,e);try{request?.abort?.();}catch(error){}},115000);
      try{
        request=send(options);
        request.done(value=>finish(resolve,value)).fail((xhr,status)=>{
          const e=new Error("PAGE_REQUEST_FAILED");e.xhr=xhr;e.textStatus=status||"error";finish(reject,e);
        });
      }catch(error){finish(reject,error);}
    });
  }
  async function collect(send,values,settings={}){
    const signal=settings.signal||new AbortController().signal;
    const school=String(values.SchoolCode||"").trim(),secret=String(values.TeacherCode||"").trim();
    if(!/^[A-Za-z0-9_-]{1,60}$/.test(school)||!secret)throw new Error("INVALID_CREDENTIALS");
    const rosterOnly=settings.scope==="students";
    const streams=schema.map(s=>({...s,cursor:0,done:rosterOnly&&s.name!=="students",rows:[]}));
    const started=Date.now();let pages=0,first;
    while(streams.some(s=>!s.done)){
      if(signal.aborted)throw cancelled();
      if(++pages>2000||Date.now()-started>1800000)throw new Error("PAGING_LIMIT");
      const data={SchoolCode:school,TeacherCode:secret};
      streams.forEach(s=>{data[s.input]=String(s.cursor);});
      const response=await onePage(send,{type:"POST",url:PAGED_URL,timeout:110000,data:{eventData:JSON.stringify(data)}},signal);
      if(signal.aborted)throw cancelled();
      const result=unwrap(response);
      if(!boolean(field(result,"Success"))){
        // لا تعاد أي نتائج جزئية في حالة رفض الصلاحية أثناء الجلب.
        return {success:false,message:String(field(result,"Message")||"تعذر التحقق من الدخول."),studentsjson:"[]",attemptsjson:"[]",trainingjson:"[]",nafiscomplete:false};
      }
      if(!first)first=result;
      for(const s of streams){
        if(s.done)continue;
        const raw=field(result,s.array),rows=typeof raw==="string"?JSON.parse(raw):raw;
        if(!Array.isArray(rows)||rows.length>1000)throw new Error("INVALID_PAGE_SIZE");
        const more=boolean(field(result,s.more)),next=integer(field(result,s.next));
        let previous=s.cursor;
        for(const row of rows){
          if(!row||typeof row!=="object")throw new Error("INVALID_RECORD");
          const id=integer(row.ID);if(id<=previous)throw new Error("CURSOR_NOT_ADVANCING");previous=id;
          if(row.SchoolId!==undefined&&String(row.SchoolId).trim()!==school)throw new Error("SCHOOL_MISMATCH");
        }
        if(next!==previous||more!==(rows.length===1000))throw new Error("INVALID_PAGE_CURSOR");
        s.rows.push(...rows);s.cursor=next;s.done=!more;
      }
      settings.onProgress?.({pages,students:streams[0].rows.length,attempts:streams[1].rows.length,training:streams[2].rows.length});
    }
    const output={success:true,message:"تم تحميل بيانات المدرسة كاملةً.",schoolname:String(field(first,"SchoolName")||""),teachername:String(field(first,"TeacherName")||""),nafiscomplete:true,nafispages:pages};
    streams.forEach(s=>{output[s.array.toLowerCase()]=JSON.stringify(s.rows);});
    return output;
  }
  function createClient(send){
    function post(options){
      const path=String(options.url||"").split("?")[0];
      const rawOptions={...options};delete rawOptions.nafisScope;delete rawOptions.nafisProgress;
      if(path!==OLD_URL&&path!==PAGED_URL)return send(rawOptions);
      const controller=new AbortController();
      const task=Promise.resolve().then(()=>{
        let values=options.data?.eventData;values=typeof values==="string"?JSON.parse(values):values;
        return collect(send,values||{},{signal:controller.signal,scope:options.nafisScope,onProgress:options.nafisProgress});
      });
      const handle={
        done(fn){task.then(value=>fn(value,"success",handle)).catch(()=>{});return handle;},
        fail(fn){task.catch(error=>fn(error.xhr||{status:0,nafisError:error.message},error.textStatus||"error",error.message)).catch(()=>{});return handle;},
        always(fn){task.then(fn,fn).catch(()=>{});return handle;},
        then(...args){return task.then(...args);},
        catch(fn){return task.catch(fn);},
        abort(){controller.abort();return handle;}
      };
      // استهلاك رفض المهمة حتى لو أغلق المستخدم الصفحة قبل ربط المعالجات.
      task.catch(()=>{});
      return handle;
    }
    return {post};
  }
  if(typeof module==="object"&&module.exports){module.exports={collect,createClient,unwrap,boolean,integer,OLD_URL,PAGED_URL};return;}
  if(typeof window!=="undefined")window.NafisTeacherPaging=createClient(options=>window.shell.ajaxSafePost(options));
})();


(function () {
  "use strict";

  const FLOW_URL =
    "/_api/cloudflow/v1.0/trigger/aff48928-c6d2-f111-a05a-7ced8d458a2d";

  const SIZE = 30;

  function text(value) {
    return value == null ? "" : String(value);
  }

  function modeOf(value) {
    const mode = text(value).trim().toLowerCase();
    return mode === "training" ? "train" : mode;
  }

  function percentage(value) {
    return (Math.round(value * 10) / 10).toLocaleString(
      "ar-SA",
      { maximumFractionDigits: 1 }
    );
  }

  function unwrap(value) {
    for (let depth = 0; depth < 8; depth++) {
      if (typeof value === "string") {
        value = JSON.parse(value);
        continue;
      }

      if (!value || typeof value !== "object") break;

      if ("success" in value || "Success" in value) {
        return value;
      }

      if (value.response !== undefined) {
        value = value.response;
        continue;
      }

      if (value.body !== undefined) {
        value = value.body;
        continue;
      }

      break;
    }

    throw new Error("INVALID_RESPONSE");
  }

  function field(object, name) {
    return object[name.toLowerCase()] !== undefined
      ? object[name.toLowerCase()]
      : object[name];
  }

  function readArray(value) {
    const result = typeof value === "string"
      ? JSON.parse(value)
      : value;

    if (!Array.isArray(result)) {
      throw new Error("INVALID_ARRAY");
    }

    return result;
  }

  function correctValue(value) {
    if (
      value === null ||
      value === undefined ||
      text(value).trim() === ""
    ) {
      return null;
    }

    const number = Number(value);

    return number === 0 || number === 1
      ? number
      : null;
  }

  /*
   * استعادة النتائج القديمة المستوردة:
   * تجميع السجلات الموزعة بين الجلسات عندما تحتوي
   * على 30 سؤالًا مختلفًا ضمن دفعة الاستيراد نفسها.
   */
  function restoreLegacySessions(attempts) {
    const groups = new Map();
    const replacements = new Map();

    attempts.forEach(function (answer, index) {
      const title = text(answer.Title).trim();

      const imported = title.match(
        /^NAFIS_ATTEMPTS_([a-f0-9]{64})_\d+$/i
      );

      const student = text(answer.StudentKey).trim();
      const mode = text(answer.Mode).trim().toLowerCase();

      if (
        !imported ||
        !student ||
        !["pre", "post"].includes(mode)
      ) {
        return;
      }

      const key = JSON.stringify([
        imported[1].toLowerCase(),
        student,
        mode,
        text(answer.Stage).trim(),
        text(answer.Grade).trim()
      ]);

      if (!groups.has(key)) {
        groups.set(key, []);
      }

      groups.get(key).push({
        answer: answer,
        index: index
      });
    });

    groups.forEach(function (entries, key) {
      const questions = new Set();
      const sessions = new Map();

      entries.forEach(function (entry) {
        const question = text(
          entry.answer.QuestionId
        ).trim();

        const session = text(
          entry.answer.SessionId
        ).trim();

        if (!question) return;

        questions.add(question);

        if (!sessions.has(session)) {
          sessions.set(session, new Set());
        }

        sessions.get(session).add(question);
      });

      const hasCompleteSession = Array.from(
        sessions.entries()
      ).some(function (entry) {
        return Boolean(entry[0]) && entry[1].size === SIZE;
      });

      if (
        questions.size !== SIZE ||
        hasCompleteSession
      ) {
        return;
      }

      entries.forEach(function (entry) {
        replacements.set(
          entry.index,
          "legacy-restored|" + key
        );
      });
    });

    // نسخة للحساب والعرض فقط، دون تغيير سجلات SharePoint.
    return attempts.map(function (answer, index) {
      if (!replacements.has(index)) {
        return answer;
      }

      return Object.assign({}, answer, {
        SessionId: replacements.get(index),
        LegacyReconstructed: true
      });
    });
  }

  function aggregate(students, attempts) {
    attempts = restoreLegacySessions(attempts);

    const roster = new Map();
    const sessions = new Map();

    let duplicates = 0;
    let invalid = 0;

    students.forEach(function (student) {
      const key = text(student.StudentKey).trim();

      if (
        !key || roster.has(key) ||
        text(student.IsArchived).trim().toLowerCase() === "true"
      ) return;

      roster.set(key, {
        key: key,
        name: text(student.StudentName).trim() || "طالبة",
        registered: true
      });
    });

    attempts.forEach(function (answer) {
      const key = text(answer.StudentKey).trim();
      const mode = modeOf(answer.Mode);
      const question = text(answer.QuestionId).trim();

      if (
        !key ||
        !question ||
        !["pre", "post", "train"].includes(mode)
      ) {
        invalid++;
        return;
      }

      // لا تعاد المؤرشفات أو الأسماء غير المسجلة من سجل المحاولات.
      if (!roster.has(key)) {
        invalid++;
        return;
      }

      const sessionId = text(answer.SessionId).trim();

      const groupKey = JSON.stringify([
        key,
        mode,
        sessionId
      ]);

      if (!sessions.has(groupKey)) {
        sessions.set(groupKey, {
          key: key,
          mode: mode,
          sid: sessionId,
          questions: new Map(),
          last: 0,
          id: 0
        });
      }

      const session = sessions.get(groupKey);
      const id = Number(answer.ID) || 0;
      const time = Date.parse(answer.Timestamp) || 0;

      const previous = session.questions.get(question);

      if (previous) duplicates++;

      const previousId = previous
        ? Number(previous.ID) || 0
        : 0;

      const previousTime = previous
        ? Date.parse(previous.Timestamp) || 0
        : 0;

      if (
        !previous ||
        id > previousId ||
        (id === previousId && time >= previousTime)
      ) {
        session.questions.set(question, answer);
      }

      session.last = Math.max(session.last, time);
      session.id = Math.max(session.id, id);
    });

    let incomplete = 0;

    sessions.forEach(function (session) {
      session.answers = Array.from(
        session.questions.values()
      );

      session.valid = session.answers.every(
        function (answer) {
          return correctValue(answer.Correct) !== null &&
            /^[ABCD]$/.test(text(answer.Selected).trim().toUpperCase());
        }
      );

      session.complete =
        Boolean(session.sid) &&
        session.answers.length === SIZE &&
        session.valid;

      const person = roster.get(session.key);

      // التدريب متابعة إنجاز، ولا يدخل في حساب درجات القياس.
      if (session.mode === "train") return;

      if (!session.complete) {
        incomplete++;
        return;
      }

      session.score = session.answers.reduce(
        function (sum, answer) {
          return sum + correctValue(answer.Correct);
        },
        0
      );

      const previous = person[session.mode];

      if (
        !previous ||
        session.last > previous.last ||
        (
          session.last === previous.last &&
          session.id > previous.id
        )
      ) {
        person[session.mode] = session;
      }
    });

    const people = Array.from(roster.values()).sort(
      function (first, second) {
        return first.name.localeCompare(second.name, "ar");
      }
    );

    return {
      people: people,
      duplicates: duplicates,
      invalid: invalid,
      incomplete: incomplete,
      raw: attempts.length,
      registered: people.filter(function (person) {
        return person.registered;
      }).length
    };
  }

  function skillStats(people, mode) {
    const groups = new Map();

    people.forEach(function (person) {
      const answers = ["pre", "post"].includes(mode) && person[mode]
        ? person[mode].answers
        : [];

      answers.forEach(function (answer) {
        const domain =
          text(answer.Domain).trim() ||
          "مجال غير محدد";

        const standard =
          text(answer.Standard).trim() ||
          "مهارة غير محددة";

        const key = JSON.stringify([
          domain,
          standard
        ]);

        if (!groups.has(key)) {
          groups.set(key, {
            domain: domain,
            standard: standard,
            count: 0,
            correct: 0
          });
        }

        const group = groups.get(key);

        group.count++;
        group.correct += correctValue(answer.Correct);
      });
    });

    return Array.from(groups.values()).sort(
      function (first, second) {
        return (
          first.correct / first.count -
          second.correct / second.count
        ) || first.domain.localeCompare(second.domain, "ar");
      }
    );
  }

  // لا يعتمد الإنجاز على درجة التدريب، ولا على علامة اكتمال السجل الرئيسي.
  function attachTraining(people, records, schoolCode) {
    const yes = value => value === true || text(value).trim().toLowerCase() === 'true';
    const integer = value => value !== null && text(value).trim() !== '' && Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
    for (const person of people) {
      const own = records.filter(r => text(r.SchoolId).trim() === schoolCode && text(r.StudentKey).trim() === person.key);
      const roots = own.filter(r => integer(r.ID) > 0 && integer(r.ParentJourneyId) === 0 && integer(r.BatchNumber) === 0).sort((a,b) => Number(b.ID)-Number(a.ID));
      const root = roots[0];
      const progress = person.progress = {started:!!root, available:!!root, completed:0, total:0, questions:0, complete:false};
      if (!root) continue;
      const totalQuestions = integer(root.QuestionCount);
      if (!totalQuestions) { progress.available = false; continue; }
      progress.total = Math.ceil(totalQuestions / 20);
      const batches = new Map();
      for (const record of own) {
        const n = integer(record.BatchNumber);
        if (integer(record.ParentJourneyId) !== Number(root.ID) || !n || n > progress.total || !(integer(record.ID) > 0)) continue;
        const old = batches.get(n);
        if (!old || Number(record.ID) > Number(old.ID)) batches.set(n, record);
      }
      for (const [n, record] of batches) {
        const expected = Math.min(20, totalQuestions - (n-1)*20);
        if (yes(record.IsCompleted) && integer(record.QuestionCount) === expected) { progress.completed++; progress.questions += expected; }
      }
      progress.complete = progress.completed === progress.total;
    }
    return people;
  }
  function trainingText(person) {
    const p = person.progress;
    if (!p || !p.available && !p.started) return 'لم تبدأ';
    if (!p.available) return 'تحتاج بيانات الرحلة إلى مراجعة';
    return (p.complete ? '✓ مكتمل' : 'قيد التدريب') + ' — ' + p.completed + ' / ' + p.total;
  }

  function csvCell(value) {
    let result = text(value);

    if (/^[\s]*[=+\-@\t\r]/.test(result)) {
      result = "'" + result;
    }

    return '"' + result.replace(/"/g, '""') + '"';
  }

  // نموذج تغيير رمز المعلمة؛ الرموز في الذاكرة فقط ولا تُدرج في التقارير.
  function installTeacherCodeChange(settings) {
    const { root, dashboard, el, getSession, isBusy, begin, end, commit } = settings;
    const refresh = root.querySelector("#nt-refresh");
    const toggle = el("button", "تغيير رمز الدخول", "nt-secondary");
    toggle.id = "nt-change-code";
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-controls", "nt-code-change-panel");
    refresh.after(toggle);

    const panel = el("section", undefined, "nt-card");
    panel.id = "nt-code-change-panel";
    panel.setAttribute("aria-label", "تغيير رمز دخول المعلمة");
    panel.append(el("h3", "تغيير رمز دخول المعلمة"));
    panel.append(el("p", "اختاري رمزًا من 8 أرقام إنجليزية، واستخدميه عند الدخول القادم.", "nt-muted"));
    const fields = {};
    for (const [name, title, max] of [
      ["current", "رمز المعلمة الحالي", 64],
      ["new", "الرمز الجديد — 8 أرقام", 8],
      ["confirm", "تأكيد الرمز الجديد", 8]
    ]) {
      const input = el("input");
      input.id = "nt-code-change-" + name;
      input.type = "password";
      input.dir = "ltr";
      input.maxLength = max;
      input.setAttribute("autocomplete", name === "current" ? "current-password" : "new-password");
      if (name !== "current") input.setAttribute("inputmode", "numeric");
      input.style.setProperty("font-size", "14px", "important");
      const label = el("label", title);
      label.setAttribute("for", input.id);
      panel.append(label, input);
      fields[name] = input;
    }
    const save = el("button", "حفظ الرمز الجديد");
    save.type = "button";
    save.id = "nt-code-change-save";
    const cancel = el("button", "إغلاق", "nt-secondary");
    cancel.type = "button";
    cancel.id = "nt-code-change-cancel";
    const actions = el("div", undefined, "nt-actions");
    actions.append(save, cancel);
    const message = el("p");
    message.id = "nt-code-change-message";
    message.setAttribute("role", "status");
    message.setAttribute("aria-live", "polite");
    message.style.setProperty("font-size", "14px", "important");
    panel.append(actions, message);
    dashboard.prepend(panel);
    let saving = false, token = 0, transport = null, timer = null;

    function visible(show) {
      panel.hidden = !show;
      panel.style.setProperty("display", show ? "block" : "none", "important");
      toggle.setAttribute("aria-expanded", String(show));
    }
    function clear() { Object.values(fields).forEach(input => { input.value = ""; }); }
    function note(text, error) {
      message.textContent = text;
      message.style.setProperty("color", error ? "#b42318" : "#17633b", "important");
    }
    function controls(busy) {
      Object.values(fields).forEach(input => { input.disabled = busy; });
      save.disabled = busy;
      cancel.disabled = busy;
      save.textContent = busy ? "جارٍ حفظ الرمز…" : "حفظ الرمز الجديد";
    }
    function reset() {
      token++;
      clearTimeout(timer);
      if (transport && typeof transport.abort === "function") transport.abort();
      transport = null;
      saving = false;
      clear();
      note("");
      controls(false);
      visible(false);
    }
    function submit(event) {
      if (event) { event.preventDefault(); event.stopPropagation(); }
      if (saving || isBusy()) return;
      const session = getSession();
      if (!session || dashboard.hidden) { reset(); return; }
      const current = fields.current.value.trim();
      const next = fields.new.value.trim();
      const confirm = fields.confirm.value.trim();
      if (!current || current.length > 64) { note("أدخلي رمز المعلمة الحالي.", true); fields.current.focus(); return; }
      if (!/^[0-9]{8}$/.test(next)) { note("يجب أن يتكون الرمز الجديد من 8 أرقام إنجليزية فقط.", true); fields.new.focus(); return; }
      if (next !== confirm) { note("الرمز الجديد وتأكيده غير متطابقين.", true); fields.confirm.focus(); return; }
      if (next === current) { note("اختاري رمزًا جديدًا يختلف عن الرمز الحالي.", true); fields.new.focus(); return; }
      const generation = ++token;
      saving = true;
      begin();
      controls(true);
      note("جارٍ التحقق وحفظ الرمز الجديد…");
      let finished = false;
      function finish() {
        clearTimeout(timer);
        if (generation !== token) return;
        saving = false;
        transport = null;
        controls(false);
        end();
      }
      function uncertain() {
        if (finished || generation !== token) return;
        finished = true;
        fields.current.value = "";
        fields.new.value = "";
        fields.confirm.value = "";
        note("لم يصل تأكيد الحفظ. تحققي بالدخول باستخدام الرمز الجديد قبل إعادة محاولة تغييره.", true);
        finish();
      }
      timer = setTimeout(uncertain, 115000);
      try {
        transport = window.NafisTeacherPaging.post({
          type: "POST",
          url: "/_api/cloudflow/v1.0/trigger/6f4b01e2-f7d2-f111-a05a-7ced8d458a2d",
          timeout: 110000,
          data: { eventData: JSON.stringify({ SchoolCode: session.SchoolCode, TeacherCode: current, NewTeacherCode: next }) }
        });
        transport.done(function (response) {
          if (finished || generation !== token) return;
          try {
            const result = unwrap(response);
            const success = field(result, "Success");
            const valid = success === true || String(success).trim().toLowerCase() === "true";
            const failed = success === false || String(success).trim().toLowerCase() === "false";
            if (!valid && !failed) { uncertain(); return; }
            if (valid) {
              const active = getSession();
              if (!active || active.SchoolCode !== session.SchoolCode) { finished = true; finish(); return; }
              commit({ SchoolCode: session.SchoolCode, TeacherCode: next });
              clear();
              note("تم تغيير رمز الدخول بنجاح. استخدمي الرمز الجديد عند الدخول القادم.");
            } else {
              fields.current.value = "";
              note(String(field(result, "Message") || "تعذر تغيير الرمز. تحققي من بيانات الدخول."), true);
            }
            finished = true;
            finish();
          } catch (error) { uncertain(); }
        }).fail(uncertain);
      } catch (error) { uncertain(); }
    }
    toggle.addEventListener("click", function (event) {
      event.preventDefault();
      if (saving || isBusy() || !getSession() || dashboard.hidden) return;
      const opening = panel.hidden;
      clear(); note(""); visible(opening);
      if (opening) fields.current.focus();
    });
    cancel.addEventListener("click", function (event) { event.preventDefault(); if (!saving) reset(); });
    save.addEventListener("click", submit);
    Object.values(fields).forEach(input => input.addEventListener("keydown", event => {
      if (event.key === "Enter") submit(event);
    }));
    window.addEventListener("pagehide", reset);
    visible(false);
    return { reset, toggle };
  }

  function init() {
    const root = document.getElementById("nafis-teacher");

    if (!root || root.dataset.bound) return;

    function $(id) {
      return root.querySelector("#" + id);
    }

    const required = [
      "nt-login",
      "nt-code",
      "nt-secret",
      "nt-enter",
      "nt-message",
      "nt-dashboard",
      "nt-school",
      "nt-teacher",
      "nt-updated",
      "nt-refresh",
      "nt-logout",
      "nt-metrics",
      "nt-quality",
      "nt-search",
      "nt-filter",
      "nt-students",
      "nt-empty",
      "nt-mode",
      "nt-skills",
      "nt-csv",
      "nt-report",
      "nt-dialog",
      "nt-dialog-title",
      "nt-detail",
      "nt-close",
      "nt-print",
      "nt-print-button"
    ];

    const missing = required.filter(function (id) {
      return !$(id);
    });

    if (missing.length) {
      const message = $("nt-message");

      if (message) {
        message.hidden = false;
        message.textContent =
          "بعض عناصر الصفحة غير موجودة. " +
          "أعيدي لصق كود HTML كاملًا.";
      }

      console.error(
        "Nafis: missing page elements.",
        missing.join(", ")
      );

      return;
    }

    root.dataset.bound = "teacher-v4-training";

    // تكييف HTML الحالي دون حذف أي من بطاقات إدارة الطالبات.
    const studentTable = $("nt-students").closest("table");
    const tableHead = studentTable && studentTable.querySelector("thead tr");
    if (tableHead && !tableHead.querySelector("[data-training-column]")) {
      const heading = document.createElement("th");
      heading.textContent = "تقدم التدريب";
      heading.scope = "col";
      heading.dataset.trainingColumn = "true";
      tableHead.insertBefore(heading, tableHead.lastElementChild);
    }

    Array.from($("nt-mode").options).forEach(function (option) {
      if (option.value === "train") option.remove();
    });
    if (!["pre", "post"].includes($("nt-mode").value)) {
      $("nt-mode").value = "pre";
    }
    const skillsSection = $("nt-mode").closest("section");
    const skillsNote = skillsSection && skillsSection.querySelector("p");
    if (skillsNote) {
      skillsNote.textContent = "مؤشرات المهارات من القياس القبلي والبعدي فقط. التدريب يُعرض بعدد الدفعات المكتملة دون درجة.";
    }

    [
      ["training-complete", "أكملن التدريب"],
      ["training-pending", "لم يكملن التدريب"]
    ].forEach(function (entry) {
      if (!Array.from($("nt-filter").options).some(function (option) {
        return option.value === entry[0];
      })) {
        $("nt-filter").add(new Option(entry[1], entry[0]));
      }
    });

    const login = $("nt-login");
    const dashboard = $("nt-dashboard");
    const dialog = $("nt-dialog");

    let state = null;
    let credentials = null;
    let busy = false;
    let generation = 0;
    let request = null;

    function show(element) {
      element.hidden = false;
      element.classList.remove("d-none");

      element.style.setProperty(
        "display",
        "block",
        "important"
      );
    }

    function hide(element) {
      element.hidden = true;

      element.style.setProperty(
        "display",
        "none",
        "important"
      );
    }

    function el(tag, content, className) {
      const element = document.createElement(tag);

      if (content !== undefined) {
        element.textContent = content;
      }

      if (className) {
        element.className = className;
      }

      return element;
    }

    const codeChange = installTeacherCodeChange({
      root, dashboard, el,
      getSession: () => credentials && { ...credentials },
      isBusy: () => busy,
      begin: () => setBusy(true),
      end: () => setBusy(false),
      commit: values => {
        credentials = { ...values };
        $("nt-secret").value = "";
      }
    });

    function notify(message, error) {
      const element = $("nt-message");

      element.textContent = message;
      element.hidden = !message;
      element.dataset.error = String(Boolean(error));

      if (message) {
        element.style.setProperty(
          "display",
          "block",
          "important"
        );
      } else {
        element.style.removeProperty("display");
      }
    }

    function setBusy(value) {
      busy = value;
      codeChange.toggle.disabled = value;

      $("nt-enter").disabled = value;
      $("nt-refresh").disabled = value;
      $("nt-code").disabled = value;
      $("nt-secret").disabled = value;
      ["nt-csv", "nt-report"].forEach(function (id) { $(id).disabled = value; });
      $("nt-students").querySelectorAll("button").forEach(function (button) { button.disabled = value; });

      $("nt-enter").textContent = value
        ? "جارٍ التحقق وجلب النتائج…"
        : "دخول لوحة المعلمة";

      root.setAttribute("aria-busy", String(value));
    }

    function selectedPeople() {
      if (!state) return [];

      const query = $("nt-search")
        .value
        .trim()
        .normalize("NFKC");

      const filter = $("nt-filter").value;

      return state.people.filter(function (person) {
        const matchesName =
          !query ||
          person.name.normalize("NFKC").includes(query);

        let matchesFilter = true;

        if (filter === "pre") {
          matchesFilter = Boolean(person.pre);
        } else if (filter === "post") {
          matchesFilter = Boolean(person.post);
        } else if (filter === "matched") {
          matchesFilter = Boolean(person.pre && person.post);
        } else if (filter === "pending") {
          matchesFilter = !person.pre;
        } else if (filter === "training-complete") {
          matchesFilter = person.progress.complete;
        } else if (filter === "training-pending") {
          matchesFilter = !person.progress.complete;
        }

        return matchesName && matchesFilter;
      });
    }

    function score(session) {
      if (!session) return "غير مكتمل";

      const legacy = session.sid.startsWith(
        "legacy-restored|"
      );

      return (
        session.score +
        " إجابة صحيحة من 30 (" +
        percentage(session.score / SIZE * 100) +
        "٪)" +
        (legacy ? " — نتيجة قديمة مجمّعة" : "")
      );
    }

    function gain(person) {
      if (!person.pre || !person.post) return null;

      return (
        (person.post.score - person.pre.score) /
        SIZE *
        100
      );
    }

    function gainText(person) {
      const value = gain(person);

      if (value === null) return "—";

      return (value > 0 ? "+" : "") + percentage(value);
    }

    function studentRow(person, withButton) {
      const row = el("tr");
      const change = gain(person);

      const changeClass = change > 0
        ? "nt-positive"
        : change < 0
          ? "nt-negative"
          : "";

      row.append(
        el("td", person.name),
        el("td", score(person.pre)),
        el("td", score(person.post)),
        el("td", gainText(person), changeClass),
        el(
          "td",
          trainingText(person),
          person.progress && person.progress.complete ? "nt-positive" : ""
        )
      );

      if (withButton) {
        const cell = el("td");

        const button = el(
          "button",
          "عرض التقرير",
          "nt-secondary"
        );

        button.type = "button";

        button.addEventListener("click", function (event) {
          event.preventDefault();
          openReport([person], person.name);
        });

        cell.append(button);
        row.append(cell);
      }

      return row;
    }

    function renderMetrics() {
      const people = state.people;

      const pre = people.filter(function (person) {
        return person.pre;
      });

      const post = people.filter(function (person) {
        return person.post;
      });

      const matched = people.filter(function (person) {
        return person.pre && person.post;
      });

      function average(list, mode) {
        if (!list.length) return "—";

        const sum = list.reduce(function (total, person) {
          return total + person[mode].score;
        }, 0);

        return percentage(
          sum / list.length / SIZE * 100
        ) + "٪";
      }

      const averageGain = matched.length
        ? percentage(
            matched.reduce(function (sum, person) {
              return sum + gain(person);
            }, 0) / matched.length
          ) + " نقطة"
        : "—";

      const improved = matched.filter(function (person) {
        return gain(person) > 0;
      }).length;

      const values = [
        ["الطالبات المسجلات", state.registered],
        ["أكملن القبلي", pre.length],
        ["أكملن البعدي", post.length],
        ["أكملن القياسين", matched.length],
        ["متوسط القبلي", average(pre, "pre")],
        ["متوسط البعدي", average(post, "post")],
        ["متوسط التغير للطالبات المطابقات", averageGain],
        ["تحسنت نتائجهن", improved],
        ["أكملن التدريب", people.filter(function (person) {
          return person.progress.complete;
        }).length],
        ["قيد التدريب", people.filter(function (person) {
          return person.progress.started && !person.progress.complete;
        }).length]
      ];

      const fragment = document.createDocumentFragment();

      values.forEach(function (item) {
        const card = el("div", undefined, "nt-metric");

        card.append(
          el("span", item[0]),
          el("strong", text(item[1]), "nt-value")
        );

        fragment.append(card);
      });

      $("nt-metrics").replaceChildren(fragment);

      $("nt-quality").textContent =
        "ملخص جودة البيانات: " +
        state.raw +
        " سجل إجابة؛ " +
        state.duplicates +
        " تكرارًا استُبعد من الحساب؛ " +
        state.incomplete +
        " جلسة قياس غير مكتملة أو غير صالحة " +
        "لم تدخل في النتائج." +
        (
          state.invalid
            ? " توجد " +
              state.invalid +
              " سجلات غير صالحة مستبعدة."
            : ""
        );
    }

    function renderSkills(people, mode, target) {
      const stats = skillStats(people, mode);
      const fragment = document.createDocumentFragment();

      stats.forEach(function (group) {
        const row = el("tr");
        const firstCell = el("td");

        firstCell.append(
          el("strong", group.domain),
          el("div", group.standard, "nt-muted")
        );

        const value = group.correct / group.count * 100;

        const percentageCell = el(
          "td",
          percentage(value) + "٪"
        );

        const bar = el("span", undefined, "nt-bar");
        const fill = el("i");

        fill.style.width = value + "%";

        bar.append(fill);
        percentageCell.append(bar);

        row.append(
          firstCell,
          el("td", text(group.count)),
          el("td", text(group.correct)),
          percentageCell
        );

        fragment.append(row);
      });

      if (!stats.length) {
        const row = el("tr");

        const cell = el(
          "td",
          "لا توجد إجابات معتمدة لهذا العرض."
        );

        cell.colSpan = 4;
        row.append(cell);
        fragment.append(row);
      }

      target.replaceChildren(fragment);
    }

    function render() {
      const people = selectedPeople();
      const fragment = document.createDocumentFragment();

      people.forEach(function (person) {
        fragment.append(studentRow(person, true));
      });

      $("nt-students").replaceChildren(fragment);
      $("nt-empty").hidden = people.length > 0;

      renderSkills(
        people,
        $("nt-mode").value,
        $("nt-skills")
      );
    }

    function openReport(people, title) {
      if (!state) return;

      const area = $("nt-detail");

      const reportDate = new Intl.DateTimeFormat(
        "ar-SA-u-ca-islamic-umalqura",
        {
          dateStyle: "long",
          timeZone: "Asia/Riyadh"
        }
      ).format(new Date());

      area.replaceChildren(
        el("div", "مختبر نافس 360", "nt-brand"),
        el("h2", state.school),
        el("p", "المعلمة: " + state.teacher),
        el(
          "p",
          title === "جماعي"
            ? "تقرير الطالبات المعروضات — العدد: " +
              people.length
            : "تقرير الطالبة: " + title
        ),
        el("p", reportDate)
      );

      const table = el("table");
      const head = el("thead");
      const headerRow = el("tr");

      [
        "الطالبة",
        "القياس القبلي",
        "القياس البعدي",
        "التغير بالنقاط المئوية",
        "تقدم التدريب"
      ].forEach(function (heading) {
        headerRow.append(el("th", heading));
      });

      head.append(headerRow);

      const body = el("tbody");

      people.forEach(function (person) {
        body.append(studentRow(person, false));
      });

      table.append(head, body);

      const wrap = el("div", undefined, "nt-table-wrap");
      wrap.append(table);

      area.append(
        wrap,
        el(
          "h3",
          "المجالات والمهارات — " +
          $("nt-mode").selectedOptions[0].textContent
        )
      );

      const skillsTable = el("table");
      const skillsHead = el("thead");
      const skillsHeaderRow = el("tr");

      [
        "المجال / المهارة",
        "الإجابات",
        "الصحيحة",
        "نسبة الإجابات الصحيحة"
      ].forEach(function (heading) {
        skillsHeaderRow.append(el("th", heading));
      });

      skillsHead.append(skillsHeaderRow);

      const skillsBody = el("tbody");

      skillsTable.append(skillsHead, skillsBody);

      renderSkills(
        people,
        $("nt-mode").value,
        skillsBody
      );

      area.append(
        skillsTable,
        el(
          "p",
          "تُحتسب نتائج القياس من أحدث جلسة مكتملة " +
          "تضم 30 سؤالًا مختلفًا، مع استبعاد التكرار. " +
          "النتائج القديمة المجمّعة مستعادة من السجلات " +
          "المستوردة التي تضم 30 سؤالًا مختلفًا. " +
          "الجلسات الناقصة لا تمثل درجة صفر. " +
          "اختلاف نماذج الأسئلة قد يؤثر في المقارنة.",
          "nt-note"
        ),
        el(
          "p",
          "إعداد وتصميم: بدرية محمد الزهراني",
          "nt-muted"
        )
      );

      $("nt-dialog-title").textContent =
        title === "جماعي"
          ? "معاينة التقرير الجماعي"
          : "معاينة التقرير الفردي";

      dialog.showModal();
    }

    function reset() {
      generation++;
      codeChange.reset();

      if (request && typeof request.abort === "function") {
        request.abort();
      }

      request = null;
      credentials = null;
      state = null;

      if (dialog.open) dialog.close();

      [
        "nt-detail",
        "nt-print",
        "nt-students",
        "nt-skills",
        "nt-metrics"
      ].forEach(function (id) {
        $(id).replaceChildren();
      });

      [
        "nt-school",
        "nt-teacher",
        "nt-updated",
        "nt-quality"
      ].forEach(function (id) {
        $(id).textContent = "";
      });

      $("nt-secret").value = "";
      $("nt-code").value = "";
      $("nt-search").value = "";
      $("nt-filter").value = "all";

      hide(dashboard);
      show(login);

      setBusy(false);
      notify("تم الخروج.");

      $("nt-code").focus();
    }

    function fetchData(values) {
      if (busy) return;

      if (
        !window.shell ||
        typeof window.shell.ajaxSafePost !== "function"
      ) {
        notify(
          "تعذر تهيئة الاتصال. أعيدي تحميل الصفحة.",
          true
        );

        return;
      }

      const token = ++generation;
      let finished = false;

      setBusy(true);
      notify("جارٍ التحقق وجلب بيانات المدرسة…");

      function finish() {
        window.clearTimeout(timer);

        if (token === generation) {
          request = null;
          setBusy(false);
        }
      }

      function fail(xhr, status) {
        if (finished || token !== generation) return;

        finished = true;
        const currentRequest = request;
        finish();
        if (status === "timeout" && currentRequest && typeof currentRequest.abort === "function") currentRequest.abort();

        const code = xhr && xhr.status;

        if (code === 401 || code === 403) {
          notify(
            "رُفض تشغيل التدفق. " +
            "راجعي أدوار التدفق داخل Power Pages.",
            true
          );
        } else if (status === "timeout") {
          notify("تأخر رد إحدى دفعات البيانات. لم تُعتمد نتائج جزئية؛ حاولي مجددًا.", true);
        } else if (xhr && xhr.nafisError) {
          notify("توقف جلب الدفعات قبل اكتمالها. لم تُعتمد نتائج جزئية؛ تحققي من إعدادات التدفق أو أعيدي المحاولة.", true);
        } else {
          notify(
            "تعذر جلب البيانات. حاولي مجددًا." +
            (code ? " رمز الخطأ: " + code : ""),
            true
          );
        }
      }

      const timer = window.setTimeout(function () {
        fail(null, "timeout");
      }, 1800000);

      try {
        request = window.NafisTeacherPaging.post({
          type: "POST",
          url: FLOW_URL,
          timeout: 110000,
          nafisProgress: function (progress) {
            if (finished || token !== generation) return;
            notify("جارٍ استكمال الدفعة " + progress.pages + " — الطالبات: " + progress.students + "، الإجابات: " + progress.attempts + "، سجلات التدريب: " + progress.training + ". ستظهر النتائج بعد اكتمال الجلب.");
          },
          data: {
            eventData: JSON.stringify({
              SchoolCode: values.SchoolCode,
              TeacherCode: values.TeacherCode
            })
          }
        });

        request
          .done(function (response) {
            if (finished || token !== generation) return;

            finished = true;

            try {
              const result = unwrap(response);
              const success = field(result, "Success");

              const valid =
                success === true ||
                text(success).trim().toLowerCase() === "true";

              if (!valid) {
                reset();

                notify(
                  "تعذر الدخول. تحققي من رمز المدرسة ورمز المعلمة.",
                  true
                );

                return;
              }

              const students = readArray(
                field(result, "StudentsJson")
              );

              const attempts = readArray(
                field(result, "AttemptsJson")
              );

              const training = readArray(
                field(result, "TrainingJson")
              );

              if (
                (students.length >= 5000 || attempts.length >= 5000 || training.length >= 5000) &&
                field(result, "NafisComplete") !== true
              ) {
                throw new Error("DATA_LIMIT");
              }

              state = aggregate(students, attempts);
              attachTraining(state.people, training, values.SchoolCode);

              state.school =
                text(field(result, "SchoolName")).trim() ||
                "المدرسة";

              state.teacher =
                text(field(result, "TeacherName")).trim() ||
                "المعلمة";

              // تبقى رموز الدخول في الذاكرة أثناء فتح الصفحة فقط.
              credentials = {
                SchoolCode: values.SchoolCode,
                TeacherCode: values.TeacherCode
              };

              $("nt-secret").value = "";

              $("nt-school").textContent = state.school;

              $("nt-teacher").textContent =
                "المعلمة: " + state.teacher;

              $("nt-updated").textContent =
                "آخر تحديث: " +
                new Intl.DateTimeFormat(
                  "ar-SA",
                  {
                    dateStyle: "short",
                    timeStyle: "short",
                    timeZone: "Asia/Riyadh"
                  }
                ).format(new Date());

              renderMetrics();
              render();

              hide(login);
              show(dashboard);

              notify("تم تحميل بيانات المدرسة كاملةً وتحديث التقارير بنجاح.");
            } catch (error) {
              console.error(
                "Nafis: response processing failed.",
                error.name
              );

              if (error.message === "DATA_LIMIT") {
                hide(dashboard);
                show(login);

                notify(
                  "وصلت البيانات إلى حد الجلب. " +
                  "يلزم استكمال إعداد جلب الدفعات " +
                  "قبل عرض تقرير شامل.",
                  true
                );
              } else {
                notify(
                  "وصل الرد، لكن تعذرت قراءة النتائج. " +
                  "راجعي أسماء مخرجات التدفق وتعيين الحقول.",
                  true
                );
              }
            } finally {
              finish();
            }
          })
          .fail(fail);
      } catch (error) {
        console.error(
          "Nafis: request could not start.",
          error.name
        );

        fail(null, "error");
      }
    }

    function startLogin(event) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }

      if (busy) return;

      const schoolCode = $("nt-code").value.trim();
      const teacherCode = $("nt-secret").value.trim();

      if (!/^[A-Za-z0-9_-]{1,60}$/.test(schoolCode)) {
        notify("أدخلي رمز المدرسة الصحيح.", true);
        $("nt-code").focus();
        return;
      }

      if (!teacherCode || teacherCode.length > 64) {
        notify("أدخلي رمز دخول المعلمة الصحيح.", true);
        $("nt-secret").focus();
        return;
      }

      fetchData({
        SchoolCode: schoolCode,
        TeacherCode: teacherCode
      });
    }

    $("nt-enter").addEventListener("click", startLogin);

    ["nt-code", "nt-secret"].forEach(function (id) {
      $(id).addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
          startLogin(event);
        }
      });
    });

    $("nt-refresh").addEventListener("click", function () {
      if (credentials) fetchData(credentials);
    });

    $("nt-logout").addEventListener("click", reset);

    $("nt-search").addEventListener("input", render);
    $("nt-filter").addEventListener("change", render);
    $("nt-mode").addEventListener("change", render);

    $("nt-close").addEventListener("click", function () {
      dialog.close();
    });

    $("nt-report").addEventListener("click", function () {
      openReport(selectedPeople(), "جماعي");
    });

    $("nt-print-button").addEventListener(
      "click",
      function () {
        $("nt-print").replaceChildren(
          $("nt-detail").cloneNode(true)
        );

        dialog.close();
        window.print();
      }
    );

    window.addEventListener("afterprint", function () {
      $("nt-print").replaceChildren();
    });

    $("nt-csv").addEventListener("click", function () {
      if (!state) return;

      const rows = [
        [
          "الطالبة",
          "القبلي من 30",
          "البعدي من 30",
          "التغير بالنقاط المئوية",
          "تقدم التدريب",
          "الدفعات المكتملة",
          "إجمالي الدفعات"
        ]
      ];

      selectedPeople().forEach(function (person) {
        const change = gain(person);

        rows.push([
          person.name,
          person.pre ? person.pre.score : "غير مكتمل",
          person.post ? person.post.score : "غير مكتمل",
          change === null
            ? ""
            : Math.round(change * 100) / 100,
          trainingText(person),
          person.progress.completed,
          person.progress.total || ""
        ]);
      });

      const content = rows.map(function (row) {
        return row.map(csvCell).join(",");
      }).join("\r\n");

      const blob = new Blob(
        ["\ufeff" + content],
        { type: "text/csv;charset=utf-8" }
      );

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = "Nafis360-student-results.csv";

      document.body.append(link);
      link.click();
      link.remove();

      window.setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 1500);
    });

    const note = root.querySelector(".nt-note");

    if (note) {
      note.textContent =
        "تُحتسب نتائج القياس من أحدث جلسة مكتملة " +
        "تضم 30 سؤالًا مختلفًا. تُستعاد النتائج القديمة " +
        "المستوردة الموزعة بين جلسات عندما تضم " +
        "30 سؤالًا مختلفًا، وتظهر بعلامة " +
        "«نتيجة قديمة مجمّعة». " +
        "تُستبعد التكرارات والجلسات الناقصة والإجابات غير الصالحة من احتساب الدرجات. " +
        "التدريب متابعة إنجاز بالدفعات المكتملة، ولا يدخل في درجات القياس.";
    }

    show(login);
    hide(dashboard);
    setBusy(false);

    notify("أدخلي رمزي المدرسة والمعلمة للبدء.");
  }

  function scheduleInit() {
    window.setTimeout(init, 0);
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      scheduleInit,
      { once: true }
    );
  } else {
    scheduleInit();
  }
})();
(function () {
  "use strict";

  const PRINT_CSS = `
    @page {
      size: A4 portrait;
      margin: 10mm;
    }

    * {
      box-sizing: border-box;
    }

    html,
    body {
      margin: 0;
      padding: 0;
      background: white;
    }

    body {
      direction: rtl;
      color: #142b49;
      font-family: Tahoma, Arial, sans-serif;
    }

    .pdf-page {
      position: relative;
      width: 190mm;
      height: 276mm;
      overflow: hidden;
    }

    .pdf-content {
      width: 190mm;
      transform-origin: top right;
    }

    .pdf-header {
      padding-bottom: 8px;
      margin-bottom: 9px;
      border-bottom: 2px solid #b58a38;
    }

    .pdf-brand {
      color: #9a742a;
      font-size: 17px;
      font-weight: bold;
    }

    h1 {
      margin: 3px 0;
      font-size: 17px;
    }

    .pdf-meta {
      margin-top: 3px;
      font-size: 10px;
      line-height: 1.6;
    }

    .pdf-columns {
      display: grid;
      grid-template-columns: 1fr 1fr;
      align-items: start;
      gap: 12px;
    }

    .pdf-column {
      min-width: 0;
    }

    h2 {
      margin: 0 0 6px;
      padding: 5px 7px;
      border-right: 3px solid #b58a38;
      background: #f0f3f8;
      font-size: 12px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 9px;
      line-height: 1.45;
    }

    th,
    td {
      padding: 4px;
      border: 1px solid #dce2ea;
      text-align: right;
      vertical-align: top;
      white-space: normal;
      overflow-wrap: anywhere;
    }

    th {
      background: #edf1f6;
      font-weight: bold;
    }

    tr {
      break-inside: avoid;
    }

    .pdf-students th:first-child {
      width: 40%;
    }

    .pdf-students th:not(:first-child) {
      width: 20%;
    }

    .pdf-skills th:first-child {
      width: 61%;
    }

    .pdf-skills th:not(:first-child) {
      width: 13%;
    }

    .pdf-number {
      display: block;
      font-size: 10px;
      font-weight: bold;
    }

    .pdf-percent {
      display: block;
      color: #526579;
      font-size: 8px;
    }

    .pdf-skills strong {
      display: block;
      color: #526579;
      font-size: 8px;
    }

    .nt-muted {
      font-size: 9px;
    }

    .pdf-footnote {
      margin-top: 9px;
      padding-top: 6px;
      border-top: 1px solid #b58a38;
      font-size: 8px;
      line-height: 1.6;
    }

    @media print {
      * {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    }
  `;

  function init() {
    const root = document.getElementById("nafis-teacher");

    if (!root || root.dataset.printButtonsFixed) return;

    const printButton = root.querySelector("#nt-print-button");
    const detail = root.querySelector("#nt-detail");
    const dialog = root.querySelector("#nt-dialog");

    if (!printButton || !detail || !dialog) return;

    root.dataset.printButtonsFixed = "v1";

    // تثبيت ألوان الأزرار وإخفاء تذييل صفحة المعلمة.
    const style = document.createElement("style");

    style.textContent = `
      #nafis-teacher button {
        background: #142b49 !important;
        background-image: none !important;
        color: #ffffff !important;
        -webkit-text-fill-color: #ffffff !important;
        border: 1px solid #142b49 !important;
        border-radius: 9px !important;
        padding: 10px 17px !important;
        font-family: Tahoma, Arial, sans-serif !important;
        font-weight: 700 !important;
        text-shadow: none !important;
        opacity: 1;
      }

      #nafis-teacher button:hover {
        background: #203e63 !important;
      }

      #nafis-teacher button.nt-secondary {
        background: #ffffff !important;
        color: #142b49 !important;
        -webkit-text-fill-color: #142b49 !important;
        border-color: #b58a38 !important;
      }

      #nafis-teacher button.nt-secondary:hover {
        background: #f5f0e5 !important;
      }

      #nafis-teacher button:disabled {
        opacity: 0.65 !important;
        cursor: wait !important;
      }

      #nafis-teacher .nt-metric {
        background: #ffffff !important;
        border: 1px solid #e1e6ed !important;
        border-top: 3px solid #b58a38 !important;
        border-radius: 13px !important;
        padding: 18px !important;
      }

      #nafis-teacher .nt-value {
        display: block !important;
        margin-top: 6px !important;
        font-size: 28px !important;
      }

      #nafis-teacher footer,
      body:has(#nafis-teacher) footer,
      body:has(#nafis-teacher) #footer,
      body:has(#nafis-teacher) [role="contentinfo"] {
        display: none !important;
      }
    `;

    document.head.appendChild(style);

    function node(doc, tag, content, className) {
      const element = doc.createElement(tag);

      if (content !== undefined) {
        element.textContent = content;
      }

      if (className) {
        element.className = className;
      }

      return element;
    }

    function compactStudents(table, doc) {
      const copy = doc.importNode(table, true);
      copy.className = "pdf-students";

      const headings = [
        "الطالبة",
        "القبلي / 30",
        "البعدي / 30",
        "التغير",
        "التدريب"
      ];

      copy.querySelectorAll("thead th").forEach(
        function (cell, index) {
          cell.textContent = headings[index] || cell.textContent;
        }
      );

      copy.querySelectorAll("tbody tr").forEach(function (row) {
        [1, 2].forEach(function (index) {
          const cell = row.cells[index];

          if (!cell) return;

          const value = cell.textContent;

          const score = value.match(
            /(\d+)\s+إجابة صحيحة من 30/
          );

          const percent = value.match(/\(([^)]+)\)/);

          if (!score) return;

          const legacy = value.includes("نتيجة قديمة مجمّعة");

          cell.replaceChildren(
            node(
              doc,
              "span",
              score[1] + (legacy ? " *" : ""),
              "pdf-number"
            )
          );

          if (percent) {
            cell.appendChild(
              node(
                doc,
                "span",
                percent[1],
                "pdf-percent"
              )
            );
          }
        });
      });

      return copy;
    }

    function makePaper(doc) {
      const tables = detail.querySelectorAll("table");

      if (tables.length < 2) {
        throw new Error("REPORT_NOT_READY");
      }

      const page = node(doc, "div", undefined, "pdf-page");
      const content = node(doc, "div", undefined, "pdf-content");
      const header = node(doc, "header", undefined, "pdf-header");

      const school = detail.querySelector("h2");

      const paragraphs = Array.from(detail.children).filter(
        function (element) {
          return element.tagName === "P";
        }
      );

      header.appendChild(
        node(doc, "div", "مختبر نافس 360", "pdf-brand")
      );

      header.appendChild(
        node(
          doc,
          "h1",
          school ? school.textContent : "تقرير المدرسة"
        )
      );

      header.appendChild(
        node(
          doc,
          "div",
          root.querySelector("#nt-dialog-title").textContent,
          "pdf-meta"
        )
      );

      header.appendChild(
        node(
          doc,
          "div",
          paragraphs.slice(0, 3).map(function (element) {
            return element.textContent;
          }).join(" · "),
          "pdf-meta"
        )
      );

      const columns = node(
        doc,
        "div",
        undefined,
        "pdf-columns"
      );

      const students = node(
        doc,
        "section",
        undefined,
        "pdf-column"
      );

      students.appendChild(
        node(doc, "h2", "نتائج الطالبات")
      );

      students.appendChild(
        compactStudents(tables[0], doc)
      );

      const skills = node(
        doc,
        "section",
        undefined,
        "pdf-column"
      );

      const skillsTitle = detail.querySelector("h3");

      skills.appendChild(
        node(
          doc,
          "h2",
          skillsTitle
            ? skillsTitle.textContent
            : "المجالات والمهارات"
        )
      );

      const skillsTable = doc.importNode(tables[1], true);
      skillsTable.className = "pdf-skills";

      skillsTable.querySelectorAll(".nt-bar").forEach(
        function (element) {
          element.remove();
        }
      );

      const skillHeadings = [
        "المجال / المهارة",
        "العدد",
        "الصحيح",
        "النسبة"
      ];

      skillsTable.querySelectorAll("thead th").forEach(
        function (cell, index) {
          cell.textContent =
            skillHeadings[index] || cell.textContent;
        }
      );

      skills.appendChild(skillsTable);

      columns.appendChild(students);
      columns.appendChild(skills);

      content.appendChild(header);
      content.appendChild(columns);

      content.appendChild(
        node(
          doc,
          "div",
          "الدرجات من 30. التغير بالنقاط المئوية. " +
          "(*) نتيجة قديمة مجمّعة من السجلات المستوردة. " +
          "الجلسات الناقصة لا تمثل درجة صفر. " +
          "اختلاف نماذج الأسئلة قد يؤثر في المقارنة. " +
          "إعداد: بدرية محمد الزهراني.",
          "pdf-footnote"
        )
      );

      page.appendChild(content);

      return page;
    }

    let printing = false;

    printButton.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopImmediatePropagation();

      if (printing) return;

      printing = true;
      printButton.disabled = true;

      const oldFrame = document.getElementById(
        "nafis-report-print-frame"
      );

      if (oldFrame) oldFrame.remove();

      const frame = document.createElement("iframe");

      frame.id = "nafis-report-print-frame";
      frame.title = "طباعة تقرير مختبر نافس";

      frame.style.cssText =
        "position:fixed;" +
        "left:-10000px;" +
        "top:0;" +
        "width:794px;" +
        "height:1123px;" +
        "border:0;";

      function ready() {
        printing = false;
        printButton.disabled = false;
      }

      frame.addEventListener("load", async function () {
        try {
          const doc = frame.contentDocument;
          const page = makePaper(doc);

          doc.body.appendChild(page);

          if (doc.fonts && doc.fonts.ready) {
            await doc.fonts.ready;
          }

          const win = frame.contentWindow;

          await new Promise(function (resolve) {
            win.requestAnimationFrame(resolve);
          });

          const content = doc.querySelector(".pdf-content");

          // ملاءمة المحتوى كاملًا داخل صفحة واحدة.
          const scale = Math.min(
            1,
            (page.clientHeight - 2) / content.scrollHeight
          );

          content.style.transform = "scale(" + scale + ")";
          content.style.position = "absolute";
          content.style.top = "0";
          content.style.right = "0";

          win.addEventListener("afterprint", function () {
            ready();

            window.setTimeout(function () {
              frame.remove();
            }, 500);
          }, { once: true });

          win.focus();
          win.print();

          ready();
        } catch (error) {
          ready();
          frame.remove();

          const message = root.querySelector("#nt-message");

          message.hidden = false;
          message.dataset.error = "true";

          message.style.setProperty(
            "display",
            "block",
            "important"
          );

          message.textContent =
            "تعذر تجهيز التقرير. " +
            "أغلقي المعاينة وافتحي التقرير من جديد.";
        }
      }, { once: true });

      frame.srcdoc =
        "<!doctype html>" +
        "<html lang='ar' dir='rtl'>" +
        "<head>" +
        "<meta charset='utf-8'>" +
        "<title>تقرير مختبر نافس 360</title>" +
        "<style>" + PRINT_CSS + "</style>" +
        "</head>" +
        "<body></body>" +
        "</html>";

      document.body.appendChild(frame);
    }, true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      window.setTimeout(init, 0);
    }, { once: true });
  } else {
    window.setTimeout(init, 0);
  }
})();
(function () {
  "use strict";

  const FLOW_URL =
    "/_api/cloudflow/v1.0/trigger/6d274259-3dd1-f111-a05a-000d3ab579b0";

  function readResult(value) {
    for (let i = 0; i < 8; i++) {
      if (typeof value === "string") {
        value = JSON.parse(value);
        continue;
      }

      if (!value || typeof value !== "object") break;

      if ("success" in value || "Success" in value) {
        return value;
      }

      if ("response" in value) {
        value = value.response;
        continue;
      }

      if ("body" in value) {
        value = value.body;
        continue;
      }

      break;
    }

    throw new Error("INVALID_RESPONSE");
  }

  function init() {
    const root = document.getElementById("nafis-teacher");

    if (!root || root.querySelector("#nt-add-student-card")) return;

    const dashboard = root.querySelector("#nt-dashboard");
    const school = root.querySelector("#nt-code");
    const refresh = root.querySelector("#nt-refresh");
    const logout = root.querySelector("#nt-logout");

    if (!dashboard || !school || !refresh || !logout) return;

    const card = document.createElement("section");
    card.id = "nt-add-student-card";
    card.className = "nt-card";

    card.innerHTML = `
      <h2>إدارة الطالبات</h2>

      <button id="nt-add-open" type="button"
        aria-expanded="false" aria-controls="nt-add-panel">
        إضافة طالبة جديدة
      </button>

      <div id="nt-add-panel" hidden>
        <label for="nt-add-name">اسم الطالبة الكامل</label>
        <input id="nt-add-name" type="text"
          maxlength="120" autocomplete="off">

        <label for="nt-add-secret">
          رمز المعلمة لتأكيد الإضافة
        </label>
        <input id="nt-add-secret" type="password"
          maxlength="64" autocomplete="off" dir="ltr">

        <p class="nt-muted">
          تُضاف الطالبة إلى المدرسة المفتوحة في اللوحة.
        </p>

        <div class="nt-actions" style="margin-top:14px">
          <button id="nt-add-save" type="button">
            حفظ الطالبة
          </button>
          <button id="nt-add-cancel" type="button"
            class="nt-secondary">
            إلغاء
          </button>
        </div>
      </div>

      <p id="nt-add-status" role="status"
        aria-live="polite"></p>
    `;

    dashboard.insertBefore(
      card,
      dashboard.querySelector("#nt-metrics") || null
    );

    const get = id => card.querySelector("#" + id);
    const panel = get("nt-add-panel");
    const name = get("nt-add-name");
    const secret = get("nt-add-secret");
    const save = get("nt-add-save");

    let busy = false;
    let request = null;
    let generation = 0;
    let timer = null;

    function notify(text, error) {
      const status = get("nt-add-status");
      status.textContent = text;
      status.style.color = error ? "#b42318" : "#15704a";
    }

    function setBusy(value) {
      busy = value;

      [
        save,
        name,
        secret,
        get("nt-add-open"),
        get("nt-add-cancel")
      ].forEach(element => {
        element.disabled = value;
      });

      save.textContent = value
        ? "جارٍ حفظ الطالبة…"
        : "حفظ الطالبة";

      panel.setAttribute("aria-busy", String(value));
    }

    function close() {
      panel.hidden = true;
      panel.style.setProperty("display", "none", "important");
      secret.value = "";

      get("nt-add-open").setAttribute("aria-expanded", "false");
    }

    get("nt-add-open").addEventListener("click", function () {
      panel.hidden = false;
      panel.style.setProperty("display", "block", "important");
      this.setAttribute("aria-expanded", "true");
      notify("");
      name.focus();
    });

    get("nt-add-cancel").addEventListener("click", function () {
      close();
      notify("");
    });

    logout.addEventListener("click", function () {
      generation++;
      window.clearTimeout(timer);

      if (request && typeof request.abort === "function") {
        request.abort();
      }

      request = null;
      setBusy(false);
      name.value = "";
      close();
      notify("");
    }, true);

    save.addEventListener("click", function (event) {
      event.preventDefault();

      if (busy || dashboard.hidden) return;

      const SchoolCode = school.value.trim();
      const StudentName = name.value.trim();
      const TeacherCode = secret.value.trim();

      if (!/^[A-Za-z0-9_-]{1,60}$/.test(SchoolCode)) {
        notify("أعيدي الدخول إلى المدرسة قبل الإضافة.", true);
        return;
      }

      if (StudentName.length < 3 || StudentName.length > 120) {
        notify("أدخلي اسم الطالبة بين 3 و120 حرفًا.", true);
        name.focus();
        return;
      }

      if (!TeacherCode || TeacherCode.length > 64) {
        notify("أدخلي رمز المعلمة لتأكيد الإضافة.", true);
        secret.focus();
        return;
      }

      if (!window.shell ||
          typeof window.shell.ajaxSafePost !== "function") {
        notify("تعذر تهيئة الاتصال. أعيدي تحميل الصفحة.", true);
        return;
      }

      const token = ++generation;
      let finished = false;

      setBusy(true);
      notify("جارٍ التحقق وحفظ الطالبة…");

      function finish() {
        if (finished || token !== generation) return false;

        finished = true;
        window.clearTimeout(timer);
        request = null;
        secret.value = "";
        setBusy(false);

        return true;
      }

      function uncertain() {
        notify(
          "لم يصل تأكيد الحفظ. اضغطي تحديث البيانات " +
          "وابحثي عن الاسم قبل إعادة الإضافة.",
          true
        );
      }

      timer = window.setTimeout(function () {
        if (finish()) uncertain();
      }, 115000);

      try {
        request = window.NafisTeacherPaging.post({
          type: "POST",
          url: FLOW_URL,
          timeout: 110000,
          data: {
            eventData: JSON.stringify({
              SchoolCode,
              TeacherCode,
              StudentName
            })
          }
        });

        request.done(function (response) {
          if (!finish()) return;

          try {
            const result = readResult(response);
            const success = result.success !== undefined
              ? result.success
              : result.Success;

            if (success !== true &&
                String(success).trim().toLowerCase() !== "true") {
              notify(
                String(
                  result.message ||
                  result.Message ||
                  "تعذرت إضافة الطالبة. راجعي البيانات."
                ),
                true
              );
              return;
            }

            name.value = "";
            close();

            notify(
              "تمت إضافة الطالبة بنجاح. يجري تحديث القائمة؛ " +
              "إذا كان هناك بحث أو تصفية، اختاري جميع الطالبات " +
              "وأفرغي البحث لعرضها."
            );

            refresh.click();
          } catch (error) {
            console.error(
              "Nafis add student: unreadable confirmation"
            );
            uncertain();
          }
        }).fail(function (xhr) {
          if (!finish()) return;

          const status = xhr && xhr.status;

          console.error(
            "Nafis add student: request failed",
            status || 0
          );

          if (status === 401 || status === 403) {
            notify(
              "رُفض تشغيل خدمة الإضافة. راجعي أدوار تدفق " +
              "إضافة الطالبة داخل Power Pages.",
              true
            );
          } else {
            uncertain();
          }
        });
      } catch (error) {
        if (finish()) uncertain();
      }
    });

    [name, secret].forEach(function (input) {
      input.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          save.click();
        }
      });
    });

    close();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      window.setTimeout(init, 0);
    }, { once: true });
  } else {
    window.setTimeout(init, 0);
  }
})();
(function () {
  "use strict";

  const LIST_URL =
    "/_api/cloudflow/v1.0/trigger/aff48928-c6d2-f111-a05a-7ced8d458a2d";

  const EDIT_URL =
    "/_api/cloudflow/v1.0/trigger/c58a25ed-49d1-f111-a05a-000d3ab579b0";

  function unpack(value) {
    for (let i = 0; i < 8; i++) {
      if (typeof value === "string") {
        value = JSON.parse(value);
        continue;
      }

      if (!value || typeof value !== "object") break;

      if ("success" in value || "Success" in value) return value;

      if ("response" in value) {
        value = value.response;
        continue;
      }

      if ("body" in value) {
        value = value.body;
        continue;
      }

      break;
    }

    throw new Error("INVALID_RESPONSE");
  }

  function field(value, key) {
    return value[key.toLowerCase()] !== undefined
      ? value[key.toLowerCase()]
      : value[key];
  }

  function init() {
    const root = document.getElementById("nafis-teacher");

    if (!root || root.querySelector("#nt-edit-card")) return;

    const dashboard = root.querySelector("#nt-dashboard");
    const code = root.querySelector("#nt-code");
    const refresh = root.querySelector("#nt-refresh");
    const logout = root.querySelector("#nt-logout");

    if (!dashboard || !code || !refresh || !logout) return;

    const card = document.createElement("section");
    card.id = "nt-edit-card";
    card.className = "nt-card";

    card.innerHTML = `
      <h2>تعديل اسم طالبة</h2>

      <label for="nt-edit-secret">رمز المعلمة</label>
      <input id="nt-edit-secret" type="password"
        maxlength="64" autocomplete="off" dir="ltr">

      <button id="nt-edit-load" type="button"
        style="margin-top:12px">
        تحميل قائمة الطالبات
      </button>

      <label for="nt-edit-select">اختاري الطالبة</label>
      <select id="nt-edit-select" disabled>
        <option value="">اختاري الطالبة</option>
      </select>

      <label for="nt-edit-name">الاسم الجديد</label>
      <input id="nt-edit-name" type="text"
        maxlength="120" autocomplete="off" disabled>

      <div class="nt-actions" style="margin-top:14px">
        <button id="nt-edit-save" type="button" disabled>
          حفظ تعديل الاسم
        </button>
        <button id="nt-edit-clear" type="button"
          class="nt-secondary">
          مسح الحقول
        </button>
      </div>

      <p id="nt-edit-status" role="status"
        aria-live="polite"></p>
    `;

    dashboard.insertBefore(
      card,
      dashboard.querySelector("#nt-metrics") || null
    );

    const get = id => card.querySelector("#" + id);
    const secret = get("nt-edit-secret");
    const select = get("nt-edit-select");
    const name = get("nt-edit-name");

    let busy = false;
    let generation = 0;
    let request = null;
    let timer = null;
    let loadedSchool = "";

    function notify(text, error) {
      get("nt-edit-status").textContent = text;
      get("nt-edit-status").style.color =
        error ? "#b42318" : "#15704a";
    }

    function setBusy(value) {
      busy = value;

      [secret, get("nt-edit-load"), get("nt-edit-clear")]
        .forEach(element => {
          element.disabled = value;
        });

      select.disabled = value || select.options.length < 2;
      name.disabled = value || !select.value;
      get("nt-edit-save").disabled = value || !select.value;

      card.setAttribute("aria-busy", String(value));
    }

    function clearList() {
      loadedSchool = "";
      select.replaceChildren(new Option("اختاري الطالبة", ""));
      name.value = "";
      setBusy(false);
    }

    function reset() {
      generation++;
      window.clearTimeout(timer);

      if (request && typeof request.abort === "function") {
        request.abort();
      }

      request = null;
      secret.value = "";
      clearList();
      notify("");
    }

    get("nt-edit-clear").addEventListener("click", reset);
    logout.addEventListener("click", reset, true);

    select.addEventListener("change", function () {
      name.value = select.value
        ? select.selectedOptions[0].textContent
        : "";

      setBusy(false);
    });

    function credentials() {
      const SchoolCode = code.value.trim();
      const TeacherCode = secret.value.trim();

      if (dashboard.hidden ||
          !/^[A-Za-z0-9_-]{1,60}$/.test(SchoolCode)) {
        notify("أعيدي الدخول إلى المدرسة.", true);
        return null;
      }

      if (!TeacherCode || TeacherCode.length > 64) {
        notify("أدخلي رمز المعلمة للتحقق من صلاحية التعديل.", true);
        secret.focus();
        return null;
      }

      return { SchoolCode, TeacherCode };
    }

    function post(url, data, saving, onSuccess) {
      if (!window.shell ||
          typeof window.shell.ajaxSafePost !== "function") {
        notify("تعذر تهيئة الاتصال. أعيدي تحميل الصفحة.", true);
        return;
      }

      const token = ++generation;
      let finished = false;

      setBusy(true);
      notify(
        saving
          ? "جارٍ التحقق وحفظ الاسم…"
          : "جارٍ التحقق وجلب الطالبات…"
      );

      function finish() {
        if (finished || token !== generation) return false;

        finished = true;
        window.clearTimeout(timer);
        request = null;
        setBusy(false);

        if (saving) secret.value = "";

        return true;
      }

      function uncertain() {
        notify(
          saving
            ? "لم يصل تأكيد التعديل. حدّثي البيانات وتحققي من الاسم قبل إعادة المحاولة."
            : "تعذر تحميل الطالبات. حاولي مرة أخرى.",
          true
        );
      }

      timer = window.setTimeout(function () {
        const currentRequest = request;
        if (finish()) {
          if (!saving && currentRequest && typeof currentRequest.abort === "function") currentRequest.abort();
          uncertain();
        }
      }, saving ? 115000 : 1800000);

      try {
        request = window.NafisTeacherPaging.post({
          type: "POST",
          url,
          timeout: 110000,
          nafisScope: "students",
          data: {
            eventData: JSON.stringify(data)
          }
        });

        request.done(function (response) {
          if (!finish()) return;

          try {
            const result = unpack(response);
            const ok = field(result, "Success");

            if (ok !== true &&
                String(ok).trim().toLowerCase() !== "true") {
              secret.value = "";
              clearList();

              notify(
                String(
                  field(result, "Message") ||
                  "تعذر التحقق. راجعي البيانات."
                ),
                true
              );

              return;
            }

            onSuccess(result);
          } catch (error) {
            console.error(
              "Nafis edit student: unreadable confirmation"
            );
            uncertain();
          }
        }).fail(function (xhr) {
          if (!finish()) return;

          const status = xhr && xhr.status;

          console.error(
            "Nafis edit student: request failed",
            status || 0
          );

          if (status === 401 || status === 403) {
            notify(
              "رُفض تشغيل التدفق. راجعي أدواره داخل Power Pages.",
              true
            );
          } else {
            uncertain();
          }
        });
      } catch (error) {
        if (finish()) uncertain();
      }
    }

    get("nt-edit-load").addEventListener("click", function () {
      if (busy) return;

      const values = credentials();
      if (!values) return;

      clearList();

      post(LIST_URL, values, false, function (result) {
        let students = field(result, "StudentsJson");

        if (typeof students === "string") {
          students = JSON.parse(students);
        }

        if (!Array.isArray(students) || (students.length >= 5000 && field(result, "NafisComplete") !== true)) {
          throw new Error("INVALID_LIST");
        }

        const seen = new Set();

        students.forEach(function (student) {
          if (!student ||
              typeof student.StudentKey !== "string" ||
              typeof student.StudentName !== "string") return;

          const key = student.StudentKey.trim();

          if (!key ||
              !student.StudentName.trim() ||
              seen.has(key)) return;

          seen.add(key);

          const option = new Option(student.StudentName, key);
          const recordId = Number(student.ID);
          if (Number.isSafeInteger(recordId) && recordId > 0) {
            option.dataset.studentId = String(recordId);
          }
          select.add(option);
        });

        loadedSchool = values.SchoolCode;
        setBusy(false);

        notify(
          seen.size
            ? "اختاري الطالبة ثم عدّلي الاسم واحفظي."
            : "لا توجد طالبات مسجلات في المدرسة."
        );
      });
    });

    get("nt-edit-save").addEventListener("click", function () {
      if (busy) return;

      const values = credentials();
      if (!values) return;

      if (!select.value || loadedSchool !== values.SchoolCode) {
        notify("حمّلي قائمة الطالبات لهذه المدرسة أولًا.", true);
        return;
      }

      const StudentName = name.value.trim();
      const StudentKey = select.value;

      if (StudentName.length < 3 || StudentName.length > 120) {
        notify("أدخلي الاسم بين 3 و120 حرفًا.", true);
        name.focus();
        return;
      }

      const StudentId = select.selectedOptions[0]?.dataset.studentId || "";
      if (!/^[1-9][0-9]*$/.test(StudentId) || !Number.isSafeInteger(Number(StudentId))) {
        notify("أعيدي تحميل قائمة الطالبات لتحديد رقم السجل قبل التعديل.", true);
        return;
      }

      post(
        EDIT_URL,
        { ...values, StudentKey, StudentName, StudentId },
        true,
        function () {
          select.selectedOptions[0].textContent = StudentName;

          notify(
            "تم تعديل الاسم بنجاح. يجري تحديث بيانات اللوحة."
          );

          refresh.click();
        }
      );
    });

    [secret, name].forEach(function (input) {
      input.addEventListener("keydown", function (event) {
        if (event.key !== "Enter") return;

        event.preventDefault();
        event.stopPropagation();

        get(
          input === secret ? "nt-edit-load" : "nt-edit-save"
        ).click();
      });
    });

    setBusy(false);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      window.setTimeout(init, 0);
    }, { once: true });
  } else {
    window.setTimeout(init, 0);
  }
})();
(function () {
  "use strict";

  const URLS = {
    list: "/_api/cloudflow/v1.0/trigger/aff48928-c6d2-f111-a05a-7ced8d458a2d",
    add: "/_api/cloudflow/v1.0/trigger/6d274259-3dd1-f111-a05a-000d3ab579b0",
    edit: "/_api/cloudflow/v1.0/trigger/c58a25ed-49d1-f111-a05a-000d3ab579b0",
    archive: "/_api/cloudflow/v1.0/trigger/6e33bdec-53d1-f111-a05c-7c1e52885529"
  };

  function unpack(value) {
    for (let i = 0; i < 8; i++) {
      if (typeof value === "string") {
        value = JSON.parse(value);
        continue;
      }

      if (!value || typeof value !== "object") break;

      if ("success" in value || "Success" in value) return value;

      if ("response" in value) {
        value = value.response;
        continue;
      }

      if ("body" in value) {
        value = value.body;
        continue;
      }

      break;
    }

    throw new Error("INVALID_RESPONSE");
  }

  function field(value, key) {
    return value[key.toLowerCase()] !== undefined
      ? value[key.toLowerCase()]
      : value[key];
  }

  function isTrue(value) {
    return value === true ||
      value === 1 ||
      String(value).trim().toLowerCase() === "true";
  }

  function init() {
    const root = document.getElementById("nafis-teacher");
    if (!root || root.querySelector("#nt-management")) return;

    const find = id => root.querySelector("#" + id);
    const dashboard = find("nt-dashboard");
    const metrics = find("nt-metrics");
    const code = find("nt-code");
    const refresh = find("nt-refresh");
    const logout = find("nt-logout");

    if (!dashboard || !metrics || !code || !refresh || !logout) {
      return;
    }

    // استبدال بطاقتي الإدارة السابقتين بالشريط الموحد.
    ["nt-add-student-card", "nt-edit-card"].forEach(function (id) {
      const old = find(id);
      if (old) old.remove();
    });

    // وضع المؤشرات مباشرة بعد عنوان المدرسة.
    const heading = find("nt-school");
    const headingCard = heading && heading.closest(".nt-card");

    if (headingCard && headingCard.parentElement === dashboard) {
      headingCard.after(metrics);
    }

    const style = document.createElement("style");

    style.textContent = `
      #nafis-teacher #nt-management {
        padding: 0;
        overflow: hidden;
      }

      #nafis-teacher .nt-management-bar {
        display: grid !important;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
        padding: 18px;
      }

      #nafis-teacher .nt-management-bar button {
        width: 100%;
        min-height: 48px;
        white-space: normal;
      }

      #nafis-teacher .nt-management-bar
      button[aria-expanded="true"] {
        box-shadow: 0 0 0 3px #b58a3850;
      }

      #nafis-teacher #nt-management-work {
        border-top: 1px solid #e1e6ed;
        padding: 22px;
      }

      #nafis-teacher #nt-management-status {
        margin: 0;
        padding: 0 22px 18px;
        white-space: pre-line;
      }

      #nafis-teacher #nt-management-status:empty {
        display: none;
      }

      #nafis-teacher #nm-confirm-label {
        display: flex;
        align-items: flex-start;
        gap: 9px;
      }

      #nafis-teacher #nm-confirm {
        width: 18px;
        height: 18px;
        flex: none;
        margin-top: 4px;
      }

      #nafis-teacher #nm-submit[data-mode="archive"] {
        background: #96352f !important;
        border-color: #96352f !important;
        color: #ffffff !important;
        -webkit-text-fill-color: #ffffff !important;
      }

      @media (max-width: 480px) {
        #nafis-teacher .nt-management-bar {
          gap: 6px;
          padding: 12px;
        }

        #nafis-teacher .nt-management-bar button {
          padding: 10px 5px !important;
          font-size: 13px !important;
        }
      }
    `;

    document.head.appendChild(style);

    const card = document.createElement("section");
    card.id = "nt-management";
    card.className = "nt-card";
    card.setAttribute("aria-label", "إدارة الطالبات");

    card.innerHTML = `
      <div class="nt-management-bar">
        <button id="nm-add" type="button"
          aria-controls="nt-management-work"
          aria-expanded="false">
          إضافة طالبة
        </button>

        <button id="nm-edit" type="button"
          aria-controls="nt-management-work"
          aria-expanded="false">
          تعديل الاسم
        </button>

        <button id="nm-archive" type="button"
          aria-controls="nt-management-work"
          aria-expanded="false">
          حذف طالبة
        </button>
      </div>

      <div id="nt-management-work" hidden>
        <h2 id="nm-title"></h2>

        <label for="nm-secret">
          رمز المعلمة لتأكيد الصلاحية
        </label>
        <input id="nm-secret" type="password"
          maxlength="64" autocomplete="off" dir="ltr">

        <div id="nm-picker" hidden>
          <button id="nm-load" type="button"
            class="nt-secondary" style="margin-top:12px">
            تحميل قائمة الطالبات
          </button>

          <label for="nm-student">اختاري الطالبة</label>
          <select id="nm-student" disabled>
            <option value="">اختاري الطالبة</option>
          </select>
        </div>

        <div id="nm-name-area">
          <label id="nm-name-label" for="nm-name">
            اسم الطالبة الكامل
          </label>
          <input id="nm-name" type="text"
            maxlength="120" autocomplete="off">
        </div>

        <div id="nm-confirm-area" hidden>
          <p class="nt-muted">
            الحذف هنا أرشفة لسجل الطالبة
            مع الاحتفاظ بنتائجها السابقة.
          </p>

          <label id="nm-confirm-label" for="nm-confirm">
            <input id="nm-confirm" type="checkbox">
            أؤكد أرشفة الطالبة المحددة.
          </label>
        </div>

        <div class="nt-actions" style="margin-top:18px">
          <button id="nm-submit" type="button">حفظ</button>
          <button id="nm-close" type="button"
            class="nt-secondary">
            إغلاق
          </button>
        </div>
      </div>

      <p id="nt-management-status"
        role="status" aria-live="polite"></p>
    `;

    metrics.after(card);

    const get = id => card.querySelector("#" + id);
    const work = get("nt-management-work");
    const secret = get("nm-secret");
    const select = get("nm-student");
    const name = get("nm-name");
    const confirmation = get("nm-confirm");

    const buttons = ["add", "edit", "archive"].map(function (mode) {
      return get("nm-" + mode);
    });

    let mode = "";
    let busy = false;
    let generation = 0;
    let request = null;
    let timer = null;
    let loadedSchool = "";

    function visible(node, value) {
      node.hidden = !value;
      node.style.setProperty(
        "display",
        value ? "block" : "none",
        "important"
      );
    }

    function notify(text, error) {
      const status = get("nt-management-status");
      status.textContent = text;
      status.style.color = error ? "#b42318" : "#15704a";
    }

    function setBusy(value) {
      busy = value;

      [
        ...buttons,
        secret,
        get("nm-load"),
        get("nm-close"),
        confirmation
      ].forEach(function (node) {
        node.disabled = value;
      });

      select.disabled = value || select.options.length < 2;
      name.disabled = value || (mode === "edit" && !select.value);

      get("nm-submit").disabled =
        value || !mode || (mode !== "add" && !select.value);

      card.setAttribute("aria-busy", String(value));
    }

    function clearSelection() {
      loadedSchool = "";
      select.replaceChildren(new Option("اختاري الطالبة", ""));
      name.value = "";
      confirmation.checked = false;
    }

    function close() {
      visible(work, false);
      secret.value = "";
      clearSelection();
      mode = "";

      buttons.forEach(function (button) {
        button.setAttribute("aria-expanded", "false");
      });

      setBusy(false);
    }

    buttons.forEach(function (button, index) {
      button.addEventListener("click", function () {
        if (busy) return;

        close();
        notify("");
        mode = ["add", "edit", "archive"][index];

        get("nm-title").textContent = {
          add: "إضافة طالبة جديدة",
          edit: "تعديل اسم طالبة",
          archive: "حذف طالبة بالأرشفة"
        }[mode];

        get("nm-name-label").textContent =
          mode === "edit" ? "الاسم الجديد" : "اسم الطالبة الكامل";

        get("nm-submit").textContent = {
          add: "حفظ الطالبة",
          edit: "حفظ تعديل الاسم",
          archive: "تأكيد الحذف بالأرشفة"
        }[mode];

        get("nm-submit").dataset.mode = mode;

        visible(get("nm-picker"), mode !== "add");
        visible(get("nm-name-area"), mode !== "archive");
        visible(get("nm-confirm-area"), mode === "archive");
        visible(work, true);

        button.setAttribute("aria-expanded", "true");
        setBusy(false);
        secret.focus();
      });
    });

    get("nm-close").addEventListener("click", function () {
      if (busy) return;
      close();
      notify("");
    });

    logout.addEventListener("click", function () {
      generation++;
      window.clearTimeout(timer);

      if (request && typeof request.abort === "function") {
        request.abort();
      }

      request = null;
      close();
      notify("");
    }, true);

    select.addEventListener("change", function () {
      name.value = select.value
        ? select.selectedOptions[0].textContent
        : "";

      confirmation.checked = false;
      setBusy(false);
    });

    function credentials() {
      const SchoolCode = code.value.trim();
      const TeacherCode = secret.value.trim();

      if (dashboard.hidden ||
          !/^[A-Za-z0-9_-]{1,60}$/.test(SchoolCode)) {
        notify("أعيدي الدخول إلى المدرسة قبل المتابعة.", true);
        return null;
      }

      if (!TeacherCode || TeacherCode.length > 64) {
        notify("أدخلي رمز المعلمة.", true);
        secret.focus();
        return null;
      }

      return { SchoolCode, TeacherCode };
    }

    function post(url, data, saving, onSuccess) {
      if (!window.shell ||
          typeof window.shell.ajaxSafePost !== "function") {
        notify("تعذر تهيئة الاتصال. أعيدي تحميل الصفحة.", true);
        return;
      }

      const token = ++generation;
      let finished = false;

      setBusy(true);
      notify(
        saving
          ? "جارٍ التحقق وحفظ العملية…"
          : "جارٍ التحقق وتحميل الطالبات…"
      );

      function finish() {
        if (finished || token !== generation) return false;

        finished = true;
        window.clearTimeout(timer);
        request = null;

        if (saving) secret.value = "";

        setBusy(false);
        return true;
      }

      function uncertain() {
        notify(
          saving
            ? "لم يصل تأكيد العملية. حدّثي البيانات وتحققي من السجل قبل إعادة المحاولة."
            : "تعذر تحميل الطالبات. حاولي مرة أخرى.",
          true
        );
      }

      timer = window.setTimeout(function () {
        const currentRequest = request;
        if (finish()) {
          if (!saving && currentRequest && typeof currentRequest.abort === "function") currentRequest.abort();
          uncertain();
        }
      }, saving ? 115000 : 1800000);

      try {
        request = window.NafisTeacherPaging.post({
          type: "POST",
          url,
          timeout: 110000,
          nafisScope: "students",
          data: {
            eventData: JSON.stringify(data)
          }
        });

        request.done(function (response) {
          if (!finish()) return;

          try {
            const result = unpack(response);

            if (!isTrue(field(result, "Success"))) {
              secret.value = "";

              notify(
                String(
                  field(result, "Message") ||
                  "تعذرت العملية. راجعي البيانات."
                ),
                true
              );

              return;
            }

            onSuccess(result);
          } catch (error) {
            console.error(
              "Nafis management: unreadable confirmation"
            );
            uncertain();
          }
        }).fail(function (xhr) {
          if (!finish()) return;

          const status = xhr && xhr.status;

          console.error(
            "Nafis management: request failed",
            status || 0
          );

          if (status === 401 || status === 403) {
            notify(
              "رُفض تشغيل الخدمة. راجعي أدوار التدفق داخل Power Pages.",
              true
            );
          } else {
            uncertain();
          }
        });
      } catch (error) {
        if (finish()) uncertain();
      }
    }

    get("nm-load").addEventListener("click", function () {
      if (busy || !["edit", "archive"].includes(mode)) return;

      const values = credentials();
      if (!values) return;

      clearSelection();

      post(URLS.list, values, false, function (result) {
        let students = field(result, "StudentsJson");

        if (typeof students === "string") {
          students = JSON.parse(students);
        }

        if (!Array.isArray(students) || (students.length >= 5000 && field(result, "NafisComplete") !== true)) {
          throw new Error("INVALID_LIST");
        }

        const seen = new Set();

        students.forEach(function (student) {
          if (!student ||
              isTrue(student.IsArchived) ||
              isTrue(student.isarchived) ||
              typeof student.StudentKey !== "string" ||
              typeof student.StudentName !== "string") return;

          const key = student.StudentKey.trim();

          if (!key ||
              !student.StudentName.trim() ||
              seen.has(key)) return;

          seen.add(key);

          const option = new Option(student.StudentName, key);
          const recordId = Number(student.ID);
          if (Number.isSafeInteger(recordId) && recordId > 0) {
            option.dataset.studentId = String(recordId);
          }
          select.add(option);
        });

        loadedSchool = values.SchoolCode;
        setBusy(false);

        notify(
          seen.size
            ? "اختاري الطالبة من القائمة."
            : "لا توجد طالبات متاحات لهذه العملية."
        );
      });
    });

    get("nm-submit").addEventListener("click", function () {
      if (busy || !mode) return;

      const values = credentials();
      if (!values) return;

      const currentMode = mode;
      const StudentKey = select.value;
      const StudentName = name.value.trim();

      if (mode !== "add" &&
          (!StudentKey || loadedSchool !== values.SchoolCode)) {
        notify(
          "حمّلي قائمة الطالبات لهذه المدرسة واختاري الطالبة.",
          true
        );
        return;
      }

      if (mode !== "archive" &&
          (StudentName.length < 3 || StudentName.length > 120)) {
        notify("أدخلي اسمًا بين 3 و120 حرفًا.", true);
        name.focus();
        return;
      }

      if (mode === "archive" && !confirmation.checked) {
        notify("ضعي علامة تأكيد أرشفة الطالبة المحددة.", true);
        return;
      }

      const data = { ...values };

      if (mode !== "add") data.StudentKey = StudentKey;
      if (mode !== "archive") data.StudentName = StudentName;
      if (mode === "edit") {
        const StudentId = select.selectedOptions[0]?.dataset.studentId || "";
        if (!/^[1-9][0-9]*$/.test(StudentId) || !Number.isSafeInteger(Number(StudentId))) {
          notify("أعيدي تحميل قائمة الطالبات لتحديد رقم السجل قبل التعديل.", true);
          return;
        }
        data.StudentId = StudentId;
      }

      post(URLS[mode], data, true, function (result) {
        const message = String(
          field(result, "Message") || {
            add: "تمت إضافة الطالبة.",
            edit: "تم تعديل الاسم.",
            archive: "تمت أرشفة الطالبة مع الاحتفاظ بنتائجها."
          }[currentMode]
        );

        close();
        notify(message);
        refresh.click();
      });
    });

    [secret, name].forEach(function (input) {
      input.addEventListener("keydown", function (event) {
        if (event.key !== "Enter") return;

        event.preventDefault();
        event.stopPropagation();

        get(
          input === secret && mode !== "add"
            ? "nm-load"
            : "nm-submit"
        ).click();
      });
    });

    close();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      window.setTimeout(init, 0);
    }, { once: true });
  } else {
    window.setTimeout(init, 0);
  }
})();

/* استيراد PDF: قراءة محلية، معاينة قابلة للتحرير، ثم إضافة متتابعة عبر التدفق الحالي. */
(function () {
  "use strict";
  const PDF_VERSION = "5.6.205";
  const ADD_URL = "/_api/cloudflow/v1.0/trigger/6d274259-3dd1-f111-a05a-000d3ab579b0";
  const LIST_URL = "/_api/cloudflow/v1.0/trigger/aff48928-c6d2-f111-a05a-7ced8d458a2d";
  const normalized = name => String(name || "").normalize("NFKC").replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "").replace(/\s+/g, " ").trim();
  const nameKey = name => normalized(name).replace(/[\u064b-\u065f\u0670\u0640]/g, "");
  const validName = name => name.length >= 3 && name.length <= 120 && /[\u0621-\u064a]/.test(name) && !/[<>\u0000-\u001f]/.test(name);
  const truth = value => value === true || String(value).trim().toLowerCase() === "true";
  function unwrap(value) {
    for (let i=0; i<8; i++) {
      if (typeof value === "string") { value=JSON.parse(value); continue; }
      if (!value || typeof value !== "object") break;
      if ("success" in value || "Success" in value) return value;
      if (value.response !== undefined) {value=value.response;continue;}
      if (value.body !== undefined) {value=value.body;continue;}
      break;
    }
    throw new Error("INVALID_RESPONSE");
  }
  function field(value, key) {return value[key.toLowerCase()] !== undefined ? value[key.toLowerCase()] : value[key];}

  // بعض تقارير نظام نور تتضمن ToUnicode فارغًا مع خط TrueType مضمّن.
  // تُعاد خريطة الحروف من الخط الموجود في الملف نفسه، دون تخمين الأسماء.
  function glyphUnicode(fontBytes) {
    const bytes=fontBytes instanceof Uint8Array ? fontBytes : new Uint8Array(fontBytes);
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    const u16=o=>view.getUint16(o), u32=o=>view.getUint32(o);
    if (bytes.length<12) return new Map();
    let cmap=-1;
    const count=u16(4);
    if (12+count*16>bytes.length) throw new Error("INVALID_FONT");
    for(let i=0;i<count;i++) {
      const p=12+i*16;
      const tag=String.fromCharCode(...bytes.slice(p,p+4));
      if(tag==="cmap") cmap=u32(p+8);
    }
    if(cmap<0||cmap+4>bytes.length) return new Map();
    const tables=u16(cmap+2), map=new Map();
    function add(code,gid) {
      if(!gid||code>0x10ffff||code>=0xd800&&code<=0xdfff) return;
      let value=String.fromCodePoint(code).normalize("NFKC");
      // النص في هذه الخطوط يُخزّن بترتيب بصري؛ فكّ الرباط قبل bidi يتطلب
      // إبقاء أحرف الرباط بالترتيب البصري نفسه (لا، الله، ونحوها).
      if(value.length>1 && /^[\u0600-\u06ff]+$/.test(value)) value=Array.from(value).reverse().join("");
      if(!map.has(gid)||/[\u0600-\u06ff]/.test(value)) map.set(gid,value);
    }
    for(let i=0;i<tables;i++) {
      const e=cmap+4+i*8;
      if(e+8>bytes.length) break;
      const platform=u16(e),encoding=u16(e+2);
      if(platform!==0 && !(platform===3&&(encoding===1||encoding===10))) continue;
      const p=cmap+u32(e+4);if(p+4>bytes.length)continue;
      const format=u16(p);
      if(format===4) {
        const limit=p+u16(p+2);if(limit>bytes.length)continue;
        const n=u16(p+6)/2,end=p+14,start=end+2*n+2,delta=start+2*n,offset=delta+2*n;
        if(offset+2*n>limit)continue;
        for(let seg=0;seg<n;seg++) {
          const a=u16(start+2*seg),b=u16(end+2*seg),d=u16(delta+2*seg),r=u16(offset+2*seg);
          if(a>b||a===0xffff)continue;
          for(let code=a;code<=b&&code<0xffff;code++) {
            let gid;
            if(r===0)gid=(code+d)&0xffff;
            else {const q=offset+2*seg+r+2*(code-a);if(q+2>limit)continue;gid=u16(q);if(gid)gid=(gid+d)&0xffff;}
            add(code,gid);
          }
        }
      } else if(format===12 && p+16<=bytes.length) {
        const n=u32(p+12);if(n>100000||p+16+12*n>bytes.length)continue;
        for(let j=0;j<n;j++) {
          const q=p+16+j*12,a=u32(q),b=u32(q+4),first=u32(q+8);
          if(b<a||b-a>200000)continue;
          for(let c=a;c<=b;c++)add(c,first+c-a);
        }
      }
    }
    return map;
  }
  function unicodeHex(value) {
    return Array.from({length:value.length},(_,i)=>value.charCodeAt(i).toString(16).padStart(4,"0")).join("").toUpperCase();
  }
  async function repairArabicPdf(data, lib) {
    const doc=await lib.PDFDocument.load(data,{updateMetadata:false});
    const N=lib.PDFName.of, seen=new Set();let repaired=0;
    for(const page of doc.getPages()) {
      const resources=page.node.Resources();if(!resources)continue;
      const fonts=resources.lookup(N("Font"),lib.PDFDict);if(!fonts)continue;
      for(const [,ref] of fonts.entries()) {
        const font=doc.context.lookup(ref);if(!font||seen.has(font))continue;seen.add(font);
        const toUnicode=font.lookup(N("ToUnicode"));
        if(toUnicode) {
          const content=new TextDecoder().decode(lib.decodePDFRawStream(toUnicode).decode());
          if(/\b[1-9]\d*\s+beginbf(?:char|range)\b/.test(content))continue;
        }
        const descendants=font.lookup(N("DescendantFonts"));if(!descendants||descendants.size()===0)continue;
        const child=descendants.lookup(0,lib.PDFDict),descriptor=child.lookup(N("FontDescriptor"),lib.PDFDict);
        if(!descriptor)continue;
        const stream=descriptor.lookup(N("FontFile2"));if(!stream)continue;
        const glyphs=glyphUnicode(lib.decodePDFRawStream(stream).decode());
        if(!Array.from(glyphs.values()).some(s=>/[\u0600-\u06ff]/.test(s)))continue;
        const cidMap=child.lookup(N("CIDToGIDMap")),pairs=[];
        if(cidMap && !(cidMap instanceof lib.PDFName)) {
          const raw=lib.decodePDFRawStream(cidMap).decode(),v=new DataView(raw.buffer,raw.byteOffset,raw.byteLength);
          for(let cid=0;cid*2+1<raw.length&&cid<=65535;cid++){const value=glyphs.get(v.getUint16(cid*2));if(value)pairs.push([cid,value]);}
        }else{
          if(cidMap && cidMap.asString()!=="/Identity")continue;
          glyphs.forEach((value,gid)=>{if(gid<=65535)pairs.push([gid,value]);});
        }
        if(!pairs.length)continue;
        let cmap="/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /NafisUnicode def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n";
        for(let i=0;i<pairs.length;i+=100){const block=pairs.slice(i,i+100);cmap+=block.length+" beginbfchar\n"+block.map(([cid,value])=>"<"+cid.toString(16).padStart(4,"0")+"> <"+unicodeHex(value)+">").join("\n")+"\nendbfchar\n";}
        cmap+="endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n";
        font.set(N("ToUnicode"),doc.context.register(doc.context.stream(cmap)));repaired++;
      }
    }
    return {data:repaired?await doc.save({useObjectStreams:false}):data,repaired};
  }
  function namesFromItems(items,width) {
    const rows=[];
    for(const item of items) {
      if(!item.str||!item.transform)continue;
      const y=item.transform[5];let row=rows.find(r=>Math.abs(r.y-y)<=2.5);
      if(!row){row={y,items:[]};rows.push(row);}row.items.push(item);
    }
    rows.sort((a,b)=>b.y-a.y);
    const names=[];
    for(const row of rows) {
      const number=row.items.find(x=>/^[0-9٠-٩۰-۹]{1,4}$/.test(x.str.trim())&&x.transform[4]>width*.8);
      if(!number)continue;
      const parts=row.items.filter(x=>x.transform[4]>width*.45&&x.transform[4]<number.transform[4]-4&&/[\u0621-\u064a]/.test(x.str)).sort((a,b)=>b.transform[4]-a.transform[4]);
      const name=normalized(parts.map(x=>x.str).join(" "));
      if(validName(name)&&name.split(" ").length>=2)names.push(name);
    }
    return names;
  }
  function classify(names, existing) {
    const seen=new Set(), known=new Set(existing.map(nameKey));
    return names.map(input=>{
      const name=normalized(input),key=nameKey(name);let status="جاهزة";
      if(!validName(name))status="راجعي الاسم";
      else if(known.has(key))status="موجودة مسبقًا";
      else if(seen.has(key))status="مكررة في الملف";
      seen.add(key);return {name,status,selected:status==="جاهزة"};
    });
  }
  if(typeof module==="object"&&module.exports){module.exports={glyphUnicode,repairArabicPdf,namesFromItems,classify,normalized,nameKey,validName};return;}

  let libraryPromise;
  function loadScript(url,globalName) {
    if(window[globalName])return Promise.resolve(window[globalName]);
    return new Promise((resolve,reject)=>{
      const script=document.createElement("script");script.src=url;script.crossOrigin="anonymous";
      const timer=setTimeout(()=>reject(new Error("LIBRARY_TIMEOUT")),30000);
      script.onload=()=>{clearTimeout(timer);window[globalName]?resolve(window[globalName]):reject(new Error("LIBRARY_LOAD"));};
      script.onerror=()=>{clearTimeout(timer);reject(new Error("LIBRARY_LOAD"));};document.head.append(script);
    });
  }
  function libraries() {
    if(!libraryPromise)libraryPromise=loadScript("/nafis-pdf-reader.js", "NafisPdfReader")
      .then(reader=>{
        if(!reader.pdfjs || !reader.pdflib || reader.pdfjs.version!==PDF_VERSION) throw new Error("LIBRARY_LOAD");
        return reader;
      }).catch(error=>{libraryPromise=null;throw error;});
    return libraryPromise;
  }
  function init() {
    const root=document.getElementById("nafis-teacher");if(!root||root.querySelector("#nt-pdf-import"))return;
    const dashboard=root.querySelector("#nt-dashboard"),management=root.querySelector("#nt-management");
    if(!dashboard)return;
    const card=document.createElement("section");card.id="nt-pdf-import";card.className="nt-card";
    card.innerHTML=`<h2>إضافة طالبات من PDF</h2>
      <p>ارفعي كشف الأسماء، وراجعي الأسماء قبل إضافتها إلى المدرسة الحالية. لا يُحفظ ملف PDF نفسه في SharePoint.</p>
      <button type="button" id="ni-open">استيراد طالبات من PDF</button>
      <div id="ni-panel" hidden>
        <p id="ni-school" class="nt-note"></p>
        <label for="ni-file">كشف الطالبات PDF</label><input id="ni-file" type="file" accept="application/pdf,.pdf">
        <p class="nt-muted">يدعم كشوف الأسماء النصية المشابهة للنموذج، حتى 20 صفحة و15 ميجابايت. الملفات المصورة تحتاج استخراجًا بصريًا؛ يمكنك لصق أسمائها بعد مراجعتها.</p>
        <button type="button" id="ni-read" class="nt-secondary">استخراج الأسماء للمعاينة</button>
        <label for="ni-text">أو الصقي الأسماء، كل طالبة في سطر</label><textarea id="ni-text" rows="5" style="width:100%;font:inherit;padding:10px"></textarea>
        <button type="button" id="ni-preview" class="nt-secondary">معاينة الأسماء المكتوبة</button>
        <p id="ni-count" role="status"></p>
        <div class="nt-table-wrap"><table><thead><tr><th>إضافة</th><th>اسم الطالبة — قابل للتعديل</th><th>الحالة</th></tr></thead><tbody id="ni-rows"></tbody></table></div>
        <label for="ni-secret">رمز المعلمة لتأكيد الإضافة</label><input id="ni-secret" type="password" autocomplete="off" maxlength="64" dir="ltr">
        <label><input id="ni-confirm" type="checkbox" style="width:auto"> راجعت الأسماء وأؤكد إضافتها إلى المدرسة الموضحة أعلاه.</label>
        <div class="nt-actions"><button type="button" id="ni-save">إضافة الأسماء المحددة</button><button type="button" id="ni-stop" class="nt-secondary" disabled>إيقاف بعد الطالبة الحالية</button><button type="button" id="ni-close" class="nt-secondary">إغلاق</button></div>
      </div><p id="ni-status" role="status" aria-live="polite"></p>`;
    if(management)management.after(card);else dashboard.append(card);
    const $=id=>card.querySelector("#"+id), schoolInput=root.querySelector("#nt-code");
    let rows=[],busy=false,stop=false,generation=0,schoolCode="",schoolTitle="";
    function note(message,error){$("ni-status").textContent=message;$("ni-status").style.color=error?"#b42318":"#15704a";}
    function panel(value){$("ni-panel").hidden=!value;$("ni-panel").style.setProperty("display",value?"block":"none","important");}
    function setBusy(value){busy=value;card.setAttribute("aria-busy",String(value));card.querySelectorAll("input,textarea,button").forEach(n=>{n.disabled=value||n.dataset.locked==="true";});$("ni-stop").disabled=!value;}
    function current(){return !dashboard.hidden&&schoolInput.value.trim()===schoolCode;}
    function render(){
      $("ni-rows").replaceChildren();
      rows.forEach(row=>{
        const tr=document.createElement("tr"),choose=document.createElement("input"),input=document.createElement("input"),status=document.createElement("td");
        choose.type="checkbox";choose.checked=row.selected;choose.style.width="auto";choose.disabled=row.status!=="جاهزة";choose.dataset.locked=String(choose.disabled);
        choose.onchange=()=>{row.selected=choose.checked;count();};input.type="text";input.value=row.name;input.maxLength=120;
        input.onchange=()=>{row.name=normalized(input.value);row.status=validName(row.name)?"جاهزة":"راجعي الاسم";row.selected=row.status==="جاهزة";$("ni-confirm").checked=false;render();};
        if(row.status==="تمت الإضافة"){input.disabled=true;input.dataset.locked="true";}
        status.textContent=row.status;row.statusNode=status;const a=document.createElement("td"),b=document.createElement("td");a.append(choose);b.append(input);tr.append(a,b,status);$("ni-rows").append(tr);
      });count();
    }
    function count(){ $("ni-count").textContent="عدد الأسماء: "+rows.length+" — المحدد للإضافة: "+rows.filter(r=>r.selected&&r.status==="جاهزة").length; }
    function post(url,data){return new Promise((resolve,reject)=>{
      if(!window.shell||typeof window.shell.ajaxSafePost!=="function"){reject(new Error("CONNECTION"));return;}
      let done=false,activeRequest;const listing=url===LIST_URL;
      const timer=setTimeout(()=>{if(!done){done=true;if(listing)activeRequest?.abort?.();reject(new Error("UNCERTAIN"));}},listing?1800000:115000);
      try{activeRequest=window.NafisTeacherPaging.post({type:"POST",url,timeout:110000,nafisScope:"students",data:{eventData:JSON.stringify(data)}}).done(value=>{if(done)return;done=true;clearTimeout(timer);try{resolve(unwrap(value));}catch(error){reject(new Error("UNCERTAIN"));}}).fail(()=>{if(done)return;done=true;clearTimeout(timer);reject(new Error("UNCERTAIN"));});}
      catch(error){if(!done){done=true;clearTimeout(timer);reject(new Error("CONNECTION"));}}
    });}
    $("ni-open").onclick=()=>{
      schoolCode=schoolInput.value.trim();schoolTitle=root.querySelector("#nt-school").textContent;
      $("ni-school").textContent="ستُضاف الأسماء إلى: "+schoolTitle+" — "+schoolCode+". اسم المدرسة داخل PDF لا يغيّر المدرسة المختارة.";panel(true);note("");
    };
    $("ni-close").onclick=()=>{if(busy)return;generation++;rows=[];render();$("ni-file").value="";$("ni-text").value="";$("ni-secret").value="";$("ni-confirm").checked=false;panel(false);note("");};
    $("ni-stop").onclick=()=>{stop=true;note("سيتوقف الاستيراد بعد اكتمال الطلب الحالي.");};
    root.querySelector("#nt-logout").addEventListener("click",()=>{generation++;stop=true;$("ni-secret").value="";$("ni-text").value="";$("ni-file").value="";rows=[];render();panel(false);},true);
    $("ni-preview").onclick=()=>{
      if(!current()){note("أعيدي فتح الاستيراد من المدرسة الحالية.",true);return;}
      const names=$("ni-text").value.split(/\r?\n/).map(normalized).filter(Boolean);
      if(!names.length||names.length>500){note("أدخلي من اسم واحد إلى 500 اسم في كل عملية.",true);return;}
      rows=classify(names,[]);$("ni-confirm").checked=false;render();note("راجعي الأسماء. سيتم فحص الموجود مسبقًا مجددًا قبل أي إضافة.");
    };
    $("ni-read").onclick=async()=>{
      const file=$("ni-file").files[0];if(!current()){note("أعيدي فتح الاستيراد من المدرسة الحالية.",true);return;}
      if(!file||!file.name.toLowerCase().endsWith(".pdf")||file.size>15*1024*1024){note("اختاري ملف PDF حتى 15 ميجابايت.",true);return;}
      const token=++generation;setBusy(true);note("جارٍ قراءة كشف الأسماء…");let documentTask;
      try{
        const {pdfjs,pdflib}=await libraries();const input=new Uint8Array(await file.arrayBuffer());
        const repaired=await repairArabicPdf(input,pdflib);
        if(token!==generation)return;
        documentTask=pdfjs.getDocument({data:repaired.data,isEvalSupported:false,useWasm:false,useSystemFonts:true});const doc=await documentTask.promise;
        if(doc.numPages>20)throw new Error("TOO_MANY_PAGES");
        const names=[];
        for(let pageNumber=1;pageNumber<=doc.numPages;pageNumber++){
          if(token!==generation)return;
          note("قراءة الصفحة "+pageNumber+" من "+doc.numPages+"…");
          const page=await doc.getPage(pageNumber),content=await page.getTextContent();
          names.push(...namesFromItems(content.items,page.getViewport({scale:1}).width));page.cleanup();
        }
        if(!names.length)throw new Error("NO_NAMES");if(names.length>500)throw new Error("TOO_MANY_NAMES");
        if(token!==generation||!current())return;
        rows=classify(names,[]);$("ni-text").value=names.join("\n");$("ni-confirm").checked=false;render();note("استخراج "+names.length+" اسمًا للمعاينة فقط. راجعيها ثم أكدي الإضافة.");
      }catch(error){
        if(token===generation){rows=[];render();note(["LIBRARY_LOAD","LIBRARY_TIMEOUT"].includes(error.message)?"تعذر تحميل قارئ PDF من داخل الموقع. تأكدي من رفع ملف nafis-pdf-reader.js في ملفات الويب بالمسار الصحيح ثم اعملي المزامنة.":error.message==="NO_NAMES"?"لم أستطع استخراج أسماء مؤكدة من هذا التنسيق. قد يكون الملف صورة؛ الصقي الأسماء بعد استخراجها ومراجعتها.":error.message==="TOO_MANY_PAGES"?"قسّمي الملف إلى أجزاء، كل جزء حتى 20 صفحة.":error.message==="TOO_MANY_NAMES"?"قسّمي الأسماء إلى دفعات، كل دفعة حتى 500 اسم.":"تعذرت قراءة PDF. قد يكون محميًا أو تعذر تحميل قارئ PDF؛ يمكنك لصق الأسماء للمعاينة.",true);}
      }finally{if(documentTask)try{await documentTask.destroy();}catch(error){}if(token===generation)setBusy(false);else if(dashboard.hidden)setBusy(false);}
    };
    $("ni-save").onclick=async()=>{
      if(busy||!current())return;
      const TeacherCode=$("ni-secret").value.trim();
      if(!TeacherCode||!$("ni-confirm").checked){note("أدخلي رمز المعلمة وضعي علامة تأكيد مراجعة الأسماء.",true);return;}
      const chosen=rows.filter(r=>r.selected&&r.status==="جاهزة");if(!chosen.length){note("حددي الأسماء المطلوبة أولًا.",true);return;}
      const token=++generation,SchoolCode=schoolCode;stop=false;setBusy(true);note("جارٍ التحقق من المدرسة والأسماء الموجودة…");let saved=0,skipped=0,rejected=0,pending=null;
      try{
        const list=await post(LIST_URL,{SchoolCode,TeacherCode});
        if(token!==generation||!current())return;
        if(!truth(field(list,"Success")))throw new Error("AUTH");
        let existing=field(list,"StudentsJson");existing=typeof existing==="string"?JSON.parse(existing):existing;
        if(!Array.isArray(existing)||(existing.length>=5000&&field(list,"NafisComplete")!==true))throw new Error("ROSTER_LIMIT");
        const known=new Set(existing.map(s=>nameKey(s.StudentName)));
        for(const row of chosen){
          if(stop||token!==generation||!current())break;
          const key=nameKey(row.name);
          if(!validName(row.name)){row.status="راجعي الاسم";row.selected=false;skipped++;render();continue;}
          if(known.has(key)){row.status="موجودة أو مكررة";row.selected=false;skipped++;render();continue;}
          pending=row;row.status="جارٍ الإضافة";render();setBusy(true);
          const response=await post(ADD_URL,{SchoolCode,TeacherCode,StudentName:row.name});
          if(token!==generation)return;
          row.status=truth(field(response,"Success"))?"تمت الإضافة":"رفضت الخدمة: "+String(field(response,"Message")||"راجعي البيانات");
          row.selected=false;if(truth(field(response,"Success"))){saved++;known.add(key);}else{rejected++;stop=true;}
          pending=null;render();setBusy(true);note("تمت إضافة "+saved+" — مستبعدة موجودة/مكررة: "+skipped+" — مرفوضة: "+rejected);
        }
        if(token===generation){note("انتهت الدفعة: أضيفت "+saved+"، واستُبعدت "+skipped+" موجودة/مكررة، ورفضت الخدمة "+rejected+(stop?". توقفت العملية؛ راجعي الحالات قبل المتابعة.":"."),rejected>0);}
      }catch(error){
        if(token===generation){if(pending){pending.status="تحتاج تحققًا من الحفظ";pending.selected=false;render();}
          note(error.message==="AUTH"?"لم يتم التحقق من رمز المعلمة؛ لم تبدأ الإضافة.":error.message==="ROSTER_LIMIT"?"تعذر فحص قائمة الطالبات كاملة؛ لم تبدأ الإضافة.":"توقفت العملية. قد يكون آخر طلب حُفظ دون وصول التأكيد. حدّثي القائمة وتحققي من الاسم قبل إعادة إضافته؛ لا توجد إعادة محاولة تلقائية.",true);}
      }finally{
        $("ni-secret").value="";$("ni-confirm").checked=false;setBusy(false);
        if(saved&&token===generation&&current())root.querySelector("#nt-refresh").click();
      }
    };
    panel(false);
  }
  if(typeof document!=="undefined"){
    if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>setTimeout(init,0),{once:true});else setTimeout(init,0);
  }
})();


/* يُضاف أسفل كود لوحة المعلمة الحالي: تنسيق المعاينة والطباعة فقط. */
(function () {
  "use strict";
  const escape = value => String(value == null ? "" : value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  function number(value) {
    const normalized=String(value||"").replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-1776)).replace(/٫/g,".");
    return /^\s*\d+(?:\.\d+)?\s*$/.test(normalized)?Number(normalized):null;
  }
  function score(value) {
    const match=String(value||"").match(/([0-9٠-٩۰-۹]+)\s+إجابة صحيحة من\s*30/);
    const result=match?number(match[1]):null;
    return result!==null&&result>=0&&result<=30?result:null;
  }
  function readReport(detail) {
    const tables=detail.querySelectorAll("table");
    if(tables.length<2)throw new Error("REPORT_NOT_READY");
    const people=Array.from(tables[0].querySelectorAll("tbody tr")).filter(row=>row.cells.length>=4).map(row=>({
      name:row.cells[0].textContent.trim(),pre:score(row.cells[1].textContent),post:score(row.cells[2].textContent),
      legacy:row.cells[1].textContent.includes("نتيجة قديمة مجمّعة")||row.cells[2].textContent.includes("نتيجة قديمة مجمّعة"),
      training:row.cells[4]?row.cells[4].textContent.trim():"—"
    }));
    const domains=new Map(),skills=[];
    for(const row of tables[1].querySelectorAll("tbody tr")) {
      if(row.cells.length<4)continue;
      const count=number(row.cells[1].textContent),correct=number(row.cells[2].textContent);
      if(count===null||correct===null||count<=0||correct<0||correct>count)continue;
      const domain=(row.cells[0].querySelector("strong")||row.cells[0]).textContent.trim();
      const standard=row.cells[0].querySelector(".nt-muted");
      const skill=standard?standard.textContent.trim():domain;
      if(!domains.has(domain))domains.set(domain,{name:domain,count:0,correct:0});
      const aggregate=domains.get(domain);aggregate.count+=count;aggregate.correct+=correct;
      skills.push({domain,name:skill,count,correct});
    }
    const meta=Array.from(detail.children).filter(n=>n.tagName==="P").slice(0,3).map(n=>n.textContent.trim());
    return {school:detail.querySelector("h2")?.textContent.trim()||"المدرسة",meta,people,domains:Array.from(domains.values()),
      priorities:skills.filter(s=>s.correct<s.count).sort((a,b)=>a.correct/a.count-b.correct/b.count||a.name.localeCompare(b.name,"ar")).slice(0,5),
      mode:detail.querySelector("h3")?.textContent.trim()||"المجالات والمهارات"};
  }
  const pct=value=>(Math.round(value*10)/10).toLocaleString("ar-SA",{maximumFractionDigits:1});
  function printMarkup(report) {
    if(!report.people.length)throw new Error("EMPTY_REPORT");
    const pages=[];
    const scoreCell=value=>value===null?'<span class="muted">غير مكتمل</span>':'<b>'+value+'/30</b><small>'+pct(value/30*100)+'٪</small>';
    for(let offset=0;offset<report.people.length;offset+=25){
      const people=report.people.slice(offset,offset+25);
      const rows=people.map(p=>{
        const gain=p.pre!==null&&p.post!==null?(p.post-p.pre)/30*100:null;
        return '<tr><td>'+escape(p.name)+(p.legacy?' <span class="muted">*</span>':'')+'</td><td>'+scoreCell(p.pre)+'</td><td>'+scoreCell(p.post)+'</td><td class="'+(gain>0?'positive':gain<0?'negative':'')+'" dir="ltr">'+(gain===null?'—':(gain>0?'+':'')+pct(gain))+'</td><td>'+escape(p.training)+'</td></tr>';
      }).join("");
      const domainRows=report.domains.map(d=>'<tr><td>'+escape(d.name)+'</td><td>'+d.correct+'/'+d.count+'</td><td>'+pct(d.correct/d.count*100)+'٪</td></tr>').join("");
      const priorities=report.priorities.map(s=>'<li>'+escape(s.name)+' <span class="muted">('+pct(s.correct/s.count*100)+'٪)</span></li>').join("");
      pages.push('<section class="page"><header><div class="brand">مختبر نافس 360</div><h1>'+escape(report.school)+'</h1><p>'+report.meta.map(escape).join(' · ')+'</p></header>'+
        '<div class="columns '+(report.people.length===1?'individual':'')+'"><section><h2>نتائج '+(report.people.length===1?'الطالبة':'الطالبات')+'</h2><table class="students"><thead><tr><th>الطالبة</th><th>القبلي</th><th>البعدي</th><th>التغير</th><th>التدريب</th></tr></thead><tbody>'+rows+'</tbody></table></section>'+
        '<section><h2>'+escape(report.mode)+' — ملخص المجالات</h2><table><thead><tr><th>المجال</th><th>الصحيحة/الإجابات</th><th>النسبة</th></tr></thead><tbody>'+(domainRows||'<tr><td colspan="3">لا توجد نتائج مكتملة لهذا القياس.</td></tr>')+'</tbody></table>'+
        (priorities?'<h2>مهارات تحتاج دعمًا — حسب النتائج المعروضة</h2><ol>'+priorities+'</ol>':'')+'</section></div>'+
        '<footer>التغير بالنقاط المئوية للطالبات اللاتي أكملن القياسين. التدريب متابعة إنجاز ولا يدخل في الدرجة. (*) نتيجة قديمة مجمّعة. الجلسات الناقصة لا تمثل صفرًا. تختلف صعوبة نماذج الأسئلة؛ لا يُفسَّر فرق الدرجات وحده بوصفه أثرًا سببيًا.<br>تفاصيل المهارات كاملة متاحة في لوحة المعلمة. إعداد وتصميم: بدرية محمد الزهراني · جزء '+(Math.floor(offset/25)+1)+' من '+Math.ceil(report.people.length/25)+'</footer></section>');
    }
    return '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>تقرير مختبر نافس 360</title><style>'+printStyles+'</style></head><body>'+pages.join('')+'</body></html>';
  }
  const printStyles=`
    @page{size:A4 portrait;margin:10mm}
    *{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#142b49;font-family:Tahoma,Arial,sans-serif;font-size:12px;line-height:1.5}
    .page{break-after:page}.page:last-child{break-after:auto}
    header{border-bottom:2px solid #b58a38;padding-bottom:8px;margin-bottom:10px}
    .brand{color:#8b6723;font-weight:bold;font-size:17px}h1{font-size:18px;margin:3px 0}header p{font-size:11px;margin:4px 0}
    h2{font-size:12px;margin:0 0 7px;color:#142b49}section>h2:not(:first-child){margin-top:15px}
    .columns{display:grid;grid-template-columns:1.4fr 1fr;gap:5mm;align-items:start}.columns.individual{display:block}.individual>section{margin-bottom:13px}
    table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:10.5px}th,td{padding:5px 4px;border:1px solid #d4dce6;text-align:right;vertical-align:top;overflow-wrap:anywhere}
    th{background:#eef2f7;font-weight:bold}tr{break-inside:avoid}thead{display:table-header-group}small{display:block;color:#526378;font-size:9px}.muted{color:#526378}
    .students th:first-child{width:30%}.students th:last-child{width:25%}.positive{color:#15704a}.negative{color:#b42318}
    ol{margin:0;padding-right:20px;font-size:11px}li{margin:0 0 6px;break-inside:avoid}footer{border-top:1px solid #b58a38;margin-top:12px;padding-top:7px;font-size:9px;color:#526378;break-inside:avoid}
    @media print{*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  `;
  if(typeof module==="object"&&module.exports){module.exports={readReport,printMarkup,score,number};return;}
  function init(){
    const root=document.getElementById("nafis-teacher");if(!root||root.dataset.reportLayoutFixed==="v2")return;
    const detail=root.querySelector("#nt-detail"),original=root.querySelector("#nt-print-button");if(!detail||!original)return;
    root.dataset.reportLayoutFixed="v2";
    const css=document.createElement("style");css.id="nt-report-layout-v2";css.textContent=`
      #nafis-teacher #nt-dialog{width:min(1100px,96vw)!important;max-width:1100px!important;max-height:90vh!important;padding:22px!important;font-family:Tahoma,Arial,sans-serif!important;line-height:1.6!important;direction:rtl!important}
      #nafis-teacher #nt-dialog h2{font-size:21px!important;line-height:1.5!important;margin:0 0 10px!important}
      #nafis-teacher #nt-dialog h3{font-size:17px!important;line-height:1.5!important;margin:18px 0 9px!important}
      #nafis-teacher #nt-dialog p{font-size:13px!important;line-height:1.6!important;margin:5px 0!important}
      #nafis-teacher #nt-dialog table{width:100%!important;table-layout:fixed!important;border-collapse:collapse!important;font-family:inherit!important;font-size:13px!important;margin:12px 0!important}
      #nafis-teacher #nt-dialog th,#nafis-teacher #nt-dialog td{padding:9px 7px!important;border:1px solid #d4dce6!important;white-space:normal!important;overflow-wrap:anywhere!important;vertical-align:top!important;min-width:0!important;line-height:1.6!important;font-size:13px!important}
      #nafis-teacher #nt-dialog th{background:#eef2f7!important;color:#142b49!important}
      #nafis-teacher #nt-dialog .nt-bar{min-width:0!important}
      #nafis-teacher #nt-dialog button{font-family:inherit!important;font-size:14px!important;padding:9px 16px!important}
    `;document.head.append(css);
    const button=original.cloneNode(true);button.removeAttribute("onclick");original.replaceWith(button);
    let printing=false;
    button.addEventListener("click",async event=>{
      event.preventDefault();event.stopImmediatePropagation();if(printing)return;
      printing=true;button.disabled=true;let frame;
      function release(){printing=false;button.disabled=false;}
      try{
        const report=readReport(detail),html=printMarkup(report);
        document.getElementById("nafis-report-print-frame")?.remove();
        document.getElementById("nafis-report-readable-frame")?.remove();
        frame=document.createElement("iframe");frame.id="nafis-report-readable-frame";frame.title="طباعة تقرير الطالبات";
        frame.style.cssText="position:fixed;width:210mm;height:297mm;left:-10000px;top:0;border:0";
        frame.addEventListener("load",async()=>{
          try{
            const win=frame.contentWindow;if(!win)throw new Error("PRINT_NOT_READY");
            if(win.document.fonts?.ready)await win.document.fonts.ready;
            await new Promise(resolve=>win.requestAnimationFrame(resolve));
            win.addEventListener("afterprint",()=>{release();setTimeout(()=>frame.remove(),500);},{once:true});
            win.focus();win.print();release();
          }catch(error){frame.remove();release();const message=root.querySelector("#nt-message");if(message){message.textContent="تعذر فتح الطباعة. أعيدي فتح معاينة التقرير ثم حاولي مجددًا.";message.hidden=false;message.style.setProperty("display","block","important");}}
        },{once:true});
        frame.srcdoc=html;document.body.append(frame);
      }catch(error){frame?.remove();release();const message=root.querySelector("#nt-message");if(message){message.textContent="افتحي تقريرًا يحتوي على نتائج قبل الطباعة.";message.hidden=false;message.style.setProperty("display","block","important");}}
    },true);
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>setTimeout(init,0),{once:true});else setTimeout(init,0);
})();


/* تنسيق صفحة المعلمة وحقول الإضافة؛ لا يغيّر بيانات الطالبات أو التدفقات. */
(function () {
  "use strict";
  if(typeof document === "undefined") return;
  function initTeacherSpacing() {
    const root=document.getElementById("nafis-teacher");
    if(!root||document.getElementById("nt-page-spacing-v1"))return;
    const style=document.createElement("style");style.id="nt-page-spacing-v1";
    style.textContent=`
      #nafis-teacher{margin-top:0!important;padding-top:8px!important;font-size:15px!important;line-height:1.65!important}
      #nafis-teacher .nt-wrap>header{padding-top:8px!important;padding-bottom:14px!important;margin-top:0!important}
      #nafis-teacher .nt-wrap>header h1{font-size:28px!important;line-height:1.4!important;margin:4px 0!important}
      #nafis-teacher .nt-wrap>header p{font-size:14px!important;margin:5px 0!important}
      #nafis-teacher .nt-wrap>header .nt-brand{font-size:20px!important}
      #nafis-teacher #nt-pdf-import{padding:18px!important;margin-bottom:16px!important}
      #nafis-teacher #nt-pdf-import h2,#nafis-teacher #nt-management h2{font-size:19px!important;line-height:1.5!important;margin:0 0 9px!important}
      #nafis-teacher #nt-pdf-import p,#nafis-teacher #nt-pdf-import label,#nafis-teacher #nt-management p,#nafis-teacher #nt-management label{font-size:14px!important;line-height:1.6!important;margin-top:7px!important;margin-bottom:7px!important}
      #nafis-teacher #ni-text{font-family:Tahoma,Arial,sans-serif!important;font-size:14px!important;line-height:1.7!important;padding:9px 11px!important;height:115px!important;min-height:90px!important;max-height:200px!important;resize:vertical!important;border:1px solid #c9d1dc!important;border-radius:9px!important;box-sizing:border-box!important}
      #nafis-teacher #ni-file{font-size:13px!important;padding:8px!important;max-width:100%!important}
      #nafis-teacher #ni-secret{display:block!important;width:100%!important;max-width:320px!important;font-size:14px!important;height:40px!important;min-height:0!important;padding:7px 10px!important;border:1px solid #c9d1dc!important;border-radius:8px!important;box-sizing:border-box!important}
      #nafis-teacher #nt-pdf-import button,#nafis-teacher #nt-management button{font-family:Tahoma,Arial,sans-serif!important;font-size:14px!important;line-height:1.5!important;padding:8px 14px!important;min-height:40px!important;height:auto!important;white-space:normal!important}
      #nafis-teacher #ni-panel .nt-actions{display:flex!important;flex-wrap:wrap!important;gap:8px!important;margin-top:12px!important}
      #nafis-teacher #ni-panel>label:has(#ni-confirm){display:flex!important;align-items:center!important;gap:8px!important;flex-wrap:wrap!important;font-weight:normal!important;font-size:13px!important}
      #nafis-teacher #ni-confirm,#nafis-teacher #ni-rows input[type=checkbox]{width:17px!important;height:17px!important;min-height:0!important;padding:0!important;flex:0 0 17px!important;margin:0!important}
      #nafis-teacher #ni-rows input[type=text],#nafis-teacher #nt-management input:not([type=checkbox]),#nafis-teacher #nt-management select{font-family:Tahoma,Arial,sans-serif!important;font-size:14px!important;line-height:1.5!important;padding:8px 10px!important;min-height:39px!important;height:auto!important;box-sizing:border-box!important}
      #nafis-teacher #ni-rows td,#nafis-teacher #ni-rows th,#nafis-teacher #ni-panel table th{font-size:13px!important;padding:7px 8px!important;white-space:normal!important;min-width:0!important}
      #nafis-teacher #ni-count,#nafis-teacher #ni-status{font-size:13px!important;line-height:1.6!important}
      main:has(#nafis-teacher),#mainContent:has(#nafis-teacher),.page-copy:has(#nafis-teacher),.sectionBlockLayout:has(#nafis-teacher),.columnBlockLayout:has(#nafis-teacher){margin-top:0!important;padding-top:0!important}
      @media(max-width:600px){#nafis-teacher #nt-pdf-import{padding:13px!important}#nafis-teacher #ni-panel .nt-actions button{flex:1 1 140px!important}#nafis-teacher .nt-wrap>header h1{font-size:24px!important}}
    `;
    document.head.append(style);
    // إزالة المسافات من حاويات المحتوى المعروفة فقط؛ لا نغيّر رأس الموقع.
    const boundary=root.closest("main")||root.closest("#mainContent");
    if(boundary){
      for(let parent=root.parentElement;parent;parent=parent.parentElement){
        if(parent.matches(".container,.sectionBlockLayout,.columnBlockLayout,.page-copy,#mainContent,main")){
          parent.style.setProperty("padding-top","0","important");
          parent.style.setProperty("margin-top","0","important");
        }
        if(parent===boundary)break;
      }
      boundary.querySelectorAll(".sectionBlockLayout").forEach(block=>{
        if(block.contains(root)||root.contains(block)||!(block.compareDocumentPosition(root)&Node.DOCUMENT_POSITION_FOLLOWING))return;
        const meaningful=block.textContent.replace(/[\s\u200b\ufeff]/g,"");
        if(meaningful||block.querySelector("img,svg,video,audio,iframe,canvas,input,button,select,textarea,a,[role=button]"))return;
        if(window.getComputedStyle(block).backgroundImage!=="none")return;
        block.style.setProperty("display","none","important");
      });
    }
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>setTimeout(initTeacherSpacing,0),{once:true});else setTimeout(initTeacherSpacing,0);
})();
