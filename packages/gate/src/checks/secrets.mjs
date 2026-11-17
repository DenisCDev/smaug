// @ts-check
// Secrets never belong in code. Flags known key shapes, suspicious literal
// assignments, and service_role exposure paths.
import { isClientModule } from './fetch-timeout.mjs';

// scheme://user:password@host, as agents paste it from a provider's dashboard.
const DB_SCHEME_RE = /\b(?:postgres(?:ql)?|postgis|mysql2?|mariadb|mongodb(?:\+srv)?|rediss?|amqps?|mssql|sqlserver)(?:\+\w+)?:\/\//gi;
// An `@` inside an expression is the separator of the URL unless a language
// writes one there. Ruby names its instance variables with it, after an
// opening bracket or a comma (`#{@config.host}`, `#{escape(@secret)}`).
// Elsewhere it is the index of a shell array (`${HOSTS[@]}`) or opens a
// PowerShell array (`$(@($hosts)[0])`).
const RUBY_AT = String.raw`(?<=[{(\[,])@`;
const OTHER_AT = String.raw`(?<=\[)@(?=\])|(?<=\()@(?=\()`;
// The inside of a brace or a parenthesis that is one expression: no space, an
// `@` only as above, a quote only around a string of its own
// (`ENV['DB_USER']`) and a bracket of its kind only as a pair that holds the
// same, two levels deep (`get("DB_HOST")`, `${A:-${B:-c}}`). Anything else is
// a bracket of the password that the text around the URL, or a later
// expression of it, closes further on. `plain` is every other character the
// expression of a language may hold.
const NESTED_PAIRS = 2;
const inside = (/** @type {string} */ open, /** @type {string} */ close, /** @type {string} */ at, plain = String.raw`[^${open}${close}\s@'"\x60]`) => {
  const piece = String.raw`${plain}|${at}|'[^'${close}\s]{0,200}'|"[^"${close}\s]{0,200}"|\x60[^\x60${close}\s]{0,200}\x60`;
  let pieces = piece;
  for (let level = 0; level < NESTED_PAIRS; level++) pieces = `${piece}|\\${open}(?:${pieces}){0,200}\\${close}`;
  return `(?:${pieces}){1,200}`;
};
// A Ruby interpolation holds no slash and no colon in front of a digit outside
// a string: the path or the port of a URL there makes it a brace of the
// password that the text after the URL closes.
const RUBY_PLAIN = String.raw`[^{}/:\s@'"\x60]|:(?!\d)`;
// What a URL holds as one piece wherever it stands: ${USER:-app}, $($env:USER),
// #{@config.host}, %env(urlencode:USER)%, {{ .Values.user }}, $env:USER. The
// colons and at signs inside it separate nothing. A space right behind a
// brace (`${ user }`, `#{ user }`, `{ user }`) is one more sign of it, since
// no URL holds a space.
const expressionRe = (/** @type {string} */ rubyAt, /** @type {string} */ otherAt) =>
  new RegExp(String.raw`\{\{[^{}\n]{1,200}\}\}|[$#]?\{[ \t][^{}\n]{0,200}\}|#\{${inside('{', '}', rubyAt, RUBY_PLAIN)}\}|\{${inside('{', '}', otherAt)}\}|\(${inside('(', ')', otherAt)}\)|\$(?:env|script|global|local|private|using):\w+`, 'y');
