// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, ofRule } from './helpers.mjs';

const R = 'secrets';

test('AWS access key id is flagged', () => {
  const v = ofRule(run('src/a.ts', 'const k = "AKIAABCDEFGHIJKLMNOP";'), R);
  assert.equal(v.length, 1);
  assert.match(v[0].message, /AWS/);
});

test('GitHub fine-grained, Slack and webhook signing secrets are flagged', () => {
  // Assembled at run time so secret scanners never see a whole token in this file.
  /** @type {[string, RegExp][]} */
  const cases = [
    ['github_pat_' + '11ABCDEFG0' + '123456789_'.repeat(2) + 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVW', /GitHub fine-grained/],
    ['xoxb-' + '123456789012-1234567890123-' + 'AbCdEfGhIjKlMnOpQrStUvWx', /Slack/],
    ['xoxe.xoxp-1-' + 'Mi0yLTEyMzQ1Njc4OTAx'.repeat(6), /Slack/],
    ['whsec_' + 'AbCdEfGhIjKlMnOpQrStUvWxYz012345', /webhook signing secret/],
  ];
  for (const [token, message] of cases) {
    const v = ofRule(run('src/a.ts', `const t = "${token}";`), R);
    assert.equal(v.length, 1, String(message));
    assert.match(v[0].message, message);
  }
  assert.equal(ofRule(run('deploy/bot.yaml', 'botToken: "xoxb-REPLACE-WITH-BOT-TOKEN"'), R).length, 0);
});

test('test fixtures and documented examples shaped like those tokens pass', () => {
  for (const code of [
    'expect(redact("token xoxb-' + '1234-5678-abcdefgh leaked")).toBe("token [redacted] leaked");',
    '{ bot_token: "xoxb-' + '0000-0000-fakefakefake" }',
    // Supabase's self-host docker-compose example: base64 of an English sentence.
    '# HOOK_SECRETS: "v1,whsec_' + Buffer.from('This is an example of a shorter Base64 string').toString('base64') + '"',
  ]) {
    assert.equal(ofRule(run('apps/api/src/a.test.ts', code), R).length, 0, code);
  }
});

test('a webhook secret made of random bytes is flagged whatever bytes it holds', () => {
  // 0x3c and 0x3e decode to < and >, which a placeholder check on decoded text would mistake for markup.
  const secret = 'whsec_' + Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 37 + 0x3c) % 256)).toString('base64');
  assert.equal(ofRule(run('src/webhooks.ts', `const s = "${secret}";`), R).length, 1);
});

test('hardcoded JWT is flagged', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
  const v = ofRule(run('src/a.ts', `const t = "${jwt}";`), R);
  assert.equal(v.length, 1);
  assert.match(v[0].message, /JWT/);
});

test('secret-looking literal assignment is flagged', () => {
  const v = ofRule(run('src/a.ts', 'const apiKey = "a1b2c3d4e5f6g7h8i9j0";'), R);
  assert.equal(v.length, 1);
});

test('env-based secret access passes', () => {
  assert.equal(ofRule(run('src/a.ts', 'const apiKey = process.env.API_KEY;'), R).length, 0);
});

test('placeholder values pass', () => {
  assert.equal(ofRule(run('src/a.ts', 'const apiKey = "your-api-key-here-123456";'), R).length, 0);
});

test('short passwords are not flagged (too noisy)', () => {
  assert.equal(ofRule(run('src/a.ts', 'const password = "hunter2";'), R).length, 0);
});

test('NEXT_PUBLIC service_role is flagged', () => {
  const v = ofRule(run('src/a.ts', 'const k = process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;'), R);
  assert.equal(v.length, 1);
  assert.match(v[0].message, /browser/);
});

test('service_role inside a use client file is flagged', () => {
  const code = '"use client";\nimport { env } from "./env";\nconst k = env.SUPABASE_SERVICE_ROLE_KEY;';
  const v = ofRule(run('src/c.tsx', code), R);
  assert.equal(v.length, 1);
});

test('hardcoded sb_secret_ key is flagged', () => {
  const v = ofRule(run('src/a.ts', 'const k = "sb_secret_abcdefghijklmnopqrstuv";'), R);
  assert.equal(v.length, 1);
  assert.match(v[0].message, /sb_secret_/);
});

test('sb_publishable_ in code is allowed (browser-safe)', () => {
  assert.equal(ofRule(run('src/a.ts', 'const k = "sb_publishable_abcdefghijklmnopqrstuv";'), R).length, 0);
});

test('sb_secret_ behind NEXT_PUBLIC is flagged', () => {
  const v = ofRule(run('src/a.ts', 'const k = process.env.NEXT_PUBLIC_X; // sb_secret_'), R);
  assert.equal(v.length, 1);
  assert.match(v[0].message, /browser/);
});

test('sb_secret_ inside a use client file is flagged', () => {
  const code = '"use client";\nconst prefix = "sb_secret_";';
  const v = ofRule(run('src/c.tsx', code), R);
  assert.equal(v.length, 1);
});

test('.env.example with a real-looking secret is flagged', () => {
  const v = ofRule(run('.env.example', 'SUPABASE_KEY=a1B2c3D4e5F6g7H8i9J0k1L2m3N4\n'), R);
  assert.equal(v.length, 1);
});

test('.env.example with placeholders passes', () => {
  const content = 'SUPABASE_URL=https://YOUR-PROJECT.supabase.co\nSUPABASE_KEY=your-anon-key\n';
  assert.equal(ofRule(run('.env.example', content), R).length, 0);
});

test('use client after a leading comment is still a client file', () => {
  const code = '// header\n"use client";\nimport { env } from "./env";\nconst k = env.SUPABASE_SERVICE_ROLE_KEY;';
  assert.equal(ofRule(run('src/c.tsx', code), R).length, 1);
});

test('key shapes are read in source and infrastructure files of any language', () => {
  const aws = 'AKIA' + 'ABCDEFGHIJKLMNOP';
  for (const [path, code] of [
    ['app/settings.py', `AWS_KEY = "${aws}"`],
    ['internal/config.go', `const awsKey = "${aws}"`],
    ['src/config.rs', `let key = "${aws}";`],
    ['deploy/Dockerfile', `ENV AWS_ACCESS_KEY_ID=${aws}`],
    ['ops/deploy.sh', `export AWS_ACCESS_KEY_ID=${aws}`],
    ['src/pages/index.astro', `---\nconst key = "${aws}";\n---`],
    ['infra/main.tf', `access_key = "${aws}"`],
  ]) {
    const v = ofRule(run(path, code), R);
    assert.equal(v.length, 1, path);
    assert.match(v[0].message, /AWS/);
  }
  assert.equal(ofRule(run('docs/setup.md', `key: ${aws}`), R).length, 0, 'prose is not read');
});

test('a literal assigned to a secret name is flagged in Go and Python too', () => {
  assert.equal(ofRule(run('internal/auth.go', 'apiKey := "a1b2c3d4e5f6g7h8i9j0"'), R).length, 1);
  assert.equal(ofRule(run('app/auth.py', 'API_KEY = "a1b2c3d4e5f6g7h8i9j0"'), R).length, 1);
  assert.equal(ofRule(run('app/auth.py', 'API_KEY = os.environ["API_KEY"]'), R).length, 0);
  assert.equal(ofRule(run('src/a.ts', 'if (token === "a1b2c3d4e5f6g7h8i9j0") ok();'), R).length, 0, 'a comparison is not an assignment');
});

