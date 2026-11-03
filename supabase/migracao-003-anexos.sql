-- =====================================================================
-- SIGAT Online - Migração 003: anexos nos termos (PDF ou imagem, até 3 MB)
-- O arquivo fica guardado no próprio banco, com as mesmas regras do termo.
-- Cole no "SQL Editor" do Supabase e clique em RUN.
-- =====================================================================

create table if not exists public.termos_anexos (
  id          bigint generated always as identity primary key,
  termo_id    bigint not null references public.termos (id) on delete cascade,
  nome        text not null check (length(nome) between 1 and 200),
  tipo        text not null check (tipo in ('application/pdf', 'image/jpeg', 'image/png')),
  tamanho     integer not null check (tamanho between 1 and 3145728),  -- 3 MB
  conteudo    text not null check (length(conteudo) <= 4200000),       -- arquivo em base64
  enviado_por uuid not null default auth.uid() references public.perfis (id),
  criado_em   timestamptz not null default now()
);

create index if not exists termos_anexos_termo_idx on public.termos_anexos (termo_id);

-- Anexo só entra ou sai enquanto o termo está aguardando assinatura
create or replace function public.anexos_bloqueio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_qtd    integer;
begin
  select status into v_status from public.termos
  where id = coalesce(new.termo_id, old.termo_id);

  if tg_op = 'UPDATE' then
    raise exception 'Anexos não podem ser alterados. Remova e envie novamente.';
  end if;
  -- Termo já excluído (exclusão em cascata feita pelo admin): deixa passar
  if v_status is null then
    return old;
  end if;
  if v_status = 'assinado' then
    raise exception 'O termo já foi assinado: os anexos não podem mais ser alterados.';
  end if;
  if tg_op = 'INSERT' then
    select count(*) into v_qtd from public.termos_anexos where termo_id = new.termo_id;
    if v_qtd >= 5 then
      raise exception 'Limite de 5 anexos por termo.';
    end if;
    new.enviado_por := auth.uid();
    new.criado_em := now();
    return new;
  end if;
  return old;
end;
$$;

drop trigger if exists anexos_bloqueio on public.termos_anexos;
create trigger anexos_bloqueio
  before insert or update or delete on public.termos_anexos
  for each row execute function public.anexos_bloqueio();

-- Regras de acesso: as mesmas do termo
alter table public.termos_anexos enable row level security;

drop policy if exists anexos_ler on public.termos_anexos;
create policy anexos_ler on public.termos_anexos
  for select to authenticated
  using (exists (select 1 from public.termos t where t.id = termo_id));

drop policy if exists anexos_enviar on public.termos_anexos;
create policy anexos_enviar on public.termos_anexos
  for insert to authenticated
  with check (exists (
    select 1 from public.termos t
    where t.id = termo_id
      and ((t.servidor_id = auth.uid() and public.eh_ativo()) or public.eh_admin())
  ));

drop policy if exists anexos_remover on public.termos_anexos;
create policy anexos_remover on public.termos_anexos
  for delete to authenticated
  using (exists (
    select 1 from public.termos t
    where t.id = termo_id
      and ((t.servidor_id = auth.uid() and public.eh_ativo()) or public.eh_admin())
  ));

revoke all on public.termos_anexos from anon;

-- Página de assinatura (sem login, só com o token do termo)
create or replace function public.anexos_para_assinatura(p_token uuid)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(json_agg(json_build_object('id', a.id, 'nome', a.nome, 'tipo', a.tipo, 'tamanho', a.tamanho)
                           order by a.id), '[]'::json)
  from public.termos_anexos a
  join public.termos t on t.id = a.termo_id
  where t.token_assinatura = p_token;
$$;

create or replace function public.anexo_para_assinatura(p_token uuid, p_id bigint)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object('nome', a.nome, 'tipo', a.tipo, 'conteudo', a.conteudo)
  from public.termos_anexos a
  join public.termos t on t.id = a.termo_id
  where t.token_assinatura = p_token and a.id = p_id;
$$;

revoke all on function public.anexos_para_assinatura(uuid) from public;
revoke all on function public.anexo_para_assinatura(uuid, bigint) from public;
grant execute on function public.anexos_para_assinatura(uuid) to anon, authenticated;
grant execute on function public.anexo_para_assinatura(uuid, bigint) to anon, authenticated;

-- Lixeira: ao excluir um termo, guarda também os anexos dele
create or replace function public.termos_antes_alterar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if not public.eh_admin() then
      raise exception 'Somente o administrador pode excluir termos.';
    end if;
    insert into public.termos_excluidos (numero, dados, excluido_por)
    values (
      old.numero,
      to_jsonb(old) || jsonb_build_object('anexos', coalesce(
        (select jsonb_agg(to_jsonb(a) - 'termo_id') from public.termos_anexos a where a.termo_id = old.id),
        '[]'::jsonb)),
      auth.uid()
    );
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