const URL_EXPRESSION_RE = expressionRe(RUBY_AT, OTHER_AT);
// The same with no `@` inside any expression: how an authority is read again
// when its password would otherwise never end, because the only `@` after
// the user's colon stands in what looks like an interpolation.
const NO_AT_EXPRESSION_RE = expressionRe('(?!)', '(?!)');
// The two below read a copy of the authority where \x01 stands for each
// character of an expression. A host name, with a `#` only in front of an
// expression that is no Ruby interpolation by the rules above (`#{n/2}`), and
// its port, digits or an expression. The port takes no `#`: after a user with
// an `@` of its own, `#(…)` and a sign would read as a port and hide a password.
const HOST = String.raw`(?:#(?=\x01)|[\w.\x01$%-])+`;
const PORT = String.raw`(?::(?:\d{1,5}|[\x01$%][\w\x01$%]*))?`;
// A host and then a property or a query:
// `server:1433;database=app;user=sa@server;password=…` as SQL Server writes
// its URL, `mq.acme.io:5672?heartbeat=30&owner=ops@acme.io`. From there on
// the authority holds no credentials, whatever `@` comes later.
const PROPERTIES_RE = new RegExp(String.raw`${HOST}${PORT}[;?#][^;?#&=@]*=`, 'y');
// A host and its port, and then the end of the authority or of the host: the
// rest of `user@host:5432?sslmode=require`, whose first colon is no password's.
const HOST_ALONE_RE = new RegExp(String.raw`${HOST}${PORT}(?=$|[?#,;)\]}>|&\\])`, 'y');
// A password holds a few at signs at most. Past that many, only the last is read.
const MAX_SEPARATORS = 8;

/**
 * Where the text of a host ends, from `from` in the copy of the authority: at
 * the next `@`, at its port, the query or the fragment and, outside its own
 * brackets, at a list or a shell sign and at a bracket that closes one opened
 * before the host (`(…@db.acme.io)`). A bracket the host opens itself belongs
 * to it with what it holds, as in the placeholders of
 * `aws-0-[region].pooler.supabase.com` and `db-<staging|prod>.acme.io`. A
 * brace or a parenthesis of its own also holds the colon and the question
 * mark: an expression or an address this reader could not take as one piece,
 * for a default nested deep or a template with a space inside
 * (`${A:-${B:-${C:-${D:-db}}}}`, `tcp({{ .Values.host }}:3306)`), while the
 * `[:port]` of a manual still ends the host. The `#` in front of an
 * expression belongs to the host (`db-#{n/2}.acme.io`), and so does the `\`
 * in front of one or of its parenthesis, when a space inside cut the
 * interpolation short (`\(host)`, `\(config.host ?? "db")`).
 * @param {string} masked @param {number} from
 */
function hostEnd(masked, from) {
  // The brackets the host opened and has not closed, and the braces and parentheses among them.
  let open = 0;
  let holding = 0;
  for (let i = from; i < masked.length; i++) {
    const c = masked[i];
    const next = masked[i + 1];
    if ('([{<'.includes(c)) {
      open++;
      if ('({'.includes(c)) holding++;
    } else if (')]}>'.includes(c)) {
      if (open === 0) return i;
      open--;
      if (')}'.includes(c) && holding > 0) holding--;
    } else if (c === '@' || (holding === 0 && ':?'.includes(c))
      || (open === 0 && (',;|&'.includes(c) || (c === '#' && next !== '\x01') || (c === '\\' && next !== '\x01' && next !== '(')))) return i;
  }
  return masked.length;
}

/**
 * The authority that starts at `start`, to the first space, quote or slash
 * outside an expression, with \x01 for each character of an expression.
 * @param {string} line @param {number} start @param {RegExp} expressionPattern
 */