// Assembled at run time so secret scanners never see a whole URL in this file.
const DB_PASSWORD = 'Xk29fLq8' + 'Zm3vB7Qp';

test('a database URL with a password for a remote host is flagged', () => {
  for (const url of [
    `postgresql://postgres:${DB_PASSWORD}@db.abcdefghijklmnop.supabase.co:5432/postgres`,
    `postgres://app_user:${DB_PASSWORD}@ep-cool-name-123456.us-east-2.aws.neon.tech/neondb?sslmode=require`,
    `mongodb+srv://admin:${DB_PASSWORD}@cluster0.ab1cd.mongodb.net/app`,
    `rediss://default:${DB_PASSWORD}@eager-fish-12345.upstash.io:6379`,
    `postgresql+asyncpg://svc:${DB_PASSWORD}@mydb.c9akciq32.us-east-1.rds.amazonaws.com/app`,
    `mysql://root:${DB_PASSWORD}@34.120.11.9:3306/shop`,
    // The adapter names Rails writes as the scheme.
    `mysql2://app:${DB_PASSWORD}@db.prod.acme.io:3306/shop`,
    `postgis://app:${DB_PASSWORD}@db.prod.acme.io:5432/geo`,
    // An @ inside the password does not end it: the first one a host follows does.
    `postgresql://app:P@ssw0rd${DB_PASSWORD}@db.prod.acme.io:5432/app`,
    `postgresql://app:Admin@2024${DB_PASSWORD}@db.prod.acme.io:5432/app`,
    // Nor does a colon after it start the port.
    `postgresql://app:P@ss:w0rd${DB_PASSWORD}@db.prod.acme.io:5432/app`,
    // A user that carries an @ of its own, as Azure's single server names it: what follows it is no host and port.
    `postgresql://myadmin@myserver:${DB_PASSWORD}@myserver.postgres.database.azure.com:5432/postgres`,
    `postgresql://myadmin@myserver:Pa#ss${DB_PASSWORD}@myserver.postgres.database.azure.com:5432/postgres`,
  ]) {
    const v = ofRule(run('src/db.ts', `export const url = "${url}";`), R);
    assert.equal(v.length, 1, url);
    assert.match(v[0].message, /database URL/);
  }
  assert.equal(ofRule(run('drizzle.config.ts', `export default { dbCredentials: { url: "postgresql://postgres:${DB_PASSWORD}@db.abcdefghijklmnop.supabase.co:5432/postgres" } };`), R).length, 1);
  assert.equal(ofRule(run('prisma/schema.prisma', `datasource db {\n  url = "postgresql://postgres:${DB_PASSWORD}@db.abcdefghijklmnop.supabase.co:5432/postgres"\n}`), R).length, 1);
});

test('local, placeholder and env-built database URLs pass', () => {
  for (const code of [
    'const url = "postgres://postgres:postgres@localhost:5432/app";',
    `const url = "postgresql://postgres:${DB_PASSWORD}@db:5432/app";`,
    `const url = "postgresql://postgres:${DB_PASSWORD}@127.0.0.1:54322/postgres";`,
    `const url = "postgresql://postgres:${DB_PASSWORD}@192.168.0.10:5432/postgres";`,
    `const url = "postgresql://postgres:${DB_PASSWORD}@host.docker.internal:5432/postgres";`,
    'const url = "postgresql://postgres:[YOUR-PASSWORD]@db.abcdefghijklmnop.supabase.co:5432/postgres";',
    'const url = `postgresql://${user}:${password}@db.abcdefghijklmnop.supabase.co:5432/postgres`;',
    'const url = "mongodb+srv://<username>:<password>@cluster0.ab1cd.mongodb.net/app";',
    'const url = "postgres://user:mypassword123@db.acme.io:5432/app";',
    // Under eight characters and a password equal to the user are the defaults of a tutorial.
    'const url = "postgres://app:secret1@db.acme.io:5432/app";',
    'const url = "postgres://warehouse:warehouse@db.acme.io:5432/app";',
    `const url = "postgres://user:${DB_PASSWORD}@db.example.com:5432/app";`,
    'const url = "redis://cache.acme.io:6379";',
    'pg_dump "postgresql://postgres:$SUPABASE_DB_PASS@db.abcdefghijklmnop.supabase.co:5432/postgres"',
    '- value: postgres://app:$(DB_PASS)@db.acme.io:5432/app',
    '$url = "postgresql://postgres:$env:DB_PASS@db.acme.io:5432/app"',
    'set URL=mysql://root:%MYSQL_PWD%@db.acme.io:3306/shop',
    'url = "postgresql://app:%(db_pass)s@db.acme.io/app" % settings',
    'const url = "https://user:Xk29fLq8Zm3vB7Qp@api.acme.io/v1";',
    // A local host ends where the text around it does: at the sentence's dot, at a shell's semicolon.
    `// e.g. postgresql://postgres:${DB_PASSWORD}@host.docker.internal.`,
    `until pg_isready -d postgresql://postgres:${DB_PASSWORD}@db.local; do sleep 1; done`,
    `const urls = "mongodb://app:${DB_PASSWORD}@mongo-0.mongo.svc.cluster.local,mongo-1.mongo.svc.cluster.local/app";`,
    // What stands after the first slash is the path: nothing there is a credential.
    'const url = "postgresql://app@db.prod.acme.io/reports?owner=ops:leadership1@acme.io";',
    // A host this reader does not know, a placeholder or the syntax of a manual, is not known to be remote.
    `const url = "postgresql://app:${DB_PASSWORD}@<your-host>:5432/app";`,
    '// postgres://[user[:password]@][netloc][:port][/dbname][?param1=value1&...]',
    // Nor is the group of a pattern that describes URLs a host.
    'const RE = new RegExp("postgres://(\\\\w+):([^@\\\\s]+)@([\\\\w.-]+)");',
    // A user and no password: the first colon is the port's, whatever the query holds.
    'const url = "postgresql://app@db.prod.acme.io:5432?owner=ops@acme.io";',
    // An @ inside the password of a local setup makes no host of what follows it.
    `const url = "postgresql://app:${DB_PASSWORD.slice(0, 8)}@${DB_PASSWORD.slice(8)}@127.0.0.1:5432/app";`,
    `const url = "postgresql://app:${DB_PASSWORD.slice(0, 8)}@x.y@host.docker.internal:5432/app";`,
    // What Maven fills in when it copies the file: no piece between two @ is followed by a host.
    '    url: jdbc:postgresql://@db.user@:@db.secret@@@db.host@:5432/app',
  ]) {
    assert.deepEqual(ofRule(run('src/db.ts', code), R), [], code);
  }
});

