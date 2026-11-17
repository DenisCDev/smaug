// @ts-check
// User-facing strings must be pt-BR with correct accents.
// A: flags unambiguous English UI words in JSX text and user-facing attributes.
// B: flags pt-BR words written without their mandatory accents.
// Conservative by design: precision over recall — a noisy gate gets disabled.

// High-precision English UI vocabulary. Words also common in Brazilian UIs
// (download, upload, home, dashboard, email, login, total...) are absent.
const ENGLISH_WORDS = new Set([
  'save', 'cancel', 'submit', 'delete', 'edit', 'search', 'loading',
  'welcome', 'logout', 'register', 'password', 'username', 'settings',
  'error', 'success', 'warning', 'required', 'optional', 'add', 'remove',
  'update', 'create', 'confirm', 'next', 'previous', 'back', 'close',
  'open', 'show', 'hide', 'send', 'message', 'address', 'city', 'country',
  'price', 'description', 'please', 'click', 'view', 'name', 'phone',
  'start', 'finish', 'yes', 'account', 'forgot', 'remember', 'choose',
  'select', 'user', 'users', 'file', 'folder', 'empty', 'done', 'retry',
  'new', 'sign',
]);

// Misspelled pt-BR → correct form. Keys must not collide with English words
// or with tokens likely to appear in non-UI strings.
const ACCENT_MAP = new Map(Object.entries({
  nao: 'não', voce: 'você', usuario: 'usuário', usuarios: 'usuários',
  endereco: 'endereço', enderecos: 'endereços',
  configuracao: 'configuração', configuracoes: 'configurações',
  informacao: 'informação', informacoes: 'informações',
  descricao: 'descrição', descricoes: 'descrições',
  servico: 'serviço', servicos: 'serviços', preco: 'preço', precos: 'preços',
  numero: 'número', numeros: 'números', codigo: 'código', codigos: 'códigos',
  pagina: 'página', paginas: 'páginas', botao: 'botão', botoes: 'botões',
  cartao: 'cartão', cartoes: 'cartões', acao: 'ação', acoes: 'ações',
  opcao: 'opção', opcoes: 'opções', atencao: 'atenção',
  obrigatorio: 'obrigatório', obrigatoria: 'obrigatória',
  disponivel: 'disponível', disponiveis: 'disponíveis',
  possivel: 'possível', impossivel: 'impossível', saude: 'saúde',
  historico: 'histórico', relatorio: 'relatório', relatorios: 'relatórios',
  calendario: 'calendário', horario: 'horário', horarios: 'horários',
  proximo: 'próximo', proxima: 'próxima', ultimo: 'último', ultima: 'última',
  minimo: 'mínimo', maximo: 'máximo', medico: 'médico', medicos: 'médicos',
  tambem: 'também', inicio: 'início', invalido: 'inválido', invalida: 'inválida',
  gratis: 'grátis', otimo: 'ótimo', rapido: 'rápido', facil: 'fácil',
  dificil: 'difícil', titulo: 'título', conteudo: 'conteúdo',
  secao: 'seção', sessao: 'sessão', excluido: 'excluído', concluido: 'concluído',
  apos: 'após', alem: 'além', avancar: 'avançar', comecar: 'começar',
  seguranca: 'segurança', portugues: 'português',
}));

const USER_FACING_ATTRS = /(?:placeholder|title|alt|aria-label|aria-description|label)\s*=\s*(["'])([^"']+)\1/g;
// (?<!=) keeps the `>` of arrow functions from opening a fake "JSX text" span
// that actually holds code (`(a, b) => a - b < 0 ? ...`).
const JSX_TEXT = /(?<!=)>\s*([^<>{}]+?)\s*</g;
const STRING_LITERAL = /'((?:[^'\\\n]|\\.)+)'|"((?:[^"\\\n]|\\.)+)"/g;
// Attribute values that are code, not copy — blanked before any scan.
const NON_UI_ATTRS = /\b(?:className|class|id|key|htmlFor|style|src|href|type|rel|target|viewBox|fill|stroke|d|width|height|name|value|defaultValue|autoComplete|role|method|action|encType|lang|charSet)\s*=\s*(["'])[^"']*\1/g;

/** @param {string} content @param {number} offset */
function lineAt(content, offset) {
  return content.slice(0, offset).split('\n').length;
}

/** @param {string} content @returns {{ text: string, line: number }[]} */
function userFacingTexts(content) {
  /** @type {{ text: string, line: number }[]} */
  const found = [];
  const push = (/** @type {string} */ text, /** @type {number} */ offset) => {
    const trimmed = text.trim();
    if (trimmed.length < 2 || !/[A-Za-z]/.test(trimmed)) return;
    // urls, emails, code-ish chars, and type-signature syntax — `?:` (optional
    // params) and `):` (return annotations) — that leaks in when a span sits
    // between two generics (`Foo<A>, hide?: b): Bar<C>`).
    if (/:\/\/|@|[{};=<>[\]\\]|\?:|\)\s*:/.test(trimmed)) return;
    found.push({ text: trimmed, line: lineAt(content, offset) });
  };
  let m;
  while ((m = JSX_TEXT.exec(content)) !== null) push(m[1], m.index);
  while ((m = USER_FACING_ATTRS.exec(content)) !== null) push(m[2], m.index);
  return found;
}

export default {
  name: 'ui-strings',
  /** @param {string} path */
  appliesTo(path) {
    return path.endsWith('.tsx') || path.endsWith('.jsx');
  },
  /** @param {{ content: string, options: Record<string, any> }} ctx */
  run({ content, options }) {
    /** @type {{ line: number, message: string }[]} */
    const violations = [];
    const seen = new Set();
    const report = (/** @type {number} */ line, /** @type {string} */ message) => {
      const key = line + '|' + message;
      if (seen.has(key)) return;
      seen.add(key);
      violations.push({ line, message });
    };

    // Blank code-carrying attribute values, preserving offsets.
    const scannable = content.replace(NON_UI_ATTRS, (m) => ' '.repeat(m.length));
    const texts = userFacingTexts(scannable);

    // A — English words in user-facing positions
    if (options.english !== false) {
      for (const t of texts) {
        const words = t.text.match(/[A-Za-z']+/g) ?? [];
        const hit = words.find((w) => ENGLISH_WORDS.has(w.toLowerCase()));
        if (hit) {
          report(t.line, `hardcoded English in UI ("${hit}" in "${truncate(t.text)}") — user-facing strings must be pt-BR`);
        }
      }
    }

    // B — pt-BR missing accents
    if (options.accents !== false) {
      const scanWords = (/** @type {string} */ text, /** @type {number} */ line) => {
        const words = text.match(/[A-Za-zÀ-ɏ]+/g) ?? [];
        for (const w of words) {
          const fix = ACCENT_MAP.get(w.toLowerCase());
          if (fix) report(line, `"${w}" → "${fix}" — pt-BR needs the accent/cedilla`);
        }
      };
      for (const t of texts) scanWords(t.text, t.line);
      // Plain string literals join in only when they read as prose (contain
      // whitespace) — single-word literals are usually enum/status values.
      let m;
      while ((m = STRING_LITERAL.exec(scannable)) !== null) {
        const value = m[1] ?? m[2];
        if (/\s/.test(value) && !/[/\\]/.test(value)) {
          scanWords(value, lineAt(scannable, m.index));
        }
      }
    }
    return violations;
  },
};

/** @param {string} text */
function truncate(text) {
  return text.length > 40 ? text.slice(0, 37) + '...' : text;
}