function authority(line, start, expressionPattern) {
  let masked = '';
  for (let i = start; i < line.length && !/[\s'"\x60/]/.test(line[i]); i = start + masked.length) {
    expressionPattern.lastIndex = i;
    const expression = expressionPattern.exec(line);
    masked += expression ? '\x01'.repeat(expression[0].length) : line[i];
  }
  return masked;
}

/**
 * The ways each database URL of a line may hold credentials, in the order to
 * try them. The authority runs to the first `/` and the user to its first
 * `:`. No parser agrees with another on where a password with an `@` ends
 * (`P@ssw0rd`, `P@ss#w0rd`), so every `@` after the colon is one reading, up
 * to the one that a host with a property or a query follows
 * (`…@host:5432?application_name=jobs@worker`). An expression counts as one
 * piece. One regular expression could not hold this.
 * @param {string} line
 * @returns {{ user: string, password: string, host: string }[][]} the readings of each URL
 */
function databaseUrls(line) {
  /** @type {ReturnType<typeof databaseUrls>} */
  const urls = [];
  for (const m of line.matchAll(DB_SCHEME_RE)) {
    const start = m.index + m[0].length;
    let masked = authority(line, start, URL_EXPRESSION_RE);
    // A colon and no `@` after it: the one an expression holds may be the separator.
    if (masked.includes(':') && !masked.includes('@', masked.indexOf(':'))) masked = authority(line, start, NO_AT_EXPRESSION_RE);
    const colon = masked.indexOf(':');
    PROPERTIES_RE.lastIndex = 0;
    // No `:`, or a host that opens the authority: nothing that could be a password.
    if (colon < 0 || PROPERTIES_RE.test(masked)) continue;
    // Nor when an `@` before the first colon has a host behind it: that colon
    // is the port's. An `@` right after an opening bracket or a comma ends no
    // user: it stands inside an expression this reader took apart (a C#
    // `{@user}`, a PowerShell `$(@{…}.user)`).
    let userOnly = false;
    for (let i = masked.indexOf('@'); i >= 0 && i < colon && !userOnly; i = masked.indexOf('@', i + 1)) {
      HOST_ALONE_RE.lastIndex = i + 1;
      userOnly = !'{([,'.includes(masked[i - 1] ?? ' ') && HOST_ALONE_RE.test(masked);
    }
    if (userOnly) continue;
    const raw = line.slice(start, start + masked.length);
    /** @type {number[]} */
    const ats = [];
    for (let i = masked.indexOf('@', colon); i >= 0; i = masked.indexOf('@', i + 1)) ats.push(i);
    /** @type {ReturnType<typeof databaseUrls>[number]} */
    const readings = [];
    for (const at of ats.length > MAX_SEPARATORS ? [...ats.slice(0, MAX_SEPARATORS - 1), ats[ats.length - 1]] : ats) {
      const end = hostEnd(masked, at + 1);
      // Text that runs into another `@` is a piece of the password, not a host.
      readings.push({ user: raw.slice(0, colon), password: raw.slice(colon + 1, at), host: masked[end] === '@' ? '' : raw.slice(at + 1, end) });
      PROPERTIES_RE.lastIndex = at + 1;
      if (PROPERTIES_RE.test(masked)) break;
    }
    if (readings.length > 0) urls.push(readings);
  }
  return urls;
}
// A password the language or the tool around it fills in, read from its whole
// shape: one bracket, brace or dollar inside a real password makes it no
// placeholder. A variable ($VAR, $env:VAR, compose's $$VAR) is an environment
// name, digits wherever, or a name that opens in lowercase.
const VARIABLE_PASSWORD_RE = /^\$\$?(?:[A-Z_][A-Z0-9_]*|[a-z_][A-Za-z0-9_]*|[Ee]nv:[A-Za-z_]\w*)$/;
// A capitalized name is a variable too ($SqlPass, $config[key]) where the
// language itself reads $Name as one. Anywhere else it is how people write a
// password ($Summer2024).
const DOLLAR_NAME_FILE_RE = /\.(?:sh|bash|ps1|ya?ml|php|kts?|dart)$|(?:^|\/)(?:Dockerfile|Containerfile)(?:\.[\w.-]+)?$/;
const DOLLAR_NAME_RE = /^\$\$?(?:(?:script|global|local|private|using|env):)?[A-Za-z_]\w*(?:\[\w+\])?$/i;
// An expression: $(…) of a shell, Make, Azure Pipelines, Kubernetes or
// PowerShell, $[…] of Azure Pipelines, \(…) of Swift. No password is written
// that way: the wrapping would be part of it.
const EXPRESSION_PASSWORD_RE = /^[$\\]\(.+\)$|^\$\[.+\]$/;
// Interpolations with nothing but punctuation around them: {name},
// {quote_plus(name)}, #{…}, %{…}, {{.Values.x}}, #{Name}#, {user}-{pass}. A
// letter or a digit outside the braces is a piece of a real password.
const INTERPOLATED_PASSWORD_RE = /^(?:[^A-Za-z0-9{}]*\{+[^{}]+\}+)+[^A-Za-z0-9{}]*$/;
// The same cut at an `@` right after a bracket: nothing, or interpolations,
// and then the bracket that opens one more (`{prefix}{@secret}` in C#,
// `#{salt}#{@pw.gsub(/\s/,'')}` in Ruby). The `@` belongs to that last one.
const UNFINISHED_INTERPOLATION_RE = /^(?:[^A-Za-z0-9{}]*\{+[^{}]+\}+)*[^A-Za-z0-9{}()]*[{(]$/;
// [YOUR-PASSWORD], %VAR%, %env(VAR)% or __VAR__ as the whole password (inside
// one, %C3%A7 is an encoded character); and, wherever they stand, ****, %s,
// %[1]s, %(name)s or the word itself, `senha` included.
const TEMPLATE_PASSWORD_RE = /^\[[^\]]+\]$|^%[A-Za-z_][\w.:()-]*%$|^__[A-Za-z]\w*__$|\*{3,}|%(?:\[\d+\])?[sv]|%\([^)]+\)s|pass(?:word|wd)|senha/i;

// A host is wrapped two or three layers deep: tcp(…) around a default around a default.
const MAX_LAYERS = 8;

/** An address without its port: the text before its last colon outside braces and parentheses. @param {string} address */
function withoutPort(address) {
  let depth = 0;
  for (let i = address.length - 1; i >= 0; i--) {
    if ('})'.includes(address[i])) depth++;
    else if ('{('.includes(address[i])) depth--;
    else if (address[i] === ':' && depth === 0) return address.slice(0, i);
  }
  return address;
}

/** Whether the brace that opens at `open` closes at the very end of the text. @param {string} text @param {number} open */
function closesAtTheEnd(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return i === text.length - 1;
  }
  return false;
}