test('a SQL Server URL in its property form holds no user and password pair to read', () => {
  const properties = 'encrypt=true;trustServerCertificate=false;hostNameInCertificate=*.database.windows.net;loginTimeout=30;';
  for (const [path, code] of [
    ['src/main/resources/application.yml', `    url: jdbc:sqlserver://myserver.database.windows.net:1433;database=mydb;user=myadmin@myserver;password=\${DB_PASSWORD};${properties}`],
    ['.env.example', `SPRING_DATASOURCE_URL=jdbc:sqlserver://myserver.database.windows.net:1433;database=mydb;user=myadmin@myserver;password={your_password_here};${properties}`],
    ['ops/migrate.sh', 'export DATABASE_URL="sqlserver://myserver.database.windows.net:1433;database=mydb;user=svc-app@contoso.com;password=$DB_SECRET;encrypt=true"'],
    // The port may be a variable: the properties after it say what the text is.
    ['ops/migrate.sh', 'export DATABASE_URL="sqlserver://myserver.database.windows.net:$DB_PORT;database=mydb;user=svc-app@contoso.com;password=$DB_SECRET;encrypt=true"'],
    // The host may have no dot, and a property before the user may hold a colon of its own.
    ['prisma/schema.prisma', '  url = "sqlserver://myserver:1433;database=mydb;user=svc-app@contoso.com;password={secret};encrypt=true"'],
    ['src/main/resources/application.yml', '    url: jdbc:sqlserver://myserver.database.windows.net;trustStore=C:\\certs\\ts.jks;user=svc-app@contoso.com;password=${DB_SECRET}'],
  ]) {
    assert.deepEqual(ofRule(run(path, code), R), [], code);
  }
  assert.equal(ofRule(run('src/db.ts', `export const url = "sqlserver://sa:${DB_PASSWORD}@db.prod.acme.io:1433?database=app";`), R).length, 1, 'the user:password@host form of the same scheme');
  const withProperties = 'Xk29;fLq8=' + 'Zm3vB7Qp';
  assert.equal(ofRule(run('src/db.ts', `export const url = "sqlserver://sa:${withProperties}@db.prod.acme.io:1433";`), R).length, 1, 'a semicolon and an equals sign inside its password');
});

test('an example env file with a real database URL is flagged, under any example name', () => {
  const real = `DATABASE_URL=postgresql://postgres:${DB_PASSWORD}@db.abcdefghijklmnop.supabase.co:5432/postgres\n`;
  for (const path of ['.env.example', 'apps/web/.env.sample', '.env.template']) {
    assert.equal(ofRule(run(path, real), R).length, 1, path);
  }
  for (const word of ['[YOUR-PASSWORD]', 'CHANGE_ME', 'change-me', 'REPLACE_ME', 'REDACTED', 'SUA_SENHA', 'senha-do-banco']) {
    assert.equal(ofRule(run('.env.example', `DATABASE_URL=postgresql://postgres:${word}@db.abcdefghijklmnop.supabase.co:5432/postgres\n`), R).length, 0, word);
  }
});

test('an example env file is read on every line and for every URL of it', () => {
  const remote = `postgresql://app:${DB_PASSWORD}@db.prod.acme.io:5432/app`;
  const local = 'postgresql://postgres:postgres@localhost:5432/app';
  for (const content of [
    `DATABASE_URL=${local} # prod: ${remote}\n`,
    `DATABASE_URLS=${local},${remote}\n`,
    `DATABASE_URL=${local}\n# DATABASE_URL=${remote}\n`,
    `export DATABASE_URL=${remote}\n`,
  ]) {
    const v = ofRule(run('.env.example', content), R);
    assert.equal(v.length, 1, content);
    assert.match(v[0].message, /example env file carries a real password/);
  }
  assert.deepEqual(ofRule(run('.env.example', `DATABASE_URL=${local}\n# DATABASE_URL=postgresql://app:[YOUR-PASSWORD]@db.prod.acme.io:5432/app\n`), R), []);
  const key = 'k9' + 'Xp2mQ7vL4tRz8sWn3bYc6dHf';
  assert.equal(ofRule(run('.env.example', `export API_KEY=${key}\n`), R).length, 1, 'a real-looking value behind export');
});

test('one bracket, brace, star, percent or dollar inside a password does not make it a placeholder', () => {
  for (const password of [
    'Xk29*fLmQ7tRz', 'Xk29fLm{Q7tRz', 'Xk29fLm]Q7tRz', '$Xk29fLmQ7tRz', 'Xk29{fLq8}Zm3vB7Qp', 'Xk29{9#}Zm3vB7Qp', `${DB_PASSWORD}{suffix}`, '$Summer2024',
    // Brackets and double underscores stand for a placeholder only as the whole password.
    'Xk29[fLq8]Zm3vB7Qp', 'Xk29__fLq8__Zm3vB7Qp',
    // A percent-encoded accent is two bytes between percent signs, not a %VAR%.
    'Cora%C3%A7%C3%A3o2024Xk', `%AB%${DB_PASSWORD}`,
  ]) {
    const v = ofRule(run('src/db.ts', `export const url = "postgres://app:${password}@db.prod.acme.io:5432/app";`), R);
    assert.equal(v.length, 1, password);
  }
  for (const placeholder of [
    '********', '[YOUR-PASSWORD]', '{db_secret}', '{db_user}{db_secret}', '{db_user}-{db_secret}', '{{ .Values.dbSecret }}', '{{.Values.dbSecret}}',
    '{{{db_secret}}}', '%{db_secret}', '#{DbSecret}#', '$DB_SECRET', '$dbSecret', '$$DB_SECRET', '$env:DbSecret', '$(DB_SECRET)', '$(DbSecret)', '$[variables.dbSecret]',
    '%DB_SECRET%', '%env(DB_SECRET)%', '__DB_SECRET__',
  ]) {
    assert.deepEqual(ofRule(run('src/db.ts', `export const url = "postgres://app:${placeholder}@db.prod.acme.io:5432/app";`), R), [], placeholder);
  }
});

test('every database URL of a line is read, and a user that is an expression with a colon is read whole', () => {
  const remote = `postgresql://app:${DB_PASSWORD}@db.prod.acme.io:5432/app`;
  const local = 'postgresql://postgres:postgres@localhost:5432/app';
  assert.equal(ofRule(run('src/db.ts', `export const url = isDev ? "${local}" : "${remote}";`), R).length, 1, 'the remote URL comes second');
  assert.equal(ofRule(run('ops/copy.sh', `pg_dump "${local}" | psql "${remote}"`), R).length, 1);
  for (const [path, code] of [
    ['ops/db.sh', 'psql "postgresql://${DB_USER:-app}:$DB_SECRET@db.prod.acme.io:5432/app"'],
    ['ops/db.ps1', 'psql "postgresql://$($env:DB_USER):$($env:DB_SECRET)@db.prod.acme.io:5432/app"'],
    ['ops/db.ps1', 'psql "postgresql://$env:DB_USER:$env:DB_SECRET@db.prod.acme.io:5432/app"'],
    ['infra/stack.yaml', 'Url: postgresql://{{resolve:secretsmanager:Db:SecretString:username}}:{{resolve:secretsmanager:Db:SecretString:pwd}}@db.prod.acme.io:5432/app'],
    ['lib/db.rb', 'DB_URL = "postgresql://#{db[:user]}:#{db[:secret]}@db.prod.acme.io:5432/app"'],
    ['lib/db.rb', 'DB_URL = "postgresql://#{Settings::DB_USER}:#{Settings::DB_SECRET}@db.prod.acme.io:5432/app"'],
    ['config/packages/doctrine.yaml', "    url: 'mysql://%env(urlencode:DB_USER)%:%env(urlencode:DB_SECRET)%@db.prod.acme.io:5432/app'"],
    ['ops/db.ps1', '$url = "postgresql://$([uri]::EscapeDataString($env:DB_USER)):$([uri]::EscapeDataString($env:DB_SECRET))@db.prod.acme.io:5432/app"'],
    // No password at all: the default inside the user is not one.
    ['ops/db.sh', 'psql "postgresql://${DATABASE_USER:-application}@db.prod.acme.io/app"'],
    // A string of its own inside the expression is still part of it.
    ['lib/db.rb', 'DB_URL = "postgresql://#{ENV[\'DB_USER\']}:#{ENV[\'DB_SECRET\']}@db.prod.acme.io:5432/app"'],
    ['app/db.py', 'url = f"postgresql://{os.environ[\'DB_USER\']}:{os.environ[\'DB_SECRET\']}@db.prod.acme.io:5432/app"'],
    // A user and no password, with the host or the port written by Ruby.
    ['lib/db.rb', 'DB_URL = "postgresql://app@#{@config.host}:5432?owner=ops@acme.io"'],
    ['lib/db.rb', 'DB_URL = "postgresql://app@db.prod.acme.io:#{@port}?owner=ops@acme.io"'],
  ]) {
    assert.deepEqual(ofRule(run(path, code), R), [], code);
  }
  assert.equal(ofRule(run('ops/db.sh', `psql "postgresql://\${DB_USER:-app}:${DB_PASSWORD}@db.prod.acme.io:5432/app"`), R).length, 1, 'a literal password after such a user');
  assert.equal(ofRule(run('lib/db.rb', `DB_URL = "postgresql://#{db[:user]}:${DB_PASSWORD}@db.prod.acme.io:5432/app"`), R).length, 1, 'and after a Ruby interpolation');
  assert.equal(ofRule(run('lib/db.rb', `DB_URL = "postgresql://#{ENV['DB_USER']}:${DB_PASSWORD}@db.prod.acme.io:5432/app"`), R).length, 1, 'with a string of its own inside');
  assert.equal(ofRule(run('chart/values.yaml', `  url: postgres://{{.Values.db.user | quote}}:${DB_PASSWORD}@db.prod.acme.io:5432/app`), R).length, 1, 'and after a Helm value with a pipe');
  assert.equal(ofRule(run('ops/db.ps1', `$url = "postgresql://$([uri]::EscapeDataString($env:DB_USER)):${DB_PASSWORD}@db.prod.acme.io:5432/app"`), R).length, 1, 'and after a PowerShell call');
});

