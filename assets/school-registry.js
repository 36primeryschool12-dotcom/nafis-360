(() => {
  "use strict";

  const key = `nafis360:new-schools:v1:${new URL("../", document.currentScript.src).pathname}`;
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const codePattern = new RegExp(`^[${alphabet}]{8}$`);
  const field = value => typeof value === "string" ? value.trim().replace(/\s+/gu, " ") : "";
  const identity = value => field(value).normalize("NFKC").toLocaleLowerCase("ar");
  const sameSchool = (a, b) => identity(a.name) === identity(b.name) &&
    identity(a.office) === identity(b.office);
  const validStatus = status => status === "active" || status === "inactive";

  function read() {
    const records = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    if (!Array.isArray(records) || records.some(record =>
      !record || typeof record.code !== "string" || !codePattern.test(record.code) ||
      !field(record.name) || !field(record.office) || !validStatus(record.status)
    ) || new Set(records.map(record => record.code)).size !== records.length) {
      throw new Error("invalid-storage");
    }
    return records;
  }

  function newCode(records) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const bytes = window.crypto.getRandomValues(new Uint8Array(8));
      const code = Array.from(bytes, value => alphabet[value % alphabet.length]).join("");
      if (!records.some(record => record.code === code)) return code;
    }
    throw new Error("code-generation");
  }

  async function change(update) {
    const commit = () => {
      const records = read();
      const result = update(records);
      window.localStorage.setItem(key, JSON.stringify(records));
      return result;
    };
    return window.navigator.locks
      ? window.navigator.locks.request(key, commit)
      : commit();
  }

  function save(input, code) {
    const school = { name: field(input.name), office: field(input.office), status: input.status };
    if (!school.name || !school.office || school.name.length > 120 ||
        school.office.length > 120 || !validStatus(school.status)) {
      throw new Error("invalid-school");
    }
    return change(records => {
      const index = code ? records.findIndex(record => record.code === code) : -1;
      if (code && index < 0) throw new Error("missing-school");
      if (records.some((record, position) => position !== index && sameSchool(record, school))) {
        throw new Error("duplicate-school");
      }

      const result = { ...school, code: code || newCode(records) };
      if (index < 0) records.push(result);
      else records[index] = result;
      return result;
    });
  }

  function toggle(code) {
    return change(records => {
      const school = records.find(record => record.code === code);
      if (!school) throw new Error("missing-school");
      school.status = school.status === "active" ? "inactive" : "active";
      return school;
    });
  }

  window.NafisSchoolRegistry = { key, read, save, toggle };
})();
