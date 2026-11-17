// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { functionSpans } from '../src/functions.mjs';

/** `name(params)` of every function found. @param {string} code */
const found = (code) => functionSpans(code).map((f) => `${f.name}(${f.params.join(',')})`);
/** The body text of the function called `name`. @param {string} code @param {string} name */
const bodyOf = (code, name) => {
  const span = functionSpans(code).find((f) => f.name === name);
  return span ? code.slice(span.bodyStart, span.end) : null;
};

test('declarations, assigned functions and arrows, and methods are found with their parameters', () => {
  const code = [
    'class Repo {',
    '  static async load(id: string): Promise<User> {',
    '    return get(id);',
    '  }',
    '  get name() {',
    '    return this.n;',
    '  }',
    '}',
    'function plain(a, b) {',
    '  return a + b;',
    '}',
    'const arrow = async (x) => {',
    '  return x;',
    '};',
    'const typed = (x: number): Promise<number> => {',
    '  return Promise.resolve(x);',
    '};',
    'export function* walk(tree) {',
    '  yield tree;',
    '}',
    'const expression = (x) => x * 2;',
  ].join('\n');
  assert.deepEqual(found(code), ['load(id)', 'name()', 'plain(a,b)', 'arrow(x)', 'typed(x)', 'walk(tree)']);
});