test('a database URL whose password is an interpolation, an expression or a variable passes', () => {
  for (const [path, code] of [
    ['app/db.py', 'url = f"postgresql://app:{quote_plus(db_secret)}@db.prod.acme.io:5432/app"'],
    ['src/Db.cs', 'var url = $"postgresql://app:{Uri.EscapeDataString(dbSecret)}@db.prod.acme.io:5432/app";'],
    ['lib/db.rb', 'url = "postgresql://app:#{CGI.escape(db_secret)}@db.prod.acme.io:5432/app"'],
    ['lib/db.rb', 'url = format("postgresql://app:%{db_secret}@db.prod.acme.io:5432/app", db_secret: pw)'],
    ['src/db.php', '$url = "postgresql://app:{$dbSecret}@db.prod.acme.io:5432/app";'],
    ['src/Db.swift', 'let url = "postgresql://app:\\(config.dbSecret)@db.prod.acme.io:5432/app"'],
    ['ops/db.ps1', '$url = "postgresql://app:$($cfg.DbSecret)@db.prod.acme.io:5432/app"'],
    ['ops/db.ps1', '$url = "postgresql://app:$([uri]::EscapeDataString($dbSecret))@db.prod.acme.io:5432/app"'],
    ['azure-pipelines.yml', '      DATABASE_URL: postgresql://app:$(DbSecret)@db.prod.acme.io:5432/app'],
    ['src/db.go', 'url := fmt.Sprintf("postgresql://app:%[1]s%[2]s@db.prod.acme.io:5432/app", a, b)'],
    // Digits wherever the name has them, not only at its end.
    ['ops/db.sh', 'psql "postgresql://app:$K8S_PG_PW_V2@db.prod.acme.io:5432/app"'],
    ['ops/db.sh', 'psql "postgresql://app:$S3_DB_PW_2024@db.prod.acme.io:5432/app"'],
    ['ops/db.sh', 'psql "postgresql://app:$db1Secret2@db.prod.acme.io:5432/app"'],
    ['docker-compose.yml', '      DATABASE_URL: postgresql://app:$PG15_SECRET_V2@db.prod.acme.io:5432/app'],
    ['ops/db.ps1', '$url = "postgresql://app:$env:PG15_PW_V2@db.prod.acme.io:5432/app"'],
  ]) {
    assert.deepEqual(ofRule(run(path, code), R), [], code);
  }
});

test('every @ after the colon may be the one before the host, up to the query: one in a later interpolation or in the query hides no password', () => {
  for (const [path, code] of [
    ['lib/db.rb', `DB_URL = "postgresql://app:${DB_PASSWORD}@db.prod.acme.io:#{@port}/app"`],
    ['src/db.ts', `export const url = "postgresql://app:${DB_PASSWORD}@db.prod.acme.io:5432?application_name=jobs@worker-1";`],
    ['src/db.ts', `export const url = "mongodb+srv://admin:${DB_PASSWORD}@cluster0.ab1cd.mongodb.net?retryWrites=true&appName=me@work";`],
    ['src/db.ts', `export const url = "postgresql://app:${DB_PASSWORD}@db.prod.acme.io#primary@eu";`],
    // Emphasis marks around the URL are no part of the host.
    ['src/db.ts', `// **postgresql://app:${DB_PASSWORD}@db.prod.acme.io**`],
    ['src/db.ts', `// **postgresql://app:P@ss${DB_PASSWORD}@db.prod.acme.io**`],
  ]) {
    assert.equal(ofRule(run(path, code), R).length, 1, code);
  }
  // An @ inside the password and then letters and a sign: the piece before it is no password of its own.
  for (const sign of ['#', '?', '&', ',', ';', ')']) {
    const password = 'Xk29fLq8' + `@Zm3v${sign}B7Qp`;
    assert.equal(ofRule(run('src/db.ts', `export const url = "postgresql://app:${password}@db.prod.acme.io:5432/app";`), R).length, 1, sign);
  }
  for (const [path, code] of [
    ['lib/db.rb', 'DB_URL = "postgresql://#{@config.user}:#{@config.secret}@#{@config.host}:#{@config.port}/app"'],
    ['lib/db.rb', 'DB_URL = "postgresql://#{user}:#{secret}@#{@config.host}:5432/app"'],
    // After a host and its query, nothing is credentials: the e-mail there is no host.
    ['src/db.ts', `export const url = "postgresql://postgres:${DB_PASSWORD}@localhost:5432?application_name=jobs&owner=ops@acme.io";`],
    // A password the shell fills in ends the reading: what follows it is no longer one.
    ['ops/db.sh', 'psql "postgresql://app:$DB_SECRET@db.internal;ops@acme.io"'],
  ]) {
    assert.deepEqual(ofRule(run(path, code), R), [], code);
  }
});

test('a literal password is flagged when the host is built by the code: only a host written as local is local', () => {
  for (const [path, code] of [
    ['src/db.ts', 'export const url = `postgresql://admin:' + DB_PASSWORD + '@${process.env.DB_HOST}:5432/app`;'],
    ['app/db.py', `DATABASE_URL = f"postgresql://admin:${DB_PASSWORD}@{settings.DB_HOST}:5432/app"`],
    ['infra/main.tf', '  database_url = "postgresql://admin:' + DB_PASSWORD + '@${aws_db_instance.main.address}:5432/app"'],
    ['ops/migrate.sh', 'psql "postgresql://admin:' + DB_PASSWORD + '@db.${STAGE}.acme.io:5432/app" -f schema.sql'],
    ['cmd/migrate/main.go', `const databaseURL = "mysql://admin:${DB_PASSWORD}@tcp(db.prod.acme.io:3306)/app"`],
    ['chart/values.yaml', `  url: postgresql://app:${DB_PASSWORD}@{{ .Values.db.host }}:5432/app`],
    ['lib/db.rb', `DB_URL = "postgresql://app:${DB_PASSWORD}@#{@config.host}:5432/app"`],
  ]) {
    assert.equal(ofRule(run(path, code), R).length, 1, code);
  }
  // One label, as a compose service is named: a bare variable reads the same.
  assert.deepEqual(ofRule(run('ops/db.sh', `psql "postgresql://app:${DB_PASSWORD}@\${DB_HOST}:5432/app"`), R), []);
});

