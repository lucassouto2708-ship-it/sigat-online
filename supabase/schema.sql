-- =====================================================================
-- SIGAT Online - estrutura do banco (Supabase / PostgreSQL)
-- Cole este arquivo inteiro no "SQL Editor" do Supabase e clique em RUN.
-- Pode ser executado mais de uma vez sem apagar dados.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Perfis (um por usuário do Supabase Auth)
-- ---------------------------------------------------------------------
create table if not exists public.perfis (
  id        uuid primary key references auth.users (id) on delete cascade,
  nome      text not null,
  email     text not null,
  papel     text not null default 'servidor' check (papel in ('admin', 'servidor')),
  ativo     boolean not null default true,
  criado_em timestamptz not null default now()
);

-- Cria o perfil automaticamente quando um usuário é criado.
-- Sempre nasce como 'servidor'; só o admin (ou o SQL) promove.
create or replace function public.criar_perfil_novo_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.perfis (id, nome, email)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'nome'), ''), split_part(new.email, '@', 1)),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists ao_criar_usuario on auth.users;
create trigger ao_criar_usuario
  after insert on auth.users
  for each row execute function public.criar_perfil_novo_usuario();

-- Funções auxiliares usadas nas regras de acesso
create or replace function public.eh_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.perfis
    where id = auth.uid() and papel = 'admin' and ativo
  );
$$;

create or replace function public.eh_ativo()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.perfis where id = auth.uid() and ativo);
$$;

-- ---------------------------------------------------------------------
-- Termos de atendimento
-- ---------------------------------------------------------------------
create sequence if not exists public.termos_numero_seq;

create table if not exists public.termos (
  id                   bigint generated always as identity primary key,
  numero               text unique,
  servidor_id          uuid not null default auth.uid() references public.perfis (id),
  servidor_nome        text,
  data_atendimento     date not null,
  local                text not null,
  setor                text,
  responsavel_nome     text not null,
  responsavel_telefone text,
  tipo                 text not null,
  descricao            text not null,
  situacao             text not null,
  status               text not null default 'pendente' check (status in ('pendente', 'assinado')),
  token_assinatura     uuid not null default gen_random_uuid() unique,
  assinado_por         text,
  assinatura_img       text,
  assinado_em          timestamptz,
  assinatura_ip        text,
  assinatura_navegador text,
  criado_em            timestamptz not null default now(),
  atualizado_em        timestamptz not null default now()
);

create index if not exists termos_servidor_idx on public.termos (servidor_id);
create index if not exists termos_criado_idx on public.termos (criado_em desc);

-- Preenche número (TA-AAAA-00001) e nome do servidor ao cadastrar
create or replace function public.termos_antes_inserir()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.numero := 'TA-' || to_char(now() at time zone 'America/Sao_Paulo', 'YYYY') || '-'
                || lpad(nextval('public.termos_numero_seq')::text, 5, '0');
  new.servidor_nome := (select nome from public.perfis where id = new.servidor_id);
  new.status := 'pendente';
  new.token_assinatura := gen_random_uuid();
  new.assinado_por := null;
  new.assinatura_img := null;
  new.assinado_em := null;
  new.assinatura_ip := null;
  new.assinatura_navegador := null;
  new.criado_em := now();
  new.atualizado_em := now();
  return new;
end;
$$;

drop trigger if exists termos_antes_inserir on public.termos;
create trigger termos_antes_inserir
  before insert on public.termos
  for each row execute function public.termos_antes_inserir();

-- BLOQUEIO DEFINITIVO: termo assinado não muda nunca (nem pelo admin).
-- Também impede que a assinatura seja gravada por fora da função oficial.
create or replace function public.termos_antes_alterar()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'assinado' then
      raise exception 'Termo % já foi assinado e não pode ser excluído.', old.numero;
    end if;
    return old;
  end if;

  if old.status = 'assinado' then
    raise exception 'Termo % já foi assinado e não pode ser alterado.', old.numero;
  end if;

  -- Campos que nunca mudam por edição comum
  if new.id <> old.id or new.numero is distinct from old.numero
     or new.servidor_id <> old.servidor_id or new.servidor_nome is distinct from old.servidor_nome
     or new.criado_em <> old.criado_em then
    raise exception 'Campo protegido não pode ser alterado.';
  end if;

  -- Assinatura só pode ser registrada pela função assinar_termo
  if coalesce(current_setting('sigat.assinando', true), '') <> 'sim' then
    if new.status <> old.status
       or new.assinado_por is distinct from old.assinado_por
       or new.assinatura_img is distinct from old.assinatura_img
       or new.assinado_em is distinct from old.assinado_em
       or new.assinatura_ip is distinct from old.assinatura_ip
       or new.assinatura_navegador is distinct from old.assinatura_navegador then
      raise exception 'A assinatura só pode ser registrada pelo link de assinatura.';
    end if;
  end if;

  new.atualizado_em := now();
  return new;