test('an object type as the return type is not the body', () => {
  const declared = 'export function parsePrice(input: string): { ok: boolean; cents: number } {\n  if (!input) return null;\n  return { ok: true, cents: 1 };\n}';
  assert.deepEqual(found(declared), ['parsePrice(input)']);
  assert.match(bodyOf(declared, 'parsePrice') ?? '', /^\{\n {2}if \(!input\) return null;/);
  const arrow = 'export const parsePrice = (input: string): { ok: boolean } => {\n  return { ok: true };\n};';
  assert.match(bodyOf(arrow, 'parsePrice') ?? '', /^\{\n {2}return \{ ok: true \};/);
  const union = 'function load(id: string):\n  | { ok: true; user: User }\n  | { ok: false } {\n  return find(id);\n}';
  assert.match(bodyOf(union, 'load') ?? '', /^\{\n {2}return find\(id\);/);
});

test('other return types still lead to the body', () => {
  for (const type of ['Promise<{ ok: boolean }>', 'x is string', '(y: number) => void', 'Map<string, Array<() => void>>', "'a' | 'b'", 'T extends string ? A : B', 'ns.Result[]']) {
    const code = `function check(x: unknown): ${type} {\n  return run(x);\n}`;
    assert.match(bodyOf(code, 'check') ?? '', /^\{\n {2}return run\(x\);/, type);
  }
  const allman = 'function check(x: unknown): boolean\n{\n  return run(x);\n}';
  assert.match(bodyOf(allman, 'check') ?? '', /^\{\n {2}return run\(x\);/);
});

test('a call is not a function, whatever follows it', () => {
  const condition = 'export function couponPercent(code, cart) {\n  if (\n    isBlank(code) ||\n    cart.items.length === 0\n  ) {\n    return cart.defaultPercent ?? 0;\n  }\n  return COUPONS[code];\n}';
  assert.deepEqual(found(condition), ['couponPercent(code,cart)']);
  const callback = 'router.get(\n  async (req, res) => {\n    res.json(1);\n  },\n);';
  assert.deepEqual(found(callback), []);
  const suite = "describe('cart', () => {\n  it('adds', () => {\n    expect(1).toBe(1);\n  });\n});";
  assert.deepEqual(found(suite), []);
});

test('code without semicolons keeps each function its own name and body', () => {
  const code = "const base = (process.env.API_URL || '').trim()\nexport const getUser = async (id, opts) => {\n  return id\n}";
  assert.deepEqual(found(code), ['getUser(id,opts)']);
  const member = 'interface Repo {\n  find(id: string): Promise<User | null>\n}\nexport async function loadUser(id: string) {\n  return id\n}';
  assert.deepEqual(found(member), ['loadUser(id)']);
});

test('a signature without a body is not a function', () => {
  const code = 'abstract class Base {\n  abstract load(id: string): Promise<User>;\n  find(id: string): User;\n  find(id: number): User;\n  find(id: any) {\n    return get(id);\n  }\n}\ndeclare function fetchAll(): Promise<void>;';
  assert.deepEqual(found(code), ['find(id)']);
});

test('nested type parameters do not hide the function', () => {
  const code = 'export function pick<T extends Record<string, unknown>>(obj: T, key: string) {\n  return obj[key];\n}\nconst wrap = <T extends Array<number>>(list: T) => {\n  return list;\n};';
  assert.deepEqual(found(code), ['pick(obj,key)', 'wrap(list)']);
});

test('a conditional return type wrapped over lines still leads to the body', () => {
  const code = 'export function pick<T>(value: T): T extends string\n  ? StringResult\n  : OtherResult {\n  return run(value);\n}\n';
  assert.deepEqual(found(code), ['pick(value)']);
  assert.match(bodyOf(code, 'pick') ?? '', /^\{\n {2}return run\(value\);/);
});

test('an arrow with one bare parameter, a class field, a property and the default export are functions too', () => {
  const code = [
    'export const handler = async event => {',
    '  return event.body;',
    '};',
    'const double = x => {',
    '  return x * 2;',
    '};',
    'class Orders {',
    '  #load(id: string) {',
    '    return this.repo.find(id);',
    '  }',
    '  private refresh = async (id: string) => {',
    '    return this.repo.find(id);',
    '  };',
    '  onEvent: Handler = async event => {',
    '    return event;',
    '  };',
    '}',
    'exports.run = async (event) => {',
    '  return event;',
    '};',
    'module.exports = function (req, res) {',
    '  res.end();',
    '};',
    'export default async function (req, res) {',
    '  res.end();',
    '}',
  ].join('\n');
  assert.deepEqual(found(code), ['handler(event)', 'double(x)', '#load(id)', 'refresh(id)', 'onEvent(event)', 'run(event)', 'exports(req,res)', 'default(req,res)']);
  assert.equal(bodyOf(code, 'double'), '{\n  return x * 2;\n}');
  assert.deepEqual(found('export default (props) => {\n  return props;\n};'), ['default(props)']);
});

test('an assignment that only looks like a function is left out', () => {
  const code = [
    'const total = (a + b) * 2;',
    'obj.value = (x);',
    "const isReady = status === 'ready';",
    'interface Props {',
    '  onChange: (value: string) => void;',
    '}',
    'enum Flag {',
    '  A = (1 << 2),',
    '}',
    'const curried = a => b => a + b;',
    'export default connect(mapState)(Component);',
  ].join('\n');
  assert.deepEqual(found(code), []);
  const header = 'function run(\n  a,\n  cb = (x) => {\n    return x;\n  },\n) {\n  return cb(a);\n}';
  assert.deepEqual(functionSpans(header).map((f) => f.name), ['run'], 'a default value in a header is not a function of its own');
});

test('parameters keep their names through decorators, object types and a wrapped list', () => {
  assert.deepEqual(found("class C {\n  async list(@Query('limit') limit: number, @Body(new Pipe()) body: Dto) {\n    return limit;\n  }\n}"), ['list(limit,body)']);
  assert.deepEqual(found('export function total(items: { price: number; qty: number }[], coupon: string) {\n  return items;\n}'), ['total(items,coupon)']);
  assert.deepEqual(found('export function total(\n  items,\n  coupon,\n) {\n  return items;\n}'), ['total(items,coupon)']);
});

test('a type annotation never reaches into the next statement, and may still wrap over lines', () => {
  const typed = 'let cached: Map<string, User> | null\n\nexport const getUsers = async (ids: string[]) => {\n  return ids\n}';
  assert.deepEqual(found(typed), ['getUsers(ids)']);
  assert.deepEqual(found('let app: Express\nmodule.exports = (req, res) => {\n  return app(req, res)\n}'), ['exports(req,res)'], 'a property assigned below is a statement too');
  const wrapped = 'export const handler: Handler<\n  Event,\n  Result\n> = async (event) => {\n  return event;\n};';
  assert.deepEqual(found(wrapped), ['handler(event)']);
  // A member named like a keyword, and an import() type, open no statement.
  const member = "const reducer: Reducer<\n  State,\n  {\n    type: 'inc',\n    by: number,\n  }\n> = (state, action) => {\n  return apply(state, action.by);\n};";
  assert.deepEqual(found(member), ['reducer(state,action)']);
  const imported = "export const handler: import('aws-lambda').Handler<\n  import('aws-lambda').APIGatewayProxyEvent\n> = async (event) => {\n  return event;\n};";
  assert.deepEqual(found(imported), ['handler(event)']);
  // The last type of an intersection or a union alone on its line, or the whole type under the colon, assigns nothing.
  for (const annotation of ['Middleware<AppContext, AppState> &\n  Configurable', 'Middleware<AppContext> |\n  Configurable', '\n  GetServerSideProps']) {
    assert.deepEqual(found(`export const withAuth: ${annotation} = (ctx, next) => {\n  return next(ctx);\n};`), ['withAuth(ctx,next)'], annotation);
  }
});

test('a decorator whose argument nests calls still leaves the parameter its name', () => {
  const upload = [
    'class Files {',
    '  uploadFile(',
    '    @UploadedFile(new ParseFilePipe({ validators: [new MaxFileSizeValidator({ maxSize: 1000 })] })) file: Express.Multer.File,',
    '    @Body() body: UploadDto,',
    '  ) {',
    '    return this.files.save(file, body);',
    '  }',
    '}',
  ].join('\n');
  assert.deepEqual(found(upload), ['uploadFile(file,body)']);
});

test('a named function assigned to a property keeps its own name', () => {
  assert.deepEqual(found('module.exports = function tailwindPlugin(options) {\n  return options;\n};'), ['tailwindPlugin(options)']);
});

test('a long template literal does not make the reading quadratic', () => {
  // A prompt of a thousand lines: read in milliseconds, where it took seconds.
  const line = 'You are a careful assistant. Answer in one short paragraph and cite the file you read.\n';
  const prompt = 'export const PROMPT = `\n' + line.repeat(1000) + '`;\nexport function ask(question) {\n  return send(PROMPT + question);\n}\n';
  const started = Date.now();
  assert.deepEqual(found(prompt), ['ask(question)']);
  assert.ok(Date.now() - started < 1000, `took ${Date.now() - started} ms`);
});

test('a long comment under a typed declaration does not make the reading quadratic', () => {
  const comment = '// The cache is filled on the first request and never invalidated.\n'.repeat(6000);
  const code = `let cached: Cache\n${comment}warm(cached)\nexport function ask(question) {\n  return send(question);\n}\n`;
  const started = Date.now();
  assert.deepEqual(found(code), ['ask(question)']);
  assert.ok(Date.now() - started < 1000, `took ${Date.now() - started} ms`);
});
