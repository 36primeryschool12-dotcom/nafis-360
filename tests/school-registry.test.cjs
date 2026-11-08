const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../assets/school-registry.js"), "utf8");
const school = { name: "مدرسة اختبار", office: "إدارة التعليم التجريبية", status: "active" };

function open(storage = new Map(), project = "nafis-demo", options = {}) {
  let next = 0;
  const window = {
    navigator: { locks: options.locks },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem(key, value) {
        if (options.readOnly) throw Error("storage-denied");
        storage.set(key, value);
      }
    },
    crypto: { getRandomValues: bytes => bytes.fill(next++) }
  };
  const document = { currentScript: { src: `https://example.test/${project}/assets/school-registry.js` } };
  vm.runInNewContext(source, { window, document, URL });
  return window.NafisSchoolRegistry;
}

test("starts empty, generates distinct eight-character codes and persists in the same project", async () => {
  const storage = new Map();
  const registry = open(storage);
  assert.equal(registry.read().length, 0);
  const first = await registry.save(school);
  const second = await registry.save({ ...school, name: "مدرسة ثانية" });
  assert.match(first.code, /^[A-Z2-9]{8}$/);
  assert.notEqual(first.code, second.code);
  const reloaded = open(storage);
  assert.equal(reloaded.read().length, 2);
  assert.equal(reloaded.read()[0].code, first.code);
  assert.equal(open(storage, "another-project").read().length, 0);
});

test("rejects duplicate schools and invalid edits, preserves the original code and updates status", async () => {
  const registry = open();
  const first = await registry.save(school);
  await assert.rejects(registry.save({ ...school, name: "  مدرسة   اختبار " }), /duplicate-school/);
  assert.throws(() => registry.save({ ...school, name: " " }), /invalid-school/);
  const second = await registry.save({ ...school, name: "مدرسة ثانية" });
  await assert.rejects(registry.save(school, second.code), /duplicate-school/);
  const edited = await registry.save({ ...school, name: "مدرسة بعد التعديل" }, first.code);
  assert.equal(edited.code, first.code);
  assert.equal((await registry.toggle(first.code)).status, "inactive");
  assert.equal(registry.read()[0].status, "inactive");
});

test("leaves unreadable and unwritable storage unchanged and serializes concurrent writes when locks are present", async () => {
  const storage = new Map();
  const locked = open(storage, "nafis-demo", { locks: {
    tail: Promise.resolve(),
    request(key, task) {
      this.tail = this.tail.then(task);
      return this.tail;
    }
  } });
  await Promise.all([locked.save(school), locked.save({ ...school, name: "مدرسة ثانية" })]);
  assert.equal(locked.read().length, 2);
  await assert.rejects(open(storage, "nafis-demo", { readOnly: true }).save({ ...school, name: "ثالثة" }), /storage-denied/);
  assert.equal(locked.read().length, 2);
  storage.set(locked.key, "corrupted");
  await assert.rejects(locked.save(school), /SyntaxError|not valid JSON|Unexpected token/);
  assert.equal(storage.get(locked.key), "corrupted");
});
