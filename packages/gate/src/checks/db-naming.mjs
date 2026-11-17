// @ts-check
// Database identifiers must be English snake_case. Flags Portuguese words,
// accented characters, and mixed-case identifiers in DDL of .sql files.
import { stripSql } from '../strip.mjs';

// Unambiguous Portuguese words commonly used as identifiers. Ambiguous tokens
// that are also English (data, total, status, local, agenda...) are excluded.
const PT_WORDS = new Set([
  'nome', 'sobrenome', 'usuario', 'usuarios', 'senha', 'senhas',
  'nascimento', 'endereco', 'enderecos', 'telefone', 'telefones', 'celular',
  'cidade', 'cidades', 'bairro', 'preco', 'precos', 'valor', 'valores',
  'descricao', 'descricoes', 'situacao', 'pagamento', 'pagamentos',
  'cliente', 'clientes', 'pedido', 'pedidos', 'produto', 'produtos',
  'servico', 'servicos', 'agendamento', 'agendamentos', 'consulta',
  'consultas', 'paciente', 'pacientes', 'medico', 'medicos', 'funcionario',
  'funcionarios', 'empresa', 'empresas', 'cadastro', 'cadastros',
  'criado', 'criada', 'atualizado', 'atualizada', 'excluido', 'excluida',
  'deletado', 'ativo', 'ativa', 'inativo', 'codigo', 'codigos',
  'quantidade', 'observacao', 'observacoes', 'mensagem', 'mensagens',
  'titulo', 'titulos', 'conteudo', 'categoria', 'categorias',
  'fatura', 'faturas', 'cobranca', 'cobrancas', 'vencimento',
  'parcela', 'parcelas', 'saldo', 'compra', 'compras', 'venda', 'vendas',
  'estoque', 'fornecedor', 'fornecedores', 'aniversario', 'idade', 'genero',
  'nota', 'notas', 'tipo', 'tipos', 'grupo', 'grupos', 'perfil', 'perfis',
  'permissao', 'permissoes', 'cargo', 'cargos', 'salario', 'salarios',
  'horario', 'horarios', 'taxa', 'taxas', 'juros', 'desconto', 'descontos',
  'frete', 'entrega', 'entregas', 'avaliacao', 'avaliacoes', 'comentario',
  'comentarios', 'resposta', 'respostas', 'pergunta', 'perguntas',
  'arquivo', 'arquivos', 'imagem', 'imagens', 'foto', 'fotos',
  'documento', 'documentos', 'assinatura', 'assinaturas', 'plano', 'planos',
]);

// Each part bare or quoted, so "public"."pedidos" is read up to the table name.
const IDENT = String.raw`((?:"[^"]+"|[\w$À-ɏ]+)(?:\.(?:"[^"]+"|[\w$À-ɏ]+))?)`;
const NOT_CONSTRAINT = String.raw`(?!(?:constraint|primary|unique|check|foreign|exclude)\b)`;
// Temporary and unlogged tables are named by the same convention.
const CREATE_TABLE = String.raw`\bcreate\s+(?:(?:global\s+|local\s+)?temp(?:orary)?\s+|unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?`;

// [statement regex, capture group index, options]
const PATTERNS = /** @type {[RegExp, number, { noCaseCheck?: boolean }][]} */ ([
  [new RegExp(CREATE_TABLE + IDENT, 'gi'), 1, {}],
  [new RegExp(String.raw`\badd\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?${NOT_CONSTRAINT}${IDENT}`, 'gi'), 1, {}],
  [new RegExp(String.raw`\brename\s+(?:column\s+)?${IDENT}\s+to\s+${IDENT}`, 'gi'), 2, {}],
  // The object itself: `alter table clients rename to clientes`.
  [new RegExp(String.raw`\brename\s+to\s+${IDENT}`, 'gi'), 1, {}],
  [new RegExp(String.raw`\bcreate\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?${IDENT}`, 'gi'), 1, {}],
  [new RegExp(String.raw`\bcreate\s+(?:or\s+replace\s+)?(?:function|procedure)\s+${IDENT}`, 'gi'), 1, {}],
  [new RegExp(String.raw`\bcreate\s+type\s+${IDENT}`, 'gi'), 1, {}],
  [new RegExp(String.raw`\bcreate\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?${IDENT}`, 'gi'), 1, {}],
  [new RegExp(String.raw`\bcreate\s+schema\s+(?:if\s+not\s+exists\s+)?${IDENT}`, 'gi'), 1, {}],
  [new RegExp(String.raw`\bcreate\s+(?:temp(?:orary)?\s+)?sequence\s+(?:if\s+not\s+exists\s+)?${IDENT}`, 'gi'), 1, {}],
  [new RegExp(String.raw`\bcreate\s+trigger\s+${IDENT}`, 'gi'), 1, {}],
  // Policy names are often sentence-like descriptions — skip the case check.
  [new RegExp(String.raw`\bcreate\s+policy\s+${IDENT}`, 'gi'), 1, { noCaseCheck: true }],
]);

