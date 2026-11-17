---
title: Instalar como plugin
description: Rode o Smugan como um plugin do Claude Code ativado por projeto.
---

O repositório também é um plugin do Claude Code. O plugin fornece as skills, os
revisores, o estilo de resposta e os hooks direto deste checkout, sem copiar nada
para `~/.claude`, e pode ser ativado ou desativado por projeto. O `install.sh`
continua sendo a opção global.

Quando a instalação global está presente, os hooks do plugin saem sem agir e o
início da sessão mostra um aviso. As skills, os agentes e o estilo do plugin
continuam listados ao lado das cópias globais, e um revisor lançado como
`smugan:critic` pula a verificação de perfil; por isso, mantenha só um dos dois.
Para trocar a global pelo plugin, rode `./install.sh --uninstall` no checkout,
instale o plugin e abra uma sessão nova. Para manter só a global, desative o plugin
com `claude plugin disable smugan@smugan`.

```bash
claude plugin marketplace add DenisCDev/smugan
claude plugin install smugan@smugan --scope project   # writes to the project's .claude/settings.json
```

Para que quem clonar o projeto receba o plugin, faça commit do `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "smugan": { "source": { "source": "github", "repo": "DenisCDev/smugan" } }
  },
  "enabledPlugins": { "smugan@smugan": true }
}
```

Para desativá-lo em um projeto específico, só na sua máquina, use o
`.claude/settings.local.json` desse projeto:

```json
{
  "enabledPlugins": { "smugan@smugan": false }
}
```

O mesmo funciona pela linha de comando: `claude plugin disable smugan@smugan --scope local`.

Um plugin não instala `CLAUDE.md` nem regras. No início de cada sessão, e de novo
depois de `/clear` ou de uma compactação, o hook entrega as regras gerais de
`claude/CLAUDE.md` como contexto. A primeira edição de um arquivo coberto por uma
regra de stack aponta a regra que o agente precisa ler, uma vez por regra por
sessão. Skills e revisores aparecem com o prefixo do plugin, como
`smugan:smugan-build` e `smugan:critic`.

Os idiomas são opções do plugin, desligadas por padrão: `ui_language` e
`reply_language`, com um código de idioma ou `off`. Elas aparecem no `/config` e
podem ser definidas na instalação:

```bash
claude plugin install smugan@smugan --scope project --config ui_language=pt-BR --config reply_language=pt-BR
```

O perfil de custo é a opção `profile` (`completo`, `economico` ou `minimo`), com o
mesmo efeito e a mesma ressalva do `SMUGAN_PROFILE`. Como os arquivos de agente de um
plugin são fixos, o modelo vai junto em cada lançamento: o contexto de início de
sessão diz ao agente qual `model` passar ao lançar o `smugan:critic`, e um hook em
`Agent` recusa um revisor lançado sem esse modelo, um revisor lançado com um `model`
explícito no perfil `completo` (que usa o modelo da conversa) ou o
`smugan:flow-critic` no perfil `minimo`, explicando como corrigir.

As partes desativadas são a opção `disable`, com a mesma lista do `SMUGAN_DISABLE`.
Um plugin traz todos os agentes e skills, e a lista deles não muda por opção: um
revisor ou skill desativado continua aparecendo na listagem do Claude Code. Por isso
o contexto de início de sessão diz que a parte não é usada, e um hook em `Agent` e
`Skill` recusa o lançamento. Uma regra desativada não é ensinada. Um nome
desconhecido gera um aviso e, naquela sessão, nada é desativado.

Assim como no `install.sh`, um `ui_language` em português ativa a regra `ui-ptbr` e a
checagem `ui-strings`. O comando `smugan` não é adicionado ao `PATH`: o contexto da
sessão diz ao agente como chamar a CLI dentro do plugin. O `smugan context` precisa
de três parsers do engine: na primeira sessão depois de instalar ou atualizar o
plugin, o início da sessão roda `npm ci` na pasta de dados do plugin, uma única vez,
e avisa se falhar (sem rede, por exemplo); a sessão seguinte tenta de novo. Carregado
a partir de um checkout com `--plugin-dir`, o plugin usa o próprio `node_modules` do
checkout. O `smugan doctor` verifica só a instalação global.
