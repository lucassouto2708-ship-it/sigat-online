-- =====================================================================
-- SIGAT Online - Migração 004: agenda semanal dos técnicos
-- O administrador envia a imagem da agenda da semana; o sistema lê quem
-- vai para onde em cada dia e o painel cobra um termo por dia agendado.
-- Cole no "SQL Editor" do Supabase e clique em RUN.
-- =====================================================================

create table if not exists public.agendas (
  id            bigint generated always as identity primary key,
  semana_inicio date not null unique check (extract(isodow from semana_inicio) = 1),  -- segunda-feira
  imagem        text check (length(imagem) <= 4200000),  -- imagem da agenda (data URL)
  enviado_por   uuid default auth.uid() references public.perfis (id) on delete set null,
  criado_em     timestamptz not null default now()
);

create table if not exists public.agenda_itens (
  id           bigint generated always as identity primary key,
  agenda_id    bigint not null references public.agendas (id) on delete cascade,
  servidor_id  uuid references public.perfis (id) on delete set null,
  tecnico_nome text not null check (length(tecnico_nome) between 1 and 120),
  data         date not null,
  destino      text not null check (length(destino) between 1 and 120)
);

create index if not exists agenda_itens_agenda_idx on public.agenda_itens (agenda_id);
create index if not exists agenda_itens_servidor_idx on public.agenda_itens (servidor_id, data);

alter table public.agendas enable row level security;
alter table public.agenda_itens enable row level security;

-- Todos os usuários ativos veem a agenda; o servidor vê só os próprios dias
drop policy if exists agendas_ler on public.agendas;
create policy agendas_ler on public.agendas
  for select to authenticated using (public.eh_ativo());

drop policy if exists agenda_itens_ler on public.agenda_itens;
create policy agenda_itens_ler on public.agenda_itens
  for select to authenticated using (public.eh_admin() or (servidor_id = auth.uid() and public.eh_ativo()));

drop policy if exists agendas_admin on public.agendas;
create policy agendas_admin on public.agendas
  for delete to authenticated using (public.eh_admin());

revoke all on public.agendas from anon;
revoke all on public.agenda_itens from anon;

-- Grava (ou substitui) a agenda de uma semana de uma vez só
create or replace function public.salvar_agenda(p_semana date, p_imagem text, p_itens jsonb)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
begin
  if not public.eh_admin() then
    raise exception 'Somente o administrador pode enviar a agenda.';
  end if;
  if extract(isodow from p_semana) <> 1 then
    raise exception 'A semana deve começar numa segunda-feira.';
  end if;

  insert into public.agendas (semana_inicio, imagem, enviado_por)
  values (p_semana, p_imagem, auth.uid())
  on conflict (semana_inicio) do update
    set imagem = coalesce(excluded.imagem, public.agendas.imagem), enviado_por = auth.uid(), criado_em = now()
  returning id into v_id;

  delete from public.agenda_itens where agenda_id = v_id;

  insert into public.agenda_itens (agenda_id, servidor_id, tecnico_nome, data, destino)
  select v_id, nullif(i ->> 'servidor_id', '')::uuid, trim(i ->> 'tecnico_nome'),
         (i ->> 'data')::date, trim(i ->> 'destino')
  from jsonb_array_elements(p_itens) i
  where coalesce(trim(i ->> 'destino'), '') <> ''
    and (i ->> 'data')::date between p_semana and p_semana + 4;

  return v_id;
end;
$$;

revoke all on function public.salvar_agenda(date, text, jsonb) from public;
grant execute on function public.salvar_agenda(date, text, jsonb) to authenticated;