test('a host holds the brackets it opens: a placeholder or an interpolation inside a remote name is part of it', () => {
  for (const [path, code] of [
    // As a provider's dashboard and its docs write the host to fill in.
    ['src/db.ts', `const url = "postgresql://postgres.abcdefghijklmnop:${DB_PASSWORD}@aws-0-[region].pooler.supabase.com:6543/postgres";`],
    ['src/db.ts', `const url = "postgresql://postgres:${DB_PASSWORD}@db.<your-project>.supabase.co:5432/postgres";`],
    ['src/db.ts', `const url = "postgresql://neondb_owner:${DB_PASSWORD}@ep-<id>.us-east-2.aws.neon.tech/neondb";`],
    ['app/db.py', `url = "postgresql://app:${DB_PASSWORD}@{}.db.acme.io:5432/app".format(stage)`],
    // Swift writes its interpolation behind a backslash.
    ['Sources/App/Database.swift', `let url = "postgresql://app:${DB_PASSWORD}@\\(config.host):5432/app"`],
    ['Sources/App/Database.swift', `let url = "postgresql://app:${DB_PASSWORD}@db.\\(region).acme.io:5432/app"`],
    // With a space or a string of its own inside, the interpolation is cut short and is still the host.
    ['Sources/App/Database.swift', `let url = "postgresql://vapor:${DB_PASSWORD}@\\(config.host ?? "localhost"):5432/app"`],
    ['Sources/App/Database.swift', `let url = "postgresql://vapor:${DB_PASSWORD}@\\(Environment.get("DATABASE_HOST") ?? "localhost"):5432/app"`],
    ['Sources/App/Database.swift', `let url = "postgresql://vapor:${DB_PASSWORD}@\\(Environment.get("DATABASE_HOST")!):5432/app"`],
    // Calls nested deeper than an expression is read: the parentheses still pair up.
    ['ci/deploy.yml', `      url: postgresql://app:${DB_PASSWORD}@$(pick(region(by(zone(env))))).db.acme.io:5432/app`],
    // A list or a shell sign inside the host's own bracket is part of the placeholder.
    ['src/db.ts', `const url = "postgresql://app:${DB_PASSWORD}@db-<staging|prod>.acme.io:5432/app";`],
    ['src/db.ts', `const url = "postgresql://app:${DB_PASSWORD}@[eu,us].db.acme.io:5432/app";`],
    ['src/db.ts', `const url = "postgresql://app:${DB_PASSWORD}@<project&ref>.supabase.co:5432/postgres";`],
  ]) {
    assert.equal(ofRule(run(path, code), R).length, 1, code);
  }
  for (const code of [
    // A bracket opened before the host still ends it, and a placeholder with no dot names no remote host.
    `// (see postgresql://postgres:${DB_PASSWORD}@db.internal) and the docs.acme.io page`,
    `const url = "postgresql://app:${DB_PASSWORD}@[host]:5432/app";`,
    `const url = "postgresql://app:${DB_PASSWORD}@db[0]:5432/app";`,
    // In a square bracket a colon still ends the host: an IPv6 literal is not read, nor the optional port of a manual.
    `const url = "postgresql://app:${DB_PASSWORD}@[::1]:5432/app";`,
    `const url = "postgresql://app:${DB_PASSWORD}@[::ffff:127.0.0.1]:5432/app";`,
    `// postgresql://app:${DB_PASSWORD}@db.internal[:port][/database]`,
    `// postgresql://app:${DB_PASSWORD}@<name>.internal[:port]`,
    // Once its brace or its parenthesis is closed, the host ends at its port again.
    `url = "postgresql://app:${DB_PASSWORD}@{}.internal:5432/app".format(name)`,
    `      url: postgresql://app:${DB_PASSWORD}@$(pick(region(by(zone(env))))).internal:5432/app`,
  ]) {
    assert.deepEqual(ofRule(run('src/db.ts', code), R), [], code);
  }
});