end;
$$;

drop trigger if exists termos_antes_alterar on public.termos;
create trigger termos_antes_alterar
  before update or delete on public.termos
  for each row execute function public.termos_antes_alterar();

-- ---------------------------------------------------------------------
-- Regras de acesso (Row Level Security)
-- ---------------------------------------------------------------------
alter table public.perfis enable row level security;
alter table public.termos enable row level security;

drop policy if exists perfis_ler on public.perfis;
create policy perfis_ler on public.perfis
  for select to authenticated
  using (id = auth.uid() or public.eh_admin());

drop policy if exists perfis_admin_alterar on public.perfis;
create policy perfis_admin_alterar on public.perfis
  for update to authenticated
  using (public.eh_admin())
  with check (public.eh_admin());

-- Servidor vê só os seus; admin vê todos
drop policy if exists termos_ler on public.termos;
create policy termos_ler on public.termos
  for select to authenticated
  using (servidor_id = auth.uid() or public.eh_admin());

drop policy if exists termos_cadastrar on public.termos;
create policy termos_cadastrar on public.termos
  for insert to authenticated
  with check (servidor_id = auth.uid() and public.eh_ativo());

drop policy if exists termos_editar on public.termos;
create policy termos_editar on public.termos
  for update to authenticated
  using ((servidor_id = auth.uid() and public.eh_ativo()) or public.eh_admin())
  with check ((servidor_id = auth.uid() and public.eh_ativo()) or public.eh_admin());

drop policy if exists termos_excluir on public.termos;
create policy termos_excluir on public.termos
  for delete to authenticated
  using (public.eh_admin());

revoke all on public.termos from anon;
revoke all on public.perfis from anon;

-- ---------------------------------------------------------------------
-- Funções públicas da página de assinatura (sem login, só com o token)
-- ---------------------------------------------------------------------
create or replace function public.termo_para_assinatura(p_token uuid)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'numero', numero,
    'servidor_nome', servidor_nome,
    'data_atendimento', data_atendimento,
    'local', local,
    'setor', setor,
    'responsavel_nome', responsavel_nome,
    'tipo', tipo,
    'descricao', descricao,
    'situacao', situacao,
    'status', status,
    'assinado_por', assinado_por,
    'assinado_em', assinado_em
  )
  from public.termos
  where token_assinatura = p_token;
$$;

create or replace function public.assinar_termo(p_token uuid, p_nome text, p_assinatura text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_termo   public.termos;
  v_headers json;
begin
  if p_nome is null or length(trim(p_nome)) < 3 then
    raise exception 'Informe seu nome completo.';
  end if;
  if p_assinatura is null or p_assinatura not like 'data:image/png;base64,%'
     or length(p_assinatura) < 1000 then
    raise exception 'Assinatura inválida. Desenhe sua assinatura no quadro.';
  end if;
  if length(p_assinatura) > 500000 then
    raise exception 'Imagem da assinatura muito grande.';
  end if;

  select * into v_termo from public.termos where token_assinatura = p_token for update;
  if not found then
    raise exception 'Link de assinatura inválido ou substituído por um novo link.';
  end if;
  if v_termo.status = 'assinado' then
    raise exception 'Este termo já foi assinado.';
  end if;

  begin
    v_headers := current_setting('request.headers', true)::json;
  exception when others then
    v_headers := null;
  end;

  perform set_config('sigat.assinando', 'sim', true);
  update public.termos set
    status = 'assinado',
    assinado_por = trim(p_nome),
    assinatura_img = p_assinatura,
    assinado_em = now(),
    assinatura_ip = split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1),
    assinatura_navegador = left(v_headers ->> 'user-agent', 300)
  where id = v_termo.id;
  perform set_config('sigat.assinando', '', true);

  return json_build_object('numero', v_termo.numero, 'assinado_em', now());
end;
$$;

revoke all on function public.termo_para_assinatura(uuid) from public;
revoke all on function public.assinar_termo(uuid, text, text) from public;
grant execute on function public.termo_para_assinatura(uuid) to anon, authenticated;
grant execute on function public.assinar_termo(uuid, text, text) to anon, authenticated;
