# SIGAT Online

Sistema Integrado de Gestão de Atendimentos e Termos, da **TR Assessoria Pública**.

Os servidores registram atendimentos, geram um link de assinatura, mandam pelo WhatsApp e o responsável assina na tela do celular. Depois de assinado, o termo fica **travado para sempre**: ninguém altera, nem o administrador.

## Como funciona

| Parte | Onde fica |
|---|---|
| Site (telas) | GitHub Pages (gratuito) |
| Banco de dados e login | Supabase (gratuito) |
| Cadastro de servidores | Função `criar-servidor` no Supabase |

As regras de segurança ficam **no banco** (Supabase), não só nas telas:

- o servidor só vê e edita os próprios termos;
- o administrador vê todos;
- termo assinado não pode ser alterado, excluído nem assinado de novo;
- a assinatura só é gravada pelo link exclusivo do termo.

## Arquivos

```
index.html                 sistema (login, painel, termos, servidores)
assinar.html               página pública de assinatura
css/estilo.css             visual
js/config.js               endereço e chave pública do Supabase  <- preencher
js/comum.js                funções compartilhadas
js/app.js                  lógica do sistema
js/assinar.js              lógica da assinatura
supabase/schema.sql        tabelas e regras de segurança do banco
supabase/functions/criar-servidor/index.ts   função de cadastro de servidores
```

---

## Instalação passo a passo

### 1. Criar o projeto no Supabase

1. Entre em https://supabase.com e clique em **New project**.
2. Nome: `sigat-online`. Crie uma senha forte para o banco e **guarde-a**.
3. Região: **South America (São Paulo)**.
4. Aguarde o projeto ficar pronto (1 a 2 minutos).

### 2. Criar as tabelas

1. No menu da esquerda, clique em **SQL Editor**.
2. Clique em **New query**.
3. Copie **todo** o conteúdo do arquivo `supabase/schema.sql`, cole e clique em **Run**.
4. Deve aparecer `Success. No rows returned`.

### 3. Bloquear cadastro público

Só o administrador cadastra pessoas.

1. Menu **Authentication** > **Sign In / Providers** (ou **Providers**, conforme a versão).
2. Desligue **Allow new users to sign up** e salve.

### 4. Criar o primeiro administrador

1. Menu **Authentication** > **Users** > **Add user** > **Create new user**.
2. Informe e-mail e senha e marque **Auto Confirm User**.
3. Volte ao **SQL Editor** e rode (trocando o e-mail):

```sql
update public.perfis
set papel = 'admin', nome = 'Seu Nome'
where email = 'seu-email@exemplo.com';
```

### 5. Criar a função de cadastro de servidores

1. Menu **Edge Functions** > **Deploy a new function** > **Via Editor**.
2. Nome da função: `criar-servidor` (exatamente assim).
3. Apague o código de exemplo, cole **todo** o conteúdo de `supabase/functions/criar-servidor/index.ts` e clique em **Deploy**.
4. Na aba **Settings** da função, desligue **Verify JWT with legacy secret** e clique em **Save changes**
   (a própria função já confere se quem chama é administrador).

### 6. Ligar o site ao Supabase

1. No Supabase: **Project Settings** > **API** (ou **Data API** / **API Keys**).
2. Copie a **Project URL** e a chave pública: **Publishable key** (`sb_publishable_...`) ou, em projetos antigos, a **anon public**.
3. No GitHub, abra `js/config.js`, clique no lápis, cole os dois valores no lugar de `COLE_AQUI_...` e salve (**Commit changes**).

> Use **somente** a chave `anon`. Nunca coloque a chave `service_role` no site.

### 7. Publicar o site (GitHub Pages)

1. No repositório do GitHub: **Settings** > **Pages**.
2. Em **Branch**, escolha `main` e a pasta `/ (root)` e clique em **Save**.
3. Depois de 1 ou 2 minutos, o endereço aparece no topo da página, por exemplo:
   `https://SEU-USUARIO.github.io/sigat-online/`

### 8. Ajustar o endereço no Supabase

1. Supabase > **Authentication** > **URL Configuration**.
2. Em **Site URL**, cole o endereço do GitHub Pages e salve.

---

## Teste rápido

1. Entre com o administrador.
2. Em **Servidores**, cadastre um servidor de teste.
3. Saia e entre com o servidor de teste.
4. Cadastre um atendimento e copie o link de assinatura.
5. Abra o link em outra aba (ou no celular), desenhe a assinatura e confirme.
6. Volte ao sistema: o termo aparece como **Assinado** e não tem mais o botão Editar.
7. Entre como administrador: o termo do servidor aparece na lista.

## Observações importantes

- A assinatura é **eletrônica simples** (desenho na tela + nome + data/hora + IP). **Não** é assinatura digital ICP-Brasil.
- O envio pelo WhatsApp abre a conversa com o link pronto; não é envio automático.
- Os dados ficam no Supabase e **não somem** quando o site é atualizado.
- No plano gratuito, o Supabase **pausa** o projeto após cerca de 1 semana sem nenhum acesso. Basta entrar no painel do Supabase e clicar em **Restore** (os dados não se perdem). Com uso diário, isso não acontece.
- Para backup, use no Supabase: **Database** > **Backups** (planos pagos) ou exporte as tabelas periodicamente em **Table Editor** > **Export to CSV**.
- Para trocar a senha de um servidor: Supabase > **Authentication** > **Users** > (usuário) > **Send password recovery** ou redefinir a senha.