test('the address a protocol wraps and the default of a variable are the host', () => {
  for (const [path, code] of [
    // Go writes the address of a MySQL server inside its protocol.
    ['cmd/migrate/main.go', `const databaseURL = "mysql://app:${DB_PASSWORD}@tcp(host.docker.internal:3306)/app"`],
    ['cmd/migrate/main.go', `const databaseURL = "mysql://app:${DB_PASSWORD}@tcp(mysql.default.svc.cluster.local:3306)/app"`],
    ['cmd/migrate/main.go', `const databaseURL = "mysql://app:${DB_PASSWORD}@tcp(127.0.0.1:3306)/app"`],
    ['cmd/migrate/main.go', `const databaseURL = "mysql://app:${DB_PASSWORD}@unix(/var/run/mysqld/mysqld.sock)/app"`],
    ['docker-compose.yml', '      DATABASE_URL: mysql://app:' + DB_PASSWORD + '@tcp(host.docker.internal:${DB_PORT})/app'],
    ['docker-compose.yml', '      DATABASE_URL: mysql://app:' + DB_PASSWORD + '@tcp(${DB_HOST:-127.0.0.1}:3306)/app'],
    ['k8s/app.yaml', '          value: mysql://app:' + DB_PASSWORD + '@tcp(host.docker.internal:$(DB_PORT))/app'],
    // What the shell or compose puts in the variable's place: its default, or the word that stands for a set one.
    ['docker-compose.yml', '      DATABASE_URL: postgresql://app:' + DB_PASSWORD + '@${PGHOST:-127.0.0.1}:5432/app'],
    ['docker-compose.yml', '      command: sh -c "psql postgresql://app:' + DB_PASSWORD + '@$${PGHOST:-127.0.0.1}:5432/app"'],
    ['ops/db.sh', 'psql "postgresql://app:' + DB_PASSWORD + '@${DB_HOST:-host.docker.internal}:5432/app"'],
    ['ops/db.sh', 'psql "postgresql://app:' + DB_PASSWORD + '@${DB_HOST-127.0.0.1}:5432/app"'],
    ['ops/db.sh', 'psql "postgresql://app:' + DB_PASSWORD + '@${DB_HOST:=127.0.0.1}:5432/app"'],
    ['ops/db.sh', 'psql "postgresql://app:' + DB_PASSWORD + '@${USE_PROXY:+proxy.internal}:5432/app"'],
    // An error message names no host: the variable stands alone.
    ['ops/db.sh', 'psql "postgresql://app:' + DB_PASSWORD + '@${DB_HOST:?see.the.readme}:5432/app"'],
    // The word may hold variables of its own, be another default, carry quotes or a port, or be Go's address.
    ['docker-compose.yml', '      DATABASE_URL: postgresql://app:' + DB_PASSWORD + '@${DB_HOST:-db.${REGION}.internal}:5432/app'],
    ['docker-compose.yml', '      DATABASE_URL: postgresql://app:' + DB_PASSWORD + '@${DB_HOST:-${COMPOSE_PROJECT_NAME}-db.internal}:5432/app'],
    ['ops/db.sh', 'psql "postgresql://app:' + DB_PASSWORD + '@${DB_HOST:-postgres.${NAMESPACE:-default}.svc.cluster.local}:5432/app"'],
    ['ops/db.sh', 'psql "postgresql://app:' + DB_PASSWORD + '@${DB_HOST:-${FALLBACK_HOST:-127.0.0.1}}:5432/app"'],
    ['ops/db.sh', 'psql "postgresql://app:' + DB_PASSWORD + '@${A:-${B:-${C:-${D:-${E:-127.0.0.1}}}}}:5432/app"'],
    ['ops/db.sh', 'psql "postgresql://app:' + DB_PASSWORD + '@${A:-${B:-${C:-${D:-${E:?not.set}}}}}:5432/app"'],
    ['ops/db.sh', 'psql "postgresql://app:' + DB_PASSWORD + '@${DB_HOST:-"127.0.0.1"}:5432/app"'],
    ['ops/db.sh', 'psql "postgresql://app:' + DB_PASSWORD + '@${DB_ADDR:-host.docker.internal:5432}/app"'],
    ['docker-compose.yml', '      DATABASE_URL: mysql://app:' + DB_PASSWORD + '@${DB_ADDR:-tcp(127.0.0.1:3306)}/app'],
    // An address that is no single expression, for the template with a space inside it, is still read whole.
    ['chart/templates/app.yaml', '          value: mysql://app:' + DB_PASSWORD + '@tcp(${DB_HOST:-{{ .Values.stage }}.internal}:3306)/app'],
  ]) {
    assert.deepEqual(ofRule(run(path, code), R), [], code);
  }
  for (const [path, code] of [
    ['cmd/migrate/main.go', `const databaseURL = "mysql://app:${DB_PASSWORD}@tcp(db.prod.acme.io:3306)/app"`],
    ['docker-compose.yml', '      DATABASE_URL: mysql://app:' + DB_PASSWORD + '@tcp(db.prod.acme.io:${DB_PORT})/app'],
    ['docker-compose.yml', '      DATABASE_URL: mysql://app:' + DB_PASSWORD + '@tcp(${DB_HOST:-db.prod.acme.io}:3306)/app'],
    ['ops/db.sh', 'psql "postgresql://app:' + DB_PASSWORD + '@${DB_HOST:-db.prod.acme.io}:5432/app"'],
    ['ops/db.sh', 'psql "postgresql://app:' + DB_PASSWORD + '@${USE_REPLICA:+replica.prod.acme.io}:5432/app"'],
    // However deep the default sits, and with its quotes or its port.
    ['ops/db.sh', 'psql "postgresql://app:' + DB_PASSWORD + '@${A:-${B:-${C:-db.prod.acme.io}}}:5432/app"'],
    ['ops/db.sh', 'psql "postgresql://app:' + DB_PASSWORD + '@${A:-${B:-${C:-${D:-${E:-db.prod.acme.io}}}}}:5432/app"'],
    // A user three defaults deep is one piece: the literal after its colon is the password.
    ['ops/db.sh', 'psql "postgresql://${A:-${B:-${C:-app}}}:' + DB_PASSWORD + '@db.prod.acme.io:5432/app"'],
    ['ops/db.sh', 'psql "postgresql://app:' + DB_PASSWORD + '@${DB_HOST:-"db.prod.acme.io"}:5432/app"'],
    ['ops/db.sh', 'psql "postgresql://app:' + DB_PASSWORD + '@${DB_ADDR:-db.prod.acme.io:5432}/app"'],
    ['docker-compose.yml', '      DATABASE_URL: mysql://app:' + DB_PASSWORD + '@${DB_ADDR:-tcp(db.prod.acme.io:3306)}/app'],
    ['docker-compose.yml', '      DATABASE_URL: mysql://app:' + DB_PASSWORD + '@tcp(${DB_HOST:-db.prod.acme.io})/app'],
    // A ternary of the language, not a default of the shell.
    ['src/db.ts', 'const url = `postgresql://app:' + DB_PASSWORD + '@${local?devHost:config.db.host}`;'],
    // A default that is one label of a longer name is not the host.
    ['ops/db.sh', 'psql "postgresql://app:' + DB_PASSWORD + '@${STAGE:-dev}.db.acme.io:5432/app"'],
    ['ops/db.sh', 'psql "postgresql://app:' + DB_PASSWORD + '@${POD_IP:-10.0.0.5}.pods.acme.io:5432/app"'],
    ['docker-compose.yml', '      DATABASE_URL: mysql://app:' + DB_PASSWORD + '@tcp(${STAGE:-dev}.db.acme.io:3306)/app'],
  ]) {
    assert.equal(ofRule(run(path, code), R).length, 1, code);
  }
});

test('a host of adversarial length is read in time that grows with its length, not with its square', () => {
  for (const [name, host] of [
    ['a long run of signs inside its own brace', '{' + ':'.repeat(100_000) + '}'],
    ['defaults nested thousands deep', '${A:-'.repeat(20_000) + 'db.prod.acme.io' + '}'.repeat(20_000)],
    ['openers and colons by the thousand', '{'.repeat(50_000) + ':'.repeat(50_000)],
    ['a long run of signs that is not the end', '!'.repeat(100_000) + 'a'],
  ]) {
    const started = Date.now();
    run('src/db.ts', `const url = "postgresql://app:${DB_PASSWORD}@${host}/app";`);
    assert.ok(Date.now() - started < 1000, `${name}: took ${Date.now() - started} ms`);
  }
});

test('a bracket of the password is not closed by a later interpolation of the URL', () => {
  for (const [path, code] of [
    ['src/db.ts', 'const url = `postgres://app:' + 'Xk29{fLq8,' + '@db.prod.acme.io:${port}/app`;'],
    ['lib/db.rb', 'DB_URL = "postgres://app:' + 'Xk29{fLq8,' + '@db.prod.acme.io:#{port}/app"'],
    ['k8s/app.yaml', '          value: postgres://app:' + 'Xk29(fLq8,' + '@db.prod.acme.io:$(DB_PORT)/app'],
    ['docker-compose.yml', '      DATABASE_URL: postgres://app:' + 'Xk29{fLq8Zm,' + '@db.prod.acme.io:${DB_PORT:-5432}/app'],
    // An expression that holds a pair of its own brackets is still one piece: the default here is a remote name.
    ['ops/db.sh', 'psql "postgresql://app:' + DB_PASSWORD + '@${DB_HOST:-${REGION}.db.acme.io}:5432/app"'],
  ]) {
    assert.equal(ofRule(run(path, code), R).length, 1, code);
  }
  for (const [path, code] of [
    ['ops/db.sh', 'psql "postgresql://${DB_USER:-app_${STAGE}}:${DB_SECRET}@db.prod.acme.io:5432/app"'],
    ['ops/db.sh', 'psql "postgresql://app:' + DB_PASSWORD + '@${DB_HOST:-${FALLBACK_HOST}}:5432/app"'],
  ]) {
    assert.deepEqual(ofRule(run(path, code), R), [], code);
  }
});