const COLUMN_SKIP = new Set([
  'constraint', 'primary', 'foreign', 'unique', 'check', 'exclude', 'like',
  'references', 'deferrable', 'initially', 'not', 'null',
]);

/**
 * @param {string} ident @param {{ noCaseCheck?: boolean }} opts
 * @param {Set<string>} allow
 * @returns {string | null}
 */
function problem(ident, opts, allow) {
  const last = /(?:"([^"]+)"|([^".]+))$/.exec(ident);
  const raw = last ? last[1] ?? last[2] : ident;
  if (allow.has(raw.toLowerCase())) return null;
  if (/[^\x20-\x7E]/.test(raw)) {
    return `accented character in identifier "${raw}" — use English snake_case`;
  }
  const tokens = raw.toLowerCase().split(/[\s_]+/).filter(Boolean);
  const pt = tokens.find((t) => PT_WORDS.has(t));
  if (pt) {
    return `Portuguese identifier "${raw}" ("${pt}") — use English snake_case`;
  }
  if (!opts.noCaseCheck && /[A-Z]/.test(raw)) {
    return `identifier "${raw}" is not snake_case — use lower English snake_case`;
  }
  return null;
}

/** @param {string} content @returns {number[]} offset of each line start */
function lineStarts(content) {
  const starts = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

/** @param {number[]} starts @param {number} offset */
function lineOf(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/**
 * Extracts the first identifier of each top-level comma segment inside the
 * column list of a CREATE TABLE, starting at the opening paren.
 * @param {string} sql @param {number} openParen
 * @returns {{ ident: string, offset: number }[]}
 */
function columnIdents(sql, openParen) {
  /** @type {{ ident: string, offset: number }[]} */
  const idents = [];
  let depth = 0;
  let segmentStart = openParen + 1;
  for (let i = openParen; i < sql.length; i++) {
    const c = sql[i];
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) {
        pushIdent(sql, segmentStart, i, idents);
        break;
      }
    } else if (c === ',' && depth === 1) {
      pushIdent(sql, segmentStart, i, idents);
      segmentStart = i + 1;
    }
  }
  return idents;
}

/** @param {string} sql @param {number} from @param {number} to @param {{ident: string, offset: number}[]} out */
function pushIdent(sql, from, to, out) {
  const segment = sql.slice(from, to);
  const m = segment.match(/^\s*("[^"]+"|[\w$À-ɏ]+)/);
  if (!m) return;
  const first = m[1];
  if (COLUMN_SKIP.has(first.toLowerCase())) return;
  out.push({ ident: first, offset: from + (m[0].length - first.length) });
}

export default {
  name: 'db-naming',
  /** @param {string} path */
  appliesTo(path) {
    return path.endsWith('.sql');
  },
  /** @param {{ content: string, options: Record<string, any> }} ctx */
  run({ content, options }) {
    const sql = stripSql(content);
    const starts = lineStarts(sql);
    const allow = new Set(
      (Array.isArray(options.allow) ? options.allow : []).map((/** @type {string} */ a) => a.toLowerCase()),
    );
    /** @type {{ line: number, message: string }[]} */
    const violations = [];
    const seen = new Set();
    const report = (/** @type {string} */ ident, /** @type {number} */ offset, /** @type {{noCaseCheck?: boolean}} */ opts) => {
      const message = problem(ident, opts, allow);
      if (!message) return;
      const line = lineOf(starts, offset);
      const key = line + '|' + message;
      if (seen.has(key)) return;
      seen.add(key);
      violations.push({ line, message });
    };

    for (const [re, group, opts] of PATTERNS) {
      let m;
      while ((m = re.exec(sql)) !== null) {
        report(String(m[group]), m.index, opts);
      }
    }

    // Column definitions inside CREATE TABLE (...)
    const createRe = new RegExp(CREATE_TABLE + IDENT + String.raw`\s*\(`, 'gi');
    let m;
    while ((m = createRe.exec(sql)) !== null) {
      const openParen = m.index + m[0].length - 1;
      for (const col of columnIdents(sql, openParen)) {
        report(col.ident, col.offset, {});
      }
    }
    return violations;
  },
};