/**
 * The name a host is reached by, out of what may wrap it, one layer after the
 * other: the address in `tcp(db:3306)`, as Go writes a MySQL host, and the
 * word a shell or compose puts in a variable's place (`${DB_HOST:-db}`,
 * `${DB_HOST:=db}`, `${PROXY:+proxy}`, compose's `$${…}`), each without its
 * port and the word without its quotes. The word may hold variables of its
 * own (`${DB_HOST:-db.${REGION}.internal}`). The message of
 * `${DB_HOST:?not set}` names nothing: the variable stands alone there.
 * Without its colon that form is a ternary to JavaScript, and is left as
 * written.
 * @param {string} host
 */
function hostName(host) {
  let name = host;
  // Each layer reads the whole text once: past a few of them it is judged as it stands.
  for (let layer = 0; layer < MAX_LAYERS; layer++) {
    const address = /^\w+\((.*)\)$/.exec(name)?.[1];
    const expansion = address === undefined ? /^\$\$?\{\w+(:\?|:?[-=+])/.exec(name) : null;
    if (address === undefined && (!expansion || !closesAtTheEnd(name, name.indexOf('{')))) break;
    if (expansion?.[1] === ':?') return '';
    name = withoutPort(address ?? name.slice(expansion?.[0].length, -1).replace(/^(['"])(.*)\1$/, '$2'));
  }
  return name;
}

/**
 * Only a remote host: a compose service name, loopback and private addresses
 * are local setups, where a default password in the URL leaks nothing. The
 * text decides, so a name with no dot is local (`db`, `$DB_HOST`) and one
 * built with a dot in it is not known to be (`${config.db.host}`,
 * `db.${STAGE}.acme.io`). What opens with a parenthesis is the group of a
 * pattern that describes URLs, not a name, and a socket path is no host.
 * @param {string} host
 */
function isRemoteHost(host) {
  // What cannot end a name is not part of it: the dot of a sentence, emphasis
  // marks. Cut in a loop: a pattern anchored at the end is tried from every
  // sign of a long run of them.
  let end = host.length;
  while (end > 0 && !/[\w\])}]/.test(host[end - 1])) end--;
  const h = hostName(host.slice(0, end).toLowerCase());
  if (!h.includes('.') || h.startsWith('(') || h.startsWith('/')) return false;
  if (/^(?:127\.|0\.0\.0\.0$|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(h)) return false;
  return !/(?:^|\.)(?:localhost|local|internal|test|example|invalid)$|(?:^|\.)example\.(?:com|org|net)$/.test(h);
}

/**
 * Whether one reading of a URL leaves a password for a remote host in the
 * file. A reading whose password the language fills in ends the search: a
 * real password does not open with a whole interpolation. Once a reading
 * holds a literal one, the longer readings after it hold it too, whatever
 * else they gather.
 * @param {ReturnType<typeof databaseUrls>[number]} readings @param {string} path
 */
function leaksDatabasePassword(readings, path) {
  let literal = false;
  for (const [index, { user, password, host }] of readings.entries()) {
    if (!literal) {
      // Cut inside an interpolation: no password of its own when a later reading holds it whole.
      if (index < readings.length - 1 && UNFINISHED_INTERPOLATION_RE.test(password)) continue;
      const filledElsewhere = PLACEHOLDER_RE.test(password) || VARIABLE_PASSWORD_RE.test(password) || EXPRESSION_PASSWORD_RE.test(password)
        || INTERPOLATED_PASSWORD_RE.test(password) || TEMPLATE_PASSWORD_RE.test(password) || (DOLLAR_NAME_FILE_RE.test(path) && DOLLAR_NAME_RE.test(password));
      if (filledElsewhere) return false;
      literal = password.length >= 8 && password.toLowerCase() !== user.toLowerCase();
    }
    if (literal && isRemoteHost(host)) return true;
  }
  return false;
}

/** @type {{ re: RegExp, msg: string, decodes?: boolean }[]} */
const KEY_PATTERNS = [
  { re: /-----BEGIN[A-Z ]*PRIVATE KEY-----/, msg: 'private key block committed to code' },
  { re: /\bAKIA[0-9A-Z]{16}\b/, msg: 'AWS access key id in code' },
  { re: /\bAIza[0-9A-Za-z_-]{35}\b/, msg: 'Google API key in code' },
  { re: /\bsk-[A-Za-z0-9_-]{20,}\b/, msg: 'OpenAI-style secret key in code' },
  { re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/, msg: 'GitHub token in code' },
  { re: /\bgithub_pat_\w{60,}/, msg: 'GitHub fine-grained token in code' },
  // Real Slack tokens carry 10–13 digit team and user ids (configuration tokens a
  // 100+ character body); test fixtures such as xoxb-1234-5678 do not.
  { re: /\bxox[abposr]-\d{10,13}-\d{10,13}|\bxoxe\.xox[bp]-\d-[A-Za-z0-9]{100,}/, msg: 'Slack token in code' },
  { re: /\b[rs]k_(?:live|test)_[A-Za-z0-9]{20,}\b/, msg: 'Stripe key in code' },
  { re: /\bwhsec_([A-Za-z0-9+/=]{24,})/, msg: 'webhook signing secret (whsec_, as Stripe and Standard Webhooks issue) in code — anyone holding it can forge events', decodes: true },
  { re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/, msg: 'JWT hardcoded — load it from env instead' },
  { re: /\bsb_secret_[A-Za-z0-9]+/, msg: 'Supabase secret key in code — load it from env; never ship sb_secret_ to the client' },
];

// `:=` is Go's short declaration.
const ASSIGN_RE = /\b(?:secret|password|passwd|token|api[_-]?key|apikey|private[_-]?key|service[_-]?role)[a-z0-9_]*\s*(?::=|[:=])\s*["'`]([^"'`\n]{16,})["'`]/i;
const PLACEHOLDER_RE = /process\.env|import\.meta|example|placeholder|your[-_]|xxx+|todo|change[-_]?me|replace[-_]?me|redacted|dummy|sample|\$\{|[<>]/i;
const SECRET_SHAPE_RE = /^[A-Za-z0-9+/_.=-]{16,}$/;

// Source and infrastructure files of any stack: a key has the same shape in
// every language. Prose is left out, where keys are examples.
const CODE_EXT_RE = /\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts|json|ya?ml|toml|sql|py|go|rs|rb|php|java|kt|kts|cs|swift|dart|sh|bash|ps1|astro|vue|svelte|tf|tfvars|prisma)$|(?:^|\/)(?:Dockerfile|Containerfile)(?:\.[\w.-]+)?$/;
const ENV_EXAMPLE_RE = /\.env\.(?:example|sample|template|dist)$/;

export default {
  name: 'secrets',
  /** @param {string} path */
  appliesTo(path) {
    return CODE_EXT_RE.test(path) || ENV_EXAMPLE_RE.test(path);
  },
  /** @param {{ path: string, content: string, lines: string[] }} ctx */
  run({ path, content, lines }) {
    const violations = [];
    const isEnvExample = ENV_EXAMPLE_RE.test(path);
    const isClientCode = isClientModule(content);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (isEnvExample) {
        // `export` in front, as a file meant to be sourced has it.
        const m = line.match(/^\s*(?:export\s+)?[A-Z0-9_]+\s*=\s*(.+)\s*$/);
        const value = m ? m[1].replace(/^["']|["']$/g, '') : '';
        if (
          value.length >= 24 && SECRET_SHAPE_RE.test(value) &&
          /\d/.test(value) && !PLACEHOLDER_RE.test(value)
        ) {
          violations.push({ line: i + 1, message: 'value in .env.example looks like a real secret — use a placeholder' });
        } else if (databaseUrls(line).some((url) => leaksDatabasePassword(url, path))) {
          // Every URL of the line, whatever the line is: a password in a
          // second URL or in a commented-out one is as readable as any.
          violations.push({ line: i + 1, message: 'database URL in an example env file carries a real password — use a placeholder' });
        }
        continue;
      }

      let keyHit = false;
      for (const { re, msg, decodes } of KEY_PATTERNS) {
        const hit = re.exec(line);
        if (!hit) continue;
        // A real one is random bytes; one that decodes to readable words is a documented
        // placeholder — Supabase's self-host compose ships "This is an example of a shorter Base64 string".
        if (decodes && /^[\x20-\x7E]* [\x20-\x7E]*$/.test(Buffer.from(hit[1], 'base64').toString('latin1'))) continue;
        violations.push({ line: i + 1, message: msg });
        keyHit = true;
        break;
      }
      // Every URL of the line: a local one must not hide the remote one that follows it.
      if (!keyHit && databaseUrls(line).some((url) => leaksDatabasePassword(url, path))) {
        violations.push({ line: i + 1, message: 'database URL with its password in code — whoever reads the repository connects as that user; load the URL from env' });
        keyHit = true;
      }

      const assign = line.match(ASSIGN_RE);
      if (assign) {
        const value = assign[1];
        if (
          !PLACEHOLDER_RE.test(value) && SECRET_SHAPE_RE.test(value) &&
          (/\d/.test(value) || value.length >= 24)
        ) {
          violations.push({ line: i + 1, message: 'secret-looking literal assigned in code — load it from env' });
        }
      }

      if (/\bNEXT_PUBLIC_[A-Z0-9_]*SERVICE_ROLE/.test(line)) {
        violations.push({ line: i + 1, message: 'service_role behind NEXT_PUBLIC_* ships the admin key to the browser' });
      } else if (isClientCode && /SERVICE_ROLE/i.test(line)) {
        violations.push({ line: i + 1, message: 'service_role referenced in a "use client" file — server-only code paths' });
      }

      if (!keyHit) {
        if (/\bNEXT_PUBLIC_[A-Z0-9_]*\b/.test(line) && /\bsb_secret_/.test(line)) {
          violations.push({ line: i + 1, message: 'sb_secret_ behind NEXT_PUBLIC_* ships the admin key to the browser' }); // smugan-ignore secrets: rule message documents the detected secret pattern
        } else if (isClientCode && /\bsb_secret_/.test(line)) {
          violations.push({ line: i + 1, message: 'sb_secret_ referenced in a "use client" file — server-only code paths' });
        }
      }
    }
    return violations;
  },
};