test('a bracket of the password is not closed by the text around the URL: an @ belongs to an expression only where a language writes one', () => {
  for (const [path, code] of [
    // The URL is the default of a variable: the brace after it closes the expansion, not one of the password.
    ['ops/env.sh', 'export DATABASE_URL="${DATABASE_URL:-postgres://app:' + 'Xk29fLq8Zm3v{' + '@db.prod.acme.io:5432/app}"'],
    ['ops/env.sh', 'export DATABASE_URL="${DATABASE_URL:-postgres://app:' + 'Xk29{fLq8Zm3v,' + '@db.prod.acme.io:5432/app}"'],
    ['docker-compose.yml', '      DATABASE_URL: ${DATABASE_URL:-postgres://app:' + 'Xk29{fLq8Zm3v,' + '@db.prod.acme.io:5432/app}'],
    ['ops/migrate.sh', "psql 'mysql://app:" + 'Xk29fLq8{a[' + "@db.prod.acme.io:5432}' -f schema.sql"],
    ['src/db.ts', '// (the replica is postgres://app:' + 'Xk29fLq8Zm3v(' + '@db.prod.acme.io)'],
    // Behind Ruby's sign too, when a path or a port follows, or when a letter stands before the @.
    ['lib/db.rb', 'DB_URL = "#{override || "postgres://app:' + 'Xk29fLq8Zm3v#{' + '@db.prod.acme.io/app}"}"'],
    ['lib/db.rb', 'URLS = %w{postgres://app:' + 'Xk29fLq8Zm3v#{' + '@db.prod.acme.io:5432}'],
    ['lib/db.rb', 'URLS = %w{postgres://app:' + 'Xk29fLm#{Q7tRz' + '@db.prod.acme.io}'],
    // What the allowed forms hold is still read as one piece: a host the code builds, with a literal password.
    ['ops/db.ps1', '$url = "postgresql://app:' + DB_PASSWORD + '@$(@($c.Hosts)[0]):5432/app"'],
    ['ops/db.ps1', '$url = "postgresql://app:' + DB_PASSWORD + '@$(@{h=$c.Host}.h):5432/app"'],
    ['ops/db.sh', 'psql "postgresql://app:' + DB_PASSWORD + '@${DB_HOSTS[@]}.db.acme.io:5432/app"'],
  ]) {
    assert.equal(ofRule(run(path, code), R).length, 1, code);
    // With an @ of its own earlier in the password, the authority is not read a second time: the rule above decides alone.
    const earlier = code.replace('://app:', '://app:P@ss');
    assert.equal(ofRule(run(path, earlier), R).length, 1, earlier);
  }
  for (const [path, code] of [
    // Ruby's instance variables, after each sign that may stand before one.
    ['lib/db.rb', 'DB_URL = "postgresql://app:#{salt}#{@secret}@db.prod.acme.io:5432/app"'],
    ['lib/db.rb', 'DB_URL = "postgresql://app:#{salt}#{CGI.escape(@secret)}@db.prod.acme.io:5432/app"'],
    ['lib/db.rb', 'DB_URL = "postgresql://app:#{salt}#{pick(1,@secret)}@db.prod.acme.io:5432/app"'],
    ['lib/db.rb', 'DB_URL = "postgresql://app:#{salt}#{[@secret][0]}@db.prod.acme.io:5432/app"'],
    // A symbol beside the instance variable: its colon stands before a letter, as no port does.
    ['lib/db.rb', 'DB_URL = "postgresql://app:#{salt}#{@config[:secret]}@db.prod.acme.io:5432/app"'],
    ['lib/db.rb', 'DB_URL = "postgresql://#{@config[:user]}:#{@config[:secret]}@db.prod.acme.io:5432/app"'],
    // The index of a shell array and a PowerShell array, with nothing literal beside them.
    ['ops/db.sh', 'psql "postgresql://${USERS[@]}:${DB_SECRET}@db.prod.acme.io:5432/app"'],
    ['ops/db.ps1', '$url = "postgresql://$($c.User):$($c.Secret)@$(@($c.Hosts)[0]):5432/app"'],
    // No expression runs past the quote that ends the URL, whatever the code after the string closes.
    ['src/db.ts', 'const pool = connect("postgres://app:' + DB_PASSWORD + '@db(1",opts.acme.io);'],
  ]) {
    assert.deepEqual(ofRule(run(path, code), R), [], code);
  }
});

test('an authority whose only @ stands in what looks like an interpolation is read again with that @ as the separator', () => {
  for (const [path, code] of [
    // The password holds Ruby's sign and the text after the URL closes its brace.
    ['ops/env.sh', 'export DATABASE_URL="${DATABASE_URL:-postgres://app:' + 'Xk29fLq8Zm3v#{' + '@db.prod.acme.io}"'],
    ['ops/env.sh', 'export DATABASE_URL="${DATABASE_URL:-postgres://app:' + 'Xk29#{fLq8Zm3v,' + '@db.prod.acme.io}"'],
    ['docker-compose.yml', '      DATABASE_URL: ${DATABASE_URL:-postgres://app:' + 'Xk29fLq8Zm3v#{' + '@db.prod.acme.io?sslmode=require}'],
    ['ops/env.sh', 'export DATABASE_URL="${DATABASE_URL:-postgres://app:' + 'Xk29fLq8#{Zm3v[' + '@db.prod.acme.io:${DB_PORT}}"'],
  ]) {
    assert.equal(ofRule(run(path, code), R).length, 1, code);
  }
  for (const [path, code] of [
    // No password at all: the instance variable is the port, or the whole password.
    ['lib/cache.rb', 'REDIS_URL = "redis://cache.prod.acme.io:#{@port}"'],
    ['lib/db.rb', 'DB_URL = "postgresql://db.prod.acme.io:#{@config.port}/app"'],
    ['lib/db.rb', 'DB_URL = "postgresql://app:#{@config.secret}"'],
  ]) {
    assert.deepEqual(ofRule(run(path, code), R), [], code);
  }
});

test('an @ right after a bracket ends no user, and a password that stops at one is an interpolation still open', () => {
  for (const [path, code] of [
    ['src/Db.cs', 'var url = $"postgres://{@user}:' + DB_PASSWORD + '@db.prod.acme.io/app";'],
    ['ops/db.ps1', '$url = "postgresql://$(@{u=$c.User}.u):' + DB_PASSWORD + '@db.prod.acme.io/app"'],
    ['src/Db.cs', 'var url = $"postgres://{Pick(a,@b)}:' + DB_PASSWORD + '@db.prod.acme.io/app";'],
    ['src/Db.cs', 'var url = $"postgres://{users[@i]}:' + DB_PASSWORD + '@db.prod.acme.io/app";'],
    // A host holding an expression that is no Ruby interpolation to this reader, for its slash or its colon.
    ['lib/db.rb', 'DB_URL = "postgresql://app:' + DB_PASSWORD + '@#{shard(id:1)}.db.acme.io/app"'],
    ['lib/db.rb', 'DB_URL = "postgresql://app:' + DB_PASSWORD + '@db-#{n/2}.acme.io/app"'],
    // A password whose first piece stops at a bracket and an @ is still read whole at the next @.
    ['src/db.ts', 'const url = "postgresql://app:' + '!(@' + DB_PASSWORD + '@db.prod.acme.io:5432/app";'],
    // Letters before the bracket make the piece a literal one, whatever the rest of the password holds.
    ['ops/db.sh', 'psql "postgresql://app:' + 'Xk29fLq8Zm3v{' + '@${SUFFIX}@db.prod.acme.io:5432/app"'],
    // The only reading there is gets judged, whatever its shape: signs, a group in braces and a brace.
    ['src/db.ts', 'const url = "postgresql://app:' + '?{Gz&t6%|z}{' + '@db.prod.acme.io:5432/app";'],
    ['src/db.ts', 'const url = "postgresql://app:' + '|%,[~[=#%{' + '@db.prod.acme.io:5432/app";'],
    // A sign opens no port: after a user with an @ of its own, this is the password.
    ['src/mq.ts', 'const url = "amqps://ops@acme.io:' + '#$Xk29,' + 'fLq8Zm3vB7Qp' + '@mq.prod.acme.io:5672";'],
    ['src/db.ts', 'const url = "postgres://myadmin@myserver:' + '#(Xk29fLq8);Zm3v' + '@mydb.postgres.database.azure.com:5432/app";'],
  ]) {
    assert.equal(ofRule(run(path, code), R).length, 1, code);
  }
  for (const [path, code] of [
    ['src/Db.cs', 'var url = $"postgres://{@user}:{@secret}@db.prod.acme.io/app";'],
    ['src/Db.cs', 'var url = $"postgres://app:{prefix}{@secret}@db.prod.acme.io/app";'],
    ['lib/db.rb', 'DB_URL = "postgresql://app:#{salt_value}#{@pw.gsub(/\\s/,\'\')}@db.prod.acme.io/app"'],
    // The same expression in a host with a property.
    ['lib/db.rb', 'DB_URL = "postgresql://shard-#{n/2}.db.acme.io:5432?owner=ops@acme.io"'],
  ]) {
    assert.deepEqual(ofRule(run(path, code), R), [], code);
  }
});

