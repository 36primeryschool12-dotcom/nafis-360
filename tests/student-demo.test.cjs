const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function element() {
  const handlers = new Map();
  return {
    children: [],
    textContent: '',
    hidden: false,
    classList: { toggle() {} },
    addEventListener(event, handler) { handlers.set(event, handler); },
    emit(event) { handlers.get(event)(); },
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); },
    replaceChildren() { this.children = []; },
    focus() {}
  };
}

function openDemo(mode) {
  const page = read(`${mode}/index.html`);
  const elements = new Map(Array.from(page.matchAll(/\bid="([^"]+)"/g),
    ([, id]) => [id, element()]));
  const get = (id) => elements.get(id);
  const document = {
    body: { dataset: { mode: page.match(/<body data-mode="([^"]+)"/)?.[1] } },
    getElementById: get,
    createElement: element,
    createTextNode: (text) => text
  };
  const context = vm.createContext({ document, window: {} });
  for (const [, script] of page.matchAll(/<script src="\.\.\/([^"]+)"/g)) {
    vm.runInContext(read(script), context);
  }
  const select = (index) => get('options').children[index].children[0].emit('change');
  const click = (id) => get(id).emit('click');
  click('start');
  return { get, select, click, bank: context.window.NAFIS_DEMO_QUESTIONS };
}

test('home links resolve and each demo loads shared assets', () => {
  const home = read('index.html');
  for (const stage of ['pre', 'training', 'post']) {
    assert.ok(home.includes(`href="./${stage}/"`));
    const page = read(`${stage}/index.html`);
    for (const file of ['demo.css', 'questions-demo.js', 'pre-demo.js']) {
      assert.ok(page.includes(`../assets/${file}`));
      assert.ok(read(`assets/${file}`).length > 0);
    }
  }
});

test('pre demo has 30 valid questions and requires every answer before scoring', () => {
  const { get, select, click, bank } = openDemo('pre');
  const counts = new Map();
  for (const question of bank) {
    assert.equal(question.options.length, 4);
    assert.ok(Number.isInteger(question.correct) && question.correct >= 0 && question.correct < 4);
    counts.set(question.domain, (counts.get(question.domain) || 0) + 1);
  }
  assert.deepEqual([...counts.values()], [10, 10, 10]);
  assert.equal(new Set(bank.map((question) => question.id)).size, 30);

  for (let index = 0; index < 30; index++) click('next');
  assert.match(get('status').textContent, /يرجى إكمال/);
  assert.equal(get('question').textContent, bank[0].text);

  select(bank[0].correct);
  click('next');
  click('previous');
  assert.equal(get('options').children[bank[0].correct].children[0].checked, true);
  assert.equal(get('status').textContent, '');
  for (const [index, question] of bank.entries()) {
    select(index === 0 ? (question.correct + 1) % 4 : question.correct);
    click('next');
  }
  assert.equal(get('score').textContent, '29 من 30');
  assert.equal(get('domains').children.length, 3);
  click('restart');
  assert.equal(get('progress').value, 0);
});

test('training provides feedback and post reorders questions without giving hints', () => {
  const training = openDemo('training');
  const { correct, options } = training.bank[0];
  training.select((correct + 1) % 4);
  assert.ok(training.get('status').textContent.includes(options[correct]));
  training.select(correct);
  assert.match(training.get('status').textContent, /إجابة صحيحة/);
  training.click('next');
  assert.equal(training.get('status').textContent, '');

  const post = openDemo('post');
  const ordered = [0, 10, 20].flatMap((offset) =>
    Array.from(post.bank.slice(offset, offset + 10)).reverse());
  for (const question of ordered) {
    assert.equal(post.get('question').textContent, question.text);
    post.select(question.correct);
    assert.equal(post.get('status').textContent, '');
    post.click('next');
  }
  assert.equal(post.get('score').textContent, '30 من 30');
});
