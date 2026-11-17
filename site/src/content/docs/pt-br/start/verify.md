---
title: Verificar a instalação
description: Confira a instalação com o smugan doctor e uma sessão de fumaça.
---

Primeiro, sem sessão e sem gastar tokens:

```bash
smugan doctor
```

O `doctor` verifica:

- a versão do Node;
- os quatro hooks no `settings.json` (início de sessão, antes e depois da escrita, fim de turno) e o lançador que eles chamam;
- o engine para o qual os hooks apontam;
- se o comando `smugan` está no `PATH` e aponta para este checkout;
- se as cópias instaladas batem com as do checkout;
- se `"disableAllHooks": true` desliga os hooks, no `settings.json` do usuário
  ou no `.claude/` da pasta onde ele roda;
- os parsers do `context`;
- o Git Bash, no Windows.

No fim, ele passa pelo hook instalado uma escrita de teste de uma migration com nome
em português e sem RLS, e exige que ela volte bloqueada. Cada linha que falha traz o
comando que a corrige. O código de saída é 1 quando qualquer linha falha, inclusive
uma cópia instalada que ficou para trás em relação ao checkout.

Depois, em uma pasta descartável, para que a migration de teste não acabe em um
projeto real:

```bash
mkdir smugan-smoke && cd smugan-smoke && git init && claude
```

E peça:

```text
Create supabase/migrations/0001_clientes.sql with create table clientes (id uuid primary key, nome_completo text).
```

A escrita precisa voltar recusada com `smugan gate: blocked`, e as linhas precisam
incluir `[db-naming]` e `[rls]`. Apague a pasta depois.

Se a migration for escrita sem essa mensagem, os hooks não rodaram naquela sessão:

1. sessões abertas antes da instalação não leem os hooks; abra uma nova;
2. rode o `doctor` de dentro dessa pasta;
3. se ele voltar verde e a sessão continuar sem bloquear, rode `/status` na
   sessão. Uma organização pode restringir hooks por configurações gerenciadas
   (`allowManagedHooksOnly`), que o `doctor` não consegue ler.