test('a user written as an interpolation with spaces in it is one piece, and the literal password after it is read', () => {
  for (const [path, code] of [
    ['src/db.ts', 'const url = `postgres://${ user }:' + DB_PASSWORD + '@db.prod.acme.io:5432/app`;'],
    ['lib/db.rb', 'DB_URL = "postgres://#{ user }:' + DB_PASSWORD + '@db.prod.acme.io:5432/app"'],
    ['app/db.py', 'url = f"postgres://{ user }:' + DB_PASSWORD + '@db.prod.acme.io:5432/app"'],
    ['.github/workflows/ci.yml', '          DATABASE_URL: postgres://${{ secrets.DB_USER }}:' + DB_PASSWORD + '@db.prod.acme.io:5432/app'],
    ['chart/values.yaml', '  url: postgres://{{ .Values.db.user }}:' + DB_PASSWORD + '@db.prod.acme.io:5432/app'],
    // A brace of the password opens no interpolation: the one that closes the object around the URL does not close it.
    ['src/db.ts', 'const cfg = { url: "postgres://app:' + 'Xk29fLm{Q7tRz' + '@db.prod.acme.io:5432/app" };'],
    ['src/db.ts', 'const cfg = { url: "postgres://app:' + 'Xk29fLm#{Q7tRz' + '@db.prod.acme.io:5432/app" };'],
    ['src/db.ts', 'const cfg = { url: "postgres://app:' + 'Xk29{fLq8Zm3v!' + '@db.prod.acme.io:5432/app" };'],
    // Nor does the bracket around the URL close one of the password, with no space in between.
    ['src/Db.tsx', '<Pool url={"postgres://app:' + 'Xk29fLm{Q7tRz' + '@db.prod.acme.io:5432/app"} />'],
    ['src/db.ts', '// (postgres://app:' + 'Xk29fLm(Q7tRz' + '@db.prod.acme.io)'],
    // Even with a sign or a comma before the @: the quote that ends the URL is no part of an expression.
    ['src/db.ts', 'const pool = connect("postgres://app:' + 'Xk29(fLq8!' + '@db.prod.acme.io:5432/app");'],
    ['src/db.ts', 'const pool = connect("postgres://app:' + 'Xk29fLq8(,' + '@db.prod.acme.io:5432/app");'],
  ]) {
    assert.equal(ofRule(run(path, code), R).length, 1, code);
  }
  for (const [path, code] of [
    ['src/db.ts', 'const url = `postgres://${ user }:${ secret }@db.prod.acme.io:5432/app`;'],
    ['.github/workflows/ci.yml', '          DATABASE_URL: postgres://${{ secrets.DB_USER }}:${{ secrets.DB_SECRET }}@db.prod.acme.io:5432/app'],
    ['chart/values.yaml', '  url: postgres://{{ .Values.db.user }}:{{ .Values.db.secret }}@db.prod.acme.io:5432/app'],
  ]) {
    assert.deepEqual(ofRule(run(path, code), R), [], code);
  }
});

test('the text of a host ends where the text around the URL does', () => {
  for (const end of [',', ';', ')', ']', '}', '>', '|', '&', '\\', '?', '#']) {
    const code = `psql postgresql://postgres:${DB_PASSWORD}@db.internal${end}next`;
    assert.deepEqual(ofRule(run('ops/db.sh', code), R), [], code);
  }
});

test('an authority that opens with a host and goes on with a property or a query holds no credentials', () => {
  for (const code of [
    'const row = "redis://cache.prod.acme.io:6379;owner=ops@acme.io";',
    'const url = "amqp://mq.prod.acme.io:5672?heartbeat=30&owner=ops@acme.io";',
    'const url = "redis://cache.prod.acme.io?owner=ops@acme.io";',
  ]) {
    assert.deepEqual(ofRule(run('src/cache.ts', code), R), [], code);
  }
});

test('a password is one piece whatever it holds: a # or a ?, a semicolon, digits in front', () => {
  // The last two open with eight digits: no port is that long.
  for (const password of [
    `Pa#ss${DB_PASSWORD}`, `Pa?ss${DB_PASSWORD}`, `Pa#ss@w0rd${DB_PASSWORD}`, '2024#Summer', '2024?Summer', '1234;Summer',
    'Xk29;fLq8=' + 'Zm3vB7Qp', `20240131;${DB_PASSWORD}`, `20240131;k=${DB_PASSWORD}`,
    // No name= follows the sign: an ampersand comes first.
    `1234?a&b=${DB_PASSWORD}`,
    // More at signs than are tried one by one: the last is still read.
    `a@b@c@d@e@f@g@h@i${DB_PASSWORD}`,
    // What a later piece looks like does not undo the literal one before it.
    'Xk29fLq8' + '@9%v,4V',
  ]) {
    assert.equal(ofRule(run('src/db.ts', `export const url = "postgres://app:${password}@db.prod.acme.io:5432/app";`), R).length, 1, password);
  }
});

test('a capitalized name after the dollar is a variable where the language reads it as one, and a password elsewhere', () => {
  const url = 'postgresql://app:$SqlSecret2024@db.prod.acme.io:5432/app';
  for (const [path, code] of [
    ['ops/db.ps1', `$url = "${url}"`],
    ['ops/db.ps1', '$url = "postgresql://app:$script:SqlSecret@db.prod.acme.io:5432/app"'],
    ['ops/db.ps1', '$url = "postgresql://app:$global:SqlSecret@db.prod.acme.io:5432/app"'],
    ['ops/db.sh', `psql "${url}"`],
    ['ops/db.bash', `psql "${url}"`],
    ['docker-compose.yml', `      DATABASE_URL: ${url}`],
    ['k8s/app.yaml', `          value: ${url}`],
    ['Dockerfile', `ENV DATABASE_URL=${url}`],
    ['src/Db.kt', `val url = "${url}"`],
    ['lib/db.dart', `final url = "${url}";`],
    ['src/db.php', `$url = "${url}";`],
    ['src/db.php', '$url = "postgresql://app:$config[db_secret]@db.prod.acme.io:5432/app";'],
  ]) {
    assert.deepEqual(ofRule(run(path, code), R), [], `${path}: ${code}`);
  }
  assert.equal(ofRule(run('src/db.ts', `export const url = "${url}";`), R).length, 1);
  assert.equal(ofRule(run('.env.example', `DATABASE_URL=${url}\n`), R).length, 1);
});
